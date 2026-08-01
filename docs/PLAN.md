# OpenVid — Master Plan (from Ed's requirements, 2026-07-31)

Status legend: ✅ done · 🔧 partial · ⬜ todo

## Phase 1 — Generation reliability (FIRST PRIORITY)
- ✅ Real video via gateway `/v1/videos` submit+poll (Kling 2.5; verified in prod UI end-to-end)
- ✅ Real image gen (`gemini-3.1-flash-image-preview-c`)
- 🔧 Uploaded image must drive Video Studio i2v: route data-URL uploads through
  `/api/asset` → pass hosted URL as `image_url` in `generateVideoViaSuperb`
  (Camera Path already does this; port the same 8-line block into the video branch
  in `packages/studio/src/muapi.js` and delete the http-only filter).
- ⬜ Graceful deploy rolls: catch `Failed to fetch` in muapi.js fetch wrappers →
  toast "Deploy in progress — retry in a few seconds", auto-retry once.

## Phase 2 — Key-aware models (Ed: "only show the api key models")
- ✅ `/api/superb-capabilities` probe (free, no-render) — returns enabled video models
- ⬜ Studios read capabilities on sign-in; model pickers show ONLY enabled models;
  duration/aspect clamped to the model's declared shapes (kills ErrCode=70000 class)
- ⬜ Multi-key: Settings stores several keys, drag-to-rank; per-key model list shown;
  generation uses highest-ranked key that supports the chosen model

## Phase 3 — Upload & control UX
- ✅ UploadZone (spec-stating dropzone, paste, guidance per effect) in Camera Path
- ⬜ Drag & drop EVERYWHERE: replace remaining file-input buttons in Video/Image/
  LipSync/Recast/Audio studios with UploadZone (it already supports all kinds)
- ⬜ First & last frame inputs in Video Studio (catalog `lastImageField` exists;
  UI needs a second UploadZone slot)
- ⬜ Create / Edit / Motion Control tab triad (Higgsfield reference):
  Create = current studio; Edit = v2v via gateway when a v2v model is enabled;
  Motion Control = Camera Path promoted to a top-level tab

## Phase 4 — Design (Ed: realistic images, no icon-only graphics)
- ✅ Yellow brand everywhere, Anton display, framed cards, full-bleed video hero
- ⬜ Replace ALL vector-only visuals with real generated media:
  reel slides → use showcase clips as backgrounds with slate overlay;
  scene-07 backlot card → clips/backlot.mp4; kit/steps cards → generated stills
  (generate via scripts/showcase-agent.mjs pattern, one still per card)
- ⬜ Brand rename once Ed picks from the 10 offered names (logo, wordmark, metadata)

## Phase 5 — Accounts
- ⬜ Decide storage (Railway Postgres recommended over volume JSON), then:
  email+password or key-only accounts, server-side key vault, per-user history sync

## Facts the next session needs
- Enabled video models on Ed's key: kling-2.5, kling-2.5-1080p (5s/10s only)
- Video API: POST /v1/videos {model,prompt,duration,aspect_ratio,image_url} →
  task_id; GET /v1/videos/{id} → status/video_url. Billed only on successful submit.
- Deploy: `railway up --detach --service openvid`; never `npm run build` while dev runs
- Test suite: `node --test tests/*.test.js tests/*.test.mjs` (35 green)

## Phase 6 — Real backend (2026-08-01, from Ed's gap audit)

The browser used to orchestrate renders (vision pass + submit ran client-side,
20–40s exposed to reloads); results lived on expiring provider URLs; accounts
had no operator controls. This phase moves the spine server-side.

| # | Gap | Fix | Status |
|---|-----|-----|--------|
| 6.1 | Reload during submit killed the render ("Interrupted before submit") | Server-side job pipeline: POST /api/jobs stores the spec in Postgres (render_jobs), server does grounding → submit → poll → result; ticker rescues jobs across restarts | ✅ shipped |
| 6.2 | "Finished" videos die later (provider storage expires) | Completed clips are downloaded server-side into the durable asset store; task URLs point at /api/asset/… | ✅ shipped |
| 6.3 | References not really used (Kling family drops frames) | Seedance 1.5 = pixel-exact via first_frame_image (gateway fix); picker labels "frame-exact" vs vision-assisted; frame modes steer to exact | ✅ shipped |
| 6.4 | No admin control over accounts | /admin console + /api/admin/users (list, disable/enable, delete), ADMIN_TOKEN-gated; disabled users blocked at login/session | ✅ shipped |
| 6.5 | Task history per-browser | /api/account/tasks per-account sync (already live earlier today) | ✅ shipped |
| 6.6 | Remaining | Migrate VideoStudio/CameraPath onto /api/jobs; job-based image generation; per-user usage dashboards in /admin; refund-on-failed-render (webieai) | ▢ next |
