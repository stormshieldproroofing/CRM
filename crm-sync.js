/* ============================================================
   StormShield CRM — child-row sync decisions
   ------------------------------------------------------------
   Pure helpers (no Supabase client) so the save path can be tested
   without a database.

   pushAllToSupabase used to INSERT a fresh copy of every expense and
   deposit, then DELETE every row that existed before that insert. A
   second tab still holding the old list would put deleted rows back
   (new id, new created_at) and delete rows it had never loaded.
   These helpers decide, per stable key (expense eid, deposit did,
   checklist stage+item):

     - update a row this session changed, when the server copy is the
       one we loaded
     - insert only keys this session added
     - delete only keys this session loaded and then removed
     - keep server rows this session never loaded
     - do not recreate a key that disappeared on the server
     - if both sides changed the same key, keep the server row
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function mintId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function stableStringify(v) {
    if (v === undefined || v === null) return 'null';
    if (typeof v !== 'object') {
      if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }

  function normTime(v) {
    if (v == null || v === '') return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function emptyBaseline() {
    return { fingerprints: {}, knownRowIds: [], removedKeys: [] };
  }

  function captureBaseline(items, spec) {
    const fingerprints = {};
    const knownRowIds = [];
    const seenIds = new Set();
    for (const item of items || []) {
      if (!item) continue;
      const id = spec.rowIdOf(item);
      if (id && !seenIds.has(id)) { seenIds.add(id); knownRowIds.push(id); }
      const k = spec.keyOf(item);
      if (k && !Object.prototype.hasOwnProperty.call(fingerprints, k)) {
        fingerprints[k] = spec.fingerprint(item);
      }
    }
    return { fingerprints, knownRowIds, removedKeys: [] };
  }

  // Keys removed from memory after the snapshot (id-dedupe). A key that is
  // still on a kept row — two physical rows sharing one eid — stays in the
  // fingerprint map so the surviving row is updated, not deleted.
  function noteRemovals(baseline, removedKeys, keptItems, keyOf) {
    const kept = new Set((keptItems || []).map(keyOf).filter(Boolean));
    for (const k of removedKeys || []) {
      if (!k || kept.has(k)) continue;
      if (!baseline.removedKeys.includes(k)) baseline.removedKeys.push(k);
      delete baseline.fingerprints[k];
    }
    return baseline;
  }

  function expenseFromRow(row) {
    const breakdown = (row.breakdown && typeof row.breakdown === 'object') ? row.breakdown : null;
    return {
      cat: row.category,
      desc: row.description,
      amount: String(row.amount),
      vendor: row.vendor || null,
      vendorName: row.vendor_name || null,
      paid: !!row.paid,
      paidDate: row.paid_date || null,
      paidMethod: row.paid_method || null,
      paidNotes: row.paid_notes || null,
      breakdown,
      invoiceFile: (breakdown && breakdown.__invoiceFile) ? breakdown.__invoiceFile : undefined,
      _src: row.src || null,
      _vid: row.vid || null,
      zohoId: row.zoho_id || undefined,
      zohoAmt: row.zoho_amt || undefined,
      zohoV: (row.zoho_v != null) ? row.zoho_v : undefined,
      _eid: row.eid || undefined,
      date: row.exp_date || undefined,
      onAccount: !!row.on_account,
      _rowId: row.id || undefined,
      _id: row.id || undefined,
    };
  }

  // Columns written on insert/update. created_at is intentionally absent so
  // an UPDATE leaves the original timestamp alone (the column default only
  // applies on INSERT).
  function expenseToRow(e) {
    const base = (e.breakdown && typeof e.breakdown === 'object') ? { ...e.breakdown } : {};
    if (e.invoiceFile) base.__invoiceFile = e.invoiceFile;
    return {
      category: e.cat,
      description: e.desc,
      amount: parseFloat(e.amount || 0),
      vendor: e.vendor || null,
      vendor_name: e.vendorName || null,
      paid: !!e.paid,
      paid_date: e.paidDate || null,
      paid_method: e.paidMethod || null,
      paid_notes: e.paidNotes || null,
      breakdown: Object.keys(base).length ? base : null,
      src: e._src || null,
      vid: e._vid || null,
      zoho_id: e.zohoId || null,
      zoho_amt: (e.zohoAmt != null) ? String(e.zohoAmt) : null,
      zoho_v: (e.zohoV != null) ? e.zohoV : null,
      eid: e._eid || null,
      exp_date: e.date || null,
      on_account: !!e.onAccount,
    };
  }

  function expenseFingerprint(e) {
    return stableStringify(expenseToRow(e));
  }

  function depositFromRow(row) {
    return {
      amount: String(row.amount),
      desc: row.description,
      zohoId: row.zoho_id || undefined,
      _pid: row.pid || undefined,
      date: row.dep_date || undefined,
      _did: row.did || undefined,
      checkFile: (row.check_file && typeof row.check_file === 'object') ? row.check_file : undefined,
      _rowId: row.id || undefined,
      _id: row.id || undefined,
    };
  }

  function depositToRow(d) {
    return {
      amount: parseFloat(d.amount || 0),
      description: d.desc,
      zoho_id: d.zohoId || null,
      pid: d._pid || null,
      dep_date: d.date || null,
      did: d._did || null,
      check_file: d.checkFile || null,
    };
  }

  function depositFingerprint(d) {
    return stableStringify(depositToRow(d));
  }

  function checklistKey(stageId, itemKey) {
    return String(stageId || '') + '\t' + String(itemKey || '');
  }

  function splitChecklistKey(key) {
    const i = String(key).indexOf('\t');
    if (i < 0) return { stageId: key, itemKey: '' };
    return { stageId: key.slice(0, i), itemKey: key.slice(i + 1) };
  }

  function checklistFromRow(row) {
    return {
      stageId: row.stage_id,
      itemKey: row.item_key,
      completed: true,
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
      agentId: row.agent_id || '',
      agentName: row.agent_name || 'Unassigned',
      agentRole: row.agent_role || '',
      _rowId: row.id || undefined,
      _id: row.id || undefined,
    };
  }

  function checklistToRow(rec) {
    return {
      stage_id: rec.stageId,
      item_key: rec.itemKey,
      agent_id: rec.agentId || null,
      agent_name: rec.agentName || null,
      agent_role: rec.agentRole || null,
      completed_at: rec.completedAt ? new Date(rec.completedAt).toISOString() : null,
    };
  }

  function checklistFingerprint(rec) {
    return stableStringify({
      stage_id: rec.stageId || null,
      item_key: rec.itemKey || null,
      agent_id: rec.agentId || null,
      agent_name: rec.agentName || null,
      agent_role: rec.agentRole || null,
      completed_at: normTime(rec.completedAt),
    });
  }

  function flattenChecklist(done) {
    const list = [];
    Object.entries(done || {}).forEach(([stageId, items]) => {
      Object.entries(items || {}).forEach(([itemKey, rec]) => {
        if (!rec) return;
        rec.stageId = stageId;
        rec.itemKey = itemKey;
        list.push(rec);
      });
    });
    return list;
  }

  function dedupeExpenses(items) {
    const kept = [];
    const removedKeys = [];
    const seenVid = new Set();
    const seenEid = new Set();
    for (const e of items || []) {
      if (!e) continue;
      let drop = false;
      if (e._vid) {
        if (seenVid.has(e._vid)) drop = true;
        else seenVid.add(e._vid);
      }
      if (!drop && e._eid) {
        if (seenEid.has(e._eid)) drop = true;
        else seenEid.add(e._eid);
      }
      if (drop) {
        if (e._eid) removedKeys.push(e._eid);
        continue;
      }
      kept.push(e);
    }
    return { kept, removedKeys };
  }

  function dedupeByKey(items, keyOf) {
    const kept = [];
    const removedKeys = [];
    const seen = new Set();
    for (const item of items || []) {
      if (!item) continue;
      const k = keyOf(item);
      if (k) {
        if (seen.has(k)) { removedKeys.push(k); continue; }
        seen.add(k);
      }
      kept.push(item);
    }
    return { kept, removedKeys };
  }

  function canonicalRow(rows) {
    return rows.slice().sort((a, b) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      if (ta !== tb) return ta < tb ? 1 : -1;
      const ia = String(a.id || '');
      const ib = String(b.id || '');
      return ia < ib ? 1 : -1;
    })[0];
  }

  /**
   * @returns {{
   *   writes: {item: object, existingId: string|null}[],
   *   deleteIds: string[],
   *   deleteKeys: string[],
   *   adopt: object[],
   *   dropKeys: string[],
   *   replace: {key: string, item: object}[],
   *   conflicts: {key: string, reason: string}[],
   * }}
   */
  function planKeyedSync(opts) {
    const local = (opts.local || []).filter(Boolean);
    for (const item of local) {
      if (!opts.keyOfLocal(item)) opts.ensureKey(item);
    }

    const localByKey = new Map();
    const localByRowId = new Map();
    for (const item of local) {
      const k = opts.keyOfLocal(item);
      if (k && !localByKey.has(k)) localByKey.set(k, item);
      const id = opts.rowIdOfLocal(item);
      if (id && !localByRowId.has(id)) localByRowId.set(id, item);
    }

    const baseline = opts.baseline || emptyBaseline();
    const known = baseline.fingerprints || {};
    const removedKeys = new Set(baseline.removedKeys || []);
    const knownRowIds = new Set(baseline.knownRowIds || []);

    const serverByKey = new Map();
    const unkeyed = [];
    for (const row of opts.server || []) {
      const k = opts.keyOfServer(row);
      if (!k) { unkeyed.push(row); continue; }
      if (!serverByKey.has(k)) serverByKey.set(k, []);
      serverByKey.get(k).push(row);
    }

    const writes = [];
    const deleteIds = [];
    const deleteKeys = [];
    const adopt = [];
    const dropKeys = [];
    const replace = [];
    const conflicts = [];
    const handledUnkeyed = new Set();

    function queueDelete(row, key) {
      if (row && row.id && !deleteIds.includes(row.id)) deleteIds.push(row.id);
      if (key && !deleteKeys.includes(key)) deleteKeys.push(key);
    }

    for (const [key, rows] of serverByKey) {
      const primary = canonicalRow(rows);
      for (const extra of rows) {
        if (extra.id !== primary.id) queueDelete(extra, null);
      }
      const localItem = localByKey.get(key);
      const knew = Object.prototype.hasOwnProperty.call(known, key) || removedKeys.has(key);
      if (!localItem) {
        // Loaded earlier and no longer in memory, or a duplicate eid we
        // collapsed: delete. Never loaded: keep (another session or a
        // direct database insert).
        if (knew || (primary.id && knownRowIds.has(primary.id))) queueDelete(primary, key);
        else adopt.push(opts.fromServer(primary));
        continue;
      }

      const localFp = opts.fingerprintLocal(localItem);
      const serverFp = opts.fingerprintServer(primary);
      const baseFp = known[key];
      const inBaseline = Object.prototype.hasOwnProperty.call(known, key);

      if (!inBaseline) {
        // This session added the key, and a row with that key is already
        // stored (our own earlier insert, or the same key). Update that
        // row instead of inserting a second one.
        if (localFp !== serverFp) writes.push({ item: localItem, existingId: primary.id });
        else if (!localItem._rowId) localItem._rowId = primary.id;
        continue;
      }

      const localChanged = localFp !== baseFp;
      const serverChanged = serverFp !== baseFp;
      if (localChanged && serverChanged && localFp !== serverFp) {
        conflicts.push({ key, reason: 'both-changed' });
        replace.push({ key, item: opts.fromServer(primary) });
        continue;
      }
      if (!localChanged && serverChanged) {
        replace.push({ key, item: opts.fromServer(primary) });
        continue;
      }
      if (localChanged && !serverChanged) {
        writes.push({ item: localItem, existingId: primary.id });
        continue;
      }
      if (!localItem._rowId) localItem._rowId = primary.id;
    }

    for (const [key, item] of localByKey) {
      if (serverByKey.has(key)) continue;
      const knew = Object.prototype.hasOwnProperty.call(known, key) || removedKeys.has(key);
      if (knew) {
        // Server no longer has a key we loaded. Someone deleted it.
        // Do not insert it again.
        dropKeys.push(key);
        conflicts.push({ key, reason: 'deleted-on-server' });
        continue;
      }
      const rid = opts.rowIdOfLocal(item);
      const unkeyedMatch = rid ? unkeyed.find(r => r.id === rid) : null;
      if (unkeyedMatch) {
        writes.push({ item, existingId: unkeyedMatch.id });
        handledUnkeyed.add(unkeyedMatch.id);
        continue;
      }
      writes.push({ item, existingId: null });
    }

    for (const row of unkeyed) {
      if (handledUnkeyed.has(row.id) || deleteIds.includes(row.id)) continue;
      const matched = row.id ? localByRowId.get(row.id) : null;
      if (matched) {
        if (!writes.some(w => w.item === matched)) writes.push({ item: matched, existingId: row.id });
        continue;
      }
      if (row.id && knownRowIds.has(row.id)) queueDelete(row, null);
      else {
        const adopted = opts.fromServer(row);
        if (!opts.keyOfLocal(adopted)) opts.ensureKey(adopted);
        writes.push({ item: adopted, existingId: row.id || null });
        adopt.push(adopted);
      }
    }

    return { writes, deleteIds, deleteKeys, adopt, dropKeys, replace, conflicts };
  }

  // Jobs (and pipelines / stages / team) must not be deleted just because
  // this browser never loaded them. Only ids this session loaded and the
  // user has since removed are deletes. A loaded id that vanished on the
  // server is dropped locally so this session does not upsert it back.
  function planIdDeletes(loadedIds, localIds, remoteIds) {
    if (!loadedIds) return { deleteIds: [], dropLocalIds: [] };
    const loaded = loadedIds instanceof Set ? loadedIds : new Set(loadedIds);
    const local = localIds instanceof Set ? localIds : new Set(localIds || []);
    const remote = remoteIds instanceof Set ? remoteIds : new Set(remoteIds || []);
    const deleteIds = [];
    const dropLocalIds = [];
    for (const id of loaded) {
      if (!local.has(id) && remote.has(id)) deleteIds.push(id);
      if (local.has(id) && !remote.has(id)) dropLocalIds.push(id);
    }
    return { deleteIds, dropLocalIds };
  }

  function expenseSyncSpec(ensureKey) {
    return {
      keyOfLocal: e => e._eid || null,
      keyOfServer: row => row.eid || null,
      rowIdOfLocal: e => e._rowId || e._id || null,
      fingerprintLocal: expenseFingerprint,
      fingerprintServer: row => expenseFingerprint(expenseFromRow(row)),
      fromServer: expenseFromRow,
      ensureKey: ensureKey || (e => { e._eid = mintId('e'); }),
    };
  }

  function depositSyncSpec(ensureKey) {
    return {
      keyOfLocal: d => d._did || null,
      keyOfServer: row => row.did || null,
      rowIdOfLocal: d => d._rowId || d._id || null,
      fingerprintLocal: depositFingerprint,
      fingerprintServer: row => depositFingerprint(depositFromRow(row)),
      fromServer: depositFromRow,
      ensureKey: ensureKey || (d => { d._did = mintId('d'); }),
    };
  }

  function checklistSyncSpec() {
    return {
      keyOfLocal: rec => (rec.stageId || rec.itemKey) ? checklistKey(rec.stageId, rec.itemKey) : null,
      keyOfServer: row => (row.stage_id || row.item_key) ? checklistKey(row.stage_id, row.item_key) : null,
      rowIdOfLocal: rec => rec._rowId || rec._id || null,
      fingerprintLocal: checklistFingerprint,
      fingerprintServer: row => checklistFingerprint(checklistFromRow(row)),
      fromServer: checklistFromRow,
      ensureKey: () => {},
    };
  }

  return {
    mintId,
    stableStringify,
    normTime,
    emptyBaseline,
    captureBaseline,
    noteRemovals,
    expenseFromRow,
    expenseToRow,
    expenseFingerprint,
    depositFromRow,
    depositToRow,
    depositFingerprint,
    checklistKey,
    splitChecklistKey,
    checklistFromRow,
    checklistToRow,
    checklistFingerprint,
    flattenChecklist,
    dedupeExpenses,
    dedupeByKey,
    planKeyedSync,
    planIdDeletes,
    expenseSyncSpec,
    depositSyncSpec,
    checklistSyncSpec,
  };
});
