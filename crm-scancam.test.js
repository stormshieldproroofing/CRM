const assert = require('assert');
const cam = require('./crm-scancam.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.01 : tol);

test('upright phone: the check frame is tall (check goes in sideways)', () => {
  assert.ok(near(cam.frameRatio('check', false), 2.75 / 6));
  assert.ok(near(cam.frameRatio('check', true), 6 / 2.75));
  assert.ok(near(cam.frameRatio('doc', false), 8.5 / 11));
  assert.ok(near(cam.frameRatio('doc', true), 8.5 / 11));
});

test('fitFrame: largest frame of the right shape, centered in the space', () => {
  const area = { left: 16, right: 374, top: 150, bottom: 620 };
  const tall = cam.fitFrame(area, cam.frameRatio('check', false));
  assert.ok(near(tall.h, 470));               // fills the full height
  assert.ok(near(tall.w / tall.h, 2.75 / 6));
  assert.ok(near(tall.x + tall.w / 2, 195));  // centered
  const page = cam.fitFrame(area, cam.DOC_RATIO);
  assert.ok(page.w <= 358 + 1e-9 && page.h <= 470 + 1e-9);
  assert.ok(near(page.w / page.h, 8.5 / 11));
});

test('upright phone: the sideways check gets ~1.3× the detail at 1080p and ~2.6× at 4K vs the old wide frame', () => {
  const W = 390, H = 844;
  const oldFrame = { x: 18, y: 300, w: 354, h: 354 / cam.CHECK_RATIO };
  const old = cam.cropRect(W, H, 1080, 1920, oldFrame, 0).sw;            // check's long side, old way
  const f = cam.fitFrame({ left: 16, right: 374, top: 150, bottom: 620 }, cam.frameRatio('check', false));
  const hd = cam.cropRect(W, H, 1080, 1920, f, 0).sh;                    // long side runs down the picture
  const uhd = cam.cropRect(W, H, 2160, 3840, f, 0).sh;
  assert.ok(hd / old > 1.25, `1080p ${hd} vs ${old}`);
  assert.ok(uhd / old > 2.5, `4K ${uhd} vs ${old}`);
});

test('crop maps the frame onto the camera picture (object-fit: cover)', () => {
  const W = 390, H = 844, vw = 1080, vh = 1920;
  const f = { x: 18, y: 300, w: 354, h: 162 };
  const c = cam.cropRect(W, H, vw, vh, f, 0);
  const scale = H / vh, ox = (W - vw * scale) / 2;
  assert.strictEqual(c.sx, Math.round((18 - ox) / scale));
  assert.strictEqual(c.sy, Math.round(300 / scale));
  assert.ok(near(c.sw / c.sh, 354 / 162));
});

test('crop never leaves the picture', () => {
  const c = cam.cropRect(390, 844, 1440, 2560, { x: -50, y: -50, w: 600, h: 1000 }, 0);
  assert.ok(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= 1440 && c.sy + c.sh <= 2560);
});

test('sideways layout: wide check frame between the side controls', () => {
  const area = { left: 70, right: 720, top: 56, bottom: 350 };
  const f = cam.fitFrame(area, cam.frameRatio('check', true));
  assert.ok(f.w > f.h);
  assert.ok(f.x >= 70 && f.x + f.w <= 720 + 1e-9 && f.y >= 56 && f.y + f.h <= 350 + 1e-9);
});

test('saved size: capped at 2400px, and width/height swap when the check is turned upright', () => {
  assert.deepStrictEqual(cam.outSize(1000, 2200, false), { w: 1000, h: 2200 });
  assert.deepStrictEqual(cam.outSize(1000, 2200, true), { w: 2200, h: 1000 });
  assert.deepStrictEqual(cam.outSize(1500, 3600, true), { w: 2400, h: 1000 });
});

test('no camera in Node: open() hands off to the fallback', () => {
  assert.strictEqual(cam.supported(), false);
  let fell = 0;
  cam.open({ mode: 'check', onFallback: () => fell++ });
  cam.open({ mode: 'doc', onFallback: () => fell++ });
  assert.strictEqual(fell, 2);
  assert.strictEqual(globalThis.crmCheckCam, cam);   // older name still works
});


// ---- auto-snap ----
// A sample W×H: frame occupies the middle (15% margin each side, like the camera's sample).
function scene(opts) {
  const w = 160, h = 80, lum = new Uint8Array(w * h).fill(opts.bg == null ? 45 : opts.bg);
  const f = { x0: 0.15 / 1.3, x1: 1.15 / 1.3, y0: 0.15 / 1.3, y1: 1.15 / 1.3 };
  if (opts.paper) {
    const p = opts.paper;   // paper rect in sample fractions
    for (let y = Math.round(p.y0 * h); y < Math.round(p.y1 * h); y++)
      for (let x = Math.round(p.x0 * w); x < Math.round(p.x1 * w); x++) lum[y * w + x] = opts.fg == null ? 225 : opts.fg;
    // a bit of "print" on the paper
    for (let x = Math.round(p.x0 * w) + 6; x < Math.round(p.x1 * w) - 6; x += 3) lum[Math.round(((p.y0 + p.y1) / 2) * h) * w + x] = 60;
  }
  return { lum, w, h, f };
}
const run = o => { const s = scene(o); return cam.analyze(s.lum, s.w, s.h, s.f).state; };
const F = { x0: 0.15 / 1.3, x1: 1.15 / 1.3, y0: 0.15 / 1.3, y1: 1.15 / 1.3 };

test('auto-snap: paper filling the frame on a dark surface → ok', () => {
  assert.strictEqual(run({ paper: { x0: F.x0 + 0.01, x1: F.x1 - 0.01, y0: F.y0 + 0.02, y1: F.y1 - 0.02 } }), 'ok');
});
test('auto-snap: paper slightly smaller than the frame still counts', () => {
  const m = 0.07;
  assert.strictEqual(run({ paper: { x0: F.x0 + m, x1: F.x1 - m, y0: F.y0 + m, y1: F.y1 - m } }), 'ok');
});
test('auto-snap: paper too small → move closer', () => {
  assert.strictEqual(run({ paper: { x0: 0.3, x1: 0.7, y0: 0.35, y1: 0.65 } }), 'far');
});
test('auto-snap: paper off to one side → center it', () => {
  assert.strictEqual(run({ paper: { x0: F.x0 + 0.12, x1: F.x1 + 0.1, y0: F.y0, y1: F.y1 } }), 'center');
});
test('auto-snap: paper bigger than the frame → move back', () => {
  assert.strictEqual(run({ paper: { x0: 0, x1: 1, y0: 0.02, y1: 0.98 } }), 'near');
});
test('auto-snap: white paper on a white counter → ask for a darker surface', () => {
  assert.strictEqual(run({ bg: 205, fg: 225, paper: { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1 } }), 'contrast');
});
test('auto-snap: too dark', () => {
  assert.strictEqual(run({ bg: 10, fg: 30, paper: { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1 } }), 'dark');
});
test('auto-snap: nothing there', () => {
  assert.strictEqual(run({}), 'none');
});
test('auto-snap: motion is ~0 for the same picture and large when it changes', () => {
  const a = scene({ paper: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } }).lum, b = scene({}).lum;
  assert.strictEqual(cam.motion(a, a), 0);
  assert.ok(cam.motion(a, b) > 30);
});

console.log(`\n${passed} passed`);
