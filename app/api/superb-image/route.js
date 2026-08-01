import { NextResponse } from 'next/server';

// Image generation on the user's SuperbAPI key. The gateway serves Gemini
// image models through chat/completions and returns the picture as a
// markdown-wrapped data URL — this route normalises that into {images:[...]}.

const DEFAULT_BASE_URL = 'https://www.superbapi.com/v1';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview-c';
const GENERATION_TIMEOUT_MS = 150000;
const MAX_PROMPT_CHARS = 4000;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_BYTES = 9 * 1024 * 1024; // per image, as data URL

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const requestCounts = new Map();

function superbBase() {
    return (process.env.SUPERBAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
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

function extractDataUrls(content) {
    if (typeof content !== 'string') return [];
    const matches = content.match(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g);
    return matches || [];
}

async function callGateway({ apiKey, model, prompt, images }) {
    const contentParts = [{ type: 'text', text: prompt }];
    for (const dataUrl of images) {
        contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }

    return fetch(`${superbBase()}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            max_tokens: 4000,
            messages: [
                {
                    role: 'user',
                    content: images.length > 0 ? contentParts : prompt,
                },
            ],
        }),
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
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

    const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, MAX_PROMPT_CHARS) : '';
    if (!prompt.trim()) {
        return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const images = Array.isArray(body?.images)
        ? body.images
              .filter(
                  (url) =>
                      typeof url === 'string' &&
                      url.startsWith('data:image/') &&
                      url.length <= MAX_REFERENCE_BYTES,
              )
              .slice(0, MAX_REFERENCE_IMAGES)
        : [];

    const model = process.env.SUPERBAPI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

    try {
        const response = await callGateway({ apiKey, model, prompt, images });

        if (!response.ok) {
            // NEVER silently drop the user's reference image — a text-only
            // retry generates something unrelated, which reads as "it ignored
            // my photo". Surface the real reason instead.
            const detail = (await response.text()).slice(0, 300);
            console.error('Superb image error:', response.status, detail);
            const friendly = /pixel data|decode image/i.test(detail)
                ? 'The reference image could not be decoded upstream — try a smaller JPG.'
                : 'Image generation failed upstream';
            const status = response.status === 401 ? 401 : 502;
            return NextResponse.json({ error: friendly }, { status });
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        const dataUrls = extractDataUrls(content);
        if (dataUrls.length === 0) {
            console.error('Superb image: no image in response, content head:', String(content).slice(0, 120));
            return NextResponse.json({ error: 'The model returned no image' }, { status: 502 });
        }

        return NextResponse.json({ images: dataUrls, model });
    } catch (error) {
        console.error('Superb image exception:', error?.message);
        return NextResponse.json({ error: 'Image generation timed out or was unreachable' }, { status: 502 });
    }
}
