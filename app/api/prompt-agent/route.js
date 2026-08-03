import { NextResponse } from 'next/server';

// The Prompt Agent: users type simple commands ("make it dancing", "remove
// the toys"); production tools (Higgsfield, Midjourney, Freepik) all expand
// such input through a fast LLM before generation. This route restates what
// the user actually wants (intent) and writes the full production prompt
// from a per-mode template. Billed to the caller's key; callers fail open to
// the raw prompt if this route is unavailable.

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
// 2026-08-01: the upstream token was flipped to per-call-only — every
// models/gemini-* chat id now 400s. deepseek-v4-flash and grok-4 route
// through other providers and survive; grok-4 is the one with vision.
const AGENT_MODEL = process.env.SUPERBAPI_PROMPT_MODEL || 'deepseek-v4-flash';
// Vision is what carries the user's reference into models that never see
// pixels, so it must be fast AND reliable: grok-4 took ~15s per image, leaked
// its thinking into the output, and timed out often enough that references
// were silently ignored. gemini-2.5-flash-lite answers the same request in
// ~6s with clean text (measured 2026-08-03, after the gateway chain was
// repaired). Overridable via SUPERBAPI_PROMPT_VISION_MODEL.
const VISION_MODEL = process.env.SUPERBAPI_PROMPT_VISION_MODEL || 'models/gemini-2.5-flash-lite';
const VISION_FALLBACK_MODEL = 'grok-4';
// grok-4 (the vision fallback) can take 30s+ on multimodal input; the client
// waits up to 60s, so stay just under that.
const TIMEOUT_MS = 55000;
const MAX_INPUT_CHARS = 1500;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const requestCounts = new Map();

// The prompt templates — one per generation mode. Each tells the agent what
// a complete prompt for that mode must specify.
const MODE_TEMPLATES = {

    t2i: `Text-to-image. Expand the request into ONE production prompt.
Write RICH, SPECIFIC production detail — target 200-260 words. Thin
prompts are the #1 cause of generic output, so spend words on: exact subject
appearance (age, build, hair, wardrobe with colors and fabrics), the setting's
concrete props and depth layers (foreground / midground / background), the
light (key direction, quality, color temperature, practicals, shadows), the
palette, lens and framing (focal feel, height, distance), and the finish
(film stock / grade / grain / clarity). Never invent on-screen text, logos or
watermarks. Do not use section headers or lists — one flowing paragraph.`,
    i2i: `Image editing with a reference photo the model will see. Restate the
user's request as ONE precise edit instruction: name exactly WHAT changes
(objects, colors, clothing, background) and command that everything else —
faces, pose, composition, lighting, style — stays IDENTICAL to the reference.
Be specific about the new element's material, color, scale and placement, and
how it should be lit to match the existing scene. Max 120 words.`,
    t2v: `Text-to-video. Expand the request into ONE continuous cinematic shot.
Write RICH, SPECIFIC production detail — target 200-260 words. Thin
prompts are the #1 cause of generic output, so spend words on: exact subject
appearance (age, build, hair, wardrobe with colors and fabrics), the setting's
concrete props and depth layers (foreground / midground / background), the
light (key direction, quality, color temperature, practicals, shadows), the
palette, lens and framing (focal feel, height, distance), and the finish
(film stock / grade / grain / clarity). Never invent on-screen text, logos or
watermarks. Do not use section headers or lists — one flowing paragraph.
Then choreograph TIME across the clip: what moves first, what
follows, how the camera travels and at what speed, and how the shot resolves —
so the whole duration is directed, not a single frozen idea. If the request
asks for music or a spoken voiceover, state it plainly as part of the scene's
audio.
Present tense, single continuous shot, no cuts.`,
    i2v: `Image-to-video with a start frame the model will animate. Describe ONE
continuous motion applied to that frame.
Write RICH, SPECIFIC production detail — target 200-260 words. Thin
prompts are the #1 cause of generic output, so spend words on: exact subject
appearance (age, build, hair, wardrobe with colors and fabrics), the setting's
concrete props and depth layers (foreground / midground / background), the
light (key direction, quality, color temperature, practicals, shadows), the
palette, lens and framing (focal feel, height, distance), and the finish
(film stock / grade / grain / clarity). Never invent on-screen text, logos or
watermarks. Do not use section headers or lists — one flowing paragraph.
Then choreograph TIME across the clip: what moves first, what
follows, how the camera travels and at what speed, and how the shot resolves —
so the whole duration is directed, not a single frozen idea. If the request
asks for music or a spoken voiceover, state it plainly as part of the scene's
audio.
Command that subjects, wardrobe, style and lighting stay TRUE to the start
frame — you are adding motion, not redesigning the scene. Present tense,
single continuous shot, no cuts.`,
    'i2v-vision': `You are LOOKING at the user's reference frames. The video model
cannot see them, so your prompt must RECONSTRUCT the scene from what you see:
name the exact subjects, their colors, clothing/materials, layout and
composition, background, lighting — precisely, no inventions.
Write RICH, SPECIFIC production detail — target 200-260 words. Thin
prompts are the #1 cause of generic output, so spend words on: exact subject
appearance (age, build, hair, wardrobe with colors and fabrics), the setting's
concrete props and depth layers (foreground / midground / background), the
light (key direction, quality, color temperature, practicals, shadows), the
palette, lens and framing (focal feel, height, distance), and the finish
(film stock / grade / grain / clarity). Never invent on-screen text, logos or
watermarks. Do not use section headers or lists — one flowing paragraph.
Then choreograph TIME across the clip: what moves first, what
follows, how the camera travels and at what speed, and how the shot resolves —
so the whole duration is directed, not a single frozen idea. If the request
asks for music or a spoken voiceover, state it plainly as part of the scene's
audio.
If an END FRAME is provided, the shot must conclude composed exactly like it —
describe the transition from start to end. If STYLE/SUBJECT REFERENCES are
provided, carry their look into the scene. Present tense, single continuous
shot, no cuts.`,
    'i2v-compose': `You are given exact visual descriptions of the user's
reference frames — a vision model wrote them from the real images. The video
model sees neither the images nor these notes: RECONSTRUCT the start-frame
scene precisely from its description (subjects, colors, materials, layout,
lighting — no inventions), then apply the requested motion to that scene.
Write RICH, SPECIFIC production detail — target 200-260 words. Thin
prompts are the #1 cause of generic output, so spend words on: exact subject
appearance (age, build, hair, wardrobe with colors and fabrics), the setting's
concrete props and depth layers (foreground / midground / background), the
light (key direction, quality, color temperature, practicals, shadows), the
palette, lens and framing (focal feel, height, distance), and the finish
(film stock / grade / grain / clarity). Never invent on-screen text, logos or
watermarks. Do not use section headers or lists — one flowing paragraph.
Then choreograph TIME across the clip: what moves first, what
follows, how the camera travels and at what speed, and how the shot resolves —
so the whole duration is directed, not a single frozen idea. If the request
asks for music or a spoken voiceover, state it plainly as part of the scene's
audio.
If an END FRAME description exists the shot must conclude composed like it.
Carry any STYLE/SUBJECT REFERENCE looks into the scene. Present tense, single
continuous shot, no cuts.`,
};

const CLARIFY_TEMPLATE = `Planning pass — NOTHING is generated from this yet.
The user gave a short brief and wants to check your understanding first.
Reply with STRICT JSON only:
{"intent":"one plain sentence naming what they want",
 "questions":[{"q":"a specific question whose answer would change the shot",
               "why":"what it affects","suggestion":"the choice you would make"}],
 "prompt":"the full production prompt you would run if they accept your suggestions"}
Ask 2-4 questions, never generic ones — they must be about THIS brief
(e.g. the subject's wardrobe, the time of day, whether the camera moves, who
speaks). Each suggestion must be concrete enough to use as-is. The prompt
field follows the same rules as a normal production prompt: rich, specific,
one flowing paragraph, 200-260 words.`;

// Advanced planning. Same free, pre-spend pass as clarify, but it also breaks
// the clip into timed beats — the thing that decides whether a 10-second shot
// is directed or one frozen idea held for 10 seconds. The user edits the beats
// before anything is charged, and the accepted beats become the prompt.
const STORYLINE_TEMPLATE = `Story planning pass — NOTHING is generated from this
yet and nothing is charged. The user gave a brief and wants to shape the shot
with you before spending.
Reply with STRICT JSON only:
{"intent":"one plain sentence naming what they want",
 "logline":"one sentence describing the finished clip",
 "beats":[{"time":"0-2s","action":"what happens on screen","camera":"what the camera does"}],
 "questions":[{"q":"a specific question whose answer would change the shot",
               "why":"what it affects","suggestion":"the choice you would make"}],
 "prompt":"the full production prompt that renders these beats"}
Cover the WHOLE requested duration with beats — 2 to 5 of them, contiguous, no
gaps, the last one ending exactly at the clip's length. Ask 2-4 questions, never
generic ones: they must be about THIS brief (wardrobe, time of day, whether the
camera moves, who speaks). Each suggestion must be concrete enough to use
as-is. The prompt field follows the normal production-prompt rules: rich,
specific, one flowing paragraph, 200-260 words, present tense, single
continuous shot, no cuts.`;

const DESCRIBE_SYSTEM =
    'You are the eyes of a film studio. Describe the attached image with ' +
    'precision: subjects, their colors, clothing/materials, layout and ' +
    'composition, background, lighting. Plain text, max 60 words, no ' +
    'inventions, no commentary.';

const IMAGE_ROLE_LABELS = {
    start: 'START FRAME (the shot begins on this):',
    end: 'END FRAME (the shot must conclude composed like this):',
    ref: 'STYLE/SUBJECT REFERENCE (carry this look into the scene):',
};
const MAX_VISION_IMAGES = 4;
const MAX_IMAGE_CHARS = 9 * 1024 * 1024;

function isDataImage(value) {
    return (
        typeof value === 'string' &&
        value.startsWith('data:image/') &&
        value.length <= MAX_IMAGE_CHARS
    );
}

// Accepts the legacy single `image` field or the newer `images` array of
// {role, data} — start / end / ref — and returns the validated list.
function collectVisionImages(body) {
    const images = [];
    if (Array.isArray(body?.images)) {
        for (const entry of body.images) {
            if (images.length >= MAX_VISION_IMAGES) break;
            if (!isDataImage(entry?.data)) continue;
            const role = IMAGE_ROLE_LABELS[entry.role] ? entry.role : 'ref';
            images.push({ role, data: entry.data });
        }
    }
    if (images.length === 0 && isDataImage(body?.image)) {
        images.push({ role: 'start', data: body.image });
    }
    return images;
}

function isRateLimited(key) {
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        requestCounts.set(key, { count: 1, windowStart: now });
        return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
}

function parseAgentReply(raw) {
    const cleaned = String(raw || '')
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
    const asResult = (parsed) =>
        parsed?.prompt
            ? {
                  expandedPrompt: String(parsed.prompt).slice(0, 1200),
                  intent: String(parsed.intent || '').slice(0, 200),
                  ...(parsed.logline ? { logline: String(parsed.logline).slice(0, 240) } : {}),
                  ...(Array.isArray(parsed.beats) && parsed.beats.length > 0
                      ? {
                            beats: parsed.beats.slice(0, 6).map((entry) => ({
                                time: String(entry?.time || '').slice(0, 24),
                                action: String(entry?.action || '').slice(0, 300),
                                camera: String(entry?.camera || '').slice(0, 200),
                            })),
                        }
                      : {}),
                  ...(Array.isArray(parsed.questions) && parsed.questions.length > 0
                      ? {
                            questions: parsed.questions.slice(0, 4).map((entry) => ({
                                q: String(entry?.q || '').slice(0, 200),
                                why: String(entry?.why || '').slice(0, 160),
                                suggestion: String(entry?.suggestion || '').slice(0, 200),
                            })),
                        }
                      : {}),
              }
            : null;
    try {
        const direct = asResult(JSON.parse(cleaned));
        if (direct) return direct;
    } catch {
        // fall through to the extraction attempts below
    }
    // Some providers (grok via this gateway) leak reasoning text around the
    // JSON — extract the outermost {...} block, then the "prompt" value alone.
    const block = cleaned.match(/\{[\s\S]*\}/);
    if (block) {
        try {
            const extracted = asResult(JSON.parse(block[0]));
            if (extracted) return extracted;
        } catch {
            const value = block[0].match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (value) {
                try {
                    return { expandedPrompt: JSON.parse(`"${value[1]}"`).slice(0, 1200), intent: '' };
                } catch {
                    // fall through
                }
            }
        }
    }
    // Not JSON at all — treat the reply as the prompt, unless it LOOKS like
    // mangled JSON (never feed that into a render).
    if (cleaned.length > 10 && !cleaned.startsWith('{')) {
        return { expandedPrompt: cleaned.slice(0, 1200), intent: '' };
    }
    return null;
}

export async function POST(request) {
    const apiKey = request.headers.get('x-superb-key');
    if (!apiKey || !apiKey.startsWith('sk-')) {
        return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    }
    if (isRateLimited(apiKey)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const userPrompt = String(body?.prompt || '').slice(0, MAX_INPUT_CHARS).trim();
    // Any vision image upgrades i2v to the vision-grounded template.
    const visionImages = collectVisionImages(body);
    const PLANNING_MODES = new Set(['clarify', 'storyline']);
    const requestedMode = PLANNING_MODES.has(body?.mode)
        ? body.mode
        : (MODE_TEMPLATES[body?.mode] ? body.mode : 't2i');
    const mode = requestedMode === 'i2v' && visionImages.length > 0 ? 'i2v-vision' : requestedMode;
    const isClarify = PLANNING_MODES.has(requestedMode);
    if (!userPrompt) {
        return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    // The planning pass has its own contract (it asks questions and spends
    // nothing), so it replaces the normal system prompt rather than extending it.
    const system = isClarify
        ? `You are the Prompt Agent of an AI film/image studio.\n${
              requestedMode === 'storyline' ? STORYLINE_TEMPLATE : CLARIFY_TEMPLATE
          }${
              body?.duration ? `\nThe clip is ${Number(body.duration)} seconds long.` : ''
          }`
        : 'You are the Prompt Agent of an AI film/image studio. First infer what ' +
          'the user actually wants; then write the full production prompt.\n' +
          `Mode brief: ${MODE_TEMPLATES[mode]}\n` +
          'Reply with STRICT JSON only, no fences: ' +
          '{"intent":"one plain sentence describing what the user wants",' +
          '"prompt":"the full production prompt"}';

    const baseUrl = (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

    async function callUpstream(model, systemText, userContent) {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: 3000,
                temperature: 0.5,
                messages: [
                    { role: 'system', content: systemText },
                    { role: 'user', content: userContent },
                ],
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 160);
            console.error('Prompt agent upstream:', model, response.status, detail);
            return null;
        }
        const data = await response.json();
        return data?.choices?.[0]?.message?.content ?? null;
    }

    async function callAgent(model, systemText, userContent) {
        return parseAgentReply(await callUpstream(model, systemText, userContent));
    }

    // Losing the reference because one call blipped is the worst failure this
    // route has: the render proceeds and quietly ignores the user's image.
    // Retry, then try the other vision model, before giving up on the pixels.
    async function callVision(systemText, userContent) {
        for (const model of [VISION_MODEL, VISION_MODEL, VISION_FALLBACK_MODEL]) {
            const parsed = await callAgent(model, systemText, userContent).catch(() => null);
            if (parsed) return parsed;
        }
        return null;
    }

    // One image per vision call — the vision model handles a single photo in
    // ~20s but blows past every timeout when several are attached. Describes
    // run in parallel; the text agent composes the final prompt from them.
    async function describeImage(entry) {
        try {
            const text = await callUpstream(VISION_MODEL, DESCRIBE_SYSTEM, [
                { type: 'text', text: IMAGE_ROLE_LABELS[entry.role] },
                { type: 'image_url', image_url: { url: entry.data } },
            ]);
            return text ? { role: entry.role, text: String(text).slice(0, 600) } : null;
        } catch {
            return null;
        }
    }

    try {
        let parsed = null;
        let visionUsed = false;
        let usedModel = AGENT_MODEL;
        let usedMode = mode;

        if (isClarify) {
            parsed = visionImages.length > 0
                ? await callAgent(VISION_MODEL, system, [
                      { type: 'text', text: userPrompt },
                      ...visionImages.slice(0, 1).flatMap((entry) => [
                          { type: 'text', text: IMAGE_ROLE_LABELS[entry.role] },
                          { type: 'image_url', image_url: { url: entry.data } },
                      ]),
                  ])
                : await callAgent(AGENT_MODEL, system, userPrompt);
            if (parsed) visionUsed = visionImages.length > 0;
        } else if (mode === 'i2v-vision' && visionImages.length === 1) {
            // Single frame: one vision call does see-and-write in one pass.
            parsed = await callVision(system, [
                { type: 'text', text: userPrompt },
                { type: 'text', text: IMAGE_ROLE_LABELS[visionImages[0].role] },
                { type: 'image_url', image_url: { url: visionImages[0].data } },
            ]);
            if (parsed) {
                visionUsed = true;
                usedModel = VISION_MODEL;
            }
        } else if (mode === 'i2v-vision') {
            // Several frames: parallel one-image describes, then compose.
            const described = (await Promise.all(visionImages.map(describeImage))).filter(Boolean);
            if (described.length > 0) {
                const notes = described
                    .map((entry) => `${IMAGE_ROLE_LABELS[entry.role]}\n${entry.text}`)
                    .join('\n\n');
                const composeSystem = system.replace(MODE_TEMPLATES[mode], MODE_TEMPLATES['i2v-compose']);
                parsed = await callAgent(
                    AGENT_MODEL,
                    composeSystem,
                    `${userPrompt}\n\nFRAME NOTES FROM THE VISION MODEL:\n\n${notes}`,
                );
                if (parsed) {
                    visionUsed = true;
                    usedModel = `${VISION_MODEL}+${AGENT_MODEL}`;
                }
            }
        } else {
            parsed = await callAgent(AGENT_MODEL, system, userPrompt);
        }

        if (mode === 'i2v-vision' && !parsed) {
            // Vision path down — degrade honestly to a text-only expansion so
            // generation still proceeds; the caller is told the frames were
            // not read this run.
            usedMode = 'i2v';
            const fallbackSystem = system.replace(MODE_TEMPLATES[mode], MODE_TEMPLATES.i2v);
            parsed = await callAgent(AGENT_MODEL, fallbackSystem, userPrompt);
        }

        if (!parsed) {
            return NextResponse.json({ error: 'Prompt agent unavailable' }, { status: 502 });
        }
        return NextResponse.json({
            ...parsed,
            mode: usedMode,
            model: usedModel,
            visionUsed: visionImages.length > 0 ? visionUsed : undefined,
        });
    } catch (error) {
        console.error('Prompt agent exception:', error?.message);
        return NextResponse.json({ error: 'Prompt agent timed out' }, { status: 502 });
    }
}
