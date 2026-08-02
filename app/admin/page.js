'use client';

import { useCallback, useEffect, useState } from 'react';

// Minimal operator console: list accounts, disable/enable, delete.
// Auth = the ADMIN_TOKEN Railway env var, held in sessionStorage only.

export default function AdminPage() {
    const [token, setToken] = useState('');
    const [draft, setDraft] = useState('');
    const [users, setUsers] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [focusUser, setFocusUser] = useState(null);   // drill into one account
    const [statusFilter, setStatusFilter] = useState('');
    const [openJob, setOpenJob] = useState(null);       // expanded input record

    useEffect(() => {
        const stored = window.sessionStorage.getItem('ov_admin_token') || '';
        if (stored) setToken(stored);
    }, []);

    const load = useCallback(async (activeToken) => {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/admin/users', { headers: { 'x-admin-token': activeToken } });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            setUsers(data.users);
            window.sessionStorage.setItem('ov_admin_token', activeToken);
            const query = new URLSearchParams();
            if (focusUser?.id) query.set('userId', focusUser.id);
            if (statusFilter) query.set('status', statusFilter);
            const jobsResponse = await fetch(`/api/admin/jobs?${query}`, { headers: { 'x-admin-token': activeToken } });
            if (jobsResponse.ok) setJobs((await jobsResponse.json()).jobs || []);
        } catch (err) {
            setUsers(null);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }, [focusUser, statusFilter]);

    useEffect(() => {
        if (token) load(token);
    }, [token, load]);

    const patch = async (body) => {
        setBusy(true);
        try {
            const response = await fetch('/api/admin/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
                body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed');
            await load(token);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <main className="min-h-screen bg-[#0a0a0c] text-white/85 px-6 py-10 font-sans">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-bold text-white mb-1">OpenVid — Accounts Admin</h1>
                <p className="text-sm text-white/40 mb-8">User control panel. Actions apply immediately.</p>

                {!users && (
                    <form
                        className="flex gap-3 mb-8"
                        onSubmit={(event) => { event.preventDefault(); setToken(draft.trim()); }}
                    >
                        <input
                            type="password"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="ADMIN_TOKEN (from Railway variables)"
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#d4f939]/50"
                        />
                        <button type="submit" disabled={busy || draft.trim().length < 16}
                            className="px-5 py-2.5 rounded-xl bg-[#d4f939] text-black text-sm font-bold disabled:opacity-40">
                            Open
                        </button>
                    </form>
                )}
                {error && <p className="text-sm text-red-400 mb-6">{error}</p>}

                {users && (
                    <div className="border border-white/10 rounded-2xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-white/5 text-white/40 text-left">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Email</th>
                                    <th className="px-4 py-3 font-medium">Joined</th>
                                    <th className="px-4 py-3 font-medium">Jobs</th>
                                    <th className="px-4 py-3 font-medium">Keys</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => (
                                    <tr key={user.id} className="border-t border-white/5">
                                        <td className="px-4 py-3">{user.email}</td>
                                        <td className="px-4 py-3 text-white/40">{String(user.created_at).slice(0, 10)}</td>
                                        <td className="px-4 py-3 text-white/40">{user.job_count}</td>
                                        <td className="px-4 py-3 text-white/40">{user.has_keys ? 'vault' : '—'}</td>
                                        <td className="px-4 py-3">
                                            {user.disabled
                                                ? <span className="text-red-400">disabled</span>
                                                : <span className="text-[#d4f939]">active</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right space-x-2">
                                            <button
                                                disabled={busy}
                                                onClick={() => patch({ userId: user.id, disabled: !user.disabled })}
                                                className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-[#d4f939]/60 text-xs"
                                            >
                                                {user.disabled ? 'Enable' : 'Disable'}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => {
                                                    if (window.confirm(`Delete ${user.email} permanently? Their keys, tasks and jobs go too.`)) {
                                                        patch({ userId: user.id, action: 'delete' });
                                                    }
                                                }}
                                                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:border-red-400 text-xs"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-white/30">No accounts yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {users && (
                    <>
                        <div className="mt-10 mb-3 flex flex-wrap items-center gap-3">
                            <h2 className="text-lg font-bold text-white">
                                {focusUser ? `Jobs for ${focusUser.email}` : 'Render jobs'}
                            </h2>
                            {focusUser && (
                                <button type="button" onClick={() => setFocusUser(null)}
                                    className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:border-white/35 hover:text-white">
                                    ← all users
                                </button>
                            )}
                            <div className="ml-auto flex gap-1.5">
                                {['', 'done', 'failed', 'rendering'].map((value) => (
                                    <button key={value || 'all'} type="button" onClick={() => setStatusFilter(value)}
                                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                                            statusFilter === value
                                                ? 'border-[#d4f939]/50 bg-[#d4f939]/10 text-[#d4f939]'
                                                : 'border-white/12 text-white/50 hover:border-white/30 hover:text-white'
                                        }`}>
                                        {value || 'all'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {jobs.map((job) => {
                                const expanded = openJob === job.id;
                                const refs = [
                                    job.input.startFrame && ['First frame', job.input.startFrame],
                                    job.input.endFrame && ['Last frame', job.input.endFrame],
                                    ...(job.input.references || []).map((url, i) => [`Reference ${i + 1}`, url]),
                                ].filter(Boolean);
                                return (
                                    <div key={job.id} className="rounded-xl border border-white/10 bg-white/[0.02]">
                                        <button type="button" onClick={() => setOpenJob(expanded ? null : job.id)}
                                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                                job.status === 'done' ? 'bg-[#d4f939]/15 text-[#d4f939]'
                                                : job.status === 'failed' ? 'bg-red-500/15 text-red-400'
                                                : 'bg-amber-400/15 text-amber-300'}`}>
                                                {job.status}
                                            </span>
                                            <span className="shrink-0 text-[11px] text-white/40">{String(job.createdAt).slice(5, 16).replace('T', ' ')}</span>
                                            <span className="shrink-0 text-[11px] text-white/60">{job.who}</span>
                                            <span className="shrink-0 text-[11px] text-white/40">{job.input.model || '—'}</span>
                                            <span className="min-w-0 flex-1 truncate text-[11px] text-white/45">{job.input.prompt || '(no prompt)'}</span>
                                            {job.result.costUsd ? <span className="shrink-0 text-[11px] text-white/40">${job.result.costUsd.toFixed(2)}</span> : null}
                                            <span className="shrink-0 text-white/30">{expanded ? '▾' : '▸'}</span>
                                        </button>

                                        {expanded && (
                                            <div className="grid gap-4 border-t border-white/8 px-4 py-3 md:grid-cols-2">
                                                <div className="space-y-3">
                                                    <div>
                                                        <span className="text-[10px] uppercase tracking-wider text-white/35">Prompt sent</span>
                                                        <p className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-black/40 p-2.5 text-[11px] leading-relaxed text-white/70">
                                                            {job.input.prompt || '(none)'}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] uppercase tracking-wider text-white/35">Settings</span>
                                                        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                                            {[['Kind', job.kind], ['Model', job.input.model], ['Duration', job.input.duration && `${job.input.duration}s`],
                                                              ['Ratio', job.input.ratio], ['Resolution', job.input.resolution],
                                                              ['Charged', job.result.costUsd ? `$${job.result.costUsd.toFixed(2)}` : null],
                                                              ['Vision used', job.result.visionUsed === null ? null : String(job.result.visionUsed)]]
                                                              .filter(([, value]) => value).map(([label, value]) => (
                                                                <div key={label} className="flex gap-2">
                                                                    <dt className="text-white/35">{label}</dt>
                                                                    <dd className="text-white/70">{value}</dd>
                                                                </div>
                                                            ))}
                                                        </dl>
                                                    </div>
                                                    {job.error && (
                                                        <div>
                                                            <span className="text-[10px] uppercase tracking-wider text-red-400/70">Failure reason</span>
                                                            <p className="mt-1 rounded-lg bg-red-500/5 p-2.5 text-[11px] leading-relaxed text-red-300/90">{job.error}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="space-y-3">
                                                    {refs.length > 0 && (
                                                        <div>
                                                            <span className="text-[10px] uppercase tracking-wider text-white/35">What the user uploaded</span>
                                                            <div className="mt-1 flex flex-wrap gap-2">
                                                                {refs.map(([label, url]) => (
                                                                    <figure key={label} className="w-24">
                                                                        <img src={url} alt={label} className="h-16 w-24 rounded border border-white/10 object-cover" />
                                                                        <figcaption className="mt-0.5 text-[9px] text-white/35">{label}</figcaption>
                                                                    </figure>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <span className="text-[10px] uppercase tracking-wider text-white/35">Result</span>
                                                        {job.result.url ? (
                                                            job.kind === 'image' ? (
                                                                <img src={job.result.url} alt="result" className="mt-1 max-h-56 rounded-lg border border-white/10" />
                                                            ) : (
                                                                <video src={job.result.url} controls className="mt-1 max-h-56 w-full rounded-lg border border-white/10 bg-black" />
                                                            )
                                                        ) : (
                                                            <p className="mt-1 text-[11px] text-white/35">No output — {job.status === 'failed' ? 'the render failed' : 'still running'}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {jobs.length === 0 && (
                                <p className="rounded-xl border border-white/10 px-3 py-6 text-center text-xs text-white/30">No jobs match this view.</p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
