// Draws the cartoon exercise figure and its equipment as SVG. The pose maths are in lib/rig.js
// and the movements in lib/demos.js; this file only turns joints into shapes.
//
// Everything is set with SVG attributes (no inline styles), and colours come from classes in
// app.css, so it works under the site's Content Security Policy.

import { demoFrame, demoFit, demoDims, keyPhases, GROUND } from '../lib/demos.js';

const NS = 'http://www.w3.org/2000/svg';
const STAGE = 200; // viewBox size
const CENTRE = STAGE / 2;
export const STAGE_RADIUS = 86; // the white circle
const SAFE_RADIUS = 80; // the figure is scaled to stay inside this
const RING_RADIUS = 94;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const FACE_SRC = 'assets/img/character-head.png'; // 176 × 220, cut from the owner's character artwork
const FACE_H = 34;
const FACE_W = (FACE_H * 176) / 220;

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}
const n = (v) => (Math.round(v * 10) / 10).toString();
const setLine = (node, a, b) => {
  node.setAttribute('x1', n(a[0]));
  node.setAttribute('y1', n(a[1]));
  node.setAttribute('x2', n(b[0]));
  node.setAttribute('y2', n(b[1]));
};
const setDot = (node, p) => {
  node.setAttribute('cx', n(p[0]));
  node.setAttribute('cy', n(p[1]));
};

/** One frame of a picture sheet: a nested <svg> whose viewBox is moved from frame to frame. */
function createSprite(parent) {
  const view = el('svg', { display: 'none', preserveAspectRatio: 'xMidYMid meet' }, parent);
  const image = el('image', { x: 0, y: 0 }, view);
  let src = '';
  let failed = false;
  image.addEventListener('error', () => {
    failed = true;
  });
  return {
    get failed() {
      return failed;
    },
    hide() {
      view.setAttribute('display', 'none');
    },
    show(sprite, phase, cx, height) {
      if (src !== sprite.src) {
        src = sprite.src;
        failed = false;
        image.setAttribute('href', src);
        image.setAttribute('width', sprite.frameW * sprite.cols);
        image.setAttribute('height', sprite.frameH * sprite.rows);
      }
      const i = Math.min(sprite.frames - 1, Math.floor((((phase % 1) + 1) % 1) * sprite.frames));
      const width = (height * sprite.frameW) / sprite.frameH;
      view.setAttribute('viewBox', `${(i % sprite.cols) * sprite.frameW} ${Math.floor(i / sprite.cols) * sprite.frameH} ${sprite.frameW} ${sprite.frameH}`);
      view.setAttribute('x', n(cx - width / 2));
      view.setAttribute('y', n(CENTRE - height / 2 - height * (sprite.lift ?? 0)));
      view.setAttribute('width', n(width));
      view.setAttribute('height', n(height));
      view.removeAttribute('display');
    },
  };
}

const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

/** One figure (body parts and equipment) inside a <g>; update() moves it to a new frame. */
function createBody(parent) {
  const g = el('g', { class: 'fig' }, parent);
  const ground = el('line', { class: 'fig-ground', x1: -600, x2: 800, y1: GROUND, y2: GROUND }, g);
  const propsBack = el('g', {}, g);
  const limb = (far) => ({
    upper: el('line', { class: `fig-limb ${far ? 'fig-skin-far' : 'fig-skin'}` }),
    lower: el('line', { class: `fig-limb ${far ? 'fig-skin-far' : 'fig-skin'}` }),
    joint: el('circle', { class: 'fig-joint', r: 2.6 }),
  });
  const arm = (far) => ({
    ...limb(far),
    sleeve: el('line', { class: far ? 'fig-sleeve fig-sleeve-far' : 'fig-sleeve' }), // short raglan sleeve over the shoulder
    hand: el('circle', { class: far ? 'fig-hand-far' : 'fig-hand', r: 5 }),
  });
  const leg = (far) => ({
    upper: el('line', { class: `fig-limb ${far ? 'fig-leg-far' : 'fig-leg'}` }), // joggers
    lower: el('line', { class: `fig-limb ${far ? 'fig-leg-far' : 'fig-leg'}` }),
    joint: el('circle', { class: 'fig-joint fig-joint--leg', r: 2.6 }),
    sole: el('line', { class: far ? 'fig-sole fig-sole-far' : 'fig-sole' }), // trainers: a green sole under a white upper
    foot: el('line', { class: far ? 'fig-shoe-far' : 'fig-shoe' }),
  });
  const parts = {
    armL: arm(true), legL: leg(true), armR: arm(false), legR: leg(false),
    torso: el('path', { class: 'fig-top' }),
    pelvis: el('line', { class: 'fig-leg fig-pelvis' }),
    neck: el('line', { class: 'fig-neck' }),
    hair: el('circle', { class: 'fig-hair' }),
    face: el('circle', { class: 'fig-face' }),
    eye1: el('circle', { class: 'fig-eye', r: 1.5 }),
    eye2: el('circle', { class: 'fig-eye', r: 1.5 }),
    // The character's own face, used whenever the figure faces the viewer.
    portrait: el('image', { href: FACE_SRC, width: FACE_W, height: FACE_H, x: -FACE_W / 2, y: -FACE_H * 0.52, preserveAspectRatio: 'xMidYMid meet' }),
  };
  const body = el('g', {}, g);
  const propsFront = el('g', {}, g);
  let order = '';

  function setOrder(view) {
    if (order === view) return;
    order = view;
    const a = (x) => [x.upper, x.lower, x.sleeve, x.joint, x.hand];
    const l = (x) => [x.upper, x.lower, x.joint, x.sole, x.foot];
    const head = [parts.neck, parts.hair, parts.face, parts.eye1, parts.eye2, parts.portrait];
    body.replaceChildren(
      ...(view === 'front'
        ? [...l(parts.legL), ...l(parts.legR), parts.pelvis, parts.torso, ...head, ...a(parts.armL), ...a(parts.armR)]
        : [...a(parts.armL), ...l(parts.legL), parts.pelvis, parts.torso, ...head, ...l(parts.legR), ...a(parts.armR)]),
    );
  }

  function drawProps(host, shapes) {
    // Reuse elements where the shape kind matches; equipment has the same shapes every frame.
    while (host.childNodes.length > shapes.length) host.lastChild.remove();
    shapes.forEach((s, i) => {
      let node = host.childNodes[i];
      if (!node || node.tagName !== s.k) {
        const fresh = el(s.k);
        if (node) node.replaceWith(fresh);
        else host.append(fresh);
        node = fresh;
      }
      node.setAttribute('class', `fig-prop fig-${s.c}`);
      if (s.k === 'line') {
        setLine(node, [s.x1, s.y1], [s.x2, s.y2]);
        node.setAttribute('stroke-width', String(s.w));
      } else if (s.k === 'circle') {
        setDot(node, [s.x, s.y]);
        node.setAttribute('r', n(s.r));
      } else {
        node.setAttribute('x', n(s.x));
        node.setAttribute('y', n(s.y));
        node.setAttribute('width', n(s.w));
        node.setAttribute('height', n(s.h));
        node.setAttribute('rx', String(s.r));
      }
    });
  }

  function update(demo, frame) {
    const { J, props } = frame;
    const dims = demoDims(demo);
    const front = demo.view === 'front';
    setOrder(demo.view);
    // Facing the viewer, both sides are equally near: no darker "far" limbs.
    g.setAttribute('class', front ? 'fig fig--front' : 'fig');
    for (const side of ['R', 'L']) {
      const a = parts[`arm${side}`];
      setLine(a.upper, J[`sh${side}`], J[`el${side}`]);
      setLine(a.lower, J[`el${side}`], J[`ha${side}`]);
      setLine(a.sleeve, J[`sh${side}`], mix(J[`sh${side}`], J[`el${side}`], 0.45));
      setDot(a.joint, J[`el${side}`]);
      setDot(a.hand, J[`ha${side}`]);
      const l = parts[`leg${side}`];
      setLine(l.upper, J[`hp${side}`], J[`kn${side}`]);
      setLine(l.lower, J[`kn${side}`], J[`an${side}`]);
      setDot(l.joint, J[`kn${side}`]);
      setLine(l.sole, J[`an${side}`], J[`to${side}`]);
      setLine(l.foot, J[`an${side}`], J[`to${side}`]);
    }
    setLine(parts.pelvis, J.hpL, J.hpR);
    parts.torso.setAttribute(
      'd',
      front
        ? `M${n(J.shL[0])} ${n(J.shL[1])}L${n(J.shR[0])} ${n(J.shR[1])}L${n(J.hpR[0])} ${n(J.hpR[1])}L${n(J.hpL[0])} ${n(J.hpL[1])}Z`
        : `M${n(J.chest[0])} ${n(J.chest[1])}L${n(J.hip[0])} ${n(J.hip[1])}`,
    );
    parts.torso.setAttribute('class', front ? 'fig-top fig-top--front' : 'fig-top fig-top--side');

    // Head: hair behind and above, face towards where the figure looks.
    const hx = J.head[0] - J.chest[0];
    const hy = J.head[1] - J.chest[1];
    const len = Math.hypot(hx, hy) || 1;
    const up = [hx / len, hy / len];
    const flip = demo.faceFlip ? -1 : 1;
    const fwd = [-up[1] * flip, up[0] * flip];
    const faceOn = front || demo.face === 'front';
    setLine(parts.neck, J.chest, J.head);
    parts.hair.setAttribute('r', n(dims.head));
    parts.face.setAttribute('r', n(dims.head - 0.8));
    for (const part of [parts.hair, parts.face, parts.eye1, parts.eye2]) {
      if (faceOn) part.setAttribute('display', 'none');
      else part.removeAttribute('display');
    }
    if (faceOn) {
      // Turn the picture with the head: "up" is (0, -1) when standing.
      const turn = (Math.atan2(up[0], -up[1]) * 180) / Math.PI;
      parts.portrait.removeAttribute('display');
      parts.portrait.setAttribute('transform', `translate(${n(J.head[0])} ${n(J.head[1])}) rotate(${n(turn)})`);
    } else parts.portrait.setAttribute('display', 'none');
    if (faceOn) {
      setDot(parts.hair, [J.head[0] + up[0] * 2.4, J.head[1] + up[1] * 2.4]);
      setDot(parts.face, [J.head[0] - up[0] * 0.6, J.head[1] - up[1] * 0.6]);
      setDot(parts.eye1, [J.head[0] + fwd[0] * 3.8 - up[0] * 0.5, J.head[1] + fwd[1] * 3.8 - up[1] * 0.5]);
      setDot(parts.eye2, [J.head[0] - fwd[0] * 3.8 - up[0] * 0.5, J.head[1] - fwd[1] * 3.8 - up[1] * 0.5]);
    } else {
      setDot(parts.hair, [J.head[0] - fwd[0] * 2.2 + up[0] * 2, J.head[1] - fwd[1] * 2.2 + up[1] * 2]);
      setDot(parts.face, [J.head[0] + fwd[0] * 0.9 - up[0] * 0.7, J.head[1] + fwd[1] * 0.9 - up[1] * 0.7]);
      setDot(parts.eye1, [J.head[0] + fwd[0] * 5.6 + up[0] * 0.6, J.head[1] + fwd[1] * 5.6 + up[1] * 0.6]);
      parts.eye2.setAttribute('display', 'none');
    }
    drawProps(propsBack, props.filter((s) => !s.f));
    drawProps(propsFront, props.filter((s) => s.f));
  }

  return { g, ground, update };
}

/**
 * A round stage with the figure, and optionally a progress ring around it.
 * setDemo() picks the exercise; draw(phase) shows a moment of it; drawStill() shows the key
 * poses side by side instead (for reduced motion).
 */
export function createStage({ ring = false, label = '' } = {}) {
  const svg = el('svg', { class: 'stage', viewBox: `0 0 ${STAGE} ${STAGE}`, role: 'img', 'aria-label': label, focusable: 'false' });
  const id = `stage-clip-${Math.random().toString(36).slice(2, 9)}`;
  const clip = el('clipPath', { id }, el('defs', {}, svg));
  el('circle', { cx: CENTRE, cy: CENTRE, r: STAGE_RADIUS }, clip);
  let track = null;
  let bar = null;
  if (ring) {
    track = el('circle', { class: 'stage-ring-track', cx: CENTRE, cy: CENTRE, r: RING_RADIUS }, svg);
    bar = el('circle', { class: 'stage-ring', cx: CENTRE, cy: CENTRE, r: RING_RADIUS, transform: `rotate(-90 ${CENTRE} ${CENTRE})`, 'stroke-dasharray': `0 ${n(RING_LENGTH)}` }, svg);
  }
  el('circle', { class: 'stage-disc', cx: CENTRE, cy: CENTRE, r: STAGE_RADIUS }, svg);
  const clipped = el('g', { 'clip-path': `url(#${id})` }, svg);
  const bodies = [createBody(clipped), createBody(clipped)];
  const sprites = [createSprite(clipped), createSprite(clipped)];
  const hideSprites = () => sprites.forEach((s) => s.hide());
  const hideBodies = () => bodies.forEach((b) => b.g.setAttribute('display', 'none'));
  // A demo with a picture sheet uses it unless the picture failed to load.
  const pictured = () => Boolean(demo?.sprite) && !sprites[0].failed && !sprites[1].failed;
  let demo = null;
  let mirror = false;

  function place(body, cx, radius, visible) {
    if (!visible) {
      body.g.setAttribute('display', 'none');
      return;
    }
    body.g.removeAttribute('display');
    const fit = demoFit(demo);
    const s = Math.min(1.2, radius / fit.radius);
    body.g.setAttribute('transform', `translate(${n(cx)} ${CENTRE}) scale(${n(mirror ? -s : s)} ${n(s)}) translate(${n(-fit.cx)} ${n(-fit.cy)})`);
  }

  return {
    svg,
    setDemo(next, { mirrored = false, label: text } = {}) {
      demo = next;
      mirror = mirrored;
      if (text !== undefined) svg.setAttribute('aria-label', text);
    },
    /** Animated: one figure at a phase of the loop (or of the intro). */
    draw(phase, { intro = false } = {}) {
      if (!demo) return;
      if (pictured()) {
        hideBodies();
        sprites[0].show(demo.sprite, intro ? 0 : phase, CENTRE, demo.sprite.stageH);
        sprites[1].hide();
        return;
      }
      hideSprites();
      place(bodies[0], CENTRE, SAFE_RADIUS, true);
      place(bodies[1], 0, 0, false);
      bodies[0].update(demo, demoFrame(demo, phase, { intro }));
    },
    /** Still: the key poses side by side (one pose for a hold). */
    drawStill() {
      if (!demo) return;
      const phases = keyPhases(demo);
      if (pictured()) {
        hideBodies();
        hideSprites();
        const { stageH, frameW, frameH } = demo.sprite;
        const gap = phases.length === 1 ? 0 : 38;
        // Two pictures side by side: each at most 76 wide.
        const small = Math.min(stageH * 0.74, (76 * frameH) / frameW);
        phases.slice(0, 2).forEach((phase, i) => sprites[i].show(demo.sprite, phase, CENTRE + (i === 0 ? -gap : gap), phases.length === 1 ? stageH : small));
        return;
      }
      hideSprites();
      if (phases.length === 1) {
        place(bodies[0], CENTRE, SAFE_RADIUS, true);
        place(bodies[1], 0, 0, false);
        bodies[0].update(demo, demoFrame(demo, phases[0]));
        return;
      }
      const r = SAFE_RADIUS / 2;
      phases.forEach((phase, i) => {
        // Mirrored figures swap places so the start pose is always on the left.
        const slot = mirror ? 1 - i : i;
        place(bodies[i], CENTRE + (slot === 0 ? -r : r) * 0.98, r * 0.96, true);
        bodies[i].update(demo, demoFrame(demo, phase));
      });
    },
    /** Progress ring, 0–1. */
    setProgress(fraction) {
      if (!bar) return;
      const f = Math.min(1, Math.max(0, fraction));
      bar.setAttribute('stroke-dasharray', `${n(RING_LENGTH * f)} ${n(RING_LENGTH)}`);
    },
    hasRing: Boolean(track),
  };
}
