import { NextResponse } from 'next/server';

import {
    clearedSessionCookie,
    ensureSchema,
    getPool,
    hashPassword,
    issueToken,
    sessionCookie,
    userIdFromRequest,
    verifyPassword,
} from '../../../../lib/accounts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function db() {
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    return pool;
}

// The key vault: the ranked SuperbAPI key registry, synced server-side so it
// roams across devices for signed-in users.
const MAX_KEYS_JSON = 20000;

export async function GET(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const userId = userIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const result = await pool.query('SELECT keys_json FROM user_keys WHERE user_id = $1', [userId]);
    return NextResponse.json({ keys: result.rows[0] ? JSON.parse(result.rows[0].keys_json) : null });
}

export async function PUT(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const userId = userIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const serialized = JSON.stringify(Array.isArray(body.keys) ? body.keys : []);
    if (serialized.length > MAX_KEYS_JSON) {
        return NextResponse.json({ error: 'Key list too large' }, { status: 413 });
    }
    await pool.query(
        `INSERT INTO user_keys (user_id, keys_json, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET keys_json = $2, updated_at = now()`,
        [userId, serialized],
    );
    return NextResponse.json({ ok: true });
}
