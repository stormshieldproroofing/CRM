/* ============================================================
   StormShield CRM — check scan camera
   ------------------------------------------------------------
   A bank-app style camera for checks: a check-shaped frame with
   the rest of the picture dimmed, front then back, a review step,
   and each photo cropped to the frame before it's saved.

   crmCheckCam.open({ onDone({ front, back }), onUpload(), onFallback() })
     onDone     — the cropped photos as Files (back is null if skipped)
     onUpload   — the person tapped Upload (pick files from the phone)
     onFallback — the live camera isn't available; use the phone camera

   The frame / crop math is plain functions so it can be tested in Node.
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmCheckCam = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  // A personal / business check is about 6" × 2.75".
  const CHECK_RATIO = 6 / 2.75;
  const PAD = 0.04;          // keep a little table around the check so no edge is cut
  const OUT_MAX = 2000;      // longest side of a saved photo, px

  // Where the frame sits on a screen W × H (CSS px).
  // minY: the frame starts below this (the top bar + room for the status chip).
  function frameRect(W, H, minY) {
    const w = Math.max(160, Math.min(W - 36, 640, H * 0.5 * CHECK_RATIO));
    const h = w / CHECK_RATIO;
    const x = (W - w) / 2;
    const y = Math.max(minY == null ? 176 : minY, H * 0.44 - h / 2);
    return { x, y, w, h };
  }

  // The part of the camera picture (vw × vh) that shows inside the frame,
  // when the picture fills a W × H screen like CSS object-fit: cover.
  function cropRect(W, H, vw, vh, frame, pad) {
    pad = pad == null ? PAD : pad;
    const scale = Math.max(W / vw, H / vh);
    const ox = (W - vw * scale) / 2, oy = (H - vh * scale) / 2;
    const p = frame.w * pad;
    let sx = (frame.x - p - ox) / scale, sy = (frame.y - p - oy) / scale;
    let ex = (frame.x + frame.w + p - ox) / scale, ey = (frame.y + frame.h + p - oy) / scale;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    ex = Math.min(vw, ex); ey = Math.min(vh, ey);
    return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(ex - sx), sh: Math.round(ey - sy) };
  }

  // Output size for a crop, capped at OUT_MAX on the long side.
  function outSize(sw, sh, max) {
    max = max || OUT_MAX;
    const k = Math.min(1, max / Math.max(sw, sh));
    return { w: Math.round(sw * k), h: Math.round(sh * k) };
  }

  const hasDOM = typeof document !== 'undefined';
  function supported() {
    return hasDOM && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  const ICON = {
    x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    img: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function injectCss() {
    if (document.getElementById('sschkCss')) return;
    const s = document.createElement('style');
    s.id = 'sschkCss';
    s.textContent = `
.sschk{position:fixed;inset:0;z-index:100000;background:#1C1B19;color:#E8ECF3;font-family:Inter,system-ui,-apple-system,sans-serif;touch-action:manipulation;-webkit-user-select:none;user-select:none;overflow:hidden}
.sschk video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
.sschk-frame{position:absolute;border-radius:14px;box-shadow:0 0 0 2000px rgba(6,8,12,.72);transition:box-shadow .2s}
.sschk-c{position:absolute;width:34px;height:34px;border:0 solid #fff;box-sizing:border-box}
.sschk-c.tl{left:0;top:0;border-left-width:4px;border-top-width:4px;border-top-left-radius:14px}
.sschk-c.tr{right:0;top:0;border-right-width:4px;border-top-width:4px;border-top-right-radius:14px}
.sschk-c.bl{left:0;bottom:0;border-left-width:4px;border-bottom-width:4px;border-bottom-left-radius:14px}
.sschk-c.br{right:0;bottom:0;border-right-width:4px;border-bottom-width:4px;border-bottom-right-radius:14px}
.sschk-top{position:absolute;left:0;right:0;top:0;padding:calc(10px + env(safe-area-inset-top)) 12px 0;display:flex;flex-direction:column;gap:14px}
.sschk-bar{display:flex;align-items:center;justify-content:space-between}
.sschk-title{font-size:17px;font-weight:700}
.sschk-ib{width:44px;height:44px;border-radius:22px;border:0;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
.sschk-ib[aria-pressed="true"]{background:#F2C46B;color:#1C1B19}
.sschk-ib[hidden]{display:flex;visibility:hidden}
.sschk-steps{align-self:center;display:flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.1)}
.sschk-step{padding:7px 16px;border-radius:999px;color:#C4CBD8;font-size:13px;font-weight:600;display:flex;align-items:center;gap:5px}
.sschk-step.on{background:#2F6FEB;color:#fff}
.sschk-step.done{color:#6EE7B7}
.sschk-saved{position:absolute;left:16px;bottom:calc(128px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:10px;padding:6px 12px 6px 6px;border-radius:12px;background:rgba(22,27,36,.92);border:1px solid #252B38;font-size:12px;font-weight:600}
.sschk-saved img{width:58px;height:27px;object-fit:cover;border-radius:3px}
.sschk-chip[hidden]{display:none}.sschk-saved[hidden]{display:none}.sschk-tips[hidden]{display:none}.sschk-msg[hidden]{display:none}.sschk-review img[hidden],.sschk-none[hidden]{display:none}
.sschk-chip{position:absolute;left:0;right:0;display:flex;justify-content:center;pointer-events:none}
.sschk-chip span{padding:8px 14px;border-radius:999px;background:rgba(22,27,36,.9);border:1px solid rgba(255,255,255,.18);font-size:13px;font-weight:600}
.sschk-tips{position:absolute;left:0;right:0;padding:0 36px;text-align:center;display:flex;flex-direction:column;gap:8px}
.sschk-tips b{font-size:15px;font-weight:600}
.sschk-tips span{font-size:13px;line-height:1.45;color:#A9B1C1}
.sschk-bottom{position:absolute;left:0;right:0;bottom:0;padding:0 28px calc(28px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:center}
.sschk-side{min-width:56px;min-height:56px;border:0;background:transparent;color:#C4CBD8;font:600 12px Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer}
.sschk-side.l{justify-self:start}.sschk-side.r{justify-self:end}
.sschk-shutter{justify-self:center;width:76px;height:76px;border-radius:38px;border:4px solid #fff;background:transparent;padding:4px;cursor:pointer}
.sschk-shutter::after{content:"";display:block;width:100%;height:100%;border-radius:50%;background:#fff}
.sschk-shutter:active::after{background:#C4CBD8}
.sschk-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .15s}
.sschk-flash.on{opacity:.8;transition:none}
.sschk-msg{position:absolute;left:24px;right:24px;top:40%;transform:translateY(-50%);text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center;font-size:15px;line-height:1.45}
.sschk-btn{min-height:50px;padding:0 22px;border:0;border-radius:12px;background:#2F6FEB;color:#fff;font:700 15px Inter,system-ui,sans-serif;cursor:pointer}
.sschk-review{position:absolute;inset:0;background:#0A0D13;display:flex;flex-direction:column;gap:16px;padding:calc(10px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));overflow:auto;box-sizing:border-box}
.sschk-review[hidden]{display:none}
.sschk-rlbl{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8B94A7}
.sschk-link{min-height:40px;padding:0 10px;border:0;background:transparent;color:#8FB4FF;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;text-transform:none;letter-spacing:0}
.sschk-review img{width:100%;max-height:220px;object-fit:contain;border-radius:12px;background:#161B24;display:block}
.sschk-none{height:90px;border-radius:12px;border:1px dashed #3A4150;display:flex;align-items:center;justify-content:center;color:#8B94A7;font-size:13px}
@media(min-width:761px){.sschk-review{max-width:520px;margin:0 auto;border-left:1px solid #252B38;border-right:1px solid #252B38}}`;
    document.head.appendChild(s);
  }

  function open(opts) {
    opts = opts || {};
    if (!supported()) { if (opts.onFallback) opts.onFallback(); return; }
    injectCss();

    const wrap = document.createElement('div');
    wrap.className = 'sschk';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Scan check');
    wrap.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="sschk-frame"><i class="sschk-c tl"></i><i class="sschk-c tr"></i><i class="sschk-c bl"></i><i class="sschk-c br"></i></div>
      <div class="sschk-flash"></div>
      <div class="sschk-top">
        <div class="sschk-bar">
          <button type="button" class="sschk-ib" data-act="close" aria-label="Close">${ICON.x}</button>
          <div class="sschk-title">Scan check</div>
          <button type="button" class="sschk-ib" data-act="torch" aria-label="Flash" aria-pressed="false" hidden>${ICON.bolt}</button>
        </div>
        <div class="sschk-steps"><div class="sschk-step" data-step="front">Front</div><div class="sschk-step" data-step="back">Back</div></div>
      </div>
      <div class="sschk-saved" hidden><img alt="Front of check"><div>Front saved</div></div>
      <div class="sschk-chip"><span>Line up the check inside the frame</span></div>
      <div class="sschk-tips"><b></b><span></span></div>
      <div class="sschk-msg" hidden></div>
      <div class="sschk-bottom">
        <button type="button" class="sschk-side l" data-act="left"></button>
        <button type="button" class="sschk-shutter" data-act="shoot" aria-label="Take photo"></button>
        <span></span>
      </div>
      <div class="sschk-review" hidden>
        <div class="sschk-bar"><span style="width:44px"></span><div class="sschk-title">Check photos</div><button type="button" class="sschk-ib" data-act="close" aria-label="Close">${ICON.x}</button></div>
        <div><div class="sschk-rlbl">Front<button type="button" class="sschk-link" data-act="retake-front">Retake</button></div><img data-r="front" alt="Front of check"></div>
        <div><div class="sschk-rlbl">Back<button type="button" class="sschk-link" data-act="retake-back">Retake</button></div><img data-r="back" alt="Back of check"><div class="sschk-none" data-r="noback">Back skipped</div></div>
        <div style="flex:1"></div>
        <button type="button" class="sschk-btn" data-act="use">Use these photos</button>
      </div>`;
    document.body.appendChild(wrap);

    const $ = s => wrap.querySelector(s);
    const video = $('video'), frameEl = $('.sschk-frame'), review = $('.sschk-review');
    const shots = { front: null, back: null }, urls = { front: null, back: null };
    let step = 'front', stream = null, track = null, closed = false, busy = false, frame = null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function layout() {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      frame = frameRect(W, H, $('.sschk-top').getBoundingClientRect().bottom + 70);
      Object.assign(frameEl.style, { left: frame.x + 'px', top: frame.y + 'px', width: frame.w + 'px', height: frame.h + 'px' });
      $('.sschk-chip').style.top = (frame.y - 52) + 'px';
      $('.sschk-tips').style.top = (frame.y + frame.h + 24) + 'px';
    }

    function paint() {
      wrap.querySelectorAll('.sschk-step').forEach(el => {
        const s = el.dataset.step;
        el.classList.toggle('on', s === step);
        el.classList.toggle('done', s !== step && !!shots[s]);
        el.innerHTML = (s !== step && shots[s] ? ICON.ok : '') + (s === 'front' ? 'Front' : 'Back');
      });
      const front = step === 'front';
      $('.sschk-tips b').textContent = front ? 'Fit the front of the check in the frame' : 'Now flip it over \u2014 back of the check';
      $('.sschk-tips span').textContent = front
        ? 'Lay it flat on a dark surface, in good light with no shadows. Get all 4 corners inside the frame.'
        : 'Make sure every payee has signed the endorsement. Tap Skip if it isn\'t endorsed yet.';
      $('[data-act="left"]').innerHTML = front ? ICON.img + 'Upload' : 'Skip';
      const saved = $('.sschk-saved');
      saved.hidden = front || !urls.front;
      if (!saved.hidden) saved.querySelector('img').src = urls.front;
    }

    function stopStream() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; track = null;
    }
    function close() {
      if (closed) return;
      closed = true;
      stopStream();
      Object.values(urls).forEach(u => u && URL.revokeObjectURL(u));
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('resize', layout);
      document.removeEventListener('visibilitychange', onVis);
      wrap.remove();
    }
    function onVis() {
      if (document.hidden) stopStream();
      else if (!closed && !stream && review.hidden) start();
    }

    function showMsg(text) {
      const m = $('.sschk-msg');
      m.hidden = false;
      m.innerHTML = '';
      const t = document.createElement('div'); t.textContent = text; m.appendChild(t);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sschk-btn'; b.dataset.act = 'fallback'; b.textContent = 'Use phone camera'; m.appendChild(b);
      $('.sschk-bottom').style.visibility = 'hidden';
      frameEl.style.display = 'none';
      $('.sschk-chip').hidden = true; $('.sschk-tips').hidden = true;
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        });
        if (closed) { stopStream(); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        track = stream.getVideoTracks()[0] || null;
        let canTorch = false;
        try { canTorch = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch (e) {}
        $('[data-act="torch"]').hidden = !canTorch;
      } catch (e) {
        console.warn('[checkcam] camera unavailable', e);
        showMsg(e && e.name === 'NotAllowedError'
          ? 'Camera access is turned off for the CRM. Allow it in your phone\'s settings, or use the phone camera instead.'
          : 'The live camera isn\'t available on this device.');
      }
    }

    function grab() {
      const vw = video.videoWidth, vh = video.videoHeight;
      const c = cropRect(wrap.clientWidth, wrap.clientHeight, vw, vh, frame);
      const o = outSize(c.sw, c.sh);
      const cv = document.createElement('canvas');
      cv.width = o.w; cv.height = o.h;
      cv.getContext('2d').drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, o.w, o.h);
      return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Could not save the photo')), 'image/jpeg', 0.9));
    }

    function showReview() {
      ['front', 'back'].forEach(s => {
        const img = review.querySelector(`img[data-r="${s}"]`);
        img.hidden = !urls[s];
        if (urls[s]) img.src = urls[s];
      });
      review.querySelector('[data-r="noback"]').hidden = !!urls.back;
      review.hidden = false;
      stopStream();
    }

    function next() {
      if (step === 'front' && !shots.back) { step = 'back'; paint(); }
      else showReview();
    }

    async function shoot() {
      if (busy || !stream || !video.videoWidth) return;
      busy = true;
      const fl = $('.sschk-flash');
      fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
      try {
        const blob = await grab();
        shots[step] = blob;
        if (urls[step]) URL.revokeObjectURL(urls[step]);
        urls[step] = URL.createObjectURL(blob);
        next();
      } catch (e) {
        if (root.toast) root.toast('Couldn\'t take that photo — try again');
      }
      busy = false;
    }

    function retake(s) {
      step = s;
      review.hidden = true;
      paint();
      start();
    }

    wrap.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'shoot') shoot();
      else if (act === 'close') close();
      else if (act === 'left') {
        if (step === 'front') { close(); if (opts.onUpload) opts.onUpload(); }
        else { shots.back = null; if (urls.back) URL.revokeObjectURL(urls.back); urls.back = null; showReview(); }
      }
      else if (act === 'torch' && track) {
        const on = b.getAttribute('aria-pressed') !== 'true';
        track.applyConstraints({ advanced: [{ torch: on }] }).then(() => b.setAttribute('aria-pressed', String(on))).catch(() => {});
      }
      else if (act === 'retake-front') retake('front');
      else if (act === 'retake-back') retake('back');
      else if (act === 'use') {
        const stamp = Date.now();
        const front = shots.front ? new File([shots.front], `check-front-${stamp}.jpg`, { type: 'image/jpeg' }) : null;
        const back = shots.back ? new File([shots.back], `check-back-${stamp}.jpg`, { type: 'image/jpeg' }) : null;
        close();
        if (opts.onDone) opts.onDone({ front, back });
      }
      else if (act === 'fallback') { close(); if (opts.onFallback) opts.onFallback(); }
    });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      else if ((e.key === ' ' || e.key === 'Enter') && review.hidden && e.target === wrap) { e.preventDefault(); shoot(); }
    });
    wrap.tabIndex = -1;
    wrap.focus();
    window.addEventListener('resize', layout);
    document.addEventListener('visibilitychange', onVis);
    layout();
    paint();
    start();
    return { close };
  }

  return { CHECK_RATIO, frameRect, cropRect, outSize, supported, open };
});
