// Showcase Video Agent — the real thing.
// For each brief: AI Director reads the preset path → submits a REAL video
// render on the user's SuperbAPI key (/v1/videos, Kling 2.5) → downloads the
// mp4 → converts to a looping GIF preview. The GIF motion is now the model's
// actual generated motion, not a pan over a still.
//
// Usage: SUPERB_KEY=sk-… node scripts/showcase-video-agent.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { analyzePath } from '../packages/studio/src/utils/cameraPath.js';
import { getPreset } from '../packages/studio/src/utils/cameraPathPresets.js';

const KEY = process.env.SUPERB_KEY;
const APP = process.env.APP_BASE || 'https://openvid-production.up.railway.app';
const GATEWAY = 'https://www.superbapi.com/v1';
const MODEL = process.env.VIDEO_MODEL || 'kling-2.5-720p';
const OUT = path.join(process.cwd(), 'public', 'showcase');

if (!KEY) {
    console.error('SUPERB_KEY required');
    process.exit(1);
}

const BRIEFS = [
    { slug: 'neon-alley', preset: 'fpv-drone', scene: 'Rain-slick neon alley in a night city, reflections on wet asphalt, teal and magenta signage, cinematic anamorphic' },
    { slug: 'glacier-reveal', preset: 'rise-and-reveal', scene: 'Vast glacier valley at golden hour seen from a ridge, epic scale, warm rim light on ice' },
    { slug: 'orbit-dancer', preset: 'bullet-time', scene: 'A dancer mid-leap in a dark studio, chalk dust exploding around her, single hard spotlight' },
    { slug: 'crash-portrait', preset: 'crash-zoom', scene: 'Extreme close portrait of a weathered sailor with sea-spray in his beard, storm light' },
    { slug: 'temple-pan', preset: 'pan-right', scene: 'Ancient cliffside temple complex in rolling mist, lanterns glowing at dusk, painterly wide shot' },
    { slug: 'dolly-diner', preset: 'dolly-in', scene: 'Lonely roadside diner at night in the desert, warm windows against a cold starry sky, vintage car' },
];

async function direct(preset, scene) {
    const analysis = analyzePath(preset.build());
    const r = await fetch(`${APP}/api/camera-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({ analysis, scene, durationSeconds: 5, endMove: preset.endMove, segmentPlan: [{ index: 0, seconds: 5 }] }),
        signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new Error(`director ${r.status}`);
    return (await r.json()).overview;
}

async function renderVideo(prompt) {
    const submit = await fetch(`${GATEWAY}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, prompt, duration: 5, aspect_ratio: '16:9' }),
        signal: AbortSignal.timeout(90000),
    });
    const submitted = await submit.json();
    if (!submit.ok) throw new Error(submitted?.error?.message || `submit ${submit.status}`);
    const taskId = submitted.task_id || submitted.id;

    for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 6000));
        const poll = await fetch(`${GATEWAY}/videos/${taskId}`, {
            headers: { Authorization: `Bearer ${KEY}` },
            signal: AbortSignal.timeout(30000),
        });
        if (!poll.ok) continue;
        const d = await poll.json();
        const status = String(d.status || '').toLowerCase();
        if (['completed', 'succeeded', 'success'].includes(status)) {
            return d.video_url || d.metadata?.url;
        }
        if (['failed', 'error'].includes(status)) throw new Error(d.error?.message || 'render failed');
    }
    throw new Error('render timed out');
}

fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'gifs'), { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf-8'));

for (const brief of BRIEFS) {
    const entry = manifest.find((m) => m.slug === brief.slug);
    if (!entry) continue;
    process.stdout.write(`\n▶ ${entry.title} … `);
    try {
        const preset = getPreset(brief.preset);
        const direction = await direct(preset, brief.scene);
        const prompt = `${brief.scene}. Camera movement: ${direction}`;
        const url = await renderVideo(prompt);

        const mp4 = path.join(OUT, 'clips', `${brief.slug}.mp4`);
        const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
        fs.writeFileSync(mp4, buffer);

        // Real motion → GIF preview
        execFileSync('ffmpeg', [
            '-y', '-loglevel', 'error', '-i', mp4,
            '-vf', 'fps=12,scale=420:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse',
            '-loop', '0', path.join(OUT, 'gifs', `${brief.slug}.gif`),
        ], { timeout: 180000 });

        entry.direction = direction;
        entry.video = `/showcase/clips/${brief.slug}.mp4`;
        entry.gif = `/showcase/gifs/${brief.slug}.gif`;
        entry.status = 'clip';
        console.log(`ok — real clip ${(buffer.length / 1048576).toFixed(1)}MB`);
    } catch (error) {
        console.log(`FAILED: ${error.message}`);
    }
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const clips = manifest.filter((m) => m.status === 'clip').length;
console.log(`\n${clips}/${BRIEFS.length} real video clips in the showcase`);
