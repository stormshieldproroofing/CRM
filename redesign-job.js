/* StormShield CRM redesign — job screen (Overview clean-up).
   Loaded for everyone by the loader in index.html.

   It does not re-create anything: after the CRM draws a job, this file moves
   the existing pieces (checklist, contact card, deposits, expenses, contract
   calculator...) into a cleaner order and adds shortcuts that simply press the
   CRM's own buttons or read its own numbers. Every form, save and button keeps
   its original code. The pipeline / stage tags in the header are left as is. */
(function () {
  const ICON = n => '<i class="ti ' + n + '" aria-hidden="true"></i>';
  const CHEVRON = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';
  let toolsOpen = false;     // "More tools" starts closed for every job
  let calcOpen = false;      // min. contract calculator starts closed
  let docsOpen = false, linksOpen = false, infoOpen = false;   // lower sections start closed
  let lastJobId = null;

  function currentJob() {
    try { return jobs.find(x => x.id === openJobId) || null; } catch (e) { return null; }
  }
  function currentTab() {
    try { return activeTab; } catch (e) { return ''; }
  }
  const later = fn => setTimeout(fn, 0);   // let the current tap finish before pressing another button
  const $id = id => document.getElementById(id);
  function num(text) {
    const m = String(text || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function usd(n, sign) {
    if (n == null || isNaN(n)) return '—';
    const cents = Math.round(Math.abs(n) * 100) % 100 !== 0;
    const s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
    if (sign === '-') return '−' + s;
    if (sign === '+') return '+' + s;
    return (n < 0 ? '−' : '') + s;
  }
  function cleanUsd(text) { const v = num(text); return v == null ? '—' : usd(v); }

  // ── Header: address under the name, pipeline + stage centered under it,
  //    a soft tint in the stage's color, ⋯ menu ─────────────────────────
  function decorateHeader(panel, j) {
    const name = panel.querySelector('.dp-name');
    const addr = (j.address && j.address !== '—') ? j.address : '';
    if (name && addr && !panel.querySelector('.rd-sub')) {
      const sub = document.createElement('div');
      sub.className = 'rd-sub';
      sub.textContent = addr;
      name.insertAdjacentElement('afterend', sub);
    }
    const status = panel.querySelector('.dp-status-group');
    const row = panel.querySelector('.dp-name-row');
    if (status && row && status.parentElement !== row.parentElement) {
      status.classList.add('rd-status-center');
      row.insertAdjacentElement('afterend', status);
    }
    const head = panel.querySelector('.dp-header-area');
    const dot = panel.querySelector('#stageSelector .dp-stage-dot');
    if (head && dot) {
      const m = (getComputedStyle(dot).backgroundColor || '').match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        head.classList.add('rd-tint');
        head.style.setProperty('--rd-stage', 'rgb(' + m[0] + ',' + m[1] + ',' + m[2] + ')');
        head.style.setProperty('--rd-stage-soft', 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',0.16)');
        head.style.setProperty('--rd-stage-none', 'rgba(' + m[0] + ',' + m[1] + ',' + m[2] + ',0)');
      }
    }
    const close = panel.querySelector('#dpClose');
    if (close && !panel.querySelector('.rd-more-btn')) {
      close.setAttribute('aria-label', 'Close');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-more-btn';
      b.setAttribute('aria-label', 'More actions');
      b.setAttribute('aria-haspopup', 'true');
      b.innerHTML = ICON('ti-dots');
      close.parentElement.insertBefore(b, close);
      b.addEventListener('click', e => { e.stopPropagation(); openMenu(j); });
    }
  }

  // ── Bottom sheets (⋯ menu, Upload) ───────────────────────────────────
  function closeMenu() {
    document.querySelectorAll('.rd-menu-wrap').forEach(m => m.remove());
  }
  function sheet(label, title, sub) {
    closeMenu();
    const overlay = $id('detailOverlay');
    if (!overlay) return null;
    const wrap = document.createElement('div');
    wrap.className = 'rd-menu-wrap';
    wrap.innerHTML = '<div class="rd-menu-bg"></div><div class="rd-menu" role="dialog"><div class="rd-menu-handle" aria-hidden="true"></div></div>';
    const menu = wrap.querySelector('.rd-menu');
    menu.setAttribute('aria-label', label);
    if (title) {
      const h = document.createElement('div'); h.className = 'rd-menu-title'; h.textContent = title; menu.appendChild(h);
      if (sub) { const s = document.createElement('div'); s.className = 'rd-menu-sub'; s.textContent = sub; menu.appendChild(s); }
    }
    wrap.querySelector('.rd-menu-bg').addEventListener('click', e => { e.stopPropagation(); closeMenu(); });
    overlay.appendChild(wrap);
    return menu;
  }
  function sheetItem(menu, icon, label, fn, opts) {
    opts = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rd-menu-item' + (opts.cls ? ' ' + opts.cls : '');
    b.innerHTML = '<span class="rd-menu-ic">' + ICON(icon) + '</span><span class="rd-menu-l"></span>';
    b.querySelector('.rd-menu-l').textContent = label;
    if (opts.note) {
      const n = document.createElement('span');
      n.className = 'rd-menu-note' + (opts.noteCls ? ' ' + opts.noteCls : '');
      n.textContent = opts.note;
      b.appendChild(n);
    }
    // opts.now: run inside the tap itself (needed to open the phone's file picker)
    b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); if (opts.now) fn(); else later(fn); });
    menu.appendChild(b);
    return b;
  }
  function sheetCancel(menu) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'rd-menu-cancel';
    c.textContent = 'Cancel';
    c.addEventListener('click', e => { e.stopPropagation(); closeMenu(); });
    menu.appendChild(c);
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  function openMenu(j) {
    const menu = sheet('Job actions');
    if (!menu) return;
    const click = id => () => { const el = $id(id); if (el) el.click(); };
    sheetItem(menu, 'ti-pencil', 'Edit job', click('dpEdit'));
    sheetItem(menu, 'ti-git-branch', 'Change pipeline', click('jobPipelineSelector'));
    sheetItem(menu, 'ti-progress', 'Change stage', click('stageSelector'));
    if (typeof saveJobContactToPhone === 'function') sheetItem(menu, 'ti-address-book', 'Save to phone contacts', () => saveJobContactToPhone(j.id));
    if ($id('dpDelete')) {
      const sep = document.createElement('div'); sep.className = 'rd-menu-sep'; menu.appendChild(sep);
      sheetItem(menu, 'ti-trash', 'Delete job', click('dpDelete'), { cls: 'danger' });
    }
    sheetCancel(menu);
  }

  // Upload: switch to the right tab and open its file picker in the same tap
  function uploadTo(tab, photoKey) {
    const btn = document.querySelector('#detailPanel .dp-tab[data-dptab="' + tab + '"]');
    if (!btn) return;
    btn.click();   // the CRM redraws the job on that tab
    const body = $id('dpBody');
    if (!body) return;
    let input = null;
    if (photoKey) input = body.querySelector('input[type="file"][multiple][onchange*="\'' + photoKey + '\'"]');
    if (!input) input = body.querySelector('input[type="file"][multiple]') || body.querySelector('input[type="file"]:not([capture])');
    if (input) input.click();
  }
  function openUpload(j) {
    const menu = sheet('Upload to this job', 'Upload to this job', 'Take a photo or pick a file. It is saved to the right tab.');
    if (!menu) return;
    let counts = {};
    try { counts = jobDocCounts(j) || {}; } catch (e) {}
    const photos = (j.photos && typeof j.photos === 'object') ? j.photos : {};
    const head = t => { const h = document.createElement('div'); h.className = 'rd-menu-head'; h.textContent = t; menu.appendChild(h); };
    head('Photos');
    const grid = document.createElement('div');
    grid.className = 'rd-up-photos';
    [['before', 'Before', '#F59E0B'], ['during', 'During', '#4D9DE0'], ['after', 'After', '#34D399']].forEach(([key, label, color]) => {
      const n = Array.isArray(photos[key]) ? photos[key].length : 0;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-up-photo';
      b.innerHTML = '<span class="rd-up-dot"></span><span class="rd-up-l"></span><span class="rd-up-n"></span>';
      b.querySelector('.rd-up-dot').style.background = color;
      b.querySelector('.rd-up-l').textContent = label;
      b.querySelector('.rd-up-n').textContent = n ? n + (n === 1 ? ' photo' : ' photos') : 'none yet';
      b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); uploadTo('photos', key); });
      grid.appendChild(b);
    });
    menu.appendChild(grid);
    head('Documents');
    [['contract', 'ti-writing', 'Contract'], ['checks', 'ti-receipt', 'Check'], ['loss', 'ti-file-alert', 'Loss statement'],
     ['roof', 'ti-ruler-measure', 'Roof measurement'], ['other', 'ti-file', 'Other document']].forEach(([tab, icon, label]) => {
      const n = counts[tab] || 0;
      sheetItem(menu, icon, label, () => uploadTo(tab), { now: true, note: n ? n + ' uploaded' : 'none yet', noteCls: n ? 'ok' : '' });
    });
    sheetCancel(menu);
  }

  // ── Call: homeowner, adjuster or the carrier's claims line ──────────
  function carrierFor(j) {
    const norm = String(j.carrier || '').toLowerCase().trim();
    if (!norm || !Array.isArray(window.insCarriers)) return null;
    return window.insCarriers.find(c => {
      const cn = String(c.name || '').toLowerCase().trim();
      return cn && (cn === norm || norm.includes(cn) || cn.includes(norm));
    }) || null;
  }
  function callTargets(j) {
    const out = [];
    const home = String(j.phone || '').replace(/[^\d+]/g, '');
    if (home) out.push({ icon: 'ti-home', label: 'Homeowner' + (j.name ? ' · ' + j.name : ''), note: (typeof formatPhone === 'function' && formatPhone(j.phone)) || j.phone, href: 'tel:' + home });
    if (j.adjPhone && typeof adjusterTelHref === 'function' && adjusterTelHref(j.adjPhone) !== '#') {
      out.push({ icon: 'ti-user', label: 'Adjuster' + (j.adjName ? ' · ' + j.adjName : ''), note: typeof formatAdjusterPhone === 'function' ? formatAdjusterPhone(j.adjPhone) : j.adjPhone, href: adjusterTelHref(j.adjPhone) });
    }
    const c = carrierFor(j);
    if (c && c.phone && typeof fmtPhoneTel === 'function') {
      out.push({ icon: 'ti-shield-check', label: c.name + ' claims', note: (typeof fmtPhoneDisplay === 'function' ? fmtPhoneDisplay(c.phone) : c.phone) + (j.claimNum ? ' · copies claim #' : ''), href: fmtPhoneTel(c.phone), claimNum: j.claimNum || '' });
    }
    return out;
  }
  function dial(t) {
    if (t.claimNum && navigator.clipboard) { try { navigator.clipboard.writeText(String(t.claimNum)).catch(() => {}); } catch (e) {} }
    window.location.href = t.href;
  }
  function openCallMenu(j) {
    const targets = callTargets(j);
    if (targets.length === 1) { dial(targets[0]); return; }
    const menu = sheet('Call', 'Call', targets.length ? (j.name || '') : 'No phone numbers on this job yet');
    if (!menu) return;
    targets.forEach(t => sheetItem(menu, t.icon, t.label, () => dial(t), { now: true, note: t.note }));
    sheetCancel(menu);
  }

  // ── Overview pieces ──────────────────────────────────────────────────
  function quickActions(j) {
    if (j.carrier && !Array.isArray(window.insCarriers) && typeof loadInsuranceCarriers === 'function') {
      try { loadInsuranceCarriers(); } catch (e) {}
    }
    const addr = (j.address && j.address !== '—') ? j.address : '';
    const acts = [
      { label: 'Call', icon: 'ti-phone', tone: 'green', fn: (callTargets(j).length || j.carrier) ? () => openCallMenu(j) : null },
      { label: 'Text', icon: 'ti-message-2', tone: 'blue', fn: typeof textLeadWithCard === 'function' ? () => textLeadWithCard(j.id) : null },
      { label: 'Directions', icon: 'ti-navigation', href: addr ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr) : '', newTab: true },
      { label: 'Upload', icon: 'ti-upload', tone: 'primary', fn: () => openUpload(j) },
      { label: 'Send card', icon: 'ti-id', tone: 'orange', fn: typeof textLeadCardPhoto === 'function' ? () => textLeadCardPhoto(j.id) : null }
    ];
    const row = document.createElement('div');
    row.className = 'rd-qa';
    acts.forEach(a => {
      const isLink = 'href' in a;
      const usable = isLink ? !!a.href : !!a.fn;
      const el = document.createElement(isLink && usable ? 'a' : 'button');
      el.className = 'rd-qa-btn' + (a.tone ? ' ' + a.tone : '') + (usable ? '' : ' off');
      if (isLink && usable) {
        el.href = a.href;
        if (a.newTab) { el.target = '_blank'; el.rel = 'noopener'; }
      } else {
        el.type = 'button';
        if (!usable) el.disabled = true;
        else el.addEventListener('click', e => { e.stopPropagation(); a.fn(); });
      }
      el.innerHTML = '<span class="rd-qa-ic">' + ICON(a.icon) + '</span><span class="rd-qa-l"></span>';
      el.querySelector('.rd-qa-l').textContent = a.label;
      row.appendChild(el);
    });
    return row;
  }

  // Keep a small piece of the new layout in step with numbers the CRM updates
  function watch(sources, fn) {
    fn();
    let queued = false;
    const run = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); };
    sources.filter(Boolean).forEach(s => new MutationObserver(run).observe(s, { childList: true, characterData: true, subtree: true }));
  }

  function moneyTiles(j) {
    const wrap = document.createElement('div');
    wrap.className = 'rd-tiles';
    const tile = (label, cls) => {
      const t = document.createElement('div');
      t.className = 'rd-tile' + (cls ? ' ' + cls : '');
      t.innerHTML = '<div class="rd-tile-l"></div><div class="rd-tile-v"></div>';
      t.firstChild.textContent = label;
      wrap.appendChild(t);
      return t.lastChild;
    };
    const vContract = tile('Contract'), vCollected = tile('Collected', 'pos'), vBalance = tile('Balance', 'due');
    const dep = $id('summaryDeposits'), bal = $id('summaryBalance');
    watch([dep, bal], () => {
      const d = num(dep && dep.textContent), b = num(bal && bal.textContent);
      // Contract = contract price + approved supplements (the CRM's balance already uses this total)
      let total = (d != null && b != null) ? d + b : null;
      if (total == null) { try { total = jobCommissionRevenue(j); } catch (e) {} }
      vContract.textContent = usd(total);
      vCollected.textContent = d == null ? '—' : usd(d);
      vBalance.textContent = b == null ? '—' : usd(b);
    });
    return wrap;
  }

  // ── Money rows: one ⋯ menu per row instead of loose edit / delete buttons ──
  // Each entry: which CRM button (by its onclick) goes into the menu, and how it is labelled.
  const ROW_ACTIONS = [
    { re: /^depEditOpen\(/, label: 'Edit', icon: 'ti-pencil' },
    { re: /^openDepositCheck\(/, label: 'View check photo', icon: 'ti-photo' },
    { re: /^depDelete\(/, label: 'Delete', icon: 'ti-trash', danger: true },
    { re: /^openExpenseInvoice\(/, label: 'View receipt / invoice', icon: 'ti-paperclip' },
    { re: /^printPmFeeReceipt\(/, label: 'Print PM fee receipt', icon: 'ti-printer' },
    { re: /^expDelete\(/, label: 'Delete', icon: 'ti-trash', danger: true },
    { re: /^suppEditOpen\(/, label: 'Edit', icon: 'ti-pencil' },
    { re: /^suppDelete\(/, label: 'Delete', icon: 'ti-trash', danger: true },
    { re: /^commDeleteSplit\(/, label: 'Delete split', icon: 'ti-trash', danger: true }
  ];
  const actionFor = el => ROW_ACTIONS.find(a => a.re.test((el.getAttribute('onclick') || '').trim()));
  function rowMenus(root) {
    const groups = new Map();
    root.querySelectorAll('button[onclick]').forEach(b => {
      if (b.classList.contains('rd-in-menu')) return;
      const a = actionFor(b);
      if (!a) return;
      const parent = b.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push({ el: b, a });
    });
    groups.forEach((items, parent) => {
      items.forEach(it => it.el.classList.add('rd-in-menu'));
      // put the ⋯ where the buttons were; keep it if the row already has one
      let more = parent.querySelector(':scope > .rd-row-more');
      if (!more) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'rd-row-more';
        more.setAttribute('aria-label', 'More options');
        more.innerHTML = ICON('ti-dots');
        parent.appendChild(more);
        more.addEventListener('click', e => {
          e.stopPropagation();
          const menu = sheet('Options');
          if (!menu) return;
          // expense rows edit by tapping their description; offer it here too
          const view = parent.closest('[id^="exp-view-"]');
          const editSpan = view && view.querySelector('[onclick^="expEditOpen"]');
          if (editSpan) sheetItem(menu, 'ti-pencil', 'Edit', () => editSpan.click());
          // read the row's buttons fresh each time (the CRM may redraw them)
          Array.from(parent.querySelectorAll(':scope > button.rd-in-menu')).forEach(btn => {
            const act = actionFor(btn);
            if (!act) return;
            if (act.danger && menu.querySelector('.rd-menu-item') && !menu.querySelector('.rd-menu-sep')) {
              const sep = document.createElement('div'); sep.className = 'rd-menu-sep'; menu.appendChild(sep);
            }
            sheetItem(menu, act.icon, act.label, () => btn.click(), { cls: act.danger ? 'danger' : '' });
          });
          sheetCancel(menu);
        });
      }
    });
    // deposits: a small money icon tile at the start of each row
    root.querySelectorAll('[id^="dep-view-"] > div:first-child').forEach(row => {
      if (row.querySelector(':scope > .rd-row-ic')) return;
      const ic = document.createElement('span');
      ic.className = 'rd-row-ic';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = ICON('ti-cash');
      row.insertBefore(ic, row.firstChild);
    });
  }

  // One math hint per form instead of "(try 800+1200)" in every box
  function amountHints(root) {
    root.querySelectorAll('input[placeholder*="try"]').forEach(inp => {
      inp.placeholder = inp.placeholder.replace(/\s*\(try[^)]*\)/i, '').trim() || '0.00';
    });
    ['cpNetClaim', 'depAmtInput', 'expAmtInput', 'suppAddAmt'].forEach(id => {
      const inp = $id(id);
      if (!inp || !root.contains(inp)) return;
      let box = inp.closest('[style*="background:#1E253A"]') || inp;
      // if the field sits in a row with other controls, put the tip under the whole row
      const row = box.parentElement;
      if (row && row.children.length > 1) {
        const cs = getComputedStyle(row);
        if (cs.display.indexOf('flex') >= 0 && cs.flexDirection.indexOf('row') === 0) box = row;
      }
      if (box.nextElementSibling && box.nextElementSibling.classList.contains('rd-hint')) return;
      const h = document.createElement('div');
      h.className = 'rd-hint';
      h.textContent = 'Tip: you can type math, like 800+1200';
      box.insertAdjacentElement('afterend', h);
    });
  }

  // Overhead: a Percent / Flat amount switch showing one field at a time.
  // Typing still saves through the CRM's own ovSetPct / ovSetFlat.
  function overheadSwitch(root, j) {
    const body = $id('ovBody'), pctBox = $id('ovPctBox'), flat = $id('ovFlatInput');
    if (!body || !root.contains(body) || !pctBox || !flat || body.querySelector('.rd-ov-switch')) return;
    const flatBox = flat.closest('div');
    const orText = Array.from(pctBox.parentElement.children).find(el => el.tagName === 'SPAN' && /^\s*or\s*$/i.test(el.textContent));
    let flatMode = false;
    try { flatMode = jobOverheadFlat(currentJob() || j) != null; } catch (e) { flatMode = !!flat.value; }
    const sw = document.createElement('div');
    sw.className = 'rd-ov-switch';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Overhead type');
    sw.innerHTML = '<button type="button" data-m="pct">Percent</button><button type="button" data-m="flat">Flat amount</button>';
    const show = () => {
      sw.querySelectorAll('button').forEach(b => {
        const on = (b.dataset.m === 'flat') === flatMode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      // toggle a class (not inline display) so the field keeps its own styling
      pctBox.classList.toggle('rd-hidden', flatMode);
      if (flatBox) flatBox.classList.toggle('rd-hidden', !flatMode);
      if (orText) orText.classList.add('rd-hidden');
    };
    sw.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      const toFlat = b.dataset.m === 'flat';
      if (toFlat === flatMode) return;
      flatMode = toFlat;
      // back to percent: clear the flat amount the CRM's own way
      if (!flatMode && flat.value !== '' && typeof ovSetPct === 'function') ovSetPct(($id('ovPctInput') || {}).value || '');
      show();
      const f = flatMode ? flat : $id('ovPctInput');
      if (f) f.focus();
    });
    body.insertBefore(sw, body.firstChild);
    const reset = body.querySelector('button[onclick^="ovReset"]');
    if (reset) { reset.classList.add('rd-ov-reset'); reset.setAttribute('aria-label', reset.title || 'Reset'); }
    show();
  }

  // Contract price opens to a short statement; "Edit breakdown" opens the CRM's form
  function contractStatement(j) {
    const wrap = document.createElement('div');
    wrap.className = 'rd-stmt';
    wrap.style.display = 'none';
    const rows = document.createElement('div');
    wrap.appendChild(rows);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'rd-stmt-edit';
    wrap.appendChild(edit);
    edit.addEventListener('click', e => {
      e.stopPropagation();
      const h = $id('cpAccHeader'), row = $id('cpEditRow');
      if (h && row && row.style.display === 'none') h.click();
      edit.style.display = 'none';
    });
    const draw = () => {
      const job = currentJob() || j;
      // "Edit breakdown" shows whenever the CRM's edit form is closed
      const row = $id('cpEditRow');
      edit.style.display = (row && row.style.display !== 'none') ? 'none' : '';
      const parts = [['Net claim', job.cpNetClaim], ['Deductible', job.cpDeductible], ['Depreciation', job.cpDepreciation]]
        .filter(p => p[1] != null && p[1] !== '' && !isNaN(parseFloat(p[1])));
      const key = parts.map(p => p.join(':')).join('|') + '|' + job.potVal;
      if (rows.dataset.key === key) return;
      rows.dataset.key = key;
      rows.innerHTML = '';
      const add = (label, val, cls) => {
        const r = document.createElement('div');
        r.className = 'rd-stmt-row' + (cls ? ' ' + cls : '');
        r.innerHTML = '<span></span><span></span>';
        r.firstChild.textContent = label;
        r.lastChild.textContent = val;
        rows.appendChild(r);
      };
      if (parts.length) {
        parts.forEach(p => add(p[0], usd(parseFloat(p[1]))));
        add('Total', usd(parseFloat(job.potVal) || 0), 'total');
      } else {
        const n = document.createElement('div');
        n.className = 'rd-stmt-empty';
        n.textContent = 'No breakdown yet: net claim, deductible and depreciation.';
        rows.appendChild(n);
      }
      edit.textContent = parts.length ? 'Edit breakdown' : 'Add breakdown';
    };
    // opening the line shows the statement; closing also closes the edit form
    const fakeHeader = {
      click() {
        const open = wrap.style.display !== 'none';
        wrap.style.display = open ? 'none' : 'block';
        if (!open) draw();
        const row = $id('cpEditRow'), h = $id('cpAccHeader');
        if (open && row && row.style.display !== 'none' && h) h.click();
      }
    };
    return { wrap, draw, fakeHeader };
  }

  // Money list: short lines, everything minimized. Tapping a line opens its
  // breakdown and the CRM's own form right underneath; tapping again closes it. The original cards stay
  // in the page, hidden, so every form, save and total runs exactly as before.
  function moneyList(j, holder) {
    const box = document.createElement('div');
    box.className = 'rd-fin';
    // open = the CRM has shown that part (it toggles inline display); fall back to the computed style
    const isOpen = el => {
      if (!el) return false;
      if (el.style.display) return el.style.display !== 'none';
      return el.isConnected ? getComputedStyle(el).display !== 'none' : false;
    };

    function line(opts, parent) {
      const wrap = document.createElement('div');
      wrap.className = 'rd-fin-item' + (opts.cls ? ' ' + opts.cls : '');
      const head = document.createElement(opts.header ? 'button' : 'div');
      head.className = 'rd-fin-row';
      if (opts.header) head.type = 'button';
      head.innerHTML = '<span class="rd-fin-name"></span><span class="rd-fin-r"><span class="rd-fin-v"></span></span>';
      head.querySelector('.rd-fin-name').textContent = opts.label;
      if (opts.header) {
        head.querySelector('.rd-fin-r').insertAdjacentHTML('beforeend', CHEVRON);
        head.setAttribute('aria-expanded', 'false');
      }
      wrap.appendChild(head);
      const slot = document.createElement('div');
      slot.className = 'rd-fin-slot';
      wrap.appendChild(slot);
      (opts.parts || []).forEach(p => { if (p) slot.appendChild(p); });
      const sync = () => {
        const open = isOpen(opts.body);
        wrap.classList.toggle('open', open);
        if (opts.header) head.setAttribute('aria-expanded', String(open));
      };
      if (opts.header) {
        head.addEventListener('click', e => {
          e.stopPropagation();
          opts.header.click();               // the CRM's own open/close (fills the form as before)
          requestAnimationFrame(sync);
        });
      }
      sync();
      (parent || box).appendChild(wrap);
      return { value: head.querySelector('.rd-fin-v'), name: head.querySelector('.rd-fin-name'), slot, sync };
    }

    const L = {};
    const stmt = contractStatement(j);
    if ($id('cpBreakdownSummary')) $id('cpBreakdownSummary').classList.add('rd-hidden');   // the statement replaces it
    L.contract = line({ label: 'Contract price', header: stmt.fakeHeader, body: stmt.wrap, parts: [stmt.wrap, $id('cpEditRow')] });
    L.supp = line({ label: 'Supplements', header: $id('suppHeader'), body: $id('suppBody'), parts: [$id('suppBody')] });
    L.checks = line({ label: 'Checks collected', header: $id('depAccHeader'), body: $id('depBody'), parts: [$id('depBody')] });
    // Expenses: the per-type breakdown only shows once the line is opened
    L.exp = line({ label: 'Expenses', header: $id('expAccHeader'), body: $id('expBody'), parts: [$id('expBody')], cls: 'cost' });
    // Net profit, Overhead and Commission are regular lines like the rest
    L.net = line({ label: 'Net profit', header: $id('profitHeader'), body: $id('profitPrintBtn'), parts: [$id('profitPrintBtn')], cls: 'net' });
    const ovEditable = !!$id('ovChev');
    L.over = line({ label: 'Overhead', header: ovEditable ? $id('ovHeader') : null, body: $id('ovBody'), parts: [$id('ovBody')] });
    L.comm = line({ label: 'Commission', header: $id('commAccHeader'), body: $id('jobCommBody'), parts: [$id('jobCommBody')], cls: 'comm' });

    const set = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    const draw = () => {
      const job = currentJob() || j;
      set(L.contract.value, cleanUsd($id('cpDisplay') && $id('cpDisplay').textContent));
      let supp = 0;
      try { supp = supplementsApprovedTotal(job) || 0; } catch (e) {}
      set(L.supp.value, supp ? usd(supp, '+') : '$0');
      L.supp.value.classList.toggle('zero', !supp);
      set(L.checks.value, cleanUsd($id('summaryDeposits') && $id('summaryDeposits').textContent));
      const byCat = {};
      let total = 0;
      (job.expenses || []).forEach(e => {
        let v = 0;
        try { v = moneyValue(e.amount); } catch (err) { v = parseFloat(e.amount) || 0; }
        if (!v) return;
        const c = e.cat || 'Other';
        byCat[c] = (byCat[c] || 0) + v;
        total += c === 'Returns' ? -Math.abs(v) : Math.abs(v);
      });
      set(L.exp.value, total ? usd(total, '-') : '$0');
      const n = num($id('profitNet') && $id('profitNet').textContent);
      set(L.net.value, n == null ? '—' : usd(n));
      L.net.value.classList.toggle('neg', n != null && n < 0);
      const pct = $id('overheadPctLabel');
      set(L.over.value, cleanUsd($id('overheadAmt') && $id('overheadAmt').textContent));
      set(L.over.name, 'Overhead' + (pct && pct.textContent ? ' (' + pct.textContent.trim() + ')' : ''));
      set(L.comm.value, cleanUsd($id('commAccTotal') && $id('commAccTotal').textContent));
      Object.values(L).forEach(l => l.sync());
      if (stmt.wrap.style.display !== 'none') stmt.draw();   // also brings back "Edit breakdown" after a save
      rowMenus(box);
      amountHints(box);
      overheadSwitch(box, job);
    };
    watch([holder, box], draw);
    requestAnimationFrame(draw);   // once more after the list is on screen
    return box;
  }

  function roofTiles(j, calc) {
    const wrap = document.createElement('div');
    wrap.className = 'rd-roof';
    const est = j.roofEstimate && j.roofEstimate.totalSqFt > 0 ? j.roofEstimate : null;
    const qm = document.createElement('button');
    qm.type = 'button';
    qm.className = 'rd-roof-tile accent';
    qm.innerHTML = '<span class="rd-roof-l">Quick Measure</span><span class="rd-roof-v"></span><span class="rd-roof-s"></span>';
    qm.querySelector('.rd-roof-v').textContent = est ? (Number(est.totalSquares) || 0).toFixed(1) + ' sqs' : 'Not measured';
    qm.querySelector('.rd-roof-s').textContent = est ? Math.round(est.totalSqFt).toLocaleString() + ' sq ft · tap to redo' : 'Tap to measure the roof';
    qm.addEventListener('click', e => {
      e.stopPropagation();
      const b = $id('quickMeasureBtn');
      if (b) b.click(); else if (typeof openQuickMeasure === 'function') openQuickMeasure();
    });
    wrap.appendChild(qm);

    const mc = document.createElement('button');
    mc.type = 'button';
    mc.className = 'rd-roof-tile';
    mc.setAttribute('aria-expanded', String(calcOpen));
    mc.innerHTML = '<span class="rd-roof-l">Min. contract</span><span class="rd-roof-v"></span><span class="rd-roof-s"></span>';
    const src = $id('ccContract');
    watch([src], () => {
      const v = num(src && src.textContent);
      mc.querySelector('.rd-roof-v').textContent = v ? usd(v) : (est ? 'Open' : 'Needs measure');
      mc.querySelector('.rd-roof-s').textContent = calcOpen ? 'Hide calculator' : 'Open calculator';
    });
    if (calc) {
      calc.classList.toggle('rd-hidden', !calcOpen);
      mc.addEventListener('click', e => {
        e.stopPropagation();
        calcOpen = !calcOpen;
        calc.classList.toggle('rd-hidden', !calcOpen);
        mc.setAttribute('aria-expanded', String(calcOpen));
        mc.querySelector('.rd-roof-s').textContent = calcOpen ? 'Hide calculator' : 'Open calculator';
      });
    }
    wrap.appendChild(mc);
    return wrap;
  }

  function section(parent, title, cls) {
    const s = document.createElement('section');
    s.className = 'rd-sec' + (cls ? ' ' + cls : '');
    if (title) {
      const h = document.createElement('h3');
      h.className = 'rd-sec-title';
      h.textContent = title;
      s.appendChild(h);
    }
    parent.appendChild(s);
    return s;
  }
  function collapsible(parent, title, sub, isOpen, onToggle) {
    const s = section(parent, '', 'rd-tools' + (isOpen ? ' open' : ''));
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'rd-tools-head';
    head.setAttribute('aria-expanded', String(isOpen));
    head.innerHTML = '<span class="rd-tools-t"><span class="rd-sec-title"></span><span class="rd-tools-sub"></span></span>' + CHEVRON;
    head.querySelector('.rd-sec-title').textContent = title;
    head.querySelector('.rd-tools-sub').textContent = sub;
    const body = document.createElement('div');
    body.className = 'rd-tools-body';
    const set = open => { s.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); onToggle(open); };
    head.addEventListener('click', e => { e.stopPropagation(); set(!s.classList.contains('open')); });
    s.appendChild(head);
    s.appendChild(body);
    return { body, set };
  }

  function nextStageName(j) {
    try {
      const cols = columnsForPipeline(pipelineForJob(j)?.id);
      const i = cols.findIndex(c => c.id === j.col);
      return cols[i + 1] ? cols[i + 1].name : '';
    } catch (e) { return ''; }
  }

  function rebuildOverview(panel, j) {
    const body = panel.querySelector('#dpBody');
    if (!body || body.querySelector('.rd-ov')) return;
    const q = s => body.querySelector(s);
    const twoCol = q('.two-col');
    if (!twoCol || twoCol.children.length < 2) return;   // unexpected layout: leave the original as is
    const leftCol = twoCol.children[0];

    const jobBar = q('.job-bar');
    const checklist = q('.checklist-box');
    const contact = leftCol.querySelector(':scope > .dp-card');
    const textBtn = q('button[onclick^="textLeadWithCard"]');
    const btnRow = textBtn ? textBtn.parentElement : null;
    const logBtn = q('button[onclick^="openLogContact"]');
    const lastContact = logBtn ? logBtn.closest('.dp-card') : null;
    const zoho = q('#zohoSyncBtn') ? q('#zohoSyncBtn').closest('.dp-card') : null;
    const wx = q('#jobWxBox');
    const measure = q('#quickMeasureBtn') ? q('#quickMeasureBtn').closest('.dp-card') : null;
    const calc = q('#contractCalcCard');
    const moneyCards = ['#contractSummaryCard', '#expAcc', '#profitCard', '#overheadCard', '#commAcc'].map(q).filter(Boolean);
    const meta = Array.from(body.querySelectorAll('.meta-table')).map(t => t.closest('.dp-card')).find(c => c && /Created By/i.test(c.textContent)) || null;
    const actions = q('#dpMove') ? q('#dpMove').parentElement : null;

    const ov = document.createElement('div');
    ov.className = 'rd-ov';
    body.insertBefore(ov, body.firstChild);   // in the page from the start, so lookups by id keep working


    // 2. Customer & claim (Save to phone contacts is the green icon on the name row)
    const cust = section(ov, 'Customer & claim');
    // "Save to contacts" sits on the title line, right-aligned
    if (typeof saveJobContactToPhone === 'function') {
      const t = cust.querySelector('.rd-sec-title');
      const head = document.createElement('div');
      head.className = 'rd-sec-head';
      cust.insertBefore(head, t);
      head.appendChild(t);
      const sv = document.createElement('button');
      sv.type = 'button';
      sv.className = 'rd-sec-save';
      sv.innerHTML = ICON('ti-user-plus') + '<span>Save to contacts</span>';
      sv.addEventListener('click', e => { e.stopPropagation(); saveJobContactToPhone(j.id); });
      head.appendChild(sv);
    }
    if (contact) cust.appendChild(contact);

    // 3. Next step
    const next = section(ov, 'Next step');
    [checklist, lastContact].forEach(el => el && next.appendChild(el));

    // 4. Money: tiles + one list where each line opens its own form
    const mon = section(ov, 'Money');
    mon.appendChild(moneyTiles(j));
    const holder = document.createElement('div');      // the CRM's own money cards, kept but hidden
    holder.className = 'rd-hidden rd-money-src';
    moneyCards.forEach(el => holder.appendChild(el));
    mon.appendChild(holder);                            // in the page first, so the list can find the forms
    mon.insertBefore(moneyList(j, holder), holder);
    if (zoho) mon.insertBefore(zoho, holder);

    // 5. Roof & min. contract (always visible)
    const roof = section(ov, 'Roof & min. contract');
    roof.appendChild(roofTiles(j, calc));
    if (calc) roof.appendChild(calc);

    // 5b. Estimates, orders & invoices: these buttons live inside the calculator
    // card in the CRM; pull them out so they stay one tap away.
    const DOC_BTN = /openInsuranceEstimator|activeTab='quote'|activeTab='contract'|openAbcMaterialCalc|openSubVoucher|openCommVoucher|openFinalInvoice/;
    const docBtns = calc ? Array.from(calc.querySelectorAll('button[onclick]')).filter(b => DOC_BTN.test(b.getAttribute('onclick') || '')) : [];
    if (docBtns.length) {
      const docs = collapsible(ov, 'Estimates, orders & invoices', 'Quote · Contract · Material order · Final invoice', docsOpen, open => { docsOpen = open; });
      const dgrid = document.createElement('div');
      dgrid.className = 'rd-links rd-docs';
      docBtns.forEach(b => dgrid.appendChild(b));
      docs.body.appendChild(dgrid);
    }

    // 6. Quick links
    const links = collapsible(ov, 'Quick links', 'Customer portal · Inspection · COC · Weather DOL · Schedule', linksOpen, open => { linksOpen = open; });
    const grid = document.createElement('div');
    grid.className = 'rd-links';
    if (jobBar) jobBar.querySelectorAll('.ap-pill').forEach(p => grid.appendChild(p));
    links.body.appendChild(grid);

    // 7. More tools (closed)
    const tools = collapsible(ov, 'More tools', 'Roofr import · Demand Estimate · Weather', toolsOpen, open => { toolsOpen = open; });
    [measure, wx].forEach(el => el && tools.body.appendChild(el));

    // 8. Job info
    if (meta) {
      const info = collapsible(ov, 'Job info', 'Created by · Assigned to · Date · Source', infoOpen, open => { infoOpen = open; });
      info.body.appendChild(meta);
    }

    // Anything not placed above (e.g. a card added to the CRM later) still shows
    const leftovers = Array.from(twoCol.children).flatMap(c => Array.from(c.children)).filter(el => el !== btnRow && el !== actions);
    if (leftovers.length) {
      const more = section(ov, 'More');
      leftovers.forEach(el => more.appendChild(el));
    }

    // The old Text Lead / Send Card row is replaced by the quick actions;
    // kept (hidden) so nothing that looks for it breaks.
    if (btnRow) { btnRow.classList.add('rd-hidden'); ov.appendChild(btnRow); }

    if (actions) {
      actions.classList.add('rd-actionbar');
      const mv = actions.querySelector('#dpMove');
      const nm = nextStageName(j);
      if (mv && nm) {
        mv.innerHTML = '<span></span>' + ICON('ti-arrow-right');
        mv.firstChild.textContent = 'Move to ' + nm;
      }
      ov.appendChild(actions);
    }

    // Quick actions stay pinned at the bottom of the screen while scrolling
    const qa = quickActions(j);
    qa.classList.add('rd-qa-bar');
    ov.appendChild(qa);

    // Shorter label so Add Expense and Upload invoice fit side by side on a phone
    const abc = $id('abcImportBtn');
    if (abc) {
      const t = Array.from(abc.childNodes).find(n => n.nodeType === 3 && /Upload Invoice/i.test(n.textContent));
      if (t) t.textContent = 'Upload invoice';
      abc.title = 'Upload a supplier invoice (PDF)';
    }

    twoCol.remove();
    if (jobBar && !jobBar.querySelector('.ap-pill')) jobBar.remove();
  }

  function decorate() {
    if (!document.documentElement.classList.contains('ui-new')) return;
    const panel = $id('detailPanel');
    const j = currentJob();
    if (!panel || !j) return;
    closeMenu();
    panel.classList.add('rd-job');
    decorateHeader(panel, j);
    if (currentTab() === 'overview') rebuildOverview(panel, j);
  }

  // Expense groups (Materials, Labor...) start closed; the CRM opens a group
  // unless it is marked false, so unknown groups read as closed here.
  function closedGroups() {
    return new Proxy({}, { get: (t, k) => (k in t ? t[k] : false) });
  }
  function resetForNewJob() {
    const j = currentJob();
    if (!j || j.id === lastJobId) return;
    lastJobId = j.id;
    toolsOpen = calcOpen = docsOpen = linksOpen = infoOpen = false;
    window._expCatOpen = closedGroups();
  }

  function init() {
    if (typeof window.renderDetailPanel !== 'function' || window.renderDetailPanel.__rd) return;
    const original = window.renderDetailPanel;
    const wrapped = function () {
      try { resetForNewJob(); } catch (e) {}
      const r = original.apply(this, arguments);
      try { decorate(); } catch (e) { console.warn('job screen redesign skipped', e); }
      return r;
    };
    wrapped.__rd = true;
    window.renderDetailPanel = wrapped;
    const ov = $id('detailOverlay');
    if (ov && ov.classList.contains('open')) { try { decorate(); } catch (e) {} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── Edit Job / New Job form (new look): folded sections, labels on every field ──
   Re-arranges the CRM's own form fields into sections, so saving, the address
   suggestions, the claim-amount math and the drafts all keep working as before. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let built = false;
  const S = {};          // section id -> {wrap, head, sub, body}

  const money = v => {
    const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) && n ? '$' + Math.round(n).toLocaleString('en-US') : '';
  };
  const val = id => { const e = $(id); return e ? String(e.value || '').trim() : ''; };
  const selText = id => { const e = $(id); if (!e || !e.value) return ''; const o = e.options[e.selectedIndex]; return o ? o.textContent.trim() : ''; };

  function field(label, el, opts) {
    opts = opts || {};
    if (!el) return null;
    const f = document.createElement('div');
    f.className = 'rf-f' + (opts.cls ? ' ' + opts.cls : '');
    const l = document.createElement('label');
    l.textContent = label;
    if (el.id) l.htmlFor = el.id;
    f.appendChild(l);
    if (opts.extra) l.appendChild(opts.extra);
    f.appendChild(opts.box || el);
    if (el.placeholder) el.placeholder = el.placeholder.replace(/\s*\(try[^)]*\)/i, '').replace(/\s*\(e\.g\.[^)]*\)/i, '');
    return f;
  }
  function row(cls, items) {
    const r = document.createElement('div');
    r.className = 'rf-row ' + cls;
    items.filter(Boolean).forEach(i => r.appendChild(i));
    return r;
  }
  function section(id, icon, title, parent) {
    const wrap = document.createElement('div');
    wrap.className = 'rf-sec';
    wrap.dataset.sec = id;
    wrap.innerHTML = '<button type="button" class="rf-head"><span class="rf-ic"><i class="ti ' + icon + '"></i></span>' +
      '<span class="rf-tt"><b></b><span class="rf-sub"></span></span><i class="ti ti-chevron-down rf-chev"></i></button><div class="rf-body"></div>';
    wrap.querySelector('b').textContent = title;
    wrap.querySelector('.rf-head').addEventListener('click', () => wrap.classList.toggle('open'));
    parent.appendChild(wrap);
    S[id] = { wrap, sub: wrap.querySelector('.rf-sub'), body: wrap.querySelector('.rf-body') };
    return S[id].body;
  }
  const dollarBox = id => { const i = $(id); if (!i) return null; i.classList.add('rf-inbox'); i.parentElement.classList.add('rf-box'); return i.parentElement; };

  function build() {
    const modal = document.querySelector('#addJobModal .modal');
    if (!modal || built) return;
    const head = modal.children[0], body = modal.children[1], foot = modal.children[2];
    if (!head || !body || !$('f-firstname')) return;
    built = true;
    modal.classList.add('rf-modal'); head.classList.add('rf-top'); body.classList.add('rf-scroll'); if (foot) foot.classList.add('rf-foot');
    const old = Array.from(body.children);
    const host = document.createElement('div');
    host.className = 'rf-secs';
    body.appendChild(host);

    // Customer
    let b = section('cust', 'ti-user', 'Customer', host);
    b.appendChild(row('g1', [field('First name', $('f-firstname'))]));
    b.appendChild(row('g1', [field('Last name', $('f-lastname'))]));
    b.appendChild(row('g-ext', [field('Phone', $('f-phone')), field('Ext.', $('f-ext'))]));
    b.appendChild(row('g1', [field('Email', $('f-email'))]));
    b.appendChild(row('g1', [field('Lead source', $('f-source'))]));

    // Property
    b = section('prop', 'ti-map-pin', 'Property', host);
    const gps = $('aj-gpsBtn');
    if (gps) gps.classList.add('rf-gps');
    const streetWrap = $('f-street') && $('f-street').closest('.addr-autocomplete-wrap');
    b.appendChild(row('g1', [field('Street', $('f-street'), { box: streetWrap || $('f-street'), extra: gps })]));
    b.appendChild(row('g1', [field('Apt / suite', $('f-apt'))]));
    b.appendChild(row('g-csz', [field('City', $('f-city')), field('State', $('f-state')), field('ZIP', $('f-zip'))]));

    // Team & stage
    b = section('team', 'ti-users', 'Team & stage', host);
    const assign = $('aj-dropTrigger') && $('aj-dropTrigger').parentElement;
    b.appendChild(row('g1', [field('Assigned to', $('aj-dropTrigger'), { box: assign })]));
    b.appendChild(row('g1', [field('Stage', $('f-stage'))]));
    b.appendChild(row('g-pm', [field('Project manager', $('f-pm')), field('PM fee', $('f-pmFee'))]));

    // Insurance claim (with the on/off switch)
    b = section('ins', 'ti-shield-check', 'Insurance claim', host);
    const tog = $('aj-insToggle');
    const togRow = document.createElement('div');
    togRow.className = 'rf-toggle';
    togRow.innerHTML = '<span>This is an insurance claim</span>';
    if (tog) togRow.appendChild(tog);
    b.appendChild(togRow);
    const insBox = document.createElement('div');
    insBox.className = 'rf-insonly';
    insBox.appendChild(row('g2', [field('Carrier', $('f-carrier')), field('Claim type', $('f-claimtype'))]));
    insBox.appendChild(row('g2', [field('Claim #', $('f-claimnum')), field('Policy #', $('f-policynum'))]));
    const dol = $('f-dol');
    insBox.appendChild(row('g2', [field('Date of loss', dol, { box: dollarBox('f-dol') }), field('Claim status', $('f-claimstatus'))]));
    b.appendChild(insBox);

    // Claim amounts
    b = section('amt', 'ti-currency-dollar', 'Claim amounts', host);
    b.appendChild(row('g2', [field('RCV (claim amount)', $('f-rcv'), { box: dollarBox('f-rcv') }), field('Deductible', $('f-deductible'), { box: dollarBox('f-deductible') })]));
    b.appendChild(row('g2', [field('Recoverable dep.', $('f-recovdep'), { box: dollarBox('f-recovdep') }), field('Non-recov. dep.', $('f-nonrecovdep'), { box: dollarBox('f-nonrecovdep') })]));
    const acv = field('ACV (RCV − depreciation)', $('f-acv'), { box: dollarBox('f-acv'), cls: 'rf-result', extra: $('f-acv-status') });
    const net = field('Net claim (ACV − deductible)', $('f-netclaim'), { box: dollarBox('f-netclaim'), cls: 'rf-result', extra: $('f-netclaim-status') });
    b.appendChild(row('g1', [acv]));
    b.appendChild(row('g1', [net]));
    const tip = document.createElement('div');
    tip.className = 'rf-hint';
    tip.textContent = 'Fill in any 4 and the 5th works itself out. ACV syncs with the Loss Statement. Tip: you can type math, like 800+1200.';
    b.appendChild(tip);

    // Adjuster
    b = section('adj', 'ti-user-search', 'Adjuster', host);
    b.appendChild(row('g2', [field('Adjuster name', $('f-adjname')), field('Adjuster phone', $('f-adjphone'))]));
    b.appendChild(row('g1', [field('Insurance email (for depreciation release)', $('f-insemail'))]));
    b.appendChild(row('g1', [field('Adjuster inspection date', $('f-inspdate'))]));

    // Notes
    b = section('notes', 'ti-notes', 'Claim notes', host);
    b.appendChild(row('g1', [field('Notes', $('f-claimnotes'))]));

    // The old containers are now empty shells; keep search + draft banner.
    old.forEach(el => { if (el.id !== 'aj-searchWrap' && el.id !== 'aj-draftBanner' && !host.contains(el)) el.classList.add('rf-emptied'); });

    body.addEventListener('input', summarize);
    body.addEventListener('change', summarize);
    const insFields = $('aj-insFields');
    if (insFields) new MutationObserver(syncIns).observe(insFields, { attributes: true, attributeFilter: ['style'] });
    const dd = $('aj-dropDisplay');
    if (dd) new MutationObserver(summarize).observe(dd, { childList: true, subtree: true, characterData: true });
  }

  function insOn() { const f = $('aj-insFields'); return !!(f && f.style.display !== 'none'); }
  function syncIns() {
    const on = insOn();
    ['amt', 'adj', 'notes'].forEach(k => { if (S[k]) S[k].wrap.classList.toggle('rf-off', !on); });
    const box = document.querySelector('#addJobModal .rf-insonly');
    if (box) box.style.display = on ? '' : 'none';
    summarize();
  }
  function summarize() {
    if (!built) return;
    const set = (k, t) => { if (S[k]) S[k].sub.textContent = t; };
    const name = [val('f-firstname'), val('f-lastname')].filter(Boolean).join(' ');
    set('cust', [name, val('f-phone')].filter(Boolean).join(' · ') || 'Name, phone, email');
    set('prop', [val('f-street'), val('f-city')].filter(Boolean).join(', ') || 'No address yet');
    const who = ($('aj-dropDisplay') ? $('aj-dropDisplay').textContent.trim() : '').replace(/^[—–\-\s]+/, '').replace(/^Select team member…$/, 'Unassigned');
    const stg = selText('f-stage'); const stage = stg === stg.toUpperCase() ? stg.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : stg;
    set('team', [stage, who || 'Unassigned', val('f-pm') ? selText('f-pm') : 'No PM'].filter(Boolean).join(' · '));
    set('ins', insOn() ? ([val('f-carrier'), val('f-claimnum') ? '#' + val('f-claimnum') : '', selText('f-claimstatus')].filter(Boolean).join(' · ') || 'Insurance claim — details not added') : 'Not an insurance claim');
    set('amt', [money(val('f-rcv')) ? 'RCV ' + money(val('f-rcv')) : '', money(val('f-netclaim')) ? 'Net claim ' + money(val('f-netclaim')) : ''].filter(Boolean).join(' · ') || 'No amounts yet');
    set('adj', val('f-adjname') || 'Not added yet');
    const n = val('f-claimnotes');
    set('notes', n ? (n.length > 48 ? n.slice(0, 48) + '…' : n) : 'No notes');
    const top = document.querySelector('#addJobModal .rf-top');
    if (top) top.dataset.who = name;
  }
  function onOpen() {
    build();
    if (!built) return;
    const editing = /edit/i.test(($('aj-modalTitle') || {}).textContent || '');
    const openNow = editing ? [] : ['cust', 'prop', 'team'];
    Object.keys(S).forEach(k => S[k].wrap.classList.toggle('open', openNow.includes(k)));
    syncIns();
    setTimeout(() => {   // after the CRM finishes filling the fields
      summarize();
      const sub = $('aj-modalSubtitle'), nm = [val('f-firstname'), val('f-lastname')].filter(Boolean).join(' ');
      if (editing && sub && nm) sub.textContent = nm;
    }, 60);
    const sc = document.querySelector('#addJobModal .rf-scroll'); if (sc) sc.scrollTop = 0;
  }
  // If Save stops on a missing name, open Customer so the reason is visible.
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('#saveJob') || !built) return;
    if (!val('f-firstname') && !val('f-lastname') && S.cust) S.cust.wrap.classList.add('open');
  }, true);

  function init() {
    const m = $('addJobModal');
    if (!m) return;
    let was = m.classList.contains('open');
    new MutationObserver(() => { const now = m.classList.contains('open'); if (now && !was) onOpen(); was = now; }).observe(m, { attributes: true, attributeFilter: ['class'] });
    if (m.classList.contains('open')) onOpen();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
