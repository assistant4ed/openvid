# OpenVid Studio — Design System ("Film Slate")

Date: 2026-07-31 · Status: shipped v1 · Owner: design overhaul session

## 1. Art direction

OpenVid Studio is **a film studio in software**. Three adjectives drive every
choice: **cinematic · precise · obsidian**.

The signature move is the **film-slate metadata label**: uppercase JetBrains
Mono micro-labels (`SCENE 01 · 16:9 · 25S · 104 CR`) used everywhere a lesser
app would put a pill badge. Paired with one self-drawing camera-path motif,
it makes the product read as a director's tool, not a template SaaS.

We deliberately design *against* the AI-slop average: no Inter-everywhere, no
blue→purple gradient blobs, no identical shadow-card grids, no pill eyebrow
with a dot. Dark UI is correct for this vertical (DaVinci, Runway,
Higgsfield) — readability is protected with 16px+ body, high-contrast text
tokens and generous spacing.

## 2. Type system

| Role | Face | Usage |
| --- | --- | --- |
| Display | **Bricolage Grotesque** 400–800 | Headlines, studio names, `.display-hero/.display-1/2/3` |
| Body | **Inter** | Paragraphs, controls, `.font-sans` |
| Slate | **JetBrains Mono** 400–700 | `.slate-label`, `.slate-value`, `.frame-numeral`, prompt-bar controls |

Rules: big jumps between display and body sizes; tight tracking (−0.02 to
−0.03 em) on display; `0.18em` letter-spacing on slate labels; tabular
numerals for all counts. All three faces are self-hosted via `next/font`
(the old Google Fonts CSS `@import` violated the CSP and silently failed).

## 3. Color

Five obsidian surface layers (`--ink-0 … --ink-4`, #030304 → #1a1a20) and
four text tokens (`--text-hi/mid/low/ghost`). One conviction accent:

- **Electric cyan `#22d3ee`** — flat marks, hairline rules, focus ticks,
  primary buttons. Never used as a gradient wash.
- **Signal amber `#f59e0b`** — *reserved exclusively* for live REC/rendering
  states (`.rec-dot`, `.btn-rec`). If it's amber, something is being paid for.
- **Violet `#a855f7`** — path end-markers only.

## 4. Texture & recurring motifs

- **Grain**: fixed-position SVG turbulence overlay (`.grain`), 4% alpha,
  stepped drift; disabled under `prefers-reduced-motion`.
- **Letterbox rule** (`.letterbox-rule`): 1px cyan-fading hairline topping
  each section — the anamorphic frame line.
- **Tick row** (`.tick-row`): three film-perforation ticks, first one cyan.
- **Frame numerals** (`.frame-numeral`): oversized stroked mono digits as
  section markers (01/02/03).
- **Self-drawing path** (`.path-draw` + `.path-dot`): the one signature
  animation — used on the landing hero, the key gate, and echoed by the real
  drawing canvas in Camera Path.

## 5. Motion rules

- Two easings only: `--ease-out-expo` for entrances, `--ease-swift` for
  state changes. Durations 150/250/500ms.
- Library: `fade-in-up/down`, `scale-up`, `shake` (errors), `slide-next/prev`,
  `recast-sweep` (skeletons), `rec-pulse`, `marquee-scroll`, `path-draw`,
  `.reveal-stagger` for list entrances.
- Everything decorative is hard-gated behind `prefers-reduced-motion`.

## 6. Components

- **Panels**: `.panel` (flat card), `.panel-pop` (modal, blur + heavy
  shadow), `.frame-viewport` (letterboxed media window).
- **Buttons**: `.btn` + `.btn-primary` (cyan/ink), `.btn-ghost`,
  `.btn-outline-cyan`, `.btn-rec` — square-ish 10–12px radii, no glow spam.
- **Fields**: `.field`, `.field-mono`, `.field-error` (+ shake).
- **Prompt composer** (shared by all 15 studios): flat obsidian slate with a
  cyan top hairline, mono uppercase controls, rectangular cyan action button.
- **Popovers**: origin-aware `scale-up`, cyan tick in the header.

## 7. Layout grammar

- Landing uses an **asymmetric 7/5 hero split** and a **6-column studio grid
  with deliberately uneven spans** (4/2/2/2/2/3/3) — no identical-card grid.
- Studio shell: rail sidebar + slate header with the **live SuperbAPI credits
  chip** (`104 CR`) as the primary status object.
- Section order on the landing intentionally avoids the hero→features→
  testimonials template: hero → flagship deep-dive (numbered) → uneven studio
  directory → model marquee → dual-key "how it runs" → final slate.

## 8. Voice

Copy speaks in production language: "Slate in", "The lot", "The vault",
"Final slate", "REC · SCENE 01 · TAKE 03". Benefit lines are specific
("chained into shots up to 90 seconds, resumable when a clip fails") — never
"Elevate your workflow".

## 9. Auth model (design-relevant)

The **SuperbAPI key is the session** — validated live against
`/v1/key` at the gate, credits shown in the header, and the same key pays for
the AI Director (per-user billing; server env key is only a self-host
fallback). The MuAPI render key is optional, added later in Settings; amber
states and the auth-required event route users there when a render needs it.

## 10. Pre-ship checklist status

- [x] ≥2 contrasting families incl. a display face (Bricolage + Inter + JBM)
- [x] Major asymmetric sections (hero split, uneven studio grid)
- [x] No purple/blue gradient blobs — flat cyan + grain texture
- [x] Zero decorative emoji/icons; numerals, rules and ticks instead
- [x] Specific headline ("Draw the camera. Direct the AI.")
- [x] Signature details (self-drawing path, slate labels, frame numerals)
- [x] Blind test: the slate language is recognisably OpenVid
