/* ============================================================
   StormShield CRM — Summary "This week" mini calendar helpers
   ------------------------------------------------------------
   The Summary page's This week panel can be swiped (or tabbed)
   from the 7-day list to a small month calendar. These are the
   pure pieces: date keys, the month grid, and which builds and
   appointments land on which day.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmWeekCal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BUILD_COLOR = '#38BDF8';
  const pad = n => String(n).padStart(2, '0');

  // Local-date key, "YYYY-MM-DD".
  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // "YYYY-MM" moved by delta months.
  function shiftMonth(ym, delta) {
    const parts = String(ym).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  // Whole weeks (Sunday first) covering the month. month is 1-12.
  function monthCells(year, month) {
    const first = new Date(year, month - 1, 1);
    const daysIn = new Date(year, month, 0).getDate();
    const total = Math.ceil((first.getDay() + daysIn) / 7) * 7;
    const cells = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(year, month - 1, 1 - first.getDay() + i);
      cells.push({ key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 });
    }
    return cells;
  }

  // { "YYYY-MM-DD": [ {j, kind, label, color, time} ] } for every build date and booked
  // appointment on the given jobs. Builds (all day) first, then by time.
  function eventsByDay(jobs, kinds, apptGet) {
    const out = {};
    const add = (key, ev) => { (out[key] = out[key] || []).push(ev); };
    (jobs || []).forEach(j => {
      if (!j) return;
      const b = String(j.buildDate || '').slice(0, 10);
      if (b) add(b, { j, kind: 'build', label: 'Build', color: BUILD_COLOR, time: '' });
      Object.keys(kinds || {}).forEach(kind => {
        const a = (typeof apptGet === 'function' ? apptGet(j, kind) : null) || {};
        const key = String(a.date || '').slice(0, 10);
        if (key) add(key, { j, kind, label: kinds[kind].label, color: kinds[kind].color, time: a.time || '' });
      });
    });
    Object.keys(out).forEach(k => out[k].sort((x, y) =>
      (y.kind === 'build') - (x.kind === 'build') || String(x.time).localeCompare(String(y.time))));
    return out;
  }

  // Up to `max` distinct dot colors for a day's events.
  function dayDots(events, max) {
    const seen = [];
    (events || []).forEach(e => { if (seen.indexOf(e.color) < 0) seen.push(e.color); });
    return seen.slice(0, max || 3);
  }

  return { BUILD_COLOR, dayKey, shiftMonth, monthCells, eventsByDay, dayDots };
});
