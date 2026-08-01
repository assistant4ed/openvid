'use client';

import { useCallback, useEffect, useState } from 'react';

import { listSuperbKeys, saveSuperbKeys } from 'studio';

// Account + key vault: sign in once, and the ranked key registry follows you
// across devices. Auth is cookie-based; keys sync explicitly on demand.

export default function AccountCard() {
  const [user, setUser] = useState(null);
  const [available, setAvailable] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    fetch('/api/account/me')
      .then((response) => {
        if (response.status === 503) {
          setAvailable(false);
          return null;
        }
        return response.json();
      })
      .then((data) => setUser(data?.user || null))
      .catch(() => {});
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNote('');
    try {
      const response = await fetch(`/api/account/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote(data?.error || 'Something went wrong');
        return;
      }
      setUser({ email: data.email });
      setPassword('');
      setNote(mode === 'register' ? 'Account created — you are signed in.' : 'Signed in.');
    } finally {
      setBusy(false);
    }
  };

  const syncKeys = useCallback(async (direction) => {
    setBusy(true);
    setNote('');
    try {
      if (direction === 'push') {
        const keys = listSuperbKeys();
        const response = await fetch('/api/account/keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys }),
        });
        setNote(response.ok ? `Saved ${keys.length} key(s) to your account.` : 'Sync failed.');
      } else {
        const response = await fetch('/api/account/keys');
        const data = await response.json().catch(() => ({}));
        if (response.ok && Array.isArray(data.keys) && data.keys.length > 0) {
          saveSuperbKeys(data.keys);
          setNote(`Loaded ${data.keys.length} key(s) from your account.`);
        } else {
          setNote('No keys stored on this account yet.');
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = async () => {
    await fetch('/api/account/logout', { method: 'POST' });
    setUser(null);
    setNote('Signed out. Keys on this device are untouched.');
  };

  if (!available) return null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="slate-label">ACCOUNT · KEY SYNC</span>
        {user && <span className="slate-value text-primary">{user.email}</span>}
      </div>

      {user ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => syncKeys('push')}
            className="btn btn-md btn-outline-cyan !px-3 !py-1.5 !text-[11px]"
          >
            Save keys to account
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => syncKeys('pull')}
            className="btn btn-md btn-ghost !px-3 !py-1.5 !text-[11px]"
          >
            Load keys from account
          </button>
          <button
            type="button"
            onClick={logout}
            className="btn btn-md btn-ghost !px-3 !py-1.5 !text-[11px] ml-auto"
          >
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email"
              autoComplete="email"
              className="field flex-1 !py-2 !text-[12px]"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? 'password (8+ chars)' : 'password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="field flex-1 !py-2 !text-[12px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !email || !password}
              className="btn btn-md btn-outline-cyan !px-3 !py-1.5 !text-[11px]"
            >
              {busy ? '…' : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
              className="font-slate text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:text-white"
            >
              {mode === 'register' ? 'Have an account? Sign in' : 'New here? Create account'}
            </button>
          </div>
        </form>
      )}
      {note && <p className="mt-2 text-[11px] text-white/45">{note}</p>}
    </div>
  );
}
