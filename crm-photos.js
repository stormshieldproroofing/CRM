/* ============================================================
   StormShield CRM — job photos: in-app camera, upload queue,
   Cloudflare R2 storage, and "Share Photos" links.
   ------------------------------------------------------------
   • Photos taken in the in-app camera never touch the phone's
     camera roll: frames go canvas → JPEG → upload.
   • Every photo is shrunk on the phone (full ~1600px + a small
     thumbnail for the grids) and stamped with GPS + time.
   • Uploads go through a small queue kept in the browser
     (IndexedDB). No signal on the roof? They wait and send
     themselves when the connection comes back.
   • Storage: when PHOTO_WORKER_URL is set, new photos go to the
     Cloudflare R2 worker (workers/photos). When it is blank,
     they go to the Supabase "job-files" bucket like before.
     Older photos stay where they are either way.
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmPhotos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Paste the worker's URL here after deploying workers/photos (see its README).
  // Leave blank to keep storing photos in Supabase.
  const PHOTO_WORKER_URL = '';

  const SECTIONS = [
    { key: 'before', label: 'Before', color: '#F59E0B' },
    { key: 'during', label: 'During', color: '#4D9DE0' },
    { key: 'after',  label: 'After',  color: '#34D399' },
  ];
  const FULL_MAX = 1600, FULL_Q = 0.78;
  const THUMB_MAX = 360, THUMB_Q = 0.62;
  const SB_LINK_TTL = 60 * 60 * 24 * 7;

  /* ---------- small pure helpers (unit tested) ---------- */

  function workerUrl() { return String(root.PHOTO_WORKER_URL || PHOTO_WORKER_URL || '').replace(/\/+$/, ''); }
  function usesR2() { return !!workerUrl(); }

  function sectionOf(key) { return SECTIONS.find(s => s.key === key) || SECTIONS[0]; }

  // Scale (w,h) to fit inside max on the long side; never enlarges.
  function fitSize(w, h, max) {
    w = Math.max(1, Math.round(w || 1)); h = Math.max(1, Math.round(h || 1));
    const s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // "Nov 4, 2026 9:41 PM · 123 Main St"
  function stampText(date, address) {
    const d = date || new Date();
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    const when = `${mon} ${d.getDate()}, ${d.getFullYear()} ${h}:${pad(d.getMinutes())} ${ap}`;
    const street = String(address || '').split(',')[0].trim();
    return street && street !== '—' ? `${when} · ${street}` : when;
  }

  // "Smith - 123 Main St - Before Photo - 2026-11-04 - 2141-07.jpg"
  function photoFileName(job, section, date, n) {
    const clean = s => String(s || '').trim().replace(/[\\/:*?"<>|#%]+/g, '').replace(/\s+/g, ' ').trim();
    const d = date || new Date();
    const parts = [];
    const name = clean(job && job.name !== '—' ? job.name : '');
    const street = clean(String(job && job.address !== '—' ? job.address || '' : '').split(',')[0]);
    if (name) parts.push(name);
    if (street) parts.push(street);
    parts.push(`${sectionOf(section).label} Photo`);
    parts.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    parts.push(`${pad(d.getHours())}${pad(d.getMinutes())}-${pad(n || 1)}`);
    return parts.join(' - ') + '.jpg';
  }

  function base64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function makeToken() {
    const b = new Uint8Array(32);
    root.crypto.getRandomValues(b);
    return base64url(b);
  }

  async function sha256Hex(text) {
    const h = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // photos.html lives next to the CRM page (…/CRM/photos.html).
  function shareUrl(token, loc) {
    const l = loc || root.location;
    const dir = String(l.pathname || '/').replace(/[^/]*$/, '');
    return `${l.origin}${dir}photos.html?t=${encodeURIComponent(token)}`;
  }

  function expiresAt(choice, now) {
    const days = { '7': 7, '30': 30, '90': 90 }[String(choice)];
    if (!days) return null; // never
    return new Date((now || Date.now()) + days * 864e5).toISOString();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Missing-column errors mean the photo migration hasn't run yet; fall back to the old columns.
  function isMissingColumn(err) {
    const m = String((err && (err.message || err.details)) || '');
    return !!err && (err.code === '42703' || err.code === 'PGRST204' || /column .* does not exist|Could not find the .* column/i.test(m));
  }

  function jobRow(rec) {
    return {
      job_id: rec.jobId, kind: 'photo', section: rec.section, name: rec.name,
      storage_path: rec.path, storage: rec.storage, thumb_path: rec.thumbPath || null,
      taken_at: rec.takenAt || null, lat: rec.lat ?? null, lng: rec.lng ?? null, taken_by: rec.takenBy || null,
    };
  }

  /* ---------- browser plumbing ---------- */

  const hasDOM = typeof document !== 'undefined';
  const sb = () => root.sb;
  const say = m => { try { (root.toast || console.log)(m); } catch (e) {} };
  function jobsList() { try { return Array.isArray(root.jobs) ? root.jobs : []; } catch (e) { return []; } }

  async function accessToken() {
    const { data } = await sb().auth.getSession();
    return data && data.session ? data.session.access_token : null;
  }
  async function whoAmI() {
    try { const { data } = await sb().auth.getSession(); return data?.session?.user?.email || null; } catch (e) { return null; }
  }

  // Location: one fix per camera session, reused for each shot.
  let _pos = null, _posAt = 0, _watch = null;
  function startLocation() {
    if (!root.navigator || !navigator.geolocation || _watch != null) return;
    try {
      _watch = navigator.geolocation.watchPosition(
        p => { _pos = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }; _posAt = Date.now(); },
        () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 });
    } catch (e) {}
  }
  function stopLocation() {
    if (_watch != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(_watch); } catch (e) {} }
    _watch = null;
  }
  function currentPosition() { return _pos && Date.now() - _posAt < 10 * 60000 ? _pos : null; }

  function canvasToBlob(canvas, q) {
    return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', q));
  }
  function drawScaled(src, sw, sh, max) {
    const { w, h } = fitSize(sw, sh, max);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }
  function drawStamp(canvas, text) {
    const ctx = canvas.getContext('2d');
    const fs = Math.max(14, Math.round(canvas.width * 0.022));
    ctx.font = `600 ${fs}px Inter, system-ui, -apple-system, sans-serif`;
    const padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.45);
    const tw = Math.min(canvas.width - padX * 4, ctx.measureText(text).width);
    const bh = fs + padY * 2, bw = tw + padX * 2;
    const x = Math.round(fs * 0.6), y = canvas.height - bh - Math.round(fs * 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + bh / 2, tw);
  }

  async function loadImage(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
    }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  // From any image source → { photo: Blob, thumb: Blob }.
  async function makeBlobs(src, sw, sh, stamp) {
    const full = drawScaled(src, sw, sh, FULL_MAX);
    if (stamp) drawStamp(full, stamp);
    const thumb = drawScaled(full, full.width, full.height, THUMB_MAX);
    const [photo, small] = await Promise.all([canvasToBlob(full, FULL_Q), canvasToBlob(thumb, THUMB_Q)]);
    if (!photo) throw new Error('Could not encode the photo');
    return { photo, thumb: small };
  }

  /* ---------- upload queue (IndexedDB) ---------- */

  const DB_NAME = 'ss-photo-queue', STORE = 'q';
  let _db = null;
  function db() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { _db = null; rej(r.error); };
    });
    return _db;
  }
  async function qAll() {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => res((r.result || []).sort((a, b) => a.createdAt - b.createdAt));
      r.onerror = () => rej(r.error);
    });
  }
  async function qPut(item) {
    const d = await db();
    await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(item); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function qDel(id) {
    const d = await db();
    await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }

  // Memory fallback when IndexedDB isn't available (private mode on some phones).
  const _mem = new Map();
  const queue = {
    all: async () => { try { return await qAll(); } catch (e) { return [..._mem.values()]; } },
    put: async (i) => { try { await qPut(i); } catch (e) { _mem.set(i.id, i); } },
    del: async (id) => { _mem.delete(id); try { await qDel(id); } catch (e) {} },
  };

  async function uploadToR2(item) {
    const token = await accessToken();
    if (!token) throw Object.assign(new Error('Not signed in'), { permanent: false });
    const fd = new FormData();
    fd.append('photo', item.photo, 'photo.jpg');
    if (item.thumb) fd.append('thumb', item.thumb, 'thumb.jpg');
    const r = await fetch(`${workerUrl()}/upload?job=${encodeURIComponent(item.jobId)}&section=${encodeURIComponent(item.section)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || `Upload failed (${r.status})`), { permanent: r.status === 400 || r.status === 403 || r.status === 413 });
    return { path: body.path, thumbPath: body.thumb_path || null, storage: 'r2' };
  }

  async function uploadToSupabase(item) {
    const safe = item.name.replace(/[^\w.\-]+/g, '_');
    const stamp = Date.now();
    const path = `${item.jobId}/photo/${stamp}-${safe}`;
    const thumbPath = `${item.jobId}/photo/thumbs/${stamp}-${safe}`;
    const { error } = await sb().storage.from('job-files').upload(path, item.photo, { contentType: 'image/jpeg' });
    if (error) throw Object.assign(new Error(error.message || 'Upload failed'), { permanent: false });
    let tp = null;
    if (item.thumb) {
      const { error: te } = await sb().storage.from('job-files').upload(thumbPath, item.thumb, { contentType: 'image/jpeg' });
      if (!te) tp = thumbPath;
    }
    return { path, thumbPath: tp, storage: 'supabase' };
  }

  async function saveRow(rec) {
    let res = await sb().from('job_files').insert(jobRow(rec)).select().maybeSingle();
    if (res.error && isMissingColumn(res.error)) {
      // Migration not applied yet — save with the original columns only.
      const { job_id, kind, section, name, storage_path } = jobRow(rec);
      res = await sb().from('job_files').insert({ job_id, kind, section, name, storage_path }).select().maybeSingle();
    }
    if (res.error) throw Object.assign(new Error(res.error.message || 'Could not save the photo record'), { permanent: false });
    return res.data;
  }

  async function signedUrls(storage, paths) {
    paths = paths.filter(Boolean);
    if (!paths.length) return {};
    if (storage === 'r2') return await signR2(paths);
    const out = {};
    const { data } = await sb().storage.from('job-files').createSignedUrls(paths, SB_LINK_TTL);
    (data || []).forEach(s => { if (s && s.path && s.signedUrl) out[s.path] = s.signedUrl; });
    return out;
  }

  // R2 links for the CRM itself: the worker checks the user's job access, then signs.
  async function signR2(paths) {
    paths = (paths || []).filter(Boolean);
    if (!paths.length || !usesR2()) return {};
    const token = await accessToken();
    if (!token) return {};
    const out = {};
    for (let i = 0; i < paths.length; i += 400) {
      try {
        const r = await fetch(`${workerUrl()}/sign`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: paths.slice(i, i + 400) }),
        });
        const body = await r.json().catch(() => ({}));
        Object.assign(out, body.urls || {});
      } catch (e) { console.warn('[photos] R2 sign failed', e); }
    }
    return out;
  }

  async function uploadItem(item) {
    const stored = usesR2() ? await uploadToR2(item) : await uploadToSupabase(item);
    const rec = { ...item, ...stored };
    let row;
    try { row = await saveRow(rec); }
    catch (e) {
      // Don't leave an orphaned file behind if the record can't be written.
      try { await removeFiles({ storage: stored.storage, path: stored.path, thumbPath: stored.thumbPath }); } catch (x) {}
      throw e;
    }
    const urls = await signedUrls(stored.storage, [stored.path, stored.thumbPath]);
    return {
      id: 'f' + Date.now() + Math.random().toString(36).slice(2, 7),
      _id: row && row.id, name: item.name, path: stored.path, thumbPath: stored.thumbPath,
      storage: stored.storage, url: urls[stored.path] || null, thumb: urls[stored.thumbPath] || null,
      takenAt: item.takenAt, lat: item.lat, lng: item.lng, isPdf: false, type: 'image/jpeg', size: item.photo.size,
    };
  }

  // Put a finished upload into the open job (if it's loaded) and tell the screen.
  function deliver(item, rec) {
    const j = jobsList().find(x => x && x.id === item.jobId);
    if (j) {
      if (!j.photos || typeof j.photos !== 'object') j.photos = { before: [], during: [], after: [] };
      (j.photos[item.section] ||= []);
      if (!j.photos[item.section].some(p => p && p.path === rec.path)) j.photos[item.section].push(rec);
    }
    if (hasDOM) root.dispatchEvent(new CustomEvent('crmphotos:uploaded', { detail: { jobId: item.jobId, section: item.section, record: rec } }));
  }

  let _running = null, _retryTimer = null;
  async function processQueue() {
    if (_running) return _running;
    _running = (async () => {
      const items = await queue.all();
      for (const item of items) {
        if (root.navigator && navigator.onLine === false) break;
        try {
          const rec = await uploadItem(item);
          await queue.del(item.id);
          deliver(item, rec);
        } catch (e) {
          item.tries = (item.tries || 0) + 1;
          item.lastError = String(e.message || e);
          console.warn('[photos] upload failed', item.lastError);
          if (e.permanent || item.tries >= 8) {
            await queue.del(item.id);
            say(`A photo couldn't be uploaded: ${item.lastError}`);
          } else {
            await queue.put(item);
            break; // likely offline — keep order, try again later
          }
        }
      }
    })().finally(() => { _running = null; updateBadge(); scheduleRetry(); });
    updateBadge();
    return _running;
  }
  async function scheduleRetry() {
    clearTimeout(_retryTimer);
    const left = (await queue.all()).length;
    if (left) _retryTimer = setTimeout(processQueue, 30000);
  }

  async function enqueue(job, section, blobs, meta) {
    const item = {
      id: 'q' + Date.now() + Math.random().toString(36).slice(2, 8),
      jobId: job.id, section, photo: blobs.photo, thumb: blobs.thumb,
      name: meta.name, takenAt: meta.takenAt, lat: meta.lat ?? null, lng: meta.lng ?? null,
      takenBy: meta.takenBy || null, createdAt: Date.now(), tries: 0,
    };
    await queue.put(item);
    updateBadge();
    return item;
  }

  // Waiting-to-upload pill, so nobody closes the app thinking photos are lost.
  async function updateBadge() {
    if (!hasDOM || !document.body) return;
    const n = (await queue.all()).length;
    let el = document.getElementById('ssPhotoQueue');
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = 'ssPhotoQueue';
      el.type = 'button';
      el.className = 'ssph-queue';
      el.addEventListener('click', () => { processQueue(); say(navigator.onLine === false ? 'No signal — photos will upload when you\'re back online' : 'Retrying uploads…'); });
      document.body.appendChild(el);
    }
    const offline = root.navigator && navigator.onLine === false;
    el.textContent = `${offline ? '⏸' : '⬆'} ${n} photo${n === 1 ? '' : 's'} ${offline ? 'waiting for signal' : 'uploading'}`;
  }

  /* ---------- public: add photos from files (Upload button, drag & drop) ---------- */

  let _seq = 0;
  async function addFiles(job, section, files) {
    const images = Array.from(files || []).filter(f => f && /^image\//.test(f.type || ''));
    if (!images.length) return 0;
    const takenBy = await whoAmI();
    for (const f of images) {
      try {
        const img = await loadImage(f);
        const when = f.lastModified ? new Date(f.lastModified) : new Date();
        const blobs = await makeBlobs(img, img.width, img.height, null);
        if (img.close) img.close();
        await enqueue(job, section, blobs, { name: photoFileName(job, section, new Date(), ++_seq), takenAt: when.toISOString(), takenBy });
      } catch (e) { console.warn('[photos] could not read file', e); say(`Skipped ${f.name}: ${e.message || e}`); }
    }
    await processQueue();
    return images.length;
  }

  /* ---------- delete ---------- */

  async function removeFiles(rec) {
    const paths = [rec.path, rec.thumbPath].filter(Boolean);
    if (!paths.length) return;
    if (rec.storage === 'r2') {
      const token = await accessToken();
      await fetch(`${workerUrl()}/delete`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
    } else {
      await sb().storage.from('job-files').remove(paths);
    }
  }
  async function deleteRecord(rec) {
    if (!rec) return;
    try {
      await removeFiles(rec);
      if (rec._id) await sb().from('job_files').delete().eq('id', rec._id);
      else if (rec.path) await sb().from('job_files').delete().eq('storage_path', rec.path);
    } catch (e) { console.warn('[photos] delete failed', e); }
  }

  /* ---------- styles ---------- */

  function injectCss() {
    if (!hasDOM || document.getElementById('ssPhotoCss')) return;
    const css = `
.ssph-queue{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99990;border:1px solid rgba(255,255,255,.15);background:#141A26;color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;padding:10px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer}
.ssph-cam{position:fixed;inset:0;z-index:100000;background:#000;color:#fff;display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,sans-serif;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.ssph-cam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
.ssph-top,.ssph-bottom{position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:12px 14px}
.ssph-top{padding-top:calc(12px + env(safe-area-inset-top));background:linear-gradient(rgba(0,0,0,.55),transparent)}
.ssph-bottom{margin-top:auto;flex-direction:column;padding-bottom:calc(18px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.65))}
.ssph-iconbtn{width:42px;height:42px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.ssph-title{flex:1;min-width:0;text-align:center;font-size:13px;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssph-pill{border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.45);color:#fff;font:600 11px Inter,system-ui,sans-serif;border-radius:999px;padding:8px 11px;cursor:pointer;white-space:nowrap}
.ssph-pill[aria-pressed="false"]{opacity:.6}
.ssph-secs{display:flex;gap:6px;background:rgba(0,0,0,.45);border-radius:999px;padding:4px}
.ssph-sec{border:none;background:transparent;color:#fff;font:700 12px Inter,system-ui,sans-serif;padding:8px 14px;border-radius:999px;cursor:pointer;letter-spacing:.3px}
.ssph-sec[aria-pressed="true"]{color:#000}
.ssph-row{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:420px;margin-top:14px}
.ssph-shutter{width:76px;height:76px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.25);cursor:pointer;padding:0;transition:transform .08s}
.ssph-shutter:active{transform:scale(.92)}
.ssph-shutter::after{content:"";display:block;width:60px;height:60px;margin:4px;border-radius:50%;background:#fff}
.ssph-last{width:54px;height:54px;border-radius:10px;border:2px solid #fff;background:#222 center/cover no-repeat;position:relative;cursor:pointer;padding:0}
.ssph-last span{position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;border-radius:11px;background:#1D4ED8;color:#fff;font:700 11px/22px Inter,system-ui,sans-serif;padding:0 5px}
.ssph-done{min-width:54px;height:42px;border-radius:999px;border:none;background:#fff;color:#000;font:700 13px Inter,system-ui,sans-serif;padding:0 16px;cursor:pointer}
.ssph-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3;transition:opacity .25s}
.ssph-flash.on{opacity:.75;transition:none}
.ssph-msg{position:relative;z-index:2;margin:auto;max-width:320px;text-align:center;padding:20px;font-size:15px;line-height:1.5}
.ssph-msg button{margin-top:16px}
.ssph-sheet-wrap{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
@media(min-width:700px){.ssph-sheet-wrap{align-items:center}}
.ssph-sheet{width:100%;max-width:460px;max-height:90vh;overflow:auto;background:var(--panel,#1A1F2E);color:var(--brand,#E6EAF2);border:1px solid var(--border,#2A3145);border-radius:16px 16px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));font-family:Inter,system-ui,sans-serif}
@media(min-width:700px){.ssph-sheet{border-radius:16px}}
.ssph-sheet,.ssph-sheet *{box-sizing:border-box}
.ssph-sheet h3{margin:0;font-size:17px}
.ssph-sheet .sub{color:var(--muted,#8A94AD);font-size:12px;margin:4px 0 14px}
.ssph-sheet .hd{display:flex;align-items:flex-start;gap:10px}
.ssph-sheet .hd>div{flex:1}
.ssph-x{width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:inherit;font-size:18px;cursor:pointer;flex-shrink:0}
.ssph-field{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#8A94AD);margin:14px 0 8px}
.ssph-checks{display:flex;gap:8px;flex-wrap:wrap}
.ssph-check{display:flex;align-items:center;gap:7px;border:1px solid var(--border,#2A3145);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600;cursor:pointer}
.ssph-check input{width:16px;height:16px;margin:0}
.ssph-check small{color:var(--muted,#8A94AD);font-weight:500}
.ssph-select{width:100%;padding:10px;border-radius:10px;border:1px solid var(--border,#2A3145);background:transparent;color:inherit;font:500 14px Inter,system-ui,sans-serif}
.ssph-select option{color:#000}
.ssph-primary{width:100%;margin-top:16px;padding:12px;border:none;border-radius:10px;background:#1D4ED8;color:#fff;font:700 14px Inter,system-ui,sans-serif;cursor:pointer}
.ssph-primary:disabled{opacity:.5;cursor:default}
.ssph-link{display:flex;gap:8px;margin-top:12px}
.ssph-link input{flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid var(--border,#2A3145);background:rgba(255,255,255,.04);color:inherit;font:500 12px ui-monospace,Menlo,monospace}
.ssph-btns{display:flex;gap:8px;margin-top:10px}
.ssph-btns button,.ssph-ghost{flex:1;padding:10px;border-radius:10px;border:1px solid var(--border,#2A3145);background:rgba(255,255,255,.05);color:inherit;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}
.ssph-list{margin-top:6px;display:flex;flex-direction:column;gap:8px}
.ssph-li{display:flex;align-items:center;gap:10px;border:1px solid var(--border,#2A3145);border-radius:10px;padding:10px 12px;font-size:12px}
.ssph-li>div{flex:1;min-width:0}
.ssph-li b{display:block;font-size:13px}
.ssph-li span{color:var(--muted,#8A94AD)}
.ssph-li button{padding:7px 10px;border-radius:8px;border:1px solid var(--border,#2A3145);background:transparent;color:#F87171;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.ssph-li button.cp{color:inherit}
.ssph-err{color:#F87171;font-size:12px;margin-top:10px;min-height:14px}
`;
    const s = document.createElement('style');
    s.id = 'ssPhotoCss';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- in-app camera ---------- */

  function fallbackPicker(job, section, onFiles) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => { onFiles(input.files); input.remove(); });
    document.body.appendChild(input);
    input.click();
  }

  // openCamera(job, section, { onFiles }) — onFiles(files, section) handles the
  // fallback (phone camera via file input) when the live camera isn't available.
  function openCamera(job, section, opts) {
    opts = opts || {};
    if (!job) return;
    let sec = sectionOf(section).key;
    const handleFiles = (files, s) => opts.onFiles ? opts.onFiles(files, s) : addFiles(job, s, files);
    if (!hasDOM || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallbackPicker(job, sec, files => handleFiles(files, sec));
      return;
    }
    injectCss();
    let stamp = true;
    try { stamp = localStorage.getItem('ssPhotoStamp') !== '0'; } catch (e) {}

    const wrap = document.createElement('div');
    wrap.className = 'ssph-cam';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Camera');
    const street = String(job.address || '').split(',')[0];
    wrap.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="ssph-flash"></div>
      <div class="ssph-top">
        <button class="ssph-iconbtn" data-act="close" aria-label="Close camera">✕</button>
        <div class="ssph-title">${esc(street && street !== '—' ? street : (job.name || 'Job photos'))}</div>
        <button class="ssph-pill" data-act="stamp" aria-pressed="${stamp}" title="Print date, time and address on photos">Stamp</button>
      </div>
      <div class="ssph-msg" hidden></div>
      <div class="ssph-bottom">
        <div class="ssph-secs" role="group" aria-label="Photo section">
          ${SECTIONS.map(s => `<button class="ssph-sec" data-sec="${s.key}" aria-pressed="${s.key === sec}">${s.label}</button>`).join('')}
        </div>
        <div class="ssph-row">
          <button class="ssph-last" data-act="done" aria-label="Done" style="visibility:hidden"><span>0</span></button>
          <button class="ssph-shutter" data-act="shoot" aria-label="Take photo"></button>
          <button class="ssph-done" data-act="done">Done</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const video = wrap.querySelector('video');
    const flash = wrap.querySelector('.ssph-flash');
    const msg = wrap.querySelector('.ssph-msg');
    const last = wrap.querySelector('.ssph-last');
    let stream = null, shots = 0, closed = false, lastUrl = null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function paintSections() {
      wrap.querySelectorAll('.ssph-sec').forEach(b => {
        const on = b.dataset.sec === sec;
        b.setAttribute('aria-pressed', on);
        b.style.background = on ? sectionOf(b.dataset.sec).color : 'transparent';
      });
    }
    paintSections();

    function close() {
      if (closed) return;
      closed = true;
      if (stream) stream.getTracks().forEach(t => t.stop());
      stopLocation();
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      document.body.style.overflow = prevOverflow;
      wrap.remove();
      document.removeEventListener('visibilitychange', onVis);
      if (opts.onClose) opts.onClose(shots);
      if (shots) say(`${shots} photo${shots === 1 ? '' : 's'} saved to ${sectionOf(sec).label}${navigator.onLine === false ? ' — will upload when you have signal' : ''}`);
    }
    function onVis() { if (document.hidden && stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } else if (!document.hidden && !stream && !closed) start(); }
    document.addEventListener('visibilitychange', onVis);

    function showFallback(text) {
      msg.hidden = false;
      msg.innerHTML = `<div>${esc(text)}</div><button class="ssph-done" data-act="fallback">Use phone camera</button>`;
      wrap.querySelector('.ssph-bottom').style.visibility = 'hidden';
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        });
        if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
      } catch (e) {
        console.warn('[photos] camera unavailable', e);
        showFallback(e && e.name === 'NotAllowedError'
          ? 'Camera access is turned off for the CRM. Allow camera access in your browser settings, or use the phone camera instead.'
          : 'The live camera isn\'t available on this device.');
      }
    }

    let busy = false;
    async function shoot() {
      if (busy || !stream || !video.videoWidth) return;
      busy = true;
      flash.classList.add('on'); requestAnimationFrame(() => setTimeout(() => flash.classList.remove('on'), 40));
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}
      const now = new Date();
      const s = sec;
      try {
        const blobs = await makeBlobs(video, video.videoWidth, video.videoHeight, stamp ? stampText(now, job.address) : null);
        shots++;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blobs.thumb || blobs.photo);
        last.style.backgroundImage = `url("${lastUrl}")`;
        last.style.visibility = 'visible';
        last.querySelector('span').textContent = shots;
        if (job._sb && root.sb) {
          const pos = currentPosition();
          await enqueue(job, s, blobs, { name: photoFileName(job, s, now, ++_seq), takenAt: now.toISOString(), lat: pos && pos.lat, lng: pos && pos.lng, takenBy: await whoAmI() });
          processQueue();
        } else {
          // Job not synced to Supabase yet — hand the photo to the CRM's local path.
          handleFiles([new File([blobs.photo], photoFileName(job, s, now, ++_seq), { type: 'image/jpeg' })], s);
        }
      } catch (e) { say(`Couldn't take that photo: ${e.message || e}`); }
      busy = false;
    }

    wrap.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.sec) { sec = b.dataset.sec; paintSections(); return; }
      const act = b.dataset.act;
      if (act === 'shoot') shoot();
      else if (act === 'close' || act === 'done') close();
      else if (act === 'stamp') {
        stamp = !stamp; b.setAttribute('aria-pressed', stamp);
        try { localStorage.setItem('ssPhotoStamp', stamp ? '1' : '0'); } catch (x) {}
        say(stamp ? 'Date, time and address will be printed on photos' : 'Photo stamp off');
      } else if (act === 'fallback') {
        const s = sec; close(); fallbackPicker(job, s, files => handleFiles(files, s));
      }
    });
    // Volume buttons can't be read on the web; Enter/Space works with a keyboard.
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shoot(); } });
    wrap.tabIndex = -1; wrap.focus();

    startLocation();
    start();
  }

  /* ---------- share links ---------- */

  async function createShare(job, sections, expiry, label) {
    const token = makeToken();
    const row = {
      token_hash: await sha256Hex(token), job_id: job.id, sections,
      label: label ? String(label).slice(0, 80) : null,
      created_by: await whoAmI(), expires_at: expiresAt(expiry),
    };
    const { data, error } = await sb().from('photo_shares').insert(row).select().maybeSingle();
    if (error) throw new Error(/photo_shares/.test(error.message || '') ? 'Photo sharing isn\'t set up yet (the database update hasn\'t been applied).' : (error.message || 'Could not create the link'));
    return { url: shareUrl(token), share: data };
  }
  async function listShares(job) {
    const { data, error } = await sb().from('photo_shares').select('*').eq('job_id', job.id).is('revoked_at', null).order('created_at', { ascending: false });
    if (error) return [];
    const now = Date.now();
    return (data || []).filter(s => !s.expires_at || new Date(s.expires_at).getTime() > now);
  }
  async function revokeShare(id) {
    const { error } = await sb().from('photo_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message || 'Could not turn off the link');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function openShare(job) {
    if (!hasDOM || !job) return;
    if (!job._sb || !root.sb) { say('Save this job first, then you can share its photos.'); return; }
    injectCss();
    const counts = {};
    SECTIONS.forEach(s => { counts[s.key] = (job.photos && Array.isArray(job.photos[s.key])) ? job.photos[s.key].length : 0; });
    const wrap = document.createElement('div');
    wrap.className = 'ssph-sheet-wrap';
    wrap.innerHTML = `
      <div class="ssph-sheet" role="dialog" aria-modal="true" aria-labelledby="ssphShareT">
        <div class="hd">
          <div>
            <h3 id="ssphShareT">Share photos</h3>
            <div class="sub">Anyone with the link can view and download these photos. No login needed. You can turn the link off anytime.</div>
          </div>
          <button class="ssph-x" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="ssph-field">Include</div>
        <div class="ssph-checks">
          ${SECTIONS.map(s => `<label class="ssph-check"><input type="checkbox" value="${s.key}" ${counts[s.key] ? 'checked' : ''}> ${s.label} <small>${counts[s.key]}</small></label>`).join('')}
        </div>
        <div class="ssph-field">Who is it for? <span style="text-transform:none;font-weight:500">(optional)</span></div>
        <input class="ssph-select" data-f="label" maxlength="80" placeholder="e.g. Adjuster, Homeowner, PA">
        <div class="ssph-field">Link works for</div>
        <select class="ssph-select" data-f="exp">
          <option value="7">7 days</option>
          <option value="30" selected>30 days</option>
          <option value="90">90 days</option>
          <option value="never">Until I turn it off</option>
        </select>
        <button class="ssph-primary" data-act="create">Create link</button>
        <div class="ssph-err" role="alert"></div>
        <div data-out></div>
        <div class="ssph-field" data-lh hidden>Active links</div>
        <div class="ssph-list" data-list></div>
      </div>`;
    document.body.appendChild(wrap);
    const $ = sel => wrap.querySelector(sel);
    const err = $('.ssph-err');
    const close = () => wrap.remove();

    async function renderList() {
      const list = await listShares(job);
      $('[data-lh]').hidden = !list.length;
      $('[data-list]').innerHTML = list.map(s => `
        <div class="ssph-li">
          <div>
            <b>${esc(s.label || s.sections.map(k => sectionOf(k).label).join(', '))}</b>
            <span>${esc(s.sections.map(k => sectionOf(k).label).join(' · '))} · made ${esc(fmtDate(s.created_at))} · ${s.view_count || 0} view${s.view_count === 1 ? '' : 's'}${s.expires_at ? ` · ends ${esc(fmtDate(s.expires_at))}` : ''}</span>
          </div>
          <button data-revoke="${esc(s.id)}">Turn off</button>
        </div>`).join('');
    }

    function showLink(url) {
      const canShare = !!navigator.share;
      $('[data-out]').innerHTML = `
        <div class="ssph-link"><input readonly value="${esc(url)}" aria-label="Share link"></div>
        <div class="ssph-btns">
          <button data-act="copy">Copy link</button>
          ${canShare ? '<button data-act="native">Share…</button>' : ''}
          <button data-act="text">Text it</button>
        </div>`;
      $('[data-out]').dataset.url = url;
    }

    wrap.addEventListener('click', async e => {
      if (e.target === wrap) return close();
      const b = e.target.closest('button');
      if (!b) return;
      const url = $('[data-out]').dataset.url;
      const street = String(job.address || '').split(',')[0];
      const msgText = `Photos from StormShield Pro Roofing${street && street !== '—' ? ` for ${street}` : ''}:`;
      if (b.dataset.act === 'close') close();
      else if (b.dataset.act === 'create') {
        err.textContent = '';
        const sections = [...wrap.querySelectorAll('.ssph-check input:checked')].map(i => i.value);
        if (!sections.length) { err.textContent = 'Pick at least one section.'; return; }
        b.disabled = true; b.textContent = 'Creating…';
        try {
          const { url: u } = await createShare(job, sections, $('[data-f="exp"]').value, $('[data-f="label"]').value.trim());
          showLink(u);
          renderList();
          try { await navigator.clipboard.writeText(u); say('Link copied'); } catch (x) {}
        } catch (x) { err.textContent = x.message || String(x); }
        b.disabled = false; b.textContent = 'Create another link';
      } else if (b.dataset.act === 'copy') {
        try { await navigator.clipboard.writeText(url); say('Link copied'); }
        catch (x) { const i = $('.ssph-link input'); i.select(); document.execCommand && document.execCommand('copy'); say('Link copied'); }
      } else if (b.dataset.act === 'native') {
        try { await navigator.share({ title: 'Job photos', text: msgText, url }); } catch (x) {}
      } else if (b.dataset.act === 'text') {
        const body = encodeURIComponent(`${msgText} ${url}`);
        location.href = /iPhone|iPad|iPod/.test(navigator.userAgent) ? `sms:&body=${body}` : `sms:?body=${body}`;
      } else if (b.dataset.revoke) {
        if (!confirm('Turn off this link? Anyone who has it will no longer see the photos.')) return;
        try { await revokeShare(b.dataset.revoke); say('Link turned off'); renderList(); }
        catch (x) { err.textContent = x.message || String(x); }
      }
    });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    renderList();
  }

  /* ---------- boot ---------- */

  if (hasDOM) {
    root.addEventListener('online', () => { updateBadge(); processQueue(); });
    root.addEventListener('offline', updateBadge);
    const boot = () => { injectCss(); setTimeout(() => { if (root.sb) processQueue(); }, 4000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  return {
    SECTIONS, usesR2, workerUrl, fitSize, stampText, photoFileName, base64url, makeToken, sha256Hex,
    shareUrl, expiresAt, esc, isMissingColumn, jobRow,
    openCamera, openShare, addFiles, deleteRecord, signR2, processQueue,
  };
});
