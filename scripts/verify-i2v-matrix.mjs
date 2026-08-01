// Which video models actually accept a START FRAME on this gateway?
// Camera Move / Image→Video attach input_reference — a model that only does
// text-to-video fails the submit or ignores the frame. Verify per family with
// a real hosted frame, plus retest Seedance 2.0 text-to-video.
// Usage: SUPERB_KEY=sk-… node scripts/verify-i2v-matrix.mjs

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const BASE = process.argv[2] || 'https://openvid-production.up.railway.app';
if (!KEY) { console.error('SUPERB_KEY required'); process.exit(1); }

// Host a real photo as the start frame (same path the app uses).
const jpg = fs.readFileSync(path.join(process.cwd(), 'public', 'showcase', 'dolly-diner.jpg'));
const assetResponse = await fetch(`${BASE}/api/asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}` }),
});
const { url: frameUrl } = await assetResponse.json();
console.log('frame hosted:', frameUrl);

const CASES = [
    // [label, body]
    ['veo-3-1-fast + frame', { model: 'veo-3-1-fast', prompt: 'Slow dolly in toward the diner door.', image_url: frameUrl, aspect_ratio: '16:9' }],
    ['pixverse-c1 + frame', { model: 'pixverse-c1-720p-audio', prompt: 'Slow dolly in toward the diner door.', image_url: frameUrl, aspect_ratio: '16:9' }],
    ['seedance-1.5 + frame', { model: 'doubao-seedance-1-5-pro_480p', prompt: 'Slow dolly in toward the diner door.', duration: 5, image_url: frameUrl, aspect_ratio: '16:9' }],
    ['kling-omni + frame', { model: 'kling-3.0-omni-720p-noref-mute', prompt: 'Slow dolly in toward the diner door.', duration: 5, image_url: frameUrl, aspect_ratio: '16:9' }],
    ['seedance-2.0-mini t2v', { model: 'doubao-seedance-2-0-mini', prompt: 'A candle flame flickers and steadies in a dark room.', duration: 3, aspect_ratio: '16:9' }],
];

const jobs = [];
for (const [label, body] of CASES) {
    try {
        const response = await fetch(`${BASE}/api/superb-video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`submit ${response.status}: ${String(data.error || '').slice(0, 90)}`);
        console.log(`▶ ${label} submitted`);
        jobs.push({ label, taskId: data.taskId, done: false });
    } catch (error) {
        console.log(`✗ ${label}: ${error.message}`);
        jobs.push({ label, taskId: null, done: true, verdict: `SUBMIT FAILED: ${error.message}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 9000));
}

const deadline = Date.now() + 14 * 60 * 1000;
while (jobs.some((job) => !job.done) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 12000));
    for (const job of jobs) {
        if (job.done || !job.taskId) continue;
        try {
            const poll = await fetch(`${BASE}/api/superb-video?taskId=${job.taskId}`, {
                headers: { 'x-superb-key': KEY }, signal: AbortSignal.timeout(30000),
            });
            const data = await poll.json().catch(() => ({}));
            if (data.status === 'completed' && data.videoUrl) {
                job.done = true; job.verdict = `OK ${data.videoUrl}`;
                console.log(`✓ ${job.label}`);
            } else if (data.status === 'failed') {
                job.done = true; job.verdict = `RENDER FAILED: ${String(data.error || '').slice(0, 90)}`;
                console.log(`✗ ${job.label}: ${job.verdict}`);
            }
        } catch { /* transient */ }
    }
}
console.log('\n=== VERDICTS ===');
for (const job of jobs) console.log(`${job.label} => ${job.verdict || 'TIMEOUT after 14m'}`);
