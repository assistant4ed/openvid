'use client';

import { useCallback, useEffect, useState } from 'react';

import { listSuperbKeys, maskKey, saveSuperbKeys } from 'studio';

// Ranked key manager. Rank #1 is the session key; renders route to the
// highest-ranked key whose probed capabilities support the chosen model.

export default function KeyManager({ onActiveChange, onSignOut }) {
  const [keys, setKeys] = useState([]);
  const [credits, setCredits] = useState({}); // key -> number|null
  const [probing, setProbing] = useState(null); // key being probed
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    setKeys(listSuperbKeys());
  }, []);

  const fetchCredits = useCallback(async (key) => {
    try {
      const response = await fetch('/api/superb/credits', {
        headers: { 'x-superb-key': key },
      });
      if (!response.ok) return;
      const payload = await response.json();
      const data = payload?.data;
      if (data && typeof data.total_credits === 'number') {
        setCredits((previous) => ({
          ...previous,
          [key]: Math.max(0, Math.round(data.total_credits - (data.total_usage || 0))),
        }));
      }
    } catch {
      // credits stay unknown — non-blocking
    }
  }, []);

  useEffect(() => {
    keys.forEach((entry) => {
      if (credits[entry.key] === undefined) fetchCredits(entry.key);
    });
  }, [keys, credits, fetchCredits]);

  const persist = (next) => {
    const previousActive = keys[0]?.key;
    setKeys(next);
    saveSuperbKeys(next);
    if (next[0]?.key && next[0].key !== previousActive) {
      onActiveChange?.(next[0].key);
    }
  };

  const probeModels = useCallback(async (key) => {
    setProbing(key);
    try {
      const response = await fetch('/api/superb-capabilities', {
        headers: { 'x-superb-key': key },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      setProbing(null);
    }
  }, []);

  const handleAdd = async (event) => {
    event.preventDefault();
    const trimmed = newKey.trim();
    setError('');
    if (!trimmed.startsWith('sk-')) {
      setError('SuperbAPI keys start with "sk-".');
      return;
    }
    if (keys.some((entry) => entry.key === trimmed)) {
      setError('This key is already in the list.');
      return;
    }

    setIsAdding(true);
    try {
      const check = await fetch('/api/superb/key', { headers: { 'x-superb-key': trimmed } });
      if (check.status === 401) {
        setError('SuperbAPI rejected this key.');
        return;
      }
      const session = check.ok ? (await check.json())?.data : null;
      const caps = await probeModels(trimmed);
      const entry = {
        key: trimmed,
        label: session?.label || `Key ${keys.length + 1}`,
        caps,
      };
      persist([...keys, entry]);
      setNewKey('');
    } finally {
      setIsAdding(false);
    }
  };

  const move = (index, delta) => {
    const next = [...keys];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  const remove = (index) => {
    const next = keys.filter((_, i) => i !== index);
    persist(next);
    if (next.length === 0) onSignOut?.();
  };

  const refreshModels = async (index) => {
    const caps = await probeModels(keys[index].key);
    if (!caps) return;
    const next = keys.map((entry, i) => (i === index ? { ...entry, caps } : entry));
    persist(next);
  };

  return (
    <div className="space-y-3">
      {keys.map((entry, index) => {
        const models = entry.caps?.video?.map((m) => m.name) || [];
        return (
          <div
            key={entry.key}
            className={`rounded-xl border p-4 ${
              index === 0
                ? 'border-[rgba(212,249,57,0.35)] bg-[rgba(212,249,57,0.05)]'
                : 'border-white/[0.08] bg-white/[0.02]'
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={`slate-label ${index === 0 ? 'slate-label--cyan' : ''}`}>
                #{index + 1} · {entry.label}
                {index === 0 ? ' · SESSION' : ''}
              </span>
              <span className="slate-value text-primary">
                {credits[entry.key] !== undefined ? `${credits[entry.key]} CR` : '…'}
              </span>
            </div>
            <div className="slate-value mb-2 text-white/70">{maskKey(entry.key)}</div>
            <p className="mb-3 text-[11px] leading-relaxed text-white/40">
              {probing === entry.key
                ? 'Probing models on this key…'
                : models.length > 0
                  ? `Renders: ${models.join(' · ')}`
                  : 'Models not probed yet.'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Rank higher"
                className="btn btn-md btn-ghost !px-2.5 !py-1.5 !text-[11px] disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === keys.length - 1}
                title="Rank lower"
                className="btn btn-md btn-ghost !px-2.5 !py-1.5 !text-[11px] disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => refreshModels(index)}
                disabled={probing === entry.key}
                className="btn btn-md btn-ghost !px-2.5 !py-1.5 !text-[11px]"
              >
                Check models
              </button>
              <button
                type="button"
                onClick={() => remove(index)}
                className="btn btn-md btn-ghost !px-2.5 !py-1.5 !text-[11px] !text-red-400/90 hover:!border-red-400/40"
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}

      <form onSubmit={handleAdd} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <span className="slate-label mb-2 block">ADD ANOTHER KEY</span>
        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={(event) => {
              setNewKey(event.target.value);
              setError('');
            }}
            placeholder="sk-sbapi-…"
            className="field field-mono flex-1 !py-2 !text-[12px]"
          />
          <button
            type="submit"
            disabled={isAdding || !newKey.trim()}
            className="btn btn-md btn-outline-cyan !text-[12px]"
          >
            {isAdding ? 'Checking…' : 'Add'}
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] font-medium text-red-400/90">{error}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-white/35">
          Renders use the highest-ranked key that supports the chosen model.
        </p>
      </form>
    </div>
  );
}
