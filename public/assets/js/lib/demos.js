// Animated demonstrations: one for every exercise in lib/exercises.js, keyed by exercise ID.
//
// Each demo is keyframes for the cartoon rig in lib/rig.js, plus the equipment it needs. One
// pass through `frames` (phase 0 → 1) is one full repetition: start position, the movement,
// and back to the start. For alternating exercises one pass does both sides.
//
//   view      'side' (the figure faces right) or 'front'
//   kind      'reps'  a repetition that loops
//             'hold'  `intro` shows getting into position once, then `frames` is the hold
//             'loop'  continuous movement (walking, cycling, rowing): timed only
//   cycle     seconds for one pass at normal pace
//   sides     'none' | 'alternate' (both sides in one pass) | 'each' (one side per set half,
//             shown mirrored for the second side)
//   sideNames what the two sides are called, first the one shown first
//   peak      the phase of the furthest point of the movement (the second "key pose")
//   props     (J, phase) => shapes for equipment; `f: true` draws in front of the figure
//
// The motion follows the written cues in lib/exercises.js: change them together.

import { poseAt, solvePose, jointPoints, DIMS } from './rig.js';

export const GROUND = 175; // y of the floor line; ankles rest at 168
const G = 168;

const P = (hip, t, limbs) => ({ hip, t, ...limbs });
const F = (at, pose) => ({ at, pose });
const to = (x, y, b = 1) => ({ to: [x, y], b });
/** The same pose with some parts changed. */
const W = (pose, changes) => ({ ...pose, ...changes });

const line = (x1, y1, x2, y2, c = 'prop', w = 4, f = false) => ({ k: 'line', x1, y1, x2, y2, c, w, f });
const circle = (x, y, r, c = 'prop', f = false) => ({ k: 'circle', x, y, r, c, f });
const rect = (x, y, w, h, c = 'prop', r = 2, f = false) => ({ k: 'rect', x, y, w, h, c, r, f });

const mat = (x1, x2) => rect(x1, GROUND - 4, x2 - x1, 4, 'prop-mat', 2);
/** A dumbbell seen from the side, centred on a hand. */
const dumbbell = (hand, f = true, vertical = false) => {
  const [x, y] = hand;
  return vertical
    ? [line(x, y - 7, x, y + 7, 'prop-dark', 3, f), rect(x - 5, y - 11, 10, 5, 'prop-dark', 2, f), rect(x - 5, y + 6, 10, 5, 'prop-dark', 2, f)]
    : [line(x - 7, y, x + 7, y, 'prop-dark', 3, f), rect(x - 11, y - 5, 5, 10, 'prop-dark', 2, f), rect(x + 6, y - 5, 5, 10, 'prop-dark', 2, f)];
};
/** A barbell seen end-on: the plate, centred on the hands. */
const plate = (hand, r = 12) => [circle(hand[0], hand[1], r, 'prop-dark', true), circle(hand[0], hand[1], r - 5, 'prop', true), circle(hand[0], hand[1], 2, 'prop-dark', true)];

const feet = (x = 100) => ({ lR: to(x, G), lL: to(x, G) });
const HANDS_ON_HIPS = { aR: [-32, 42], aL: [-32, 42] };

/* ---------------- Squats ---------------- */

function squat({ arms, armsDown, lean = 150, hipBottom = [84, 138] }) {
  const top = P([100, 109], 180, { ...feet(), aR: arms, aL: arms });
  const bottom = P(hipBottom, lean, { ...feet(), aR: armsDown ?? arms, aL: armsDown ?? arms, h: 12 });
  return [F(0, top), F(0.45, bottom), F(0.55, bottom), F(1, top)];
}

const chair = (seatX1, seatX2, seatY, backTop) => [
  line(seatX1, seatY, seatX2, seatY, 'prop', 5),
  line(seatX1 + 2, seatY, seatX1 - 2, backTop, 'prop', 4),
  line(seatX1 + 3, seatY, seatX1 + 3, GROUND, 'prop', 3),
  line(seatX2 - 3, seatY, seatX2 - 3, GROUND, 'prop', 3),
];

const chairSeated = P([72, 138], 176, { ...feet(), aR: [38, 78], aL: [38, 78] });
const chairLean = P([75, 136], 148, { ...feet(), aR: [62, 80], aL: [62, 80], h: 10 });
const chairStand = P([98, 109], 180, { ...feet(), aR: [8, 12], aL: [8, 12] });

// The bodyweight squat is shown from the front: feet a little wider than the hips with toes
// turned out, knees travelling out over the toes, hands coming together in front of the chest.
const squatFeet = { lR: to(119, G, 1), lL: to(81, G, -1), fR: 68, fL: -68 };
const frontSquatTop = P([100, 109], 180, { ...squatFeet, aR: to(120, 107, 1), aL: to(80, 107, -1) });
const frontSquatBottom = P([100, 135], 180, { ...squatFeet, aR: to(105, 101, 1), aL: to(95, 101, -1) });

/* ---------------- Lunges and steps ---------------- */

const lungeStand = P([100, 109], 180, { ...feet(), ...HANDS_ON_HIPS, fR: 90, fL: 90 });
const lungeRightBack = P([100, 134], 176, { lL: to(100, G), lR: to(62, 160), fR: 30, fL: 90, ...HANDS_ON_HIPS });
const lungeLeftBack = P([100, 134], 176, { lR: to(100, G), lL: to(62, 160), fL: 30, fR: 90, ...HANDS_ON_HIPS });

const splitTop = P([100, 115], 180, { lR: to(124, G), lL: to(66, 160), fL: 30, ...HANDS_ON_HIPS });
const splitBottom = P([100, 135], 178, { lR: to(124, G), lL: to(66, 160), fL: 30, ...HANDS_ON_HIPS });

const STEP_TOP = 146;
const stepFloor = P([90, 109], 180, { lR: to(88, G), lL: to(88, G), aR: [4, 10], aL: [-4, 6] });
const stepFootUp = (lead) => P([95, 110], 176, { [lead]: to(118, STEP_TOP), [lead === 'lR' ? 'lL' : 'lR']: to(88, G), aR: [-10, 20], aL: [14, 40] });
const stepMid = (lead) => P([106, 96], 176, { [lead]: to(118, STEP_TOP), [lead === 'lR' ? 'lL' : 'lR']: to(98, 150), aR: [6, 30], aL: [-6, 14] });
const stepUp = P([115, 87], 180, { lR: to(118, STEP_TOP), lL: to(114, STEP_TOP), aR: [4, 10], aL: [-4, 6] });

/* ---------------- Floor: supine (head to the left, feet right) ---------------- */

const bridgeDown = P([104, 160], -90, { lR: to(140, G), lL: to(140, G), aR: [86, 92], aL: [86, 92] });
const bridgeUp = P([99, 138], -61, { h: -29, lR: to(140, G), lL: to(140, G), aR: [86, 92], aL: [86, 92] });

const floorPressDown = P([104, 160], -90, { lR: to(140, G), lL: to(140, G), aR: [98, 180], aL: [98, 180] });
const floorPressUp = W(floorPressDown, { aR: [180, 180], aL: [180, 180] });

const benchDown = P([104, 124], -90, { lR: to(130, G), lL: to(130, G), aR: [76, 180], aL: [76, 180] });
const benchUp = W(benchDown, { aR: [180, 180], aL: [180, 180] });

const bugTable = P([100, 160], -90, { lR: [176, 90], lL: [176, 90], aR: [180, 180], aL: [180, 180] });
const bugRight = W(bugTable, { lR: [102, 97], aL: [262, 266] }); // right leg and opposite arm lower
const bugLeft = W(bugTable, { lL: [102, 97], aR: [262, 266] });

/* ---------------- Floor: face down (head to the right) ---------------- */

// The body pivots on the toes: hip and chest stay 60 and 106 units from the ankles, so the legs stay straight.
const pushTop = P([85.4, 140.8], 112.7, { aR: to(128, G, -1), aL: to(128, G, -1), lR: to(30, 164), lL: to(30, 164), fR: 8, fL: 8, h: -12 });
const pushBottom = P([89.6, 157.2], 96.5, { aR: to(128, G, -1), aL: to(128, G, -1), lR: to(30, 164), lL: to(30, 164), fR: 8, fL: 8, h: -16 });

const inclineTop = P([85, 114], 146.5, { aR: to(130, 116, -1), aL: to(130, 116, -1), lR: to(52, 164), lL: to(52, 164), fR: 60, fL: 60, h: -10 });
const inclineBottom = P([100, 128], 127, { aR: to(130, 116, -1), aL: to(130, 116, -1), lR: to(52, 164), lL: to(52, 164), fR: 60, fL: 60, h: -14 });

const plankHold = P([83, 150.7], 100.9, { aR: [0, 90], aL: [0, 90], lR: to(24, 162), lL: to(24, 162), fR: 8, fL: 8, h: -8 });
const plankKnees = P([86, 141], 92.5, { aR: [0, 90], aL: [0, 90], lR: to(41, 166), lL: to(41, 166), fR: -80, fL: -80, h: -8 });

const sidePlankDown = P([84, 160], 112.3, { aR: [0, 90], aL: [120, 150], lR: to(24, 164), lL: to(24, 164), fR: 20, fL: 20 });
const sidePlankHold = P([83, 150.7], 100.9, { aR: [0, 90], aL: [186, 180], lR: to(24, 162), lL: to(24, 162), fR: 20, fL: 20 });

const dogBase = P([78, 136], 107, { aR: [5, 5], aL: [5, 5], lR: [0, -90], lL: [0, -90], fR: -90, fL: -90, h: -8 });
const dogRight = W(dogBase, { aR: [101, 99], lL: [-86, -92], fL: -40 }); // right arm, left leg
const dogLeft = W(dogBase, { aL: [101, 99], lR: [-86, -92], fR: -40 });

const supermanDown = P([90, 163], 90, { aR: [90, 90], aL: [90, 90], lR: [-90, -90], lL: [-90, -90], fR: -90, fL: -90 });
const supermanUp = P([90, 163], 103, { aR: [102, 100], aL: [102, 100], lR: [-99, -98], lL: [-99, -98], fR: -95, fL: -95, h: -8 });

/* ---------------- Standing with weights ---------------- */

const rdlTop = P([100, 109], 180, { ...feet(), aR: [0, 0], aL: [0, 0] });
const rdlBottom = P([89, 112], 104, { ...feet(), aR: [0, 0], aL: [0, 0], h: 16 });

const pressFeet = { lR: to(113, G, 1), lL: to(87, G, -1) };
const pressLow = P([100, 109], 180, { ...pressFeet, aR: [35, 172], aL: [-35, -172] });
const pressHigh = P([100, 109], 180, { ...pressFeet, aR: [166, 184], aL: [-166, -184] });

const rowHang = P([78, 110], 95, { aR: [0, 0], aL: to(124, 140, -1), lR: to(92, G), lL: [10, -85], fL: -90, h: 14 });
const rowPull = W(rowHang, { aR: [-100, 5] });

const bandOut = P([80, 109], 181, { ...feet(80), aR: to(126, 72, -1), aL: to(126, 72, -1) });
const bandIn = P([80, 109], 184, { ...feet(80), aR: to(86, 76, -1), aL: to(86, 76, -1) });

const calfDown = P([100, 109], 180, { lR: to(100, G), lL: to(100, G), fR: 90, fL: 90, aR: to(143, 74, -1), aL: [4, 8] });
const calfUp = P([100, 101], 180, { lR: to(103, 160), lL: to(103, 160), fR: 48, fL: 48, aR: to(143, 74, -1), aL: [4, 8] });

/* ---------------- Machines ---------------- */

const pressDir = [0.866, -0.5]; // the leg press moves up and away at 30 degrees
const legPress = (reach) => {
  const foot = [70 + pressDir[0] * reach, 140 + pressDir[1] * reach];
  return P([70, 140], 225, { lR: to(foot[0], foot[1]), lL: to(foot[0], foot[1]), fR: 210, fL: 210, aR: [18, 72], aL: [18, 72], h: -20 });
};

const curlOut = P([104, 112], -90, { lR: [90, 95], lL: [90, 95], fR: 0, fL: 0, aR: [14, -30], aL: [14, -30] });
const curlIn = W(curlOut, { lR: [90, 205], lL: [90, 205], fR: 115, fL: 115 });

const chestIn = P([78, 138], 185, { lR: to(108, G), lL: to(108, G), aR: to(92, 98, -1), aL: to(92, 98, -1) });
const chestOut = W(chestIn, { aR: to(118, 98, -1), aL: to(118, 98, -1) });

const cableOut = P([70, 140], 168, { lR: to(124, 146), lL: to(124, 146), fR: 170, fL: 170, aR: to(112, 104, -1), aL: to(112, 104, -1) });
const cableIn = P([70, 140], 183, { lR: to(124, 146), lL: to(124, 146), fR: 170, fL: 170, aR: to(80, 112, -1), aL: to(80, 112, -1) });

const SEATED_FRONT = { th: 10, sh: 28 };
const pulldownLegs = { lR: [22, 0], lL: [-22, 0] };
const pulldownUp = P([100, 130], 180, { ...pulldownLegs, aR: to(130, 40, -1), aL: to(70, 40, 1) });
const pulldownDown = P([100, 130], 180, { ...pulldownLegs, aR: to(128, 80, -1), aL: to(72, 80, 1) });

const BAR = 14;
const pullHang = P([100, 106], 180, { lR: [6, 0], lL: [-6, 0], aR: to(122, BAR, -1), aL: to(78, BAR, 1) });
const pullTop = P([100, 66], 180, { lR: [6, 0], lL: [-6, 0], aR: to(122, BAR, -1), aL: to(78, BAR, 1) });

/* ---------------- Walking, cycling, rowing ---------------- */

function walk({ armsA, armsB, armsMidA, armsMidB }) {
  // A: right foot forward. B: left foot forward. In between, the back foot lifts and swings through.
  const contactR = P([100, 111], 178, { lR: to(118, G), lL: to(84, 166), fR: 80, fL: 60, ...armsA });
  const passL = P([100, 109], 178, { lR: to(100, G), lL: to(103, 158), fR: 90, fL: 80, ...armsMidA });
  const contactL = P([100, 111], 178, { lL: to(118, G), lR: to(84, 166), fL: 80, fR: 60, ...armsB });
  const passR = P([100, 109], 178, { lL: to(100, G), lR: to(103, 158), fL: 90, fR: 80, ...armsMidB });
  return [F(0, contactR), F(0.25, passL), F(0.5, contactL), F(0.75, passR), F(1, contactR)];
}
/** Floor marks that slide backwards, so walking on the spot reads as moving forwards. */
const floorMarks = (phase) => [0, 1, 2, 3].map((i) => {
  const x = 150 - (((phase + i / 4) % 1) * 104);
  return line(x, GROUND + 5, x - 10, GROUND + 5, 'prop-faint', 2);
});

const CRANK = [104, 150];
const bikeFrames = Array.from({ length: 9 }, (_, i) => {
  const a = (i / 8) * 2 * Math.PI;
  const r = 12;
  const right = [CRANK[0] + Math.sin(a) * r, CRANK[1] - Math.cos(a) * r];
  const left = [CRANK[0] - Math.sin(a) * r, CRANK[1] + Math.cos(a) * r];
  return F(i / 8, P([84, 112], 150, { lR: to(right[0], right[1]), lL: to(left[0], left[1]), fR: 90, fL: 90, aR: to(128, 84, -1), aL: to(128, 84, -1), h: 22 }));
});

const rowFeet = { lR: to(128, 156), lL: to(128, 156), fR: 150, fL: 150 };
const rowPose = (hipX, t, handX) => P([hipX, 150], t, { ...rowFeet, aR: to(handX, 118, -1), aL: to(handX, 118, -1) });

/* ---------------- The catalogue ---------------- */

const rep = (frames, extra = {}) => ({ view: 'side', kind: 'reps', cycle: 3, sides: 'none', peak: 0.5, frames, ...extra });

export const DEMOS = Object.freeze({
  // ---- Legs ----
  // Shown with the owner's own character animation: one repetition as 24 pictures in a sheet.
  // The drawn poses stay as the fallback if the picture cannot load.
  'bodyweight-squat': rep([F(0, frontSquatTop), F(0.45, frontSquatBottom), F(0.62, frontSquatBottom), F(1, frontSquatTop)], {
    view: 'front',
    peak: 13 / 24,
    sprite: Object.freeze({ src: 'assets/img/squat-sheet.webp', frames: 24, cols: 6, rows: 4, frameW: 200, frameH: 480 }),
  }),
  'chair-squat': rep([F(0, chairSeated), F(0.15, chairLean), F(0.5, chairStand), F(0.6, chairStand), F(0.88, chairLean), F(1, chairSeated)], {
    cycle: 3.6,
    props: () => chair(54, 88, 147, 96),
  }),
  'goblet-squat': rep(squat({ arms: [25, 165], lean: 162, hipBottom: [86, 138] }), { props: (J) => dumbbell(J.haR, true, true) }),
  'back-squat': rep(squat({ arms: [-70, 140], lean: 148, hipBottom: [82, 136] }), { cycle: 3.4, props: (J) => plate([J.chest[0] - 7, J.chest[1] - 2], 10) }), // the bar rests across the upper back
  'leg-press': rep([F(0, legPress(57)), F(0.45, legPress(36)), F(0.55, legPress(36)), F(1, legPress(57))], {
    props: (J) => {
      const [ax, ay] = J.anR;
      return [
        line(64, 146, 28, 110, 'prop', 7), // back pad
        line(52, 150, 84, 150, 'prop', 6), // seat
        line(60, 152, 60, GROUND, 'prop', 3),
        line(84, 152, 150, 113, 'prop-faint', 3), // rail
        line(ax + 6, ay + 10, ax - 13, ay - 23, 'prop-dark', 5), // foot plate, moves with the feet
        line(ax + 4, ay + 6, ax + 22, ay + 16, 'prop', 3),
      ];
    },
  }),
  'reverse-lunge': rep(
    [F(0, lungeStand), F(0.22, lungeRightBack), F(0.28, lungeRightBack), F(0.5, lungeStand), F(0.72, lungeLeftBack), F(0.78, lungeLeftBack), F(1, lungeStand)],
    { cycle: 5.6, sides: 'alternate', sideNames: ['Right leg back', 'Left leg back'], peak: 0.25 },
  ),
  'split-squat': rep([F(0, splitTop), F(0.45, splitBottom), F(0.55, splitBottom), F(1, splitTop)], { sides: 'each', sideNames: ['Right leg forward', 'Left leg forward'] }),
  'step-up': rep(
    [
      F(0, stepFloor), F(0.1, stepFootUp('lR')), F(0.2, stepMid('lR')), F(0.3, stepUp), F(0.36, stepUp), F(0.43, stepFootUp('lR')), F(0.5, stepFloor),
      F(0.6, stepFootUp('lL')), F(0.7, stepMid('lL')), F(0.8, stepUp), F(0.86, stepUp), F(0.93, stepFootUp('lL')), F(1, stepFloor),
    ],
    { cycle: 6, sides: 'alternate', sideNames: ['Right foot leads', 'Left foot leads'], peak: 0.33, props: () => [rect(106, STEP_TOP + 6, 46, GROUND - STEP_TOP - 6, 'prop', 3)] },
  ),
  'glute-bridge': rep([F(0, bridgeDown), F(0.4, bridgeUp), F(0.6, bridgeUp), F(1, bridgeDown)], { props: () => [mat(30, 160)] }),
  'dumbbell-rdl': rep([F(0, rdlTop), F(0.45, rdlBottom), F(0.55, rdlBottom), F(1, rdlTop)], { cycle: 3.4, props: (J) => dumbbell(J.haR) }),
  'leg-curl': rep([F(0, curlOut), F(0.4, curlIn), F(0.55, curlIn), F(1, curlOut)], {
    faceFlip: true,
    props: (J) => [
      rect(34, 120, 108, 8, 'prop', 3), // bench
      line(48, 128, 48, GROUND, 'prop', 3),
      line(128, 128, 128, GROUND, 'prop', 3),
      line(134, 122, J.anR[0] + 3, J.anR[1] - 3, 'prop-dark', 3, true), // lever arm from the pivot at the knees
      circle(J.anR[0] + 4, J.anR[1] - 7, 5, 'prop-dark', true), // roller pad above the ankles
    ],
  }),
  'calf-raise': rep([F(0, calfDown), F(0.4, calfUp), F(0.6, calfUp), F(1, calfDown)], { cycle: 2.6, props: () => [line(147, 30, 147, GROUND, 'prop', 4)] }),

  // ---- Push ----
  'push-up': rep([F(0, pushTop), F(0.45, pushBottom), F(0.55, pushBottom), F(1, pushTop)]),
  'incline-push-up': rep([F(0, inclineTop), F(0.45, inclineBottom), F(0.55, inclineBottom), F(1, inclineTop)], {
    props: () => [rect(126, 118, 48, 7, 'prop', 2), line(168, 125, 168, GROUND, 'prop', 4), line(132, 125, 132, GROUND, 'prop-faint', 3)],
  }),
  'dumbbell-floor-press': rep([F(0, floorPressUp), F(0.45, floorPressDown), F(0.55, floorPressDown), F(1, floorPressUp)], { props: (J) => [mat(30, 160), ...dumbbell(J.haR)] }),
  'bench-press': rep([F(0, benchUp), F(0.45, benchDown), F(0.55, benchDown), F(1, benchUp)], {
    cycle: 3.4,
    props: (J) => [rect(34, 131, 82, 7, 'prop', 3), line(46, 138, 46, GROUND, 'prop', 3), line(106, 138, 106, GROUND, 'prop', 3), line(40, 70, 40, 131, 'prop-faint', 3), line(40, 72, 48, 72, 'prop-faint', 3), ...plate(J.haR)],
  }),
  'machine-chest-press': rep([F(0, chestIn), F(0.45, chestOut), F(0.55, chestOut), F(1, chestIn)], {
    props: (J) => [
      line(68, 142, 62, 84, 'prop', 7), // back pad
      line(62, 147, 96, 147, 'prop', 6), // seat
      line(72, 150, 72, GROUND, 'prop', 3),
      rect(34, 84, 16, GROUND - 84, 'prop-faint', 3), // weight stack
      line(J.haR[0], J.haR[1] + 6, J.haR[0] - 4, 62, 'prop-dark', 3, true), // lever with the handle
      line(J.haR[0] - 4, 62, 50, 62, 'prop-dark', 3),
    ],
  }),
  'dumbbell-shoulder-press': rep([F(0, pressLow), F(0.45, pressHigh), F(0.55, pressHigh), F(1, pressLow)], {
    view: 'front',
    props: (J) => [...dumbbell(J.haR), ...dumbbell(J.haL)],
  }),

  // ---- Pull ----
  'one-arm-row': rep([F(0, rowHang), F(0.4, rowPull), F(0.55, rowPull), F(1, rowHang)], {
    sides: 'each',
    sideNames: ['Right arm', 'Left arm'],
    props: (J) => [rect(36, 142, 100, 7, 'prop', 3), line(48, 149, 48, GROUND, 'prop', 3), line(124, 149, 124, GROUND, 'prop', 3), ...dumbbell(J.haR)],
  }),
  'band-row': rep([F(0, bandOut), F(0.4, bandIn), F(0.55, bandIn), F(1, bandOut)], {
    props: (J) => [line(166, 40, 166, GROUND, 'prop', 4), line(J.haR[0], J.haR[1], 166, 72, 'prop-accent', 2.5, true)],
  }),
  'seated-cable-row': rep([F(0, cableOut), F(0.4, cableIn), F(0.55, cableIn), F(1, cableOut)], {
    props: (J) => [
      rect(50, 148, 44, 6, 'prop', 3), // bench
      line(60, 154, 60, GROUND, 'prop', 3),
      line(86, 154, 86, GROUND, 'prop', 3),
      line(128, 136, 134, 162, 'prop-dark', 5), // foot plate
      rect(150, 84, 18, GROUND - 84, 'prop-faint', 3), // weight stack
      line(J.haR[0], J.haR[1], 150, 112, 'prop-dark', 2, true), // cable
      line(J.haR[0], J.haR[1] - 5, J.haR[0], J.haR[1] + 5, 'prop-dark', 3, true), // handle
    ],
  }),
  'lat-pulldown': rep([F(0, pulldownUp), F(0.4, pulldownDown), F(0.55, pulldownDown), F(1, pulldownUp)], {
    view: 'front',
    dims: SEATED_FRONT,
    props: (J) => [
      line(60, 16, 140, 16, 'prop', 4), // frame
      line(100, 16, 100, J.haR[1], 'prop-dark', 2), // cable
      line(J.haL[0] - 12, J.haL[1], J.haR[0] + 12, J.haR[1], 'prop-dark', 4, true), // bar
      rect(80, 137, 40, 7, 'prop', 3), // seat
      line(100, 144, 100, GROUND, 'prop', 4),
      rect(76, 122, 48, 6, 'prop-faint', 3, true), // thigh pads
    ],
  }),
  'assisted-pull-up': rep([F(0, pullHang), F(0.42, pullTop), F(0.55, pullTop), F(1, pullHang)], {
    view: 'front',
    cycle: 3.4,
    props: (J) => {
      const footY = (J.anR[1] + J.anL[1]) / 2 + 3;
      return [
        line(56, BAR, 144, BAR, 'prop-dark', 5, true), // bar
        line(60, BAR, 60, BAR - 14, 'prop', 4),
        line(140, BAR, 140, BAR - 14, 'prop', 4),
        line(95, BAR, 92, footY, 'prop-accent', 2.5), // band looped over the bar and under the feet
        line(105, BAR, 108, footY, 'prop-accent', 2.5),
        line(92, footY, 108, footY, 'prop-accent', 2.5, true),
      ];
    },
  }),

  // ---- Core and carries ----
  plank: {
    view: 'side', kind: 'hold', cycle: 4, sides: 'none', peak: 0.5,
    intro: [F(0, plankKnees), F(0.35, plankKnees), F(1, plankHold)],
    frames: [F(0, plankHold), F(0.5, W(plankHold, { hip: [83, 150] })), F(1, plankHold)],
    props: () => [mat(14, 160)],
  },
  'side-plank': {
    view: 'side', kind: 'hold', cycle: 4, sides: 'each', sideNames: ['Right side down', 'Left side down'], peak: 0.5, face: 'front',
    intro: [F(0, sidePlankDown), F(0.35, sidePlankDown), F(1, sidePlankHold)],
    frames: [F(0, sidePlankHold), F(0.5, W(sidePlankHold, { hip: [83, 150] })), F(1, sidePlankHold)],
    props: () => [mat(14, 160)],
  },
  'dead-bug': rep([F(0, bugTable), F(0.2, bugRight), F(0.3, bugRight), F(0.5, bugTable), F(0.7, bugLeft), F(0.8, bugLeft), F(1, bugTable)], {
    cycle: 6, sides: 'alternate', sideNames: ['Right leg, left arm', 'Left leg, right arm'], peak: 0.25, props: () => [mat(26, 170)],
  }),
  'bird-dog': rep([F(0, dogBase), F(0.2, dogRight), F(0.32, dogRight), F(0.5, dogBase), F(0.7, dogLeft), F(0.82, dogLeft), F(1, dogBase)], {
    cycle: 6, sides: 'alternate', sideNames: ['Right arm, left leg', 'Left arm, right leg'], peak: 0.26, props: () => [mat(30, 168)],
  }),
  'back-extension': rep([F(0, supermanDown), F(0.4, supermanUp), F(0.6, supermanUp), F(1, supermanDown)], { props: () => [mat(10, 190)] }),
  'farmers-carry': {
    view: 'side', kind: 'loop', cycle: 1.5, sides: 'none', peak: 0.25,
    frames: walk({ armsA: { aR: [-3, 2], aL: [3, 6] }, armsB: { aR: [3, 6], aL: [-3, 2] }, armsMidA: { aR: [0, 4], aL: [0, 4] }, armsMidB: { aR: [0, 4], aL: [0, 4] } }),
    props: (J, phase) => [...floorMarks(phase), ...dumbbell(J.haL, false), ...dumbbell(J.haR)],
  },

  // ---- Cardio ----
  'brisk-walk': {
    view: 'side', kind: 'loop', cycle: 1.1, sides: 'none', peak: 0.5,
    frames: walk({ armsA: { aR: [-28, 38], aL: [34, 108] }, armsB: { aR: [34, 108], aL: [-28, 38] }, armsMidA: { aR: [4, 72], aL: [4, 72] }, armsMidB: { aR: [4, 72], aL: [4, 72] } }),
    props: (J, phase) => floorMarks(phase),
  },
  'exercise-bike': {
    view: 'side', kind: 'loop', cycle: 1.2, sides: 'none', peak: 0.25,
    frames: bikeFrames,
    props: (J) => [
      line(68, GROUND, 162, GROUND, 'prop', 4), // base
      circle(142, 148, 20, 'prop-faint'), // flywheel
      circle(142, 148, 4, 'prop'),
      line(84, 122, 102, 150, 'prop', 4), // seat post
      line(74, 121, 94, 121, 'prop-dark', 5), // saddle
      line(102, 150, 142, 148, 'prop', 4),
      line(130, 86, 138, 148, 'prop', 4), // handlebar stem
      line(124, 86, 136, 86, 'prop-dark', 4, true),
      line(J.anL[0] + 4, J.anL[1] + 5, CRANK[0], CRANK[1], 'prop-dark', 3), // cranks to the pedals
      line(J.anR[0] + 4, J.anR[1] + 5, CRANK[0], CRANK[1], 'prop-dark', 3, true),
      circle(CRANK[0], CRANK[1], 3, 'prop-dark', true),
    ],
  },
  'rowing-machine': {
    view: 'side', kind: 'loop', cycle: 2.6, sides: 'none', peak: 0.45,
    // Drive: legs, then lean back, then arms. Recovery: arms, body, legs.
    frames: [F(0, rowPose(98, 165, 144)), F(0.25, rowPose(70, 170, 120)), F(0.35, rowPose(70, 195, 104)), F(0.45, rowPose(70, 195, 78)), F(0.57, rowPose(70, 195, 104)), F(0.67, rowPose(70, 170, 120)), F(1, rowPose(98, 165, 144))],
    props: (J) => [
      line(40, 163, 150, 163, 'prop', 4), // rail
      line(46, 163, 46, GROUND, 'prop', 3),
      rect(J.hip[0] - 10, 156, 20, 5, 'prop-dark', 2), // sliding seat
      line(130, 142, 138, 163, 'prop-dark', 5), // foot plate
      circle(160, 142, 17, 'prop-faint'), // flywheel
      circle(160, 142, 4, 'prop'),
      line(150, 163, 160, 142, 'prop', 4),
      line(J.haR[0], J.haR[1], 152, 128, 'prop-dark', 2, true), // chain
      line(J.haR[0], J.haR[1] - 5, J.haR[0], J.haR[1] + 5, 'prop-dark', 3, true), // handle
    ],
  },
});

export function getDemo(exerciseId) {
  return DEMOS[exerciseId] ?? null;
}

export const demoDims = (demo) => (demo.dims ? { ...DIMS, ...demo.dims } : DIMS);

/** Joints and equipment for a demo at a phase (0–1) of its loop, or of its intro. */
export function demoFrame(demo, phase, { intro = false } = {}) {
  const frames = intro && demo.intro ? demo.intro : demo.frames;
  const p = intro ? Math.min(1, Math.max(0, phase)) : ((phase % 1) + 1) % 1;
  const J = solvePose(poseAt(frames, p), demo.view, demoDims(demo));
  return { J, props: demo.props ? demo.props(J, p) : [] };
}

/** The two still poses that sum up a movement: the start, and the furthest point. */
export function keyPhases(demo) {
  return demo.kind === 'hold' ? [0] : [0, demo.peak];
}

/** Which side is working at a phase of an alternating demo: 0 (first) or 1. */
export function sideAt(demo, phase) {
  return demo.sides === 'alternate' && (((phase % 1) + 1) % 1) >= 0.5 ? 1 : 0;
}

function shapePoints(s) {
  if (s.k === 'line') return [[s.x1, s.y1], [s.x2, s.y2]];
  if (s.k === 'circle') return [[s.x - s.r, s.y], [s.x + s.r, s.y], [s.x, s.y - s.r], [s.x, s.y + s.r]];
  return [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]];
}

const fits = new Map();
/**
 * A centre and radius (in demo units) that contain the whole figure and its equipment at every
 * moment of the movement, so the stage can be scaled to keep everything in view.
 */
export function demoFit(demo) {
  if (fits.has(demo)) return fits.get(demo);
  const dims = demoDims(demo);
  const pts = [];
  const sample = (phase, intro) => {
    const { J, props } = demoFrame(demo, phase, { intro });
    for (const p of jointPoints(J)) pts.push(p);
    // The head is a circle around its centre.
    pts.push([J.head[0] - dims.head, J.head[1]], [J.head[0] + dims.head, J.head[1]], [J.head[0], J.head[1] - dims.head], [J.head[0], J.head[1] + dims.head]);
    for (const s of props) if (s.c !== 'prop-faint' || s.k !== 'line') for (const p of shapePoints(s)) pts.push(p);
  };
  for (let i = 0; i < 48; i += 1) sample(i / 48, false);
  if (demo.intro) for (let i = 0; i <= 12; i += 1) sample(i / 12, true);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) + 11; // limbs have thickness
  const fit = { cx, cy, radius };
  fits.set(demo, fit);
  return fit;
}

/** Problems with a demo's data, for tests: an empty list means it is sound. */
export function validateDemo(demo) {
  const problems = [];
  if (!['side', 'front'].includes(demo.view)) problems.push('view');
  if (!['reps', 'hold', 'loop'].includes(demo.kind)) problems.push('kind');
  if (!(demo.cycle > 0)) problems.push('cycle');
  if (demo.kind === 'hold' && !demo.intro) problems.push('a hold needs an intro');
  if (demo.sides !== 'none' && demo.sideNames?.length !== 2) problems.push('sideNames');
  for (const track of [demo.frames, demo.intro].filter(Boolean)) {
    if (track[0].at !== 0 || track[track.length - 1].at !== 1) problems.push('frames must run from 0 to 1');
    for (let i = 1; i < track.length; i += 1) {
      if (track[i].at < track[i - 1].at) problems.push('frames out of order');
      for (const limb of ['aR', 'aL', 'lR', 'lL']) {
        if (Array.isArray(track[i].pose[limb]) !== Array.isArray(track[0].pose[limb])) problems.push(`${limb} mixes angles and targets`);
      }
    }
  }
  return problems;
}
