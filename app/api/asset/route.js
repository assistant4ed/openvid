import { NextResponse } from 'next/server';

import { putAsset } from './store';

// Short-lived asset host.
//
// Uploaded reference images live in the browser as data URLs, which the video
// gateway cannot accept (it forwards scalar form fields, not megabytes of
// base64). This route parks an upload in memory for a few minutes and hands
// back a real https URL, which is what makes image-to-video work with a user's
// own picture. Nothing is written to disk and everything expires.

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
    const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/);
    if (!match) {
        return NextResponse.json({ error: 'Expected a base64 image data URL' }, { status: 400 });
    }

    const [, mime, base64] = match;
    if (!ALLOWED_MIME.has(mime)) {
        return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 });
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_BYTES) {
        return NextResponse.json({ error: 'Image exceeds 8 MB' }, { status: 413 });
    }

    const id = await putAsset(bytes, mime);
    // Behind Railway's proxy, request.url resolves to the internal port
    // (localhost:8080) — an address the render gateway can never fetch. Build
    // the public origin from the forwarded host instead.
    const forwardedHost =
        request.headers.get('x-forwarded-host') || request.headers.get('host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const origin =
        process.env.APP_BASE_URL?.replace(/\/$/, '') ||
        (forwardedHost && !/^localhost|^127\./.test(forwardedHost)
            ? `${forwardedProto}://${forwardedHost}`
            : null) ||
        request.headers.get('origin') ||
        new URL(request.url).origin;

    return NextResponse.json({ url: `${origin}/api/asset/${id}`, id, bytes: bytes.length });
}
