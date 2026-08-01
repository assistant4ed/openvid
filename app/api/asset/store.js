// Asset store shared by the POST and GET routes. Postgres-backed when
// DATABASE_URL is present (assets survive deploys and restarts — a hosted
// start frame stays fetchable for the whole life of a render task and its
// task-board record); in-memory fallback otherwise, bounded in time and size.

import { ensureSchema, getPool } from '../../../lib/accounts';

const TTL_MS = 30 * 60 * 1000; // memory fallback TTL
const DB_TTL_DAYS = 30; // durable assets: generated results live here too now
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

// Each route handler is its own bundle, so the map is pinned to globalThis.
const assets = (globalThis.__openvidAssets ??= new Map()); // id -> { bytes, mime, expiresAt }

let assetSchemaReady = null;

async function ensureAssetSchema(pool) {
    if (!assetSchemaReady) {
        assetSchemaReady = pool.query(`
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                mime TEXT NOT NULL,
                bytes BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `);
    }
    await assetSchemaReady;
}

function newId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sweep() {
    const now = Date.now();
    for (const [id, asset] of assets) {
        if (asset.expiresAt <= now) assets.delete(id);
    }
    let total = 0;
    for (const asset of assets.values()) total += asset.bytes.length;
    while (total > MAX_TOTAL_BYTES && assets.size > 0) {
        const oldestId = assets.keys().next().value;
        total -= assets.get(oldestId).bytes.length;
        assets.delete(oldestId);
    }
}

export async function putAsset(bytes, mime) {
    const id = newId();
    const pool = getPool();
    if (pool) {
        try {
            await ensureSchema();
            await ensureAssetSchema(pool);
            await pool.query('INSERT INTO assets (id, mime, bytes) VALUES ($1, $2, $3)', [id, mime, bytes]);
            // Opportunistic cleanup of expired rows — cheap, keeps the table lean.
            pool.query(`DELETE FROM assets WHERE created_at < now() - interval '${DB_TTL_DAYS} days'`).catch(() => {});
            return id;
        } catch (error) {
            console.error('Asset DB write failed, falling back to memory:', error?.message);
        }
    }
    sweep();
    assets.set(id, { bytes, mime, expiresAt: Date.now() + TTL_MS });
    return id;
}

export async function getAsset(id) {
    // Memory first (covers the no-DB fallback and freshly written entries).
    const cached = assets.get(id);
    if (cached) {
        if (cached.expiresAt <= Date.now()) {
            assets.delete(id);
        } else {
            return cached;
        }
    }
    const pool = getPool();
    if (!pool) return null;
    try {
        await ensureSchema();
        await ensureAssetSchema(pool);
        const result = await pool.query('SELECT mime, bytes FROM assets WHERE id = $1', [id]);
        if (!result.rows[0]) return null;
        return { mime: result.rows[0].mime, bytes: result.rows[0].bytes };
    } catch (error) {
        console.error('Asset DB read failed:', error?.message);
        return null;
    }
}
