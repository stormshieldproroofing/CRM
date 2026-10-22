/* StormShield CRM redesign — job screen (Overview clean-up).
   Loaded only with ?ui=new (see the loader in index.html).

   It does not re-create anything: after the CRM draws a job, this file moves
   the existing pieces (checklist, contact card, deposits, expenses, contract
   calculator...) into a cleaner order and adds a few shortcuts that simply
   press the CRM's own buttons. Every form and button keeps its original code. */
(function () {
  const ICON = n => '<i class="ti ' + n + '" aria-hidden="true"></i>';
  const CHEVRON = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';
  let toolsOpen = false;   // the tools section starts closed for every job
  let lastJobId = null;

  function currentJob() {
    try { return jobs.find(x => x.id === openJobId) || null; } catch (e) { return null; }
  }
  function currentTab() {
    try { return activeTab; } catch (e) { return ''; }
  }
  const later = fn => setTimeout(fn, 0);   // let the current tap finish before pressing another button

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

  function closeMenu() {
    document.querySelectorAll('.rd-menu-wrap').forEach(m => m.remove());
  }
  function openMenu(j) {
    closeMenu();
    const overlay = document.getElementById('detailOverlay');
    if (!overlay) return;
    const click = id => () => { const el = document.getElementById(id); if (el) el.click(); };
    const items = [
      ['ti-pencil', 'Edit job', click('dpEdit')],
      ['ti-git-branch', 'Change pipeline', click('jobPipelineSelector')],
      ['ti-progress', 'Change stage', click('stageSelector')]
    ];
    if (typeof saveJobContactToPhone === 'function') items.push(['ti-address-book', 'Save to phone contacts', () => saveJobContactToPhone(j.id)]);

    const wrap = document.createElement('div');
    wrap.className = 'rd-menu-wrap';
    wrap.innerHTML = '<div class="rd-menu-bg"></div><div class="rd-menu" role="dialog" aria-label="Job actions"><div class="rd-menu-handle" aria-hidden="true"></div></div>';
    const menu = wrap.querySelector('.rd-menu');
    const add = (icon, label, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-menu-item' + (cls ? ' ' + cls : '');
      b.innerHTML = '<span class="rd-menu-ic">' + ICON(icon) + '</span><span></span>';
      b.lastChild.textContent = label;
      b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); later(fn); });
      menu.appendChild(b);
    };
    items.forEach(([i, l, f]) => add(i, l, f));
    if (document.getElementById('dpDelete')) {
      const sep = document.createElement('div');
      sep.className = 'rd-menu-sep';
      menu.appendChild(sep);
      add('ti-trash', 'Delete job', click('dpDelete'), 'danger');
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rd-menu-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', e => { e.stopPropagation(); closeMenu(); });
    menu.appendChild(cancel);
    wrap.querySelector('.rd-menu-bg').addEventListener('click', e => { e.stopPropagation(); closeMenu(); });
    overlay.appendChild(wrap);
    const first = menu.querySelector('.rd-menu-item');
    if (first) first.focus();
  }

  // ── Tabs: first four shown, the rest under "More" ────────────────────
  const KEEP_TABS = 4;
  function tabLabel(t) {
    return Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  }
  function decorateTabs(panel) {
    const bar = panel.querySelector('.dp-tabs');
    if (!bar || bar.dataset.rd) return;
    bar.dataset.rd = '1';
    const tabs = Array.from(bar.querySelectorAll('.dp-tab'));
    if (tabs.length <= KEEP_TABS + 1) return;
    const extra = tabs.slice(KEEP_TABS);
    const activeExtra = extra.find(t => t.classList.contains('active'));
    extra.forEach(t => t.classList.add('rd-tab-hidden'));

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'dp-tab rd-tab-more' + (activeExtra ? ' active' : '');
    more.setAttribute('aria-haspopup', 'true');
    more.innerHTML = '<span></span>' + CHEVRON;
    more.firstChild.textContent = activeExtra ? tabLabel(activeExtra) : 'More';
    if (extra.some(t => t.querySelector('.dp-tab-badge'))) more.classList.add('has-badge');
    bar.appendChild(more);

    more.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.querySelector('.rd-tabmenu');
      if (open) { open.remove(); return; }
      const header = panel.querySelector('.dp-header-area');
      const menu = document.createElement('div');
      menu.className = 'rd-tabmenu';
      menu.setAttribute('role', 'menu');
      extra.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = 'rd-tabmenu-item' + (t.classList.contains('active') ? ' active' : '');
        b.innerHTML = '<span></span>';
        b.firstChild.textContent = tabLabel(t);
        const badge = t.querySelector('.dp-tab-badge-slot');
        if (badge) b.insertAdjacentHTML('beforeend', badge.innerHTML);
        b.addEventListener('click', ev => { ev.stopPropagation(); menu.remove(); t.click(); });
        menu.appendChild(b);
      });
      menu.style.top = (bar.offsetTop + bar.offsetHeight + 6) + 'px';
      header.appendChild(menu);
      const away = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', away, true); } };
      document.addEventListener('click', away, true);
    });
  }

  // ── Overview: new order ──────────────────────────────────────────────
  function quickActions(j) {
    const phone = String(j.phone || '').replace(/[^\d+]/g, '');
    const addr = (j.address && j.address !== '—') ? j.address : '';
    const acts = [
      { label: 'Call', icon: 'ti-phone', tone: 'green', href: phone ? 'tel:' + phone : '' },
      { label: 'Text', icon: 'ti-message-2', tone: 'blue', fn: typeof textLeadWithCard === 'function' ? () => textLeadWithCard(j.id) : null },
      { label: 'Directions', icon: 'ti-navigation', href: addr ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr) : '', newTab: true },
      { label: 'Send card', icon: 'ti-id', tone: 'orange', fn: typeof textLeadCardPhoto === 'function' ? () => textLeadCardPhoto(j.id) : null },
      { label: 'Log contact', icon: 'ti-pencil', fn: typeof openLogContact === 'function' ? () => openLogContact(j.id) : null }
    ];
    const row = document.createElement('div');
    row.className = 'rd-qa';
    acts.forEach(a => {
      const usable = a.href || a.fn;
      const el = document.createElement(a.href ? 'a' : 'button');
      el.className = 'rd-qa-btn' + (a.tone ? ' ' + a.tone : '') + (usable ? '' : ' off');
      if (a.href) {
        el.href = a.href;
        if (a.newTab) { el.target = '_blank'; el.rel = 'noopener'; }
      } else {
        el.type = 'button';
        if (!usable) el.disabled = true;
        else el.addEventListener('click', e => { e.stopPropagation(); a.fn(); });
      }
      if (!usable && a.href !== undefined) { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
      el.innerHTML = '<span class="rd-qa-ic">' + ICON(a.icon) + '</span><span class="rd-qa-l"></span>';
      el.querySelector('.rd-qa-l').textContent = a.label;
      row.appendChild(el);
    });
    return row;
  }

  function money(text) {
    const m = String(text || '').match(/-?\$\s?[\d,]+(?:\.\d+)?/);
    const v = m ? m[0].replace(/\s/g, '') : String(text || '').trim();
    return v.replace(/\.00$/, '') || '—';
  }
  function moneyTiles(body) {
    const wrap = document.createElement('div');
    wrap.className = 'rd-tiles';
    [['Contract', '#cpDisplay', ''], ['Collected', '#summaryDeposits', 'pos'], ['Balance', '#summaryBalance', 'due']].forEach(([label, sel, cls]) => {
      const src = body.querySelector(sel);
      const t = document.createElement('div');
      t.className = 'rd-tile' + (cls ? ' ' + cls : '');
      t.innerHTML = '<div class="rd-tile-l"></div><div class="rd-tile-v"></div>';
      t.firstChild.textContent = label;
      const sync = () => { t.lastChild.textContent = src ? money(src.textContent) : '—'; };
      sync();
      if (src) new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
      wrap.appendChild(t);
    });
    return wrap;
  }

  function section(ov, title, cls) {
    const s = document.createElement('section');
    s.className = 'rd-sec' + (cls ? ' ' + cls : '');
    if (title) {
      const h = document.createElement('h3');
      h.className = 'rd-sec-title';
      h.textContent = title;
      s.appendChild(h);
    }
    ov.appendChild(s);
    return s;
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
    const btnRow = q('button[onclick^="textLeadWithCard"]') ? q('button[onclick^="textLeadWithCard"]').parentElement : null;
    const saveBtn = q('button[onclick^="saveJobContactToPhone"]');
    const lastContact = q('button[onclick^="openLogContact"]') ? q('button[onclick^="openLogContact"]').closest('.dp-card') : null;
    const zoho = q('#zohoSyncBtn') ? q('#zohoSyncBtn').closest('.dp-card') : null;
    const wx = q('#jobWxBox');
    const measure = q('#quickMeasureBtn') ? q('#quickMeasureBtn').closest('.dp-card') : null;
    const calc = q('#contractCalcCard');
    const moneyCards = ['#contractSummaryCard', '#expAcc', '#profitCard', '#overheadCard', '#commAcc'].map(q).filter(Boolean);
    const meta = Array.from(body.querySelectorAll('.meta-table')).map(t => t.closest('.dp-card')).find(c => c && /Created By/i.test(c.textContent)) || null;
    const actions = q('#dpMove') ? q('#dpMove').parentElement : null;

    const ov = document.createElement('div');
    ov.className = 'rd-ov';

    ov.appendChild(quickActions(j));

    const next = section(ov, 'Next step');
    [checklist, lastContact].forEach(el => el && next.appendChild(el));

    const cust = section(ov, 'Customer & claim');
    if (contact) cust.appendChild(contact);

    const mon = section(ov, 'Money');
    mon.appendChild(moneyTiles(body));
    moneyCards.forEach(el => mon.appendChild(el));
    if (zoho) mon.appendChild(zoho);

    const links = section(ov, 'Quick links');
    const grid = document.createElement('div');
    grid.className = 'rd-links';
    if (jobBar) jobBar.querySelectorAll('.ap-pill').forEach(p => grid.appendChild(p));
    if (saveBtn) grid.appendChild(saveBtn);
    links.appendChild(grid);

    // Tools: one tap to open; closed by default
    const tools = section(ov, '', 'rd-tools' + (toolsOpen ? ' open' : ''));
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'rd-tools-head';
    head.setAttribute('aria-expanded', String(toolsOpen));
    head.innerHTML = '<span class="rd-tools-t"><span class="rd-sec-title">Roof, estimate &amp; weather tools</span><span class="rd-tools-sub">Quick Measure · Roofr · Estimates · Contract calculator · Weather</span></span>' + CHEVRON;
    const toolsBody = document.createElement('div');
    toolsBody.className = 'rd-tools-body';
    [measure, calc, wx].forEach(el => el && toolsBody.appendChild(el));
    head.addEventListener('click', e => {
      e.stopPropagation();
      toolsOpen = !toolsOpen;
      tools.classList.toggle('open', toolsOpen);
      head.setAttribute('aria-expanded', String(toolsOpen));
    });
    tools.appendChild(head);
    tools.appendChild(toolsBody);

    const info = section(ov, 'Job info');
    if (meta) info.appendChild(meta);

    // Anything not placed above (e.g. a card added to the CRM later) still shows
    const leftovers = Array.from(twoCol.children).flatMap(c => Array.from(c.children)).filter(el => el !== btnRow && el !== actions);
    if (leftovers.length) {
      const more = section(ov, 'More');
      leftovers.forEach(el => more.appendChild(el));
    }

    // Old Text Lead / Send Card / Save row is replaced by the quick actions;
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

    body.insertBefore(ov, body.firstChild);
    twoCol.remove();
    if (jobBar && !jobBar.querySelector('.ap-pill')) jobBar.remove();
  }

  function decorate() {
    if (!document.documentElement.classList.contains('ui-new')) return;
    const panel = document.getElementById('detailPanel');
    const j = currentJob();
    if (!panel || !j) return;
    if (j.id !== lastJobId) { toolsOpen = false; lastJobId = j.id; }
    closeMenu();
    panel.classList.add('rd-job');
    decorateHeader(panel, j);
    decorateTabs(panel);
    if (currentTab() === 'overview') rebuildOverview(panel, j);
  }

  function init() {
    if (typeof window.renderDetailPanel !== 'function' || window.renderDetailPanel.__rd) return;
    const original = window.renderDetailPanel;
    const wrapped = function () {
      const r = original.apply(this, arguments);
      try { decorate(); } catch (e) { console.warn('job screen redesign skipped', e); }
      return r;
    };
    wrapped.__rd = true;
    window.renderDetailPanel = wrapped;
    // A job may already be open (e.g. opened from a link before this ran)
    const ov = document.getElementById('detailOverlay');
    if (ov && ov.classList.contains('open')) { try { decorate(); } catch (e) {} }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
