import { NextResponse } from 'next/server';

import { ensureSchema, getPool } from '../../../../lib/accounts';

// Operator view of render jobs across all users. Every job is returned with
// its FULL input record — prompt, model, every setting, and the reference /
// frame images the user uploaded — regardless of whether it finished or
// failed. A failed job's inputs are exactly what an operator needs to
// understand why, so they are never trimmed away.

function authorized(request) {
    const expected = process.env.ADMIN_TOKEN || '';
    const given = request.headers.get('x-admin-token') || '';
    return expected.length >= 16 && given === expected;
}

export async function GET(request) {
    if (!authorized(request)) return NextResponse.json({ error: 'Admin token required' }, { status: 401 });
    const pool = getPool();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    await ensureSchema();

    const url = new URL(request.url);
    // Number(null) is 0 and Number.isFinite(0) is true — reading the param
    // straight into Number() silently filtered every request to user_id = 0,
    // which matches nothing. Check presence first.
    const userIdParam = url.searchParams.get('userId');
    const userId = userIdParam === null || userIdParam === '' ? NaN : Number(userIdParam);
    const status = url.searchParams.get('status'); // done | failed | rendering
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 300);

    const filters = [];
    const params = [];
    if (Number.isFinite(userId)) {
        params.push(userId);
        filters.push(`j.user_id = $${params.length}`);
    }
    if (status === 'done' || status === 'failed') {
        params.push(status);
        filters.push(`j.status = $${params.length}`);
    } else if (status === 'rendering') {
        filters.push(`j.status NOT IN ('done','failed')`);
    }
    params.push(limit);

    const result = await pool.query(`
        SELECT j.id, j.kind, j.status, j.error, j.created_at, j.updated_at,
               j.key_hash, j.spec_json, j.video_url, j.cost_usd, j.vision_used,
               j.user_id, u.email
        FROM render_jobs j LEFT JOIN users u ON u.id = j.user_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY j.created_at DESC LIMIT $${params.length}
    `, params).catch((error) => {
        console.error('Admin jobs query failed:', error?.message);
        return { rows: [], queryError: error?.message || 'query failed' };
    });

    if (result.queryError) {
        return NextResponse.json({ error: `Job query failed: ${result.queryError}` }, { status: 500 });
    }

    const jobs = result.rows.map((row) => {
        let spec = {};
        try { spec = JSON.parse(row.spec_json) || {}; } catch { /* unreadable */ }
        return {
            id: row.id,
            kind: row.kind,
            status: row.status,
            error: row.error || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            userId: row.user_id,
            who: row.email || `key ${String(row.key_hash).slice(0, 8)}…`,
            // The full input record — present for failed jobs too.
            input: {
                prompt: spec.prompt || '',
                model: spec.model || null,
                duration: spec.duration ?? null,
                ratio: spec.aspect_ratio ?? null,
                resolution: spec.resolution ?? null,
                startFrame: spec.image_url || null,
                endFrame: spec.end_image_url || null,
                references: Array.isArray(spec.ref_urls) ? spec.ref_urls : [],
            },
            result: {
                url: row.video_url || null,
                costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
                visionUsed: row.vision_used ?? null,
            },
        };
    });

    const totals = jobs.reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        acc.spend += job.result.costUsd || 0;
        return acc;
    }, { spend: 0 });

    return NextResponse.json({ jobs, totals });
}
