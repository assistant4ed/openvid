import { NextResponse } from 'next/server';

import { deleteJob, ensureTicker, getJob } from '../../../../lib/renderJobs';

function readKey(request) {
    const key = request.headers.get('x-superb-key');
    return key && key.startsWith('sk-') ? key : null;
}

export async function GET(request, { params }) {
    ensureTicker();
    const apiKey = readKey(request);
    if (!apiKey) return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    const { id } = await params;
    if (!/^job_[\w-]{4,60}$/.test(id || '')) {
        return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    const job = await getJob(id, apiKey);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json(job);
}

export async function DELETE(request, { params }) {
    const apiKey = readKey(request);
    if (!apiKey) return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    const { id } = await params;
    if (!/^job_[\w-]{4,60}$/.test(id || '')) {
        return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    const deleted = await deleteJob(id, apiKey);
    if (!deleted) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
}
