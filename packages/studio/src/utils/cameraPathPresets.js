// Ready-made camera moves. Picking a preset draws its path onto the frame,
// so a user gets a professional move in one click and can still drag their
// own line for anything bespoke.

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Samples a parametric path into the {x, y, t} points analyzePath expects.
 * Position advances linearly in `u`; time advances via `timing`, so an
 * ease-in timing curve reads back as "starts slow, ends swift".
 */
function samplePath(shape, { steps = 48, totalMs = 900, timing = (u) => u } = {}) {
    const points = [];
    for (let index = 0; index <= steps; index++) {
        const u = index / steps;
        const { x, y } = shape(u);
        points.push({ x: clamp01(x), y: clamp01(y), t: timing(u) * totalMs });
    }
    return points;
}

const linear = (u) => u;
const easeIn = (u) => u * u; // slow start, fast finish
const easeOut = (u) => 1 - (1 - u) * (1 - u); // fast start, slow finish

const line = (from, to) => (u) => ({
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u,
});

const arc = (from, to, bow) => (u) => {
    const base = line(from, to)(u);
    const lift = Math.sin(u * Math.PI) * bow;
    return { x: base.x, y: base.y - lift };
};

const orbit = (turns, radius, center) => (u) => ({
    x: center.x + Math.cos(u * Math.PI * 2 * turns - Math.PI / 2) * radius,
    y: center.y + Math.sin(u * Math.PI * 2 * turns - Math.PI / 2) * radius * 0.45,
});

const serpentine = (from, to, waves, amplitude) => (u) => {
    const base = line(from, to)(u);
    return { x: base.x, y: base.y + Math.sin(u * Math.PI * waves) * amplitude };
};

export const CAMERA_PATH_PRESETS = [
    {
        id: "dolly-in",
        label: "Dolly In",
        group: "Push",
        endMove: "push-in",
        hint: "Glide toward the subject",
        build: () => samplePath(line({ x: 0.5, y: 0.78 }, { x: 0.5, y: 0.5 }), { timing: easeOut }),
    },
    {
        id: "pull-back",
        label: "Pull Back",
        group: "Push",
        endMove: "pull-back",
        hint: "Reveal the wider scene",
        build: () => samplePath(line({ x: 0.5, y: 0.45 }, { x: 0.5, y: 0.8 }), { timing: easeOut }),
    },
    {
        id: "crash-zoom",
        label: "Crash Zoom",
        group: "Push",
        endMove: "push-in",
        hint: "Snap hard into frame",
        build: () =>
            samplePath(line({ x: 0.5, y: 0.85 }, { x: 0.5, y: 0.46 }), {
                totalMs: 420,
                timing: easeIn,
            }),
    },
    {
        id: "pan-right",
        label: "Pan Right",
        group: "Lateral",
        endMove: "none",
        hint: "Sweep across to the right",
        build: () => samplePath(line({ x: 0.12, y: 0.5 }, { x: 0.88, y: 0.5 })),
    },
    {
        id: "pan-left",
        label: "Pan Left",
        group: "Lateral",
        endMove: "none",
        hint: "Sweep across to the left",
        build: () => samplePath(line({ x: 0.88, y: 0.5 }, { x: 0.12, y: 0.5 })),
    },
    {
        id: "whip-pan",
        label: "Whip Pan",
        group: "Lateral",
        endMove: "none",
        hint: "Violent fast horizontal snap",
        build: () =>
            samplePath(line({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }), {
                totalMs: 300,
                timing: easeIn,
            }),
    },
    {
        id: "crane-up",
        label: "Crane Up",
        group: "Vertical",
        endMove: "none",
        hint: "Rise above the scene",
        build: () => samplePath(line({ x: 0.5, y: 0.85 }, { x: 0.5, y: 0.12 }), { timing: easeOut }),
    },
    {
        id: "crane-down",
        label: "Crane Down",
        group: "Vertical",
        endMove: "none",
        hint: "Descend into the scene",
        build: () => samplePath(line({ x: 0.5, y: 0.12 }, { x: 0.5, y: 0.85 }), { timing: easeOut }),
    },
    {
        id: "arc-right",
        label: "Arc Right",
        group: "Orbit",
        endMove: "none",
        hint: "Curved travel around the subject",
        build: () => samplePath(arc({ x: 0.12, y: 0.62 }, { x: 0.88, y: 0.62 }, 0.22)),
    },
    {
        id: "orbit-360",
        label: "360 Orbit",
        group: "Orbit",
        endMove: "none",
        hint: "Full circle around the subject",
        build: () => samplePath(orbit(1, 0.32, { x: 0.5, y: 0.5 }), { steps: 64, totalMs: 1400 }),
    },
    {
        id: "bullet-time",
        label: "Bullet Time",
        group: "Orbit",
        endMove: "push-in",
        hint: "Slow orbit, frozen moment",
        build: () =>
            samplePath(orbit(0.6, 0.34, { x: 0.5, y: 0.5 }), {
                steps: 64,
                totalMs: 2200,
                timing: linear,
            }),
    },
    {
        id: "aerial-pullback",
        label: "Aerial Pullback",
        group: "Drone",
        endMove: "pull-back",
        hint: "Lift up and away",
        build: () => samplePath(arc({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.14 }, 0.14), { timing: easeOut }),
    },
    {
        id: "fpv-drone",
        label: "FPV Drone",
        group: "Drone",
        endMove: "push-in",
        hint: "Weaving first-person flight",
        build: () =>
            samplePath(serpentine({ x: 0.1, y: 0.7 }, { x: 0.9, y: 0.35 }, 3, 0.12), {
                steps: 64,
                totalMs: 1100,
                timing: easeIn,
            }),
    },
    {
        id: "rise-and-reveal",
        label: "Rise & Reveal",
        group: "Drone",
        endMove: "none",
        hint: "Track across, then crane up",
        build: () => [
            ...samplePath(line({ x: 0.12, y: 0.8 }, { x: 0.6, y: 0.8 }), {
                steps: 24,
                totalMs: 500,
            }),
            ...samplePath(line({ x: 0.6, y: 0.8 }, { x: 0.6, y: 0.18 }), {
                steps: 24,
                totalMs: 600,
            }).map((point) => ({ ...point, t: point.t + 520 })),
        ],
    },
];

export const PRESET_GROUPS = [...new Set(CAMERA_PATH_PRESETS.map((preset) => preset.group))];

export function getPreset(presetId) {
    return CAMERA_PATH_PRESETS.find((preset) => preset.id === presetId) || null;
}

// Compact preview geometry (viewBox 0 0 100 100) for the preset card.
// Direction matters: without a start dot and an arrowhead, "Dolly In" and
// "Pull Back" draw the identical line.
export function presetPreviewGeometry(preset) {
    const sampled = preset.build();
    const thinned = sampled.filter(
        (_, index) => index % 3 === 0 || index === sampled.length - 1,
    );

    const start = thinned[0];
    const end = thinned[thinned.length - 1];
    const beforeEnd = thinned[Math.max(0, thinned.length - 2)];

    // Arrowhead orientation, in SVG degrees (y grows downward).
    const angle =
        (Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x) * 180) / Math.PI;

    return {
        points: thinned
            .map((point) => `${(point.x * 100).toFixed(1)},${(point.y * 100).toFixed(1)}`)
            .join(" "),
        start: { x: start.x * 100, y: start.y * 100 },
        end: { x: end.x * 100, y: end.y * 100 },
        angle,
    };
}
