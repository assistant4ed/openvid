import { getAsset } from '../store';

// Serves a parked upload so the video gateway can fetch it as a start frame.
export async function GET(request, { params }) {
    const { id } = await params;
    if (!/^[a-z0-9]{8,40}$/i.test(String(id || ''))) {
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
