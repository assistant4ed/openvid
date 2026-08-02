import { getAsset } from '../store';

// Serves a parked upload so the video gateway can fetch it as a start frame.
//
// The id may carry a file extension (…/abc123.jpg). That suffix is not
// decoration: Kling's render network reads the file type off the URL PATH and
// rejects anything without one ("Url should be an image (jpeg/jpg/png/webp)"),
// which is why an extensionless asset URL silently produced a clip with no
// reference in it. We strip it here and serve the same bytes either way.
export async function GET(request, { params }) {
    const rawId = String((await params).id || '');
    const id = rawId.replace(/\.(?:jpe?g|png|webp)$/i, '');
    if (!/^[a-z0-9]{8,40}$/i.test(id)) {
        return new Response('Not found', { status: 404 });
    }

    const asset = await getAsset(id);
    if (!asset) return new Response('Not found', { status: 404 });

    return new Response(asset.bytes, {
        status: 200,
        headers: {
            'Content-Type': asset.mime,
            'Content-Length': String(asset.bytes.length),
            'Cache-Control': 'public, max-age=600',
        },
    });
}
