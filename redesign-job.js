/* StormShield CRM redesign — job screen (Overview clean-up).
   Loaded only with ?ui=new (see the loader in index.html).

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

  // ── Header: address under the name, days in stage, ⋯ menu ─────────────
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
    if (status && !panel.querySelector('.rd-days')) {
      let d = null;
      try { d = daysInStage(j); } catch (e) {}
      if (d != null && !isNaN(d)) {
        const s = document.createElement('span');
        s.className = 'rd-days';
        s.textContent = d + (d === 1 ? ' day' : ' days') + ' in stage';
        status.appendChild(s);
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

  // ── Overview pieces ──────────────────────────────────────────────────
  function quickActions(j) {
    const phone = String(j.phone || '').replace(/[^\d+]/g, '');
    const addr = (j.address && j.address !== '—') ? j.address : '';
    const acts = [
      { label: 'Call', icon: 'ti-phone', tone: 'green', href: phone ? 'tel:' + phone : '' },
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

  // Money list: five short lines, everything minimized. Tapping a line opens
  // its breakdown and the CRM's own form right underneath; tapping again closes
  // it. Overhead and Commission sit inside Net profit. The original cards stay
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
    L.contract = line({ label: 'Contract price', header: $id('cpAccHeader'), body: $id('cpEditRow'),
                        parts: [$id('cpBreakdownSummary'), $id('cpEditRow')] });
    L.supp = line({ label: 'Supplements', header: $id('suppHeader'), body: $id('suppBody'), parts: [$id('suppBody')] });
    L.checks = line({ label: 'Checks collected', header: $id('depAccHeader'), body: $id('depBody'), parts: [$id('depBody')] });
    // Expenses: the per-type breakdown only shows once the line is opened
    L.exp = line({ label: 'Expenses', header: $id('expAccHeader'), body: $id('expBody'), parts: [$id('expBody')], cls: 'cost' });
    // Net profit: opening it shows overhead, commission and the P&L print
    L.net = line({ label: 'Net profit', header: $id('profitHeader'), body: $id('profitPrintBtn'), cls: 'net' });
    const ovEditable = !!$id('ovChev');
    L.over = line({ label: 'Overhead', header: ovEditable ? $id('ovHeader') : null, body: $id('ovBody'), parts: [$id('ovBody')], cls: 'nested' }, L.net.slot);
    L.comm = line({ label: 'Commission', header: $id('commAccHeader'), body: $id('jobCommBody'), parts: [$id('jobCommBody')], cls: 'nested' }, L.net.slot);
    if ($id('profitPrintBtn')) L.net.slot.appendChild($id('profitPrintBtn'));

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
    const saveBtn = q('button[onclick^="saveJobContactToPhone"]');
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


    // 2. Customer & claim (+ Save to phone contacts)
    const cust = section(ov, 'Customer & claim');
    if (contact) {
      cust.appendChild(contact);
      if (saveBtn) { saveBtn.classList.add('rd-save-contact'); contact.appendChild(saveBtn); }
    }

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
