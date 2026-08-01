import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CAMERA_PATH_MODELS,
    MAX_CHAINED_CLIPS,
    availableTotals,
    getCameraPathModel,
    planSegments,
    totalPlannedSeconds,
} from '../packages/studio/src/utils/cameraPathModels.js';
import {
    CAMERA_PATH_PRESETS,
    getPreset,
} from '../packages/studio/src/utils/cameraPathPresets.js';
import { analyzePath } from '../packages/studio/src/utils/cameraPath.js';
import {
    SEGMENT_STATUS,
    createJob,
    isComplete,
    isResumable,
    nextSegmentIndex,
    previousRequestId,
    updateSegment,
} from '../packages/studio/src/utils/cameraPathJobs.js';

const SEEDANCE = 'seedance-2-i2v';

test('Seedance 2.0 is present and is chainable', () => {
    const model = getCameraPathModel(SEEDANCE);
    assert.ok(model, 'seedance-2-i2v should be in the catalog');
    assert.equal(model.canChain, true);
    assert.equal(model.maxClipSeconds, 15);
});

test('every catalogued model resolves against models.js', () => {
    assert.ok(CAMERA_PATH_MODELS.length >= 8);
    for (const model of CAMERA_PATH_MODELS) {
        assert.ok(model.durations.length > 0, `${model.id} has no durations`);
        assert.ok(model.maxClipSeconds > 0, `${model.id} has no max clip length`);
    }
});

test('non-chainable models are capped at their single-clip maximum', () => {
    const single = CAMERA_PATH_MODELS.find((model) => !model.canChain);
    assert.ok(single);
    const totals = availableTotals(single.id);
    assert.equal(Math.max(...totals), single.maxClipSeconds);
    assert.equal(planSegments(single.id, 60).length, 1);
});

test('a long target chains multiple clips that sum to the target', () => {
    const plan = planSegments(SEEDANCE, 45);
    assert.ok(plan.length > 1, 'should chain');
    assert.equal(totalPlannedSeconds(plan), 45);
    assert.equal(plan[0].kind, 'base');
    assert.ok(plan.slice(1).every((segment) => segment.kind === 'extend'));
});

test('chaining never exceeds the clip ceiling', () => {
    const plan = planSegments(SEEDANCE, 10_000);
    assert.equal(plan.length, MAX_CHAINED_CLIPS);
});

test('advertised durations are all actually reachable by a plan', () => {
    for (const total of availableTotals(SEEDANCE)) {
        assert.equal(
            totalPlannedSeconds(planSegments(SEEDANCE, total)),
            total,
            `plan for ${total}s should sum exactly`,
        );
    }
});

test('presets produce paths that analyze into real camera moves', () => {
    for (const preset of CAMERA_PATH_PRESETS) {
        const analysis = analyzePath(preset.build());
        assert.ok(analysis, `${preset.id} produced an unusable path`);
        assert.ok(analysis.segments.length > 0, `${preset.id} produced no segments`);
    }
});

test('the dolly-in preset reads as an upward push toward centre', () => {
    const preset = getPreset('dolly-in');
    const analysis = analyzePath(preset.build());
    assert.equal(preset.endMove, 'push-in');
    assert.equal(analysis.endRegion, 'center of frame');
});

test('a fresh job starts at clip 0 and is not resumable', () => {
    const job = createJob({
        imageUrl: 'https://example.com/frame.jpg',
        model: SEEDANCE,
        targetSeconds: 30,
        segmentPlan: planSegments(SEEDANCE, 30),
        points: [],
        endMove: 'none',
        scene: '',
    });
    assert.equal(nextSegmentIndex(job), 0);
    assert.equal(isResumable(job), false);
    assert.equal(isComplete(job), false);
});

test('a partly rendered job resumes at the first unfinished clip', () => {
    let job = createJob({
        imageUrl: 'https://example.com/frame.jpg',
        model: SEEDANCE,
        targetSeconds: 45,
        segmentPlan: planSegments(SEEDANCE, 45),
        points: [],
        endMove: 'none',
        scene: '',
    });

    job = updateSegment(job, 0, {
        status: SEGMENT_STATUS.done,
        url: 'https://cdn/clip0.mp4',
        requestId: 'req-0',
    });
    job = updateSegment(job, 1, { status: SEGMENT_STATUS.failed, error: 'network' });

    assert.equal(isResumable(job), true);
    assert.equal(nextSegmentIndex(job), 1);
    // Clip 1 must continue from clip 0's request id, not from nothing.
    assert.equal(previousRequestId(job, 1), 'req-0');
});

test('previousRequestId skips clips that never completed', () => {
    let job = createJob({
        imageUrl: 'https://example.com/frame.jpg',
        model: SEEDANCE,
        targetSeconds: 45,
        segmentPlan: planSegments(SEEDANCE, 45),
        points: [],
        endMove: 'none',
        scene: '',
    });
    job = updateSegment(job, 0, {
        status: SEGMENT_STATUS.done,
        url: 'https://cdn/clip0.mp4',
        requestId: 'req-0',
    });
    // Clip 1 got a request id but never finished — it must not be continued from.
    job = updateSegment(job, 1, { status: SEGMENT_STATUS.failed, requestId: 'req-1' });

    assert.equal(previousRequestId(job, 2), 'req-0');
});

test('a fully rendered job is complete and no longer resumable', () => {
    let job = createJob({
        imageUrl: 'https://example.com/frame.jpg',
        model: SEEDANCE,
        targetSeconds: 30,
        segmentPlan: planSegments(SEEDANCE, 30),
        points: [],
        endMove: 'none',
        scene: '',
    });
    job.segments.forEach((segment) => {
        job = updateSegment(job, segment.index, {
            status: SEGMENT_STATUS.done,
            url: `https://cdn/clip${segment.index}.mp4`,
            requestId: `req-${segment.index}`,
        });
    });

    assert.equal(isComplete(job), true);
    assert.equal(isResumable(job), false);
    assert.equal(nextSegmentIndex(job), -1);
});
