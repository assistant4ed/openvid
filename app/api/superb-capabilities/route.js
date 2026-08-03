import { NextResponse } from 'next/server';

import { ensureSchema, getPool } from '../../../lib/accounts';
import { VIDEO_CANDIDATES } from '../../../lib/videoModels';

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

// The catalogue itself lives in lib/videoModels.js so the job API
// validates against exactly what this route advertises.

const IMAGE_CANDIDATES = [
    { id: 'models/nano-banana-pro-preview', name: 'Nano Banana Pro', hint: 'Best at reference editing, people and product shots' },
    { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0', hint: 'Cinematic source images and realistic editing' },
    { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro', hint: 'The higher-fidelity Seedream tier' },
    { id: 'gemini-3.1-flash-image-preview-c', name: 'Gemini 3.1 Flash Image', hint: 'Fast and cheap; the long-standing default' },
    { id: 'gpt-image-2', name: 'ChatGPT Images 2.0', hint: 'Strongest at text, posters and precise layout' },
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

// Plain-language capability chips for the pickers. Derived from the verified
// facts above so the list can never drift from what the model actually does:
// audio-capable models can carry music and a spoken voiceover (they generate
// the soundtrack); no model on this gateway does video-to-video yet.
function capabilityTags(model) {
    const tags = [];
    if (model.audio === true) tags.push('sound', 'music', 'voiceover');
    if (model.audio === false) tags.push('silent');
    if (model.frames === 'literal') tags.push('image → video (exact)');
    else if (model.frames === 'described') tags.push('image → video (guided)');
    else if (model.frames === 'ignored') tags.push('text only');
    if (model.perSecond) tags.push('billed per second');
    return tags;
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
        // Auto-discovery must not duplicate a model we already describe under
        // its other spelling — the live list still advertises retired Veo ids,
        // which showed up beside our entry as a second, unusable "veo 3 1".
        const canonical = (id) => String(id).toLowerCase()
            .replace(/^models\//, '')
            .replace(/-(generate|preview|generate-preview)$/g, '')
            .replace(/[^a-z0-9]/g, '');
        const knownKeys = new Set(VIDEO_CANDIDATES.map((model) => canonical(model.id)));
        candidates = [...live]
            .filter((id) => VIDEO_ID_PATTERN.test(id))
            .filter((id) => knownById.has(id) || !knownKeys.has(canonical(id)))
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

    const image = live
        ? IMAGE_CANDIDATES.filter((model) => live.has(model.id))
        : IMAGE_CANDIDATES;

    const video = results
        .filter((entry) => entry.enabled)
        .map((entry) => ({
            ...entry.model,
            capabilities: capabilityTags(entry.model),
            ...(degraded.has(entry.model.id) ? { degraded: true } : {}),
        }))
        // Recommended, healthy models lead the list; anything whose provider
        // is currently failing sinks to the bottom.
        .sort((a, b) => (Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
            || (Number(Boolean(a.degraded)) - Number(Boolean(b.degraded))));
    const payload = {
        video,
        image,
        checkedAt: new Date().toISOString(),
        probed: VIDEO_CANDIDATES.length,
    };

    cache.set(apiKey, { at: Date.now(), payload });
    return NextResponse.json(payload);
}
