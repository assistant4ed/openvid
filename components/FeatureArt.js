// Feature illustration library — hand-crafted vector scenes in the film-slate
// palette (obsidian layers, flat cyan, violet markers, amber REC only).
// These replace icon-only cards with real art while staying CSP-safe,
// palette-exact and crisp at any DPI. Every scene shares the same letterboxed
// 16:9 stage so the landing reads as one photographed system.

const INK = ['#07090b', '#0a0f12', '#10161b', '#182028'];
const CYAN = '#d4f939';
const VIOLET = '#a855f7';
const REC = '#f59e0b';

function Stage({ children, label }) {
  return (
    <svg
      viewBox="0 0 320 180"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
    >
      <rect width="320" height="180" fill={INK[0]} />
      {children}
      {/* letterbox bars */}
      <rect width="320" height="10" fill="#030304" />
      <rect y="170" width="320" height="10" fill="#030304" />
      <rect y="10" width="320" height="0.75" fill="rgba(212,249,57,0.28)" />
      <rect y="169.25" width="320" height="0.75" fill="rgba(255,255,255,0.08)" />
    </svg>
  );
}

export function ArtCameraPath() {
  return (
    <Stage label="A drawn camera path arcing across a mountain ridge">
      <path d="M0 118 L52 82 L96 112 L156 66 L212 102 L262 78 L320 100 L320 180 L0 180 Z" fill={INK[1]} />
      <path d="M0 140 L70 118 L150 136 L240 114 L320 130 L320 180 L0 180 Z" fill={INK[0]} />
      <circle cx="262" cy="46" r="14" fill="none" stroke="rgba(255,255,255,0.1)" />
      <path
        d="M36 138 C 90 132, 116 100, 164 88 S 252 62, 276 50"
        stroke={CYAN}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M36 138 C 90 132, 116 100, 164 88 S 252 62, 276 50"
        stroke="rgba(212,249,57,0.28)"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
        style={{ filter: 'blur(4px)' }}
      />
      <circle cx="36" cy="138" r="4.5" fill={CYAN} />
      <circle cx="276" cy="50" r="6.5" fill="none" stroke={VIOLET} strokeWidth="1.8" />
      <circle cx="276" cy="50" r="2.8" fill={VIOLET} />
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <circle cx="24" cy="24" r="3" fill={REC} />
        <text x="33" y="26.5" fill="rgba(255,255,255,0.7)">REC · SCENE 01</text>
        <text x="234" y="160" fill={CYAN}>CRANE UP · 25S</text>
      </g>
    </Stage>
  );
}

export function ArtVideoChain() {
  const clips = [
    { x: 22, w: 92, done: true },
    { x: 120, w: 64, done: true },
    { x: 190, w: 64, rec: true },
    { x: 260, w: 40 },
  ];
  return (
    <Stage label="Chained video clips on a timeline, one rendering">
      <rect x="22" y="34" width="278" height="76" rx="6" fill={INK[1]} />
      <path d="M60 96 L96 72 L128 92 L176 60 L224 84 L262 68 L300 82" stroke="rgba(255,255,255,0.14)" strokeWidth="1.6" fill="none" />
      <path d="M60 96 L96 72 L128 92" stroke={CYAN} strokeWidth="1.6" fill="none" />
      {clips.map((clip, index) => (
        <g key={index}>
          <rect x={clip.x} y="122" width={clip.w} height="26" rx="5" fill={INK[2]} stroke={clip.rec ? 'rgba(245,158,11,0.55)' : 'rgba(255,255,255,0.09)'} />
          <rect x={clip.x} y="144" width={clip.w} height="4" rx="2" fill={clip.done ? CYAN : clip.rec ? REC : 'rgba(255,255,255,0.12)'} />
          {clip.done && (
            <path d={`M${clip.x + clip.w / 2 - 5} 135 l4 4 l7 -8`} stroke={CYAN} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          )}
          {clip.rec && <circle cx={clip.x + clip.w / 2} cy="135" r="3.5" fill={REC} />}
        </g>
      ))}
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <text x="22" y="26" fill="rgba(255,255,255,0.45)">ONE SHOT · 45S · 4 CLIPS</text>
        <text x="196" y="160" fill="rgba(255,255,255,0.4)">RESUMES · NEVER RESTARTS</text>
      </g>
    </Stage>
  );
}

export function ArtImageStack() {
  return (
    <Stage label="Layered image frames with reference badges">
      <g transform="rotate(-6 120 96)">
        <rect x="52" y="52" width="120" height="84" rx="8" fill={INK[2]} stroke="rgba(255,255,255,0.1)" />
        <path d="M62 118 L92 88 L112 106 L136 78 L162 104" stroke="rgba(255,255,255,0.22)" strokeWidth="2" fill="none" />
        <circle cx="84" cy="74" r="7" fill="rgba(255,255,255,0.14)" />
      </g>
      <g transform="rotate(4 190 100)">
        <rect x="130" y="44" width="120" height="84" rx="8" fill={INK[3]} stroke="rgba(212,249,57,0.4)" />
        <path d="M140 112 L172 80 L192 98 L214 72 L240 100" stroke={CYAN} strokeWidth="2" fill="none" />
        <circle cx="160" cy="66" r="7" fill="rgba(212,249,57,0.35)" />
      </g>
      <g fontFamily="var(--font-mono-stack)" fontSize="7.5" letterSpacing="1">
        {[1, 2, 3].map((n, index) => (
          <g key={n} transform={`translate(${252 + 0 * index} ${44 + index * 26})`}>
            <rect width="34" height="18" rx="4" fill={INK[2]} stroke="rgba(255,255,255,0.12)" />
            <text x="8" y="12.5" fill={index === 0 ? CYAN : 'rgba(255,255,255,0.5)'}>@{n}</text>
          </g>
        ))}
        <text x="52" y="160" fill="rgba(255,255,255,0.45)">14 REFERENCE SLOTS · ORDERED</text>
      </g>
    </Stage>
  );
}

export function ArtLipSync() {
  const bars = [8, 18, 12, 26, 34, 22, 40, 30, 16, 24, 12, 20, 8];
  return (
    <Stage label="Audio waveform driving a talking portrait">
      <rect x="36" y="38" width="92" height="104" rx="10" fill={INK[2]} stroke="rgba(255,255,255,0.1)" />
      <circle cx="82" cy="74" r="18" fill="rgba(255,255,255,0.12)" />
      <path d="M64 128 C 64 108, 100 108, 100 128" fill="rgba(255,255,255,0.12)" />
      <ellipse cx="82" cy="100" rx="7" ry="3.4" fill={VIOLET} />
      <g transform="translate(150 90)">
        {bars.map((height, index) => (
          <rect
            key={index}
            x={index * 11}
            y={-height / 2}
            width="5"
            height={height}
            rx="2.5"
            fill={index < 8 ? CYAN : 'rgba(255,255,255,0.18)'}
          />
        ))}
      </g>
      <path d="M132 90 L146 90" stroke="rgba(212,249,57,0.5)" strokeWidth="1.6" strokeDasharray="3 3" />
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <text x="150" y="130" fill="rgba(255,255,255,0.45)">VOICE → PORTRAIT · 9 MODELS</text>
      </g>
    </Stage>
  );
}

export function ArtWorkflow() {
  return (
    <Stage label="A node pipeline connecting model stages">
      {[
        { x: 30, y: 52, on: true },
        { x: 30, y: 108 },
        { x: 128, y: 80, on: true },
        { x: 226, y: 52 },
        { x: 226, y: 108, on: true },
      ].map((node, index) => (
        <g key={index}>
          <rect x={node.x} y={node.y} width="64" height="30" rx="7" fill={INK[2]} stroke={node.on ? 'rgba(212,249,57,0.45)' : 'rgba(255,255,255,0.1)'} />
          <circle cx={node.x + 12} cy={node.y + 15} r="3" fill={node.on ? CYAN : 'rgba(255,255,255,0.2)'} />
          <rect x={node.x + 22} y={node.y + 11} width="32" height="3" rx="1.5" fill="rgba(255,255,255,0.18)" />
          <rect x={node.x + 22} y={node.y + 18} width="22" height="3" rx="1.5" fill="rgba(255,255,255,0.1)" />
        </g>
      ))}
      <path d="M94 67 C 112 67, 112 95, 128 95" stroke={CYAN} strokeWidth="1.6" fill="none" />
      <path d="M94 123 C 112 123, 112 95, 128 95" stroke="rgba(255,255,255,0.2)" strokeWidth="1.6" fill="none" />
      <path d="M192 95 C 210 95, 210 67, 226 67" stroke="rgba(255,255,255,0.2)" strokeWidth="1.6" fill="none" />
      <path d="M192 95 C 210 95, 210 123, 226 123" stroke={CYAN} strokeWidth="1.6" fill="none" />
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <text x="30" y="160" fill="rgba(255,255,255,0.45)">CHAIN MODELS · RUN VIA API</text>
      </g>
    </Stage>
  );
}

export function ArtAgent() {
  return (
    <Stage label="A creative agent conversation producing a shot">
      <rect x="30" y="40" width="150" height="24" rx="12" fill={INK[2]} stroke="rgba(255,255,255,0.1)" />
      <rect x="42" y="49" width="90" height="4" rx="2" fill="rgba(255,255,255,0.25)" />
      <rect x="66" y="74" width="150" height="24" rx="12" fill="rgba(212,249,57,0.1)" stroke="rgba(212,249,57,0.4)" />
      <rect x="78" y="83" width="104" height="4" rx="2" fill={CYAN} opacity="0.7" />
      <rect x="30" y="108" width="118" height="24" rx="12" fill={INK[2]} stroke="rgba(255,255,255,0.1)" />
      <rect x="42" y="117" width="66" height="4" rx="2" fill="rgba(255,255,255,0.25)" />
      <g transform="translate(232 96)">
        <rect x="0" y="0" width="58" height="40" rx="6" fill={INK[3]} stroke={VIOLET} strokeWidth="1.2" />
        <path d="M8 30 L22 16 L32 26 L42 12 L52 24" stroke={VIOLET} strokeWidth="1.8" fill="none" />
      </g>
      <path d="M216 86 C 228 86, 228 96, 232 100" stroke="rgba(168,85,247,0.5)" strokeWidth="1.4" strokeDasharray="3 3" fill="none" />
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <text x="30" y="160" fill="rgba(255,255,255,0.45)">PLANS · PROMPTS · DELIVERS</text>
      </g>
    </Stage>
  );
}

export function ArtBacklot() {
  const bars = [14, 26, 20, 34, 24, 40, 28, 18];
  return (
    <Stage label="Clapperboard and audio bars — the back lot">
      <g transform="rotate(-4 92 92)">
        <rect x="44" y="76" width="96" height="58" rx="6" fill={INK[2]} stroke="rgba(255,255,255,0.12)" />
        <rect x="44" y="60" width="96" height="18" rx="4" fill={INK[3]} />
        {[0, 1, 2, 3].map((index) => (
          <rect
            key={index}
            x={50 + index * 24}
            y="62"
            width="12"
            height="14"
            rx="2"
            fill={index % 2 ? 'rgba(255,255,255,0.55)' : CYAN}
            transform={`skewX(-18) translate(${index * 2} 0)`}
          />
        ))}
        <rect x="52" y="90" width="60" height="4" rx="2" fill="rgba(255,255,255,0.2)" />
        <rect x="52" y="102" width="44" height="4" rx="2" fill="rgba(255,255,255,0.12)" />
      </g>
      <g transform="translate(186 118)">
        {bars.map((height, index) => (
          <rect key={index} x={index * 13} y={-height} width="6" height={height} rx="3" fill={index === 5 ? REC : 'rgba(212,249,57,0.7)'} />
        ))}
      </g>
      <g fontFamily="var(--font-mono-stack)" fontSize="7" letterSpacing="1.4">
        <text x="186" y="142" fill="rgba(255,255,255,0.45)">AUDIO · CLIP · RECAST · ADS</text>
      </g>
    </Stage>
  );
}

export const STUDIO_ART = {
  '01': ArtCameraPath,
  '02': ArtVideoChain,
  '03': ArtImageStack,
  '04': ArtLipSync,
  '05': ArtWorkflow,
  '06': ArtAgent,
  '07': ArtBacklot,
};
