import { NextResponse } from 'next/server';

import { ensureSchema, getPool } from '../../../../lib/accounts';

// Admin control over user accounts. Gated by ADMIN_TOKEN (Railway env) sent
// as x-admin-token — no admin accounts in the user table, no privilege
// escalation surface.

let adminSchemaReady = null;

async function db() {
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    if (!adminSchemaReady) {
        adminSchemaReady = pool.query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false`,
        );
    }
    await adminSchemaReady;
    return pool;
}

function authorized(request) {
    const expected = process.env.ADMIN_TOKEN || '';
    const given = request.headers.get('x-admin-token') || '';
    return expected.length >= 16 && given === expected;
}

export async function GET(request) {
    if (!authorized(request)) return NextResponse.json({ error: 'Admin token required' }, { status: 401 });
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const result = await pool.query(`
        SELECT u.id, u.email, u.created_at, u.disabled,
               (SELECT count(*) FROM render_jobs j WHERE j.user_id = u.id) AS job_count,
               (SELECT updated_at FROM user_tasks t WHERE t.user_id = u.id) AS tasks_updated_at,
               EXISTS (SELECT 1 FROM user_keys k WHERE k.user_id = u.id) AS has_keys
        FROM users u ORDER BY u.created_at DESC LIMIT 500
    `);
    return NextResponse.json({ users: result.rows });
}

export async function PATCH(request) {
    if (!authorized(request)) return NextResponse.json({ error: 'Admin token required' }, { status: 401 });
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const userId = Number(body.userId);
    if (!Number.isFinite(userId)) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    if (body.action === 'delete') {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        return NextResponse.json({ ok: true, deleted: userId });
    }
    if (typeof body.disabled === 'boolean') {
        const result = await pool.query(
            'UPDATE users SET disabled = $2 WHERE id = $1 RETURNING id, email, disabled',
            [userId, body.disabled],
        );
        if (!result.rows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        return NextResponse.json({ ok: true, user: result.rows[0] });
    }
    return NextResponse.json({ error: 'Nothing to do — pass disabled:boolean or action:"delete"' }, { status: 400 });
}
