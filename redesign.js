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

  function init() {
    buildSidebar();
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
