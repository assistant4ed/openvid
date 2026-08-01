// Single source of truth for what a user may upload, per input type.
// Every dropzone, validator and hint string reads from here so the UI can
// never promise something the backend will reject.

export const UPLOAD_SPECS = {
  image: {
    label: "Image",
    accept: "image/jpeg,image/png,image/webp",
    extensions: ["JPG", "PNG", "WebP"],
    maxBytes: 8 * 1024 * 1024,
    maxLabel: "8 MB",
    spec: "JPG · PNG · WebP — max 8 MB",
    hint: "A sharp, well-lit frame works best. 16:9 keeps the full field of view.",
  },
  video: {
    label: "Video",
    accept: "video/mp4,video/quicktime,video/webm",
    extensions: ["MP4", "MOV", "WebM"],
    maxBytes: 50 * 1024 * 1024,
    maxLabel: "50 MB",
    minSeconds: 3,
    maxSeconds: 10,
    spec: "MP4 · MOV · WebM — max 50 MB, 3–10 s",
    hint: "Short clips edit best. Anything longer is trimmed by the model.",
  },
  audio: {
    label: "Audio",
    accept: "audio/mpeg,audio/wav,audio/mp4",
    extensions: ["MP3", "WAV", "M4A"],
    maxBytes: 20 * 1024 * 1024,
    maxLabel: "20 MB",
    maxSeconds: 60,
    spec: "MP3 · WAV · M4A — max 20 MB, up to 60 s",
    hint: "Clean speech with no background music gives the best lip sync.",
  },
};

export function getUploadSpec(kind) {
  return UPLOAD_SPECS[kind] || UPLOAD_SPECS.image;
}

/**
 * Validates a File against its spec. Returns null when fine, or a plain
 * sentence the UI can show verbatim.
 */
export function validateUpload(file, kind) {
  const spec = getUploadSpec(kind);
  if (!file) return "No file selected.";

  const typeOk = spec.accept.split(",").includes(file.type);
  if (!typeOk) {
    return `That file type isn't supported. Use ${spec.extensions.join(", ")}.`;
  }
  if (file.size > spec.maxBytes) {
    const mb = (file.size / 1048576).toFixed(1);
    return `That file is ${mb} MB — the limit is ${spec.maxLabel}.`;
  }
  return null;
}

// What a given camera move wants as its start frame, so the guidance in the
// upload panel changes with the selected effect.
export const EFFECT_UPLOAD_GUIDANCE = {
  "dolly-in": "Pick a frame with a clear subject in the middle — the camera drives toward it.",
  "pull-back": "Works best on a frame with detail around the edges to reveal.",
  "crash-zoom": "Strong single subject. Faces and signs land hardest.",
  "pan-right": "Use a wide frame with content across its whole width.",
  "pan-left": "Use a wide frame with content across its whole width.",
  "whip-pan": "High-contrast scenes sell the speed. Avoid busy detail.",
  "crane-up": "Include foreground at the bottom so the rise has somewhere to climb from.",
  "crane-down": "Include sky or ceiling at the top for the descent to start in.",
  "arc-right": "Best on a frame with a clear central subject to travel around.",
  "orbit-360": "A centred subject with space on both sides orbits cleanly.",
  "bullet-time": "A frozen action moment — mid-jump, splash, or impact.",
  "aerial-pullback": "Landscapes and skylines lift away beautifully.",
  "fpv-drone": "Corridors, streets and canyons give the flight something to weave through.",
  "rise-and-reveal": "Start low and tight; leave something worth revealing above.",
};

export function guidanceForEffect(presetId) {
  return (
    EFFECT_UPLOAD_GUIDANCE[presetId] ||
    "Any sharp 16:9 frame works. The camera move is applied to what you upload."
  );
}
