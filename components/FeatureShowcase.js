'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The hero's right panel: a letterboxed viewport that cycles the flagship
// features as slides. Tabs are real tabs (keyboard + ARIA), auto-advance
// pauses on hover/focus and under prefers-reduced-motion.

const AUTO_ADVANCE_MS = 6000;

// Original studio card art (the good part of the pre-redesign hero collages) —
// reused here so the showcase shows real output, not abstractions.
const CARD_ART = [
  '/showcase/crash-portrait.jpg',
  '/showcase/orbit-dancer.jpg',
  '/showcase/temple-pan.jpg',
  '/showcase/dolly-diner.jpg',
];

// Every slide sits on real footage generated in-studio — never bare vectors.
function Backdrop({ src, poster }) {
  return (
    <>
      <video
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
    </>
  );
}

function PathSlide() {
  return (
    <div className="relative h-full w-full">
      <Backdrop src="/showcase/clips/hero.mp4" poster="/showcase/neon-alley.jpg" />
      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path
          className="path-draw"
          d="M60 240 C 130 235, 150 190, 210 170 S 320 120, 345 105"
          stroke="#d4f939"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="1000"
          fill="none"
        />
        <circle className="path-dot" cx="60" cy="240" r="5" fill="#d4f939" />
        <circle className="path-dot" cx="345" cy="105" r="7" fill="none" stroke="#a855f7" strokeWidth="2" />
        <circle className="path-dot" cx="345" cy="105" r="3" fill="#a855f7" />
      </svg>
      <div className="absolute left-4 top-8 z-[3] flex items-center gap-3">
        <span className="rec-dot" aria-hidden="true" />
        <span className="slate-label" style={{ color: 'rgba(255,255,255,0.75)' }}>
          REC · SCENE 01 · TAKE 03
        </span>
      </div>
      <div className="absolute bottom-8 left-4 right-4 z-[3] flex items-center justify-between">
        <span className="slate-value">CRANE UP · TRACK RIGHT · EASE OUT</span>
        <span className="slate-value text-primary">25S · 2 CLIPS</span>
      </div>
    </div>
  );
}

function ChainSlide() {
  const clips = [
    { seconds: 15, state: 'done' },
    { seconds: 10, state: 'done' },
    { seconds: 10, state: 'rendering' },
    { seconds: 10, state: 'queued' },
  ];
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-5 px-6 py-10">
      <Backdrop src="/showcase/clips/glacier-reveal.mp4" poster="/showcase/glacier-reveal.jpg" />
      <p className="relative slate-label slate-label--cyan">ONE SHOT · FOUR CHAINED CLIPS · 45S</p>
      <div className="relative flex gap-1.5">
        {clips.map((clip, index) => (
          <div
            key={index}
            style={{ flexGrow: clip.seconds }}
            className={`relative h-16 overflow-hidden rounded-lg border bg-black/60 backdrop-blur-sm ${
              clip.state === 'rendering'
                ? 'border-[rgba(245,158,11,0.5)]'
                : 'border-white/[0.08]'
            }`}
          >
            <div
              className={`absolute inset-x-0 bottom-0 h-1.5 ${
                clip.state === 'done'
                  ? 'bg-primary'
                  : clip.state === 'rendering'
                    ? 'bg-rec animate-pulse'
                    : 'bg-white/10'
              }`}
            />
            <div className="flex h-full items-center justify-center gap-2">
              <span className="slate-value">{clip.seconds}s</span>
              {clip.state === 'done' && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d4f939" strokeWidth="3" aria-hidden="true">
                  <path d="M5 12l4 4L19 6" />
                </svg>
              )}
              {clip.state === 'rendering' && <span className="rec-dot" aria-hidden="true" />}
            </div>
          </div>
        ))}
      </div>
      <div className="relative space-y-1.5">
        <p className="slate-value">CLIP 3 FAILED AT 02:41 → RESUMED FROM CLIP 2&apos;S LAST FRAME</p>
        <p className="text-[13px] leading-relaxed text-white/50">
          Every clip is saved the moment it lands. A dropped connection costs you
          one clip, never the shot.
        </p>
      </div>
    </div>
  );
}

function VaultSlide() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-5 overflow-hidden px-6 py-10">
      <Backdrop src="/showcase/clips/neon-alley.mp4" poster="/showcase/neon-alley.jpg" />
      <div className="pointer-events-none absolute -right-10 -top-10 flex gap-2 opacity-90" aria-hidden="true">
        {CARD_ART.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className="h-28 w-20 rounded-xl border border-white/10 object-cover shadow-2xl"
            style={{ transform: `rotate(${(index - 1.5) * 9}deg) translateY(${Math.abs(index - 1.5) * 8}px)` }}
          />
        ))}
      </div>
      <p className="relative slate-label slate-label--cyan">THE VAULT</p>
      <p className="relative font-display text-5xl font-bold tracking-tight text-white">
        403<span className="text-primary"> models</span>
      </p>
      <div className="relative space-y-1.5">
        <p className="slate-value">70 T2I · 72 I2I · 87 T2V · 123 I2V · 36 V2V · 15 LIPSYNC</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-white/50">
          Seedance 2.0, Kling 2.6, Veo 3.1, Flux 2, Sora — one prompt bar whose
          controls reshape to each model&apos;s real capabilities.
        </p>
      </div>
    </div>
  );
}

function DirectorSlide() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-4 px-6 py-10">
      <Backdrop src="/showcase/clips/temple-pan.mp4" poster="/showcase/temple-pan.jpg" />
      <p className="relative slate-label slate-label--cyan">AI DIRECTOR · BILLED TO YOUR SUPERBAPI KEY</p>
      <div className="relative rounded-xl border border-white/[0.08] bg-black/60 backdrop-blur-sm p-4">
        <p className="slate-value mb-2 text-primary">YOUR STROKE →</p>
        <svg viewBox="0 0 300 44" className="w-full" aria-hidden="true">
          <path
            d="M10 36 C 80 32, 110 14, 170 12 S 270 20, 290 8"
            stroke="#d4f939"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="10" cy="36" r="3.5" fill="#d4f939" />
          <circle cx="290" cy="8" r="3" fill="#a855f7" />
        </svg>
      </div>
      <div className="relative rounded-xl border border-[rgba(212,249,57,0.25)] bg-black/60 backdrop-blur-sm p-4">
        <p className="slate-value mb-1.5">→ CINEMATOGRAPHER LANGUAGE</p>
        <p className="text-[13px] italic leading-relaxed text-white/65">
          &ldquo;Begin low-left and track right at a steady pace, arcing into a slow
          crane toward the upper right, easing out to a gentle halt.&rdquo;
        </p>
      </div>
    </div>
  );
}

function LocalSlide() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-5 px-6 py-10">
      <Backdrop src="/showcase/clips/dolly-diner.mp4" poster="/showcase/dolly-diner.jpg" />
      <p className="relative slate-label slate-label--cyan">RUNS YOUR WAY</p>
      <div className="relative space-y-3 rounded-xl bg-black/55 p-4 backdrop-blur-sm">
        {[
          ['DESKTOP APP', 'Bundled sd.cpp — SD 1.5 / SDXL / Z-Image on Metal, CUDA, Vulkan'],
          ['WAN2GP BOX', 'Point at your own GPU server for Flux, Qwen and Wan video'],
          ['SELF-HOSTED WEB', 'MIT licensed, no content filters, deploy anywhere'],
          ['WORKFLOWS + AGENTS', 'Node pipelines and multi-turn creative agents, API-callable'],
        ].map(([label, copy]) => (
          <div key={label} className="grid grid-cols-[120px_1fr] items-baseline gap-3 border-b border-white/[0.05] pb-2.5">
            <span className="slate-label">{label}</span>
            <span className="text-[13px] leading-relaxed text-white/55">{copy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SLIDES = [
  { id: 'path', tab: 'Camera Path', render: PathSlide },
  { id: 'chain', tab: '90s Chains', render: ChainSlide },
  { id: 'vault', tab: '403 Models', render: VaultSlide },
  { id: 'director', tab: 'AI Director', render: DirectorSlide },
  { id: 'local', tab: 'Your Way', render: LocalSlide },
];

export default function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (isPaused || reducedMotionRef.current) return undefined;
    const timer = setInterval(
      () => setActive((current) => (current + 1) % SLIDES.length),
      AUTO_ADVANCE_MS,
    );
    return () => clearInterval(timer);
  }, [isPaused]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'ArrowRight') {
      setActive((current) => (current + 1) % SLIDES.length);
    } else if (event.key === 'ArrowLeft') {
      setActive((current) => (current - 1 + SLIDES.length) % SLIDES.length);
    }
  }, []);

  const ActiveSlide = SLIDES[active].render;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <div
        className="frame-viewport h-[340px] md:h-[430px]"
        role="tabpanel"
        id={`showcase-panel-${SLIDES[active].id}`}
        aria-labelledby={`showcase-tab-${SLIDES[active].id}`}
      >
        <div key={SLIDES[active].id} className="absolute inset-0 animate-fade-in">
          <ActiveSlide />
        </div>
      </div>

      {/* Tabs + progress */}
      <div
        role="tablist"
        aria-label="Feature showcase"
        onKeyDown={handleKeyDown}
        className="mt-4 flex flex-wrap items-center gap-1.5"
      >
        {SLIDES.map((slide, index) => (
          <button
            key={slide.id}
            role="tab"
            id={`showcase-tab-${slide.id}`}
            aria-selected={index === active}
            aria-controls={`showcase-panel-${slide.id}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={`relative overflow-hidden rounded-lg border px-3 py-1.5 font-slate text-[10px] font-medium uppercase tracking-[0.14em] transition-all ${
              index === active
                ? 'border-[rgba(212,249,57,0.4)] bg-[rgba(212,249,57,0.08)] text-primary'
                : 'border-white/[0.07] bg-white/[0.02] text-white/40 hover:border-white/20 hover:text-white/70'
            }`}
          >
            {slide.tab}
            {index === active && !isPaused && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-primary/60"
                style={{ animation: `showcase-progress ${AUTO_ADVANCE_MS}ms linear forwards` }}
              />
            )}
          </button>
        ))}
      </div>
      <style>{`
        @keyframes showcase-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (prefers-reduced-motion: reduce) { [style*="showcase-progress"] { animation: none !important; } }
      `}</style>
    </div>
  );
}
