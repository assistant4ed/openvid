"use client";

import { useEffect, useRef, useState } from "react";

import {
  pollRenderJob,
  pollSuperbVideoTask,
  retryRenderJob,
  submitImageJob,
  submitVideoJob,
} from "../muapi.js";
import { CAMERA_PATH_PRESETS } from "../utils/cameraPathPresets.js";
import { notifyError, notifyInfo } from "../utils/notify.js";
import {
  PromptAction,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptTextarea,
  promptControlClassName,
} from "./prompt/PromptComposer.jsx";
import UploadZone from "./UploadZone.jsx";

// The Workspace, studio-style: hero + one composer bar that carries EVERY
// setting as chips (mode, sources, model, duration, aspect, camera move),
// plus the foldable task board. Modes enumerate every way to generate —
// live ones run, future ones are honestly marked with what unlocks them.

const TASKS_KEY = "workspace_tasks_v1";
const BOARD_KEY = "workspace_board_open";
const MAX_TASKS = 60;
const ASPECTS = ["16:9", "9:16", "1:1"];

const HERO_ART = [
  "/showcase/neon-alley.jpg",
  "/showcase/glacier-reveal.jpg",
  "/showcase/orbit-dancer.jpg",
  "/showcase/dolly-diner.jpg",
];

// Every way to generate. sources: which chips appear. live:false modes state
// their unlock condition instead of failing.
const MODES = [
  // ── video ──
  { id: "t2v", group: "Video", label: "Text → Video", hint: "Describe a shot", live: true,
    gif: "/showcase/gifs/neon-alley.gif", sources: [] },
  { id: "i2v", group: "Video", label: "Image → Video", hint: "Animate a start frame", live: true,
    gif: "/showcase/gifs/fn-i2v.gif", sources: ["start"] },
  { id: "camera", group: "Video", label: "Camera Move", hint: "Preset move on your frame", live: true,
    gif: "/showcase/gifs/glacier-reveal.gif", sources: ["start"], camera: true },
  { id: "frames2v", group: "Video", label: "Start + End Frame", hint: "Start on one image, end on another", live: true,
    gif: "/showcase/gifs/fn-frames.gif", sources: ["start", "end"] },
  { id: "refv2v", group: "Video", label: "Reference Video", hint: "Needs a video-edit model", live: false,
    gif: "/showcase/gifs/orbit-dancer.gif", sources: ["video"] },
  { id: "refmix2v", group: "Video", label: "Video + Images", hint: "Needs an omni-reference model", live: false,
    gif: "/showcase/gifs/orbit-dancer.gif", sources: ["video", "ref"] },
  // ── image ──
  { id: "t2i", group: "Image", label: "Create Image", hint: "From a description", live: true,
    gif: "/showcase/gifs/fn-create.gif", sources: [] },
  { id: "i2i", group: "Image", label: "Edit Photo", hint: "Change things in a picture", live: true,
    gif: "/showcase/gifs/fn-edit.gif", sources: ["ref"] },
  { id: "combine", group: "Image", label: "Combine Photos", hint: "Blend two references", live: true,
    gif: "/showcase/gifs/fn-combine.gif", sources: ["ref", "ref2"],
    prefix: "Combine these reference photos into one coherent image: " },
  { id: "restyle", group: "Image", label: "Restyle Photo", hint: "Same photo, new art style", live: true,
    backend: "i2i", gif: "/showcase/gifs/fn-restyle.gif", sources: ["ref"],
    prefix: "Restyle this photo. Keep the subject, pose and composition identical; change only the artistic style to: " },
  { id: "remove", group: "Image", label: "Remove Objects", hint: "Clean things out of a photo", live: true,
    backend: "i2i", gif: "/showcase/gifs/fn-remove.gif", sources: ["ref"],
    prefix: "Remove the following from this photo, reconstructing the background naturally; everything else stays identical: " },
  { id: "product", group: "Image", label: "Product Shot", hint: "Studio-grade product photo", live: true,
    backend: "t2i", gif: "/showcase/gifs/fn-product.gif", sources: [],
    prefix: "Professional studio product photograph, clean background, dramatic key light: " },
  // ── audio ──
  { id: "music", group: "Audio", label: "Music", hint: "Needs an audio model on your key", live: false,
    gif: "/showcase/gifs/neon-alley.gif", sources: [] },
];

const MODE_GROUPS = ["Video", "Image", "Audio"];

// Attachment slots the user can add to the bar on top of the mode's own —
// "first frame / last frame / reference images" — each opens an upload frame.
// Renders run server-side, so the browser is no longer the bottleneck; this
// only keeps a single user from flooding the gateway's 8/min submit window.
const MAX_CONCURRENT = 4;

const SOURCE_DEFS = {
  start: { chip: "First frame", desc: "The shot starts on this image" },
  end: { chip: "Last frame", desc: "The shot aims to end composed like this — matched by AI description, approximate (no model on this gateway takes a literal end frame yet)" },
  ref: { chip: "Reference", desc: "Carry this look or subject into the result" },
  ref2: { chip: "Reference 2", desc: "A second reference image" },
};

function addableSources(mode) {
  if (!mode.live) return [];
  if (mode.group === "Video") return ["start", "end", "ref", "music", "script"];
  if (mode.group === "Image") return ["ref", "ref2"];
  return [];
}

// Text add-ons that shape the SOUNDTRACK rather than the picture. They fold
// into the prompt; models with audio render them, silent models can't (the
// composer warns before spending).
const AUDIO_ADDONS = {
  music: {
    chip: "Music",
    desc: "Background music to score the clip",
    placeholder: "e.g. warm lo-fi piano, slow build, hopeful",
    render: (value) => `Background music: ${value}.`,
  },
  script: {
    chip: "Voiceover",
    desc: "Words spoken aloud in the clip",
    placeholder: "e.g. Every Lunar New Year, we come home.",
    render: (value) => `Spoken voiceover, clearly audible: "${value}"`,
  },
};

function loadTasks() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TASKS_KEY) || "[]");
    // Video runs live server-side now (jobId) — only image tasks, which still
    // render in-browser, can be orphaned by a reload.
    return parsed.map((task) =>
      task.status === "rendering" && !task.taskId && !task.jobId
        ? { ...task, status: "failed", error: "Interrupted before submit — run again" }
        : task,
    );
  } catch {
    return [];
  }
}

function persistTasks(tasks) {
  try {
    const slim = tasks.slice(0, MAX_TASKS).map((task) => ({
      ...task,
      url: typeof task.url === "string" && task.url.startsWith("data:") ? null : task.url,
    }));
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(slim));
  } catch {
    // storage full — board still works in memory
  }
}

function readCaps() {
  try {
    return JSON.parse(window.localStorage.getItem("superb_caps_v1") || "null");
  } catch {
    return null;
  }
}

// Merge the server task history into the local board. Union by id; when both
// sides know a task, a terminal copy (done/failed) beats a stale "rendering"
// one, and otherwise the local copy wins (it may hold an in-flight poller).
function mergeTaskLists(local, remote) {
  const terminal = (task) => task.status === "done" || task.status === "failed";
  const byId = new Map();
  for (const task of remote) byId.set(task.id, task);
  for (const task of local) {
    const other = byId.get(task.id);
    byId.set(task.id, other && terminal(other) && !terminal(task) ? other : task);
  }
  return [...byId.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_TASKS);
}

export default function WorkspaceStudio({ apiKey }) {
  const [modeId, setModeId] = useState("t2v");
  const [openPopover, setOpenPopover] = useState(null); // 'mode'|'start'|'ref'|'ref2'|'model'|'duration'|'aspect'|'camera'
  const [prompt, setPrompt] = useState("");
  const [startFrame, setStartFrame] = useState(null);
  const [endFrame, setEndFrame] = useState(null);
  const [refImage, setRefImage] = useState(null);
  const [refImage2, setRefImage2] = useState(null);
  const [added, setAdded] = useState([]); // user-added source keys beyond the mode's own
  const [preset, setPreset] = useState("dolly-in");
  const [music, setMusic] = useState("");
  const [script, setScript] = useState("");
  const [previewTask, setPreviewTask] = useState(null);
  const [videoModel, setVideoModel] = useState("");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState("16:9");
  const [tasks, setTasks] = useState([]);
  const [caps, setCaps] = useState(null);
  const [boardOpen, setBoardOpen] = useState(true);
  const [restoredFrom, setRestoredFrom] = useState(null);
  const activeCount = useRef(0);
  const composerRef = useRef(null);

  const mode = MODES.find((entry) => entry.id === modeId) || MODES[0];
  const isVideo = mode.group === "Video";
  // Chips on the bar = the mode's own sources + whatever the user added.
  const activeSources = [...mode.sources, ...added.filter((key) => !mode.sources.includes(key))];
  const addable = addableSources(mode).filter((key) => !activeSources.includes(key));
  const sourceValues = {
    start: startFrame, end: endFrame, ref: refImage, ref2: refImage2,
    music, script,
  };
  const sourceSetters = {
    start: setStartFrame, end: setEndFrame, ref: setRefImage, ref2: setRefImage2,
    music: setMusic, script: setScript,
  };

  const switchMode = (nextId) => {
    setModeId(nextId);
    setAdded([]);
  };

  const sourceChipLabel = (key) => {
    if (key === "ref" && (mode.sources.includes("ref2") || activeSources.includes("ref2"))) return "Photo 1";
    if (key === "ref2") return "Photo 2";
    if (key === "ref") return mode.group === "Image" ? "Photo" : "Reference";
    if (key === "start") return isVideo ? "First frame" : "Start frame";
    if (key === "end") return "Last frame";
    if (AUDIO_ADDONS[key]) return AUDIO_ADDONS[key].chip;
    return SOURCE_DEFS[key]?.chip || key;
  };

  const updateTask = (id, patch) => {
    setTasks((previous) => {
      const next = previous.map((task) => (task.id === id ? { ...task, ...patch } : task));
      persistTasks(next);
      return next;
    });
  };

  // Server sync: signed-in users keep their board across browsers and
  // devices. Local-first — a 401 (signed out) or missing DB is a silent no-op.
  const serverSyncReady = useRef(false);
  const pushTimer = useRef(null);
  const [historySync, setHistorySync] = useState("unknown"); // 'on' | 'off' | 'unknown'
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/account/tasks");
        if (!cancelled) setHistorySync(response.ok ? "on" : "off");
        if (response.ok && !cancelled) {
          const data = await response.json();
          if (Array.isArray(data.tasks) && data.tasks.length > 0) {
            setTasks((local) => {
              const merged = mergeTaskLists(local, data.tasks);
              persistTasks(merged);
              // Reconnect to server-known renders this browser never saw.
              merged
                .filter((task) => task.status === "rendering" && (task.jobId || task.taskId) &&
                  !local.some((entry) => entry.id === task.id))
                .forEach((task) => {
                  const resume = task.jobId
                    ? pollRenderJob(task.jobId)
                    : pollSuperbVideoTask(task.taskId);
                  resume
                    .then((result) => updateTask(task.id, { status: "done", url: result.url }))
                    .catch((error) => updateTask(task.id, {
                      status: "failed",
                      error: error?.message?.slice(0, 140) || "Task failed",
                    }));
                });
              return merged;
            });
          }
        }
      } catch {
        // offline or accounts disabled — board stays local
      }
      if (!cancelled) serverSyncReady.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Push the board after every change, debounced. Never before the initial
  // merge finished — an empty fresh browser must not wipe server history.
  useEffect(() => {
    if (!serverSyncReady.current || tasks.length === 0) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      fetch("/api/account/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: tasks.slice(0, MAX_TASKS) }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(pushTimer.current);
  }, [tasks]);

  useEffect(() => {
    if (!previewTask) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setPreviewTask(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewTask]);

  useEffect(() => {
    const loaded = loadTasks();
    setTasks(loaded);
    setCaps(readCaps());
    setBoardOpen(window.localStorage.getItem(BOARD_KEY) !== "closed");
    const handleCaps = (event) => setCaps(event.detail);
    window.addEventListener("superb:caps", handleCaps);

    // Renders continue server-side while the user is away — reconnect to
    // every unfinished task instead of abandoning it. jobId = the server
    // pipeline; taskId = legacy direct upstream polling.
    loaded
      .filter((task) => task.status === "rendering" && (task.jobId || task.taskId))
      .forEach((task) => {
        const resume = task.jobId
          ? pollRenderJob(task.jobId)
          : pollSuperbVideoTask(task.taskId);
        resume
          .then((result) => updateTask(task.id, { status: "done", url: result.url }))
          .catch((error) =>
            updateTask(task.id, {
              status: "failed",
              error: error?.message?.slice(0, 140) || "Task failed",
            }),
          );
      });

    return () => window.removeEventListener("superb:caps", handleCaps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (composerRef.current && !composerRef.current.contains(event.target)) setOpenPopover(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggleBoard = () => {
    const next = !boardOpen;
    setBoardOpen(next);
    window.localStorage.setItem(BOARD_KEY, next ? "open" : "closed");
  };

  const capsVideo = caps?.video || [];
  const capsModel = capsVideo.find((entry) => entry.id === videoModel) || capsVideo[0] || null;
  useEffect(() => {
    if (capsModel && videoModel !== capsModel.id) setVideoModel(capsModel.id);
  }, [capsModel, videoModel]);

  // Keep the duration valid for the chosen model (Veo only renders 8s, Grok
  // 6s, Kling 5/10s…) — snap to the model's first allowed length on switch.
  useEffect(() => {
    const allowed = capsModel?.durations;
    if (allowed?.length && !allowed.includes(duration)) setDuration(allowed[0]);
  }, [capsModel, duration]);

  // A frame-based mode can't run on a text-only model — steer to a
  // frame-capable one, preferring pixel-exact (Seedance starts on the literal
  // uploaded frame; the rest are vision-assisted approximations).
  const frameMode = isVideo && activeSources.some((key) => key === "start" || key === "end");
  useEffect(() => {
    if (frameMode && capsModel?.image === false) {
      const capable =
        capsVideo.find((entry) => entry.frameExact && entry.image !== false) ||
        capsVideo.find((entry) => entry.image !== false);
      if (capable) setVideoModel(capable.id);
    }
  }, [frameMode, capsModel, capsVideo]);

  // Opening the model menu scrolls the current model into view — with a
  // dozen-plus verified models the selection must never sit off-screen.
  useEffect(() => {
    if (openPopover === "model") {
      document.getElementById("ws-model-selected")?.scrollIntoView({ block: "center" });
    }
  }, [openPopover]);

  const deleteTask = (id) => {
    setTasks((previous) => {
      const next = previous.filter((task) => task.id !== id);
      persistTasks(next);
      return next;
    });
  };

  // Re-run a failed job: the server clones its stored spec (frames included),
  // so retry works even in a browser that never saw the original upload.
  const retryTask = async (task) => {
    try {
      const jobId = await retryRenderJob(task.jobId);
      updateTask(task.id, { status: "rendering", error: null, jobId });
      const result = await pollRenderJob(jobId);
      updateTask(task.id, { status: "done", url: result.url });
    } catch (error) {
      updateTask(task.id, {
        status: "failed",
        error: error?.message?.slice(0, 140) || "Retry failed",
      });
    }
  };

  const restoreTask = async (task) => {
    const settings = task.settings || {};
    if (settings.modeId && MODES.some((entry) => entry.id === settings.modeId)) switchMode(settings.modeId);
    setPrompt(task.prompt || "");
    if (settings.preset) setPreset(settings.preset);
    if (settings.model) setVideoModel(settings.model);
    if (settings.duration) setDuration(settings.duration);
    if (settings.aspect) setAspect(settings.aspect);
    setRestoredFrom(task.id);
    // The server job still holds the uploaded frames as asset URLs — pull
    // them back onto the chips so a reuse run really reuses the images.
    if (task.jobId && apiKey) {
      try {
        const response = await fetch(`/api/jobs/${task.jobId}`, { headers: { "x-superb-key": apiKey } });
        if (response.ok) {
          const spec = (await response.json()).spec || {};
          const extras = [];
          if (spec.image_url) { setStartFrame(spec.image_url); extras.push("start"); }
          if (spec.end_image_url) { setEndFrame(spec.end_image_url); extras.push("end"); }
          if (Array.isArray(spec.ref_urls)) {
            if (spec.ref_urls[0]) { setRefImage(spec.ref_urls[0]); extras.push("ref"); }
            if (spec.ref_urls[1]) { setRefImage2(spec.ref_urls[1]); extras.push("ref2"); }
          }
          if (extras.length > 0) setAdded((previous) => [...new Set([...previous, ...extras])]);
        }
      } catch {
        // frames unavailable (expired assets) — settings alone still restore
      }
    }
    notifyInfo("Task settings loaded — edit anything and generate again.");
  };

  const useAsStartFrame = (url) => {
    switchMode("i2v");
    setStartFrame(url);
  };

  const presetEntry = CAMERA_PATH_PRESETS.find((entry) => entry.id === preset);

  const handleCreate = async () => {
    const trimmed = prompt.trim();
    // Every chip on the bar must be filled — the mode's own are required, and
    // a user-added chip is a promise: fill it or remove it.
    for (const key of activeSources) {
      if (key === "video" || sourceValues[key]) continue;
      const label = sourceChipLabel(key);
      notifyError(
        AUDIO_ADDONS[key]
          ? `Write the ${label} text, or remove its chip (✕).`
          : mode.sources.includes(key)
            ? `${mode.label} needs the ${label} image — click its chip to upload.`
            : `Add the ${label} image, or remove its chip (✕).`,
      );
      setOpenPopover(key);
      return;
    }
    if (!trimmed && !startFrame && !refImage) {
      notifyError("Describe what to create first.");
      return;
    }
    if (activeCount.current >= MAX_CONCURRENT) {
      notifyError(`${MAX_CONCURRENT} tasks are already rendering — wait for one to finish.`);
      return;
    }
    // Text-only video models (Seedance 1.5 on this gateway) can't take frames.
    if (isVideo && capsModel?.image === false &&
        activeSources.some((key) => (key === "start" || key === "end") && sourceValues[key])) {
      notifyError(`${capsModel.name} is text-to-video only — pick Kling, Veo or PixVerse for frame-based runs.`);
      setOpenPopover("model");
      return;
    }

    const id = `ws_${Date.now()}`;
    const task = {
      id,
      type: mode.group.toLowerCase(),
      mode: mode.label,
      prompt: trimmed,
      model: isVideo ? capsModel?.name || "Kling 2.5" : "Gemini Image",
      preset: mode.camera ? presetEntry?.label || null : null,
      settings: { modeId, preset, model: capsModel?.id || null, duration, aspect },
      status: "rendering",
      url: null,
      error: null,
      createdAt: Date.now(),
    };
    setTasks((previous) => {
      const next = [task, ...previous];
      persistTasks(next);
      return next;
    });

    activeCount.current += 1;
    try {
      let result;
      // Only images whose chips are on the bar go into the run — a leftover
      // upload from another mode never leaks in.
      const chipValue = (key) => (activeSources.includes(key) ? sourceValues[key] : null);
      const chipRefs = ["ref", "ref2"].map(chipValue).filter(Boolean);
      if (!isVideo) {
        // Images ride the job pipeline too — grounding, render and storage
        // all happen server-side, so a reload can't orphan them anymore.
        const templated = mode.prefix ? `${mode.prefix}${trimmed}` : trimmed;
        result = await submitImageJob({
          prompt: templated,
          ...(chipRefs.length === 1 ? { image_url: chipRefs[0] } : {}),
          ...(chipRefs.length > 1 ? { images_list: chipRefs } : {}),
          onJobId: (jobId) => updateTask(id, { jobId }),
        });
      } else {
        const movePrefix = mode.camera && presetEntry
          ? `Camera move: ${presetEntry.label} (${presetEntry.hint}). `
          : "";
        // Video goes through the server-side job pipeline: the spec is safe
        // in the database before this promise resolves, so a reload (or a
        // closed laptop) can no longer kill the render.
        result = await submitVideoJob({
          prompt: `${movePrefix}${trimmed}`.trim(),
          videoModel: capsModel?.id,
          duration,
          aspect_ratio: aspect,
          ...(chipValue("start") ? { image_url: chipValue("start") } : {}),
          ...(chipValue("end") ? { end_image: chipValue("end") } : {}),
          ...(chipRefs.length > 0 ? { style_refs: chipRefs } : {}),
          onJobId: (jobId) => updateTask(id, { jobId }),
        });
      }
      if (!result?.url) throw new Error("No output returned");
      let finalUrl = result.url;
      // Image results arrive as data URLs, which never survive persistence
      // (or account sync) — park them on the durable asset host so the
      // picture is still there tomorrow and on other devices.
      if (finalUrl.startsWith("data:image/")) {
        try {
          const hosted = await fetch("/api/asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: finalUrl }),
          });
          if (hosted.ok) {
            const data = await hosted.json();
            if (data?.url) finalUrl = data.url;
          }
        } catch {
          // hosting failed — keep the data URL for this session
        }
      }
      updateTask(id, { status: "done", url: finalUrl });
    } catch (error) {
      updateTask(id, { status: "failed", error: error?.message?.slice(0, 140) || "Task failed" });
    } finally {
      activeCount.current -= 1;
    }
  };

  const rendering = tasks.filter((task) => task.status === "rendering").length;

  // Source chip: opens an upload frame; shows the thumbnail once set. Chips
  // the user added themselves carry a ✕ to take them off the bar again.
  const sourceChip = (key) => {
    const label = sourceChipLabel(key);
    const value = sourceValues[key];
    const setter = sourceSetters[key];
    const removable = !mode.sources.includes(key);
    const addon = AUDIO_ADDONS[key];
    if (addon) {
      return (
        <div className="relative flex items-center" key={key}>
          <button
            type="button"
            onClick={() => setOpenPopover(openPopover === key ? null : key)}
            className={promptControlClassName({
              active: openPopover === key || Boolean(value),
              compact: true,
              className: "!rounded-r-none !border-r-0",
            })}
          >
            {key === "music" ? "♪" : "🗣"} {label}
          </button>
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => {
              setter("");
              setAdded((previous) => previous.filter((entry) => entry !== key));
              if (openPopover === key) setOpenPopover(null);
            }}
            className={promptControlClassName({ compact: true, className: "!rounded-l-none !px-2 text-white/40 hover:!text-red-400/90" })}
          >
            ✕
          </button>
          {openPopover === key && (
            <PromptPopover className="!min-w-[320px] !max-h-none">
              <PromptPopoverHeader>{label}</PromptPopoverHeader>
              <p className="mb-2 px-1 text-[10px] leading-relaxed text-white/40">{addon.desc}</p>
              {isVideo && capsModel && !capsModel.audio && (
                <p className="mb-2 px-1 text-[10px] leading-relaxed text-amber-300/80">
                  {capsModel.name} renders SILENT video — pick Seedance 1.5 or
                  PixVerse (marked ♪) for a clip that actually has sound.
                </p>
              )}
              <textarea
                value={value}
                onChange={(event) => setter(event.target.value)}
                placeholder={addon.placeholder}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-[rgba(212,249,57,0.4)]"
              />
            </PromptPopover>
          )}
        </div>
      );
    }
    return (
      <div className="relative flex items-center" key={key}>
        <button
          type="button"
          onClick={() => setOpenPopover(openPopover === key ? null : key)}
          className={promptControlClassName({
            active: openPopover === key || Boolean(value),
            compact: true,
            className: removable ? "!rounded-r-none !border-r-0" : "",
          })}
        >
          {value ? (
            <img src={value} alt="" className="h-5 w-5 rounded object-cover" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
          {label}
        </button>
        {removable && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => {
              setter(null);
              setAdded((previous) => previous.filter((entry) => entry !== key));
              if (openPopover === key) setOpenPopover(null);
            }}
            className={promptControlClassName({ compact: true, className: "!rounded-l-none !px-2 text-white/40 hover:!text-red-400/90" })}
          >
            ✕
          </button>
        )}
        {openPopover === key && (
          <PromptPopover className="!min-w-[300px] !max-h-none">
            <PromptPopoverHeader>{label}</PromptPopoverHeader>
            <p className="mb-2 px-1 text-[10px] leading-relaxed text-white/40">{SOURCE_DEFS[key]?.desc}</p>
            <UploadZone
              kind="image"
              compact
              title={label}
              guidance="JPG/PNG/WebP up to 8MB — drag, click or paste"
              value={value}
              onChange={(next) => {
                setter(next);
                if (next) setOpenPopover(null);
              }}
              onError={notifyError}
            />
          </PromptPopover>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Main: hero + composer, exactly like the studios ── */}
      <div className="relative flex min-w-0 flex-1 flex-col items-center overflow-hidden bg-black">
        <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-44 px-4">
          <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center animate-fade-in-up">
            <div className="mb-10 flex select-none items-center justify-center gap-1.5 scale-90 sm:scale-100 md:gap-3">
              {HERO_ART.map((src, index) => (
                <div
                  key={src}
                  className={`h-28 w-24 flex-shrink-0 transform overflow-hidden rounded-2xl border border-white/10 shadow-2xl transition-all duration-300 hover:z-20 hover:rotate-0 hover:scale-110 ${
                    ["-rotate-[12deg]", "-rotate-[4deg]", "rotate-[6deg]", "rotate-[12deg]"][index]
                  } ${index > 0 ? "-ml-3 sm:-ml-4" : ""}`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
            <h1 className="mb-4 flex flex-col items-center px-4 text-center">
              <span className="slate-label slate-label--cyan mb-3">START CREATING WITH</span>
              <span className="font-display text-3xl font-bold tracking-tight text-[#d4f939] sm:text-5xl">
                {mode.label}
              </span>
            </h1>
            <p className="max-w-lg px-4 text-center text-xs font-medium leading-relaxed tracking-wide text-white/40 sm:text-sm">
              {mode.hint}. One bar, every setting — pick a mode to see all the
              ways to generate, from plain text to start&nbsp;+&nbsp;end frames and
              reference media.
            </p>
            {restoredFrom && (
              <p className="mt-4 font-slate text-[9px] uppercase tracking-wider text-primary/70">
                Loaded from a previous task — edit and generate again
              </p>
            )}
          </div>
        </div>

        {/* ── The composer bar — every setting lives here ── */}
        <div ref={composerRef} className="contents">
          <PromptComposer>
            <div className="flex w-full items-start gap-3 px-1">
              {/* Mode chip */}
              <div className="relative pt-0.5">
                <button
                  type="button"
                  onClick={() => setOpenPopover(openPopover === "mode" ? null : "mode")}
                  className={promptControlClassName({ active: true, compact: true })}
                >
                  {mode.label}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"
                    className={`transition-transform ${openPopover === "mode" ? "rotate-180" : ""}`}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {openPopover === "mode" && (
                  <PromptPopover className="!min-w-[420px] !max-h-[52vh]">
                    {MODE_GROUPS.map((groupName) => (
                      <div key={groupName} className="mb-2">
                        <PromptPopoverHeader>{groupName}</PromptPopoverHeader>
                        <PromptMenuList className="!grid !grid-cols-2 !gap-1">
                          {MODES.filter((entry) => entry.group === groupName).map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              disabled={!entry.live}
                              onClick={() => {
                                switchMode(entry.id);
                                setOpenPopover(null);
                              }}
                              className={`flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition-colors ${
                                modeId === entry.id
                                  ? "bg-[#d4f939]/10"
                                  : entry.live
                                    ? "hover:bg-white/[0.06]"
                                    : "cursor-not-allowed opacity-40"
                              }`}
                            >
                              <img src={entry.gif} alt="" loading="lazy"
                                className="h-9 w-14 shrink-0 rounded border border-white/10 object-cover" />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className={`truncate font-slate text-[9px] uppercase tracking-wider ${modeId === entry.id ? "text-[#d4f939]" : "text-white/75"}`}>
                                    {entry.label}
                                  </span>
                                  {!entry.live && (
                                    <span className="shrink-0 rounded border border-white/15 px-1 font-slate text-[7px] uppercase tracking-wider text-white/40">
                                      Soon
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-[9px] text-white/35">{entry.hint}</span>
                              </span>
                            </button>
                          ))}
                        </PromptMenuList>
                      </div>
                    ))}
                  </PromptPopover>
                )}
              </div>

              <PromptTextarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  mode.prefix
                    ? `${mode.label} — describe it; the template + Prompt Agent do the rest…`
                    : isVideo
                      ? "Describe the shot — the Prompt Agent expands it…"
                      : "Describe the image — the Prompt Agent expands it…"
                }
              />
            </div>

            <PromptFooter>
              <PromptControls>
                {/* Source chips: the mode's own + user-added, each an upload frame */}
                {activeSources.map((key) =>
                  key === "video" ? (
                    <span key="video" className={promptControlClassName({ compact: true, className: "!cursor-not-allowed opacity-40" })}>
                      Reference video · soon
                    </span>
                  ) : (
                    sourceChip(key)
                  ),
                )}

                {/* + Add: first frame / last frame / references — on any live mode */}
                {mode.live && (addable.length > 0 || isVideo) && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenPopover(openPopover === "add" ? null : "add")}
                      className={promptControlClassName({ active: openPopover === "add", compact: true })}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add
                    </button>
                    {openPopover === "add" && (
                      <PromptPopover className="!min-w-[240px]">
                        <PromptPopoverHeader>Add to this run</PromptPopoverHeader>
                        <PromptMenuList>
                          {addable.map((key) => (
                            <PromptMenuItem
                              key={key}
                              description={(AUDIO_ADDONS[key] || SOURCE_DEFS[key])?.desc}
                              onClick={() => {
                                setAdded((previous) => [...previous, key]);
                                setOpenPopover(key); // straight into its upload frame
                              }}
                            >
                              {sourceChipLabel(key)}
                            </PromptMenuItem>
                          ))}
                          {isVideo && (
                            <div className="cursor-not-allowed rounded-xl px-3 py-2.5 opacity-40">
                              <span className="block text-xs font-semibold text-white/70">Reference video</span>
                              <span className="mt-0.5 block text-[9px] text-white/35">Soon — needs a video-edit model on the gateway</span>
                            </div>
                          )}
                        </PromptMenuList>
                      </PromptPopover>
                    )}
                  </div>
                )}

                {/* Camera move */}
                {mode.camera && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenPopover(openPopover === "camera" ? null : "camera")}
                      className={promptControlClassName({ active: openPopover === "camera", compact: true })}
                    >
                      {presetEntry?.label || "Move"}
                    </button>
                    {openPopover === "camera" && (
                      <PromptPopover>
                        <PromptPopoverHeader>Camera move</PromptPopoverHeader>
                        <PromptMenuList>
                          {["dolly-in", "pull-back", "pan-right", "crane-up", "fpv-drone", "bullet-time"].map((value) => {
                            const entry = CAMERA_PATH_PRESETS.find((item) => item.id === value);
                            return (
                              <PromptMenuItem key={value} selected={preset === value}
                                onClick={() => { setPreset(value); setOpenPopover(null); }}>
                                {entry?.label || value}
                              </PromptMenuItem>
                            );
                          })}
                        </PromptMenuList>
                      </PromptPopover>
                    )}
                  </div>
                )}

                {/* Model / duration / aspect (video only) */}
                {isVideo && (
                  <>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenPopover(openPopover === "model" ? null : "model")}
                        className={promptControlClassName({ active: openPopover === "model", compact: true })}
                      >
                        {capsModel?.name || "Model"}
                      </button>
                      {openPopover === "model" && (
                        <PromptPopover className="!min-w-[290px] !max-h-[min(56vh,480px)]">
                          <PromptPopoverHeader>Model · verified on your key</PromptPopoverHeader>
                          <PromptMenuList>
                            {capsVideo.map((entry) => {
                              const textOnly = entry.image === false;
                              const facts = [
                                `${entry.durations.join("s / ")}s${entry.fixed ? " fixed" : ""}`,
                                entry.price,
                                entry.shape,
                                entry.audio === true ? "♪ sound" : entry.audio === false ? "silent" : null,
                                entry.frames === "literal" ? "exact frame" : frameMode ? "frame guides only" : null,
                                textOnly ? "text-only" : null,
                              ].filter(Boolean);
                              return (
                                <PromptMenuItem key={entry.id} selected={entry.id === capsModel?.id}
                                  id={entry.id === capsModel?.id ? "ws-model-selected" : undefined}
                                  disabled={textOnly && frameMode}
                                  className={textOnly && frameMode ? "opacity-40 !cursor-not-allowed" : ""}
                                  description={`${entry.durations.join("s / ")}s${entry.fixed ? " fixed" : ""}${entry.price ? ` · ${entry.price}` : ""}${textOnly ? " · text-only" : ""}${entry.frameExact ? " · frame-exact" : ""}`}
                                  onClick={() => { setVideoModel(entry.id); setOpenPopover(null); }}>
                                  {entry.name}
                                </PromptMenuItem>
                              );
                            })}
                          </PromptMenuList>
                        </PromptPopover>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenPopover(openPopover === "duration" ? null : "duration")}
                        className={promptControlClassName({ active: openPopover === "duration", compact: true })}
                      >
                        {duration}s
                      </button>
                      {openPopover === "duration" && (
                        <PromptPopover>
                          <PromptPopoverHeader>Duration</PromptPopoverHeader>
                          <PromptMenuList>
                            {(capsModel?.durations || [5, 10]).map((seconds) => (
                              <PromptMenuItem key={seconds} selected={seconds === duration}
                                onClick={() => { setDuration(seconds); setOpenPopover(null); }}>
                                {seconds}s
                              </PromptMenuItem>
                            ))}
                          </PromptMenuList>
                        </PromptPopover>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenPopover(openPopover === "aspect" ? null : "aspect")}
                        className={promptControlClassName({ active: openPopover === "aspect", compact: true })}
                      >
                        {aspect}
                      </button>
                      {openPopover === "aspect" && (
                        <PromptPopover className="!min-w-[240px]">
                          <PromptPopoverHeader>Aspect ratio</PromptPopoverHeader>
                          {/* Verified 2026-08-01: the render provider currently
                              ignores this for every model — say so instead of
                              silently under-delivering a portrait request. */}
                          <p className="px-3 pb-2 text-[11px] leading-4 text-amber-300/80">
                            Heads-up: the render provider currently picks the
                            output size itself — this setting is a request, not
                            a guarantee.
                          </p>
                          <PromptMenuList>
                            {ASPECTS.map((value) => (
                              <PromptMenuItem key={value} selected={value === aspect}
                                onClick={() => { setAspect(value); setOpenPopover(null); }}>
                                {value}
                              </PromptMenuItem>
                            ))}
                          </PromptMenuList>
                        </PromptPopover>
                      )}
                    </div>
                  </>
                )}
              </PromptControls>

              <PromptAction disabled={!mode.live} onClick={handleCreate}>
                {isVideo ? `Generate · ${duration}s` : "Generate"}
              </PromptAction>
            </PromptFooter>
          </PromptComposer>
        </div>
      </div>

      {/* ── Foldable task board ── */}
      <div
        className={`relative flex h-full shrink-0 flex-col border-l border-white/[0.07] bg-[#08080a] transition-all duration-300 ${
          boardOpen ? "w-[320px] xl:w-[380px]" : "w-[46px]"
        }`}
      >
        <button
          type="button"
          onClick={toggleBoard}
          title={boardOpen ? "Fold task board" : "Unfold task board"}
          className="flex h-11 w-full items-center justify-center gap-2 border-b border-white/[0.07] text-white/50 transition-colors hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={`transition-transform ${boardOpen ? "" : "rotate-180"}`} aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
          {boardOpen && (
            <span className="slate-label">
              TASK BOARD · {tasks.length}
              {historySync === "off" && tasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("studio:open-settings"))}
                  className="ml-2 normal-case tracking-normal font-sans text-[11px] text-white/35 underline decoration-white/20 underline-offset-2 hover:text-[#d4f939] cursor-pointer"
                >
                  this browser only — sign in to keep history
                </button>
              )}
            </span>
          )}
          {rendering > 0 && <span className="rec-dot shrink-0" />}
        </button>

        {boardOpen ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-3 custom-scrollbar">
            {tasks.length === 0 ? (
              <p className="p-4 text-center text-[12px] leading-relaxed text-white/35">
                No tasks yet — generate something and it lands here with live status.
              </p>
            ) : (
              tasks.map((task) => (
                <article
                  key={task.id}
                  onClick={() => (task.status === "done" && task.url ? setPreviewTask(task) : restoreTask(task))}
                  title="Click to load this task's settings"
                  className={`cursor-pointer overflow-hidden rounded-xl border transition-colors ${
                    restoredFrom === task.id ? "border-[rgba(212,249,57,0.4)]" : "border-white/[0.07] hover:border-white/20"
                  } bg-white/[0.02]`}
                >
                  <div className="relative flex aspect-video items-center justify-center bg-black/60">
                    {task.status === "done" && task.url ? (
                      task.type === "video" ? (
                        <video src={task.url} controls muted playsInline className="h-full w-full bg-black object-contain" onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <img src={task.url} alt={task.prompt} className="h-full w-full object-cover" />
                      )
                    ) : task.status === "rendering" ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="rec-dot" />
                        <span className="slate-label">RENDERING — SAFE TO LEAVE</span>
                      </div>
                    ) : (
                      <p className="px-3 text-center text-[10px] text-red-400/80">{task.error}</p>
                    )}
                    <span className="absolute left-2 top-2 rounded border border-white/10 bg-black/60 px-1.5 py-0.5 font-slate text-[8px] uppercase tracking-wider text-white/70 backdrop-blur-sm">
                      {task.mode || task.type}{task.preset ? ` · ${task.preset}` : ""}
                    </span>
                  </div>
                  <p className="truncate px-2.5 pt-1.5 text-[11px] text-white/60" title={task.prompt}>
                    {task.prompt || "(no prompt)"}
                  </p>
                  <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    {task.status === "done" && task.url && (
                      <>
                        <a href={task.url} download={`task-${task.id}.${task.type === "video" ? "mp4" : "jpg"}`}
                          target="_blank" rel="noreferrer"
                          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-slate text-[8px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/25 hover:text-white">
                          Download
                        </a>
                        {task.type === "image" && (
                          <button type="button" onClick={() => useAsStartFrame(task.url)}
                            className="rounded border border-[rgba(212,249,57,0.3)] bg-[rgba(212,249,57,0.07)] px-2 py-1 font-slate text-[8px] uppercase tracking-wider text-[#d4f939] transition-colors hover:bg-[rgba(212,249,57,0.14)]">
                            → Animate
                          </button>
                        )}
                        <button type="button" onClick={() => restoreTask(task)}
                          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-slate text-[8px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/25 hover:text-white">
                          Reuse
                        </button>
                      </>
                    )}
                    {task.status === "failed" && task.jobId && (
                      <button type="button" onClick={() => retryTask(task)}
                        className="rounded border border-[rgba(212,249,57,0.3)] bg-[rgba(212,249,57,0.07)] px-2 py-1 font-slate text-[8px] uppercase tracking-wider text-[#d4f939] transition-colors hover:bg-[rgba(212,249,57,0.14)]">
                        Retry
                      </button>
                    )}
                    <button type="button" onClick={() => deleteTask(task.id)}
                      className="ml-auto rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-slate text-[8px] uppercase tracking-wider text-red-400/80 transition-colors hover:border-red-400/40">
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center gap-2 pt-3">
            <span className="font-slate text-[10px] text-white/40">{tasks.length}</span>
            {rendering > 0 && <span className="rec-dot" />}
          </div>
        )}
      </div>

      {previewTask && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setPreviewTask(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Result preview"
        >
          <div
            className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0b0b0d] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-2.5">
              <span className="font-slate text-[10px] uppercase tracking-wider text-[#d4f939]">
                {previewTask.mode}{previewTask.preset ? ` · ${previewTask.preset}` : ""}
              </span>
              <button
                type="button"
                onClick={() => setPreviewTask(null)}
                aria-label="Close preview"
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 transition-colors hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
              {previewTask.type === "video" ? (
                <video
                  src={previewTask.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[65vh] w-auto max-w-full"
                />
              ) : (
                <img src={previewTask.url} alt={previewTask.prompt} className="max-h-[65vh] w-auto max-w-full" />
              )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-white/8 px-4 py-3">
              <p className="text-xs leading-relaxed text-white/70">{previewTask.prompt || "(no prompt)"}</p>
              <p className="font-slate text-[10px] uppercase tracking-wider text-white/35">
                {[previewTask.model, previewTask.settings?.duration ? `${previewTask.settings.duration}s` : null,
                  previewTask.settings?.aspect].filter(Boolean).join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={previewTask.url}
                  download={`openvid-${previewTask.id}.${previewTask.type === "video" ? "mp4" : "jpg"}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/12 px-3 py-1.5 font-slate text-[9px] uppercase tracking-wider text-white/70 transition-colors hover:border-white/30 hover:text-white"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => { restoreTask(previewTask); setPreviewTask(null); }}
                  className="rounded-lg border border-[rgba(212,249,57,0.35)] bg-[rgba(212,249,57,0.08)] px-3 py-1.5 font-slate text-[9px] uppercase tracking-wider text-[#d4f939] transition-colors hover:bg-[rgba(212,249,57,0.16)]"
                >
                  Reuse settings
                </button>
                {previewTask.type === "image" && (
                  <button
                    type="button"
                    onClick={() => { useAsStartFrame(previewTask.url); setPreviewTask(null); }}
                    className="rounded-lg border border-white/12 px-3 py-1.5 font-slate text-[9px] uppercase tracking-wider text-white/70 transition-colors hover:border-white/30 hover:text-white"
                  >
                    → Animate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
