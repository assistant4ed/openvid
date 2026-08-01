import { NextResponse } from 'next/server';

import { userIdFromRequest } from '../../../../../lib/accounts';
import { ensureTicker, retryJob } from '../../../../../lib/renderJobs';

// One-click retry for a failed job: the server still holds the full spec
// (prompt, model, frame asset URLs), so nothing needs re-uploading.

function readKey(request) {
    const key = request.headers.get('x-superb-key');
    return key && key.startsWith('sk-') ? key : null;
}

export async function POST(request, { params }) {
    ensureTicker();
    const apiKey = readKey(request);
    if (!apiKey) return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    const { id } = await params;
    if (!/^job_[\w-]{4,60}$/.test(id || '')) {
        return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    try {
        const jobId = await retryJob(id, apiKey, userIdFromRequest(request));
        if (!jobId) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        return NextResponse.json({ jobId, status: 'queued' }, { status: 201 });
    } catch (error) {
        const status = error?.statusCode || 500;
        return NextResponse.json({ error: error?.message || 'Retry failed' }, { status });
    }
}
