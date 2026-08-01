// Re-render every showcase clip so its MOTION matches the AI Director
// caption. Uses the same chain the app uses: vision pass reconstructs the
// still, the direction drives the camera, Kling renders.
// Usage: SUPERB_KEY=sk-… node scripts/regen-showcase-clips.mjs [baseUrl]

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const BASE = process.argv[2] || 'https://openvid-production.up.railway.app';
const DIR = path.join(process.cwd(), 'public', 'showcase');

if (!KEY) {
    console.error('SUPERB_KEY required');
    process.exit(1);
}

// Optional slug filter: node scripts/regen-showcase-clips.mjs <baseUrl> slug1 slug2
const onlySlugs = process.argv.slice(3);
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf-8')).filter(
    (entry) => onlySlugs.length === 0 || onlySlugs.includes(entry.slug),
);

async function visionPrompt(entry) {
    const image = `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, `${entry.slug}.jpg`)).toString('base64')}`;
    const response = await fetch(`${BASE}/api/prompt-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({
            prompt: `Camera movement (follow it EXACTLY): ${entry.direction}`,
            mode: 'i2v',
            image,
        }),
        signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`agent ${response.status}`);
    return (await response.json()).expandedPrompt;
}

async function render(entry, prompt) {
    const submit = await fetch(`${BASE}/api/superb-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({ prompt, duration: 5, aspect_ratio: '16:9' }),
        signal: AbortSignal.timeout(90000),
    });
    if (!submit.ok) throw new Error(`submit ${submit.status}`);
    const { taskId } = await submit.json();
    for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const poll = await fetch(`${BASE}/api/superb-video?taskId=${taskId}`, {
            headers: { 'x-superb-key': KEY },
        }).catch(() => null);
        if (!poll?.ok) continue;
        const data = await poll.json();
        if (data.status === 'completed' && data.videoUrl) return data.videoUrl;
        if (data.status === 'failed') throw new Error(data.error || 'render failed');
    }
    throw new Error('timeout');
}

// Two at a time keeps total wall time sane.
const queue = [...manifest];
let active = 0;
const results = [];

async function worker() {
    while (queue.length > 0) {
        const entry = queue.shift();
        try {
            process.stdout.write(`▶ ${entry.slug}: vision…\n`);
            const prompt = await visionPrompt(entry);
            process.stdout.write(`▶ ${entry.slug}: rendering…\n`);
            const url = await render(entry, prompt);
            const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
            fs.writeFileSync(path.join(DIR, 'clips', `${entry.slug}.mp4`), buffer);
            results.push(`${entry.slug} OK ${(buffer.length / 1e6).toFixed(1)}MB`);
            console.log(`✓ ${entry.slug}`);
        } catch (error) {
            results.push(`${entry.slug} FAILED: ${error.message}`);
            console.log(`✗ ${entry.slug}: ${error.message}`);
        }
    }
}

await Promise.all([worker(), worker()]);
console.log('\n' + results.join('\n'));
