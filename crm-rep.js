/* ============================================================
   StormShield CRM — assigned rep lookup
   ------------------------------------------------------------
   A job may have no assignee, or an assignee id that is no longer
   on the team. Every display that reads the rep must get an object
   with id, name, and color so it cannot throw on `.color`.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmRep = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const UNASSIGNED_NAME = 'Unassigned';
  const UNASSIGNED_COLOR = '#64748B';
  const UNASSIGNED_FILTER = '__unassigned';

  function unassignedRep() {
    return { id: '—', name: UNASSIGNED_NAME, color: UNASSIGNED_COLOR, known: false };
  }

  // users: team/user records. jobOrId: a job ({user}) or a raw user id.
  function jobAssignee(users, jobOrId) {
    const raw = (jobOrId && typeof jobOrId === 'object') ? jobOrId.user : jobOrId;
    const id = raw == null ? '' : String(raw).trim();
    if (!id) return unassignedRep();
    const u = (users || []).find(x => x && String(x.id) === id);
    if (!u) return unassignedRep();
    return {
      id: String(u.id),
      name: (u.name && String(u.name).trim()) || UNASSIGNED_NAME,
      color: u.color || UNASSIGNED_COLOR,
      known: true,
    };
  }

  return { UNASSIGNED_NAME, UNASSIGNED_COLOR, UNASSIGNED_FILTER, unassignedRep, jobAssignee };
});
