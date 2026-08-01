import { NextResponse } from 'next/server';

import { ensureSchema, getPool, userIdFromRequest } from '../../../../lib/accounts';

// Server-side task history: the Workspace task board, synced per account so
// it survives cleared browsers and roams across devices. The client remains
// localStorage-first (works signed-out); signed-in users get merge-on-load
// and push-on-change against this route.

const MAX_TASKS_JSON = 400000; // ~100 slim tasks with prompts and result URLs

let taskSchemaReady = null;

async function db() {
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    if (!taskSchemaReady) {
        taskSchemaReady = pool.query(`
            CREATE TABLE IF NOT EXISTS user_tasks (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                tasks_json TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `);
    }
    await taskSchemaReady;
    return pool;
}

export async function GET(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const userId = userIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const result = await pool.query('SELECT tasks_json FROM user_tasks WHERE user_id = $1', [userId]);
    return NextResponse.json({ tasks: result.rows[0] ? JSON.parse(result.rows[0].tasks_json) : null });
}

export async function PUT(request) {
    const pool = await db();
    if (!pool) return NextResponse.json({ error: 'Accounts are not enabled on this deployment' }, { status: 503 });
    const userId = userIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    // Same guard the local store applies: data URLs never travel or persist.
    const slim = tasks.map((task) => ({
        ...task,
        url: typeof task?.url === 'string' && task.url.startsWith('data:') ? null : task?.url,
    }));
    const serialized = JSON.stringify(slim);
    if (serialized.length > MAX_TASKS_JSON) {
        return NextResponse.json({ error: 'Task list too large' }, { status: 413 });
    }
    await pool.query(
        `INSERT INTO user_tasks (user_id, tasks_json, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET tasks_json = $2, updated_at = now()`,
        [userId, serialized],
    );
    return NextResponse.json({ ok: true });
}
