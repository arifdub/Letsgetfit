// A small 2D cartoon rig for exercise demonstrations. Pure maths, no DOM.
//
// Coordinates: x to the right, y down, in "demo units" (a standing figure is about 150 tall).
// Angles are absolute, in degrees: 0 points straight down, 90 to the right (the way a side-view
// figure faces), 180 up, 270 (or -90) to the left.
//
// A pose is { hip: [x, y], t: torsoAngle, h?: headTilt, aR, aL, lR, lL, fR?, fL? } where each limb
// is either [upperAngle, lowerAngle] or { to: [x, y], b: 1 | -1 }: a target for the hand or ankle,
// solved with two-bone inverse kinematics so planted hands and feet never slide. b picks which
// way the elbow or knee bends. "R" limbs are the ones nearest the viewer in a side view.

export const DIMS = Object.freeze({ torso: 46, ua: 24, fa: 22, th: 30, sh: 30, ft: 12, head: 11, neck: 5, sw: 17, hw: 9 });

const RAD = Math.PI / 180;
export const dir = (deg) => [Math.sin(deg * RAD), Math.cos(deg * RAD)];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const lerp = (a, b, u) => a + (b - a) * u;

/** Smooth start and stop, like a real movement. */
export const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Two-bone IK: angles [upper, lower] that put the end of the chain on (or as near as possible to) the target. */
export function solveLimb(from, to, l1, l2, bend = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const reach = Math.hypot(dx, dy);
  const d = Math.min(Math.max(reach, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const theta = Math.atan2(dx, dy) / RAD;
  const alpha = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))) / RAD;
  const upper = theta + bend * alpha;
  const joint = add(from, dir(upper), l1);
  // Aim the lower bone at the (clamped) target.
  const k = reach > 0 ? d / reach : 0;
  const tx = from[0] + dx * k;
  const ty = from[1] + dy * k;
  const lower = Math.atan2(tx - joint[0], ty - joint[1]) / RAD;
  return [upper, lower];
}

function limbAngles(spec, from, l1, l2) {
  return Array.isArray(spec) ? spec : solveLimb(from, spec.to, l1, l2, spec.b ?? 1);
}

/**
 * Forward kinematics: joint positions for a pose.
 * @param {object} pose
 * @param {'side'|'front'} view  in a front view the shoulders and hips are spread sideways
 */
export function solvePose(pose, view = 'side', dims = DIMS) {
  const hip = pose.hip;
  const td = dir(pose.t);
  const chest = add(hip, td, dims.torso);
  const perp = [-td[1], td[0]];
  const sw = view === 'front' ? dims.sw : 0;
  const hw = view === 'front' ? dims.hw : 0;
  const J = { hip, chest, t: pose.t };
  J.head = add(chest, dir(pose.t + (pose.h ?? 0)), dims.neck + dims.head);
  for (const [side, sign] of [['R', 1], ['L', -1]]) {
    const sh = add(chest, perp, sw * sign);
    const hp = add(hip, perp, hw * sign);
    const [ua, fa] = limbAngles(pose[`a${side}`], sh, dims.ua, dims.fa);
    const el = add(sh, dir(ua), dims.ua);
    const ha = add(el, dir(fa), dims.fa);
    const [th, shn] = limbAngles(pose[`l${side}`], hp, dims.th, dims.sh);
    const kn = add(hp, dir(th), dims.th);
    const an = add(kn, dir(shn), dims.sh);
    const footAngle = pose[`f${side}`] ?? (view === 'front' ? 55 * sign : 90);
    const to = add(an, dir(footAngle), view === 'front' ? dims.ft * 0.6 : dims.ft);
    Object.assign(J, { [`sh${side}`]: sh, [`el${side}`]: el, [`ha${side}`]: ha, [`hp${side}`]: hp, [`kn${side}`]: kn, [`an${side}`]: an, [`to${side}`]: to });
  }
  return J;
}

function mixLimb(a, b, u) {
  if (Array.isArray(a) && Array.isArray(b)) return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  if (!Array.isArray(a) && !Array.isArray(b)) return { to: [lerp(a.to[0], b.to[0], u), lerp(a.to[1], b.to[1], u)], b: u < 0.5 ? a.b ?? 1 : b.b ?? 1 };
  return u < 0.5 ? a : b; // mixed modes are rejected by validateDemo; never animate across them
}

export function mixPose(a, b, u) {
  const out = { hip: [lerp(a.hip[0], b.hip[0], u), lerp(a.hip[1], b.hip[1], u)], t: lerp(a.t, b.t, u), h: lerp(a.h ?? 0, b.h ?? 0, u) };
  for (const k of ['aR', 'aL', 'lR', 'lL']) out[k] = mixLimb(a[k], b[k], u);
  for (const k of ['fR', 'fL']) {
    if (a[k] !== undefined || b[k] !== undefined) out[k] = lerp(a[k] ?? b[k], b[k] ?? a[k], u);
  }
  return out;
}

/**
 * The pose at a point in a keyframe track.
 * @param {Array<{at: number, pose: object}>} frames  sorted by `at`, from 0 to 1
 * @param {number} phase  0–1
 */
export function poseAt(frames, phase) {
  const p = Math.min(1, Math.max(0, phase));
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    if (p <= b.at) {
      const span = b.at - a.at;
      return mixPose(a.pose, b.pose, span > 0 ? ease((p - a.at) / span) : 1);
    }
  }
  return frames[frames.length - 1].pose;
}

/** Every [x, y] in a set of joints, for fitting and bounds checks. */
export function jointPoints(J) {
  return Object.values(J).filter(Array.isArray);
}
