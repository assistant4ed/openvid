// The single source of truth for what each video model accepts. Both the
// capabilities probe (what the picker offers) and the job API (what may be
// submitted) read this, so the UI and the server can never disagree about a
// model's limits — the disagreement is what let a 3-second Seedance 2.0
// request become a job that could only ever fail.

const VIDEO_CANDIDATES = [
    { id: 'kling-2.5-720p', name: 'Kling 2.5 · 720p', durations: [5, 10], resolution: '720p', cost: 0.6, shape: '16:9 · 1280x720', audio: false, frames: 'described', price: '$0.60 / clip' },
    { id: 'kling-2.5', name: 'Kling 2.5', durations: [5, 10], resolution: '720p', cost: 1.0, shape: '16:9', audio: false, frames: 'described', price: '$1.00 / clip' },
    { id: 'kling-2.5-1080p', name: 'Kling 2.5 · 1080p', durations: [5, 10], resolution: '1080p', cost: 1.0, shape: '16:9', audio: false, frames: 'described', price: '$1.00 / clip' },
    { id: 'doubao-seedance-1-5-pro_480p', name: 'Seedance 1.5 Pro · 480p', frameExact: true, durations: [5, 10], resolution: '480p', cost: 0.32, shape: 'wide · varies', audio: true, frames: 'literal', price: '$0.32 / clip' },
    { id: 'doubao-seedance-1-5-pro_720p', name: 'Seedance 1.5 Pro · 720p', frameExact: true, durations: [5, 10], resolution: '720p', cost: 0.7, shape: 'ultrawide · varies', audio: true, frames: 'literal', recommended: true, price: '$0.70 / clip' },
    { id: 'doubao-seedance-1-5-pro_1080p', name: 'Seedance 1.5 Pro · 1080p', frameExact: true, durations: [5, 10], resolution: '1080p', cost: 1.56, shape: 'wide · varies', audio: true, frames: 'literal', price: '$1.56 / clip' },
    // Seedance 2.0 + Grok re-enabled 2026-08-01 (second pass): the earlier
    // failures were the GATEWAY's 20s submit timeout — slow video submits
    // (Seedance needs ~14s+) were aborted mid-flight. Gateway now gives video
    // submits a 120s deadline; both families re-verified there with real
    // renders. Seedance 2.0 bills PER SECOND — the price label must say so.
    { id: 'doubao-seedance-2-0-mini', name: 'Seedance 2.0 Mini', cost: 1.0, recommended: true, perSecond: true, durations: [4, 5, 8, 10, 12], resolution: '720p', price: '$1.00 / second' },
    { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', cost: 1.61, recommended: true, perSecond: true, durations: [4, 5, 8, 10, 12], resolution: '720p', price: '$1.61 / second' },
    { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', cost: 2.22, recommended: true, perSecond: true, durations: [4, 5, 8, 10, 12], resolution: '720p', price: '$2.22 / second' },
    { id: 'grok-1.5-video-6s', name: 'Grok Video 1.5 · 6s', durations: [6], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'grok-video-3', name: 'Grok Video 3 · 6s', durations: [6], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'grok-video-3-10s', name: 'Grok Video 3 · 10s', durations: [10], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'kling-3.0-omni-720p-noref-mute', name: 'Kling 3.0 Omni · silent', durations: [5, 10], resolution: '720p', cost: 1.2, shape: '16:9 · 1280x720', frames: 'described', price: '$1.20 / clip' },
    { id: 'kling-3.0-omni-720p-noref-audio', name: 'Kling 3.0 Omni · audio', durations: [5, 10], resolution: '720p', cost: 1.6, shape: '16:9', audio: true, frames: 'described', recommended: true, price: '$1.60 / clip' },
    { id: 'kling-3.0-omni-720p-ref-mute', name: 'Kling 3.0 Omni · ref silent', durations: [5, 10], resolution: '720p', cost: 1.6, shape: '16:9 · 1280x720', frames: 'described', price: '$1.60 / clip' },
    { id: 'kling-3.0-omni-720p-ref-audio', name: 'Kling 3.0 Omni · ref audio', durations: [5, 10], resolution: '720p', cost: 2.2, shape: '16:9', audio: true, frames: 'described', price: '$2.20 / clip' },
    { id: 'kling-3.0-omni', name: 'Kling 3.0 Omni · full', durations: [5, 10], resolution: '1080p', cost: 2.0, shape: '16:9', frames: 'described', price: '$2.00 / clip' },
    { id: 'viduq3-pro', name: 'Vidu Q3 Pro', durations: [5], fixed: true, resolution: '1080p', cost: 2.0, shape: '16:9', frames: 'literal', price: '$2.00 / clip' },
    { id: 'viduq3-turbo', name: 'Vidu Q3 Turbo', durations: [5], fixed: true, resolution: '720p', cost: 2.0, shape: '16:9 · 1284x716', frames: 'literal', recommended: true, price: '$2.00 / clip' },
    { id: 'viduq2', name: 'Vidu Q2', durations: [5], fixed: true, resolution: '720p', cost: 2.0, shape: '16:9', frames: 'literal', price: '$2.00 / clip' },
    { id: 'pixverse-c1-720p-audio', name: 'PixVerse C1 · audio', durations: [5], fixed: true, resolution: '720p', cost: 0.77, shape: '9:16 · 720x1280', audio: true, frames: 'ignored', price: '$0.77 / clip' },
    { id: 'pixverse-v6-720p-audio', name: 'PixVerse V6 · audio', durations: [5], fixed: true, resolution: '720p', cost: 0.71, shape: '9:16 · 720x1280', audio: true, frames: 'ignored', price: '$0.71 / clip' },
    { id: 'pixverse-v6-1080p-audio', name: 'PixVerse V6 · 1080p', durations: [5], fixed: true, resolution: '1080p', cost: 1.35, shape: '9:16 portrait', audio: true, frames: 'ignored', price: '$1.35 / clip' },
    { id: 'models/veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', durations: [8], fixed: true, resolution: '1080p', cost: 1.0, price: '$1.00 / clip' },
    { id: 'models/veo-3.1-generate-preview', name: 'Veo 3.1', durations: [8], fixed: true, resolution: '1080p', cost: 1.6, price: '$1.60 / clip' },
];

export function findVideoModel(id) {
    return VIDEO_CANDIDATES.find((model) => model.id === id) || null;
}

// Returns a human-readable reason the spec cannot render, or null when fine.
// Mirrors the gateway's own rules so the user is told BEFORE a job is created
// and before anything is charged.
export function validateVideoSpec({ model, duration }) {
    const entry = findVideoModel(model);
    if (!entry) return null; // unknown to us — let the gateway decide
    if (duration === null || duration === undefined) return null;
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) return 'Duration must be a positive number of seconds.';
    if (entry.fixed) return null; // the client omits duration for these
    if (Array.isArray(entry.durations) && entry.durations.length > 0 && !entry.durations.includes(seconds)) {
        const allowed = entry.durations.join(', ');
        return `${entry.name} renders ${allowed} second clips — ${seconds}s is not available.`;
    }
    return null;
}

export { VIDEO_CANDIDATES };
