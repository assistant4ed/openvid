// Curated image-to-video models for Camera Path, plus the clip-chaining rules
// that let a render exceed a single model's maximum clip length.
//
// Chaining uses MuAPI's native "extend" endpoints: an extend call takes the
// request_id of a previous generation and continues from its last frame. Only
// families that expose an extend endpoint can be chained — everything else is
// honestly capped at its single-clip maximum rather than pretending.

import {
    getDurationsForI2VModel,
    getI2VModelById,
    getResolutionsForI2VModel,
} from "../models.js";

// `sendsDuration` mirrors the endpoint's own schema — veo3.1-extend-video
// declares only request_id and prompt, so posting a duration would be rejected.
const SEEDANCE_2_EXTEND = {
    model: "seedance-2-extend",
    durations: [5, 10, 15],
    sendsDuration: true,
};
const VEO_31_EXTEND = {
    model: "veo3.1-extend-video",
    durations: [8],
    sendsDuration: false,
};

// Ordered best-first. `extend` is omitted for families with no extend endpoint.
const CATALOG = [
    {
        id: "seedance-2-i2v",
        name: "Seedance 2.0",
        vendor: "ByteDance",
        blurb: "Best all-round motion + native long-form chaining",
        extend: SEEDANCE_2_EXTEND,
        recommended: true,
    },
    {
        id: "seedance-2-image-to-video",
        name: "Seedance 2.0 Standard",
        vendor: "ByteDance",
        blurb: "Cheaper Seedance 2.0 tier, still chainable",
        extend: SEEDANCE_2_EXTEND,
    },
    {
        id: "seedance-2.5-image-to-video",
        name: "Seedance 2.5",
        vendor: "ByteDance",
        blurb: "Newest Seedance, up to 4K",
    },
    {
        id: "veo3.1-image-to-video",
        name: "Veo 3.1",
        vendor: "Google",
        blurb: "Top-tier realism with native audio",
        extend: VEO_31_EXTEND,
    },
    {
        id: "veo3.1-fast-image-to-video",
        name: "Veo 3.1 Fast",
        vendor: "Google",
        blurb: "Faster, cheaper Veo 3.1",
        extend: VEO_31_EXTEND,
    },
    {
        id: "kling-v2.6-pro-i2v",
        name: "Kling 2.6 Pro",
        vendor: "Kuaishou",
        blurb: "Excellent physics and character stability",
    },
    {
        id: "kling-v2.5-turbo-pro-i2v",
        name: "Kling 2.5 Turbo Pro",
        vendor: "Kuaishou",
        blurb: "Fast, reliable, strong prompt adherence",
    },
    {
        id: "kling-o1-image-to-video",
        name: "Kling O1",
        vendor: "Kuaishou",
        blurb: "Reasoning-driven shot construction",
    },
    {
        id: "wan2.6-image-to-video",
        name: "Wan 2.6",
        vendor: "Alibaba",
        blurb: "Long single clips up to 15s",
    },
    {
        id: "wan2.5-image-to-video",
        name: "Wan 2.5",
        vendor: "Alibaba",
        blurb: "Balanced quality and speed",
    },
    {
        id: "ltx-2-pro-image-to-video",
        name: "LTX 2 Pro",
        vendor: "Lightricks",
        blurb: "Fast turnaround, 6-10s clips",
    },
    {
        id: "minimax-hailuo-2.3-pro-i2v",
        name: "Hailuo 2.3 Pro",
        vendor: "MiniMax",
        blurb: "Expressive, stylised motion",
    },
];

const DEFAULT_CLIP_SECONDS = 5;

function clipDurations(modelId) {
    const durations = getDurationsForI2VModel(modelId);
    if (durations.length > 0) return [...durations].sort((a, b) => a - b);
    return [DEFAULT_CLIP_SECONDS];
}

// Models present in this build of models.js, enriched with runtime capabilities.
export const CAMERA_PATH_MODELS = CATALOG.filter((entry) => getI2VModelById(entry.id)).map(
    (entry) => {
        const durations = clipDurations(entry.id);
        const maxClip = durations[durations.length - 1];
        const extendStep = entry.extend
            ? Math.max(...entry.extend.durations)
            : 0;
        return {
            ...entry,
            durations,
            maxClipSeconds: maxClip,
            resolutions: getResolutionsForI2VModel(entry.id),
            canChain: Boolean(entry.extend),
            extendStepSeconds: extendStep,
        };
    },
);

export function getCameraPathModel(modelId) {
    return CAMERA_PATH_MODELS.find((entry) => entry.id === modelId) || null;
}

// Hard ceiling so a stray click can't queue a 40-clip render.
export const MAX_CHAINED_CLIPS = 6;

export function maxTotalSeconds(modelId) {
    const model = getCameraPathModel(modelId);
    if (!model) return DEFAULT_CLIP_SECONDS;
    if (!model.canChain) return model.maxClipSeconds;
    return model.maxClipSeconds + model.extendStepSeconds * (MAX_CHAINED_CLIPS - 1);
}

// Every total the model can actually hit, so the picker never offers a
// duration that the API would reject.
export function availableTotals(modelId) {
    const model = getCameraPathModel(modelId);
    if (!model) return [DEFAULT_CLIP_SECONDS];

    if (!model.canChain) return model.durations;

    const totals = new Set(model.durations);
    const extendSteps = model.extend.durations;
    let frontier = [...model.durations];

    for (let clip = 1; clip < MAX_CHAINED_CLIPS; clip++) {
        const next = [];
        for (const base of frontier) {
            for (const step of extendSteps) {
                const total = base + step;
                if (!totals.has(total)) {
                    totals.add(total);
                    next.push(total);
                } else if (!next.includes(total)) {
                    next.push(total);
                }
            }
        }
        frontier = next;
    }

    return [...totals].sort((a, b) => a - b);
}

/**
 * Break a target duration into concrete clips: one base i2v generation
 * followed by extend calls. Greedy longest-first, which minimises the number
 * of API round-trips (each clip is a separate paid render).
 */
export function planSegments(modelId, targetSeconds) {
    const model = getCameraPathModel(modelId);
    if (!model) return [];

    const base = [...model.durations]
        .filter((seconds) => seconds <= targetSeconds)
        .sort((a, b) => b - a)[0] ?? model.durations[0];

    const segments = [{ index: 0, kind: "base", seconds: base }];
    if (!model.canChain) return segments;

    const steps = [...model.extend.durations].sort((a, b) => b - a);
    let total = base;

    while (total < targetSeconds && segments.length < MAX_CHAINED_CLIPS) {
        const remaining = targetSeconds - total;
        const step = steps.find((value) => value <= remaining) ?? steps[steps.length - 1];
        segments.push({ index: segments.length, kind: "extend", seconds: step });
        total += step;
    }

    return segments;
}

export function totalPlannedSeconds(segments) {
    return segments.reduce((sum, segment) => sum + segment.seconds, 0);
}
