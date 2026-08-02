import { NextResponse } from 'next/server';

import { ensureSchema, getPool } from '../../../lib/accounts';

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
// Which live ids are video models. Kept as a family pattern (not a list) so
// the picker can surface a model the gateway adds before we know about it.
const VIDEO_ID_PATTERN = /(kling|seedance|vidu|pixverse|veo|grok-video|grok-[\d.]+-video|omni)/i;

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
        // NOTE: do NOT try to infer channel health here. The gateway returns
        // its generic "upstream provider is temporarily unavailable" for ANY
        // upstream rejection — including a perfectly healthy model refusing
        // this probe's empty prompt — so keying off it disabled the entire
        // catalog. Health comes from real render outcomes (degradedModels).
        return true;
    } catch {
        return false;
    }
}

// The gateway's catalog drifts (Veo's ids changed under us and every render
// came back "Unknown model"). Intersect our metadata with the LIVE list so a
// dead id can never reach the picker.
async function liveModelIds(apiKey) {
    try {
        const response = await fetch(`${superbBase()}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const data = await response.json();
        const ids = (data?.data || []).map((entry) => entry.id).filter(Boolean);
        return ids.length > 0 ? new Set(ids) : null;
    } catch {
        return null; // unreachable list — fall back to probing everything
    }
}

// Real evidence beats a synthetic probe: an empty-prompt probe fails
// validation BEFORE the upstream is consulted, so it cannot see a dead
// channel. Every render we run is recorded, so recent outcomes tell the
// truth — a model whose last attempts all died upstream is marked degraded
// and un-pickable, and un-marks itself the moment one succeeds again.
const DEGRADED_WINDOW_HOURS = 3;
const DEGRADED_MIN_FAILURES = 2;

async function degradedModels() {
    const pool = getPool();
    if (!pool) return new Set();
    try {
        await ensureSchema();
        const result = await pool.query(`
            SELECT spec_json, status, error FROM render_jobs
            WHERE created_at > now() - interval '${DEGRADED_WINDOW_HOURS} hours'
              AND status IN ('done', 'failed')
            ORDER BY created_at DESC LIMIT 400
        `);
        const stats = new Map(); // model -> { failures, succeeded }
        for (const row of result.rows) {
            let model = null;
            try { model = JSON.parse(row.spec_json).model; } catch { continue; }
            if (!model) continue;
            const entry = stats.get(model) || { failures: 0, succeeded: false };
            if (row.status === 'done') entry.succeeded = true;
            else if (/temporarily unavailable|no available (platform|channel)|Unknown model|not an enabled/i.test(row.error || '')) {
                entry.failures += 1;
            }
            stats.set(model, entry);
        }
        return new Set(
            [...stats.entries()]
                .filter(([, entry]) => !entry.succeeded && entry.failures >= DEGRADED_MIN_FAILURES)
                .map(([model]) => model),
        );
    } catch {
        return new Set();
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

    const live = await liveModelIds(apiKey);
    const knownById = new Map(VIDEO_CANDIDATES.map((model) => [model.id, model]));
    let candidates;
    if (live) {
        // Live list drives the picker. Video ids are recognised by family so a
        // brand-new model the gateway starts serving still reaches users
        // (with conservative defaults) instead of waiting on a deploy.
        candidates = [...live]
            .filter((id) => VIDEO_ID_PATTERN.test(id))
            .map((id) => knownById.get(id) || {
                id,
                name: id.replace(/^models\//, '').replace(/[-_]/g, ' '),
                durations: [5, 10],
                price: 'see superbapi.com/models',
                unverified: true,
            });
        const retired = VIDEO_CANDIDATES.filter((model) => !live.has(model.id)).map((m) => m.id);
        if (retired.length) console.warn('Capabilities: retired upstream →', retired.join(', '));
    } else {
        candidates = VIDEO_CANDIDATES; // list unreachable — fall back to ours
    }

    const [results, degraded] = await Promise.all([
        Promise.all(candidates.map(async (model) => ({
            model,
            enabled: await probeVideoModel(apiKey, model),
        }))),
        degradedModels(),
    ]);

    const video = results
        .filter((entry) => entry.enabled)
        .map((entry) => (degraded.has(entry.model.id)
            ? { ...entry.model, degraded: true }
            : entry.model))
        // Recommended, healthy models lead the list; anything whose provider
        // is currently failing sinks to the bottom.
        .sort((a, b) => (Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
            || (Number(Boolean(a.degraded)) - Number(Boolean(b.degraded))));
    const payload = {
        video,
        image: IMAGE_CANDIDATES,
        checkedAt: new Date().toISOString(),
        probed: VIDEO_CANDIDATES.length,
    };

    cache.set(apiKey, { at: Date.now(), payload });
    return NextResponse.json(payload);
}
