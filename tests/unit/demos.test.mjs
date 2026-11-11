import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../../public/assets/js/lib/exercises.js';
import { DEMOS, getDemo, demoFrame, demoFit, validateDemo, keyPhases, sideAt, GROUND } from '../../public/assets/js/lib/demos.js';
import { solveLimb, solvePose, poseAt, dir, DIMS, jointPoints } from '../../public/assets/js/lib/rig.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('rig: inverse kinematics reaches the target and keeps bone lengths', () => {
  const [upper, lower] = solveLimb([84, 138], [100, 168], 30, 30, 1);
  const knee = [84 + dir(upper)[0] * 30, 138 + dir(upper)[1] * 30];
  const foot = [knee[0] + dir(lower)[0] * 30, knee[1] + dir(lower)[1] * 30];
  assert.ok(dist(foot, [100, 168]) < 0.01);
  assert.ok(knee[0] > 100, 'knee bends forwards');
  // Out of reach: the limb straightens towards the target instead of stretching.
  const [u2, l2] = solveLimb([0, 0], [0, 500], 30, 30);
  assert.ok(Math.abs(u2) < 2 && Math.abs(l2) < 2);
  const J = solvePose({ hip: [100, 109], t: 180, aR: [0, 0], aL: [0, 0], lR: { to: [100, 168] }, lL: { to: [100, 168] } });
  assert.ok(Math.abs(dist(J.hip, J.chest) - DIMS.torso) < 1e-9);
  assert.ok(J.head[1] < J.chest[1] && J.chest[1] < J.hip[1] && J.hip[1] < J.anR[1], 'standing: head above chest above hip above feet');
});

test('rig: keyframes interpolate smoothly and hold at the ends', () => {
  const a = { hip: [0, 0], t: 180, aR: [0, 0], aL: [0, 0], lR: [0, 0], lL: [0, 0] };
  const b = { ...a, hip: [10, 20], aR: [90, 90] };
  const frames = [{ at: 0, pose: a }, { at: 0.5, pose: b }, { at: 1, pose: a }];
  assert.deepEqual(poseAt(frames, 0).hip, [0, 0]);
  assert.deepEqual(poseAt(frames, 0.5).hip, [10, 20]);
  assert.deepEqual(poseAt(frames, 0.25).hip, [5, 10]);
  assert.equal(poseAt(frames, 0.25).aR[0], 45);
  assert.deepEqual(poseAt(frames, 1).hip, [0, 0]);
});

test('every catalogue exercise has its own valid demonstration', () => {
  assert.equal(EXERCISES.length, 33);
  assert.deepEqual(Object.keys(DEMOS).sort(), EXERCISES.map((e) => e.id).sort(), 'demo IDs match exercise IDs exactly');
  const signatures = new Map();
  for (const ex of EXERCISES) {
    const demo = getDemo(ex.id);
    assert.ok(demo, ex.id);
    assert.deepEqual(validateDemo(demo), [], ex.id);
    // No two exercises share a movement: compare the joints and equipment at the start and the peak.
    const sig = JSON.stringify(keyPhases(demo).concat(0.3).map((p) => {
      const f = demoFrame(demo, p);
      return [jointPoints(f.J).map((q) => q.map((v) => Math.round(v))), f.props.length, demo.view];
    }));
    assert.ok(!signatures.has(sig), `${ex.id} duplicates ${signatures.get(sig)}`);
    signatures.set(sig, ex.id);
  }
});

test('demos match how each exercise is logged and described', () => {
  for (const ex of EXERCISES) {
    const demo = getDemo(ex.id);
    if (ex.logType === 'cardio') assert.equal(demo.kind, 'loop', ex.id);
    if (ex.logType === 'reps' || ex.logType === 'load') assert.equal(demo.kind, 'reps', ex.id);
    // "Count each side" / "Time each side" in the cues means the demo shows both sides.
    const eachSide = ex.cues.some((c) => /each side/i.test(c));
    assert.equal(demo.sides !== 'none', eachSide || ex.id === 'split-squat', `${ex.id} sides`);
  }
  assert.equal(getDemo('plank').kind, 'hold');
  assert.equal(getDemo('side-plank').kind, 'hold');
  assert.equal(getDemo('farmers-carry').kind, 'loop');
  assert.equal(sideAt(getDemo('reverse-lunge'), 0.2), 0);
  assert.equal(sideAt(getDemo('reverse-lunge'), 0.7), 1);
  assert.equal(sideAt(getDemo('push-up'), 0.7), 0);
});

test('each movement is a complete loop: it starts and ends in the same position, and actually moves', () => {
  for (const [id, demo] of Object.entries(DEMOS)) {
    const start = jointPoints(demoFrame(demo, 0).J);
    const finish = jointPoints(solvePose(poseAt(demo.frames, 1), demo.view));
    const again = demo.dims ? null : finish;
    if (again) start.forEach((p, i) => assert.ok(dist(p, again[i]) < 0.01, `${id} loop closes`));
    const peak = jointPoints(demoFrame(demo, demo.peak).J);
    const moved = Math.max(...start.map((p, i) => dist(p, peak[i])));
    if (demo.kind === 'hold') {
      const setup = jointPoints(demoFrame(demo, 0, { intro: true }).J);
      assert.ok(Math.max(...start.map((p, i) => dist(p, setup[i]))) > 8, `${id} intro moves into the hold`);
      const introEnd = jointPoints(demoFrame(demo, 1, { intro: true }).J);
      start.forEach((p, i) => assert.ok(dist(p, introEnd[i]) < 0.01, `${id} intro ends in the hold`));
      assert.ok(moved < 3, `${id} hold stays still`);
    } else {
      assert.ok(moved > 8, `${id} moves (${moved.toFixed(1)})`); // a calf raise is a small movement
    }
  }
});

test('alternating demos do the mirror-image movement on the second side', () => {
  for (const [id, demo] of Object.entries(DEMOS)) {
    if (demo.sides !== 'alternate') continue;
    const first = demoFrame(demo, demo.peak).J;
    const second = demoFrame(demo, demo.peak + 0.5).J;
    for (const [a, b] of [['anR', 'anL'], ['haR', 'haL'], ['knR', 'knL']]) {
      assert.ok(dist(first[a], second[b]) < 5 && dist(first[b], second[a]) < 5, `${id}: ${a} and ${b} swap`);
    }
  }
});

test('the whole figure and its equipment stay inside the stage for every exercise, all the way through', () => {
  for (const [id, demo] of Object.entries(DEMOS)) {
    const fit = demoFit(demo);
    assert.ok(fit.radius > 30 && fit.radius < 130, `${id} radius ${fit.radius}`);
    for (let i = 0; i <= 60; i += 1) {
      for (const intro of demo.intro ? [false, true] : [false]) {
        const { J } = demoFrame(demo, i / 60, { intro });
        for (const p of jointPoints(J)) {
          assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${id} finite`);
          assert.ok(dist(p, [fit.cx, fit.cy]) <= fit.radius - 5, `${id} joint outside the stage at ${i / 60}`);
          assert.ok(p[1] <= GROUND + 1, `${id} goes below the floor at ${i / 60}`);
        }
      }
    }
  }
});

test('planted feet and hands do not slide', () => {
  const still = (id, joint, tolerance = 0.6) => {
    const demo = getDemo(id);
    const at0 = demoFrame(demo, 0).J[joint];
    for (let i = 0; i <= 40; i += 1) assert.ok(dist(demoFrame(demo, i / 40).J[joint], at0) < tolerance, `${id} ${joint} slides at ${i / 40}`);
  };
  for (const id of ['bodyweight-squat', 'goblet-squat', 'back-squat', 'chair-squat', 'dumbbell-rdl', 'band-row']) still(id, 'anR');
  for (const id of ['push-up', 'incline-push-up']) {
    still(id, 'haR');
    still(id, 'anR');
  }
  still('assisted-pull-up', 'haR');
  still('lat-pulldown', 'hip');
  still('split-squat', 'anR');
  still('split-squat', 'anL');
});
