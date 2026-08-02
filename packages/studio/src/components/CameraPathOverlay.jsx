"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateI2V, generateVideo } from "../muapi.js";
import { analyzePath, requestCameraDirection } from "../utils/cameraPath.js";
import { guidanceForEffect } from "../utils/uploadSpec.js";
import UploadZone from "./UploadZone.jsx";
import {
  CAMERA_PATH_MODELS,
  availableTotals,
  getCameraPathModel,
  planSegments,
  totalPlannedSeconds,
} from "../utils/cameraPathModels.js";
import {
  CAMERA_PATH_PRESETS,
  PRESET_GROUPS,
  presetPreviewGeometry,
} from "../utils/cameraPathPresets.js";
import {
  SEGMENT_STATUS,
  clearJob,
  completedSegments,
  createJob,
  isComplete,
  isResumable,
  loadJob,
  nextSegmentIndex,
  previousRequestId,
  saveJob,
  updateSegment,
} from "../utils/cameraPathJobs.js";

const END_MOVES = [
  { value: "none", label: "No zoom" },
  { value: "push-in", label: "End push-in" },
  { value: "pull-back", label: "End pull-back" },
];

// ─── Small dark-native controls (a native <select> renders an OS-light menu
// that breaks the studio's dark chrome) ──────────────────────────────────────

function Select({ label, value, options, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={rootRef}>
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-semibold text-white/85 transition-colors hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="truncate">{selected?.label ?? "—"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-white/40">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0d0d0f] p-1 shadow-[0_16px_50px_rgba(0,0,0,0.8)]"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                option.value === value
                  ? "bg-[#d4f939]/12 text-[#d4f939]"
                  : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.hint && (
                <span className="shrink-0 text-[10px] text-white/30">{option.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PathSvg({ points, isLive }) {
  if (points.length < 2) return null;
  const asString = points
    .map((point) => `${(point.x * 100).toFixed(2)},${(point.y * 100).toFixed(2)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <polyline
        points={asString}
        fill="none"
        stroke="rgba(212,249,57,0.35)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: "blur(3px)" }}
      />
      <polyline
        points={asString}
        fill="none"
        stroke="#d4f939"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        strokeDasharray={isLive ? "none" : "3 2"}
      />
      <circle cx={first.x * 100} cy={first.y * 100} r="1.3" fill="#d4f939" />
      <circle cx={last.x * 100} cy={last.y * 100} r="1.8" fill="none" stroke="#a855f7" strokeWidth="0.6" />
      <circle cx={last.x * 100} cy={last.y * 100} r="0.9" fill="#a855f7" />
    </svg>
  );
}

function PresetCard({ preset, isActive, onSelect, disabled }) {
  const preview = useMemo(() => presetPreviewGeometry(preset), [preset]);
  const stroke = isActive ? "#d4f939" : "rgba(255,255,255,0.45)";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(preset)}
      title={preset.hint}
      className={`group flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        isActive
          ? "border-[#d4f939]/50 bg-[#d4f939]/10"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <span className="relative block h-10 w-full overflow-hidden rounded-md bg-black/50">
        {/* Square viewBox keeps the arrowhead from shearing. */}
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <polyline
            points={preview.points}
            fill="none"
            stroke={stroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-colors group-hover:stroke-[#d4f939]"
          />
          <circle
            cx={preview.start.x}
            cy={preview.start.y}
            r="5"
            fill={stroke}
            className="transition-colors group-hover:fill-[#d4f939]"
          />
          <polygon
            points="0,-7 14,0 0,7"
            fill={isActive ? "#a855f7" : "rgba(255,255,255,0.75)"}
            transform={`translate(${preview.end.x} ${preview.end.y}) rotate(${preview.angle})`}
            className="transition-colors group-hover:fill-[#a855f7]"
          />
        </svg>
      </span>
      <span
        className={`truncate text-[11px] font-semibold transition-colors ${
          isActive ? "text-[#d4f939]" : "text-white/70 group-hover:text-white"
        }`}
      >
        {preset.label}
      </span>
    </button>
  );
}

function ClipTimeline({ segments, activeIndex, onSelect }) {
  const totalSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0) || 1;

  return (
    <div className="flex w-full gap-1" role="list" aria-label="Clip timeline">
      {segments.map((segment) => {
        const isPlayable = segment.status === SEGMENT_STATUS.done && segment.url;
        const tone =
          segment.status === SEGMENT_STATUS.done
            ? "bg-[#d4f939]"
            : segment.status === SEGMENT_STATUS.running
              ? "bg-[#a855f7] animate-pulse"
              : segment.status === SEGMENT_STATUS.failed
                ? "bg-red-500"
                : "bg-white/12";
        return (
          <button
            key={segment.index}
            type="button"
            role="listitem"
            disabled={!isPlayable}
            onClick={() => isPlayable && onSelect(segment.index)}
            title={`Clip ${segment.index + 1} · ${segment.seconds}s · ${segment.status}`}
            style={{ flexGrow: segment.seconds / totalSeconds }}
            className={`group relative h-7 min-w-[36px] overflow-hidden rounded-md border transition-all disabled:cursor-default ${
              activeIndex === segment.index && isPlayable
                ? "border-[#d4f939]/60"
                : "border-white/[0.06] hover:border-white/20"
            }`}
          >
            <span className={`absolute inset-x-0 bottom-0 h-1 ${tone}`} />
            <span className="flex h-full items-center justify-center text-[10px] font-bold text-white/60">
              {segment.seconds}s
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function CameraPathOverlay({
  isOpen,
  onClose,
  apiKey,
  imageUrl,
  scenePrompt,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [activePreset, setActivePreset] = useState(null);
  const [model, setModel] = useState(CAMERA_PATH_MODELS[0]?.id || "");
  const [targetSeconds, setTargetSeconds] = useState(null);
  const [endMove, setEndMove] = useState("none");
  const [phase, setPhase] = useState("idle"); // idle | directing | rendering | done | error
  const [direction, setDirection] = useState(null);
  const [job, setJob] = useState(null);
  const [playingIndex, setPlayingIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [uploadedSource, setUploadedSource] = useState(null);
  // Models this key can ACTUALLY render, probed by the shell at sign-in.
  const [caps, setCaps] = useState(null);
  const drawAreaRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    try {
      const stored = JSON.parse(window.localStorage.getItem("superb_caps_v1") || "null");
      if (stored?.video?.length) setCaps(stored);
    } catch {
      // fall back to the catalog list below
    }
    const handleCaps = (event) => setCaps(event.detail);
    window.addEventListener("superb:caps", handleCaps);
    return () => window.removeEventListener("superb:caps", handleCaps);
  }, [isOpen]);
  const videoRef = useRef(null);
  const cancelRef = useRef(false);

  const frameUrl = uploadedSource || imageUrl;
  // Camera Path is by definition a move ON the user's frame — so the picker
  // only offers models that can actually use the pixels, and defaults to one
  // that starts on them exactly (frames: 'literal'). Offering Kling here was
  // the root of "the camera move ignored my photo": it never sees the image,
  // it only reads our description of it.
  const capsVideoAll = caps?.video || [];
  const capsVideo = capsVideoAll.filter((entry) => entry.frames !== "ignored" && entry.image !== false);
  const capsMode = capsVideo.length > 0;
  const frameExactDefault = capsVideo.find((entry) => entry.frames === "literal") || capsVideo[0] || null;
  const capsModel = capsVideo.find((entry) => entry.id === model) || frameExactDefault;
  useEffect(() => {
    if (capsMode && capsModel && model !== capsModel.id) setModel(capsModel.id);
  }, [capsMode, capsModel, model]);

  const modelInfo = getCameraPathModel(model);
  const totals = useMemo(
    () => (capsMode ? capsModel?.durations || [5] : availableTotals(model)),
    [capsMode, capsModel, model],
  );
  const effectiveTarget = totals.includes(targetSeconds) ? targetSeconds : totals[0];
  const plan = useMemo(
    () =>
      capsMode
        ? [{ index: 0, kind: "base", seconds: effectiveTarget }]
        : planSegments(model, effectiveTarget),
    [capsMode, model, effectiveTarget],
  );

  // When capabilities arrive, snap the selection to a model the key can run.
  useEffect(() => {
    if (capsMode && !capsVideo.some((entry) => entry.id === model)) {
      setModel(capsVideo[0].id);
    }
  }, [capsMode, capsVideo, model]);
  const plannedSeconds = totalPlannedSeconds(plan);
  const isBusy = phase === "directing" || phase === "rendering";
  const doneSegments = completedSegments(job);
  const canResume = isResumable(job) && !isBusy;

  // ── Restore an unfinished render for this frame ──
  useEffect(() => {
    if (!isOpen) return;
    const stored = loadJob(apiKey);
    if (stored && stored.imageUrl === frameUrl && !isComplete(stored)) {
      setJob(stored);
      setPoints(stored.points || []);
      setModel(stored.model);
      setTargetSeconds(stored.targetSeconds);
      setEndMove(stored.endMove || "none");
      if (stored.direction) setDirection(stored.direction);
      setPhase("error");
      setErrorMessage(
        "A previous render stopped partway. Resume to continue from the last finished clip.",
      );
    }
  }, [isOpen, apiKey, imageUrl]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isBusy) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isBusy]);

  useEffect(() => {
    if (isOpen) return undefined;
    cancelRef.current = true;
    return undefined;
  }, [isOpen]);

  const pointFromEvent = useCallback((event) => {
    const rect = drawAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      t: event.timeStamp,
    };
  }, []);

  const resetRender = () => {
    setJob(null);
    setDirection(null);
    setErrorMessage(null);
    setPhase("idle");
    setPlayingIndex(0);
    clearJob(apiKey);
  };

  const handlePointerDown = (event) => {
    if (isBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (!point) return;
    setIsDrawing(true);
    setActivePreset(null);
    setPoints([point]);
    resetRender();
  };

  const handlePointerMove = (event) => {
    if (!isDrawing) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setPoints((previous) => [...previous, point]);
  };

  const handlePointerUp = () => setIsDrawing(false);

  const applyPreset = (preset) => {
    if (isBusy) return;
    setActivePreset(preset.id);
    setPoints(preset.build());
    setEndMove(preset.endMove);
    resetRender();
  };

  // ── Render one clip; base clips use i2v, later clips extend the previous ──
  // The poll response does not echo request_id, so it is captured from the
  // submit callback — without it the next clip has nothing to continue from.
  const renderSegment = useCallback(
    async (currentJob, index) => {
      const segment = currentJob.segments[index];
      const prompt =
        `Camera movement: ${segment.prompt} ` +
        "Keep the scene, subjects, and lighting consistent throughout.";

      let capturedRequestId = null;
      const onRequestId = (requestId) => {
        capturedRequestId = requestId;
        // Persist immediately: if the tab dies mid-render, the id survives.
        saveJob(apiKey, updateSegment(currentJob, index, { requestId }));
      };

      let result;
      if (segment.kind === "base") {
        // The gateway fetches the start frame by URL, so a locally uploaded
        // data URL is parked on the asset host first.
        let startFrame = currentJob.imageUrl;
        if (typeof startFrame === "string" && startFrame.startsWith("data:")) {
          const hosted = await fetch("/api/asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: startFrame }),
          });
          if (hosted.ok) startFrame = (await hosted.json()).url;
        }
        result = await generateI2V(apiKey, {
          model: currentJob.model,
          videoModel: currentJob.model,
          prompt,
          image_url: startFrame,
          duration: segment.seconds,
          onRequestId,
        });
      } else {
        const continueFrom = previousRequestId(currentJob, index);
        if (!continueFrom) {
          throw new Error(
            "Cannot continue: the previous clip's request id was lost. Start a new render.",
          );
        }

        const extend = getCameraPathModel(currentJob.model).extend;
        result = await generateVideo(apiKey, {
          model: extend.model,
          prompt,
          request_id: continueFrom,
          ...(extend.sendsDuration ? { duration: segment.seconds } : {}),
          onRequestId,
        });
      }

      return {
        result,
        requestId: result?.request_id || result?.id || capturedRequestId,
      };
    },
    [apiKey],
  );

  const runJob = useCallback(
    async (startingJob) => {
      cancelRef.current = false;
      let current = startingJob;
      onGenerationStart?.();
      setPhase("rendering");
      setErrorMessage(null);

      try {
        for (;;) {
          const index = nextSegmentIndex(current);
          if (index === -1) break;
          if (cancelRef.current) return;

          current = updateSegment(current, index, {
            status: SEGMENT_STATUS.running,
            error: null,
          });
          setJob(current);
          saveJob(apiKey, current);

          try {
            const { result, requestId } = await renderSegment(current, index);
            if (!result?.url) throw new Error("The video model returned no output.");

            current = updateSegment(current, index, {
              status: SEGMENT_STATUS.done,
              url: result.url,
              requestId: requestId || current.segments[index].requestId,
            });
            setJob(current);
            saveJob(apiKey, current);
            setPlayingIndex(index);
          } catch (error) {
            current = updateSegment(current, index, {
              status: SEGMENT_STATUS.failed,
              error: error?.message?.slice(0, 200) || "Clip failed",
            });
            setJob(current);
            saveJob(apiKey, current);
            throw error;
          }
        }

        setPhase("done");
        setPlayingIndex(0);
        const finished = completedSegments(current);
        onGenerationComplete?.({
          url: finished[0]?.url,
          model: current.model,
          prompt: current.direction?.overview || "Camera path render",
          type: "cinema",
        });
      } catch (error) {
        console.error("Camera path render failed:", error);
        const done = completedSegments(current).length;
        let detail = error?.message?.slice(0, 160) || "Camera path render failed";
        if (/40[13]/.test(detail)) {
          detail = "Video rendering is not enabled on this deployment yet — the drawn path and AI direction are saved and will render once a video backend is configured.";
        }
        setErrorMessage(
          done > 0
            ? `${detail} — ${done} of ${current.segments.length} clips finished. Resume to continue.`
            : detail,
        );
        setPhase("error");
        onGenerationError?.(detail.slice(0, 120));
      } finally {
        onGenerationEnd?.();
      }
    },
    [
      apiKey,
      onGenerationComplete,
      onGenerationEnd,
      onGenerationError,
      onGenerationStart,
      renderSegment,
    ],
  );

  const handleGenerate = async () => {
    const analysis = analyzePath(points);
    if (!analysis) {
      setErrorMessage("Draw a longer line first — a short dot cannot define a camera move.");
      setPhase("error");
      return;
    }

    setPhase("directing");
    setErrorMessage(null);
    clearJob(apiKey);

    try {
      const directionResult = await requestCameraDirection({
        analysis,
        scene: scenePrompt || "",
        durationSeconds: plannedSeconds,
        endMove,
        segmentPlan: plan,
        apiKey,
      });
      setDirection(directionResult);

      const fresh = createJob({
        imageUrl: frameUrl,
        model,
        targetSeconds: effectiveTarget,
        segmentPlan: plan,
        points,
        endMove,
        scene: scenePrompt || "",
      });
      fresh.direction = directionResult;
      fresh.segments = fresh.segments.map((segment, index) => ({
        ...segment,
        prompt: directionResult.segments[index] || directionResult.overview,
      }));

      setJob(fresh);
      saveJob(apiKey, fresh);
      await runJob(fresh);
    } catch (error) {
      console.error("Camera path setup failed:", error);
      setErrorMessage(error?.message?.slice(0, 160) || "Could not prepare the camera direction");
      setPhase("error");
      onGenerationEnd?.();
    }
  };

  const handleResume = () => {
    if (!job) return;
    const reset = {
      ...job,
      segments: job.segments.map((segment) =>
        segment.status === SEGMENT_STATUS.failed
          ? { ...segment, status: SEGMENT_STATUS.pending, error: null }
          : segment,
      ),
    };
    setJob(reset);
    runJob(reset);
  };

  // Chained clips are separate files; play them back to back.
  const handleVideoEnded = () => {
    const next = doneSegments.findIndex((segment) => segment.index > playingIndex);
    if (next !== -1) setPlayingIndex(doneSegments[next].index);
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.load();
  }, [playingIndex]);

  if (!isOpen) return null;

  const activeVideo = doneSegments.find((segment) => segment.index === playingIndex)
    || doneSegments[0];
  const showResult = Boolean(activeVideo) && phase !== "rendering";
  const canGenerate = points.length > 1 && !isBusy && Boolean(model);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/88 p-3 backdrop-blur-xl animate-fade-in md:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-path-title"
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0a0a0b]/97 shadow-[0_24px_100px_rgba(0,0,0,0.8)] animate-scale-up"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-white/[0.05] px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d4f939]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M3 17c4-8 8 2 12-5 2.5-4.4 5-3.5 6-2" />
                <circle cx="3" cy="17" r="1.5" fill="currentColor" />
              </svg>
              Camera Path
            </div>
            <h2 id="camera-path-title" className="text-lg font-semibold tracking-tight text-white md:text-xl">
              Choose a move, or draw your own
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close camera path"
            className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.03] text-white/40 transition-all hover:border-white/15 hover:bg-white/[0.07] hover:text-white disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body: preset rail + stage */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <aside className="shrink-0 border-b border-white/[0.05] p-3 md:w-[236px] md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
              Camera moves
            </p>
            {PRESET_GROUPS.map((group) => (
              <div key={group} className="mb-3">
                <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">
                  {group}
                </p>
                <div className="grid grid-cols-3 gap-1.5 md:grid-cols-2">
                  {CAMERA_PATH_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      isActive={activePreset === preset.id}
                      onSelect={applyPreset}
                      disabled={isBusy}
                    />
                  ))}
                </div>
              </div>
            ))}
          </aside>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-[240px] flex-1 items-center justify-center bg-black/60 p-3">
              {!frameUrl && !showResult ? (
                <div className="w-full max-w-md">
                  <p className="slate-label slate-label--cyan mb-3">STEP 1 — ADD YOUR SOURCE</p>
                  <UploadZone
                    kind="image"
                    value={null}
                    onChange={(dataUrl) => {
                      setUploadedSource(dataUrl);
                      setErrorMessage(null);
                    }}
                    onError={setErrorMessage}
                    guidance={guidanceForEffect(activePreset)}
                    title="Upload a start frame"
                  />
                  <p className="mt-3 text-[11px] text-white/30">
                    Or shoot one in Cinema Studio first — it loads here automatically.
                  </p>
                </div>
              ) : showResult ? (
                <video
                  ref={videoRef}
                  key={activeVideo.url}
                  src={activeVideo.url}
                  controls
                  autoPlay
                  playsInline
                  onEnded={handleVideoEnded}
                  className="max-h-[46vh] w-auto max-w-full rounded-xl border border-white/10 shadow-2xl"
                />
              ) : (
                <div
                  ref={drawAreaRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className={`relative inline-block max-h-[46vh] select-none overflow-hidden rounded-xl border border-white/10 shadow-2xl ${
                    isBusy ? "cursor-wait" : "cursor-crosshair"
                  }`}
                  style={{ touchAction: "none" }}
                >
                  <img
                    src={frameUrl}
                    alt="Start frame for the camera path"
                    draggable={false}
                    className="block max-h-[46vh] w-auto max-w-full"
                  />
                  <PathSvg points={points} isLive={isDrawing} />
                  {points.length < 2 && !isBusy && frameUrl && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full border border-white/10 bg-black/70 px-4 py-2 text-xs font-medium text-white/70 backdrop-blur-md">
                        ✏️ Pick a move, or drag to draw your own
                      </span>
                    </div>
                  )}
                  {isBusy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/72 backdrop-blur-[2px]">
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#d4f939]/20 border-t-[#d4f939]" />
                      <span className="text-xs font-semibold uppercase tracking-widest text-white/70">
                        {phase === "directing"
                          ? "Directing camera…"
                          : `Rendering clip ${Math.max(1, nextSegmentIndex(job) + 1)} of ${plan.length}…`}
                      </span>
                      {job && completedSegments(job).length > 0 && (
                        <span className="text-[11px] text-white/40">
                          {completedSegments(job).length} clip
                          {completedSegments(job).length === 1 ? "" : "s"} saved so far
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Timeline */}
            {job && job.segments.length > 1 && (
              <div className="shrink-0 border-t border-white/[0.05] px-4 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                    Clips
                  </span>
                  <span className="text-[10px] font-medium text-white/40">
                    {completedSegments(job).length}/{job.segments.length} done ·{" "}
                    {job.targetSeconds}s total
                  </span>
                </div>
                <ClipTimeline
                  segments={job.segments}
                  activeIndex={playingIndex}
                  onSelect={setPlayingIndex}
                />
              </div>
            )}

            {/* Direction readout */}
            {direction && (
              <div className="shrink-0 border-t border-white/[0.05] bg-white/[0.02] px-4 py-2.5">
                <p className="text-xs leading-relaxed text-white/60">
                  <span className="mr-2 rounded border border-[#d4f939]/20 bg-[#d4f939]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#d4f939]">
                    {direction.source === "llm" ? "AI Director" : "Rule-based"}
                  </span>
                  {direction.overview}
                </p>
              </div>
            )}
            {errorMessage && (
              <div className="shrink-0 border-t border-white/[0.05] bg-red-500/[0.06] px-4 py-2.5">
                <p className="text-xs font-medium text-red-400/90">{errorMessage}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer controls */}
        <div className="shrink-0 border-t border-white/[0.05] px-4 py-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-[168px] flex-1">
              <Select
                label="Model"
                value={model}
                disabled={isBusy}
                onChange={(next) => {
                  setModel(next);
                  setTargetSeconds(null);
                  resetRender();
                }}
                options={
                  capsMode
                    ? capsVideo.map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                        hint: `${entry.durations.join("/")}s`,
                      }))
                    : CAMERA_PATH_MODELS.map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                        hint: entry.canChain ? "chains" : `${entry.maxClipSeconds}s`,
                      }))
                }
              />
            </div>
            <div className="w-[124px]">
              <Select
                label="Duration"
                value={effectiveTarget}
                disabled={isBusy}
                onChange={(next) => {
                  setTargetSeconds(next);
                  resetRender();
                }}
                options={totals.map((seconds) => ({
                  value: seconds,
                  label: `${seconds}s`,
                  hint:
                    planSegments(model, seconds).length > 1
                      ? `${planSegments(model, seconds).length} clips`
                      : undefined,
                }))}
              />
            </div>
            <div className="w-[136px]">
              <Select
                label="Finish"
                value={endMove}
                disabled={isBusy}
                onChange={setEndMove}
                options={END_MOVES}
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPoints([]);
                  setActivePreset(null);
                  resetRender();
                }}
                disabled={isBusy || (points.length === 0 && !job)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
              {activeVideo && (
                <a
                  href={activeVideo.url}
                  download={`camera-path-clip-${activeVideo.index + 1}.mp4`}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-white/25 hover:text-white"
                >
                  Download clip {activeVideo.index + 1}
                </a>
              )}
              {canResume ? (
                <button
                  type="button"
                  onClick={handleResume}
                  className="rounded-lg bg-[#a855f7] px-4 py-2 text-xs font-bold text-white shadow-lg shadow-[#a855f7]/20 transition-all hover:brightness-110"
                >
                  Resume ({completedSegments(job).length}/{job.segments.length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className="rounded-lg bg-[#d4f939] px-4 py-2 text-xs font-bold text-black shadow-lg shadow-[#d4f939]/10 transition-all hover:bg-[#e4ff66] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isBusy
                    ? "Working…"
                    : phase === "done"
                      ? "Regenerate"
                      : `Generate ${plannedSeconds}s`}
                </button>
              )}
            </div>
          </div>

          {capsMode && capsModel && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              {capsModel.name} · {capsModel.frames === "literal" ? "starts on your exact frame" : "frame guides the scene"} · {capsModel.durations.join("s / ")}s ·
              single continuous clip
            </p>
          )}
          {!capsMode && modelInfo && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              {modelInfo.vendor} · {modelInfo.blurb}
              {plan.length > 1
                ? ` — rendered as ${plan.length} chained clips (${plan
                    .map((segment) => `${segment.seconds}s`)
                    .join(" + ")}); each clip is saved as it finishes, so a failure resumes instead of restarting.`
                : modelInfo.canChain
                  ? " — pick a longer duration to chain multiple clips."
                  : ` — single clip only, max ${modelInfo.maxClipSeconds}s.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
