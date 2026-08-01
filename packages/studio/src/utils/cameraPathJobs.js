// Durable state for a Camera Path render.
//
// A chained render is several paid API calls in a row. Losing clip 3 of 4 to a
// dropped connection must not throw away clips 1-2, so every finished clip is
// written to localStorage the moment it lands. A reload, a crash, or a failed
// clip can all resume from the last completed clip.

import { scopedPersistKey } from "../persistKey.js";

const BASE_KEY = "camera_path_job_v1";

export const SEGMENT_STATUS = {
    pending: "pending",
    running: "running",
    done: "done",
    failed: "failed",
};

function storageKey(apiKey) {
    return scopedPersistKey(BASE_KEY, apiKey);
}

export function loadJob(apiKey) {
    try {
        const raw = localStorage.getItem(storageKey(apiKey));
        if (!raw) return null;
        const job = JSON.parse(raw);
        if (!job || !Array.isArray(job.segments)) return null;
        return job;
    } catch {
        return null;
    }
}

export function saveJob(apiKey, job) {
    try {
        localStorage.setItem(storageKey(apiKey), JSON.stringify(job));
    } catch (error) {
        console.warn("Camera path job could not be persisted:", error?.message);
    }
}

export function clearJob(apiKey) {
    try {
        localStorage.removeItem(storageKey(apiKey));
    } catch {
        // Nothing to clean up if storage is unavailable.
    }
}

export function createJob({ imageUrl, model, targetSeconds, segmentPlan, points, endMove, scene }) {
    return {
        id: `cp_${Date.now()}`,
        createdAt: Date.now(),
        imageUrl,
        model,
        targetSeconds,
        endMove,
        scene,
        points,
        direction: null,
        segments: segmentPlan.map((segment) => ({
            index: segment.index,
            kind: segment.kind,
            seconds: segment.seconds,
            status: SEGMENT_STATUS.pending,
            requestId: null,
            url: null,
            prompt: null,
            error: null,
        })),
    };
}

// A resumable job has at least one finished clip and at least one that is not.
export function isResumable(job) {
    if (!job) return false;
    const hasDone = job.segments.some((segment) => segment.status === SEGMENT_STATUS.done);
    const hasUnfinished = job.segments.some((segment) => segment.status !== SEGMENT_STATUS.done);
    return hasDone && hasUnfinished;
}

export function isComplete(job) {
    return Boolean(job) && job.segments.every((segment) => segment.status === SEGMENT_STATUS.done);
}

export function completedSegments(job) {
    if (!job) return [];
    return job.segments.filter((segment) => segment.status === SEGMENT_STATUS.done && segment.url);
}

export function completedSeconds(job) {
    return completedSegments(job).reduce((sum, segment) => sum + segment.seconds, 0);
}

// Index of the first clip still to render, or -1 when the job is finished.
export function nextSegmentIndex(job) {
    if (!job) return -1;
    const next = job.segments.find((segment) => segment.status !== SEGMENT_STATUS.done);
    return next ? next.index : -1;
}

/**
 * The request_id an extend call must continue from: the last clip that
 * finished before `index`. Without it a chained clip cannot be resumed and the
 * caller must restart the job.
 */
export function previousRequestId(job, index) {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
        const segment = job.segments[cursor];
        if (segment.status === SEGMENT_STATUS.done && segment.requestId) {
            return segment.requestId;
        }
    }
    return null;
}

export function updateSegment(job, index, patch) {
    return {
        ...job,
        segments: job.segments.map((segment) =>
            segment.index === index ? { ...segment, ...patch } : segment,
        ),
    };
}
