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

export async function GET(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });

    const userId = userIdFromRequest(request);
    if (!userId) return NextResponse.json({ user: null });
    const result = await pool.query('SELECT email, disabled FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (user?.disabled) {
        const response = NextResponse.json({ user: null, error: 'Account disabled' }, { status: 403 });
        response.headers.set('Set-Cookie', clearedSessionCookie());
        return response;
    }
    return NextResponse.json({ user: user ? { email: user.email } : null });
}
