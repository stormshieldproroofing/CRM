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


test('auto-snap: camera grain alone does not count as movement', () => {
  const s = scene({ paper: { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1 } });
  // ±12 brightness of random grain per pixel, like a real phone sensor indoors
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noisy = () => Uint8Array.from(s.lum, v => Math.max(0, Math.min(255, v + Math.round((rnd() - 0.5) * 24))));
  const a = noisy(), b = noisy();
  assert.ok(cam.motion(a, b) >= 6, 'pixel-by-pixel sees grain as movement (the old bug)');
  assert.ok(cam.motion(a, b, s.w) < cam.STILL, `block compare ignores grain: ${cam.motion(a, b, s.w)}`);
});
test('auto-snap: a real shift of the phone still counts as movement', () => {
  const a = scene({ paper: { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1 } });
  const b = scene({ paper: { x0: F.x0 + 0.08, x1: F.x1 + 0.08, y0: F.y0 + 0.08, y1: F.y1 + 0.08 } });
  assert.ok(cam.motion(a.lum, b.lum, a.w) > cam.STEADY);
});
test('auto-snap: snaps after ~0.4s still, or ~1.1s steady-enough in the hand', () => {
  assert.strictEqual(cam.readyToSnap(2, 2), false);
  assert.strictEqual(cam.readyToSnap(3, 3), true);
  assert.strictEqual(cam.readyToSnap(0, 7), false);
  assert.strictEqual(cam.readyToSnap(0, 8), true);
});

/* ---------- find the page, straighten, whiten ---------- */

// A photo of a sheet of paper on a table: corners given in pixels, shaded
// (darker toward one side, warm tint) with a few lines of "ink".
function inQuad(q, x, y) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const z = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (z === 0) continue;
    if (s && (z > 0 ? 1 : -1) !== s) return false;
    s = z > 0 ? 1 : -1;
  }
  return true;
}
function photo(w, h, q, o) {
  o = o || {};
  const px = new Uint8ClampedArray(w * h * 4), lum = new Uint8Array(w * h);
  const toPage = cam.homography(q, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let r = o.table == null ? 55 : o.table, g = r - 8, b = r - 16;
    if (o.blueTable) { r = 20; g = 40; b = 160; }
    if (inQuad(q, x + 0.5, y + 0.5)) {
      const p = cam.mapPoint(toPage, x + 0.5, y + 0.5);
      const shade = 1 - 0.35 * p.x;                      // a shadow across the page
      r = 235 * shade; g = 225 * shade; b = 195 * shade;  // warm room light
      if (o.ink && p.x > 0.15 && p.x < 0.85 && Math.floor(p.y * 20) % 2 === 1 && p.y > 0.15 && p.y < 0.85) { r *= 0.2; g *= 0.2; b *= 0.2; }
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    lum[y * w + x] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  }
  return { px, lum, w, h };
}
const TILTED = [{ x: 62, y: 40 }, { x: 250, y: 58 }, { x: 236, y: 204 }, { x: 34, y: 180 }];   // in a 300 × 240 photo

test('find the page: a tilted sheet on a dark table → its four corners', () => {
  const p = photo(300, 240, TILTED, { ink: true });
  const r = cam.findPage(p.lum, p.w, p.h);
  assert.ok(r, 'page found');
  r.quad.forEach((c, i) => {
    assert.ok(near(c.x * p.w, TILTED[i].x, 3), `corner ${i} x: ${c.x * p.w} vs ${TILTED[i].x}`);
    assert.ok(near(c.y * p.h, TILTED[i].y, 3), `corner ${i} y: ${c.y * p.h} vs ${TILTED[i].y}`);
  });
  assert.strictEqual(r.edge, false);
  assert.ok(r.area > 0.3 && r.area < 0.6);
});
test('find the page: white paper on a white counter → not found (set the corners by hand)', () => {
  const p = photo(300, 240, TILTED, { table: 215 });
  assert.strictEqual(cam.findPage(p.lum, p.w, p.h), null);
});
test('find the page: an L-shaped bright patch (glare, a window) is not a page', () => {
  const w = 200, h = 160, lum = new Uint8Array(w * h).fill(40);
  for (let y = 20; y < 140; y++) for (let x = 20; x < 180; x++) if (x < 70 || y > 100) lum[y * w + x] = 230;
  assert.strictEqual(cam.findPage(lum, w, h), null);
});
test('find the page: a page running off the picture is flagged', () => {
  const p = photo(300, 240, [{ x: 0, y: 30 }, { x: 240, y: 30 }, { x: 240, y: 210 }, { x: 0, y: 210 }]);
  const r = cam.findPage(p.lum, p.w, p.h);
  assert.ok(r && r.edge);
});
test('find the page: nothing bright, or too dark → not found', () => {
  assert.strictEqual(cam.findPage(new Uint8Array(200 * 160).fill(10), 200, 160), null);
  const p = photo(300, 240, [{ x: 140, y: 110 }, { x: 160, y: 110 }, { x: 160, y: 130 }, { x: 140, y: 130 }]);
  assert.strictEqual(cam.findPage(p.lum, p.w, p.h), null);   // a scrap, not a page
});

test('corners: crossed-over corners are refused', () => {
  assert.strictEqual(cam.quadOk(TILTED), true);
  assert.strictEqual(cam.quadOk([TILTED[0], TILTED[2], TILTED[1], TILTED[3]]), false);
});

test('straighten: the map sends each corner of the page to a corner of the picture', () => {
  const to = [{ x: 0, y: 0 }, { x: 850, y: 0 }, { x: 850, y: 1100 }, { x: 0, y: 1100 }];
  const m = cam.homography(TILTED, to);
  TILTED.forEach((c, i) => {
    const p = cam.mapPoint(m, c.x, c.y);
    assert.ok(near(p.x, to[i].x, 1e-6) && near(p.y, to[i].y, 1e-6));
  });
});
test('straighten: a page close to letter shape is saved as exactly letter; others keep their shape', () => {
  const s = cam.warpSize([{ x: 0, y: 0 }, { x: 800, y: 30 }, { x: 790, y: 1000 }, { x: 10, y: 1010 }], 2400);
  assert.ok(near(s.w / s.h, 8.5 / 11, 0.002));
  const land = cam.warpSize([{ x: 0, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 830 }, { x: 0, y: 830 }], 2400);
  assert.ok(near(land.w / land.h, 11 / 8.5, 0.002));
  const receipt = cam.warpSize([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 900 }, { x: 0, y: 900 }], 2400);
  assert.ok(near(receipt.w / receipt.h, 1 / 3, 0.002));
  const big = cam.warpSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 5176 }, { x: 0, y: 5176 }], 2400);
  assert.strictEqual(Math.max(big.w, big.h), 2400);
});
test('straighten: the tilted page comes out flat, filling the picture, table cropped away', () => {
  const p = photo(300, 240, TILTED, { ink: true, blueTable: true });
  const s = cam.warpSize(TILTED, 400);
  const out = cam.warp(p.px, p.w, p.h, TILTED, s.w, s.h);
  // no table (blue here) anywhere but the outermost pixels
  let table = 0;
  for (let y = 3; y < s.h - 3; y++) for (let x = 3; x < s.w - 3; x++) {
    const i = (y * s.w + x) * 4;
    if (out[i + 2] - out[i] > 60) table++;
  }
  assert.strictEqual(table, 0);
  // the ink lines are level now: a row through a line is ink from 15% to 85% across
  const row = Math.round(s.h * 0.175);   // middle of the first printed line
  const at = fx => out[(row * s.w + Math.round(s.w * fx)) * 4];
  assert.ok(at(0.3) < 80 && at(0.5) < 80 && at(0.7) < 80, 'ink line runs level');
  assert.ok(at(0.07) > 150 && at(0.93) > 120, 'margins are paper');
});

test('whiten: shaded, yellowed paper turns white; ink stays dark', () => {
  const p = photo(300, 240, TILTED, { ink: true });
  const s = cam.warpSize(TILTED, 400);
  const out = cam.warp(p.px, p.w, p.h, TILTED, s.w, s.h);
  const before = (fx, fy) => { const i = (Math.round(s.h * fy) * s.w + Math.round(s.w * fx)) * 4; return [out[i], out[i + 1], out[i + 2]]; };
  const dim = before(0.92, 0.5);
  assert.ok(dim[0] < 180 && dim[0] - dim[2] > 15, 'starts grey and yellow on the shaded side');
  cam.cleanPage(out, s.w, s.h, 'white');
  for (const [fx, fy] of [[0.07, 0.5], [0.5, 0.07], [0.92, 0.5], [0.92, 0.92]]) {
    const c = before(fx, fy);
    assert.ok(c[0] >= 250 && c[1] >= 250 && c[2] >= 250, `paper is white at ${fx},${fy}: ${c}`);
  }
  const ink = before(0.5, 0.175);
  assert.ok(ink[0] < 60 && ink[1] < 60 && ink[2] < 60, `ink stays dark: ${ink}`);
});
test('whiten: blue pen keeps its colour; black & white makes it black', () => {
  const w = 160, h = 200;
  const mk = () => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, sig = y > 150 && y < 160 && x > 30 && x < 130;
      px[i] = sig ? 40 : 200; px[i + 1] = sig ? 60 : 195; px[i + 2] = sig ? 170 : 175; px[i + 3] = 255;
    }
    return px;
  };
  const i = (155 * w + 80) * 4, j = (60 * w + 80) * 4;
  const white = cam.cleanPage(mk(), w, h, 'white');
  assert.ok(white[i + 2] - white[i] > 100, 'still blue');
  assert.ok(white[j] >= 250 && white[j + 2] >= 250);
  const bw = cam.cleanPage(mk(), w, h, 'bw');
  assert.ok(bw[i] === bw[i + 1] && bw[i + 1] === bw[i + 2] && bw[i] < 30, `black: ${bw[i]}`);
  assert.strictEqual(bw[j], 255);
});

console.log(`\n${passed} passed`);
