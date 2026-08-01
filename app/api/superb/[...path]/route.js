import { NextResponse } from 'next/server';

// Same-origin proxy for the two read-only SuperbAPI account endpoints the UI
// needs (key session check + credit balance). The browser cannot call
// superbapi.com directly: the app's CSP connect-src is intentionally narrow
// and the upstream does not serve CORS for third-party origins.
//
// Only an explicit allowlist is forwarded — this must never become a generic
// open proxy.

const SUPERB_BASE = (process.env.SUPERBAPI_BASE_URL || 'https://www.superbapi.com/v1').replace(/\/$/, '');

const ALLOWED_PATHS = new Set(['key', 'credits', 'models']);

const UPSTREAM_TIMEOUT_MS = 12000;

export async function GET(request, { params }) {
    const { path } = await params;
    const target = Array.isArray(path) ? path.join('/') : String(path || '');

    if (!ALLOWED_PATHS.has(target)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const callerKey = request.headers.get('x-superb-key');
    if (!callerKey || !callerKey.startsWith('sk-')) {
        return NextResponse.json({ error: 'Missing SuperbAPI key' }, { status: 401 });
    }

    try {
        const upstream = await fetch(`${SUPERB_BASE}/${target}`, {
            headers: { Authorization: `Bearer ${callerKey}` },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });

        const body = await upstream.text();
        return new NextResponse(body, {
            status: upstream.status,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('SuperbAPI proxy error:', error?.message);
        return NextResponse.json({ error: 'SuperbAPI unreachable' }, { status: 502 });
    }
}
