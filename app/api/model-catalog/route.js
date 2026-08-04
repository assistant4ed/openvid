import { NextResponse } from 'next/server';

import { VIDEO_CANDIDATES } from '../../../lib/videoModels';

// The pricing comparison table's data source.
//
// Prices come from the gateway's own published catalog — the same file its
// Models page reads and its billing code prices against — so this page can
// never quote a number the invoice disagrees with. Re-typing a price list into
// the frontend is how a comparison chart starts lying.
//
// On top of that we merge what only WE know: which video models were verified
// by real renders here (durations, frame fidelity, audio, per-second billing).

const CATALOG_URL = 'https://www.superbapi.com/catalog/models.json';
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = (globalThis.__openvidCatalog ??= { at: 0, payload: null });

// The catalog ids are "provider/tail"; ours are the bare serving ids. Match on
// the tail so a Vidu entry lines up with our verified metadata for it.
function tail(id) {
    return String(id || '').toLowerCase().replace(/^models\//, '').split('/').pop();
}

const verifiedByTail = new Map(VIDEO_CANDIDATES.map((model) => [tail(model.id), model]));

// A model's kind is decided by what it OUTPUTS — that is what the user is
// shopping for, and it is what makes the price unit meaningful.
function kindOf(entry) {
    const out = Array.isArray(entry.modalityOut) ? entry.modalityOut : [];
    if (out.includes('video')) return 'video';
    if (out.includes('image')) return 'image';
    if (out.includes('audio')) return 'audio';
    return 'text';
}

// Two incompatible price shapes live in one table, so each row carries its own
// unit and a single comparable number. Text models are per 1M tokens; media
// models are per call. Comparing those two as one number would be nonsense, so
// the UI only ever charts within a kind.
function pricingFor(entry, verified) {
    const perCall = Number(entry.requestPricePerCall) || 0;
    const input = Number(entry.inputPricePerM) || 0;
    const output = Number(entry.outputPricePerM) || 0;

    if (verified?.perSecond) {
        return { unit: 'per second', compare: verified.cost, label: `$${verified.cost.toFixed(2)} / second` };
    }
    if (perCall > 0) {
        return { unit: 'per call', compare: perCall, label: `$${perCall.toFixed(2)} / call` };
    }
    if (input || output) {
        return {
            unit: 'per 1M tokens',
            compare: output || input,
            label: `$${input.toFixed(2)} in · $${output.toFixed(2)} out`,
            input,
            output,
        };
    }
    return { unit: null, compare: null, label: 'Not published' };
}

function capabilitiesFor(entry, verified) {
    const tags = [];
    if (verified?.frames === 'literal') tags.push('frame-exact');
    else if (verified?.frames === 'described') tags.push('frame-guided');
    else if (verified?.frames === 'ignored') tags.push('ignores frames');
    if (verified?.audio === true) tags.push('sound');
    if (verified?.audio === false) tags.push('silent');
    if (entry.supportsTools) tags.push('tools');
    if (entry.supportsReasoning) tags.push('reasoning');
    if (entry.supportsStructuredOutputs) tags.push('structured output');
    if (Array.isArray(entry.modalityIn) && entry.modalityIn.includes('image')) tags.push('accepts images');
    if (entry.openSource) tags.push('open source');
    return tags;
}

export async function GET() {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
        return NextResponse.json({ ...cache.payload, cached: true });
    }

    let raw;
    try {
        const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`catalog responded ${response.status}`);
        raw = await response.json();
    } catch (error) {
        // Serve a stale copy rather than an empty table — a price list that
        // blanks out on a network blip is worse than one a few hours old.
        if (cache.payload) {
            return NextResponse.json({ ...cache.payload, cached: true, stale: true });
        }
        return NextResponse.json(
            { error: `Could not load the model catalog: ${error.message}` },
            { status: 503 },
        );
    }

    const entries = Array.isArray(raw) ? raw : (raw.models || raw.data || []);
    const models = entries.map((entry) => {
        const verified = verifiedByTail.get(tail(entry.id)) || null;
        const pricing = pricingFor(entry, verified);
        return {
            id: entry.id,
            servingId: verified?.id || null,
            name: entry.displayName || entry.id,
            provider: entry.provider || 'Unknown',
            kind: kindOf(entry),
            inputs: Array.isArray(entry.modalityIn) ? entry.modalityIn : [],
            description: entry.shortDescription || '',
            contextLength: entry.contextLength || null,
            available: entry.availableNow !== false,
            newest: Boolean(entry.newest),
            intelligence: entry.benchIntelligence ?? null,
            coding: entry.benchCoding ?? null,
            price: pricing,
            capabilities: capabilitiesFor(entry, verified),
            // Only true for models this studio has actually rendered with.
            verifiedHere: Boolean(verified),
            durations: verified?.durations || null,
            resolution: verified?.resolution || null,
            recommended: Boolean(verified?.recommended),
        };
    });

    const payload = {
        models,
        providers: [...new Set(models.map((model) => model.provider))].sort(),
        counts: models.reduce((acc, model) => {
            acc[model.kind] = (acc[model.kind] || 0) + 1;
            return acc;
        }, {}),
        checkedAt: new Date().toISOString(),
    };

    cache.at = Date.now();
    cache.payload = payload;
    return NextResponse.json(payload);
}
