import Link from 'next/link';

import FeatureShowcase from '../components/FeatureShowcase';
import { STUDIO_ART } from '../components/FeatureArt';

export const metadata = {
  title: 'OpenVid Studio — Draw the Camera. Direct the AI.',
  description:
    'The open-source AI film studio. Draw a line over any frame and the camera follows it. 400+ models — Seedance 2.0, Kling, Veo, Flux — chained long-form renders, resumable jobs. Bring your SuperbAPI key.',
};

// ─── Data ────────────────────────────────────────────────────────────────────

const STUDIOS = [
  {
    span: 'span-4',
    scene: '01',
    name: 'Cinema Studio',
    tag: 'CAMERA PATH · I2V CHAINS',
    copy: 'Pick a camera body, lens and aperture — then draw the camera move with a pen. The AI Director turns your stroke into cinematographer language and renders it as a real clip.',
    href: '/studio/cinema',
    featured: true,
  },
  {
    span: 'span-2',
    scene: '02',
    name: 'Video Studio',
    tag: 'T2V · I2V',
    copy: 'One prompt bar for every model — verified live against your key before you spend a credit.',
    href: '/studio/video',
  },
  {
    span: 'span-2',
    scene: '03',
    name: 'Image Studio',
    tag: 'T2I · EDIT ×14 REFS',
    copy: 'Flux, Nano Banana, Seedream — with up to 14 reference images.',
    href: '/studio/image',
  },
  {
    span: 'span-2',
    scene: '04',
    name: 'Lip Sync',
    tag: 'AUDIO → TALKING VIDEO',
    copy: 'Portrait + voice in, talking video out. Nine dedicated models.',
    href: '/studio/lipsync',
  },
  {
    span: 'span-2',
    scene: '05',
    name: 'Workflows',
    tag: 'NODE PIPELINES',
    copy: 'Chain models into visual pipelines. Run them via API.',
    href: '/studio/workflows',
  },
  {
    span: 'span-3',
    scene: '06',
    name: 'Agents',
    tag: 'MULTI-TURN DIRECTOR',
    copy: 'Conversational creative agents that plan shots and execute generations for you.',
    href: '/studio/agents',
  },
  {
    span: 'span-3',
    scene: '07',
    name: 'Audio · Clipping · Body Swap · Marketing',
    tag: 'THE BACK LOT',
    copy: 'Suno music, auto-clipping, recasting and ad variations — the rest of the lot.',
    href: '/studio/audio',
  },
];

const MODEL_WALL = [
  'SEEDANCE 2.0', 'KLING 2.6 PRO', 'VEO 3.1', 'FLUX 2', 'SORA', 'WAN 2.6',
  'NANO BANANA 2', 'HAILUO 2.3', 'LTX 2 PRO', 'SEEDREAM 5.0', 'MIDJOURNEY',
  'IDEOGRAM', 'GROK IMAGINE', 'RUNWAY', 'QWEN IMAGE', 'SUNO', 'PIXVERSE V6',
  'GPT-4O IMAGE', 'INFINITE TALK', 'LATENTSYNC',
];

const STEPS = [
  {
    numeral: '01',
    title: 'Load a frame',
    copy: 'Shoot a still in Cinema Studio with real camera physics — body, lens, focal length, aperture — or upload your own start frame.',
  },
  {
    numeral: '02',
    title: 'Draw the move',
    copy: 'Drag one line across the frame. Speed, curves and pauses in your stroke become pacing, arcs and holds. Or pick from 14 preset moves — Dolly In, Whip Pan, 360 Orbit, FPV Drone.',
  },
  {
    numeral: '03',
    title: 'The AI directs',
    copy: 'Your stroke is translated into professional cinematographer language, one direction per clip, then rendered as chained Seedance 2.0 clips up to 90 seconds. Every clip is saved as it lands — failures resume, never restart.',
  },
];

// Real generated clips — rendered by the studio's own video pipeline.
const HOW_IT_WORKS = [
  {
    tag: 'Uses your frame',
    title: 'Some models start on your actual photo',
    body: 'Upload a frame and Seedance 1.5 or Vidu renders from those exact pixels — the first frame of the clip IS your image. The studio switches to one of these automatically the moment you attach a frame.',
    gif: '/showcase/gifs/explain-frame-exact.gif',
    alt: 'The uploaded photo beside a render that begins on the identical frame',
  },
  {
    tag: 'Guides style only',
    title: 'Others only read a description of it',
    body: 'Kling and Omni never see your pixels — the studio describes your image to them in words, so you get the mood and subject back, not the same building. We label these instead of pretending.',
    gif: '/showcase/gifs/explain-frame-guided.gif',
    alt: 'The same photo beside a Kling render showing a different diner',
  },
  {
    tag: 'Shape is per model',
    title: 'Portrait or landscape is the model, not a setting',
    body: 'PixVerse renders 9:16 portrait with sound; Kling renders 16:9. Pick the model that matches where the video is going — the picker shows each one&apos;s real output shape.',
    gif: '/showcase/gifs/explain-shapes.gif',
    alt: 'A portrait PixVerse clip beside a landscape Kling clip',
  },
  {
    tag: 'Text to video',
    title: 'Or write nothing but a sentence',
    body: 'The Prompt Agent expands a one-line idea into a full 200-word shot brief — subject, set, light, lens, and how the motion resolves — then renders it. This clip came from one sentence.',
    gif: '/showcase/gifs/explain-t2v.gif',
    alt: 'A paper boat drifting downstream, generated from a single sentence',
  },
  {
    tag: 'Camera moves',
    title: 'Direct the camera, keep the scene',
    body: 'Pick a move — dolly in, orbit, crash zoom — and it is applied to your frame instead of a new invention. Rendered here on a frame-exact model, so the push-in starts on the real photo.',
    gif: '/showcase/gifs/explain-camera.gif',
    alt: 'A slow push-in toward a neon diner',
  },
];

const SCENE_CLIPS = {
  '01': '/showcase/clips/neon-alley.mp4',
  '02': '/showcase/clips/glacier-reveal.mp4',
  '03': '/showcase/clips/orbit-dancer.mp4',
  '04': '/showcase/clips/crash-portrait.mp4',
  '05': '/showcase/clips/temple-pan.mp4',
  '06': '/showcase/clips/dolly-diner.mp4',
  '07': '/showcase/clips/backlot.mp4',
};

// ─── Shared bits ─────────────────────────────────────────────────────────────

function BrandMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" stroke="rgba(255,255,255,0.2)" />
      <path
        d="M7 22c4-9 8 3 12-6 2-4.4 4.5-3.6 6-2"
        stroke="#d4f939"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="7" cy="22" r="2" fill="#d4f939" />
      <circle cx="25" cy="14" r="2" fill="#a855f7" />
    </svg>
  );
}

function SlateDivider({ label }) {
  return (
    <div className="slate-head mb-10">
      <span className="tick-row" aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className="slate-label slate-label--cyan">{label}</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <div className="grain relative min-h-screen bg-ink-0 text-white">
      <div className="relative z-10">
        {/* ── Nav ── */}
        <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
          <Link href="/" className="flex items-center gap-3">
            <BrandMark />
            <span className="font-display text-lg font-bold tracking-tight">
              OpenVid<span className="text-primary"> Studio</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            <a href="#camera-path" className="slate-label transition-colors hover:text-white">
              Camera Path
            </a>
            <a href="#studios" className="slate-label transition-colors hover:text-white">
              Studios
            </a>
            <Link href="/showcase" className="slate-label transition-colors hover:text-white">
              Showcase
            </Link>
            <a href="#how-it-works" className="slate-label transition-colors hover:text-white">
              How it works
            </a>
            <Link href="/community" className="slate-label transition-colors hover:text-white">
              Community
            </Link>
            <Link href="/models" className="slate-label transition-colors hover:text-white">
              Models
            </Link>
            <a
              href="https://github.com/assistant4ed/openvid"
              target="_blank"
              rel="noreferrer"
              className="slate-label transition-colors hover:text-white"
            >
              GitHub
            </a>
          </nav>
          <Link href="/studio" className="btn btn-md btn-primary">
            Open the studio
          </Link>
        </header>

        {/* ── Hero — full-bleed cinematic plate, headline over real footage ── */}
        <section className="relative -mt-24 flex min-h-[86vh] items-end overflow-hidden">
          {/* Real generated footage as the plate */}
          <video
            src="/showcase/clips/hero.mp4"
            poster="/showcase/neon-alley.jpg"
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Legibility: vertical scrim + bottom fade into the page */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(3,3,4,0.94) 0%, rgba(3,3,4,0.72) 42%, rgba(3,3,4,0.25) 72%, rgba(3,3,4,0.55) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-56"
            style={{ background: 'linear-gradient(180deg, transparent, var(--ink-0))' }}
          />

          <div className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-20 pt-40">
            <div className="max-w-3xl">
              <p className="slate-label mb-6 flex items-center gap-3">
                <span className="rec-dot" aria-hidden="true" />
                REC · OPEN SOURCE · NO CONTENT FILTERS
              </p>
              <h1 className="display-hero">
                Draw the camera.
                <br />
                <span className="text-primary">Direct the AI.</span>
              </h1>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-white/70">
                One line of ink over a frame becomes a dolly, a crane, a whip pan.
                Your stroke is translated into cinematographer directions and
                rendered as a real clip — chained into longer shots, resumable
                when one fails.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link href="/studio/cinema" className="btn btn-lg btn-primary">
                  Start directing
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
                <Link href="/showcase" className="btn btn-lg btn-ghost">
                  Watch the reel
                </Link>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-2">
                <span className="slate-value">403 MODELS</span>
                <span className="slate-value">15 STUDIOS</span>
                <span className="slate-value">90S CHAINED SHOTS</span>
                <span className="slate-value">MIT LICENSED</span>
              </div>
            </div>
          </div>

          {/* Feature reel lives below the fold now, not crammed beside the headline */}
        </section>

        {/* ── Feature reel ── */}
        <section className="mx-auto max-w-7xl px-6 py-20">
          <SlateDivider label="WHAT IT DOES" />
          <FeatureShowcase />
        </section>

        {/* ── Camera Path — the flagship, numbered steps ── */}
        <section id="camera-path" className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <SlateDivider label="THE FLAGSHIP — CAMERA PATH" />
          <div className="grid gap-14 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <h2 className="display-1">
              A pen stroke is
              <br />
              a camera move.
            </h2>
            <div className="panel space-y-12 p-8">
              {STEPS.map((step) => (
                <article key={step.numeral} className="grid grid-cols-[auto_1fr] gap-6">
                  <span className="frame-numeral" aria-hidden="true">
                    {step.numeral}
                  </span>
                  <div className="pt-2">
                    <h3 className="display-3 mb-2">{step.title}</h3>
                    <p className="max-w-xl text-[15px] leading-relaxed text-white/55">
                      {step.copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Studios directory — uneven editorial grid ── */}
        <section id="studios" className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <SlateDivider label="THE LOT — 15 STUDIOS" />
          <div className="studio-grid reveal-stagger">
            {STUDIOS.map((studio) => {
              const Art = STUDIO_ART[studio.scene];
              return (
              <Link
                key={studio.scene}
                href={studio.href}
                className={`${studio.span} card-hover group relative flex min-h-[190px] flex-col justify-between overflow-hidden rounded-2xl border p-6 ${
                  studio.featured
                    ? 'border-[rgba(212,249,57,0.35)] bg-[rgba(212,249,57,0.05)]'
                    : 'border-white/[0.07] bg-white/[0.02]'
                }`}
              >
                <div className="mb-4 h-32 overflow-hidden rounded-xl border border-white/[0.06] transition-transform duration-300 group-hover:scale-[1.015]">
                  {SCENE_CLIPS[studio.scene] ? (
                    <video src={SCENE_CLIPS[studio.scene]} muted loop playsInline autoPlay preload="metadata" className="h-full w-full object-cover" />
                  ) : Art ? (
                    <Art />
                  ) : null}
                </div>
                <div className="flex items-start justify-between">
                  <span className="slate-label">SCENE {studio.scene}</span>
                  <span className={`slate-label ${studio.featured ? 'slate-label--cyan' : ''}`}>
                    {studio.tag}
                  </span>
                </div>
                <div>
                  <h3 className="display-3 mb-2 transition-colors group-hover:text-primary">
                    {studio.name}
                  </h3>
                  <p className="max-w-md text-[13px] leading-relaxed text-white/50">
                    {studio.copy}
                  </p>
                </div>
                <span
                  className="absolute bottom-6 right-6 text-white/20 transition-all group-hover:translate-x-1 group-hover:text-primary"
                  aria-hidden="true"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
              );
            })}
          </div>
        </section>

        {/* ── Model wall — marquee ── */}

        {/* How generation actually works — each panel is a REAL render from
            our own model QA, not a mockup. */}
        <section id="how-it-works" className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <span className="slate-label text-white/40">How it actually works</span>
          <h2 className="display-2 mt-3 max-w-3xl text-white">
            Every model behaves differently. The studio tells you which, before you spend.
          </h2>
          <p className="mt-4 max-w-2xl text-white/50">
            These panels are real output from our own model tests — the same clips the
            picker&apos;s labels are derived from.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {HOW_IT_WORKS.map((item) => (
              <figure key={item.title} className="panel overflow-hidden">
                <img
                  src={item.gif}
                  alt={item.alt}
                  loading="lazy"
                  className="w-full border-b border-white/8 bg-black object-contain"
                />
                <figcaption className="px-5 py-4">
                  <span className="slate-label text-[#d4f939]">{item.tag}</span>
                  <h3 className="mt-2 text-lg font-bold text-white">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/55">{item.body}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="models" className="letterbox-rule py-24">
          <div className="mx-auto max-w-7xl px-6">
            <SlateDivider label="THE VAULT — 184 MODELS, ONE BAR" />
          </div>
          <div className="marquee" aria-hidden="true">
            {[0, 1].map((copy) => (
              <div key={copy} className="marquee-track">
                {MODEL_WALL.map((model) => (
                  <span
                    key={`${copy}-${model}`}
                    className="slate-value whitespace-nowrap rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-2.5"
                  >
                    {model}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="mx-auto mt-8 flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6">
            <p className="max-w-2xl text-[13px] text-white/40">
              Every model behind one prompt bar with adaptive controls — aspect
              ratios, durations, resolutions and reference slots that reshape to
              each model&apos;s real capabilities.
            </p>
            <Link
              href="/models"
              className="slate-label whitespace-nowrap rounded-lg border border-[rgba(212,249,57,0.35)] px-4 py-2 text-[#d4f939] transition-colors hover:bg-[rgba(212,249,57,0.08)]"
            >
              Compare every price →
            </Link>
          </div>
        </section>

        {/* ── How it works — three steps, Higgsfield-style ── */}
        <section className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <SlateDivider label="MAKE A SHOT IN THREE STEPS" />
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Add your source',
                copy: 'Drop in a frame — JPG, PNG or WebP up to 8 MB. Drag, click or paste. No source? Shoot one in Cinema Studio first.',
                spec: 'IMAGE · MAX 8 MB',
              },
              {
                n: '02',
                title: 'Choose the move',
                copy: 'Pick from 14 camera presets — Dolly In, Whip Pan, 360 Orbit, FPV Drone — or draw the path yourself with a pen.',
                spec: '14 PRESETS · OR DRAW',
              },
              {
                n: '03',
                title: 'Get your video',
                copy: 'The AI Director writes the cinematography, then renders a real clip. Chain more for longer shots; failures resume.',
                spec: 'REAL CLIP · 5S+',
              },
            ].map((step) => (
              <article key={step.n} className="panel flex flex-col gap-3 p-7">
                <div className="flex items-baseline justify-between">
                  <span className="frame-numeral !text-[3.25rem]">{step.n}</span>
                  <span className="slate-label slate-label--cyan">{step.spec}</span>
                </div>
                <h3 className="display-3">{step.title}</h3>
                <p className="text-[13.5px] leading-relaxed text-white/55">{step.copy}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Capabilities — grouped, framed, scannable ── */}
        <section className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <SlateDivider label="WHAT ELSE IS IN THE KIT" />
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                group: 'Shooting',
                items: [
                  ['Camera physics', 'Six bodies, eleven lenses, focal length and aperture'],
                  ['Multi-reference', 'Up to 14 ordered reference images on edit models'],
                  ['Smart controls', 'Aspect, duration and resolution adapt to each model'],
                ],
              },
              {
                group: 'Rendering',
                items: [
                  ['Long-form', 'Native extend chaining for shots beyond one clip'],
                  ['Resume', 'A failed clip continues from the last finished one'],
                  ['Live status', 'Per-clip timeline while the render is running'],
                ],
              },
              {
                group: 'Your studio',
                items: [
                  ['Upload history', 'References uploaded once, reusable across sessions'],
                  ['Private by default', 'Keys and history stay in your browser'],
                  ['Workflows & agents', 'Node pipelines and multi-turn creative agents'],
                ],
              },
            ].map((column) => (
              <div key={column.group} className="panel p-7">
                <p className="slate-label slate-label--cyan mb-5">{column.group}</p>
                <dl className="space-y-4">
                  {column.items.map(([term, detail]) => (
                    <div key={term}>
                      <dt className="font-display text-[15px] tracking-tight text-white">{term}</dt>
                      <dd className="mt-0.5 text-[12.5px] leading-relaxed text-white/45">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>

        {/* ── Keys / how it runs ── */}
        <section className="letterbox-rule mx-auto max-w-7xl px-6 py-24">
          <SlateDivider label="PRODUCTION — HOW IT RUNS" />
          <div className="grid gap-10 md:grid-cols-2">
            <div className="panel p-8">
              <p className="slate-label slate-label--cyan mb-4">01 · THE DIRECTOR&apos;S KEY</p>
              <h3 className="display-2 mb-3">SuperbAPI</h3>
              <p className="mb-6 text-[15px] leading-relaxed text-white/55">
                One key signs you in and pays for the AI Director — the model that
                reads your stroke and writes camera language. Your credits, your
                usage, visible in the header.
              </p>
              <a
                href="https://www.superbapi.com"
                target="_blank"
                rel="noreferrer"
                className="btn btn-md btn-outline-cyan"
              >
                Get your key →
              </a>
            </div>
            <div className="panel p-8">
              <p className="slate-label mb-4">02 · THE RENDER FARM</p>
              <h3 className="display-2 mb-3">Bring your models</h3>
              <p className="mb-6 text-[15px] leading-relaxed text-white/55">
                Cloud rendering runs through your own provider key, added once in
                Settings. Or skip the cloud entirely — the desktop app bundles
                sd.cpp and speaks to a Wan2GP box for fully local inference.
              </p>
              <a
                href="https://github.com/assistant4ed/openvid"
                target="_blank"
                rel="noreferrer"
                className="btn btn-md btn-ghost"
              >
                Read the docs
              </a>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="letterbox-rule px-6 py-28 text-center"><div className="panel mx-auto max-w-3xl px-8 py-14">
          <p className="slate-label slate-label--cyan mb-6">FINAL SLATE</p>
          <h2 className="display-1 mx-auto max-w-3xl">
            The whole back lot is yours.
          </h2>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/studio" className="btn btn-lg btn-primary">
              Open OpenVid Studio
            </Link>
          </div>
        </div></section>

        {/* ── Footer ── */}
        <footer className="letterbox-rule mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 py-10 md:flex-row">
          <div className="flex items-center gap-3">
            <BrandMark size={22} />
            <span className="slate-value">OPENVID STUDIO · MIT · 2026</span>
          </div>
          <div className="flex items-center gap-8">
            <a
              href="https://github.com/assistant4ed/openvid"
              target="_blank"
              rel="noreferrer"
              className="slate-label transition-colors hover:text-white"
            >
              GitHub
            </a>
            <a
              href="https://www.superbapi.com"
              target="_blank"
              rel="noreferrer"
              className="slate-label transition-colors hover:text-white"
            >
              SuperbAPI
            </a>
            <Link href="/studio" className="slate-label transition-colors hover:text-white">
              Studio
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
