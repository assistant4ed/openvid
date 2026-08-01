'use client';

import { useState } from 'react';

// The front gate: a SuperbAPI key IS the session. The key is checked live
// against superbapi.com (/v1/key via the same-origin proxy) before it is
// accepted, so a typo'd key fails here — not silently three screens later.

const KEY_PREFIX = 'sk-';

export default function ApiKeyModal({ onSave, onClose, overlay = false, title, subtitle }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | checking | verified
  const [session, setSession] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = key.trim();

    if (!trimmed) {
      setError('Paste your SuperbAPI key to continue.');
      return;
    }
    if (!trimmed.startsWith(KEY_PREFIX)) {
      setError('SuperbAPI keys start with "sk-sbapi-". Copy the key value, not its label.');
      return;
    }

    setPhase('checking');
    setError('');

    try {
      const response = await fetch('/api/superb/key', {
        headers: { 'x-superb-key': trimmed },
      });

      if (response.status === 401) {
        setPhase('idle');
        setError('SuperbAPI rejected this key. Check it at superbapi.com and try again.');
        return;
      }
      if (!response.ok) {
        // Upstream unreachable — accept the key rather than lock the user out;
        // real calls will surface real errors.
        console.warn('SuperbAPI session check unavailable, accepting key optimistically');
        onSave(trimmed);
        return;
      }

      const data = await response.json();
      setSession(data?.data || null);
      setPhase('verified');
      window.setTimeout(() => onSave(trimmed), 650);
    } catch {
      onSave(trimmed);
    }
  };

  const wrapperClass = overlay
    ? 'fixed inset-0 z-[200] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in'
    : 'min-h-screen grain bg-ink-0 flex items-center justify-center p-4';

  return (
    <div className={wrapperClass}>
      <div className="panel-pop relative z-10 grid w-full max-w-3xl overflow-hidden md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* ── Form panel ── */}
        <div className="p-8 md:p-10">
          <p className="slate-label slate-label--cyan mb-6">SLATE IN — SESSION KEY</p>
          <h1 className="display-2 mb-2">
            {title || 'Sign in with SuperbAPI'}
          </h1>
          <p className="mb-8 text-[14px] leading-relaxed text-white/50">
            {subtitle || (
              <>
                Your{' '}
                <a
                  href="https://www.superbapi.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary transition-colors hover:text-primary-hover"
                >
                  SuperbAPI
                </a>{' '}
                key is your session — it signs you in and powers the AI Director.
              </>
            )}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="superb-key" className="slate-label mb-2 block">
                SUPERBAPI KEY
              </label>
              <input
                id="superb-key"
                type="password"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setError('');
                }}
                placeholder="sk-sbapi-…"
                autoComplete="off"
                disabled={phase === 'checking' || phase === 'verified'}
                className={`field field-mono ${error ? 'field-error animate-shake' : ''}`}
                suppressHydrationWarning
              />
              {error && (
                <p className="mt-2 text-[12px] font-medium text-red-400/90">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={phase === 'checking' || phase === 'verified'}
              className="btn btn-lg btn-primary w-full"
              suppressHydrationWarning
            >
              {phase === 'checking' ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  Checking session…
                </>
              ) : phase === 'verified' ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M5 12l4 4L19 6" />
                  </svg>
                  Session verified
                </>
              ) : (
                'Enter the studio'
              )}
            </button>

            <p className="text-center text-[12px] text-white/35">
              No key yet?{' '}
              <a
                href="https://www.superbapi.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-white/60 transition-colors hover:text-primary"
              >
                Create one at superbapi.com →
              </a>
            </p>
          </form>
        </div>

        {/* ── Slate panel ── */}
        <div className="letterbox-rule relative hidden flex-col justify-between border-l border-white/[0.06] bg-ink-2 p-8 md:flex">
          <div>
            <p className="slate-label mb-1">PRODUCTION</p>
            <p className="slate-value">OPENVID STUDIO</p>
          </div>

          <svg viewBox="0 0 200 140" className="w-full" aria-hidden="true">
            <path
              className="path-draw"
              d="M20 115 C 60 110, 75 75, 105 62 S 165 30, 178 24"
              stroke="#d4f939"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="1000"
              fill="none"
            />
            <circle className="path-dot" cx="20" cy="115" r="4" fill="#d4f939" />
            <circle className="path-dot" cx="178" cy="24" r="5.5" fill="none" stroke="#a855f7" strokeWidth="1.5" />
            <circle className="path-dot" cx="178" cy="24" r="2.5" fill="#a855f7" />
          </svg>

          <dl className="space-y-3">
            {phase === 'verified' && session ? (
              <>
                <div className="flex items-center justify-between">
                  <dt className="slate-label">KEY LABEL</dt>
                  <dd className="slate-value text-primary">
                    {String(session.label || 'ACTIVE').toUpperCase()}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="slate-label">TIER</dt>
                  <dd className="slate-value">
                    {session.is_free_tier ? 'FREE' : 'PAID'}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <dt className="slate-label">MODELS</dt>
                  <dd className="slate-value">403</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="slate-label">STUDIOS</dt>
                  <dd className="slate-value">15</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="slate-label">MAX SHOT</dt>
                  <dd className="slate-value">90S CHAINED</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
