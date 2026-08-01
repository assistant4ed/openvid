// Model-by-model QA of the whole video catalog, through the APP's own job
// pipeline (POST /api/jobs → poll → asset URL) so this tests what a user
// actually gets, not just the gateway.
//
// For each model it records: submit result, render result, wall time, and the
// REAL output shape (dimensions, duration, fps, size) measured with ffprobe.
// Cheapest-first with a spend cap, so a budget stops the sweep before it
// drains the key. Sequential by design — the route rate-limits at 8/min and a
// serial run keeps the spend attributable.
//
// Usage: SUPERB_KEY=sk-… node scripts/qa-video-models.mjs [maxSpendUSD] [baseUrl]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const MAX_SPEND = Number(process.argv[2] || 30);
const BASE = process.argv[3] || 'https://openvid-production.up.railway.app';
const OUT_DIR = process.env.QA_OUT || '/tmp/openvid-qa';
const PROMPT = 'A red paper lantern drifts upward past glass office towers at night, city lights glowing behind it.';

if (!KEY) {
    console.error('SUPERB_KEY required');
    process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// duration: null = fixed-length family (the client omits the param).
// cost: gateway retail for THIS test's shape, used for the spend cap.
const CASES = [
    { id: 'doubao-seedance-1-5-pro_480p', label: 'Seedance 1.5 Pro 480p', duration: 5, cost: 0.32 },
    { id: 'kling-2.5-720p', label: 'Kling 2.5 720p', duration: 5, cost: 0.6 },
    { id: 'doubao-seedance-1-5-pro_720p', label: 'Seedance 1.5 Pro 720p', duration: 5, cost: 0.7 },
    { id: 'pixverse-v6-720p-audio', label: 'PixVerse V6 720p', duration: null, cost: 0.71 },
    { id: 'pixverse-c1-720p-audio', label: 'PixVerse C1 720p', duration: null, cost: 0.77 },
    { id: 'grok-1.5-video-6s', label: 'Grok 1.5 Video 6s', duration: null, cost: 0.8 },
    { id: 'grok-video-3', label: 'Grok Video 3 6s', duration: null, cost: 0.8 },
    { id: 'grok-video-3-10s', label: 'Grok Video 3 10s', duration: null, cost: 0.8 },
    { id: 'kling-2.5', label: 'Kling 2.5', duration: 5, cost: 1.0 },
    { id: 'kling-2.5-1080p', label: 'Kling 2.5 1080p', duration: 5, cost: 1.0 },
    { id: 'veo-3-1-fast', label: 'Veo 3.1 Fast', duration: null, cost: 1.0 },
    { id: 'kling-3.0-omni-720p-noref-mute', label: 'Kling 3.0 Omni silent', duration: 5, cost: 1.2 },
    { id: 'pixverse-v6-1080p-audio', label: 'PixVerse V6 1080p', duration: null, cost: 1.35 },
    { id: 'doubao-seedance-1-5-pro_1080p', label: 'Seedance 1.5 Pro 1080p', duration: 5, cost: 1.56 },
    { id: 'veo-3-1', label: 'Veo 3.1', duration: null, cost: 1.6 },
    { id: 'kling-3.0-omni-720p-noref-audio', label: 'Kling 3.0 Omni audio', duration: 5, cost: 1.6 },
    { id: 'kling-3.0-omni-720p-ref-mute', label: 'Kling 3.0 Omni ref silent', duration: 5, cost: 1.6 },
    { id: 'viduq2', label: 'Vidu Q2', duration: 5, cost: 2.0 },
    { id: 'viduq3-turbo', label: 'Vidu Q3 Turbo', duration: 5, cost: 2.0 },
    { id: 'viduq3-pro', label: 'Vidu Q3 Pro', duration: 5, cost: 2.0 },
    { id: 'kling-3.0-omni', label: 'Kling 3.0 Omni full', duration: 5, cost: 2.0 },
    { id: 'kling-3.0-omni-720p-ref-audio', label: 'Kling 3.0 Omni ref audio', duration: 5, cost: 2.2 },
    // Per-SECOND family — shortest clip keeps the probe affordable.
    { id: 'doubao-seedance-2-0-mini', label: 'Seedance 2.0 Mini', duration: 3, cost: 3.0 },
    { id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', duration: 3, cost: 4.84 },
    { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', duration: 3, cost: 6.67 },
];

function probe(file) {
    try {
        const out = execFileSync('ffprobe', [
            '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
            '-of', 'default=nw=1:nk=1', file,
        ]).toString().trim().split('\n');
        const [width, height, rate, seconds] = out;
        const fps = String(rate || '').includes('/')
            ? Math.round((Number(rate.split('/')[0]) / Number(rate.split('/')[1])) * 10) / 10
            : rate;
        const audio = execFileSync('ffprobe', [
            '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0', file,
        ]).toString().trim();
        return {
            dimensions: `${width}x${height}`,
            fps,
            seconds: Math.round(Number(seconds) * 10) / 10,
            sizeMB: Math.round((fs.statSync(file).size / 1e6) * 10) / 10,
            hasAudio: audio.includes('audio'),
        };
    } catch (error) {
        return { probeError: error?.message?.slice(0, 60) };
    }
}

async function runCase(entry) {
    const started = Date.now();
    const result = { ...entry, submit: null, render: null, elapsedS: null };
    try {
        const response = await fetch(`${BASE}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
            body: JSON.stringify({
                prompt: PROMPT,
                model: entry.id,
                ...(entry.duration ? { duration: entry.duration } : {}),
                aspect_ratio: '16:9',
            }),
            signal: AbortSignal.timeout(60000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.jobId) {
            result.submit = `FAIL ${response.status}: ${String(data.error || '').slice(0, 90)}`;
            return result;
        }
        result.submit = 'ok';
        result.jobId = data.jobId;

        for (let attempt = 0; attempt < 90; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 10000));
            const poll = await fetch(`${BASE}/api/jobs/${data.jobId}`, {
                headers: { 'x-superb-key': KEY },
                signal: AbortSignal.timeout(30000),
            }).catch(() => null);
            if (!poll?.ok) continue;
            const job = await poll.json();
            if (job.status === 'done' && job.videoUrl) {
                result.elapsedS = Math.round((Date.now() - started) / 1000);
                const file = path.join(OUT_DIR, `${entry.id.replace(/[^\w.-]/g, '_')}.mp4`);
                const video = await fetch(job.videoUrl, { signal: AbortSignal.timeout(180000) });
                fs.writeFileSync(file, Buffer.from(await video.arrayBuffer()));
                result.render = 'ok';
                result.url = job.videoUrl;
                Object.assign(result, probe(file));
                return result;
            }
            if (job.status === 'failed') {
                result.elapsedS = Math.round((Date.now() - started) / 1000);
                result.render = `FAIL: ${String(job.error || '').slice(0, 90)}`;
                return result;
            }
        }
        result.render = 'TIMEOUT (15 min)';
        return result;
    } catch (error) {
        result.submit = result.submit || `EXCEPTION: ${error?.message?.slice(0, 70)}`;
        return result;
    }
}

const results = [];
let spent = 0;
for (const entry of CASES) {
    if (spent + entry.cost > MAX_SPEND) {
        console.log(`⏸ ${entry.label} SKIPPED — would exceed the $${MAX_SPEND} cap (spent ~$${spent.toFixed(2)})`);
        results.push({ ...entry, submit: 'skipped (spend cap)', render: null });
        continue;
    }
    process.stdout.write(`▶ ${entry.label}…\n`);
    const result = await runCase(entry);
    // Only a real render costs money; a rejected submit is free.
    if (result.render === 'ok') spent += entry.cost;
    results.push(result);
    console.log(
        result.render === 'ok'
            ? `✓ ${entry.label} — ${result.dimensions} ${result.seconds}s ${result.fps}fps` +
              `${result.hasAudio ? ' +audio' : ''} in ${result.elapsedS}s (~$${spent.toFixed(2)} spent)`
            : `✗ ${entry.label} — ${result.render || result.submit}`,
    );
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
}

console.log('\n=== QA SUMMARY ===');
for (const row of results) {
    const verdict = row.render === 'ok'
        ? `OK ${row.dimensions} ${row.seconds}s ${row.fps}fps${row.hasAudio ? ' +audio' : ''} ${row.sizeMB}MB ${row.elapsedS}s`
        : (row.render || row.submit);
    console.log(`${row.label.padEnd(26)} | ${verdict}`);
}
console.log(`\nApprox spend: $${spent.toFixed(2)} of the $${MAX_SPEND} cap`);
