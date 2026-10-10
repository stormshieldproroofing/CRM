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

  return { money, netExpenses, jobNetProfitAmount };
});
