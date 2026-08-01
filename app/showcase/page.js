import fs from 'node:fs';
import path from 'node:path';

import Link from 'next/link';

export const metadata = {
  title: 'Showcase — OpenVid Studio',
  description:
    'Frames generated in-studio on a SuperbAPI key, each with its AI-directed camera move. Every entry becomes a full clip the moment a video backend is configured.',
};

function loadManifest() {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'showcase', 'manifest.json'),
      'utf-8',
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// The camera move plays over the real generated frame: the frame slowly
// drifts (Ken Burns per move) while the drawn path traces itself on loop.
export default function ShowcasePage() {
  const entries = loadManifest();

  return (
    <div className="grain relative min-h-screen bg-ink-0 text-white">
      <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <header className="mb-12 flex items-center justify-between">
          <div>
            <p className="slate-label slate-label--cyan mb-3">DAILIES — MADE IN THE STUDIO</p>
            <h1 className="display-1">Showcase</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/55">
              Every frame below was generated inside OpenVid on a SuperbAPI key,
              and every camera move is a real AI Director read of its preset
              path. When a video backend is connected, these same briefs render
              as full clips — automatically.
            </p>
          </div>
          <Link href="/studio/cinema" className="btn btn-md btn-primary shrink-0">
            Make your own
          </Link>
        </header>

        {entries.length === 0 ? (
          <p className="slate-value">NO ENTRIES YET — RUN scripts/showcase-agent.mjs</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 reveal-stagger">
            {entries.map((entry, index) => (
              <article
                key={entry.slug}
                className="card-hover group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]"
              >
                <div className="relative aspect-video overflow-hidden">
                  {entry.video ? (
                    <video
                      src={entry.video}
                      poster={entry.image}
                      muted
                      loop
                      playsInline
                      autoPlay
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={entry.gif || entry.image}
                      alt={entry.title}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {entry.path && (
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    >
                      <polyline
                        points={entry.path.points}
                        fill="none"
                        stroke="#d4f939"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        className="path-draw"
                        strokeDasharray="1000"
                        style={{ animationDelay: `${0.15 * index}s` }}
                      />
                      <circle cx={entry.path.start.x} cy={entry.path.start.y} r="1.4" fill="#d4f939" />
                      <circle cx={entry.path.end.x} cy={entry.path.end.y} r="1.8" fill="none" stroke="#a855f7" strokeWidth="0.6" />
                    </svg>
                  )}
                  <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/60 px-2 py-1 backdrop-blur-md">
                    <span className="slate-label" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      {entry.feature}
                    </span>
                  </span>
                </div>
                <div className="p-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <h2 className="display-3">{entry.title}</h2>
                    <span className="slate-label slate-label--cyan">SCENE {String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-white/45">
                    <span className="mr-1.5 rounded border border-[rgba(212,249,57,0.2)] bg-[rgba(212,249,57,0.08)] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                      AI Director
                    </span>
                    {entry.direction}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
