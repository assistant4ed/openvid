import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzePath,
    buildFallbackDirection,
} from '../packages/studio/src/utils/cameraPath.js';

function linePoints(from, to, steps, startTime = 0, stepMs = 20) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        points.push({
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
            t: startTime + i * stepMs,
        });
    }
    return points;
}

test('analyzePath returns null for a stroke too short to be a move', () => {
    assert.equal(analyzePath([{ x: 0.5, y: 0.5, t: 0 }]), null);
});

test('analyzePath maps a left-to-right stroke to a rightward track', () => {
    const analysis = analyzePath(linePoints({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 30));
    assert.ok(analysis);
    assert.equal(analysis.segments.length, 1);
    assert.equal(analysis.segments[0].direction, 'track right');
    assert.equal(analysis.startRegion, 'left of frame');
    assert.equal(analysis.endRegion, 'right of frame');
    assert.equal(analysis.curveShape, 'straight line');
});

test('analyzePath maps an upward diagonal to a crane-up combination', () => {
    const analysis = analyzePath(linePoints({ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.15 }, 30));
    assert.ok(analysis);
    assert.equal(analysis.segments[0].direction, 'track right while craning up');
    assert.equal(analysis.startRegion, 'lower left');
    assert.equal(analysis.endRegion, 'upper right');
});

test('analyzePath splits an L-shaped stroke into two segments', () => {
    const points = [
        ...linePoints({ x: 0.1, y: 0.8 }, { x: 0.7, y: 0.8 }, 20, 0),
        ...linePoints({ x: 0.7, y: 0.8 }, { x: 0.7, y: 0.2 }, 20, 420),
    ];
    const analysis = analyzePath(points);
    assert.ok(analysis);
    assert.equal(analysis.segments.length, 2);
    assert.equal(analysis.segments[0].direction, 'track right');
    assert.equal(analysis.segments[1].direction, 'crane up');
});

test('buildFallbackDirection mentions regions, moves, and the finishing move', () => {
    const analysis = analyzePath(linePoints({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 30));
    const text = buildFallbackDirection(analysis, 'push-in');
    assert.match(text, /track right/);
    assert.match(text, /left of frame/);
    assert.match(text, /push in/);
    assert.match(text, /no cuts/i);
});

test('buildFallbackDirection defaults to easing out without an end move', () => {
    const analysis = analyzePath(linePoints({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 30));
    const text = buildFallbackDirection(analysis, 'none');
    assert.match(text, /easing to a stop/);
});
