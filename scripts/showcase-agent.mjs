// Showcase Agent — produces the example gallery using the studio's own
// features: each brief renders a frame via /api/superb-image (the user's
// SuperbAPI key), gets a real camera direction from /api/camera-path (the AI
// Director), and records the preset's path so the site can animate the move
// over the frame. When a video backend is configured, the same briefs feed
// the Camera Path render pipeline to upgrade every entry into a real clip.
//
// Usage: SUPERB_KEY=sk-… node scripts/showcase-agent.mjs [baseUrl]

import fs from 'node:fs';
import path from 'node:path';

import { analyzePath } from '../packages/studio/src/utils/cameraPath.js';
import { getPreset, presetPreviewGeometry } from '../packages/studio/src/utils/cameraPathPresets.js';

const KEY = process.env.SUPERB_KEY;
const BASE = process.argv[2] || 'https://openvid-production.up.railway.app';
const OUT_DIR = path.join(process.cwd(), 'public', 'showcase');

if (!KEY) {
    console.error('SUPERB_KEY is required');
    process.exit(1);
}

const BRIEFS = [
    {
        slug: 'neon-alley',
        title: 'Neon Alley Chase',
        feature: 'FPV DRONE PRESET',
        preset: 'fpv-drone',
        scene: 'Rain-slick neon alley in a night city, reflections on wet asphalt, cinematic anamorphic look, teal and magenta signage',
    },
    {
        slug: 'glacier-reveal',
        title: 'Glacier Reveal',
        feature: 'RISE & REVEAL PRESET',
        preset: 'rise-and-reveal',
        scene: 'Vast glacier valley at golden hour seen from a ridge, tiny climber silhouettes, epic scale, warm rim light on ice',
    },
    {
        slug: 'orbit-dancer',
        title: 'Frozen Moment',
        feature: 'BULLET TIME PRESET',
        preset: 'bullet-time',
        scene: 'A dancer mid-leap in a dark studio, chalk dust exploding around her frozen in the air, single hard spotlight',
    },
    {
        slug: 'crash-portrait',
        title: 'The Stare',
        feature: 'CRASH ZOOM PRESET',
        preset: 'crash-zoom',
        scene: 'Extreme close portrait of a weathered sailor with sea-spray in his beard, storm light, shallow depth of field',
    },
    {
        slug: 'temple-pan',
        title: 'Temple of Mist',
        feature: 'PAN RIGHT PRESET',
        preset: 'pan-right',
        scene: 'Ancient cliffside temple complex in rolling mist, lanterns glowing at dusk, painterly cinematic wide shot',
    },
    {
        slug: 'dolly-diner',
        title: 'Last Diner Open',
        feature: 'DOLLY IN PRESET',
        preset: 'dolly-in',
        scene: 'Lonely roadside diner at night in the desert, warm windows against a cold starry sky, one parked vintage car',
    },
];

async function generateImage(scene) {
    const response = await fetch(`${BASE}/api/superb-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({ prompt: `${scene}. 16:9 cinematic frame, no text, no watermark.` }),
        signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`image ${response.status}`);
    const data = await response.json();
    return data.images[0];
}

async function directCamera(preset, scene) {
    const analysis = analyzePath(preset.build());
    const response = await fetch(`${BASE}/api/camera-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({
            analysis,
            scene,
            durationSeconds: 5,
            endMove: preset.endMove,
            segmentPlan: [{ index: 0, seconds: 5 }],
        }),
        signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`director ${response.status}`);
    const data = await response.json();
    return data.overview;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];

for (const brief of BRIEFS) {
    process.stdout.write(`\n▶ ${brief.title} … `);
    try {
        const preset = getPreset(brief.preset);
        const dataUrl = await generateImage(brief.scene);
        const base64 = dataUrl.split(',')[1];
        const file = `${brief.slug}.jpg`;
        fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(base64, 'base64'));

        const direction = await directCamera(preset, brief.scene);
        const geometry = presetPreviewGeometry(preset);

        manifest.push({
            slug: brief.slug,
            title: brief.title,
            feature: brief.feature,
            preset: brief.preset,
            image: `/showcase/${file}`,
            direction,
            path: geometry,
            status: 'frame+direction', // upgrades to 'clip' when video backend lands
        });
        console.log(`ok (${Math.round(base64.length / 1370)}KB)`);
    } catch (error) {
        console.log(`FAILED: ${error.message}`);
    }
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length}/${BRIEFS.length} showcase entries written to public/showcase/`);
