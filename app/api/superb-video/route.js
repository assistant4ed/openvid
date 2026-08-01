import { NextResponse } from 'next/server';

// Video generation on the user's SuperbAPI key.
//
// Video does NOT go through chat/completions — the gateway exposes a dedicated
// submit/poll pair: POST /v1/videos returns a task id, GET /v1/videos/{id}
// reports status and finally a video_url. This route proxies both so the
// browser never holds the key and CSP stays narrow.

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
const SUBMIT_TIMEOUT_MS = 60000;
const POLL_TIMEOUT_MS = 25000;
const MAX_PROMPT_CHARS = 4000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const requestCounts = new Map();

function superbBase() {
    return (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function isRateLimited(key) {
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        requestCounts.set(key, { count: 1, windowStart: now });
        return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
}

function readKey(request) {
    const key = request.headers.get('x-superb-key');
    return key && key.startsWith('sk-') ? key : null;
}

// POST /api/superb-video — submit a job, return { taskId }.
export async function POST(request) {
    const apiKey = readKey(request);
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    }
    if (isRateLimited(apiKey)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, MAX_PROMPT_CHARS) : '';
    if (!prompt.trim()) {
        return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const payload = {
        model: body.model || process.env.SUPERBAPI_VIDEO_MODEL || 'kling-2.5-720p',
        prompt,
    };
    if (body.duration) payload.duration = body.duration;
    if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;
    // The gateway forwards scalar fields, so a start-frame URL reaches upstream.
    if (typeof body.image_url === 'string' && body.image_url.startsWith('http')) {
        payload.image_url = body.image_url;
    }

    try {
        const response = await fetch(`${superbBase()}/videos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data?.error?.message || 'Video submit failed';
            return NextResponse.json({ error: message }, { status: response.status === 401 ? 401 : 502 });
        }

        const taskId = data.task_id || data.id;
        if (!taskId) {
            return NextResponse.json({ error: 'No task id returned' }, { status: 502 });
        }
        return NextResponse.json({ taskId, status: data.status || 'queued', model: payload.model });
    } catch (error) {
        console.error('Superb video submit exception:', error?.message);
        return NextResponse.json({ error: 'Video service unreachable' }, { status: 502 });
    }
}

// GET /api/superb-video?taskId=… — poll one job.
export async function GET(request) {
    const apiKey = readKey(request);
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    }

    const taskId = new URL(request.url).searchParams.get('taskId');
    if (!taskId || !/^[\w-]{6,120}$/.test(taskId)) {
        return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
    }

    try {
        const response = await fetch(`${superbBase()}/videos/${taskId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json({ error: data?.error?.message || 'Poll failed' }, { status: 502 });
        }

        return NextResponse.json({
            status: data.status || 'unknown',
            progress: data.progress ?? null,
            videoUrl: data.video_url || data.metadata?.url || null,
            error: data.error?.message || null,
        });
    } catch (error) {
        console.error('Superb video poll exception:', error?.message);
        return NextResponse.json({ error: 'Video service unreachable' }, { status: 502 });
    }
}
