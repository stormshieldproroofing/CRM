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

console.log(`\n${passed} passed`);
