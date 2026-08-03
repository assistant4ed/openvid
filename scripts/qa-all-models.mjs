// Render ONE clip on EVERY model the picker offers, cheapest shape each, and
// report which work. Runs models in parallel batches so a full sweep finishes
// in minutes rather than an hour.
// Usage: SUPERB_KEY=sk-… node scripts/qa-all-models.mjs

const KEY = process.env.SUPERB_KEY;
const BASE = process.env.APP_BASE || 'https://openvid-production.up.railway.app';
const PROMPT = 'a red paper lantern drifts upward past dark glass towers at night';
if (!KEY) { console.error('SUPERB_KEY required'); process.exit(1); }

const api = async (path, options = {}) => {
    const response = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY, ...(options.headers || {}) },
        signal: AbortSignal.timeout(options.timeout || 60000),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
};

const caps = await api('/api/superb-capabilities', { timeout: 120000 });
const models = (caps.data.video || []).filter((m) => !m.degraded);
console.log(`sweeping ${models.length} models\n`);

async function test(model) {
    const started = Date.now();
    const duration = model.fixed ? undefined : (model.durations || [5])[0];
    const submit = await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ prompt: PROMPT, model: model.id, ...(duration ? { duration } : {}) }),
    }).catch((error) => ({ status: 0, data: { error: error.message } }));
    if (submit.status !== 201) {
        return { model, ok: false, why: `submit ${submit.status}: ${String(submit.data.error || '').slice(0, 80)}`, secs: 0 };
    }
    for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 12000));
        const poll = await api(`/api/jobs/${submit.data.jobId}`, { timeout: 30000 }).catch(() => null);
        const job = poll?.data;
        if (job?.status === 'done') {
            return { model, ok: true, why: `\$${job.costUsd ?? '?'}`, secs: Math.round((Date.now() - started) / 1000) };
        }
        if (job?.status === 'failed') {
            return { model, ok: false, why: String(job.error || '').slice(0, 80), secs: Math.round((Date.now() - started) / 1000) };
        }
    }
    return { model, ok: false, why: 'still running after 16 min', secs: 960 };
}

// Four at a time: fast enough to finish, gentle on the 8/min submit window.
const queue = [...models];
const results = [];
async function worker() {
    while (queue.length) {
        const model = queue.shift();
        const result = await test(model);
        results.push(result);
        console.log(`${result.ok ? '✓' : '✗'} ${result.model.name.padEnd(26)} ${String(result.secs).padStart(4)}s  ${result.why}`);
        await new Promise((r) => setTimeout(r, 8000));
    }
}
await Promise.all([worker(), worker(), worker(), worker()]);

console.log('\n=== SUMMARY ===');
const ok = results.filter((r) => r.ok);
const slow = ok.filter((r) => r.secs > 180);
console.log(`working: ${ok.length}/${results.length}`);
if (slow.length) console.log(`slow (>3 min): ${slow.map((r) => `${r.model.name} ${r.secs}s`).join(', ')}`);
console.log('broken:', results.filter((r) => !r.ok).map((r) => `${r.model.name} — ${r.why}`).join('\n         ') || 'none');
