# Prompt Flow Reference — what the backend actually sends to the AI

Every path from user input → AI request, with the verbatim templates.
(Current as of 2026-08-01; all local-mode/SuperbAPI paths.)

## Summary table

| # | Surface | User provides | Pre-processing | Prompt Agent template | Final AI call |
|---|---------|--------------|----------------|----------------------|---------------|
| 1 | Image Studio / Workspace — text-to-image | prompt only | — | **t2i**: subject + setting + lighting + camera framing + style + quality, ≤110 words | `gemini-3.1-flash-image-preview-c` chat/completions, text message = expanded prompt |
| 2 | Image Studio / Workspace — edit with photo(s) | prompt + up to 4 photos | photos → data URLs, downscaled ≤1536px JPEG in browser | **i2i**: restate as ONE precise edit instruction + "everything else stays IDENTICAL", ≤80 words | same model, multimodal message: `[text, image_url…]` |
| 3 | Video Studio / Workspace — text-to-video | prompt (+model/duration/aspect) | duration clamped to 5s/10s | **t2v**: subject+action, camera move, pacing, lighting, single continuous shot, ≤100 words | gateway `POST /v1/videos {model, prompt, duration, aspect_ratio}` |
| 4 | Video Studio / Workspace — animate an image | prompt + start frame | frame → data URL → hosted on `/api/asset` → public URL | **i2v**: what moves + camera + pacing + "stay true to the start frame", ≤90 words | `POST /v1/videos {…, image_url}` |
| 5 | Camera Path — drawn stroke | pen stroke + scene + preset/duration | stroke → `analyzePath()` → segments (direction/share/speed), start/end regions, curve shape | **AI Director** (separate route): strict-JSON, one 25–55-word cinematographer direction per clip | direction wrapped as `"Camera movement: {direction} Keep the scene, subjects, and lighting consistent throughout."` → call #4 |
| 6 | Workspace — camera preset | preset chip + prompt | — | prefix `"Camera move: {label} ({hint}). "` then template #3/#4 | call #3 or #4 |
| 7 | Cinema Studio — still shot | prompt + camera/lens/focal/aperture | deterministic template (no LLM) | — | image engine with the assembled optics prompt |
| 8 | Chained clips (catalog mode) | one stroke, long duration | plan split into clips | per-clip continuation: "Continue the same unbroken move without resetting…" | one render per clip, each `request_id`-chained |

## Verbatim templates

### Prompt Agent (`/api/prompt-agent`)
Models (2026-08-01, after the upstream token was flipped to per-call-only and
every `models/gemini-*` chat id started 400ing): text modes run on
`deepseek-v4-flash` (~2s); vision runs on `grok-4` (~20s per image). One
vision image = a single see-and-write call; several images (start + end
frame, references) = parallel one-image describes on grok-4, then a
`i2v-compose` pass on deepseek that writes the final prompt from the frame
notes. If the vision path fails, the route degrades to a text-only `i2v`
expansion and returns `visionUsed:false`; the client then tells the user
the frames were not read this run. Overridable via `SUPERBAPI_PROMPT_MODEL`
/ `SUPERBAPI_PROMPT_VISION_MODEL`.
System prompt:
> You are the Prompt Agent of an AI film/image studio. First infer what the
> user actually wants; then write the full production prompt.
> Mode brief: {one of the four below}
> Reply with STRICT JSON only, no fences:
> {"intent":"one plain sentence describing what the user wants",
> "prompt":"the full production prompt"}

Mode briefs:
- **t2i** — "Expand into ONE production prompt covering: main subject with
  concrete visual details, setting, lighting (source/mood/time of day), camera
  framing and lens feel, art direction or style, and quality descriptors. Max
  110 words. Never invent text/watermarks."
- **i2i** — "Image editing with a reference photo the model will see. Restate
  the user's request as ONE precise edit instruction: name exactly WHAT changes
  (objects, colors, clothing, background) and command that everything else —
  faces, pose, composition, lighting, style — stays IDENTICAL to the
  reference. Max 80 words."
- **t2v** — "Expand into ONE cinematic shot description: subject and its
  action/motion, setting, camera movement (dolly/pan/track/static), pacing,
  lighting and atmosphere, lens/style feel. Present tense, max 100 words,
  single continuous shot, no cuts."
- **i2v** — "Image-to-video with a start frame the model will animate.
  Describe ONE continuous motion: what in the frame moves and how, camera
  behaviour, pacing, atmosphere. Command that subjects, style and lighting
  stay true to the start frame. Present tense, max 90 words, no cuts."

Skipped when the user's prompt is already >350 chars; fails open to the raw
prompt on any error. The returned `intent` is the "what the user actually
wants" sentence.

### AI Director (`/api/camera-path`, model `deepseek-v4-flash` via `SUPERBAPI_MODEL`, temp 0.4)
System prompt:
> You are a film director translating a hand-drawn camera path into camera
> directions for an AI image-to-video generator. The user drew a line over the
> start frame; the camera must travel along it. You receive structured path
> data: ordered segments with screen-space direction, share of the total path
> length, and speed, plus start/end frame regions, overall curve shape, and an
> optional finishing move. You also receive a clip plan. The final video is
> rendered as that many clips, each continuing the previous one from its last
> frame. Return STRICT JSON, no markdown fences, shaped exactly:
> `{"overview":"...","segments":[{"index":0,"direction":"..."}]}` — one
> segments entry per clip, in order. Each direction is 25–55 words of
> professional cinematography (track, dolly, pan, tilt, crane, arc, push in,
> pull back, ease out) covering only that clip's slice of the path, at that
> clip's pacing. Clips after the first MUST read as an unbroken continuation —
> never restart, re-establish, or cut. Describe ONLY camera motion; never
> invent scene content, characters, or edits.

User payload: `{camera_path: analysis, scene_hint, finishing_move, clip_plan,
total_seconds}` where `analysis` = `{startRegion, endRegion, pathCoverage,
curveShape, segments:[{direction, share, speed}]}` computed from the stroke
(8-way compass directions, speed terciles from stroke timing, thirds-grid
regions, total-turn curve classification).

Per-clip render wrapper:
> Camera movement: {direction} Keep the scene, subjects, and lighting
> consistent throughout.

### Cinema Studio still (deterministic template, no LLM)
> {user prompt}, shot on a {camera body}, using a {lens} at {focal}mm
> ({perspective}), aperture {f-stop}, {depth-of-field effect}, cinematic
> lighting, natural color science, high dynamic range, professional
> photography, ultra-detailed, 8K resolution
>
> negative: blurry, low quality, distortion, bad composition
