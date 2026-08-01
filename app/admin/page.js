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
            const jobsResponse = await fetch('/api/admin/jobs', { headers: { 'x-admin-token': activeToken } });
            if (jobsResponse.ok) setJobs((await jobsResponse.json()).jobs || []);
        } catch (err) {
            setUsers(null);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }, []);

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
                        <h2 className="text-lg font-bold text-white mt-10 mb-3">Recent render jobs</h2>
                        <div className="border border-white/10 rounded-2xl overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-white/5 text-white/40 text-left">
                                    <tr>
                                        <th className="px-3 py-2.5 font-medium">When</th>
                                        <th className="px-3 py-2.5 font-medium">Who</th>
                                        <th className="px-3 py-2.5 font-medium">Kind</th>
                                        <th className="px-3 py-2.5 font-medium">Model</th>
                                        <th className="px-3 py-2.5 font-medium">Prompt</th>
                                        <th className="px-3 py-2.5 font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map((job) => (
                                        <tr key={job.id} className="border-t border-white/5 align-top">
                                            <td className="px-3 py-2 text-white/40 whitespace-nowrap">{String(job.createdAt).slice(5, 16).replace('T', ' ')}</td>
                                            <td className="px-3 py-2 text-white/60">{job.who}</td>
                                            <td className="px-3 py-2 text-white/40">{job.kind}</td>
                                            <td className="px-3 py-2 text-white/60">{job.model || '—'}</td>
                                            <td className="px-3 py-2 text-white/40 max-w-[260px] truncate" title={job.prompt || ''}>{job.prompt || '—'}</td>
                                            <td className="px-3 py-2">
                                                {job.status === 'done' && <span className="text-[#d4f939]">done</span>}
                                                {job.status === 'failed' && <span className="text-red-400" title={job.error || ''}>failed</span>}
                                                {!['done', 'failed'].includes(job.status) && <span className="text-amber-300">{job.status}</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {jobs.length === 0 && (
                                        <tr><td colSpan={6} className="px-3 py-6 text-center text-white/30">No jobs yet.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
