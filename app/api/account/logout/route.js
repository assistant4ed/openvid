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

export async function POST() {
    const response = NextResponse.json({ ok: true });
    response.headers.set('Set-Cookie', clearedSessionCookie());
    return response;
}
