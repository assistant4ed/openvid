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
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: 'Password needs at least 8 characters' }, { status: 400 });

    try {
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
            [email, hashPassword(password)],
        );
        const response = NextResponse.json({ email });
        response.headers.set('Set-Cookie', sessionCookie(issueToken(result.rows[0].id)));
        return response;
    } catch (error) {
        if (String(error?.code) === '23505') {
            return NextResponse.json({ error: 'That email already has an account — sign in instead' }, { status: 409 });
        }
        console.error('register:', error?.message);
        return NextResponse.json({ error: 'Could not create the account' }, { status: 500 });
    }
}
