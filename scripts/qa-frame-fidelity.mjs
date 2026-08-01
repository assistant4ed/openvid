// THE reference test: does each model actually render FROM the uploaded frame?
// Submits the same distinctive start frame to every model, then compares the
// output's first frame against the source pixel-wise (16x16 grayscale mean
// absolute difference). Small diff = the model used the real pixels; large
// diff = it invented a scene and the "reference" was decoration.
// Usage: SUPERB_KEY=sk-… node scripts/qa-frame-fidelity.mjs [maxSpendUSD]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const MAX_SPEND = Number(process.argv[2] || 12);
const BASE = process.argv[3] || 'https://openvid-production.up.railway.app';
const OUT = process.env.QA_OUT || '/tmp/openvid-fidelity';
const SOURCE = path.join(process.cwd(), 'public', 'showcase', 'dolly-diner.jpg');
const PROMPT = 'Hold on this exact scene and push the camera slowly forward toward the diner entrance; the neon signs flicker gently and stars twinkle above.';

if (!KEY) { console.error('SUPERB_KEY required'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// One representative per family — fidelity is a family trait, not a tier one.
const MODELS = [
    { id: 'doubao-seedance-1-5-pro_480p', label: 'Seedance 1.5 Pro 480p', duration: 5, cost: 0.32 },
    { id: 'kling-2.5-720p', label: 'Kling 2.5 720p', duration: 5, cost: 0.6 },
    { id: 'pixverse-v6-720p-audio', label: 'PixVerse V6 720p', duration: null, cost: 0.71 },
    { id: 'veo-3-1-fast', label: 'Veo 3.1 Fast', duration: null, cost: 1.0 },
    { id: 'kling-3.0-omni-720p-noref-mute', label: 'Kling 3.0 Omni noref', duration: 5, cost: 1.2 },
    { id: 'kling-3.0-omni-720p-ref-mute', label: 'Kling 3.0 Omni REF', duration: 5, cost: 1.6 },
    { id: 'viduq3-turbo', label: 'Vidu Q3 Turbo', duration: null, cost: 2.0 },
];

// 16x16 grayscale fingerprint via ffmpeg — no image libraries needed.
function fingerprint(file) {
    const raw = execFileSync('ffmpeg', [
        '-v', 'error', '-i', file, '-frames:v', '1',
        '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-',
    ], { maxBuffer: 1 << 20 });
    return Array.from(raw.slice(0, 256));
}

function meanAbsDiff(a, b) {
    let total = 0;
    for (let i = 0; i < 256; i++) total += Math.abs(a[i] - b[i]);
    return Math.round(total / 256);
}

const sourcePrint = fingerprint(SOURCE);

// Host the frame once, exactly like the app does. Retries because a deploy
// roll mid-run otherwise kills the whole sweep on step one.
let asset = null;
for (let attempt = 1; attempt <= 5 && !asset; attempt++) {
    try {
        const response = await fetch(`${BASE}/api/asset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: `data:image/jpeg;base64,${fs.readFileSync(SOURCE).toString('base64')}` }),
            signal: AbortSignal.timeout(60000),
        });
        if (response.ok) asset = await response.json();
    } catch {
        // roll in progress — wait and retry
    }
    if (!asset) await new Promise((r) => setTimeout(r, 15000));
}
if (!asset?.url) { console.error('could not host the frame'); process.exit(1); }
console.log('frame hosted:', asset.url);

const results = [];
let spent = 0;
for (const model of MODELS) {
    if (spent + model.cost > MAX_SPEND) {
        console.log(`⏸ ${model.label} skipped (spend cap)`);
        results.push({ ...model, verdict: 'skipped (spend cap)' });
        continue;
    }
    process.stdout.write(`▶ ${model.label}…\n`);
    try {
        const submit = await fetch(`${BASE}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
            body: JSON.stringify({
                prompt: PROMPT, model: model.id, image_url: asset.url,
                ...(model.duration ? { duration: model.duration } : {}), aspect_ratio: '16:9',
            }),
            signal: AbortSignal.timeout(60000),
        });
        const created = await submit.json().catch(() => ({}));
        if (!submit.ok || !created.jobId) {
            results.push({ ...model, verdict: `SUBMIT FAILED: ${String(created.error || submit.status).slice(0, 70)}` });
            console.log(`✗ ${model.label}: submit failed`);
            continue;
        }
        let done = null;
        for (let attempt = 0; attempt < 80 && !done; attempt++) {
            await new Promise((r) => setTimeout(r, 10000));
            const poll = await fetch(`${BASE}/api/jobs/${created.jobId}`, { headers: { 'x-superb-key': KEY } }).catch(() => null);
            if (!poll?.ok) continue;
            const job = await poll.json();
            if (job.status === 'done' && job.videoUrl) done = job;
            else if (job.status === 'failed') {
                results.push({ ...model, verdict: `RENDER FAILED: ${String(job.error || '').slice(0, 70)}` });
                console.log(`✗ ${model.label}: render failed`);
                break;
            }
        }
        if (!done) { if (!results.some((r) => r.id === model.id)) results.push({ ...model, verdict: 'TIMEOUT' }); continue; }
        spent += model.cost;
        const file = path.join(OUT, `${model.id.replace(/[^\w.-]/g, '_')}.mp4`);
        fs.writeFileSync(file, Buffer.from(await (await fetch(done.videoUrl)).arrayBuffer()));
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-frames:v', '1', file.replace('.mp4', '_f0.png')]);
        const diff = meanAbsDiff(sourcePrint, fingerprint(file));
        const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]).toString().trim();
        const verdict = diff <= 18 ? 'LITERAL — uses your frame' : diff <= 40 ? 'PARTIAL — similar scene' : 'IGNORED — invented scene';
        results.push({ ...model, verdict, diff, dims });
        console.log(`${diff <= 18 ? '✓' : '✗'} ${model.label} — diff ${diff} · ${verdict} · ${dims} (~$${spent.toFixed(2)})`);
    } catch (error) {
        results.push({ ...model, verdict: `EXCEPTION: ${error?.message?.slice(0, 60)}` });
    }
    fs.writeFileSync(path.join(OUT, 'fidelity.json'), JSON.stringify(results, null, 2));
}

console.log('\n=== FRAME FIDELITY ===');
for (const row of results) {
    console.log(`${row.label.padEnd(24)} | ${row.verdict}${row.diff !== undefined ? ` (diff ${row.diff}, ${row.dims})` : ''}`);
}
console.log(`\nSpent ~$${spent.toFixed(2)}`);
