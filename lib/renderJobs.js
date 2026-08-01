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
        const response = await fetch(`${selfBase()}/api/superb-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': row.superb_key },
            body: JSON.stringify({
                prompt: grounded.prompt,
                images: grounded.images.map((entry) => entry.data),
            }),
            signal: AbortSignal.timeout(180000),
        });
        const data = await response.json().catch(() => ({}));
        const dataUrl = data?.images?.[0];
        const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) : null;
        if (!response.ok || !match) {
            await setJob(id, {
                status: 'failed',
                error: String(data?.error || `image render failed (${response.status})`).slice(0, 300),
                superb_key: null,
                vision_used: grounded.visionUsed,
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

    const payload = {
        model: spec.model,
        prompt: grounded.prompt,
        ...(spec.duration ? { duration: spec.duration } : {}),
        ...(spec.aspect_ratio ? { aspect_ratio: spec.aspect_ratio } : {}),
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
            const message = (data?.error?.message || data?.error || `submit failed (${response.status})`);
            await setJob(id, { status: 'failed', error: String(message).slice(0, 300), superb_key: null, vision_used: grounded.visionUsed });
            return;
        }
        await setJob(id, { status: 'submitted', upstream_task_id: taskId, vision_used: grounded.visionUsed });
    } catch (error) {
        await setJob(id, { status: 'failed', error: `submit exception: ${error?.message}`.slice(0, 300), superb_key: null });
    }
}

async function pollSubmittedJob(row) {
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
            await setJob(row.id, { status: 'failed', error: String(data.error?.message || data.error || 'render failed').slice(0, 300), superb_key: null });
        } else if (Date.now() - new Date(row.created_at).getTime() > MAX_POLL_MINUTES * 60 * 1000) {
            await setJob(row.id, { status: 'failed', error: `no result after ${MAX_POLL_MINUTES} minutes`, superb_key: null });
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
