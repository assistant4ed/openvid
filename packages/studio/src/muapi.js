import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getRecastModelById, getLipSyncModelById, getAudioModelById } from './models.js';
import { notifyInfo } from './utils/notify.js';
import { keyForVideoModel } from './utils/superbKeys.js';

// In an http(s) browser we route through the host app's proxy (Next.js routes
// under /api/* re-issue the call server-side) so api.muapi.ai CORS is bypassed.
// SSR (no window) and Electron's file:// renderer call the upstream directly.
const BASE_URL = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
    ? '/api'
    : 'https://api.muapi.ai';
const PROXY_WF_BASE = '/api/workflow';

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('muapi:auth-required', { detail: { status, message: detail } }));
}

async function pollForResult(requestId, key, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${BASE_URL}/api/v1/predictions/${requestId}/result`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': key }
            });
            if (!response.ok) {
                const errText = await response.text();
                if (response.status >= 500) continue;
                notifyAuthRequired(response.status, errText);
                throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 100)}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Generation failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Generation timed out after polling.');
}

async function submitAndPoll(endpoint, payload, key, onRequestId, maxAttempts = 60) {
    const url = `${BASE_URL}/api/v1/${endpoint}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const requestId = submitData.request_id || submitData.id;
    if (!requestId) return submitData;
    if (onRequestId) onRequestId(requestId);
    const result = await pollForResult(requestId, key, maxAttempts);
    const outputUrl = result.outputs?.[0] || result.url || result.output?.url;
    return { ...result, url: outputUrl };
}

// Local mode: no cloud render key → images generate on the user's SuperbAPI
// session via the app's own /api/superb-image route. Returns the same shape
// the studios expect from the cloud path ({url}).
// Upstream image decoders enforce a pixel budget, and phone photos blow past
// it. Downscale every reference to <=1536px JPEG before it leaves the browser.
const REF_MAX_EDGE = 1536;

async function normalizeReference(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('decode'));
            el.src = dataUrl;
        });
        const scale = Math.min(1, REF_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && dataUrl.length < 2_000_000) return dataUrl;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
        return dataUrl; // let the server report a decode problem honestly
    }
}

// The Prompt Agent: expands terse user input into a full production prompt
// (and states the inferred intent). Fails open — generation never blocks on it.
async function enhancePrompt(superbKey, rawPrompt, mode, visionImages) {
    const prompt = String(rawPrompt || '').trim();
    // visionImages: [{role: 'start'|'end'|'ref', data: dataURL}] — any image
    // forces the agent even for long prompts; the vision pass is what carries
    // the pictures into the text-only video upstream.
    const images = (visionImages || []).filter((entry) => entry?.data);
    if (!prompt || (prompt.length > 350 && images.length === 0)) return { prompt, intent: null };
    try {
        const response = await fetch('/api/prompt-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superb-key': superbKey },
            body: JSON.stringify({ prompt, mode, images: images.length > 0 ? images : undefined }),
            signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) return { prompt, intent: null, visionUsed: false };
        const data = await response.json();
        return {
            prompt: data.expandedPrompt || prompt,
            intent: data.intent || null,
            visionUsed: data.visionUsed === true,
        };
    } catch {
        return { prompt, intent: null, visionUsed: false };
    }
}

// Railway kills in-flight requests during a deploy roll; the browser reports
// that as a bare "Failed to fetch". Retry once after a short wait, and if it
// still fails, say what actually happened instead of leaking fetch jargon.
async function fetchWithRollRetry(url, options) {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (!/failed to fetch|load failed|network/i.test(String(error?.message))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 4000));
        try {
            return await fetch(url, options);
        } catch {
            throw new Error('The studio is redeploying or your connection dropped — try again in a few seconds.');
        }
    }
}

async function generateImageViaSuperb(params) {
    const superbKey =
        typeof window !== 'undefined' ? window.localStorage?.getItem('superbapi_key') : null;
    if (!superbKey) {
        throw new Error('Sign in with your SuperbAPI key to generate.');
    }

    const references = [];
    const candidates = [
        ...(Array.isArray(params.images_list) ? params.images_list : []),
        ...(params.image_url ? [params.image_url] : []),
    ];
    for (const url of candidates) {
        const normalized = await normalizeReference(url);
        if (normalized) references.push(normalized);
    }

    const enhanced = await enhancePrompt(
        superbKey,
        params.prompt,
        references.length > 0 ? 'i2i' : 't2i',
    );

    const response = await fetchWithRollRetry('/api/superb-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': superbKey },
        body: JSON.stringify({ prompt: enhanced.prompt, images: references }),
    });

    if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.error || `Image generation failed (${response.status})`);
    }

    const data = await response.json();
    return {
        url: data.images[0],
        outputs: data.images,
        status: 'completed',
        enhancedPrompt: enhanced.prompt,
        intent: enhanced.intent,
    };
}

export async function generateImage(apiKey, params) {
    if (!apiKey) return generateImageViaSuperb(params);
    const modelInfo = getModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = { prompt: params.prompt };
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.image_url) { 
        payload.image_url = params.image_url; 
        payload.strength = params.strength || 0.6; 
    } else if (params.images_list) {
        payload.images_list = params.images_list;
    } else {
        payload.image_url = null;
    }
    if (params.seed && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 60);
}

export async function generateI2I(apiKey, params) {
    if (!apiKey) return generateImageViaSuperb(params);
    const modelInfo = getI2IModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    const imagesList = params.images_list?.length > 0 ? params.images_list : (params.image_url ? [params.image_url] : null);
    if (imagesList) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        else payload[imageField] = imagesList[0];
    }
    if (modelInfo?.swapField && params.swap_url) {
        payload[modelInfo.swapField] = params.swap_url;
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 60);
}


// Local mode video: the gateway uses a submit/poll pair on /v1/videos, proxied
// by the app's own /api/superb-video route so the key stays server-side.
const SUPERB_VIDEO_POLL_MS = 6000;
const SUPERB_VIDEO_MAX_POLLS = 150; // ~15 min ceiling


// A locally uploaded frame is a data URL the gateway cannot fetch — park it on
// the app's asset host and hand the gateway a real URL instead. This is what
// makes "upload a picture, get a video of it" actually use the picture.
async function hostedFrameUrl(source) {
    if (typeof source !== 'string' || !source) return undefined;
    if (source.startsWith('http')) return source;
    if (!source.startsWith('data:image/')) return undefined;
    try {
        const response = await fetch('/api/asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: source }),
        });
        if (!response.ok) return undefined;
        return (await response.json()).url;
    } catch {
        return undefined;
    }
}

// The verified capabilities the shell probed for this key — the source of
// truth for what duration shapes each video model accepts.
function capsVideoEntry(modelId) {
    if (typeof window === 'undefined' || !modelId) return null;
    try {
        const caps = JSON.parse(window.localStorage.getItem('superb_caps_v1') || 'null');
        return caps?.video?.find((entry) => entry.id === modelId) || null;
    } catch {
        return null;
    }
}

// Fixed-length models (Veo 8s, Grok 6s, PixVerse) REJECT a duration param —
// omit it and let the upstream render its native length. Selectable models
// get the nearest allowed value; unknown models keep the legacy Kling clamp.
function durationForModel(modelId, requested) {
    const entry = capsVideoEntry(modelId);
    if (entry?.fixed) return undefined;
    const wanted = Number(requested) || 5;
    if (Array.isArray(entry?.durations) && entry.durations.length > 0) {
        return entry.durations.reduce((best, value) =>
            Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best,
        );
    }
    return wanted > 7 ? 10 : 5;
}

async function generateVideoViaSuperb(params) {
    // Every studio's video path rides the server-side job pipeline now — the
    // spec is safe in the database before this promise resolves, so reloads
    // and dropped connections can no longer kill a render. The legacy
    // onTaskId/onRequestId callbacks receive the JOB id; pollSuperbVideoTask
    // recognizes job_ ids, so persisted resumes keep working everywhere.
    return submitVideoJob({
        ...params,
        onJobId: (jobId) => {
            if (params.onJobId) params.onJobId(jobId);
            if (params.onRequestId) params.onRequestId(jobId);
            if (params.onTaskId) params.onTaskId(jobId);
        },
    });
}

// ── Server-side render jobs ─────────────────────────────────────────────────
// The browser only captures the SPEC: frames are hosted, then POST /api/jobs
// hands everything to the server (vision grounding, submit, polling, result
// storage all run there). Closing the tab a second after clicking Generate
// no longer loses the render.

export async function submitVideoJob(params) {
    const superbKey =
        typeof window !== 'undefined' ? keyForVideoModel(params.videoModel) : null;
    if (!superbKey) throw new Error('Sign in with your SuperbAPI key to generate.');

    const [startUrl, endUrl, ...refUrls] = await Promise.all([
        hostedFrameUrl(params.image_url || params.images_list?.[0]),
        hostedFrameUrl(params.end_image),
        ...(Array.isArray(params.style_refs) ? params.style_refs : []).map(hostedFrameUrl),
    ]);

    const submit = await fetchWithRollRetry('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': superbKey },
        body: JSON.stringify({
            prompt: params.prompt || 'bring this scene to life with natural motion',
            model: params.videoModel || undefined,
            duration: durationForModel(params.videoModel, params.duration),
            aspect_ratio: params.aspect_ratio,
            // Seedance 2.0 renders 720p only and rejects a submit without it.
            resolution: capsVideoEntry(params.videoModel)?.resolution,
            image_url: startUrl,
            end_image_url: endUrl,
            ref_urls: refUrls.filter(Boolean),
        }),
    });
    if (!submit.ok) {
        const detail = await submit.json().catch(() => ({}));
        throw new Error(detail?.error || `Job submit failed (${submit.status})`);
    }
    const { jobId } = await submit.json();
    if (params.onJobId) params.onJobId(jobId);
    return pollRenderJob(jobId, superbKey);
}

// Image generation through the same pipeline: refs are hosted, the server
// grounds (t2i/i2i), renders via the gateway image route, and parks the
// result on the durable asset host. Returns { url } like the video path.
export async function submitImageJob(params) {
    const superbKey =
        typeof window !== 'undefined' ? window.localStorage.getItem('superbapi_key') : null;
    if (!superbKey) throw new Error('Sign in with your SuperbAPI key to generate.');

    const refs = [params.image_url, ...(Array.isArray(params.images_list) ? params.images_list : [])]
        .filter(Boolean);
    const hosted = (await Promise.all(refs.map(hostedFrameUrl))).filter(Boolean);

    const submit = await fetchWithRollRetry('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-superb-key': superbKey },
        body: JSON.stringify({
            kind: 'image',
            prompt: params.prompt,
            ref_urls: hosted,
        }),
    });
    if (!submit.ok) {
        const detail = await submit.json().catch(() => ({}));
        throw new Error(detail?.error || `Job submit failed (${submit.status})`);
    }
    const { jobId } = await submit.json();
    if (params.onJobId) params.onJobId(jobId);
    return pollRenderJob(jobId, superbKey);
}

// Retry a failed job — the server clones the stored spec, frames included.
export async function retryRenderJob(jobId) {
    const superbKey =
        typeof window !== 'undefined' ? window.localStorage.getItem('superbapi_key') : null;
    if (!superbKey) throw new Error('Sign in with your SuperbAPI key first.');
    const response = await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { 'x-superb-key': superbKey },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Retry failed (${response.status})`);
    return data.jobId;
}

const JOB_POLL_MS = 8000;
const JOB_POLL_MAX = 160; // ~21 min ceiling

export async function pollRenderJob(jobId, superbKeyMaybe) {
    const superbKey = superbKeyMaybe ||
        (typeof window !== 'undefined' ? window.localStorage.getItem('superbapi_key') : null);
    if (!superbKey) throw new Error('Sign in with your SuperbAPI key first.');
    for (let attempt = 0; attempt < JOB_POLL_MAX; attempt += 1) {
        let job = null;
        try {
            const response = await fetch(`/api/jobs/${jobId}`, {
                headers: { 'x-superb-key': superbKey },
            });
            if (response.status === 404) throw new Error('Job not found');
            if (response.ok) job = await response.json();
        } catch (error) {
            if (error?.message === 'Job not found') throw error;
            // transient — keep polling
        }
        if (job?.status === 'done' && job.videoUrl) {
            if (job.visionUsed === false && job.spec?.hasStart) {
                notifyInfo(
                    'The vision model could not read your image(s) for this render — the result may not match them.',
                );
            }
            return { url: job.videoUrl, visionUsed: job.visionUsed };
        }
        if (job?.status === 'failed') throw new Error(job.error || 'Render failed');
        await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    }
    throw new Error('Render timed out — check the task board later.');
}

/**
 * Reconnect to a render that is already running upstream. The upstream keeps
 * working regardless of the user's connection — a reload or a dropped network
 * only loses the POLLING, so any stored taskId can resume here at any time.
 */
export async function pollSuperbVideoTask(taskId, superbKeyMaybe) {
    // Job-pipeline ids are resumable through the jobs API — old persisted
    // upstream task ids keep the direct polling below.
    if (typeof taskId === 'string' && taskId.startsWith('job_')) {
        return pollRenderJob(taskId, superbKeyMaybe);
    }
    const superbKey =
        superbKeyMaybe ||
        (typeof window !== 'undefined' ? window.localStorage?.getItem('superbapi_key') : null);
    if (!taskId || !superbKey) throw new Error('Nothing to resume.');

    for (let attempt = 0; attempt < SUPERB_VIDEO_MAX_POLLS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, SUPERB_VIDEO_POLL_MS));
        let poll;
        try {
            poll = await fetch(`/api/superb-video?taskId=${encodeURIComponent(taskId)}`, {
                headers: { 'x-superb-key': superbKey },
            });
        } catch {
            continue; // offline — the render keeps going; keep trying
        }
        if (!poll.ok) continue; // transient — keep polling
        const data = await poll.json();
        const status = String(data.status || '').toLowerCase();
        if (['completed', 'succeeded', 'success'].includes(status) && data.videoUrl) {
            return { url: data.videoUrl, outputs: [data.videoUrl], status: 'completed', request_id: taskId };
        }
        if (['failed', 'error'].includes(status)) {
            throw new Error(data.error || 'Video generation failed upstream.');
        }
    }
    throw new Error('Video generation timed out.');
}

export async function generateVideo(apiKey, params) {
    if (!apiKey) return generateVideoViaSuperb(params);
    const modelInfo = getVideoModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    if (params.request_id) payload.request_id = params.request_id;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.images_list?.length > 0) payload.images_list = params.images_list;
    if (params.videos_list?.length > 0) payload.videos_list = params.videos_list;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateI2V(apiKey, params) {
    if (!apiKey) return generateVideoViaSuperb(params);
    const modelInfo = getI2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    if (params.images_list && params.images_list.length > 0) {
        if (imageField === 'images_list') payload.images_list = params.images_list;
        else payload[imageField] = params.images_list[0];
    } else if (params.image_url) {
        if (imageField === 'images_list') payload.images_list = [params.image_url];
        else payload[imageField] = params.image_url;
    }
    const lastImageField = modelInfo?.lastImageField;
    if (lastImageField && params.last_image) {
        if (lastImageField === 'images_list') {
            if (!payload.images_list) payload.images_list = [];
            if (payload.images_list.indexOf(params.last_image) === -1) {
                payload.images_list.push(params.last_image);
            }
        } else {
            payload[lastImageField] = params.last_image;
        }
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateMarketingStudioAd(apiKey, params) {
    const endpoint = params.resolution === '1080p' ? 'sd-2-vip-omni-reference-1080p' : 'seedance-2-vip-omni-reference';
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: params.duration || 5,
        images_list: params.images_list || [],
        video_files: params.video_files || []
    };
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function processV2V(apiKey, params) {
    const modelInfo = getV2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const videoField = modelInfo?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (modelInfo?.imageField && params.image_url) {
        payload[modelInfo.imageField] = params.image_url;
    }
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function processRecast(apiKey, params) {
    const modelInfo = getRecastModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const videoField = modelInfo?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (modelInfo?.imageField && params.image_url) {
        payload[modelInfo.imageField] = params.image_url;
    }
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    if (params.aspect_ratio) {
        payload.aspect_ratio = params.aspect_ratio;
    }
    if (params.character_orientation) {
        payload.character_orientation = params.character_orientation;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function processLipSync(apiKey, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (modelInfo?.hasPrompt) payload.prompt = params.prompt || '';
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

export async function generateAudio(apiKey, params) {
    const modelId = params._modelId || params.model;
    const modelInfo = getAudioModelById(modelId);
    const endpoint = modelInfo?.endpoint || modelId;
    const payload = {};
    const skipKeys = ['_modelId', 'onRequestId'];
    for (const key in params) {
        if (!skipKeys.includes(key) && params[key] !== undefined && params[key] !== null) {
            payload[key] = params[key];
        }
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId, 900);
}

// Without a cloud render key there is no upload endpoint — reference files are
// kept local as data URLs instead. Instant, private, and works directly as
// multimodal input. Images only: a video that size as base64 would wreck
// browser storage and no current backend accepts it anyway.
const LOCAL_REF_MAX_BYTES = 8 * 1024 * 1024;

function fileToDataUrl(file, onProgress) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('Video and audio references need a cloud render backend — not available yet.'));
            return;
        }
        if (file.size > LOCAL_REF_MAX_BYTES) {
            reject(new Error('Reference images are limited to 8MB for local mode.'));
            return;
        }
        const reader = new FileReader();
        reader.onprogress = (event) => {
            if (onProgress && event.lengthComputable) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        };
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
    });
}

export function uploadFile(apiKey, file, onProgress) {
    // No render key → local mode. This is the normal path now that the studio
    // runs on a SuperbAPI session alone.
    if (!apiKey) {
        return fileToDataUrl(file, onProgress);
    }
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}/api/v1/upload_file`;
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('x-api-key', apiKey);

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const fileUrl = data.url || data.file_url || data.data?.url;
                    if (!fileUrl) {
                        reject(new Error('No URL returned from file upload'));
                    } else {
                        resolve(fileUrl);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse upload response'));
                }
            } else {
                let detail = xhr.statusText;
                try {
                    const errObj = JSON.parse(xhr.responseText);
                    detail = errObj.detail || detail;
                } catch (e) {
                    // fallback to statusText
                }
                notifyAuthRequired(xhr.status, detail);
                reject(new Error(`File upload failed: ${xhr.status} - ${detail}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.send(formData);
    });
}

export async function getUserBalance(apiKey) {
    const response = await fetch(`${BASE_URL}/api/v1/account/balance`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        throw new Error(`Failed to fetch balance: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getTemplateWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-template-workflows`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch template workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getUserWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-workflow-defs`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch user workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getPublishedWorkflows(apiKey) {
    const response = await fetch(`${BASE_URL}/workflow/get-published-workflows`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch published workflows: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

// Agents — uses direct URL → https://api.muapi.ai/agents/...
export async function getTemplateAgents(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/templates/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch template agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

export async function getUserAgents(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/user/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch user agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

export async function getPublishedAgents(apiKey) {
    // MuAPI: GET /agents/featured/agents
    const response = await fetch(`${BASE_URL}/agents/featured/agents`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch featured agents: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
};

// GET /agents/user/conversations — returns the user's chat history across all agents
export async function getUserConversations(apiKey) {
    const response = await fetch(`${BASE_URL}/agents/user/conversations`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch conversations: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
};

// GET /agents/by-slug/{slug} — public agent details (works unauthenticated for
// published/template agents; x-api-key is sent for consistency but not required).
export async function getAgentBySlug(apiKey, slug) {
    const response = await fetch(`${BASE_URL}/agents/by-slug/${slug}`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch agent: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

// GET /agents/by-slug/{slug}/{conversationId} — chat history for one conversation.
export async function getAgentConversation(apiKey, agentSlug, conversationId) {
    const response = await fetch(`${BASE_URL}/agents/by-slug/${agentSlug}/${conversationId}`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch conversation: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

// POST /agents/by-slug/{slug}/chat — send a message, returns {request_id, status}
// to poll via pollAgentChatResult.
export async function sendAgentChatMessage(apiKey, agentSlug, { message, conversationId, attachments } = {}) {
    const response = await fetch(`${BASE_URL}/agents/by-slug/${agentSlug}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({
            message,
            conversation_id: conversationId || null,
            attachments: attachments || null,
            stream: false
        })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to send message: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

// Polls /api/v1/predictions/{requestId}/result until the agent turn completes.
// Unlike submitAndPoll's generic media polling, a completed agent-chat result is
// the full {conversation_id, messages, is_complete, suggestions} envelope, not a
// media URL — while processing, the endpoint doesn't surface intermediate status
// text (get_result_url_from_output only returns output_data once COMPLETED), so
// this just waits until is_complete rather than showing incremental progress.
export async function pollAgentChatResult(apiKey, requestId, { maxAttempts = 150, interval = 2000 } = {}) {
    const url = `${BASE_URL}/api/v1/predictions/${requestId}/result`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            }
        });
        if (response.status === 400) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody?.detail?.error || 'Agent failed to respond');
        }
        if (!response.ok) {
            if (attempt === maxAttempts) throw new Error(`Poll failed: ${response.status}`);
            continue;
        }
        const data = await response.json();
        if (data.is_complete) return data;
    }
    throw new Error('Agent response timed out.');
}

// POST /agents — create a new persona agent (no skill picker in this minimal
// embedded form; skill_ids defaults to [] server-side, so the agent is created
// as a plain system-prompt-driven assistant with no extra tool skills attached).
export async function createAgent(apiKey, payload) {
    const response = await fetch(`${BASE_URL}/agents`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to create agent: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function createWorkflow(apiKey, payload) {
    const response = await fetch(`${BASE_URL}/workflow/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to create workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function updateWorkflowName(apiKey, workflowId, name) {
    const response = await fetch(`${BASE_URL}/workflow/update-name/${workflowId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ name })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to rename workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function deleteWorkflow(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/delete-workflow-def/${workflowId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to delete workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getWorkflowInputs(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-inputs`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch workflow inputs: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function executeWorkflow(apiKey, workflowId, inputs) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ inputs })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to execute workflow: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const runId = submitData.run_id || submitData.id;
    if (!runId) return submitData;
    
    // Poll for results
    return await pollWorkflowResult(runId, apiKey);
};

async function pollWorkflowResult(runId, apiKey, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${BASE_URL}/workflow/run/${runId}/api-outputs`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }
            });
            if (!response.ok) {
                if (response.status >= 500) continue;
                throw new Error(`Poll Failed: ${response.status}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Workflow failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Workflow timed out after polling.');
};

export async function getAllNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/node-schemas`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch node schemas: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getWorkflowData(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/get-workflow-def/${workflowId}`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch workflow data: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
};

export async function getNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/api-node-schemas`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch node schemas: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function runSingleNode(apiKey, workflowId, nodeId, payload) {
    const response = await fetch(`${BASE_URL}/workflow/${workflowId}/node/${nodeId}/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to run single node: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function deleteNodeRun(apiKey, nodeRunId) {
    const response = await fetch(`${BASE_URL}/workflow/node-run/${nodeRunId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to delete node run: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getNodeStatus(apiKey, runId) {
    const response = await fetch(`${BASE_URL}/workflow/run/${runId}/status`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to get node status: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

/**
 * Handle proxy requests centralizing communication logic with MuAPI.
 * This is used by the server-side entry points.
 */
export async function handleProxyRequest(prefix, path, method, headers, body, apiKey) {
    const url = `${BASE_URL}/${prefix}/${path}`;
    
    const finalHeaders = new Headers(headers);
    finalHeaders.delete('host');
    finalHeaders.delete('connection');
    finalHeaders.delete('content-length'); // Let fetch recalculate this for safety

    if (apiKey) {
        finalHeaders.set('x-api-key', apiKey);
    }

    try {
        const response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
            redirect: 'follow',
        });

        const contentType = response.headers.get('Content-Type') || 'application/json';
        const buffer = await response.arrayBuffer();
        
        return {
            status: response.status,
            contentType,
            data: buffer
        };
    } catch (error) {
        console.error(`MuAPI Proxy error for ${url}:`, error);
        throw error;
    }
}

/**
 * A centralized handler for Next.js API routes or middleware.
 */
export async function handleServerSideProxy(prefix, request, params, apiKey) {
    try {
        const slug = await params;
        const pathSegments = slug.path || [];
        const path = pathSegments.join('/');
        
        const method = request.method;
        let body = null;
        if (method !== 'GET' && method !== 'HEAD') {
            body = await request.arrayBuffer();
        }

        const { search } = new URL(request.url);
        const pathWithSearch = search ? `${path}${search}` : path;

        return await handleProxyRequest(
            prefix, 
            pathWithSearch, 
            method, 
            request.headers, 
            body, 
            apiKey
        );
    } catch (error) {
        console.error(`Server proxy failed:`, error);
        throw error;
    }
}

export async function calculateDynamicCost(apiKey, taskName, payload) {
    const response = await fetch(`${BASE_URL}/api/v1/app/calculate_dynamic_cost`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ task_name: taskName, payload })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to calculate dynamic cost: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function registerAppInterest(apiKey, appName) {
    const response = await fetch(`${BASE_URL}/app/interest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({ app_name: appName })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to register interest: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getAppInterests(apiKey) {
    const response = await fetch(`${BASE_URL}/app/interests`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch interests: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

// Paginated past-generations list, scoped server-side to the calling identity
// (BYOK key or white-label session token) — see GET /api/v1/history.
export async function getHistory(apiKey, { cursor, limit = 50 } = {}) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const response = await fetch(`${BASE_URL}/api/v1/history?${params.toString()}`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch history: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function runClipping(apiKey, params) {
    const payload = {
        video_url: params.video_url,
        num_highlights: params.num_highlights || 3,
        aspect_ratio: params.aspect_ratio || "9:16",
        return_coordinates_only: !!params.return_coordinates_only
    };
    return submitAndPoll("ai-clipping", payload, apiKey, params.onRequestId, 900);
}

export async function runMotionGraphics(apiKey, params) {
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics", payload, apiKey, params.onRequestId, 900);
}

export async function runMotionGraphicsEdit(apiKey, params) {
    const payload = {
        request_id: params.request_id,
        edit_prompt: params.edit_prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics-edit", payload, apiKey, params.onRequestId, 900);
}
