"use client";

// One task list for the whole studio.
//
// Every tab used to keep its own board in its own component state, so a render
// started in Cinema was invisible from Workspace, and switching tabs looked
// like the work had vanished. It hadn't — the server pipeline was still
// running it — but nothing in the UI could say so.
//
// This store is the single place a task exists. Studios submit into it and
// return immediately; the poller lives here and keeps running while the user
// works somewhere else; the board subscribes and renders whatever is in
// flight, on every tab.
//
// Persistence is layered, deliberately: memory is the truth for this session,
// localStorage survives a reload, and the server's /api/jobs survives the
// browser entirely. On boot we merge all three.

import { pollRenderJob, retryRenderJob, submitImageJob, submitVideoJob } from "../muapi.js";

const STORAGE_KEY = "studio_tasks_v2";
const LEGACY_KEY = "workspace_tasks_v1"; // the Workspace-only board this replaces
const MAX_TASKS = 80;
const POLL_INTERVAL_MS = 5000;

let tasks = [];
let hydrated = false;
const listeners = new Set();

function isTerminal(task) {
  return task.status === "done" || task.status === "failed";
}

function notify() {
  for (const listener of listeners) listener(tasks);
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    // Data URLs are megabytes each and blow the 5 MB quota apart — the durable
    // copy lives on the asset host, so drop them from the snapshot.
    const slim = tasks.slice(0, MAX_TASKS).map((task) => ({
      ...task,
      url: typeof task.url === "string" && task.url.startsWith("data:") ? null : task.url,
      thumb: typeof task.thumb === "string" && task.thumb.startsWith("data:") ? null : task.thumb,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    // Quota exceeded: the board still works from memory for this session.
  }
}

function setTasks(next) {
  tasks = next.slice(0, MAX_TASKS);
  persist();
  notify();
}

// Union by id. A terminal copy always beats a stale "rendering" one, whichever
// side it came from — the server finishing a job it knows about must not be
// undone by a localStorage snapshot taken before it finished.
function merge(a, b) {
  const byId = new Map();
  for (const task of [...a, ...b]) {
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      continue;
    }
    byId.set(task.id, isTerminal(task) && !isTerminal(existing) ? task : existing);
  }
  return [...byId.values()].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
}

function readStorage(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function taskFromJob(job) {
  return {
    id: job.id,
    jobId: job.id,
    source: job.kind === "image" ? "Image" : "Video",
    type: job.kind === "image" ? "image" : "video",
    prompt: job.spec?.prompt || "",
    model: job.spec?.model || null,
    settings: {
      model: job.spec?.model || null,
      duration: job.spec?.duration ?? null,
      aspect: job.spec?.aspect_ratio || null,
    },
    status: job.status === "done" ? "done" : job.status === "failed" ? "failed" : "rendering",
    url: job.videoUrl || null,
    error: job.error || null,
    costUsd: job.costUsd ?? null,
    createdAt: new Date(job.createdAt).getTime() || Date.now(),
  };
}

export function getTasks() {
  return tasks;
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(tasks);
  return () => listeners.delete(listener);
}

export function updateTask(id, patch) {
  setTasks(tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)));
}

export function removeTask(id) {
  setTasks(tasks.filter((task) => task.id !== id));
}

export function addTask(task) {
  setTasks([{ status: "rendering", createdAt: Date.now(), ...task }, ...tasks]);
  return task.id;
}

// ── Boot ────────────────────────────────────────────────────────────────────

export async function hydrate(apiKey) {
  if (typeof window === "undefined") return;
  if (!hydrated) {
    hydrated = true;
    // A render with no id behind it was interrupted before the server ever
    // heard about it — nothing is coming, so say so rather than spin forever.
    const local = [...readStorage(STORAGE_KEY), ...readStorage(LEGACY_KEY)].map((task) =>
      task.status === "rendering" && !task.jobId && !task.taskId
        ? { ...task, status: "failed", error: "Interrupted before submit — run again" }
        : task,
    );
    setTasks(merge(local, []));
  }
  if (!apiKey) return;
  try {
    const response = await fetch("/api/jobs", { headers: { "x-superb-key": apiKey } });
    if (!response.ok) return;
    const { jobs } = await response.json();
    if (Array.isArray(jobs) && jobs.length > 0) {
      setTasks(merge((jobs || []).map(taskFromJob), tasks));
    }
  } catch {
    // Offline: the local board is still correct, just not fresh.
  }
}

// ── Background poller ───────────────────────────────────────────────────────
// One interval for the whole app, started once. It watches every unfinished
// task no matter which tab created it, which is what lets a user submit in
// Cinema, walk over to Images, and still see the clip land.

let pollTimer = null;
const pollingIds = new Set();

function watch(task) {
  const handle = task.jobId || task.taskId;
  if (!handle || pollingIds.has(task.id)) return;
  pollingIds.add(task.id);
  pollRenderJob(task.jobId || task.taskId)
    .then((result) => updateTask(task.id, { status: "done", url: result.url, error: null }))
    .catch((error) =>
      updateTask(task.id, {
        status: "failed",
        error: error?.message?.slice(0, 200) || "Render failed",
      }),
    )
    .finally(() => pollingIds.delete(task.id));
}

export function startPolling() {
  if (pollTimer || typeof window === "undefined") return;
  const tick = () => tasks.filter((task) => !isTerminal(task)).forEach(watch);
  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

// ── Submitting ──────────────────────────────────────────────────────────────
// These return as soon as the job exists server-side. They deliberately do NOT
// wait for the render: the caller gets a task id, the poller does the rest,
// and the UI stays usable.

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function submitVideo(params, meta = {}) {
  const id = newId("t");
  addTask({
    id,
    source: meta.source || "Video",
    type: "video",
    prompt: params.prompt || "",
    model: meta.modelLabel || params.videoModel || null,
    settings: meta.settings || null,
    thumb: meta.thumb || null,
    estimatedCost: meta.estimatedCost ?? null,
  });
  try {
    await submitVideoJob({
      ...params,
      onJobId: (jobId) => {
        updateTask(id, { jobId });
        startPolling();
      },
    });
  } catch (error) {
    updateTask(id, { status: "failed", error: error?.message?.slice(0, 200) || "Submit failed" });
  }
  return id;
}

export async function submitImage(params, meta = {}) {
  const id = newId("t");
  addTask({
    id,
    source: meta.source || "Image",
    type: "image",
    prompt: params.prompt || "",
    model: meta.modelLabel || null,
    settings: meta.settings || null,
    thumb: meta.thumb || null,
  });
  try {
    await submitImageJob({
      ...params,
      onJobId: (jobId) => {
        updateTask(id, { jobId });
        startPolling();
      },
    });
  } catch (error) {
    updateTask(id, { status: "failed", error: error?.message?.slice(0, 200) || "Submit failed" });
  }
  return id;
}

export async function retryTask(id) {
  const task = tasks.find((entry) => entry.id === id);
  if (!task?.jobId) return;
  updateTask(id, { status: "rendering", error: null });
  try {
    const jobId = await retryRenderJob(task.jobId);
    updateTask(id, { jobId });
    startPolling();
  } catch (error) {
    updateTask(id, { status: "failed", error: error?.message?.slice(0, 200) || "Retry failed" });
  }
}
