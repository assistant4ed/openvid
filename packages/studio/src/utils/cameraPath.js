// Camera-path analysis: turns a hand-drawn stroke (normalized points with
// timestamps) into a structured summary, and that summary into camera
// direction text — via the /api/camera-path LLM route when available, or a
// deterministic rule-based builder as fallback (Electron, missing key, 5xx).

const MIN_POINT_DISTANCE = 0.015; // normalized units — dedupe jitter
const MAX_SEGMENTS = 6;
const SEGMENT_TURN_THRESHOLD = 35; // degrees of direction change → new segment

const DIRECTION_LABELS = [
    { angle: 0, label: 'track right' },
    { angle: 45, label: 'track right while craning up' },
    { angle: 90, label: 'crane up' },
    { angle: 135, label: 'track left while craning up' },
    { angle: 180, label: 'track left' },
    { angle: 225, label: 'track left while descending' },
    { angle: 270, label: 'descend' },
    { angle: 315, label: 'track right while descending' },
];

const REGION_COLUMNS = ['left', 'center', 'right'];
const REGION_ROWS = ['upper', 'middle', 'lower'];

function regionName(point) {
    const column = REGION_COLUMNS[Math.min(2, Math.floor(point.x * 3))];
    const row = REGION_ROWS[Math.min(2, Math.floor(point.y * 3))];
    if (row === 'middle' && column === 'center') return 'center of frame';
    if (row === 'middle') return `${column} of frame`;
    if (column === 'center') return `${row} third`;
    return `${row} ${column}`;
}

// Screen y grows downward; flip so positive angle = upward camera move.
function segmentAngleDegrees(from, to) {
    const degrees = (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
    return (degrees + 360) % 360;
}

function directionLabel(angle) {
    let best = DIRECTION_LABELS[0];
    let bestDelta = 360;
    for (const candidate of DIRECTION_LABELS) {
        const delta = Math.min(
            Math.abs(angle - candidate.angle),
            360 - Math.abs(angle - candidate.angle),
        );
        if (delta < bestDelta) {
            bestDelta = delta;
            best = candidate;
        }
    }
    return best.label;
}

function simplifyPoints(points) {
    if (points.length <= 2) return points;
    const result = [points[0]];
    for (const point of points.slice(1)) {
        const previous = result[result.length - 1];
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
        if (distance >= MIN_POINT_DISTANCE) result.push(point);
    }
    const last = points[points.length - 1];
    if (result[result.length - 1] !== last) result.push(last);
    return result;
}

function splitIntoSegments(points) {
    const segments = [];
    let start = points[0];
    let previousAngle = null;
    let length = 0;
    let startTime = points[0].t;

    for (let i = 1; i < points.length; i++) {
        const from = points[i - 1];
        const to = points[i];
        const stepLength = Math.hypot(to.x - from.x, to.y - from.y);
        const angle = segmentAngleDegrees(from, to);

        const turn = previousAngle === null
            ? 0
            : Math.min(Math.abs(angle - previousAngle), 360 - Math.abs(angle - previousAngle));

        if (previousAngle !== null && turn > SEGMENT_TURN_THRESHOLD && length > 0.05) {
            segments.push({ from: start, to: from, length, durationMs: from.t - startTime });
            start = from;
            length = 0;
            startTime = from.t;
        }

        length += stepLength;
        previousAngle = angle;
    }

    const lastPoint = points[points.length - 1];
    if (length > 0) {
        segments.push({ from: start, to: lastPoint, length, durationMs: lastPoint.t - startTime });
    }
    return segments.slice(0, MAX_SEGMENTS);
}

function speedLabel(segment, medianSpeed) {
    if (!segment.durationMs || segment.durationMs <= 0) return 'steady';
    const speed = segment.length / segment.durationMs;
    if (speed > medianSpeed * 1.6) return 'swift';
    if (speed < medianSpeed * 0.6) return 'slow';
    return 'steady';
}

function curveShape(points) {
    let totalTurn = 0;
    for (let i = 2; i < points.length; i++) {
        const a = segmentAngleDegrees(points[i - 2], points[i - 1]);
        const b = segmentAngleDegrees(points[i - 1], points[i]);
        totalTurn += Math.min(Math.abs(b - a), 360 - Math.abs(b - a));
    }
    if (totalTurn < 40) return 'straight line';
    if (totalTurn < 150) return 'gentle arc';
    return 'winding curve';
}

// points: [{ x, y, t }] with x/y normalized 0-1 relative to the image.
export function analyzePath(rawPoints) {
    const points = simplifyPoints(rawPoints);
    if (points.length < 2) return null;

    const rawSegments = splitIntoSegments(points);
    const totalLength = rawSegments.reduce((sum, s) => sum + s.length, 0) || 1;

    const speeds = rawSegments
        .filter((s) => s.durationMs > 0)
        .map((s) => s.length / s.durationMs)
        .sort((a, b) => a - b);
    const medianSpeed = speeds.length
        ? speeds[Math.floor(speeds.length / 2)]
        : 1;

    const segments = rawSegments.map((segment) => ({
        direction: directionLabel(segmentAngleDegrees(segment.from, segment.to)),
        share: Math.round((segment.length / totalLength) * 100),
        speed: speedLabel(segment, medianSpeed),
    }));

    return {
        startRegion: regionName(points[0]),
        endRegion: regionName(points[points.length - 1]),
        pathCoverage: Math.min(100, Math.round(totalLength * 100)),
        curveShape: curveShape(points),
        segments,
    };
}

export function buildFallbackDirection(analysis, endMove) {
    const moves = analysis.segments.map((segment, index) => {
        const pace = segment.speed === 'steady' ? '' : `${segment.speed}ly `;
        return index === 0
            ? `${pace}${segment.direction}`
            : `then ${pace}${segment.direction}`;
    });

    const finish = endMove === 'push-in'
        ? ', finishing with a gentle push in'
        : endMove === 'pull-back'
            ? ', finishing with a slow pull back'
            : ', easing to a stop';

    return (
        `Single continuous camera move following a ${analysis.curveShape}: ` +
        `begin framing the ${analysis.startRegion}, ${moves.join(', ')}, ` +
        `arriving at the ${analysis.endRegion}${finish}. ` +
        'Smooth stabilized cinematic motion, no cuts.'
    );
}

// Splits a whole-path direction across clips when a render is chained, so
// clip 2 continues the move rather than restarting it.
function splitFallbackAcrossSegments(analysis, endMove, segmentPlan) {
    const total = segmentPlan.length;
    return segmentPlan.map((segment, index) => {
        if (total === 1) return buildFallbackDirection(analysis, endMove);

        const share = Math.floor((analysis.segments.length / total) * (index + 1));
        const slice = analysis.segments.slice(
            Math.floor((analysis.segments.length / total) * index),
            Math.max(share, 1),
        );
        const moves = (slice.length ? slice : analysis.segments)
            .map((entry) => entry.direction)
            .join(', then ');

        if (index === 0) {
            return (
                `Opening of a continuous move: begin framing the ${analysis.startRegion}, ` +
                `${moves}. Smooth stabilized cinematic motion, no cuts.`
            );
        }
        if (index === total - 1) {
            const finish =
                endMove === 'push-in'
                    ? 'finishing with a gentle push in'
                    : endMove === 'pull-back'
                      ? 'finishing with a slow pull back'
                      : 'easing to a stop';
            return (
                `Continue the same unbroken move without resetting: ${moves}, ` +
                `arriving at the ${analysis.endRegion}, ${finish}. No cuts.`
            );
        }
        return `Continue the same unbroken move without resetting: ${moves}. No cuts.`;
    });
}

/**
 * Returns { overview, segments: string[], source }. `segments` always has one
 * entry per planned clip so the caller can prompt each render independently.
 */
export async function requestCameraDirection({
    analysis,
    scene,
    durationSeconds,
    endMove,
    segmentPlan = [{ seconds: durationSeconds }],
    apiKey,
}) {
    const fallbackSegments = splitFallbackAcrossSegments(analysis, endMove, segmentPlan);
    const fallback = {
        overview: buildFallbackDirection(analysis, endMove),
        segments: fallbackSegments,
        source: 'rules',
    };

    if (typeof window === 'undefined' || !window.location?.protocol?.startsWith('http')) {
        return fallback;
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        // The AI Director bills the user's SuperbAPI account, not MuAPI.
        const superbKey =
            typeof window !== 'undefined' ? window.localStorage?.getItem('superbapi_key') : null;
        if (superbKey) headers['x-superb-key'] = superbKey;
        else if (apiKey) headers['x-superb-key'] = apiKey;

        const response = await fetch('/api/camera-path', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                analysis,
                scene,
                durationSeconds,
                endMove,
                segmentPlan: segmentPlan.map((segment, index) => ({
                    index,
                    seconds: segment.seconds,
                })),
            }),
        });
        if (!response.ok) throw new Error(`Camera direction route: ${response.status}`);

        const data = await response.json();
        const segments = Array.isArray(data?.segments) ? data.segments : [];
        if (segments.length === segmentPlan.length && segments.every(Boolean)) {
            return {
                overview: data.overview || segments[0],
                segments,
                source: 'llm',
            };
        }
        if (data?.cameraPrompt) {
            // Single-clip response shape.
            return {
                overview: data.cameraPrompt,
                segments: segmentPlan.map(() => data.cameraPrompt),
                source: 'llm',
            };
        }
        throw new Error('Empty camera direction');
    } catch (error) {
        console.warn('Camera direction LLM unavailable, using rules:', error?.message);
        return fallback;
    }
}
