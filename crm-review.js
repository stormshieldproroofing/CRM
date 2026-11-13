/* ============================================================
   StormShield CRM — Google review request (text first)
   ------------------------------------------------------------
   Once a job's build is complete the rep can ask the homeowner
   for a Google review from the job screen:
     • pick a few of the job's photos,
     • type one key point from the job,
     • tap "Open text" — the phone's share sheet opens with the
       message and the photos, and the rep sends it from Messages.
   Nothing is sent automatically. The CRM records when the rep
   opened the text and lets them mark the review as posted.
   Saved on the job as job.reviewReq (kept in the contract JSON,
   see supabase-crm.js).
   ============================================================ */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const REVIEW_URL = 'https://g.page/r/CVR8aQYeseTWEBM/review';
  const MAX_PHOTOS = 6;
  // Stages that only come after the build, for jobs that never got a build date.
  const AFTER_BUILD_STAGES = ['postproduction', 'invoiced', 'completed'];

  /* ---------- pure helpers (unit tested) ---------- */

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // The message the rep sends. keyPoint and the photo sentence are left out when empty.
  function buildText(o) {
    o = o || {};
    const name = clean(o.name) || 'there';
    const rep = clean(o.repName);
    const company = clean(o.company) || 'StormShield Pro Roofing';
    const key = clean(o.keyPoint).replace(/[.!\s]+$/, '');
    const url = clean(o.url) || REVIEW_URL;
    let t = 'Hi ' + name + ', it’s ' + (rep ? rep + ' with ' : '') + company + '. '
      + 'Thank you for trusting us with your roof! Would you mind leaving us a quick Google review? '
      + 'It really helps if you can add a couple photos of the new roof, mention my name and your neighborhood, '
      + 'and share a little about your experience' + (key ? ', like ' + key : '') + '. '
      + 'Here’s the link: ' + url + ' .';
    if (o.photoCount > 0) t += ' I’m sending a few photos of your roof you can use.';
    return t + ' Thank you!';
  }

  // Build complete = the build date has been reached (same rule the CRM uses for
  // revenue), or the job already sits in a stage that only comes after the build.
  function isBuildComplete(job, now) {
    if (!job) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(job.buildDate || ''));
    if (m) {
      const end = new Date(now || Date.now()); end.setHours(23, 59, 59, 999);
      return new Date(+m[1], +m[2] - 1, +m[3], 12) <= end;
    }
    return AFTER_BUILD_STAGES.includes(String(job.col || ''));
  }

  // 'none' | 'sent' | 'posted'
  function statusOf(job) {
    const r = job && job.reviewReq;
    if (!r || typeof r !== 'object') return 'none';
    if (r.postedAt) return 'posted';
    return r.sentAt ? 'sent' : 'none';
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Every photo on the job, grouped Before / During / After.
  function jobPhotos(job) {
    const p = (job && job.photos && typeof job.photos === 'object') ? job.photos : {};
    return [['before', 'Before', '#F59E0B'], ['during', 'During', '#4D9DE0'], ['after', 'After', '#34D399']]
      .map(s => ({ key: s[0], label: s[1], color: s[2], items: (Array.isArray(p[s[0]]) ? p[s[0]] : []).filter(r => r && !r.isPdf && (r.url || r.thumb || r.path)) }))
      .filter(s => s.items.length);
  }

  /* ---------- browser plumbing ---------- */

  const hasDOM = typeof document !== 'undefined';
  const say = m => { try { (root.toast || console.log)(m); } catch (e) {} };
  const photoKey = r => r.path || r.url || r.thumb || r.id || r.name;

  function repName() {
    try { const me = typeof root.cardRep === 'function' ? root.cardRep() : (root.currentMember || {}); return clean(me && me.name); }
    catch (e) { return ''; }
  }
  function firstName(job) {
    try { if (typeof root.greetName === 'function') return root.greetName(job.name); } catch (e) {}
    return clean(job && job.name).split(' ')[0] || 'there';
  }
  function companyName() {
    try { const co = typeof root.getCompanyInfo === 'function' ? root.getCompanyInfo() : {}; return (co && co.name) || ''; }
    catch (e) { return ''; }
  }
  function save(job) {
    try { if (typeof root.saveToStorage === 'function') root.saveToStorage(); } catch (e) { console.warn('[review] save failed', e); }
    if (hasDOM) root.dispatchEvent(new CustomEvent('crmreview:changed', { detail: { jobId: job.id } }));
  }

  // A fresh link to the full-size photo (stored links expire after a week).
  async function freshUrl(rec) {
    try {
      if (rec.path && rec.storage === 'r2' && root.crmPhotos && root.crmPhotos.signR2) {
        const u = (await root.crmPhotos.signR2([rec.path]))[rec.path];
        if (u) return u;
      } else if (rec.path && root.sb && root.sb.storage) {
        const { data } = await root.sb.storage.from('job-files').createSignedUrl(rec.path, 3600);
        if (data && data.signedUrl) return data.signedUrl;
      }
    } catch (e) { console.warn('[review] could not refresh photo link', e); }
    return rec.url || rec.thumb || '';
  }
  async function photoFile(rec, n) {
    const url = await freshUrl(rec);
    if (!url) throw new Error('No link for this photo');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Photo download failed (' + res.status + ')');
    const blob = await res.blob();
    const type = blob.type && /^image\//.test(blob.type) ? blob.type : 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : 'jpg';
    return new File([blob], 'stormshield-roof-' + n + '.' + ext, { type });
  }

  function markSent(job, photoCount, keyPoint) {
    const prev = (job.reviewReq && typeof job.reviewReq === 'object') ? job.reviewReq : {};
    const by = (root.currentMember && root.currentMember.name) || '';
    job.reviewReq = { ...prev, sentAt: new Date().toISOString(), sentBy: by, photoCount, keyPoint: clean(keyPoint), sends: (prev.sends || 0) + 1 };
    try { if (typeof root.logContact === 'function') root.logContact(job, 'client', 'text', 'Google review request sent' + (photoCount ? ' with ' + photoCount + ' photo' + (photoCount === 1 ? '' : 's') : '')); } catch (e) {}
    save(job);
  }
  function setPosted(job, posted) {
    const prev = (job.reviewReq && typeof job.reviewReq === 'object') ? job.reviewReq : {};
    job.reviewReq = { ...prev, postedAt: posted ? new Date().toISOString() : null };
    try { if (typeof root.logActivity === 'function') root.logActivity(job, 'note', posted ? 'Google review marked posted' : 'Google review un-marked', ''); } catch (e) {}
    save(job);
  }

  function injectCss() {
    if (!hasDOM || document.getElementById('ssReviewCss')) return;
    const css = `
.ssrv-wrap{position:fixed;inset:0;z-index:100000;background:rgba(5,7,11,.6);display:flex;align-items:flex-end;justify-content:center}
@media(min-width:700px){.ssrv-wrap{align-items:center}}
.ssrv-sheet{width:100%;max-width:480px;max-height:92vh;display:flex;flex-direction:column;background:var(--panel-2,#181D27);color:var(--brand,#E8ECF3);border:1px solid var(--border,#252B38);border-radius:22px 22px 0 0;font-family:Inter,system-ui,-apple-system,sans-serif}
@media(min-width:700px){.ssrv-sheet{border-radius:18px}}
.ssrv-sheet,.ssrv-sheet *{box-sizing:border-box}
.ssrv-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 16px 12px;border-bottom:1px solid rgba(255,255,255,.07)}
.ssrv-head h3{margin:0;font-size:17px;font-weight:700}
.ssrv-head p{margin:3px 0 0;font-size:13px;color:var(--muted,#8B94A7)}
.ssrv-x{width:44px;height:44px;flex-shrink:0;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:var(--tile,#1A1F29);color:inherit;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ssrv-body{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.ssrv-lab{display:flex;align-items:baseline;justify-content:space-between;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#8B94A7)}
.ssrv-lab b{font-size:13px;letter-spacing:0;text-transform:none;color:var(--accent,#F2C46B)}
.ssrv-sec{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--text-2,#C4CBD8)}
.ssrv-sec i{width:9px;height:9px;border-radius:50%;display:inline-block}
.ssrv-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.ssrv-ph{position:relative;aspect-ratio:1;padding:0;border:2px solid transparent;border-radius:10px;overflow:hidden;background:#2A3140;cursor:pointer}
.ssrv-ph img{width:100%;height:100%;object-fit:cover;display:block}
.ssrv-ph[aria-pressed="true"]{border-color:var(--accent,#F2C46B)}
.ssrv-ph span{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:var(--accent,#F2C46B);color:#1A1405;font-size:12px;font-weight:700;display:none;align-items:center;justify-content:center}
.ssrv-ph[aria-pressed="true"] span{display:flex}
.ssrv-empty{font-size:13px;line-height:1.45;color:var(--muted,#8B94A7);background:var(--panel,#12161E);border:1px dashed rgba(255,255,255,.14);border-radius:12px;padding:12px}
.ssrv-in{width:100%;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:var(--panel,#12161E);color:inherit;font:400 15px Inter,system-ui,sans-serif;padding:0 12px;outline:none}
.ssrv-in:focus{border-color:var(--blue,#2F6FEB)}
.ssrv-prev{background:var(--panel,#12161E);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.5;color:var(--text-2,#C4CBD8);white-space:pre-wrap;word-break:break-word}
.ssrv-foot{padding:12px 16px calc(16px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;gap:8px}
.ssrv-go{height:52px;border-radius:14px;border:0;background:var(--blue,#2F6FEB);color:#fff;font:700 16px Inter,system-ui,sans-serif;cursor:pointer}
.ssrv-go:disabled{opacity:.6;cursor:default}
.ssrv-note{font-size:12px;color:var(--muted,#8B94A7);text-align:center}
.ssrv-card{background:var(--panel,#12161E);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:12px;font-family:Inter,system-ui,sans-serif;color:var(--brand,#E8ECF3)}
.ssrv-card.ask{background:var(--panel-2,#181D27);border-color:rgba(242,196,107,.45)}
.ssrv-row{display:flex;align-items:center;gap:12px}
.ssrv-ic{width:36px;height:36px;flex-shrink:0;border-radius:10px;background:var(--accent-light,#3A2E12);color:var(--accent,#F2C46B);display:flex;align-items:center;justify-content:center;font-size:18px}
.ssrv-t{font-size:15px;font-weight:600}
.ssrv-s{font-size:13px;color:var(--muted,#8B94A7);margin-top:2px}
.ssrv-pill{margin-left:auto;font-size:12px;font-weight:700;border-radius:999px;padding:4px 10px;white-space:nowrap;background:var(--accent,#F2C46B);color:#1A1405}
.ssrv-pill.ok{background:#0D2918;color:#6EE7B7}
.ssrv-btns{display:flex;gap:8px}
.ssrv-btn{flex:1;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}
.ssrv-btn.primary{border:0;background:var(--blue,#2F6FEB);color:#fff;font-size:15px}
`;
    const st = document.createElement('style');
    st.id = 'ssReviewCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- the send sheet ---------- */

  function openSheet(job) {
    if (!hasDOM || !job) return;
    injectCss();
    document.querySelectorAll('.ssrv-wrap').forEach(w => w.remove());
    const groups = jobPhotos(job);
    const picked = [];              // photo records, in the order tapped
    const files = new Map();        // photoKey -> Promise<File> (downloads start when a photo is picked)
    const prevKey = (job.reviewReq && job.reviewReq.keyPoint) || '';
    const phone = (job.phone && job.phone !== '—') ? String(job.phone).replace(/[^\d+]/g, '') : '';

    const wrap = document.createElement('div');
    wrap.className = 'ssrv-wrap';
    wrap.innerHTML = `
      <div class="ssrv-sheet" role="dialog" aria-modal="true" aria-labelledby="ssrvT">
        <div class="ssrv-head">
          <div><h3 id="ssrvT">Review request</h3><p>${esc([job.name && job.name !== '—' ? job.name : '', String(job.address && job.address !== '—' ? job.address : '').split(',')[0]].filter(Boolean).join(' · '))}</p></div>
          <button type="button" class="ssrv-x" aria-label="Close" data-act="close">✕</button>
        </div>
        <div class="ssrv-body">
          <div class="ssrv-lab"><span>1 · Pick photos to send</span><b data-f="count"></b></div>
          <div data-f="photos"></div>
          <label class="ssrv-lab" for="ssrvKey"><span>2 · Key point from their job</span></label>
          <input id="ssrvKey" class="ssrv-in" type="text" maxlength="140" placeholder="e.g. how fast we got the roof on after the storm" value="${esc(prevKey)}">
          <div class="ssrv-lab"><span>3 · Text that will open</span></div>
          <div class="ssrv-prev" data-f="preview"></div>
        </div>
        <div class="ssrv-foot">
          <button type="button" class="ssrv-go" data-act="go">Open text${job.name && job.name !== '—' ? ' to ' + esc(firstName(job)) : ''}</button>
          <div class="ssrv-note" data-f="note">Opens your phone’s share sheet with this text and the photos. Pick Messages, then press send.</div>
        </div>
      </div>`;
    const $ = sel => wrap.querySelector(sel);
    const close = () => wrap.remove();
    const text = () => buildText({ name: firstName(job), repName: repName(), company: companyName(), keyPoint: $('#ssrvKey').value, photoCount: picked.length });

    function paint() {
      $('[data-f="count"]').textContent = picked.length ? picked.length + ' picked' : '';
      $('[data-f="preview"]').textContent = text();
      wrap.querySelectorAll('.ssrv-ph').forEach(b => {
        const i = picked.findIndex(r => photoKey(r) === b.dataset.k);
        b.setAttribute('aria-pressed', i >= 0 ? 'true' : 'false');
        b.querySelector('span').textContent = i >= 0 ? String(i + 1) : '';
      });
    }

    const box = $('[data-f="photos"]');
    if (!groups.length) {
      box.innerHTML = '<div class="ssrv-empty">No photos on this job yet. You can still send the text, or add photos from the job’s Photos tab first.</div>';
    } else {
      box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      groups.forEach(g => {
        const head = document.createElement('div');
        head.className = 'ssrv-sec';
        head.innerHTML = '<i style="background:' + g.color + '"></i>' + esc(g.label);
        const grid = document.createElement('div');
        grid.className = 'ssrv-grid';
        g.items.forEach(rec => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ssrv-ph';
          b.dataset.k = photoKey(rec);
          b.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-label', g.label + ' photo');
          b.innerHTML = '<img alt="" loading="lazy"><span></span>';
          b.querySelector('img').src = rec.thumb || rec.url || '';
          b.addEventListener('click', () => {
            const i = picked.findIndex(r => photoKey(r) === photoKey(rec));
            if (i >= 0) picked.splice(i, 1);
            else if (picked.length >= MAX_PHOTOS) { say('Up to ' + MAX_PHOTOS + ' photos per text'); return; }
            else {
              picked.push(rec);
              // Start the download now so the share sheet can open the moment the rep taps the button.
              if (!files.has(photoKey(rec))) {
                const p = photoFile(rec, files.size + 1);
                p.catch(() => {});
                files.set(photoKey(rec), p);
              }
            }
            paint();
          });
          grid.appendChild(b);
        });
        box.appendChild(head);
        box.appendChild(grid);
      });
    }

    $('#ssrvKey').addEventListener('input', paint);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    $('[data-act="close"]').addEventListener('click', close);

    let ready = null;   // files downloaded but the share sheet needs one more tap (iPhone)
    $('[data-act="go"]').addEventListener('click', async () => {
      const go = $('[data-act="go"]'), note = $('[data-f="note"]');
      const body = text();
      let list = ready;
      if (!list) {
        go.disabled = true;
        const label = go.textContent;
        if (picked.length) go.textContent = 'Getting photos…';
        const got = await Promise.all(picked.map(r => files.get(photoKey(r)).then(f => f, () => null)));
        list = got.filter(Boolean);
        go.disabled = false;
        go.textContent = label;
        if (list.length < picked.length) say((picked.length - list.length) + ' photo(s) could not be loaded — sending the rest');
      }
      const done = () => { markSent(job, list.length, $('#ssrvKey').value); close(); say('Review request opened — press send in Messages'); };

      if (list.length && navigator.canShare && navigator.canShare({ files: list })) {
        try { await navigator.share({ files: list, text: body }); done(); return; }
        catch (e) {
          if (e && e.name === 'AbortError') return;                 // rep closed the share sheet
          if (e && e.name === 'NotAllowedError' && !ready) {        // iPhone wants a fresh tap after the download
            ready = list;
            go.textContent = 'Photos ready — tap to open text';
            return;
          }
        }
      }
      // No photos, or this device can't share files: open the text; save any photos to attach by hand.
      if (list.length) {
        list.forEach((f, i) => {
          const url = URL.createObjectURL(f);
          const a = document.createElement('a');
          a.href = url; a.download = f.name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000 + i * 500);
        });
        note.textContent = 'Photos saved to this device — attach them in Messages.';
      }
      if (phone) { root.location.href = 'sms:' + phone + '?body=' + encodeURIComponent(body); done(); return; }
      try { await navigator.clipboard.writeText(body); say('No phone number on this job — text copied'); }
      catch (e) { say('No phone number on this job'); }
    });

    document.body.appendChild(wrap);
    paint();
  }

  /* ---------- the card on the job screen ---------- */

  // Returns null until the build is complete. Re-draws itself after a send / mark posted.
  function card(job) {
    if (!hasDOM || !job || !isBuildComplete(job)) return null;
    injectCss();
    const el = document.createElement('div');
    el.className = 'ssrv-card';
    const draw = () => {
      const st = statusOf(job), r = job.reviewReq || {};
      el.classList.toggle('ask', st === 'none');
      const star = '<span class="ssrv-ic"><i class="ti ti-star" aria-hidden="true"></i></span>';
      if (st === 'none') {
        el.innerHTML = `<div class="ssrv-row">${star}<div><div class="ssrv-t">Ask ${esc(firstName(job))} for a review</div><div class="ssrv-s">Pick a few job photos and text the Google link.</div></div></div>
          <div class="ssrv-btns"><button type="button" class="ssrv-btn primary" data-act="send">Send review request</button></div>`;
      } else {
        const posted = st === 'posted';
        const sub = posted
          ? 'Marked posted ' + fmtWhen(r.postedAt)
          : 'Text opened' + (r.sentBy ? ' by ' + r.sentBy : '') + ' · ' + fmtWhen(r.sentAt);
        el.innerHTML = `<div class="ssrv-row">${star}<div><div class="ssrv-t">Google review</div><div class="ssrv-s">${esc(sub)}</div></div>
            <span class="ssrv-pill${posted ? ' ok' : ''}">${posted ? 'Posted' : 'Requested'}</span></div>
          <div class="ssrv-btns"><button type="button" class="ssrv-btn" data-act="send">Send again</button>
            <button type="button" class="ssrv-btn" data-act="${posted ? 'unpost' : 'post'}">${posted ? 'Not posted' : 'Mark posted'}</button></div>`;
      }
    };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === 'send') openSheet(job);
      else setPosted(job, b.dataset.act === 'post');
    });
    const onChange = e => {
      if (!el.isConnected) { root.removeEventListener('crmreview:changed', onChange); return; }
      if (e.detail && e.detail.jobId === job.id) draw();
    };
    root.addEventListener('crmreview:changed', onChange);
    draw();
    return el;
  }

  return { REVIEW_URL, MAX_PHOTOS, buildText, isBuildComplete, statusOf, jobPhotos, fmtWhen, openSheet, card, setPosted };
});
