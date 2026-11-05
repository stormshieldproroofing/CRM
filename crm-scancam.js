/* ============================================================
   StormShield CRM — scan camera (checks + documents)
   ------------------------------------------------------------
   A bank-app style camera: a frame shaped like what you're scanning,
   the rest of the picture dimmed, a review step, and every photo
   cropped to the frame before it's saved.

   Check mode — front, then back (Skip if not endorsed).
     Upright phone: the frame is tall and the check goes in SIDEWAYS
     (top edge to the right), so the check runs along the long side of
     the camera picture — about twice the detail of a short, wide frame.
     The photo is turned upright before it's saved.
     Phone turned sideways: a wide frame, no turning needed.
   Document mode — letter-size frame, as many pages as you like.
     Two or more pages are saved as one PDF.

   crmScanCam.open({
     mode: 'check' | 'doc', title,
     onDone(result)   check: { front, back }   doc: { files }   (Files)
     onUpload()       Upload tapped — pick files from the phone
     onFallback()     live camera not available — use the phone camera
   })

   The layout / crop math is plain functions so it can be tested in Node.
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmScanCam = api;
  root.crmCheckCam = api;   // older name
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const CHECK_RATIO = 6 / 2.75;   // a check is about 6" × 2.75"
  const DOC_RATIO = 8.5 / 11;     // letter page, width / height
  const PAD = 0.03;               // a little table around the edges so nothing is cut
  const OUT_MAX = 2400;           // longest side of a saved photo, px
  const OUT_Q = 0.88;

  // Frame shape (width / height) for a mode and screen orientation.
  // Upright phone + check = tall frame: the check lies sideways in it.
  function frameRatio(mode, landscape) {
    if (mode === 'doc') return DOC_RATIO;
    return landscape ? CHECK_RATIO : 1 / CHECK_RATIO;
  }

  // The largest rect of the given width/height ratio that fits in area, centered.
  function fitFrame(area, ratio) {
    const aw = Math.max(1, area.right - area.left), ah = Math.max(1, area.bottom - area.top);
    let w = aw, h = w / ratio;
    if (h > ah) { h = ah; w = h * ratio; }
    return { x: area.left + (aw - w) / 2, y: area.top + (ah - h) / 2, w, h };
  }

  // The part of the camera picture (vw × vh) that shows inside the frame,
  // when the picture fills a W × H screen like CSS object-fit: cover.
  function cropRect(W, H, vw, vh, frame, pad) {
    pad = pad == null ? PAD : pad;
    const scale = Math.max(W / vw, H / vh);
    const ox = (W - vw * scale) / 2, oy = (H - vh * scale) / 2;
    const p = Math.max(frame.w, frame.h) * pad;
    let sx = (frame.x - p - ox) / scale, sy = (frame.y - p - oy) / scale;
    let ex = (frame.x + frame.w + p - ox) / scale, ey = (frame.y + frame.h + p - oy) / scale;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    ex = Math.min(vw, ex); ey = Math.min(vh, ey);
    return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(ex - sx), sh: Math.round(ey - sy) };
  }

  // Saved size for a crop: capped at OUT_MAX on the long side; turned
  // a quarter-turn (width and height swap) when the check was in sideways.
  function outSize(sw, sh, turn, max) {
    max = max || OUT_MAX;
    const k = Math.min(1, max / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    return turn ? { w: h, h: w } : { w, h };
  }

  const hasDOM = typeof document !== 'undefined';
  function supported() {
    return hasDOM && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  const ICON = {
    x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    img: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  };

  function injectCss() {
    if (document.getElementById('sscamCss')) return;
    const s = document.createElement('style');
    s.id = 'sscamCss';
    s.textContent = `
.sscam{position:fixed;inset:0;z-index:100000;background:#1C1B19;color:#E8ECF3;font-family:Inter,system-ui,-apple-system,sans-serif;touch-action:manipulation;-webkit-user-select:none;user-select:none;overflow:hidden}
.sscam [hidden]{display:none!important}
.sscam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
.sscam-frame{position:absolute;border-radius:12px;box-shadow:0 0 0 3000px rgba(6,8,12,.72)}
.sscam-c{position:absolute;width:30px;height:30px;border:0 solid #fff;box-sizing:border-box}
.sscam-c.tl{left:0;top:0;border-left-width:4px;border-top-width:4px;border-top-left-radius:12px}
.sscam-c.tr{right:0;top:0;border-right-width:4px;border-top-width:4px;border-top-right-radius:12px}
.sscam-c.bl{left:0;bottom:0;border-left-width:4px;border-bottom-width:4px;border-bottom-left-radius:12px}
.sscam-c.br{right:0;bottom:0;border-right-width:4px;border-bottom-width:4px;border-bottom-right-radius:12px}
.sscam-guide{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:6px;white-space:nowrap;padding:6px 10px;border-radius:999px;background:rgba(14,18,25,.75);font-size:12px;font-weight:600;color:#C4CBD8;pointer-events:none}
.sscam-top{position:absolute;left:0;right:0;top:0;padding:calc(8px + env(safe-area-inset-top)) 12px 0;display:flex;align-items:center;justify-content:space-between}
.sscam-title{font-size:17px;font-weight:700}
.sscam-ib{width:44px;height:44px;border-radius:22px;border:0;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.sscam-ib[aria-pressed="true"]{background:#F2C46B;color:#1C1B19}
.sscam-ib.ghost{visibility:hidden}
.sscam-pill{position:absolute;display:flex;gap:4px;padding:4px;border-radius:999px;background:rgba(22,27,36,.85);transform:translateX(-50%)}
.sscam-step{padding:7px 16px;border-radius:999px;color:#C4CBD8;font-size:13px;font-weight:600;display:flex;align-items:center;gap:5px}
.sscam-step.on{background:#2F6FEB;color:#fff}
.sscam-step.done{color:#6EE7B7}
.sscam-tips{position:absolute;text-align:center;display:flex;flex-direction:column;gap:4px;transform:translateX(-50%)}
.sscam-tips b{font-size:15px;font-weight:600}
.sscam-tips span{font-size:13px;line-height:1.4;color:#A9B1C1}
.sscam-ctrl{position:absolute;display:grid;align-items:center}
.sscam-side{min-width:60px;min-height:56px;border:0;background:transparent;color:#C4CBD8;font:600 12px Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;padding:0}
.sscam-done{min-width:72px;min-height:48px;padding:0 14px;border:0;border-radius:24px;background:#2F6FEB;color:#fff;font:700 14px Inter,system-ui,sans-serif;cursor:pointer}
.sscam-thumb{width:56px;height:44px;border-radius:6px;border:2px solid #fff;background:#333 center/cover no-repeat;padding:0;cursor:pointer;position:relative}
.sscam-thumb span{position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;border-radius:10px;background:#2F6FEB;color:#fff;font:700 11px/20px Inter,system-ui,sans-serif;text-align:center}
.sscam-shutter{width:76px;height:76px;border-radius:38px;border:4px solid #fff;background:transparent;padding:4px;cursor:pointer}
.sscam-shutter::after{content:"";display:block;width:100%;height:100%;border-radius:50%;background:#fff}
.sscam-shutter:active::after{background:#C4CBD8}
.sscam-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .15s}
.sscam-flash.on{opacity:.8;transition:none}
.sscam-toast{position:absolute;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(13,41,24,.95);border:1px solid rgba(52,211,153,.4);color:#6EE7B7;font-size:13px;font-weight:600;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s}
.sscam-toast.on{opacity:1}
.sscam-msg{position:absolute;left:24px;right:24px;top:40%;transform:translateY(-50%);text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center;font-size:15px;line-height:1.45}
.sscam-btn{min-height:50px;padding:0 22px;border:0;border-radius:12px;background:#2F6FEB;color:#fff;font:700 15px Inter,system-ui,sans-serif;cursor:pointer}
.sscam-btn.sec{background:#1A1F29;color:#E8ECF3;border:1px solid #252B38}
.sscam-review{position:absolute;inset:0;background:#0A0D13;display:flex;flex-direction:column;gap:16px;padding:calc(8px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));overflow:auto;box-sizing:border-box}
.sscam-rbar{display:flex;align-items:center;justify-content:space-between}
.sscam-rlbl{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8B94A7;gap:4px}
.sscam-rlbl div{display:flex}
.sscam-link{min-height:40px;padding:0 10px;border:0;background:transparent;color:#8FB4FF;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;text-transform:none;letter-spacing:0}
.sscam-link.red{color:#FCA5A5}
.sscam-review img{width:100%;max-height:240px;object-fit:contain;border-radius:12px;background:#161B24;display:block}
.sscam-pages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.sscam-pages img{max-height:none;aspect-ratio:8.5/11;object-fit:cover}
.sscam-pages .sscam-rlbl{white-space:nowrap}.sscam-pages .sscam-link{padding:0 6px}
.sscam-none{height:90px;border-radius:12px;border:1px dashed #3A4150;display:flex;align-items:center;justify-content:center;color:#8B94A7;font-size:13px}
.sscam-note{font-size:12px;color:#8B94A7;text-align:center}
@media(min-width:761px){.sscam-review{max-width:560px;margin:0 auto;border-left:1px solid #252B38;border-right:1px solid #252B38}}`;
    document.head.appendChild(s);
  }

  function open(opts) {
    opts = opts || {};
    const mode = opts.mode === 'doc' ? 'doc' : 'check';
    if (!supported()) { if (opts.onFallback) opts.onFallback(); return; }
    injectCss();

    const wrap = document.createElement('div');
    wrap.className = 'sscam';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', opts.title || (mode === 'doc' ? 'Scan document' : 'Scan check'));
    wrap.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="sscam-frame"><i class="sscam-c tl"></i><i class="sscam-c tr"></i><i class="sscam-c bl"></i><i class="sscam-c br"></i><div class="sscam-guide" hidden>Top of check ${ICON.arrow}</div></div>
      <div class="sscam-flash"></div>
      <div class="sscam-top">
        <button type="button" class="sscam-ib" data-act="close" aria-label="Close">${ICON.x}</button>
        <div class="sscam-title"></div>
        <button type="button" class="sscam-ib ghost" data-act="torch" aria-label="Flash" aria-pressed="false">${ICON.bolt}</button>
      </div>
      <div class="sscam-pill"></div>
      <div class="sscam-toast"></div>
      <div class="sscam-tips"><b></b><span></span></div>
      <div class="sscam-msg" hidden></div>
      <div class="sscam-ctrl">
        <button type="button" class="sscam-side" data-act="left"></button>
        <button type="button" class="sscam-shutter" data-act="shoot" aria-label="Take photo"></button>
        <div class="sscam-right" style="display:flex;justify-content:center"></div>
      </div>
      <div class="sscam-review" hidden></div>`;
    document.body.appendChild(wrap);

    const $ = s => wrap.querySelector(s);
    const video = $('video'), frameEl = $('.sscam-frame'), review = $('.sscam-review');
    const pill = $('.sscam-pill'), tips = $('.sscam-tips'), ctrl = $('.sscam-ctrl'), top = $('.sscam-top');
    $('.sscam-title').textContent = opts.title || (mode === 'doc' ? 'Scan document' : 'Scan check');

    // check: shots.front / shots.back = { blob, url }; doc: pages = [{ blob, url }]
    const shots = { front: null, back: null };
    const pages = [];
    let step = 'front', retakeAt = -1;
    let stream = null, track = null, closed = false, busy = false;
    let frame = null, land = false, turn = false;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function layout() {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      land = W > H;
      turn = mode === 'check' && !land;
      wrap.classList.toggle('land', land);
      paint();   // fill the labels first so they're measured at their real size
      let area;
      if (!land) {
        Object.assign(top.style, { flexDirection: 'row', left: '0', right: '0', width: '', alignItems: 'center', gap: '', paddingLeft: '' });
        $('.sscam-title').hidden = false;
        Object.assign(ctrl.style, { left: '0', right: '0', top: '', bottom: '0', width: '', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gridTemplateRows: '', padding: '0 24px calc(22px + env(safe-area-inset-bottom))', justifyItems: 'center' });
        const topB = top.getBoundingClientRect().bottom;
        pill.style.top = (topB + 10) + 'px';
        pill.style.left = (W / 2) + 'px';
        const ctrlT = ctrl.getBoundingClientRect().top;
        tips.style.left = (W / 2) + 'px';
        tips.style.width = Math.min(W - 40, 420) + 'px';
        tips.style.top = '';
        tips.style.bottom = (H - ctrlT + 10) + 'px';
        const tipsT = tips.getBoundingClientRect().top;
        area = { left: 16, right: W - 16, top: pill.getBoundingClientRect().bottom + 12, bottom: tipsT - 12 };
      } else {
        Object.assign(top.style, { flexDirection: 'column', left: '0', right: 'auto', width: 'auto', alignItems: 'flex-start', gap: '10px' });
        top.style.paddingLeft = 'calc(10px + env(safe-area-inset-left))';
        $('.sscam-title').hidden = true;
        Object.assign(ctrl.style, { left: '', right: '0', top: '0', bottom: '0', width: '112px', gridTemplateColumns: '1fr', gridTemplateRows: 'repeat(3,minmax(0,1fr))', padding: '8px calc(14px + env(safe-area-inset-right)) 8px 0', justifyItems: 'center' });
        // shutter in the middle row: right control on top, Upload/Skip at the bottom
        const lb = $('[data-act="left"]'), rb = $('.sscam-right');
        lb.style.gridRow = '3'; rb.style.gridRow = '1'; $('.sscam-shutter').style.gridRow = '2';
        const left = top.getBoundingClientRect().right + 12;
        const right = ctrl.getBoundingClientRect().left - 8;
        const cx = (left + right) / 2;
        pill.style.top = 'calc(8px + env(safe-area-inset-top))';
        pill.style.left = cx + 'px';
        tips.style.left = cx + 'px';
        tips.style.width = (right - left) + 'px';
        tips.style.top = '';
        tips.style.bottom = 'calc(6px + env(safe-area-inset-bottom))';
        area = { left, right, top: pill.getBoundingClientRect().bottom + 8, bottom: tips.getBoundingClientRect().top - 8 };
      }
      if (!land) { $('[data-act="left"]').style.gridRow = ''; $('.sscam-right').style.gridRow = ''; $('.sscam-shutter').style.gridRow = ''; }
      frame = fitFrame(area, frameRatio(mode, land));
      Object.assign(frameEl.style, { left: frame.x + 'px', top: frame.y + 'px', width: frame.w + 'px', height: frame.h + 'px' });
      $('.sscam-guide').hidden = !turn;
      $('.sscam-toast').style.top = (frame.y + 12) + 'px';
    }

    function paint() {
      if (mode === 'check') {
        pill.innerHTML = ['front', 'back'].map(s => {
          const cls = s === step ? 'on' : (shots[s] ? 'done' : '');
          return `<div class="sscam-step ${cls}">${s !== step && shots[s] ? ICON.ok : ''}${s === 'front' ? 'Front' : 'Back'}</div>`;
        }).join('');
        const front = step === 'front';
        tips.querySelector('b').textContent = front ? 'Front of the check' : 'Now the back of the check';
        tips.querySelector('span').textContent = turn
          ? 'Turn the check sideways, top edge to the right. Fill the frame, flat, good light.'
          : (front ? 'Fill the frame with the check — flat, good light, all 4 corners in.' : 'Make sure it\'s endorsed. Tap Skip if it isn\'t yet.');
        $('[data-act="left"]').innerHTML = front ? ICON.img + 'Upload' : 'Skip';
        const r = $('.sscam-right');
        r.innerHTML = '';
        if (!front && shots.front) {
          const t = document.createElement('div');
          t.className = 'sscam-thumb'; t.style.backgroundImage = `url("${shots.front.url}")`; t.setAttribute('aria-label', 'Front saved');
          r.appendChild(t);
        }
      } else {
        const n = pages.length;
        pill.innerHTML = `<div class="sscam-step on">${retakeAt >= 0 ? 'Retake page ' + (retakeAt + 1) : 'Page ' + (n + 1)}</div>`;
        tips.querySelector('b').textContent = n ? 'Next page' : 'Fit the page in the frame';
        tips.querySelector('span').textContent = 'Lay it flat in good light. Tap Done when every page is in.';
        $('[data-act="left"]').innerHTML = ICON.img + 'Upload';
        const r = $('.sscam-right');
        r.innerHTML = n ? `<button type="button" class="sscam-done" data-act="review">Done (${n})</button>` : '';
      }
    }

    function stopStream() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; track = null;
    }
    function revokeAll() {
      [shots.front, shots.back, ...pages].forEach(s => s && s.url && URL.revokeObjectURL(s.url));
    }
    function close() {
      if (closed) return;
      closed = true;
      stopStream();
      revokeAll();
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      wrap.remove();
    }
    let rt = null;
    function onResize() { clearTimeout(rt); rt = setTimeout(layout, 120); }
    function onVis() {
      if (document.hidden) stopStream();
      else if (!closed && !stream && review.hidden) start();
    }

    function toast(text) {
      const t = $('.sscam-toast');
      t.textContent = text; t.classList.add('on');
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1300);
    }

    function showMsg(text) {
      const m = $('.sscam-msg');
      m.hidden = false;
      m.innerHTML = '';
      const t = document.createElement('div'); t.textContent = text; m.appendChild(t);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sscam-btn'; b.dataset.act = 'fallback'; b.textContent = 'Use phone camera'; m.appendChild(b);
      [ctrl, frameEl, pill, tips].forEach(el => { el.hidden = true; });
    }

    async function start() {
      try {
        // Ask for the sharpest picture the phone will give (4K where supported).
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (closed) { stopStream(); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        track = stream.getVideoTracks()[0] || null;
        try {
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          // Continuous focus keeps small print sharp at close range.
          if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          $('[data-act="torch"]').classList.toggle('ghost', !caps.torch);
        } catch (e) {}
      } catch (e) {
        console.warn('[scancam] camera unavailable', e);
        showMsg(e && e.name === 'NotAllowedError'
          ? 'Camera access is turned off for the CRM. Allow it in your phone\'s settings, or use the phone camera instead.'
          : 'The live camera isn\'t available on this device.');
      }
    }

    function toBlob(cv) {
      return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Could not save the photo')), 'image/jpeg', OUT_Q));
    }

    // Crop the frame out of the camera picture; turn a sideways check upright.
    function grab() {
      const vw = video.videoWidth, vh = video.videoHeight;
      const c = cropRect(wrap.clientWidth, wrap.clientHeight, vw, vh, frame);
      const o = outSize(c.sw, c.sh, turn);
      const cv = document.createElement('canvas');
      cv.width = o.w; cv.height = o.h;
      const ctx = cv.getContext('2d');
      if (turn) {
        // Top of the check faced the right of the screen: a quarter-turn left makes it upright.
        ctx.translate(0, o.h);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, o.h, o.w);
      } else {
        ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, o.w, o.h);
      }
      return toBlob(cv);
    }

    // Turn a saved photo upside down (check put in the other way round).
    async function flip(shot) {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = shot.url; });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.translate(cv.width, cv.height); ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0);
      const blob = await toBlob(cv);
      URL.revokeObjectURL(shot.url);
      shot.blob = blob; shot.url = URL.createObjectURL(blob);
    }

    function shotBlock(label, shot, act, extra) {
      return `<div><div class="sscam-rlbl">${label}<div>${shot ? `<button type="button" class="sscam-link" data-act="flip-${act}">Flip</button>` : ''}<button type="button" class="sscam-link" data-act="retake-${act}">${shot ? 'Retake' : 'Take'}</button>${extra || ''}</div></div>
        ${shot ? `<img src="${shot.url}" alt="${label}">` : `<div class="sscam-none">${label} skipped</div>`}</div>`;
    }

    function showReview() {
      stopStream();
      if (mode === 'check') {
        review.innerHTML = `
          <div class="sscam-rbar"><span style="width:44px"></span><div class="sscam-title">Check photos</div><button type="button" class="sscam-ib" data-act="close" aria-label="Close">${ICON.x}</button></div>
          ${shotBlock('Front', shots.front, 'front')}
          ${shotBlock('Back', shots.back, 'back')}
          <div class="sscam-note">Upside down? Tap Flip.</div>
          <div style="flex:1"></div>
          <button type="button" class="sscam-btn" data-act="use">Use these photos</button>`;
      } else {
        const n = pages.length;
        review.innerHTML = `
          <div class="sscam-rbar"><span style="width:44px"></span><div class="sscam-title">${n} page${n === 1 ? '' : 's'}</div><button type="button" class="sscam-ib" data-act="close" aria-label="Close">${ICON.x}</button></div>
          <div class="sscam-pages">${pages.map((p, i) => `<div><div class="sscam-rlbl">Page ${i + 1}<div><button type="button" class="sscam-link" data-act="retake-p" data-i="${i}">Retake</button><button type="button" class="sscam-link red" data-act="remove-p" data-i="${i}">Remove</button></div></div><img src="${p.url}" alt="Page ${i + 1}"></div>`).join('')}</div>
          <button type="button" class="sscam-btn sec" data-act="add-page">+ Add a page</button>
          ${n > 1 && root.PDFLib ? '<div class="sscam-note">Saved together as one PDF.</div>' : ''}
          <div style="flex:1"></div>
          <button type="button" class="sscam-btn" data-act="use"${n ? '' : ' disabled'}>Save ${n} page${n === 1 ? '' : 's'}</button>`;
      }
      review.hidden = false;
    }

    function backToCamera() {
      review.hidden = true;
      layout();
      start();
    }

    async function shoot() {
      if (busy || !stream || !video.videoWidth) return;
      busy = true;
      const fl = $('.sscam-flash');
      fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
      try {
        const blob = await grab();
        const shot = { blob, url: URL.createObjectURL(blob) };
        if (mode === 'check') {
          if (shots[step]) URL.revokeObjectURL(shots[step].url);
          shots[step] = shot;
          if (step === 'front' && !shots.back) { step = 'back'; paint(); toast('Front saved — now flip it over'); }
          else showReview();
        } else if (retakeAt >= 0) {
          URL.revokeObjectURL(pages[retakeAt].url);
          pages[retakeAt] = shot; retakeAt = -1;
          showReview();
        } else {
          pages.push(shot);
          paint();
          toast(`Page ${pages.length} saved`);
        }
      } catch (e) {
        if (root.toast) root.toast('Couldn\'t take that photo — try again');
      }
      busy = false;
    }

    async function finish() {
      const stamp = Date.now();
      const file = (blob, name, type) => new File([blob], name, { type: type || 'image/jpeg' });
      if (mode === 'check') {
        const front = shots.front ? file(shots.front.blob, `check-front-${stamp}.jpg`) : null;
        const back = shots.back ? file(shots.back.blob, `check-back-${stamp}.jpg`) : null;
        close();
        if (opts.onDone) opts.onDone({ front, back });
        return;
      }
      let files = pages.map((p, i) => file(p.blob, `scan-${stamp}-${i + 1}.jpg`));
      if (pages.length > 1 && root.PDFLib) {
        try { files = [file(await pagesToPdf(pages.map(p => p.blob)), `scan-${stamp}.pdf`, 'application/pdf')]; }
        catch (e) { console.warn('[scancam] PDF failed, saving photos', e); }
      }
      close();
      if (opts.onDone) opts.onDone({ files });
    }

    wrap.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'shoot') shoot();
      else if (act === 'close') close();
      else if (act === 'left') {
        if (mode === 'check' && step === 'back') {
          if (shots.back) URL.revokeObjectURL(shots.back.url);
          shots.back = null; showReview();
        } else { close(); if (opts.onUpload) opts.onUpload(); }
      }
      else if (act === 'review') showReview();
      else if (act === 'torch' && track) {
        const on = b.getAttribute('aria-pressed') !== 'true';
        track.applyConstraints({ advanced: [{ torch: on }] }).then(() => b.setAttribute('aria-pressed', String(on))).catch(() => {});
      }
      else if (act === 'retake-front' || act === 'retake-back') { step = act.slice(7); backToCamera(); }
      else if (act === 'flip-front' || act === 'flip-back') { await flip(shots[act.slice(5)]); showReview(); }
      else if (act === 'retake-p') { retakeAt = +b.dataset.i; backToCamera(); }
      else if (act === 'remove-p') { const p = pages.splice(+b.dataset.i, 1)[0]; if (p) URL.revokeObjectURL(p.url); showReview(); }
      else if (act === 'add-page') { retakeAt = -1; backToCamera(); }
      else if (act === 'use') { b.disabled = true; b.textContent = 'Saving…'; finish(); }
      else if (act === 'fallback') { close(); if (opts.onFallback) opts.onFallback(); }
    });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      else if ((e.key === ' ' || e.key === 'Enter') && review.hidden && e.target === wrap) { e.preventDefault(); shoot(); }
    });
    wrap.tabIndex = -1;
    wrap.focus();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    layout();
    start();
    return { close };
  }

  // Pages (JPEG blobs) → one PDF, each page sized to letter width.
  async function pagesToPdf(blobs) {
    const PDF = root.PDFLib;
    const doc = await PDF.PDFDocument.create();
    for (const b of blobs) {
      const img = await doc.embedJpg(new Uint8Array(await b.arrayBuffer()));
      const w = 612, h = Math.round(612 * img.height / img.width);
      const page = doc.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  return { CHECK_RATIO, DOC_RATIO, frameRatio, fitFrame, cropRect, outSize, supported, open, pagesToPdf };
});
