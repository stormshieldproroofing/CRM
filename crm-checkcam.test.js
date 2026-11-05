const assert = require('assert');
const cam = require('./crm-checkcam.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('frame is check-shaped and centered on an iPhone screen', () => {
  const f = cam.frameRect(390, 844, 200);
  assert.ok(Math.abs(f.w / f.h - cam.CHECK_RATIO) < 1e-9);
  assert.strictEqual(f.w, 354);              // 18px margin each side
  assert.strictEqual(f.x, 18);
  assert.ok(f.y >= 200);
  assert.ok(f.y + f.h < 844 - 200, 'leaves room for the tips and shutter');
});

test('frame never starts above the top bar', () => {
  const f = cam.frameRect(390, 500, 260);
  assert.strictEqual(f.y, 260);
});

test('frame stays a sensible size on a wide screen', () => {
  const f = cam.frameRect(1440, 900, 200);
  assert.ok(f.w <= 640);
  assert.strictEqual(f.x, (1440 - f.w) / 2);
});

test('crop maps the frame onto a portrait camera picture (object-fit: cover)', () => {
  // 1080×1920 camera, shown on a 390×844 screen: scale = 844/1920, picture is cropped left/right.
  const W = 390, H = 844, vw = 1080, vh = 1920;
  const f = { x: 18, y: 300, w: 354, h: 354 / cam.CHECK_RATIO };
  const c = cam.cropRect(W, H, vw, vh, f, 0);
  const scale = H / vh;
  const ox = (W - vw * scale) / 2;
  assert.strictEqual(c.sx, Math.round((18 - ox) / scale));
  assert.strictEqual(c.sy, Math.round(300 / scale));
  assert.ok(Math.abs(c.sw / c.sh - cam.CHECK_RATIO) < 0.01, 'crop keeps the check shape');
});

test('crop adds a little room around the check, and never leaves the picture', () => {
  const f = cam.frameRect(390, 844, 200);
  const tight = cam.cropRect(390, 844, 1440, 2560, f, 0);
  const padded = cam.cropRect(390, 844, 1440, 2560, f);
  assert.ok(padded.sw > tight.sw && padded.sh > tight.sh);
  const huge = cam.cropRect(390, 844, 1440, 2560, { x: -50, y: -50, w: 600, h: 1000 }, 0);
  assert.ok(huge.sx >= 0 && huge.sy >= 0);
  assert.ok(huge.sx + huge.sw <= 1440 && huge.sy + huge.sh <= 2560);
});

test('crop works for a landscape camera picture on a desktop screen', () => {
  const W = 1280, H = 800, vw = 1920, vh = 1080;
  const f = cam.frameRect(W, H, 200);
  const c = cam.cropRect(W, H, vw, vh, f, 0);
  assert.ok(c.sw > 0 && c.sh > 0);
  assert.ok(Math.abs(c.sw / c.sh - cam.CHECK_RATIO) < 0.01);
});

test('saved photos are capped at 2000px on the long side', () => {
  assert.deepStrictEqual(cam.outSize(3000, 1375), { w: 2000, h: 917 });
  assert.deepStrictEqual(cam.outSize(1200, 550), { w: 1200, h: 550 });
});

test('no camera in Node: supported() is false and open() hands off to the fallback', () => {
  assert.strictEqual(cam.supported(), false);
  let fell = false;
  cam.open({ onFallback: () => { fell = true; } });
  assert.ok(fell);
});

console.log(`\n${passed} passed`);
