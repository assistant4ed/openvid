import { NextResponse } from 'next/server';

// Converts a hand-drawn camera path (structured summary, never raw pixels)
// into cinematic camera-movement language via an OpenAI-compatible LLM
// gateway. The key lives server-side only; the browser never sees it.
//
// When a render is chained into several clips, one call returns one direction
// per clip so clip N continues the move instead of restarting it.

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';
// Reasoning models can think for a while on multi-clip JSON plans.
const LLM_TIMEOUT_MS = 45000;
const MAX_SEGMENTS = 12;
const MAX_PLAN_CLIPS = 8;
const MAX_SCENE_CHARS = 2000;

// The AI Director runs on SuperbAPI credits. Callers authenticate with their
// OWN SuperbAPI key (x-superb-key): it is validated against /v1/key and then
// used as the Bearer for the LLM call itself, so each user spends their own
// credits. The server-side SUPERBAPI_KEY env var is only a fallback for
// local/self-hosted setups that skip per-user keys.
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

const verifiedKeys = new Map(); // key -> expiry timestamp
const requestCounts = new Map(); // key -> { count, windowStart }

function superbBaseUrl() {
    return (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function requiresCallerKey() {
    if (process.env.CAMERA_PATH_REQUIRE_KEY === 'true') return true;
    if (process.env.CAMERA_PATH_REQUIRE_KEY === 'false') return false;
    return process.env.NODE_ENV === 'production';
}

async function isCallerKeyValid(callerKey) {
    const cached = verifiedKeys.get(callerKey);
    if (cached && cached > Date.now()) return true;

    try {
        const response = await fetch(`${superbBaseUrl()}/key`, {
            headers: { Authorization: `Bearer ${callerKey}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return false;
        verifiedKeys.set(callerKey, Date.now() + KEY_CACHE_TTL_MS);
        return true;
    } catch (error) {
        console.error('Caller key validation failed:', error?.message);
        return false;
    }
}

function isRateLimited(identity) {
    const now = Date.now();
    const entry = requestCounts.get(identity);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        requestCounts.set(identity, { count: 1, windowStart: now });
        return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
}

const SYSTEM_PROMPT = [
    'You are a film director translating a hand-drawn camera path into camera',
    'directions for an AI image-to-video generator.',
    'The user drew a line over the start frame; the camera must travel along it.',
    'You receive structured path data: ordered segments with screen-space',
    'direction, share of the total path length, and speed, plus start/end',
    'frame regions, overall curve shape, and an optional finishing move.',
    'You also receive a clip plan. The final video is rendered as that many',
    'clips, each continuing the previous one from its last frame.',
    'Return STRICT JSON, no markdown fences, shaped exactly:',
    '{"overview":"...","segments":[{"index":0,"direction":"..."}]}',
    'Emit exactly one segments entry per clip in the plan, in order.',
    'Each direction is 25-55 words of professional cinematography',
    '(track, dolly, pan, tilt, crane, arc, push in, pull back, ease out)',
    'covering only that clip\'s slice of the path, at that clip\'s pacing.',
    'Clips after the first MUST read as an unbroken continuation — never',
    'restart, re-establish, or cut. Describe ONLY camera motion; never invent',
    'scene content, characters, or edits.',
].join(' ');

function badRequest(message) {
    return NextResponse.json({ error: message }, { status: 400 });
}

function validateBody(body) {
    if (!body || typeof body !== 'object') return 'Missing request body';
    const { analysis, scene, segmentPlan } = body;
    if (!analysis || !Array.isArray(analysis.segments) || analysis.segments.length === 0) {
        return 'Missing path analysis';
    }
    if (analysis.segments.length > MAX_SEGMENTS) return 'Too many path segments';
    if (segmentPlan && (!Array.isArray(segmentPlan) || segmentPlan.length > MAX_PLAN_CLIPS)) {
        return 'Invalid clip plan';
    }
    if (scene && (typeof scene !== 'string' || scene.length > MAX_SCENE_CHARS)) {
        return 'Scene description too long';
    }
    return null;
}

// Models sometimes wrap JSON in fences despite instructions.
function parseDirections(rawContent, expectedCount) {
    const cleaned = rawContent
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        const segments = Array.isArray(parsed?.segments)
            ? parsed.segments
                  .slice()
                  .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
                  .map((entry) => (typeof entry === 'string' ? entry : entry?.direction))
                  .filter((entry) => typeof entry === 'string' && entry.trim())
            : [];

        if (segments.length === expectedCount) {
            return { overview: parsed.overview || segments[0], segments };
        }
        // Right JSON, wrong arity — reuse what we got rather than failing.
        if (segments.length > 0) {
            const padded = Array.from(
                { length: expectedCount },
                (_, index) => segments[Math.min(index, segments.length - 1)],
            );
            return { overview: parsed.overview || segments[0], segments: padded };
        }
        if (typeof parsed?.overview === 'string' && parsed.overview.trim()) {
            return {
                overview: parsed.overview,
                segments: Array.from({ length: expectedCount }, () => parsed.overview),
            };
        }
        return null;
    } catch {
        // Not JSON at all — treat the whole reply as a single direction.
        if (!cleaned) return null;
        return {
            overview: cleaned,
            segments: Array.from({ length: expectedCount }, () => cleaned),
        };
    }
}

export async function POST(request) {
    const callerKey = request.headers.get('x-superb-key');

    if (requiresCallerKey()) {
        if (!callerKey) {
            return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
        }
        if (isRateLimited(callerKey)) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
        if (!(await isCallerKeyValid(callerKey))) {
            return NextResponse.json({ error: 'Invalid SuperbAPI key' }, { status: 401 });
        }
    }

    // Prefer the caller's own key (their credits); env key is the fallback.
    const apiKey = callerKey || process.env.SUPERBAPI_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Camera direction LLM is not configured' }, { status: 503 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return badRequest('Invalid JSON body');
    }

    const validationError = validateBody(body);
    if (validationError) return badRequest(validationError);

    const baseUrl = (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = process.env.SUPERBAPI_MODEL || DEFAULT_MODEL;
    const segmentPlan =
        Array.isArray(body.segmentPlan) && body.segmentPlan.length > 0
            ? body.segmentPlan
            : [{ index: 0, seconds: body.durationSeconds || 5 }];

    const userContent = JSON.stringify({
        camera_path: body.analysis,
        scene_hint: body.scene || null,
        finishing_move: body.endMove || 'none',
        clip_plan: segmentPlan,
        total_seconds: segmentPlan.reduce((sum, clip) => sum + (clip.seconds || 0), 0),
    });

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                // Generous budget: reasoning models (Gemini 3.x, Claude with
                // thinking) spend part of max_tokens on hidden thought tokens.
                max_tokens: 2000,
                temperature: 0.4,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userContent },
                ],
            }),
            signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });

        if (!response.ok) {
            const detail = await response.text();
            console.error('Camera path LLM error:', response.status, detail.slice(0, 200));
            return NextResponse.json({ error: 'Camera direction service failed' }, { status: 502 });
        }

        const data = await response.json();
        const rawContent = data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            return NextResponse.json({ error: 'Empty camera direction' }, { status: 502 });
        }

        const directions = parseDirections(rawContent, segmentPlan.length);
        if (!directions) {
            return NextResponse.json({ error: 'Unusable camera direction' }, { status: 502 });
        }

        return NextResponse.json({
            overview: directions.overview,
            segments: directions.segments,
            cameraPrompt: directions.overview,
        });
    } catch (error) {
        console.error('Camera path LLM exception:', error?.message || error);
        return NextResponse.json({ error: 'Camera direction service unreachable' }, { status: 502 });
    }
}
