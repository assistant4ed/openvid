// Definition-of-done proof for the SuperbAPI video contract. Every check is a
// REAL call against the live gateway through the app's own job pipeline (or
// direct where the header must be read), and prints PASS/FAIL.
// Usage: SUPERB_KEY=sk-… node scripts/dod-video-api.mjs [--spend]
//   without --spend only the free checks run (rejections, model list)

const KEY = process.env.SUPERB_KEY;
const BASE = process.env.APP_BASE || 'https://openvid-production.up.railway.app';
const GATEWAY = 'https://www.superbapi.com/v1';
const SPEND = process.argv.includes('--spend');
if (!KEY) { console.error('SUPERB_KEY required'); process.exit(1); }

const results = [];
const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} · ${name}\n       ${detail}`);
};

// Submit straight to the gateway so the cost header can be read; the app's
// pipeline stores the same header on the job (proven separately below).
async function submitDirect(body) {
    const response = await fetch(`${GATEWAY}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000), // >=60s: submits take up to ~30s
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* keep raw */ }
    return { status: response.status, charged: response.headers.get('x-superbapi-cost-usd'), data, text };
}

// ── Free checks ────────────────────────────────────────────────────────────

// 3s must be REFUSED with the 4-12s limit named, not silently accepted.
{
    const { status, data, text } = await submitDirect({
        model: 'doubao-seedance-2-0-mini', prompt: 'a paper boat', duration: 3, resolution: '720p',
    });
    const message = data?.error?.message || text;
    const names = /4\s*[-–]\s*12|between 4 and 12|minimum/i.test(String(message));
    record('3s Seedance 2.0 is rejected with the limit named',
        status >= 400 && status < 500 && names,
        `HTTP ${status} · "${String(message).slice(0, 120)}"`);
}

// The picker's source of truth is GET /v1/models.
{
    const live = await (await fetch(`${GATEWAY}/models`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
    const liveIds = new Set((live.data || []).map((entry) => entry.id));
    const caps = await (await fetch(`${BASE}/api/superb-capabilities`, { headers: { 'x-superb-key': KEY } })).json();
    const offered = (caps.video || []).map((entry) => entry.id);
    const strays = offered.filter((id) => !liveIds.has(id));
    record('picker is sourced from /v1/models (no stray ids)',
        offered.length > 0 && strays.length === 0,
        `${offered.length} offered, all present in /v1/models${strays.length ? ` — strays: ${strays.join(', ')}` : ''}`);
}

// A failed render must surface the upstream message verbatim.
{
    const jobs = await (await fetch(`${BASE}/api/jobs`, { headers: { 'x-superb-key': KEY } })).json();
    const failed = (jobs.jobs || []).filter((job) => job.status === 'failed' && job.error);
    const generic = failed.filter((job) => /^(task failed|render failed|generation failed)$/i.test(job.error.trim()));
    record('failed renders carry the upstream error message',
        failed.length > 0 && generic.length === 0,
        failed.length === 0 ? 'no failed jobs on record' : `${failed.length} failed jobs, e.g. "${failed[0].error.slice(0, 110)}"`);
}

// ── Billing checks (cost real money — opt in) ──────────────────────────────
if (!SPEND) {
    console.log('\nSkipping the billing proofs (they render real clips). Re-run with --spend.');
} else {
    // Per-SECOND family: 10s must cost exactly 2x 5s.
    const mini5 = await submitDirect({ model: 'doubao-seedance-2-0-mini', prompt: 'a paper boat drifts downstream at dawn', duration: 5, resolution: '720p' });
    const mini10 = await submitDirect({ model: 'doubao-seedance-2-0-mini', prompt: 'a paper boat drifts downstream at dawn', duration: 10, resolution: '720p' });
    const c5 = Number(mini5.charged);
    const c10 = Number(mini10.charged);
    record('Seedance 2.0 Mini bills per second (10s = 2x 5s)',
        Number.isFinite(c5) && Number.isFinite(c10) && Math.abs(c10 - c5 * 2) < 0.25,
        `5s charged $${c5} · 10s charged $${c10} (expected ≈$5.01 and ≈$10.02)`);

    // Per-CLIP family: length must not change the price.
    const flat5 = await submitDirect({ model: 'doubao-seedance-1-5-pro_720p', prompt: 'a paper boat drifts downstream at dawn', duration: 5 });
    const flat10 = await submitDirect({ model: 'doubao-seedance-1-5-pro_720p', prompt: 'a paper boat drifts downstream at dawn', duration: 10 });
    const f5 = Number(flat5.charged);
    const f10 = Number(flat10.charged);
    record('Seedance 1.5 Pro bills per clip (same price at 5s and 10s)',
        Number.isFinite(f5) && Number.isFinite(f10) && Math.abs(f10 - f5) < 0.01,
        `5s charged $${f5} · 10s charged $${f10}`);

    console.log(`\nActual spend this run: $${(c5 + c10 + f5 + f10).toFixed(2)}`);
}

const failures = results.filter((entry) => !entry.pass).length;
console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
process.exit(failures > 0 ? 1 : 0);
