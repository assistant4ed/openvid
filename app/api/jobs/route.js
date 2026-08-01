import { NextResponse } from 'next/server';

import { userIdFromRequest } from '../../../lib/accounts';
import { createJob, ensureTicker, listJobs } from '../../../lib/renderJobs';

// Server-side render jobs: the browser posts a spec and can vanish — the
// server grounds the prompt, submits upstream, polls, and stores the result.

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const MAX_PROMPT_CHARS = 4000;
const requestCounts = new Map();

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

function hostedUrl(value) {
    return typeof value === 'string' && /^https?:\/\//.test(value) ? value : null;
}

export async function POST(request) {
    ensureTicker();
    const apiKey = readKey(request);
    if (!apiKey) return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    if (isRateLimited(apiKey)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    const body = await request.json().catch(() => null);
    const kind = body?.kind === 'image' ? 'image' : 'video';
    const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, MAX_PROMPT_CHARS).trim() : '';
    const model = typeof body?.model === 'string' ? body.model.slice(0, 80) : '';
    if (!prompt || (kind === 'video' && !model)) {
        return NextResponse.json({ error: 'prompt (and model for video) are required' }, { status: 400 });
    }

    const spec = {
        prompt,
        model: model || null,
        duration: Number(body.duration) > 0 ? Number(body.duration) : null,
        aspect_ratio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio.slice(0, 10) : null,
        resolution: typeof body.resolution === 'string' ? body.resolution.slice(0, 10) : null,
        image_url: hostedUrl(body.image_url),
        end_image_url: hostedUrl(body.end_image_url),
        ref_urls: Array.isArray(body.ref_urls) ? body.ref_urls.map(hostedUrl).filter(Boolean).slice(0, 2) : [],
    };

    try {
        const jobId = await createJob({ apiKey, userId: userIdFromRequest(request), spec, kind });
        return NextResponse.json({ jobId, status: 'queued' }, { status: 201 });
    } catch (error) {
        const status = error?.statusCode === 503 ? 503 : 500;
        return NextResponse.json(
            { error: status === 503 ? 'Job pipeline is not enabled on this deployment' : 'Could not create job' },
            { status },
        );
    }
}

export async function GET(request) {
    ensureTicker();
    const apiKey = readKey(request);
    if (!apiKey) return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    const jobs = await listJobs({ apiKey, userId: userIdFromRequest(request) });
    return NextResponse.json({ jobs });
}
