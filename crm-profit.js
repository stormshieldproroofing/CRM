/* ============================================================
   StormShield CRM — job net profit
   ------------------------------------------------------------
   One formula for every view that shows a job's net profit:
   contract + approved supplements − net expenses.
   Returns are stored as positive credits and reduce expenses.
   Approved-supplement selection stays in the app (status filter);
   this module only adds the total it is given.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmProfit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function money(v) {
    const n = parseFloat(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  // Costs minus returns. A Returns line is a positive credit.
  function netExpenses(expenses) {
    const exps = expenses || [];
    const costs = exps.filter(e => e && e.cat !== 'Returns').reduce((s, e) => s + money(e.amount), 0);
    const returns = exps.filter(e => e && e.cat === 'Returns').reduce((s, e) => s + money(e.amount), 0);
    return costs - returns;
  }

  // contract + approved supplements − net expenses.
  function jobNetProfitAmount(contract, approvedSupplements, expenses) {
    return money(contract) + money(approvedSupplements) - netExpenses(expenses);
  }

  // Signed expense amount: a Returns line is a credit (negative cost).
  function signedExpense(e) {
    if (!e) return 0;
    return e.cat === 'Returns' ? -Math.abs(money(e.amount)) : money(e.amount);
  }

  // Any date string the CRM stores -> 'yyyy-mm-dd' (or null).
  // Deposits are saved as 'Oct 9, 2026'; older ones as '10/9/2026';
  // expenses as '2026-10-09'.
  const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
  function dateKey(v) {
    if (!v) return null;
    const s = String(v).trim();
    const pad = n => String(n).padStart(2, '0');
    const ok = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return ok(m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return ok(m[3], +m[1], +m[2]);
    m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (mon) return ok(m[3], mon, +m[2]);
    }
    return null;
  }

  return { money, netExpenses, jobNetProfitAmount, signedExpense, dateKey };
});
