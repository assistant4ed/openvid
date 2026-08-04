"use client";

import { useEffect, useState } from "react";

import {
  getTasks,
  hydrate,
  removeTask,
  retryTask,
  startPolling,
  subscribe,
  subscribeOutage,
} from "../utils/taskStore.js";

// The task board, rendered once for the whole studio instead of once per tab.
//
// It shows every render in flight no matter where it was started, so leaving a
// tab never looks like losing work. Generation is fire-and-forget: the panel is
// where progress lives, which is what frees the main canvas to stay usable.

const BOARD_KEY = "studio_board_open";
const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
];

function statusTone(status) {
  if (status === "done") return "text-[#d6ff3f]";
  if (status === "failed") return "text-red-400/90";
  return "text-white/50";
}

function elapsed(createdAt) {
  const seconds = Math.max(0, Math.round((Date.now() - (createdAt || Date.now())) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Reuse is announced, not wired: the board is mounted by the shell and the
// composer that can act on a task lives in whichever studio is open. An event
// keeps the two from having to know about each other.
function announceReuse(task) {
  window.dispatchEvent(new CustomEvent("studio:reuse-task", { detail: task }));
}

export default function TaskBoard({ apiKey, onReuse = announceReuse }) {
  const [tasks, setTasks] = useState(getTasks());
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState(null);
  // Re-render every second so the elapsed clocks on running tasks tick.
  const [, setTick] = useState(0);

  const [outage, setOutage] = useState(null);

  useEffect(() => subscribe(setTasks), []);
  useEffect(() => subscribeOutage(setOutage), []);

  useEffect(() => {
    setOpen(window.localStorage.getItem(BOARD_KEY) !== "closed");
    hydrate(apiKey).then(startPolling);
  }, [apiKey]);

  const running = tasks.filter((task) => task.status === "rendering").length;

  useEffect(() => {
    if (running === 0) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem(BOARD_KEY, next ? "open" : "closed");
  };

  const visible = tasks.filter((task) => filter === "all" || task.type === filter);
  // One outage produces one red card per attempt. Sweeping them in a single
  // click beats pressing Delete eighty times.
  const failedCount = visible.filter((task) => task.status === "failed").length;
  const clearFailed = () => visible
    .filter((task) => task.status === "failed")
    .forEach((task) => removeTask(task.id));

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        title="Unfold task board"
        className="fixed right-0 top-24 z-40 flex items-center gap-2 rounded-l-lg border border-r-0 border-white/10 bg-black/80 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/60 backdrop-blur hover:text-white"
      >
        <span>Tasks</span>
        {running > 0 && (
          <span className="rounded-full bg-[#d6ff3f] px-1.5 py-0.5 text-[9px] font-bold text-black">
            {running}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-white/10 bg-black/40">
        <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={toggle}
            title="Fold task board"
            className="text-white/40 hover:text-white"
          >
            ›
          </button>
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">
            Task board · {tasks.length}
          </span>
          {running > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-[#d6ff3f]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d6ff3f]" />
              {running} running
            </span>
          )}
        </header>

        <div className="flex gap-1 border-b border-white/10 px-3 py-2">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={`rounded px-2 py-1 text-[10px] uppercase tracking-wider ${
                filter === entry.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {outage && (
          <div className="border-b border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/90">
              Rendering paused
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
              {outage.message}
            </p>
          </div>
        )}

        {failedCount > 1 && (
          <button
            type="button"
            onClick={clearFailed}
            className="border-b border-white/10 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/40 hover:text-white/80"
          >
            Clear {failedCount} failed
          </button>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {visible.length === 0 && (
            <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-white/30">
              Nothing here yet. Anything you generate — in any tab — shows up
              here and keeps running while you work.
            </p>
          )}

          {visible.map((task) => (
            <article key={task.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/50">
                  {task.source || task.type}
                </span>
                <span className={`ml-auto text-[10px] ${statusTone(task.status)}`}>
                  {task.status === "rendering" ? `rendering · ${elapsed(task.createdAt)}` : task.status}
                </span>
              </div>

              {task.status === "done" && task.url && (
                task.type === "image" ? (
                  <button type="button" onClick={() => setPreview(task)} className="block w-full">
                    <img src={task.url} alt="" className="w-full rounded" />
                  </button>
                ) : (
                  <video src={task.url} controls playsInline className="w-full rounded" />
                )
              )}

              {task.status === "rendering" && (
                <div className="relative overflow-hidden rounded bg-white/5">
                  {task.thumb && <img src={task.thumb} alt="" className="w-full opacity-30" />}
                  <div className={`${task.thumb ? "absolute inset-0" : ""} flex items-center justify-center py-6`}>
                    <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-[#d6ff3f]" />
                  </div>
                </div>
              )}

              {task.status === "failed" && (
                <p className="rounded bg-red-500/5 px-2 py-2 text-[10px] leading-relaxed text-red-400/90">
                  {task.error || "Render failed"}
                </p>
              )}

              <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-white/60">{task.prompt}</p>

              <div className="mt-1.5 flex flex-wrap gap-1">
                {task.status === "done" && task.url && (
                  <a
                    href={task.url}
                    download
                    className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/50 hover:text-white"
                  >
                    Download
                  </a>
                )}
                {task.status === "failed" && task.jobId && (
                  <button
                    type="button"
                    onClick={() => retryTask(task.id)}
                    className="rounded border border-[#d6ff3f]/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#d6ff3f] hover:bg-[#d6ff3f]/10"
                  >
                    Retry
                  </button>
                )}
                {onReuse && (
                  <button
                    type="button"
                    onClick={() => onReuse(task)}
                    className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/50 hover:text-white"
                  >
                    Reuse
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeTask(task.id)}
                  className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/30 hover:text-red-400/90"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </aside>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-8"
          onClick={() => setPreview(null)}
        >
          <img src={preview.url} alt="" className="max-h-full max-w-full rounded" />
        </div>
      )}
    </>
  );
}
