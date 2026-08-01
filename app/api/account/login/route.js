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

export async function POST(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const result = await pool.query('SELECT id, password_hash, disabled FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
        return NextResponse.json({ error: 'Wrong email or password' }, { status: 401 });
    }
    if (user.disabled) {
        return NextResponse.json({ error: 'This account has been disabled — contact support.' }, { status: 403 });
    }
    const response = NextResponse.json({ email });
    response.headers.set('Set-Cookie', sessionCookie(issueToken(user.id)));
    return response;
}
