import { NextResponse } from 'next/server';

// Probes what a given SuperbAPI key can ACTUALLY run, so the studios only ever
// offer models that will succeed.
//
// The probe is free: the gateway checks whether a video model is enabled
// BEFORE it authenticates or submits upstream, and only bills on a successful
// upstream submit. Posting a deliberately empty prompt therefore separates
// "not enabled" (404, cheap) from "enabled but bad request" (4xx from
// upstream, also uncharged) without ever rendering a frame.

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
const PROBE_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Everything the app knows how to drive — mirrors the gateway's enabled set.
// Each entry declares the shapes the model supports so the UI can clamp its
// controls to reality:
//   durations  — selectable clip lengths (seconds)
//   fixed      — the model renders ONE length; the client must NOT send a
//                duration param (fixed-length upstreams reject/ignore it)
//   price      — honest cost label shown in the picker (gateway retail)
//   frameExact — the model provably starts on the exact uploaded frame
//                (pixel-verified). Others get vision-ASSISTED matching.
//   image      — false when the model is TEXT-ONLY on this gateway.
//                Seedance 1.5 is frame-capable since the gateway learned
//                its first_frame_image dialect (pixel-verified) — and it
//                is the only PIXEL-EXACT i2v family here; Kling drops
//                frames upstream and relies on vision grounding.
const VIDEO_CANDIDATES = [
    { id: 'kling-2.5-720p', name: 'Kling 2.5 · 720p', durations: [5, 10], resolution: '720p', cost: 0.6, price: '$0.60 / clip' },
    { id: 'kling-2.5', name: 'Kling 2.5', durations: [5, 10], resolution: '720p', cost: 1.0, price: '$1.00 / clip' },
    { id: 'kling-2.5-1080p', name: 'Kling 2.5 · 1080p', durations: [5, 10], resolution: '1080p', cost: 1.0, price: '$1.00 / clip' },
    { id: 'doubao-seedance-1-5-pro_480p', name: 'Seedance 1.5 Pro · 480p', frameExact: true, durations: [5, 10], resolution: '480p', cost: 0.32, price: '$0.32 / clip' },
    { id: 'doubao-seedance-1-5-pro_720p', name: 'Seedance 1.5 Pro · 720p', frameExact: true, durations: [5, 10], resolution: '720p', cost: 0.7, price: '$0.70 / clip' },
    { id: 'doubao-seedance-1-5-pro_1080p', name: 'Seedance 1.5 Pro · 1080p', frameExact: true, durations: [5, 10], resolution: '1080p', cost: 1.56, price: '$1.56 / clip' },
    // Seedance 2.0 + Grok re-enabled 2026-08-01 (second pass): the earlier
    // failures were the GATEWAY's 20s submit timeout — slow video submits
    // (Seedance needs ~14s+) were aborted mid-flight. Gateway now gives video
    // submits a 120s deadline; both families re-verified there with real
    // renders. Seedance 2.0 bills PER SECOND — the price label must say so.
    { id: 'doubao-seedance-2-0-mini', name: 'Seedance 2.0 Mini', durations: [3, 5, 10], resolution: '720p', cost: 1.0, price: '$1.00 / second' },
    { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', durations: [3, 5, 10], resolution: '720p', cost: 1.61, price: '$1.61 / second' },
    { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', durations: [3, 5, 10], resolution: '720p', cost: 2.22, price: '$2.22 / second' },
    { id: 'grok-1.5-video-6s', name: 'Grok Video 1.5 · 6s', durations: [6], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'grok-video-3', name: 'Grok Video 3 · 6s', durations: [6], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'grok-video-3-10s', name: 'Grok Video 3 · 10s', durations: [10], fixed: true, resolution: '720p', cost: 0.8, price: '$0.80 / clip' },
    { id: 'kling-3.0-omni-720p-noref-mute', name: 'Kling 3.0 Omni · silent', durations: [5, 10], resolution: '720p', cost: 1.2, price: '$1.20 / clip' },
    { id: 'kling-3.0-omni-720p-noref-audio', name: 'Kling 3.0 Omni · audio', durations: [5, 10], resolution: '720p', cost: 1.6, price: '$1.60 / clip' },
    { id: 'kling-3.0-omni-720p-ref-mute', name: 'Kling 3.0 Omni · ref silent', durations: [5, 10], resolution: '720p', cost: 1.6, price: '$1.60 / clip' },
    { id: 'kling-3.0-omni-720p-ref-audio', name: 'Kling 3.0 Omni · ref audio', durations: [5, 10], resolution: '720p', cost: 2.2, price: '$2.20 / clip' },
    { id: 'kling-3.0-omni', name: 'Kling 3.0 Omni · full', durations: [5, 10], resolution: '1080p', cost: 2.0, price: '$2.00 / clip' },
    { id: 'viduq3-pro', name: 'Vidu Q3 Pro', durations: [5], fixed: true, resolution: '1080p', cost: 2.0, price: '$2.00 / clip' },
    { id: 'viduq3-turbo', name: 'Vidu Q3 Turbo', durations: [5], fixed: true, resolution: '720p', cost: 2.0, price: '$2.00 / clip' },
    { id: 'viduq2', name: 'Vidu Q2', durations: [5], fixed: true, resolution: '720p', cost: 2.0, price: '$2.00 / clip' },
    { id: 'pixverse-c1-720p-audio', name: 'PixVerse C1 · audio', durations: [5], fixed: true, resolution: '720p', cost: 0.77, price: '$0.77 / clip' },
    { id: 'pixverse-v6-720p-audio', name: 'PixVerse V6 · audio', durations: [5], fixed: true, resolution: '720p', cost: 0.71, price: '$0.71 / clip' },
    { id: 'pixverse-v6-1080p-audio', name: 'PixVerse V6 · 1080p', durations: [5], fixed: true, resolution: '1080p', cost: 1.35, price: '$1.35 / clip' },
    { id: 'veo-3-1-fast', name: 'Veo 3.1 Fast', durations: [8], fixed: true, resolution: '1080p', cost: 1.0, price: '$1.00 / clip' },
    { id: 'veo-3-1', name: 'Veo 3.1', durations: [8], fixed: true, resolution: '1080p', cost: 1.6, price: '$1.60 / clip' },
];

const IMAGE_CANDIDATES = [
    { id: 'gemini-3.1-flash-image-preview-c', name: 'Gemini 3.1 Flash Image' },
];

const cache = (globalThis.__openvidCaps ??= new Map()); // key -> { at, payload }

function superbBase() {
    return (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function probeVideoModel(apiKey, model) {
    try {
        const response = await fetch(`${superbBase()}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            // Empty prompt: never renders, never bills.
            body: JSON.stringify({ model: model.id, prompt: '' }),
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        if (response.status === 401 || response.status === 403) return false; // key can't use it

        // Only the gateway's own "not enabled" verdict counts. A 404 relayed
        // from upstream means the model IS enabled here but rejected the empty
        // probe body — treating that as disabled hid a model that renders fine.
        const text = await response.text();
        if (/not an enabled video-generation model|Model not available/i.test(text)) return false;
        return true;
    } catch {
        return false;
    }
}

export async function GET(request) {
    const apiKey = request.headers.get('x-superb-key');
    if (!apiKey || !apiKey.startsWith('sk-')) {
        return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    }

    const cached = cache.get(apiKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...cached.payload, cached: true });
    }

    const results = await Promise.all(
        VIDEO_CANDIDATES.map(async (model) => ({
            model,
            enabled: await probeVideoModel(apiKey, model),
        })),
    );

    const video = results.filter((entry) => entry.enabled).map((entry) => entry.model);
    const payload = {
        video,
        image: IMAGE_CANDIDATES,
        checkedAt: new Date().toISOString(),
        probed: VIDEO_CANDIDATES.length,
    };

    cache.set(apiKey, { at: Date.now(), payload });
    return NextResponse.json(payload);
}
