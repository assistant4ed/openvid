// Account layer: Postgres + Node crypto only — no auth provider.
// scrypt password hashes, HMAC-SHA256 signed session tokens in an HttpOnly
// cookie. Returns null pool when DATABASE_URL is absent so routes can answer
// 503 instead of crashing self-hosted setups without a database.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { Pool } from 'pg';

const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
export const SESSION_COOKIE = 'ov_session';

let pool = null;
let schemaReady = null;

export function getPool() {
    if (!process.env.DATABASE_URL) return null;
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 5,
            connectionTimeoutMillis: 8000,
            query_timeout: 8000,
        });
    }
    return pool;
}

export async function ensureSchema() {
    const db = getPool();
    if (!db) return false;
    if (!schemaReady) {
        schemaReady = db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS user_keys (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                keys_json TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
        `);
    }
    await schemaReady;
    return true;
}

// ── Passwords ────────────────────────────────────────────────────────────────

export function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expected, 'hex');
    return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

// ── Session tokens: "<userId>.<expiry>.<hmac>" ───────────────────────────────

function sign(payload) {
    return createHmac('sha256', process.env.AUTH_SECRET || 'dev-only-secret')
        .update(payload)
        .digest('base64url');
}

export function issueToken(userId) {
    const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
    const payload = `${userId}.${expiry}`;
    return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [userId, expiry, mac] = parts;
    const payload = `${userId}.${expiry}`;
    const expected = sign(payload);
    const macBuf = Buffer.from(mac);
    const expectedBuf = Buffer.from(expected);
    if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) return null;
    if (Number(expiry) < Math.floor(Date.now() / 1000)) return null;
    return Number(userId);
}

export function sessionCookie(token) {
    const base = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}`;
    return process.env.NODE_ENV === 'production' ? `${base}; Secure` : base;
}

export function clearedSessionCookie() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function userIdFromRequest(request) {
    const cookies = request.headers.get('cookie') || '';
    const match = cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    return match ? verifyToken(match[1]) : null;
}
