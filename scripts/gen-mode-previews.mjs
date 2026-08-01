// Generate ACCURATE before/after source images for the Workspace mode-menu
// previews by running each image function for real through /api/superb-image.
// The GIF composition (crossfades) happens afterwards with ffmpeg — this
// script only produces the stills, into <outDir>.
// Usage: SUPERB_KEY=sk-… node scripts/gen-mode-previews.mjs <outDir> [baseUrl]

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SUPERB_KEY;
const OUT = process.argv[2];
const BASE = process.argv[3] || 'https://openvid-production.up.railway.app';
const SHOWCASE = path.join(process.cwd(), 'public', 'showcase');

if (!KEY || !OUT) {
    console.error('SUPERB_KEY env + outDir arg required');
    process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

function asDataUrl(file) {
    return `data:image/jpeg;base64,${fs.readFileSync(path.join(SHOWCASE, file)).toString('base64')}`;
}

async function generate(name, prompt, refs = []) {
    const response = await fetch(`${BASE}/api/superb-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({ prompt, images: refs }),
        signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`${name}: ${response.status} ${(await response.text()).slice(0, 120)}`);
    const data = await response.json();
    const match = String(data.images?.[0] || '').match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) throw new Error(`${name}: no image in response`);
    const file = path.join(OUT, `${name}.jpg`);
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    console.log(`✓ ${name} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
}

// Each entry runs the REAL mode template on real inputs, so the preview shows
// exactly what the function does. before-* files that are plain copies of
// showcase stills are written here too, so ffmpeg reads one directory.
const IDENTICAL = 'Everything else — subjects, pose, composition, lighting, style — stays identical to the reference.';
const JOBS = [
    ['edit-after', `Add a warm glowing red neon sign shaped like a coffee cup in the diner window. ${IDENTICAL}`, ['dolly-diner.jpg']],
    ['restyle-after', `Restyle this photo as a loose expressive watercolor painting with visible paper texture and pigment blooms. Keep the dancer, her pose and the composition identical; change only the artistic style.`, ['orbit-dancer.jpg']],
    ['remove-after', `Remove every neon sign and all colored neon glow from this alley, reconstructing the walls and rainy atmosphere naturally behind them. ${IDENTICAL}`, ['neon-alley.jpg']],
    ['combine-after', 'Combine these reference photos into one coherent image: the dancer leaping through the rainy neon alley, her powder lit by the neon glow.', ['orbit-dancer.jpg', 'neon-alley.jpg']],
    ['create-after', 'Cinematic studio portrait of a golden retriever wearing a detailed white astronaut suit, dramatic rim lighting, deep black background, 85mm lens.', []],
    ['product-before', 'Casual amateur smartphone snapshot of matte black wireless over-ear headphones lying on a cluttered wooden desk among cables and papers, harsh direct flash, slightly crooked framing.', []],
    ['product-after', 'Professional studio product photograph of matte black wireless over-ear headphones on a seamless dark charcoal backdrop, dramatic key light with soft rim highlights, crisp focus, high-end commercial look.', []],
];

for (const [file, src] of [
    ['edit-before.jpg', 'dolly-diner.jpg'],
    ['restyle-before.jpg', 'orbit-dancer.jpg'],
    ['remove-before.jpg', 'neon-alley.jpg'],
    ['combine-src1.jpg', 'orbit-dancer.jpg'],
    ['combine-src2.jpg', 'neon-alley.jpg'],
]) {
    fs.copyFileSync(path.join(SHOWCASE, src), path.join(OUT, file));
}

let failures = 0;
for (const [name, prompt, refFiles] of JOBS) {
    try {
        await generate(name, prompt, refFiles.map(asDataUrl));
    } catch (error) {
        failures += 1;
        console.log(`✗ ${error.message}`);
    }
}
process.exit(failures > 0 ? 1 : 0);
