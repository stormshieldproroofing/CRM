/* StormShield CRM redesign — Part 1: groups the nav links into sections and
   gives each one an icon. Loaded only with ?ui=new (see loader in index.html).
   It only moves and decorates the existing links, so their click handlers,
   page names and role-based visibility (Profits, Company Docs) keep working. */
(function () {
  const ICONS = {
    'boards': 'ti-layout-kanban', 'summary': 'ti-chart-bar', 'jobs': 'ti-list-details',
    'calendar': 'ti-calendar', 'my to-do': 'ti-checkbox', 'map': 'ti-map',
    'payments': 'ti-credit-card', 'payroll': 'ti-currency-dollar', 'profits': 'ti-trending-up',
    'insurance': 'ti-shield-check', 'contacts': 'ti-address-book', 'team': 'ti-users-group',
    'company docs': 'ti-file-text'
  };
  const SECTIONS = [
    ['Work', ['boards', 'summary', 'jobs', 'calendar', 'my to-do', 'map']],
    ['Money', ['payments', 'payroll', 'profits', 'insurance']],
    ['People & files', ['contacts', 'team', 'company docs']]
  ];
  const key = el => el.textContent.trim().toLowerCase();

  function buildSidebar() {
    const nav = document.querySelector('.topnav');
    if (!nav || nav.dataset.redesign) return;
    nav.dataset.redesign = '1';
    const links = Array.from(nav.querySelectorAll('.nav-link'));
    const byKey = {};
    links.forEach(l => { byKey[key(l)] = l; });
    const spacer = nav.querySelector(':scope > div[style*="flex:1"]');

    // Insert in the new order just before the spacer; anything not listed keeps its place.
    SECTIONS.forEach(([title, keys]) => {
      const h = document.createElement('div');
      h.className = 'nav-section';
      h.textContent = title.toUpperCase();
      nav.insertBefore(h, spacer);
      keys.forEach(k => { if (byKey[k]) nav.insertBefore(byKey[k], spacer); });
    });

    links.forEach(l => {
      const icon = ICONS[key(l)];
      if (!icon || l.querySelector('.nav-ico')) return;
      const tile = document.createElement('span');
      tile.className = 'nav-ico';
      tile.setAttribute('aria-hidden', 'true');
      tile.innerHTML = '<i class="ti ' + icon + '"></i>';
      l.insertBefore(tile, l.firstChild);
    });
  }

  // Phone drawer: it is rebuilt from the nav links each time it opens, so add
  // the icons and section headings after each rebuild.
  function decorateDrawer(drawer) {
    if (drawer.dataset.decorating) return;
    drawer.dataset.decorating = '1';
    const items = Array.from(drawer.querySelectorAll('.md-link'));
    let lastSection = null;
    items.forEach(d => {
      const k = key(d);
      if (ICONS[k] && !d.querySelector('i')) {
        const i = document.createElement('i');
        i.className = 'ti ' + ICONS[k];
        i.setAttribute('aria-hidden', 'true');
        d.insertBefore(i, d.firstChild);
      }
      const sec = SECTIONS.find(s => s[1].includes(k));
      if (sec && sec[0] !== lastSection) {
        const h = document.createElement('div');
        h.className = 'md-section';
        h.textContent = sec[0].toUpperCase();
        drawer.insertBefore(h, d);
        lastSection = sec[0];
      }
    });
    delete drawer.dataset.decorating;
  }

  // Board: show stage names as written ("Contract Signed", not "CONTRACT SIGNED")
  // and tag the carrier / claim # block so the stylesheet can turn it into a chip.
  function stageName(id) {
    try { const c = (typeof columns !== 'undefined' ? columns : []).find(x => x.id === id); return c && c.name; }
    catch (e) { return null; }
  }
  function decorateBoard(root) {
    root.querySelectorAll('.col').forEach(col => {
      const t = col.querySelector('.col-title');
      if (!t || t.dataset.rd) return;
      t.dataset.rd = '1';
      const name = stageName(col.dataset.col);
      const txt = Array.from(t.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
      if (txt) txt.textContent = name || txt.textContent.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
    });
    root.querySelectorAll('.job-card .card-name').forEach(n => {
      const ins = n.parentElement && n.parentElement.nextElementSibling;
      if (ins && !ins.classList.contains('card-ins')) ins.classList.add('card-ins');
    });
  }
  function watchBoard(id) {
    const el = document.getElementById(id);
    if (!el) return;
    decorateBoard(el);
    new MutationObserver(() => decorateBoard(el)).observe(el, { childList: true, subtree: true });
  }

  // ── Part 4: phone board ──────────────────────────────────────────────
  // A stage picker above the board ("Approved · 3 of 6", arrows, progress bar)
  // that follows the swipe position, plus a bottom tab bar. Both are hidden
  // by CSS outside phone widths.
  let stageBar = null;
  function boardWrap() { return document.querySelector('#boardsPage .board-wrap'); }
  function board0() { return document.getElementById('board'); }
  function boardCols() { return Array.from(document.querySelectorAll('#board > .col')); }
  function colLeft(col, wrap) {
    return col.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
  }
  function currentStageIndex() {
    const wrap = boardWrap(), cols = boardCols();
    if (!wrap || !cols.length) return 0;
    let best = 0, bestD = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(colLeft(c, wrap) - 10 - wrap.scrollLeft); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  // While a smooth scroll is still moving, quick repeated taps on the arrows
  // count from the stage being scrolled to, not the one still on screen.
  let pendingStage = null, pendingUntil = 0;
  function targetStageIndex() {
    return (pendingStage !== null && Date.now() < pendingUntil) ? pendingStage : currentStageIndex();
  }
  function goToStage(i) {
    const wrap = boardWrap(), cols = boardCols();
    if (!wrap || !cols[i]) return;
    pendingStage = i; pendingUntil = Date.now() + 700;
    wrap.scrollTo({ left: Math.max(0, colLeft(cols[i], wrap) - 10), behavior: 'smooth' });
    closeStageMenu();
  }
  function colInfo(col) {
    const t = col.querySelector('.col-title');
    const dot = t && t.querySelector('span');
    return {
      name: t ? t.textContent.trim() : '',
      color: dot ? dot.style.background : '',
      count: (col.querySelector('.col-count') || {}).textContent || '0'
    };
  }
  function closeStageMenu() { if (stageBar) stageBar.classList.remove('menu-open'); }
  function updateStageBar() {
    if (!stageBar) return;
    const cols = boardCols();
    stageBar.style.display = cols.length ? '' : 'none';
    if (!cols.length) return;
    const i = Math.min(currentStageIndex(), cols.length - 1), info = colInfo(cols[i]);
    stageBar.querySelector('.rd-sb-dot').style.background = info.color;
    stageBar.querySelector('.rd-sb-name').textContent = info.name;
    stageBar.querySelector('.rd-sb-count').textContent = info.count;
    stageBar.querySelector('.rd-sb-cur').setAttribute('aria-label', info.name + ', ' + info.count + ' jobs, stage ' + (i + 1) + ' of ' + cols.length + '. Show all stages');
    // the stages before and after, with their job counts
    [['.rd-sb-prev', i - 1], ['.rd-sb-next', i + 1]].forEach(([sel, k]) => {
      const btn = stageBar.querySelector(sel);
      const c = cols[k];
      btn.classList.toggle('empty', !c);
      btn.disabled = !c;
      if (c) btn.setAttribute('aria-label', (k < i ? 'Previous stage: ' : 'Next stage: ') + colInfo(c).name);
    });
    const segs = stageBar.querySelector('.rd-sb-segs');
    segs.innerHTML = '';
    cols.forEach((c, k) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'rd-sb-seg' + (k === i ? ' on' : '');
      s.setAttribute('aria-label', colInfo(c).name);
      s.innerHTML = '<span></span>';
      if (k === i) s.firstChild.style.background = colInfo(c).color || 'var(--brand-light)';
      s.addEventListener('click', () => goToStage(k));
      segs.appendChild(s);
    });
    const menu = stageBar.querySelector('.rd-sb-menu');
    menu.innerHTML = '';
    cols.forEach((c, k) => {
      const ci = colInfo(c);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rd-sb-item' + (k === i ? ' active' : '');
      b.innerHTML = '<span class="rd-sb-dot"></span><span class="rd-sb-iname"></span><span class="rd-sb-count"></span>';
      b.querySelector('.rd-sb-dot').style.background = ci.color;
      b.querySelector('.rd-sb-iname').textContent = ci.name;
      b.querySelector('.rd-sb-count').textContent = ci.count;
      b.addEventListener('click', () => goToStage(k));
      menu.appendChild(b);
    });
  }
  // Phone board header: the stage name is the title (tap it for every stage),
  // the checklist sits beside it, the color dashes show where you are, and the
  // stages before and after are small buttons with their job counts.
  function buildStageBar() {
    const wrap = boardWrap();
    if (!wrap || stageBar) return;
    stageBar = document.createElement('div');
    stageBar.className = 'rd-stagebar';
    stageBar.innerHTML =
      '<div class="rd-sb-row">' +
        '<button type="button" class="rd-sb-prev"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>' +
        '<button type="button" class="rd-sb-cur" aria-haspopup="true">' +
          '<span class="rd-sb-dot"></span><span class="rd-sb-name"></span>' +
          '<span class="rd-sb-count"></span><i class="ti ti-chevron-down rd-sb-caret" aria-hidden="true"></i>' +
        '</button>' +
        '<button type="button" class="rd-sb-next"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="rd-sb-segs"></div>' +
      '<div class="rd-sb-menu"></div>';
    // the stage checklist button lives in the toolbar, next to Add Job
    const addBtn = document.getElementById('addJobBtn');
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'icon-btn rd-sb-check';
    checkBtn.title = 'Stage checklist';
    checkBtn.setAttribute('aria-label', 'Stage checklist');
    checkBtn.innerHTML = '<i class="ti ti-list-check" aria-hidden="true"></i>';
    if (addBtn && addBtn.parentNode) addBtn.parentNode.insertBefore(checkBtn, addBtn);
    wrap.parentNode.insertBefore(stageBar, wrap);
    stageBar.querySelector('.rd-sb-prev').addEventListener('click', () => goToStage(targetStageIndex() - 1));
    stageBar.querySelector('.rd-sb-next').addEventListener('click', () => goToStage(targetStageIndex() + 1));
    checkBtn.addEventListener('click', e => {
      e.stopPropagation();
      const col = boardCols()[Math.min(targetStageIndex(), boardCols().length - 1)];
      const btn = col && col.querySelector('.col-menu-btn');
      if (btn) btn.click();
    });
    stageBar.querySelector('.rd-sb-cur').addEventListener('click', e => {
      e.stopPropagation();
      stageBar.classList.toggle('menu-open');
    });
    document.addEventListener('click', e => { if (stageBar && !stageBar.contains(e.target)) closeStageMenu(); });
    let ticking = false;
    wrap.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; updateStageBar(); });
    }, { passive: true });
    // Phone: each stage scrolls on its own (see redesign.css). The board
    // takes the height left under the stage header, above the tab bar.
    const sizeBoard = () => {
      if (!stageBar || stageBar.offsetParent === null) { document.documentElement.style.removeProperty('--rd-board-h'); return; }
      const top = wrap.getBoundingClientRect().top + (document.scrollingElement || document.documentElement).scrollTop;
      const tab = document.querySelector('.rd-tabbar');
      const tabH = tab && getComputedStyle(tab).display !== 'none' ? (window.innerHeight - tab.getBoundingClientRect().top) : 0;
      document.documentElement.style.setProperty('--rd-board-h', Math.max(260, Math.round(window.innerHeight - top - tabH)) + 'px');
    };
    window.addEventListener('resize', sizeBoard);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
    if (board0()) new MutationObserver(() => requestAnimationFrame(sizeBoard)).observe(board0(), { childList: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => sizeBoard()); ro.observe(stageBar); const top = document.querySelector('#boardsPage .subbar'); if (top) ro.observe(top); }
    document.addEventListener('click', () => setTimeout(sizeBoard, 50));   // after switching pages or pipelines
    requestAnimationFrame(sizeBoard); setTimeout(sizeBoard, 600);
    window.addEventListener('resize', updateStageBar);
    const board = document.getElementById('board');
    if (board) new MutationObserver(() => requestAnimationFrame(updateStageBar)).observe(board, { childList: true });
    updateStageBar();
  }

  // Bottom tab bar (phone): the four most-used pages plus More (opens the menu).
  const TABS = [['boards', 'Boards', 'ti-layout-kanban'], ['calendar', 'Calendar', 'ti-calendar'],
                ['summary', 'Summary', 'ti-chart-bar'], ['map', 'Map', 'ti-map']];
  let tabBar = null;
  function activePage() {
    const a = document.querySelector('.topnav .nav-link.active');
    return a ? a.dataset.page : '';
  }
  function updateTabBar() {
    if (!tabBar) return;
    const p = activePage();
    tabBar.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === p || (b.dataset.tab === 'more' && !TABS.some(t => t[0] === p));
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function buildTabBar() {
    if (tabBar) return;
    tabBar = document.createElement('nav');
    tabBar.className = 'rd-tabbar';
    tabBar.setAttribute('aria-label', 'Main');
    TABS.concat([['more', 'More', 'ti-dots']]).forEach(([page, label, icon]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = page;
      b.innerHTML = '<i class="ti ' + icon + '" aria-hidden="true"></i><span></span>';
      b.querySelector('span').textContent = label;
      b.addEventListener('click', () => {
        if (page === 'more') { const m = document.getElementById('mobileMenuBtn'); if (m) m.click(); return; }
        if (typeof switchPage === 'function') switchPage(page);
      });
      tabBar.appendChild(b);
    });
    document.body.appendChild(tabBar);
    const nav = document.querySelector('.topnav');
    if (nav) new MutationObserver(updateTabBar).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    updateTabBar();
  }

  // Phone sub-bar: the board's text buttons become icon buttons (text hidden
  // visually by CSS); add a tooltip so the label still shows on long-press.
  function labelSubbarButtons() {
    document.querySelectorAll('#boardsPage .subbar .pill-btn, #boardsPage .subbar .add-btn').forEach(b => {
      const t = b.textContent.trim();
      if (t && !b.title) b.title = t;   // the text stays in the button for screen readers
    });
  }

  function init() {
    buildSidebar();
    buildStageBar();
    buildTabBar();
    labelSubbarButtons();
    watchBoard('board');
    watchBoard('forkBoard');
    const drawer = document.getElementById('mobileDrawer');
    if (drawer) {
      new MutationObserver(() => {
        if (drawer.querySelector('.md-link') && !drawer.querySelector('.md-section')) decorateDrawer(drawer);
      }).observe(drawer, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
