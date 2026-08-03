// Phase 9C — exercise TEN distinct product features end to end, each on the
// cheapest model that can do the job, and report what actually happened.
// Cheap on purpose: this is a coverage sweep, not a quality bake-off.
// Usage: SUPERB_KEY=sk-… node scripts/qa-ten-features.mjs

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const BASE = process.env.APP_BASE || 'https://openvid-production.up.railway.app';
if (!KEY) { console.error('SUPERB_KEY required'); process.exit(1); }

const results = [];
const say = (name, ok, detail, cost) => {
    results.push({ name, ok, detail, cost: cost || 0 });
    console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}\n       ${detail}`);
};

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE}${pathname}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY, ...(options.headers || {}) },
        signal: AbortSignal.timeout(options.timeout || 90000),
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    return { status: response.status, data };
}

// Host the reference photo once — several features need one.
const photo = fs.readFileSync(path.join(process.cwd(), 'public', 'showcase', 'dolly-diner.jpg'));
const asset = await api('/api/asset', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/jpeg;base64,${photo.toString('base64')}` }),
});
const frameUrl = asset.data?.url;

async function runJob(label, body, expectCost) {
    const submit = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    if (submit.status !== 201 || !submit.data.jobId) {
        say(label, false, `submit ${submit.status}: ${String(submit.data.error || '').slice(0, 110)}`);
        return null;
    }
    for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((r) => setTimeout(r, 10000));
        const poll = await api(`/api/jobs/${submit.data.jobId}`, { timeout: 30000 }).catch(() => null);
        if (!poll || poll.status !== 200) continue;
        const job = poll.data;
        if (job.status === 'done') {
            say(label, true, `rendered · charged $${job.costUsd ?? '—'} · ${String(job.videoUrl).slice(0, 58)}…`, job.costUsd);
            return job;
        }
        if (job.status === 'failed') {
            say(label, false, `render failed: ${String(job.error || '').slice(0, 110)}`);
            return null;
        }
    }
    say(label, false, 'timed out after 10 minutes');
    return null;
}

// 1 — capabilities probe (free)
{
    const caps = await api('/api/superb-capabilities', { method: 'GET', timeout: 120000 });
    const video = caps.data?.video || [];
    say('1. Model catalog from /v1/models', video.length > 0,
        `${video.length} video models offered, cheapest $${Math.min(...video.map((m) => m.cost || 99))}`);
}

// 2 — Prompt Agent expansion (free-ish, text model)
{
    const agent = await api('/api/prompt-agent', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a cat on a windowsill at sunrise', mode: 't2v' }),
    });
    const words = String(agent.data?.expandedPrompt || '').split(/\s+/).length;
    say('2. Prompt Agent expands a one-liner', words > 120, `${words}-word production brief`);
}

// 3 — Planning pass with questions (free-ish)
{
    const plan = await api('/api/prompt-agent', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'my shop opening video', mode: 'clarify' }),
    });
    const questions = plan.data?.questions || [];
    say('3. Plan-first asks before spending', questions.length >= 2,
        `${questions.length} questions, e.g. "${String(questions[0]?.q || '').slice(0, 70)}"`);
}

// 4 — Asset hosting (free)
say('4. Uploads are hosted durably', Boolean(frameUrl), frameUrl ? `${frameUrl.slice(0, 62)}…` : 'no url returned');

// 5 — text to video, cheapest model
await runJob('5. Text → Video (Seedance 1.5 480p, cheapest)', {
    prompt: 'a paper lantern drifts upward past dark glass towers at night',
    model: 'doubao-seedance-1-5-pro_480p', duration: 5,
});

// 6 — image to video on a frame-exact model
await runJob('6. Image → Video, frame-exact', {
    prompt: 'hold this scene; the neon flickers and stars drift',
    model: 'doubao-seedance-1-5-pro_480p', duration: 5, image_url: frameUrl,
});

// 7 — camera move (preset direction folded into the prompt)
await runJob('7. Camera Move on your frame', {
    prompt: 'Camera move: Dolly In (push slowly toward the subject). Keep the scene as shot.',
    model: 'doubao-seedance-1-5-pro_480p', duration: 5, image_url: frameUrl,
});

// 8 — image generation through the job pipeline
await runJob('8. Text → Image', { kind: 'image', prompt: 'a single ripe fig on a marble slab, soft window light' });

// 9 — image editing with a reference
await runJob('9. Edit Photo with a reference', {
    kind: 'image',
    prompt: 'Add a warm red neon OPEN sign glowing in the diner window. Everything else identical.',
    ref_urls: [frameUrl],
});

// 10 — the shape guard: a bad duration must be refused with a real message
{
    const bad = await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'x', model: 'doubao-seedance-2-0-mini', duration: 3, resolution: '720p' }),
    });
    // The job is created, then fails fast with the gateway's own wording.
    let message = '';
    if (bad.data?.jobId) {
        for (let attempt = 0; attempt < 12; attempt++) {
            await new Promise((r) => setTimeout(r, 5000));
            const poll = await api(`/api/jobs/${bad.data.jobId}`, { timeout: 30000 }).catch(() => null);
            if (poll?.data?.status === 'failed') { message = poll.data.error || ''; break; }
        }
    } else {
        message = bad.data?.error || '';
    }
    say('10. Invalid duration is refused with the limit named',
        /4 and 12|between 4|duration/i.test(message), message.slice(0, 110) || 'no message');
}

const spend = results.reduce((sum, r) => sum + (r.cost || 0), 0);
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} features passed · spent ~$${spend.toFixed(2)} ===`);
process.exit(passed === results.length ? 0 : 1);
