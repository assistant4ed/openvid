// Server-side render pipeline. The browser only CREATES a job — everything
// that used to die on reload (vision grounding, the upstream submit, polling,
// result storage) runs here, in the long-lived server process, backed by
// Postgres. A job is safe the moment POST /api/jobs returns.
//
// Lifecycle: queued → submitted → done | failed
//   queued     spec captured; grounding + upstream submit still to run
//   submitted  upstream task id known; ticker polls until the render ends
//   done       video downloaded into the durable asset store (provider URLs
//              expire — ours don't)
// A ticker also rescues 'queued' jobs older than a minute, which is what
// makes the pipeline survive deploys and container restarts.

import crypto from 'node:crypto';

import { putAsset } from '../app/api/asset/store';
import { ensureSchema, getPool } from './accounts';

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
const SUBMIT_TIMEOUT_MS = 60000;
const AGENT_TIMEOUT_MS = 90000;
const POLL_TIMEOUT_MS = 25000;
const TICK_MS = 15000;
const MAX_POLL_MINUTES = 20;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const RESCUE_QUEUED_AFTER_MS = 60 * 1000;
// Upstream providers blip: a submit that fails with "temporarily
// unavailable" usually succeeds moments later. Absorb those silently instead
// of handing the user a red card for something that fixes itself.
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [8000, 25000];

function isProviderOutOfCredit(message) {
    return /预扣费额度|额度不足|剩余额度|insufficient_user_quota|out of credit|provider_account_out_of_credit/i
        .test(String(message || ''));
}

function isTransientUpstream(message) {
    // An exhausted provider wallet looks transient but can never succeed —
    // retrying it just delays the truth by three attempts.
    if (isProviderOutOfCredit(message)) return false;
    return /temporarily unavailable|no available (platform|channel)|rate limit|429|timeout|timed out|ECONNRESET|socket hang up|502|503|504/i
        .test(String(message || ''));
}

let jobSchemaReady = null;

function superbBase() {
    return (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function selfBase() {
    return `http://127.0.0.1:${process.env.PORT || 8080}`;
}

export function hashKey(apiKey) {
    return crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 32);
}

async function db() {
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    if (!jobSchemaReady) {
        jobSchemaReady = pool.query(`
            CREATE TABLE IF NOT EXISTS render_jobs (
                id TEXT PRIMARY KEY,
                user_id BIGINT,
                key_hash TEXT NOT NULL,
                superb_key TEXT,
                spec_json TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'video',
                status TEXT NOT NULL DEFAULT 'queued',
                upstream_task_id TEXT,
                video_url TEXT,
                error TEXT,
                vision_used BOOLEAN,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_render_jobs_key_hash ON render_jobs (key_hash, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs (status);
            ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'video';
            ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC;
            ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
        `);
    }
    await jobSchemaReady;
    return pool;
}

export function publicJob(row) {
    return {
        id: row.id,
        kind: row.kind || 'video',
        status: row.status,
        videoUrl: row.video_url || null,
        error: row.error || null,
        visionUsed: row.vision_used ?? null,
        // The gateway's own figure for what this submit actually cost — the
        // UI reconciles its estimate against this rather than guessing.
        costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
        createdAt: row.created_at,
        spec: safeSpec(row.spec_json),
    };
}

function safeSpec(specJson) {
    try {
        const spec = JSON.parse(specJson);
        return {
            prompt: spec.prompt,
            model: spec.model,
            duration: spec.duration ?? null,
            aspect_ratio: spec.aspect_ratio ?? null,
            hasStart: Boolean(spec.image_url),
            hasEnd: Boolean(spec.end_image_url),
            // Our own hosted asset URLs (already key-gated) — the client uses
            // them to put the uploaded frames back on the chips on restore.
            image_url: spec.image_url || null,
            end_image_url: spec.end_image_url || null,
            ref_urls: Array.isArray(spec.ref_urls) ? spec.ref_urls : [],
        };
    } catch {
        return null;
    }
}

export async function createJob({ apiKey, userId, spec, kind = 'video' }) {
    const pool = await db();
    if (!pool) throw Object.assign(new Error('Job pipeline needs the database'), { statusCode: 503 });
    const id = `job_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
        `INSERT INTO render_jobs (id, user_id, key_hash, superb_key, spec_json, kind) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId || null, hashKey(apiKey), apiKey, JSON.stringify(spec), kind],
    );
    // Fire-and-forget: the response must not wait for grounding/submit. The
    // ticker rescues this job if the process dies mid-flight.
    processQueuedJob(id).catch((error) => console.error('Job process error:', id, error?.message));
    ensureTicker();
    return id;
}

export async function listJobs({ apiKey, userId, limit = 50 }) {
    const pool = await db();
    if (!pool) return [];
    const result = await pool.query(
        `SELECT * FROM render_jobs WHERE key_hash = $1 OR (user_id IS NOT NULL AND user_id = $2)
         ORDER BY created_at DESC LIMIT $3`,
        [hashKey(apiKey), userId || -1, Math.min(Number(limit) || 50, 100)],
    );
    return result.rows.map(publicJob);
}

export async function getJob(id, apiKey) {
    const pool = await db();
    if (!pool) return null;
    const result = await pool.query(
        `SELECT * FROM render_jobs WHERE id = $1 AND key_hash = $2`,
        [id, hashKey(apiKey)],
    );
    return result.rows[0] ? publicJob(result.rows[0]) : null;
}

async function setJob(id, patch) {
    const pool = await db();
    if (!pool) return;
    const keys = Object.keys(patch);
    const sets = keys.map((key, index) => `${key} = $${index + 2}`).join(', ');
    await pool.query(
        `UPDATE render_jobs SET ${sets}, updated_at = now() WHERE id = $1`,
        [id, ...keys.map((key) => patch[key])],
    );
}

// ── Grounding: same vision path the browser used, now reload-proof ──────────

async function assetToDataUrl(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`asset fetch ${response.status}`);
    const mime = response.headers.get('content-type') || 'image/jpeg';
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function groundPrompt(spec, apiKey, kind = 'video') {
    // Fetched data URLs ride along in every return — image jobs need the
    // actual reference pixels for the render call, not just the prompt.
    const images = [];
    try {
        if (spec.image_url) images.push({ role: 'start', data: await assetToDataUrl(spec.image_url) });
        if (spec.end_image_url) images.push({ role: 'end', data: await assetToDataUrl(spec.end_image_url) });
        for (const ref of Array.isArray(spec.ref_urls) ? spec.ref_urls.slice(0, 2) : []) {
            images.push({ role: 'ref', data: await assetToDataUrl(ref) });
        }
    } catch {
        // A missing asset never blocks the render — degrade to text.
    }
    // A long prompt means the user already wrote their own brief — but when
    // frames are attached the vision pass is the ONLY way their pixels reach
    // the model, so never skip grounding in that case.
    if (String(spec.prompt || '').length > 350 && images.length === 0) {
        return { prompt: spec.prompt, visionUsed: false, images };
    }
    try {
        const mode = kind === 'image'
            ? (images.length > 0 ? 'i2i' : 't2i')
            : (images.length > 0 ? 'i2v' : 't2v');
        const response = await fetch(`${selfBase()}/api/prompt-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': apiKey },
            body: JSON.stringify({ prompt: spec.prompt, mode, images }),
            signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
        });
        if (!response.ok) return { prompt: spec.prompt, visionUsed: false, images };
        const data = await response.json();
        return {
            prompt: data.expandedPrompt || spec.prompt,
            visionUsed: images.length > 0 ? data.visionUsed === true : null,
            images,
        };
    } catch {
        return { prompt: spec.prompt, visionUsed: false, images };
    }
}

// Image jobs render synchronously against the gateway's image route — one
// call, ~20s — then park the picture on the durable asset host.
async function processImageJob(id, row, grounded) {
    try {
        // The chosen engine lives in the stored spec, not on the row.
        let imageModel = null;
        try { imageModel = JSON.parse(row.spec_json)?.model || null; } catch { /* default engine */ }
        const response = await fetch(`${selfBase()}/api/superb-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': row.superb_key },
            body: JSON.stringify({
                prompt: grounded.prompt,
                images: grounded.images.map((entry) => entry.data),
                ...(imageModel ? { model: imageModel } : {}),
            }),
            signal: AbortSignal.timeout(180000),
        });
        const data = await response.json().catch(() => ({}));
        const dataUrl = data?.images?.[0];
        const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) : null;
        if (!response.ok || !match) {
            const message = String(data?.error || `image render failed (${response.status})`);
            const attempts = Number(row.attempts || 0) + 1;
            // Image engines blip exactly like video ones; absorb it.
            if (isTransientUpstream(message) && attempts < MAX_ATTEMPTS) {
                await setJob(id, { status: 'queued', attempts });
                setTimeout(() => {
                    processQueuedJob(id).catch(() => {});
                }, RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
                return;
            }
            await setJob(id, {
                status: 'failed',
                error: `${message.slice(0, 260)}${attempts > 1 ? ` (after ${attempts} attempts)` : ''}`,
                superb_key: null,
                vision_used: grounded.visionUsed,
                attempts,
            });
            return;
        }
        const assetId = await putAsset(Buffer.from(match[2], 'base64'), match[1]);
        const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
        await setJob(id, {
            status: 'done',
            video_url: `${base}/api/asset/${assetId}`,
            superb_key: null,
            vision_used: grounded.visionUsed,
        });
    } catch (error) {
        await setJob(id, { status: 'failed', error: `image exception: ${error?.message}`.slice(0, 300), superb_key: null });
    }
}

async function processQueuedJob(id) {
    const pool = await db();
    if (!pool) return;
    // Claim atomically so a route call and the ticker never double-submit.
    const claimed = await pool.query(
        `UPDATE render_jobs SET status = 'grounding', updated_at = now()
         WHERE id = $1 AND status = 'queued' RETURNING *`,
        [id],
    );
    const row = claimed.rows[0];
    if (!row) return;

    const spec = JSON.parse(row.spec_json);
    const grounded = await groundPrompt(spec, row.superb_key, row.kind);

    if (row.kind === 'image') {
        await processImageJob(id, row, grounded);
        return;
    }

    // Parameter names per the gateway's video API contract: the aspect field
    // is `ratio` (we were sending `aspect_ratio`, which is silently dropped —
    // that is why every clip came back in the model's native shape), and the
    // per-second Seedance 2.0 family REQUIRES an explicit resolution.
    const payload = {
        model: spec.model,
        prompt: grounded.prompt,
        ...(spec.duration ? { duration: spec.duration } : {}),
        ...(spec.aspect_ratio ? { ratio: spec.aspect_ratio } : {}),
        ...(spec.resolution ? { resolution: spec.resolution } : {}),
        ...(spec.image_url ? { image_url: spec.image_url } : {}),
    };
    try {
        const response = await fetch(`${superbBase()}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${row.superb_key}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });
        const data = await response.json().catch(() => ({}));
        const taskId = data.task_id || data.id;
        if (!response.ok || !taskId) {
            // The gateway's message names the actual limit ("4-12 seconds",
            // "balance below the clip price") — surface it verbatim instead of
            // a generic failure the user cannot act on.
            const message = String(data?.error?.message || data?.error || `submit failed (${response.status})`);
            const attempts = Number(row.attempts || 0) + 1;
            // A rejected submit costs nothing, so retrying a transient failure
            // is free — and it is what keeps a provider blip invisible.
            if (isTransientUpstream(message) && attempts < MAX_ATTEMPTS) {
                await setJob(id, { status: 'queued', attempts });
                setTimeout(() => {
                    processQueuedJob(id).catch(() => {});
                }, RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
                return;
            }
            await setJob(id, {
                status: 'failed',
                error: `${message.slice(0, 260)}${attempts > 1 ? ` (after ${attempts} attempts)` : ''}`,
                superb_key: null,
                vision_used: grounded.visionUsed,
                attempts,
            });
            return;
        }
        const charged = Number(response.headers.get('x-superbapi-cost-usd'));
        await setJob(id, {
            status: 'submitted',
            upstream_task_id: taskId,
            vision_used: grounded.visionUsed,
            ...(Number.isFinite(charged) && charged > 0 ? { cost_usd: charged } : {}),
        });
    } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        if (isTransientUpstream(error?.message) && attempts < MAX_ATTEMPTS) {
            await setJob(id, { status: 'queued', attempts });
            setTimeout(() => {
                processQueuedJob(id).catch(() => {});
            }, RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
            return;
        }
        await setJob(id, {
            status: 'failed',
            error: `Could not reach the provider after ${attempts} attempts: ${String(error?.message || '').slice(0, 200)}`,
            superb_key: null,
            attempts,
        });
    }
}

async function pollSubmittedJob(row) {
    // Enforce the deadline BEFORE any network call. Previously this check sat
    // in the success branch, so a task the upstream could no longer poll
    // (expired id, persistent 5xx, thrown fetch) stayed "rendering" forever —
    // one job sat spinning for 113 minutes under a 20-minute cap.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > MAX_POLL_MINUTES * 60 * 1000) {
        await setJob(row.id, {
            status: 'failed',
            error: `No result after ${MAX_POLL_MINUTES} minutes — the provider never returned a video.`,
            superb_key: null,
        });
        return;
    }
    try {
        const response = await fetch(`${superbBase()}/videos/${row.upstream_task_id}`, {
            headers: { Authorization: `Bearer ${row.superb_key}` },
            signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const upstreamUrl = data.video_url || data.metadata?.url;
        if (data.status === 'completed' && upstreamUrl) {
            // Provider storage expires — copy the clip into our asset store.
            let finalUrl = upstreamUrl;
            try {
                const video = await fetch(upstreamUrl, { signal: AbortSignal.timeout(120000) });
                const bytes = Buffer.from(await video.arrayBuffer());
                if (video.ok && bytes.length > 0 && bytes.length <= MAX_VIDEO_BYTES) {
                    const assetId = await putAsset(bytes, video.headers.get('content-type') || 'video/mp4');
                    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
                    finalUrl = `${base}/api/asset/${assetId}`;
                }
            } catch {
                // keep the provider URL if mirroring fails
            }
            await setJob(row.id, { status: 'done', video_url: finalUrl, superb_key: null });
        } else if (data.status === 'failed') {
            const message = String(data.error?.message || data.error || 'render failed');
            const attempts = Number(row.attempts || 0) + 1;
            // A render that crashed inside the provider (their stream ended
            // without a result) is worth one more go — it is not our request
            // that was wrong. A moderation rejection is NOT retried: the same
            // prompt will be refused again and the user would pay twice.
            const providerCrash = isTransientUpstream(message)
                || /任务异常终止|stream|异常|internal error/i.test(message);
            const moderation = /copyright|moderation|policy|not allowed|sensitive/i.test(message);
            if (providerCrash && !moderation && attempts < MAX_ATTEMPTS) {
                await setJob(row.id, { status: 'queued', attempts, upstream_task_id: null });
                setTimeout(() => {
                    processQueuedJob(row.id).catch(() => {});
                }, RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
                return;
            }
            await setJob(row.id, {
                status: 'failed',
                error: moderation
                    ? `${message.slice(0, 240)} — this needs a different prompt, not a retry.`
                    : `${message.slice(0, 260)}${attempts > 1 ? ` (after ${attempts} attempts)` : ''}`,
                superb_key: null,
                attempts,
            });
        }
    } catch {
        // transient poll error — next tick retries
    }
}

// Retry a failed job: clone its stored spec into a fresh job. The frames are
// asset URLs with a 30-day life, so a retry days later still has its images.
export async function retryJob(id, apiKey, userId) {
    const pool = await db();
    if (!pool) throw Object.assign(new Error('Job pipeline needs the database'), { statusCode: 503 });
    const result = await pool.query(
        `SELECT * FROM render_jobs WHERE id = $1 AND key_hash = $2`,
        [id, hashKey(apiKey)],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.status !== 'failed') {
        throw Object.assign(new Error('Only failed jobs can be retried'), { statusCode: 409 });
    }
    return createJob({ apiKey, userId, spec: JSON.parse(row.spec_json), kind: row.kind || 'video' });
}

export function ensureTicker() {
    if (globalThis.__ovJobTicker) return;
    globalThis.__ovJobTicker = setInterval(async () => {
        try {
            const pool = await db();
            if (!pool) return;
            const submitted = await pool.query(`SELECT * FROM render_jobs WHERE status = 'submitted' ORDER BY created_at LIMIT 6`);
            for (const row of submitted.rows) await pollSubmittedJob(row);
            // Restart rescue: queued/grounding rows nobody is processing.
            // Give up on anything that never reached the upstream either —
            // the rescue sweep used to re-queue these indefinitely.
            await pool.query(
                `UPDATE render_jobs
                 SET status = 'failed', superb_key = NULL,
                     error = 'Never reached the provider — nothing was charged. Try again.'
                 WHERE status IN ('queued','grounding')
                   AND created_at < now() - interval '${MAX_POLL_MINUTES} minutes'`,
            );
            const stale = await pool.query(
                `UPDATE render_jobs SET status = 'queued', updated_at = now()
                 WHERE status IN ('queued','grounding') AND updated_at < now() - interval '${Math.round(RESCUE_QUEUED_AFTER_MS / 1000)} seconds'
                 RETURNING id`,
            );
            for (const row of stale.rows.slice(0, 3)) {
                processQueuedJob(row.id).catch(() => {});
            }
        } catch (error) {
            console.error('Job ticker error:', error?.message);
        }
    }, TICK_MS);
    globalThis.__ovJobTicker.unref?.();
}
