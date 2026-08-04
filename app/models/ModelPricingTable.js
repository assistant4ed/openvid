"use client";

import { useEffect, useMemo, useState } from 'react';

// Pricing comparison for every model on the gateway.
//
// Two rules shape this component:
//   1. Prices are never re-typed here — they arrive from /api/model-catalog,
//      which reads the gateway's own published catalog.
//   2. The chart only ever compares models of the SAME kind. A text model
//      priced per million tokens and a video model priced per clip share a
//      table but not an axis; drawing them on one scale would invent a
//      comparison that does not exist.

const KINDS = [
    { id: 'all', label: 'All' },
    { id: 'video', label: 'Video' },
    { id: 'image', label: 'Image' },
    { id: 'text', label: 'Text' },
    { id: 'audio', label: 'Audio' },
];

const SORTS = [
    { id: 'price-asc', label: 'Cheapest first' },
    { id: 'price-desc', label: 'Most expensive first' },
    { id: 'name', label: 'Name (A–Z)' },
    { id: 'provider', label: 'Provider' },
    { id: 'intelligence', label: 'Benchmark score' },
];

const CHARTABLE_KINDS = new Set(['video', 'image', 'audio', 'text']);
const MAX_CHART_ROWS = 14;

function priceValue(model) {
    const value = model.price?.compare;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export default function ModelPricingTable() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('video');
    const [provider, setProvider] = useState('all');
    const [sort, setSort] = useState('price-asc');
    const [verifiedOnly, setVerifiedOnly] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/model-catalog')
            .then(async (response) => {
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
                return payload;
            })
            .then((payload) => { if (!cancelled) setData(payload); })
            .catch((failure) => { if (!cancelled) setError(failure.message); });
        return () => { cancelled = true; };
    }, []);

    const visible = useMemo(() => {
        if (!data) return [];
        const needle = query.trim().toLowerCase();
        const rows = data.models.filter((model) => {
            if (kind !== 'all' && model.kind !== kind) return false;
            if (provider !== 'all' && model.provider !== provider) return false;
            if (verifiedOnly && !model.verifiedHere) return false;
            if (!needle) return true;
            return `${model.name} ${model.id} ${model.provider} ${model.description} ${model.capabilities.join(' ')}`
                .toLowerCase().includes(needle);
        });

        const byName = (a, b) => a.name.localeCompare(b.name);
        return [...rows].sort((a, b) => {
            // Availability outranks every sort: "cheapest first" led with
            // models that cannot be called at any price.
            if (a.available !== b.available) return a.available ? -1 : 1;
            if (sort === 'name') return byName(a, b);
            if (sort === 'provider') return a.provider.localeCompare(b.provider) || byName(a, b);
            if (sort === 'intelligence') return (b.intelligence ?? -1) - (a.intelligence ?? -1) || byName(a, b);
            const left = priceValue(a);
            const right = priceValue(b);
            // Unpriced models sink to the bottom either way — they can't be
            // meaningfully ranked against a real number.
            if (left === null && right === null) return byName(a, b);
            if (left === null) return 1;
            if (right === null) return -1;
            return sort === 'price-desc' ? right - left : left - right;
        });
    }, [data, query, kind, provider, sort, verifiedOnly]);

    // The chart shows ONE price unit at a time. Video mixes per-call and
    // per-second models (Seedance 2.0 bills per second), and drawing a $2.22
    // second-rate bar beside a $2.00 clip-rate bar would imply they cost the
    // same. So: chart the unit most models use, and say plainly how many were
    // left out and why — a silently truncated chart reads as "this is all of
    // them".
    const chart = useMemo(() => {
        if (!CHARTABLE_KINDS.has(kind)) return null;
        const priced = visible.filter((model) => model.available && priceValue(model) !== null);
        if (priced.length < 2) return null;

        const byUnit = new Map();
        for (const model of priced) {
            const bucket = byUnit.get(model.price.unit) || [];
            bucket.push(model);
            byUnit.set(model.price.unit, bucket);
        }
        const [unit, rows] = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        if (rows.length < 2) return null;

        const ranked = [...rows].sort((a, b) => priceValue(a) - priceValue(b)).slice(0, MAX_CHART_ROWS);
        const peak = Math.max(...ranked.map(priceValue));
        const otherUnits = [...byUnit.entries()]
            .filter(([entryUnit]) => entryUnit !== unit)
            .map(([entryUnit, entryRows]) => `${entryRows.length} priced ${entryUnit}`);
        return {
            rows: ranked,
            peak,
            unit,
            truncated: rows.length - ranked.length,
            otherUnits,
        };
    }, [visible, kind]);

    if (error) {
        return (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-6">
                <p className="text-sm text-red-300/90">{error}</p>
                <p className="mt-2 text-xs text-white/40">
                    Prices are read live from the gateway catalog, so this page shows
                    nothing rather than guessing.
                </p>
            </div>
        );
    }

    if (!data) {
        return <p className="py-16 text-center text-sm text-white/35">Loading the live price list…</p>;
    }

    return (
        <div>
            {/* ── Controls ── */}
            <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-white/8 bg-[#050505]/95 px-4 py-4 backdrop-blur">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <label className="relative flex-1">
                            <span className="sr-only">Search models</span>
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search by name, provider, or capability — try “frame-exact”, “Kling”, “reasoning”"
                                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-[rgba(212,249,57,0.45)]"
                            />
                        </label>
                        <select
                            value={sort}
                            onChange={(event) => setSort(event.target.value)}
                            aria-label="Sort models"
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/80 outline-none focus:border-[rgba(212,249,57,0.45)]"
                        >
                            {SORTS.map((entry) => (
                                <option key={entry.id} value={entry.id} className="bg-[#0d0d10]">{entry.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {KINDS.map((entry) => {
                            const count = entry.id === 'all'
                                ? data.models.length
                                : (data.counts[entry.id] || 0);
                            if (count === 0) return null;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => setKind(entry.id)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                                        kind === entry.id
                                            ? 'border-[rgba(212,249,57,0.5)] bg-[rgba(212,249,57,0.1)] text-[#d4f939]'
                                            : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white'
                                    }`}
                                >
                                    {entry.label} <span className="text-white/30">{count}</span>
                                </button>
                            );
                        })}

                        <select
                            value={provider}
                            onChange={(event) => setProvider(event.target.value)}
                            aria-label="Filter by provider"
                            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 outline-none focus:border-[rgba(212,249,57,0.45)]"
                        >
                            <option value="all" className="bg-[#0d0d10]">All providers</option>
                            {data.providers.map((entry) => (
                                <option key={entry} value={entry} className="bg-[#0d0d10]">{entry}</option>
                            ))}
                        </select>

                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white">
                            <input
                                type="checkbox"
                                checked={verifiedOnly}
                                onChange={(event) => setVerifiedOnly(event.target.checked)}
                                className="accent-[#d4f939]"
                            />
                            Verified by a real render here
                        </label>

                        <span className="ml-auto text-xs text-white/30">
                            {visible.length} of {data.models.length}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Chart ── */}
            {chart && (
                <section className="mb-8 rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                    <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 className="text-sm font-semibold text-white">Price comparison</h2>
                        <span className="text-xs text-white/40">
                            {chart.rows.length} cheapest, {chart.unit}
                            {chart.unit === 'per 1M tokens' && ' — ranked on the output rate'}
                        </span>
                        {chart.truncated > 0 && (
                            <span className="text-xs text-white/30">
                                · {chart.truncated} pricier {chart.truncated === 1 ? 'one' : 'ones'} in the table below
                            </span>
                        )}
                        {chart.otherUnits.length > 0 && (
                            <span className="text-xs text-[rgba(245,158,11,0.75)]">
                                · not charted: {chart.otherUnits.join(', ')} — a different unit
                            </span>
                        )}
                    </header>
                    <ul className="space-y-3 sm:space-y-2">
                        {chart.rows.map((model) => {
                            const value = priceValue(model);
                            const width = Math.max(2, (value / chart.peak) * 100);
                            return (
                                // On a phone a fixed label column leaves the bar
                                // a few pixels wide, which reads as "no data".
                                // Stack there, put it in one row from sm up.
                                <li key={model.id} className="sm:flex sm:items-center sm:gap-3">
                                    <div className="mb-1 flex items-baseline justify-between gap-3 sm:mb-0 sm:contents">
                                        <span className="truncate text-xs text-white/65 sm:w-52 sm:shrink-0" title={model.name}>
                                            {model.name}
                                        </span>
                                        <span className="shrink-0 font-mono text-xs text-white/80 sm:order-last sm:w-24 sm:text-right">
                                            ${value.toFixed(2)}
                                        </span>
                                    </div>
                                    <span className="relative block h-5 overflow-hidden rounded bg-white/[0.04] sm:flex-1">
                                        <span
                                            className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-[#a8c614] to-[#d4f939]"
                                            style={{ width: `${width}%` }}
                                        />
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* ── Table ── */}
            <div className="overflow-x-auto rounded-2xl border border-white/8">
                <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="border-b border-white/8 bg-white/[0.02] text-[10px] uppercase tracking-[0.14em] text-white/40">
                        <tr>
                            <th scope="col" className="px-4 py-3 font-medium">Model</th>
                            <th scope="col" className="px-4 py-3 font-medium">Provider</th>
                            <th scope="col" className="px-4 py-3 font-medium">Type</th>
                            <th scope="col" className="px-4 py-3 font-medium">Price</th>
                            <th scope="col" className="px-4 py-3 font-medium">Context</th>
                            <th scope="col" className="px-4 py-3 font-medium">Capabilities</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-16 text-center text-white/30">
                                    Nothing matches those filters.
                                </td>
                            </tr>
                        )}
                        {visible.map((model) => (
                            <tr key={model.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                                <td className="px-4 py-3 align-top">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-white/90">{model.name}</span>
                                        {model.recommended && (
                                            <span className="rounded bg-[rgba(212,249,57,0.14)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#d4f939]">
                                                Recommended
                                            </span>
                                        )}
                                        {!model.available && (
                                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/35">
                                                Unavailable
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 font-mono text-[10px] text-white/30">{model.id}</p>
                                    {model.durations && (
                                        <p className="mt-1 text-[10px] text-white/40">
                                            {model.durations.join(' / ')}s
                                            {model.resolution ? ` · ${model.resolution}` : ''}
                                        </p>
                                    )}
                                </td>
                                <td className="px-4 py-3 align-top text-white/55">{model.provider}</td>
                                <td className="px-4 py-3 align-top">
                                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
                                        {model.kind}
                                    </span>
                                </td>
                                <td className="px-4 py-3 align-top">
                                    <span className="font-mono text-xs text-white/85">{model.price.label}</span>
                                    {model.price.unit && (
                                        <p className="mt-0.5 text-[10px] text-white/30">{model.price.unit}</p>
                                    )}
                                </td>
                                <td className="px-4 py-3 align-top font-mono text-xs text-white/50">
                                    {model.contextLength ? `${(model.contextLength / 1000).toFixed(0)}K` : '—'}
                                </td>
                                <td className="px-4 py-3 align-top">
                                    <div className="flex flex-wrap gap-1">
                                        {model.verifiedHere && (
                                            <span className="rounded border border-[rgba(212,249,57,0.3)] px-1.5 py-0.5 text-[9px] text-[#d4f939]">
                                                verified here
                                            </span>
                                        )}
                                        {model.capabilities.map((tag) => (
                                            <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/45">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-white/30">
                Prices are read live from the gateway&apos;s published catalog — the same
                figures its billing uses — and cached for 30 minutes.
                {data.stale && ' This copy is stale: the catalog was unreachable on the last refresh.'}
                {' '}“Verified here” marks models this studio has rendered with directly, so their
                clip lengths, resolution and frame behaviour are measured rather than advertised.
            </p>
        </div>
    );
}
