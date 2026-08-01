// End-to-end verification of the video model catalog: one REAL render per
// family, submitted through the app's own /api/superb-video route with the
// exact duration shape the client sends (snapped, or omitted when fixed).
// Usage: SUPERB_KEY=sk-… node scripts/verify-video-models.mjs [baseUrl]

const KEY = process.env.SUPERB_KEY;
const BASE = process.argv[2] || 'https://openvid-production.up.railway.app';
if (!KEY) {
    console.error('SUPERB_KEY required');
    process.exit(1);
}

// model, duration (undefined = fixed-length family, param omitted), prompt
const CASES = [
    ['kling-2.5-720p', 5, 'A girl dances in a courtyard and spins toward a smiling mascot costume. Camera: slow dolly in.'],
    ['doubao-seedance-1-5-pro_480p', 5, 'A paper boat drifts down a rain gutter, city lights reflecting in the water.'],
    ['doubao-seedance-2-0-mini', 3, 'A match is struck in the dark; the flame blooms and lights a candle.'],
    ['grok-1.5-video-6s', undefined, 'A hawk glides over a canyon at golden hour, camera tracking alongside.'],
    ['veo-3-1-fast', undefined, 'Waves crash against a lighthouse in a storm, spray frozen mid-air.'],
    ['pixverse-c1-720p-audio', undefined, 'A steam train crosses a viaduct through morning fog.'],
    ['kling-3.0-omni-720p-noref-mute', 5, 'A chef flips a pancake in a bright kitchen, flour dust in the sunlight.'],
];

async function submit(model, duration, prompt) {
    const response = await fetch(`${BASE}/api/superb-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': KEY },
        body: JSON.stringify({ model, prompt, ...(duration ? { duration } : {}), aspect_ratio: '16:9' }),
        signal: AbortSignal.timeout(90000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`submit ${response.status}: ${String(data.error || '').slice(0, 110)}`);
    return data.taskId;
}

const jobs = [];
for (const [model, duration, prompt] of CASES) {
    try {
        const taskId = await submit(model, duration, prompt);
        console.log(`▶ ${model} submitted (${taskId})`);
        jobs.push({ model, taskId, done: false });
    } catch (error) {
        console.log(`✗ ${model} SUBMIT FAILED: ${error.message}`);
        jobs.push({ model, taskId: null, done: true, verdict: `SUBMIT FAILED: ${error.message}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 9000)); // stay under the route's rate limit
}

const deadline = Date.now() + 15 * 60 * 1000;
while (jobs.some((job) => !job.done) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 12000));
    for (const job of jobs) {
        if (job.done || !job.taskId) continue;
        try {
            const poll = await fetch(`${BASE}/api/superb-video?taskId=${job.taskId}`, {
                headers: { 'x-superb-key': KEY },
                signal: AbortSignal.timeout(30000),
            });
            const data = await poll.json().catch(() => ({}));
            if (data.status === 'completed' && data.videoUrl) {
                job.done = true;
                job.verdict = `OK ${data.videoUrl.slice(0, 60)}…`;
                console.log(`✓ ${job.model}`);
            } else if (data.status === 'failed') {
                job.done = true;
                job.verdict = `RENDER FAILED: ${String(data.error || '').slice(0, 100)}`;
                console.log(`✗ ${job.model}: ${job.verdict}`);
            }
        } catch {
            // transient poll error — keep going
        }
    }
}

console.log('\n=== VERDICTS ===');
for (const job of jobs) {
    console.log(`${job.model} => ${job.verdict || 'TIMEOUT (still rendering after 15m)'}`);
}
