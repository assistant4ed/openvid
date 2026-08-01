import { NextResponse } from 'next/server';

import { ensureSchema, getPool } from '../../../../lib/accounts';

// Operator view of recent render jobs across all users.

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
    const result = await pool.query(`
        SELECT j.id, j.kind, j.status, j.error, j.created_at, j.key_hash,
               j.spec_json, u.email
        FROM render_jobs j LEFT JOIN users u ON u.id = j.user_id
        ORDER BY j.created_at DESC LIMIT 100
    `).catch(() => ({ rows: [] }));
    const jobs = result.rows.map((row) => {
        let model = null;
        let prompt = null;
        try {
            const spec = JSON.parse(row.spec_json);
            model = spec.model;
            prompt = String(spec.prompt || '').slice(0, 80);
        } catch {
            // unreadable spec — show the row anyway
        }
        return {
            id: row.id,
            kind: row.kind,
            status: row.status,
            error: row.error ? String(row.error).slice(0, 120) : null,
            createdAt: row.created_at,
            who: row.email || `key ${String(row.key_hash).slice(0, 8)}…`,
            model,
            prompt,
        };
    });
    return NextResponse.json({ jobs });
}
