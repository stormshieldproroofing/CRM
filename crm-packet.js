/* ==========================================================================
   Claim Packet — Contingency Agreement + Third-Party Authorization.

   One legal sheet per job (front: agreement, back: authorization). The CRM
   fills it from the job, the rep completes the rest, the homeowner signs on
   the rep's phone or tablet, and the signed PDF is saved to the job.

   Data:
     j.packet       { fields, status:'draft'|'signed', updatedAt, signed:{…} }
                    persisted inside the job's contract JSON as __packet
     j.packetFiles  signed PDFs / paper scans (job_files kind 'packet')

   The pure helpers at the top are also exported for Node tests.
   ========================================================================== */
(function (root) {
  'use strict';

  const TEMPLATE_URL = 'StormShield_Claim_Packet.pdf';
  const PACKET_VERSION = 'SSPR Claim Packet · ver. 11/2026';
  const CANCEL_BUSINESS_DAYS = 3;

  // Back-page (authorization) fields that simply repeat front-page answers.
  const TPA_MIRROR = {
    tpa_insured_names: 'name',
    tpa_property_address: 'street',
    tpa_city_state: 'city_state',
    tpa_zip: 'zip',
    tpa_phone: 'cell_phone',
    tpa_email: 'email',
    tpa_insurance_company: 'insurance_company',
    tpa_policy_number: 'policy_number',
    tpa_claim_number: 'claim_number',
    tpa_date_of_loss: 'date_of_loss',
    tpa_adjuster: 'adjuster'
  };

  // Text answers the rep fills (PDF field name → label)
  const TEXT_FIELDS = [
    'name', 'street', 'city_state', 'zip', 'cell_phone', 'home_phone', 'email',
    'prior_insurance', 'prior_claim_allocated', 'hoa_company', 'pa_name',
    'date_of_loss', 'date_claim_filed', 'insurance_company', 'policy_number', 'claim_number',
    'adjuster', 'adjuster_phone', 'appointment', 'deductible', 'mortgage_company',
    'ext_ac_units_detail', 'ext_window_beads_detail', 'ext_window_screens_detail',
    'ext_gutters_detail', 'ext_fence_detail', 'ext_other_detail',
    'int_ceiling_stains_detail', 'int_sheetrock_detail', 'int_other_detail'
  ];
  const CHECK_FIELDS = [
    'roof_wind', 'roof_hail',
    'wind_slope_north', 'wind_slope_south', 'wind_slope_east', 'wind_slope_west',
    'hail_slope_north', 'hail_slope_south', 'hail_slope_east', 'hail_slope_west',
    'ext_ac_units', 'ext_window_beads', 'ext_window_screens', 'ext_gutters', 'ext_fence', 'ext_other',
    'int_ceiling_stains', 'int_sheetrock', 'int_other',
    'policy_acv', 'policy_rcv', 'existing_mortgage', 'own_outright'
  ];
  // Yes/No questions stored as 'yes' | 'no' | '' and written to two checkboxes
  const YES_NO = ['changed_insurance', 'prior_claim', 'other_properties'];

  // The key terms the homeowner initials, in the PDF's order (key_initial_1…5)
  const KEY_TERMS = [
    ['Contingent on insurance approval', 'This agreement is limited to the amount and scope the insurance company approves. If the claim is denied, or the coverage is insufficient to do the work properly, it is void and neither party owes anything.'],
    ['All work by StormShield', 'No other company will perform any of the work included in this claim; all of it will be completed by StormShield Pro Roofing.'],
    ['Joint checks, released in 5 days', 'Insurance checks are issued jointly. All insurance funds for each stage of work, including approved supplements, are released to StormShield within 5 calendar days of receipt.'],
    ['Supplements', 'StormShield may file supplements for damage, code items, or cost increases the adjuster missed; approved supplements are paid to StormShield.'],
    ['Cancellation after 3 days', 'If you cancel after the 3-day cancellation period and the claim is approved, you owe $250 or 15% of the approved claim amount (RCV), whichever is greater, payable within 30 days. A mechanic’s lien may be filed if unpaid. If the claim is denied, nothing is owed.']
  ];

  /* ---------------------------------------------------------------- pure helpers */

  // "123 Main St, Pearland, TX 77584" → { street, cityState:'Pearland, TX', zip }
  function splitAddress(addr) {
    const out = { street: '', cityState: '', zip: '' };
    const s = String(addr || '').trim();
    if (!s || s === '—') return out;
    const parts = s.split(',').map(p => p.trim()).filter(Boolean);
    out.street = parts.shift() || '';
    let rest = parts.join(', ');
    const zm = rest.match(/\b(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|United States))?\s*$/i);
    if (zm) { out.zip = zm[1]; rest = rest.slice(0, zm.index).replace(/[,\s]+$/, ''); }
    out.cityState = rest.replace(/,\s*(USA|United States)$/i, '').trim();
    return out;
  }

  // Dates are shown and counted on Houston time, whatever device/server runs this.
  const TZ = 'America/Chicago';
  function tzParts(d) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).forEach(x => { parts[x.type] = x.value; });
    return { y: +parts.year, m: +parts.month, d: +parts.day };
  }

  // Add n business days (Mon–Fri) to the Houston calendar date of `date`.
  // Returns noon UTC of the resulting day. Federal holidays are not skipped.
  function addBusinessDays(date, n) {
    const t = tzParts(date);
    const d = new Date(Date.UTC(t.y, t.m - 1, t.d, 12));
    let left = n;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return d;
  }

  function fmtDate(d) {
    if (!d) return '';
    const x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return String(d);
    const t = tzParts(x);
    return String(t.m).padStart(2, '0') + '/' + String(t.d).padStart(2, '0') + '/' + t.y;
  }

  function fmtDateTime(d) {
    return new Date(d).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) + ' CT';
  }

  // ISO yyyy-mm-dd → mm/dd/yyyy; anything else passes through
  function fmtLooseDate(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[2] + '/' + m[3] + '/' + m[1]) : String(v || '');
  }

  // Fill a fresh packet's answers from what the job already knows.
  function prefillFromJob(j) {
    j = j || {};
    const a = splitAddress(j.address);
    const f = {
      name: j.name && j.name !== '—' ? j.name : '',
      street: a.street, city_state: a.cityState, zip: a.zip,
      cell_phone: j.phone || '', email: j.email || '',
      insurance_company: j.carrier || '',
      policy_number: j.policyNum || '',
      claim_number: j.claimNum || '',
      date_of_loss: fmtLooseDate(j.dateOfLoss || ''),
      deductible: String(j.deductible || '').replace(/^\$\s*/, ''),
      adjuster: j.adjName || '',
      adjuster_phone: j.adjPhone || '',
      appointment: j.inspDate ? fmtLooseDate(j.inspDate) : ''
    };
    return f;
  }

  // Answers object → { text:{pdfName:value}, checks:[pdfName…] } for the PDF.
  function pdfValues(fields) {
    const f = fields || {};
    const text = {};
    TEXT_FIELDS.forEach(k => { if (f[k] != null && String(f[k]).trim() !== '') text[k] = String(f[k]).trim(); });
    Object.keys(TPA_MIRROR).forEach(k => { const src = text[TPA_MIRROR[k]]; if (src) text[k] = src; });
    const checks = CHECK_FIELDS.filter(k => f[k] === true);
    YES_NO.forEach(q => { if (f[q] === 'yes') checks.push(q + '_yes'); else if (f[q] === 'no') checks.push(q + '_no'); });
    return { text, checks };
  }

  // What still needs filling before the homeowner can sign.
  function missingForSigning(fields) {
    const f = fields || {};
    const need = [];
    if (!String(f.name || '').trim()) need.push('Owner name');
    if (!String(f.street || '').trim()) need.push('Property street');
    if (!String(f.insurance_company || '').trim()) need.push('Insurance company');
    return need;
  }

  const api = { TEMPLATE_URL, PACKET_VERSION, TPA_MIRROR, TEXT_FIELDS, CHECK_FIELDS, YES_NO, KEY_TERMS, CANCEL_BUSINESS_DAYS,
    splitAddress, addBusinessDays, fmtDate, fmtDateTime, fmtLooseDate, prefillFromJob, pdfValues, missingForSigning };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.crmPacket = api;

  /* ================================================================ browser */

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const jobById = id => (root.jobs || []).find(x => String(x.id) === String(id));
  const say = m => { if (typeof root.toast === 'function') root.toast(m); };
  const save = () => { if (typeof root.saveToStorage === 'function') root.saveToStorage(); };
  const rerender = () => { if (typeof root.renderDetailPanel === 'function') root.renderDetailPanel(); };
  const me = () => (root.currentMember && (root.currentMember.name || root.currentMember.id)) || '';

  function ensurePacket(j) {
    if (!j.packet || typeof j.packet !== 'object') j.packet = { status: 'draft', fields: prefillFromJob(j) };
    if (!j.packet.fields) j.packet.fields = prefillFromJob(j);
    if (!Array.isArray(j.packetFiles)) j.packetFiles = [];
    return j.packet;
  }

  /* ---------------------------------------------------------------- styles */
  function injectStyles() {
    if (document.getElementById('pk-styles')) return;
    const st = document.createElement('style');
    st.id = 'pk-styles';
    st.textContent = `
.pk-wrap{padding:4px 2px 40px;color:var(--text)}
.pk-status{display:flex;align-items:flex-start;gap:12px;background:var(--card,#161B26);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:14px}
.pk-status .pk-st-ico{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;font-size:18px}
.pk-status h3{margin:0 0 3px;font-size:15px;color:var(--brand)}
.pk-status p{margin:0;font-size:12px;color:var(--muted);line-height:1.5}
.pk-sec{background:var(--card,#161B26);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.pk-sec h4{margin:0 0 10px;font-size:12px;letter-spacing:.04em;color:var(--brand);text-transform:uppercase}
.pk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}
.pk-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 16px}
.pk-fld{display:flex;flex-direction:column;gap:4px;min-width:0}
.pk-fld.full{grid-column:1/-1}
.pk-fld label{font-size:11px;color:var(--muted);font-weight:600}
.pk-fld input,.pk-fld select{background:#1E253A;border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:14px;font-family:inherit;min-width:0;width:100%;box-sizing:border-box}
.pk-fld input:disabled,.pk-fld select:disabled{opacity:.7}
.pk-q{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.pk-q:last-child{border-bottom:0}
.pk-yn{display:flex;gap:6px;flex:none}
.pk-chip{border:1px solid var(--border);background:#1E253A;color:var(--text);border-radius:999px;padding:7px 13px;font-size:13px;cursor:pointer;font-family:inherit;min-height:34px}
.pk-chip.on{background:#233150;border-color:#2F6FEB;color:#fff}
.pk-chip:disabled{cursor:default;opacity:.75}
.pk-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.pk-row .pk-lbl{width:44px;font-size:13px;font-weight:700}
.pk-item{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)}
.pk-item:last-child{border-bottom:0}
.pk-item label{display:flex;align-items:center;gap:8px;flex:1;font-size:13px;cursor:pointer;min-width:0}
.pk-item input[type=checkbox]{width:18px;height:18px;accent-color:#2F6FEB;flex:none}
.pk-item input[type=text]{width:120px;background:#1E253A;border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:13px;font-family:inherit}
.pk-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.pk-btn{flex:1 1 180px;display:flex;align-items:center;justify-content:center;gap:7px;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:#141927;color:var(--brand);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:46px}
.pk-btn:hover{border-color:var(--brand-mid)}
.pk-btn.primary{background:#2F6FEB;border-color:#2F6FEB;color:#fff}
.pk-btn.green{background:#059669;border-color:#059669;color:#fff}
.pk-btn:disabled{opacity:.5;cursor:not-allowed}
.pk-files{display:flex;flex-direction:column;gap:8px}
.pk-file{display:flex;align-items:center;gap:10px;background:#141927;border:1px solid var(--border);border-radius:9px;padding:10px 12px}
.pk-file .pk-fn{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--brand);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-file button{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:6px}
.pk-note{font-size:11px;color:var(--muted);line-height:1.5;margin-top:8px}
@media (max-width:640px){.pk-grid,.pk-grid3{grid-template-columns:1fr}.pk-q{flex-wrap:wrap}}

/* signing overlay (homeowner mode) — light theme, large targets */
#pkSign{position:fixed;inset:0;z-index:100000;background:#F6F7F9;color:#141A26;display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
#pkSign *{box-sizing:border-box}
#pkSign .pks-top{background:#0F1E3A;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
#pkSign .pks-top b{font-size:15px}
#pkSign .pks-top span{font-size:12px;color:#C4CBD8}
#pkSign .pks-bar{height:4px;background:#DDE1E8}
#pkSign .pks-bar i{display:block;height:4px;background:#2F6FEB;transition:width .2s}
#pkSign .pks-body{flex:1;overflow:auto;padding:18px 16px 24px;max-width:720px;width:100%;margin:0 auto}
#pkSign h2{margin:0 0 6px;font-size:21px}
#pkSign .pks-sub{margin:0 0 16px;font-size:14px;color:#5A6478;line-height:1.5}
#pkSign .pks-card{background:#fff;border:1px solid #DDE1E8;border-radius:12px;padding:14px;margin-bottom:12px}
#pkSign .pks-term{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #DDE1E8;border-radius:12px;padding:12px 14px;margin-bottom:10px}
#pkSign .pks-term p{margin:0;flex:1;font-size:13.5px;line-height:1.5;color:#3C4658}
#pkSign .pks-term p b{color:#141A26}
#pkSign .pks-ini{flex:none;width:76px;height:48px;border-radius:10px;border:1.5px dashed #8A94A8;background:#fff;color:#5A6478;font-size:13px;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:2px}
#pkSign .pks-ini.on{border:1.5px solid #2F6FEB;background:#EAF1FE}
#pkSign .pks-ini img{max-width:100%;max-height:100%}
#pkSign .pks-pad{position:relative;background:#fff;border:1.5px solid #C9CFDA;border-radius:12px;height:170px;touch-action:none;overflow:hidden}
#pkSign .pks-pad.small{height:120px;max-width:300px}
#pkSign .pks-pad canvas{position:absolute;inset:0;width:100%;height:100%}
#pkSign .pks-pad .pks-line{position:absolute;left:18px;right:18px;bottom:34px;border-top:1px solid #C9CFDA;pointer-events:none}
#pkSign .pks-pad .pks-x{position:absolute;left:18px;bottom:38px;font-size:18px;color:#8A94A8;pointer-events:none}
#pkSign .pks-padbar{display:flex;justify-content:space-between;align-items:center;margin:6px 2px 14px;font-size:12px;color:#5A6478}
#pkSign .pks-link{background:none;border:none;color:#2F6FEB;font-size:13px;font-weight:600;cursor:pointer;padding:6px;font-family:inherit}
#pkSign label.pks-check{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #DDE1E8;border-radius:12px;padding:14px;font-size:14px;line-height:1.5;color:#3C4658;cursor:pointer;margin-bottom:12px}
#pkSign label.pks-check input{width:22px;height:22px;accent-color:#2F6FEB;flex:none;margin-top:1px}
#pkSign .pks-fld{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
#pkSign .pks-fld label{font-size:13px;font-weight:600;color:#3C4658}
#pkSign .pks-fld input{height:48px;border-radius:10px;border:1px solid #C9CFDA;padding:0 12px;font-size:16px;font-family:inherit;color:#141A26;background:#fff}
#pkSign .pks-foot{background:#fff;border-top:1px solid #DDE1E8;padding:12px 16px calc(14px + env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center}
#pkSign .pks-foot > div{display:flex;gap:10px;max-width:720px;width:100%}
#pkSign .pks-b{flex:1;height:52px;border-radius:12px;border:1px solid #C9CFDA;background:#fff;color:#0F1E3A;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
#pkSign .pks-b.go{flex:2;background:#2F6FEB;border-color:#2F6FEB;color:#fff}
#pkSign .pks-b:disabled{opacity:.45;cursor:not-allowed}
#pkSign .pks-ok{display:flex;gap:10px;align-items:center;background:#E6F6EE;border-radius:12px;padding:12px 14px;color:#145C3B;font-size:14px;margin-bottom:12px}
#pkSign .pks-legal{font-size:12px;color:#5A6478;line-height:1.5}
#pkSign .pks-applied{display:flex;align-items:center;gap:12px;background:#fff;border:1.5px solid #2F6FEB;border-radius:12px;padding:10px 14px;margin-bottom:12px}
#pkSign .pks-applied img{height:44px;max-width:60%}
`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- Packet tab */
  function renderPacketTab(j) {
    const panel = document.getElementById('dpBody');
    if (!panel || !j) return;
    injectStyles();
    const p = ensurePacket(j);
    const f = p.fields;
    const signed = p.status === 'signed';
    const dis = signed ? 'disabled' : '';
    const v = k => esc(f[k] == null ? '' : f[k]);
    const txt = (k, label, extra) => `<div class="pk-fld${extra && extra.full ? ' full' : ''}"><label for="pk-${k}">${label}</label><input id="pk-${k}" data-pk="${k}" value="${v(k)}" ${extra && extra.type ? 'inputmode="' + extra.type + '"' : ''} ${dis}></div>`;
    const chip = (k, label) => `<button type="button" class="pk-chip${f[k] === true ? ' on' : ''}" data-pkc="${k}" aria-pressed="${f[k] === true}" ${dis}>${label}</button>`;
    const yn = (q, label) => `<div class="pk-q"><span>${label}</span><span class="pk-yn">
      <button type="button" class="pk-chip${f[q] === 'yes' ? ' on' : ''}" data-pkyn="${q}" data-val="yes" ${dis}>Yes</button>
      <button type="button" class="pk-chip${f[q] === 'no' ? ' on' : ''}" data-pkyn="${q}" data-val="no" ${dis}>No</button></span></div>`;
    const item = (k, label, unit) => `<div class="pk-item"><label><input type="checkbox" data-pkcb="${k}" ${f[k] === true ? 'checked' : ''} ${dis}>${label}</label>${unit !== null ? `<input type="text" aria-label="${label} ${unit || 'details'}" placeholder="${unit || ''}" data-pk="${k}_detail" value="${v(k + '_detail')}" ${dis}>` : ''}</div>`;

    let status;
    if (signed) {
      const s = p.signed || {};
      const cancelBy = s.cancelBy ? fmtDate(s.cancelBy) : '';
      const inWindow = s.cancelBy && new Date() <= new Date(new Date(s.cancelBy).setHours(23, 59, 59, 999));
      status = `<div class="pk-status"><div class="pk-st-ico" style="background:rgba(52,211,153,.15);color:#34D399"><i class="ti ti-circle-check"></i></div><div>
        <h3>Signed ${s.at ? 'on ' + esc(fmtDate(s.at)) : ''}</h3>
        <p>${s.method === 'paper' ? 'Signed on paper — scan uploaded.' : 'Signed in person' + (s.homeowner && s.homeowner.name ? ' by ' + esc(s.homeowner.name) : '') + (s.coowner && s.coowner.name ? ' and ' + esc(s.coowner.name) : '') + '.'}
        ${cancelBy ? (inWindow ? ` <b style="color:#F2C46B">3-day cancellation window ends ${esc(cancelBy)} at midnight.</b>` : ` Cancellation window ended ${esc(cancelBy)}.`) : ''}</p></div></div>`;
    } else {
      const miss = missingForSigning(f);
      status = `<div class="pk-status"><div class="pk-st-ico" style="background:rgba(242,196,107,.15);color:#F2C46B"><i class="ti ti-file-certificate"></i></div><div>
        <h3>Claim Packet — not signed yet</h3>
        <p>Contingency Agreement (front) + Third-Party Authorization (back). Filled from this job — finish the rest, then have the homeowner sign.${miss.length ? ` <b style="color:#F2C46B">Still needed: ${esc(miss.join(', '))}.</b>` : ''}</p></div></div>`;
    }

    const files = (j.packetFiles || []).map((x, i) => `<div class="pk-file"><i class="ti ti-file-type-pdf" style="color:#F87171;font-size:18px"></i>
      <span class="pk-fn">${esc(x.name || 'Claim packet')}</span>
      <button type="button" onclick="previewJobFile('packetFiles',${i})"><i class="ti ti-eye"></i> View</button>
      <button type="button" onclick="crmPacket.deleteFile('${j.id}',${i})" aria-label="Delete file"><i class="ti ti-trash"></i></button></div>`).join('');

    panel.innerHTML = `<div class="pk-wrap">
      ${status}
      <div class="pk-actions" style="margin-bottom:14px">
        ${signed ? `<button type="button" class="pk-btn" onclick="crmPacket.startOver('${j.id}')"><i class="ti ti-refresh"></i> Start a new packet</button>`
          : `<button type="button" class="pk-btn primary" onclick="crmPacket.startSigning('${j.id}')"><i class="ti ti-signature"></i> Sign in person</button>
             <button type="button" class="pk-btn primary" onclick="crmPacket.sendForSignature('${j.id}')"><i class="ti ti-send"></i> Send for signature</button>
             <button type="button" class="pk-btn" onclick="crmPacket.preview('${j.id}')"><i class="ti ti-printer"></i> Preview / print</button>`}
        <label class="pk-btn" style="margin:0"><i class="ti ti-upload"></i> Upload signed paper copy
          <input type="file" accept=".pdf,image/*" style="display:none" onchange="crmPacket.uploadPaper('${j.id}', this.files)"></label>
      </div>
      ${files ? `<div class="pk-sec"><h4>Signed packets</h4><div class="pk-files">${files}</div></div>` : ''}
      <div id="pk-links"></div>

      <div class="pk-sec"><h4>Client</h4><div class="pk-grid">
        ${txt('name', 'Owner name(s)', { full: true })}
        ${txt('street', 'Street', { full: true })}
        ${txt('city_state', 'City, State')}${txt('zip', 'Zip', { type: 'numeric' })}
        ${txt('cell_phone', 'Cell', { type: 'tel' })}${txt('home_phone', 'Home phone', { type: 'tel' })}
        ${txt('email', 'E-mail', { full: true, type: 'email' })}
      </div></div>

      <div class="pk-sec"><h4>Project information</h4>
        ${yn('changed_insurance', 'Changed insurance companies in the last 12 months?')}
        <div class="pk-grid" style="margin:6px 0 4px">${txt('prior_insurance', 'Prior insurance co.', { full: true })}</div>
        ${yn('prior_claim', 'Ever paid by homeowner’s insurance, or a claim under the deductible?')}
        <div class="pk-grid" style="margin:6px 0 4px">${txt('prior_claim_allocated', 'List what was allocated', { full: true })}</div>
        ${yn('other_properties', 'Own any other residential properties?')}
        <div class="pk-grid" style="margin-top:8px">${txt('hoa_company', 'HOA management company', { full: true })}${txt('pa_name', 'Public adjuster', { full: true })}</div>
      </div>

      <div class="pk-sec"><h4>Type of loss — roof</h4>
        <div class="pk-row"><span class="pk-lbl">Wind</span>${chip('roof_wind', 'Wind damage')}${chip('wind_slope_north', 'N')}${chip('wind_slope_south', 'S')}${chip('wind_slope_east', 'E')}${chip('wind_slope_west', 'W')}</div>
        <div class="pk-row"><span class="pk-lbl">Hail</span>${chip('roof_hail', 'Hail damage')}${chip('hail_slope_north', 'N')}${chip('hail_slope_south', 'S')}${chip('hail_slope_east', 'E')}${chip('hail_slope_west', 'W')}</div>
      </div>

      <div class="pk-sec"><h4>Exterior</h4>
        ${item('ext_ac_units', 'Comb. AC units', 'Qty.')}${item('ext_window_beads', 'Window beads', 'Qty.')}
        ${item('ext_window_screens', 'Window screens', 'Qty.')}${item('ext_gutters', 'Gutters', 'Type')}
        ${item('ext_fence', 'Fence', 'LF')}${item('ext_other', 'Other', 'Describe')}
      </div>
      <div class="pk-sec"><h4>Interior</h4>
        ${item('int_ceiling_stains', 'Ceiling stains', '# rooms')}${item('int_sheetrock', 'Sheetrock damage', '# rooms')}${item('int_other', 'Other', 'Describe')}
      </div>

      <div class="pk-sec"><h4>Insurance &amp; claim</h4><div class="pk-grid">
        ${txt('insurance_company', 'Insurance company')}${txt('policy_number', 'Policy #')}
        ${txt('claim_number', 'Claim #')}${txt('date_of_loss', 'Date of loss')}
        ${txt('date_claim_filed', 'Date claim filed')}${txt('appointment', 'Adjuster appointment')}
        ${txt('adjuster', 'Adjuster')}${txt('adjuster_phone', 'Adjuster phone', { type: 'tel' })}
        ${txt('deductible', 'Deductible ($)', { type: 'decimal' })}
        <div class="pk-fld"><label>Policy type</label><div class="pk-yn">${chip('policy_acv', 'ACV')}${chip('policy_rcv', 'RCV')}</div></div>
        <div class="pk-fld"><label>Mortgage</label><div class="pk-yn">${chip('existing_mortgage', 'Existing mortgage')}${chip('own_outright', 'Own')}</div></div>
        ${txt('mortgage_company', 'Mortgage company')}
      </div>
      <p class="pk-note">Answers save automatically. Claim # can be left blank and added later on paper.</p></div>
    </div>`;

    renderLinks(j).catch(e => console.warn('[packet] links', e));
    if (signed) return;
    const persist = () => { p.updatedAt = new Date().toISOString(); save(); };
    panel.querySelectorAll('[data-pk]').forEach(el => el.addEventListener('input', () => { f[el.dataset.pk] = el.value; persist(); }));
    panel.querySelectorAll('[data-pkcb]').forEach(el => el.addEventListener('change', () => { f[el.dataset.pkcb] = el.checked; persist(); }));
    const exclusive = { policy_acv: 'policy_rcv', policy_rcv: 'policy_acv', existing_mortgage: 'own_outright', own_outright: 'existing_mortgage' };
    panel.querySelectorAll('[data-pkc]').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.pkc;
      f[k] = !(f[k] === true);
      if (f[k] && exclusive[k]) { f[exclusive[k]] = false; const o = panel.querySelector(`[data-pkc="${exclusive[k]}"]`); if (o) { o.classList.remove('on'); o.setAttribute('aria-pressed', 'false'); } }
      // picking a slope implies the peril
      const m = k.match(/^(wind|hail)_slope_/); if (m && f[k]) { f['roof_' + m[1]] = true; const r = panel.querySelector(`[data-pkc="roof_${m[1]}"]`); if (r) r.classList.add('on'); }
      el.classList.toggle('on', f[k]); el.setAttribute('aria-pressed', String(f[k]));
      persist();
    }));
    panel.querySelectorAll('[data-pkyn]').forEach(el => el.addEventListener('click', () => {
      const q = el.dataset.pkyn, val = el.dataset.val;
      f[q] = f[q] === val ? '' : val;
      panel.querySelectorAll(`[data-pkyn="${q}"]`).forEach(b => b.classList.toggle('on', f[q] === b.dataset.val));
      persist();
    }));
  }

  /* ---------------------------------------------------------------- PDF building */
  let _templateBytes = null;
  // The server passes the template in directly (no fetch from the website).
  function setTemplateBytes(bytes) { _templateBytes = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer; }
  async function loadTemplate() {
    if (_templateBytes) return _templateBytes.slice(0);
    const resp = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('Could not load ' + TEMPLATE_URL + ' (HTTP ' + resp.status + ')');
    _templateBytes = await resp.arrayBuffer();
    return _templateBytes.slice(0);
  }

  // sigs: { initials, homeowner, coowner, sspr, tpa1, tpa2 } — PNG data URLs
  async function buildPdf(fields, sigs, meta) {
    if (!root.PDFLib) throw new Error('PDF library not loaded yet');
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.load(await loadTemplate());
    const form = pdf.getForm();
    const pages = pdf.getPages();
    const vals = pdfValues(fields);
    Object.keys(vals.text).forEach(k => { try { form.getTextField(k).setText(vals.text[k]); } catch (e) { /* field missing */ } });
    vals.checks.forEach(k => { try { form.getCheckBox(k).check(); } catch (e) {} });

    sigs = sigs || {};
    meta = meta || {};
    const setT = (k, val) => { if (!val) return; try { form.getTextField(k).setText(String(val)); } catch (e) {} };
    const day = meta.signedAt ? fmtDate(meta.signedAt) : '';
    if (sigs.homeowner) { setT('homeowner_date', day); setT('tpa_insured1_date', day); }
    if (sigs.coowner) { setT('coowner_date', day); setT('tpa_insured2_date', day); }
    if (sigs.sspr) setT('sspr_date', day);
    if (meta.homeownerName) setT('tpa_insured1_printed_name', meta.homeownerName);
    if (meta.coownerName && sigs.coowner) setT('tpa_insured2_printed_name', meta.coownerName);

    // Where each signature / initials image goes. Read the spots first, flatten
    // the form (which paints field backgrounds), THEN draw the ink on top.
    const spot = name => {
      let fld; try { fld = form.getTextField(name); } catch (e) { return null; }
      const w = fld.acroField.getWidgets()[0]; if (!w) return null;
      const r = w.getRectangle();
      return { page: pages[name.indexOf('tpa_') === 0 ? 1 : 0], x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const plan = [];
    for (let i = 1; i <= KEY_TERMS.length; i++) plan.push(['key_initial_' + i, sigs.initials, { center: true, extraH: 4 }]);
    plan.push(['deductible_initials', sigs.initials, { center: true, extraH: 4 }]);
    plan.push(['sig_homeowner', sigs.homeowner, { extraH: 0 }]);
    plan.push(['sig_coowner', sigs.coowner, { extraH: 0 }]);
    plan.push(['sig_sspr', sigs.sspr, { extraH: 0 }]);
    plan.push(['tpa_sig_insured1', sigs.tpa1, { extraH: 2 }]);
    plan.push(['tpa_sig_insured2', sigs.tpa2, { extraH: 2 }]);
    const spots = plan.filter(x => x[1]).map(x => ({ at: spot(x[0]), img: x[1], opts: x[2] })).filter(x => x.at);

    try { form.flatten(); } catch (e) { console.warn('[packet] flatten failed', e); }

    const embedded = {};
    for (const s of spots) {
      const img = embedded[s.img] || (embedded[s.img] = await pdf.embedPng(s.img));
      const r = s.at, extraH = s.opts.extraH || 0;
      const scale = Math.min(r.width / img.width, (r.height + extraH) / img.height);
      const wd = img.width * scale, ht = img.height * scale;
      const x = s.opts.center ? r.x + (r.width - wd) / 2 : r.x;
      r.page.drawImage(img, { x, y: r.y + 1, width: wd, height: ht });
    }
    return pdf.save();
  }

  async function sha256Hex(bytes) {
    try {
      const h = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  // Append a signature record page (who/when/how + fingerprint of pages 1–2).
  async function addAuditPage(bytes, audit) {
    const { PDFDocument, StandardFonts, rgb } = root.PDFLib;
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.addPage([612, 1008]);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const reg = await pdf.embedFont(StandardFonts.Helvetica);
    const ink = rgb(0.08, 0.1, 0.15), grey = rgb(0.33, 0.37, 0.45), navy = rgb(0.06, 0.12, 0.23);
    let y = 960;
    const line = (t, o) => {
      o = o || {};
      const size = o.size || 10, font = o.bold ? bold : reg, max = 540;
      const words = String(t).split(' '); let cur = '';
      const flush = () => { page.drawText(cur, { x: 36 + (o.indent || 0), y, size, font, color: o.color || ink }); y -= size + 5; cur = ''; };
      words.forEach(wd => { const next = cur ? cur + ' ' + wd : wd; if (font.widthOfTextAtSize(next, size) > max - (o.indent || 0)) { flush(); cur = wd; } else cur = next; });
      if (cur) flush();
    };
    page.drawRectangle({ x: 0, y: 984, width: 612, height: 24, color: navy });
    page.drawText('ELECTRONIC SIGNATURE RECORD', { x: 36, y: 991, size: 11, font: bold, color: rgb(1, 1, 1) });
    line('StormShield Pro Roofing — Claim Packet', { bold: true, size: 14, color: navy }); y -= 4;
    line(PACKET_VERSION + ' · Contingency Agreement (page 1) and Third-Party Authorization (page 2)', { color: grey });
    y -= 8;
    line('Property', { bold: true }); line(audit.property || '', { indent: 10 }); y -= 6;
    line('Signers', { bold: true });
    (audit.signers || []).forEach(s => line(s.role + ': ' + s.name + ' — signed ' + s.at, { indent: 10 }));
    y -= 6;
    line('How it was signed', { bold: true });
    line(audit.how || 'In person on a StormShield device.', { indent: 10 });
    (audit.details || []).forEach(d => line(d, { indent: 10, color: grey }));
    line('Device: ' + (audit.device || 'unknown'), { indent: 10, color: grey });
    line('StormShield representative: ' + (audit.rep || ''), { indent: 10 });
    y -= 6;
    line('Electronic signature consent', { bold: true });
    line('“' + audit.consent + '” — accepted ' + audit.consentAt, { indent: 10 });
    y -= 6;
    line('Document fingerprint (SHA-256 of pages 1–2)', { bold: true });
    line(audit.hash || 'unavailable', { indent: 10, size: 9, color: grey });
    y -= 6;
    line('Cancellation', { bold: true });
    line('Three-business-day cancellation window ends ' + audit.cancelBy + ' at midnight.', { indent: 10 });
    page.drawText('Generated by the StormShield CRM · ' + new Date().toISOString(), { x: 36, y: 20, size: 8, font: reg, color: grey });
    return pdf.save();
  }

  function openBlob(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const w = root.open(url, '_blank');
    if (!w) say('Allow pop-ups to view the PDF');
    return url;
  }

  async function preview(jobId) {
    const j = jobById(jobId); if (!j) return;
    ensurePacket(j);
    say('Preparing packet…');
    try { openBlob(await buildPdf(j.packet.fields, {}, {})); }
    catch (e) { console.error('[packet] preview failed', e); say('Could not build the packet PDF'); }
  }

  /* ---------------------------------------------------------------- signature pads */
  function makePad(host) {
    host.innerHTML = '<canvas></canvas><div class="pks-line"></div><div class="pks-x">×</div>';
    const canvas = host.querySelector('canvas');
    const ratio = Math.max(1, root.devicePixelRatio || 1);
    const size = () => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = host.classList.contains('small') ? 4.5 : 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1530';
    };
    size();
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null, ink = false;
    const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return; const p2 = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); last = p2; ink = true; e.preventDefault();
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    return {
      hasInk: () => ink,
      clear: () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); ink = false; },
      // Trimmed PNG of the ink only (transparent background)
      toPng: () => {
        if (!ink) return null;
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
        for (let yy = 0; yy < canvas.height; yy++) for (let xx = 0; xx < canvas.width; xx++) {
          if (d[(yy * canvas.width + xx) * 4 + 3] > 20) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
        }
        if (maxX < 0) return null;
        const pad = 6 * ratio;
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(canvas.width - 1, maxX + pad); maxY = Math.min(canvas.height - 1, maxY + pad);
        const out = document.createElement('canvas');
        out.width = maxX - minX + 1; out.height = maxY - minY + 1;
        out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      }
    };
  }

  /* ---------------------------------------------------------------- signing flow */
  const CONSENT = 'I agree to sign this Claim Packet electronically. My electronic signature and initials have the same effect as signing on paper, and I can ask StormShield Pro Roofing for a paper copy at any time.';

  // Turn a finished signing session into the final PDF (pages 1–2 + record page).
  // r: result of openSigningFlow; ctx: { signedAt, how, details, device, repName, repSig }
  async function finalizeSigned(fields, r, ctx) {
    const signedAt = ctx.signedAt || new Date();
    const cancelBy = addBusinessDays(signedAt, CANCEL_BUSINESS_DAYS);
    const repSig = r.sig.sspr || ctx.repSig || null;
    const sigs = {
      initials: r.initials, homeowner: r.sig.homeowner, coowner: r.coowner ? r.sig.coowner : null, sspr: repSig,
      tpa1: r.tpaApplied.homeowner ? r.sig.homeowner : null,
      tpa2: r.coowner && r.tpaApplied.coowner ? r.sig.coowner : null
    };
    const signedBytes = await buildPdf(fields, sigs, { signedAt, homeownerName: r.homeownerName, coownerName: r.coownerName });
    const hash = await sha256Hex(signedBytes);
    const signers = [{ role: 'Property owner', name: r.homeownerName, at: fmtDateTime(r.at.homeowner) }];
    if (sigs.coowner) signers.push({ role: 'Co-owner', name: r.coownerName, at: fmtDateTime(r.at.coowner) });
    const repName = r.repName || ctx.repName || '';
    if (repSig) signers.push({ role: 'StormShield representative', name: repName, at: fmtDateTime(r.at.sspr || ctx.repSignedAt || signedAt) });
    const finalBytes = await addAuditPage(signedBytes, {
      property: [fields.street, fields.city_state, fields.zip].filter(Boolean).join(', '),
      signers, how: ctx.how, details: ctx.details || [], device: ctx.device || '', rep: repName,
      consent: CONSENT, consentAt: fmtDateTime(r.consentAt), hash, cancelBy: fmtDate(cancelBy)
    });
    return { finalBytes, hash, cancelBy, sigs };
  }

  /* Full-screen signing screens, shared by in-person signing (CRM) and the
     homeowner's remote link (sign.html).
     opts: { fields, mode:'in_person'|'remote', repName, onFinish:async(r)=>({finalBytes,cancelBy}),
             onDone:fn (in-person "Done" button), mount: element (default body) } */
  function openSigningFlow(opts) {
    injectStyles();
    const fields = opts.fields || {};
    const remote = opts.mode === 'remote';
    const st = {
      step: 0, consentAt: null,
      homeownerName: (fields.name || '').split(/\s*(?:&|\band\b|,)\s*/)[0] || fields.name || '',
      coowner: false, coownerName: '',
      initials: null, initialed: {},
      sig: {}, tpaApplied: { homeowner: false, coowner: false },
      repName: opts.repName || '', at: {}
    };
    const steps = remote
      ? ['Agree to sign electronically', 'Initial the key terms', 'Sign the agreement', 'Sign the authorization']
      : ['Agree to sign electronically', 'Initial the key terms', 'Sign the agreement', 'Sign the authorization', 'StormShield signature'];
    const DONE = steps.length;

    const ov = document.createElement('div');
    ov.id = 'pkSign';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Sign claim packet');
    (opts.mount || document.body).appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => { ov.remove(); document.body.style.overflow = prevOverflow; };

    let pads = {};
    const render = () => {
      const s = st.step;
      const pct = Math.round((s / DONE) * 100);
      let body = '', next = 'Continue', canBack = s > 0 && s < DONE, nextOk = true;
      if (s === 0) {
        body = `<h2>Hi ${esc(st.homeownerName || 'there')}</h2>
          <p class="pks-sub">This is your Contingency Agreement and Third-Party Authorization with StormShield Pro Roofing for <b>${esc(fields.street || '')}</b>. It takes about 2 minutes.</p>
          <div class="pks-card"><button type="button" class="pks-link" data-act="view" style="padding:0">Read the full agreement (PDF)</button></div>
          <label class="pks-check"><input type="checkbox" data-consent ${st.consentAt ? 'checked' : ''}><span>${esc(CONSENT)}</span></label>`;
        nextOk = !!st.consentAt;
        canBack = false;
      } else if (s === 1) {
        const allDone = KEY_TERMS.every((_, i) => st.initialed[i]) && st.initialed.ded;
        body = `<h2>Initial each key term</h2>
          <p class="pks-sub">Draw your initials once, then tap each box to place them.</p>
          ${st.initials
            ? `<div class="pks-applied" style="max-width:300px"><img src="${st.initials}" alt="Your initials"><button type="button" class="pks-link" data-clear="initials">Redo initials</button></div>`
            : `<div class="pks-pad small" data-pad="initials"></div>
          <div class="pks-padbar" style="max-width:300px"><span>Your initials</span><button type="button" class="pks-link" data-clear="initials">Clear</button></div>`}
          ${KEY_TERMS.map((t, i) => `<div class="pks-term"><p><b>${esc(t[0])}.</b> ${esc(t[1])}</p>
            <button type="button" class="pks-ini${st.initialed[i] ? ' on' : ''}" data-ini="${i}" aria-label="Initial: ${esc(t[0])}">${st.initialed[i] && st.initials ? `<img src="${st.initials}" alt="">` : 'Initial'}</button></div>`).join('')}
          <div class="pks-term"><p><b>Deductible.</b> I understand my insurance deductible${fields.deductible ? ' of $' + esc(fields.deductible) : ''} is my responsibility.</p>
            <button type="button" class="pks-ini${st.initialed.ded ? ' on' : ''}" data-ini="ded" aria-label="Initial: deductible">${st.initialed.ded && st.initials ? `<img src="${st.initials}" alt="">` : 'Initial'}</button></div>`;
        nextOk = allDone;
      } else if (s === 2) {
        body = `<h2>Sign the agreement</h2>
          <p class="pks-sub">You agree to all terms of the Contingency Agreement. You may cancel within 3 business days.</p>
          <div class="pks-fld"><label for="pks-hn">Your full name</label><input id="pks-hn" data-name="homeowner" value="${esc(st.homeownerName)}" autocomplete="name"></div>
          <div class="pks-pad" data-pad="homeowner"></div>
          <div class="pks-padbar"><span>Sign with your finger</span><button type="button" class="pks-link" data-clear="homeowner">Clear</button></div>
          ${st.coowner ? `<div class="pks-fld"><label for="pks-cn">Co-owner full name</label><input id="pks-cn" data-name="coowner" value="${esc(st.coownerName)}"></div>
            <div class="pks-pad" data-pad="coowner"></div>
            <div class="pks-padbar"><span>Co-owner signature</span><span><button type="button" class="pks-link" data-clear="coowner">Clear</button><button type="button" class="pks-link" data-act="nocoowner">Remove co-owner</button></span></div>`
            : `<button type="button" class="pks-link" data-act="coowner" style="padding:0 0 12px">+ Add a co-owner signature</button>`}
          <p class="pks-legal">NOTICE OF RIGHT TO CANCEL: You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction.</p>`;
        next = 'Sign agreement';
      } else if (s === 3) {
        const who = [{ k: 'homeowner', n: st.homeownerName }].concat(st.coowner ? [{ k: 'coowner', n: st.coownerName }] : []);
        body = `<h2>Third-Party Authorization</h2>
          <p class="pks-sub">This lets your insurance company discuss the claim with StormShield Pro Roofing and its staff, and share claim status, coverage decisions, estimates, photos, supplements and payment status. StormShield is not a public adjuster and will not negotiate or settle your claim. It stays in effect through any denial, re-inspection, supplement, appeal or appraisal until you revoke it in writing.</p>
          ${who.map(x => st.tpaApplied[x.k]
            ? `<div class="pks-applied"><img src="${st.sig[x.k]}" alt=""><span style="font-size:14px">${esc(x.n)} — signed</span></div>`
            : `<button type="button" class="pks-b go" style="width:100%;margin-bottom:12px" data-tpa="${x.k}">${esc(x.n || 'Homeowner')}: sign the authorization</button>`).join('')}
          <p class="pks-legal">Tapping the button places the signature you just drew on the authorization (page 2).</p>`;
        nextOk = who.every(x => st.tpaApplied[x.k]);
        if (remote) next = 'Finish & sign';
      } else if (s === 4 && !remote) {
        body = `<div class="pks-ok">✓ Thank you! Please hand the device back to your StormShield representative.</div>
          <h2>StormShield representative</h2>
          <div class="pks-fld"><label for="pks-rn">Representative name</label><input id="pks-rn" data-name="rep" value="${esc(st.repName)}"></div>
          <div class="pks-pad" data-pad="sspr"></div>
          <div class="pks-padbar"><span>Representative signature</span><button type="button" class="pks-link" data-clear="sspr">Clear</button></div>`;
        next = 'Finish & save';
      } else {
        body = `<div class="pks-ok" data-done>Saving the signed packet…</div>`;
        canBack = false;
      }
      ov.innerHTML = `<div class="pks-top"><b>StormShield Pro Roofing · Claim Packet</b><span>${s < DONE ? 'Step ' + (s + 1) + ' of ' + DONE : 'Finishing'}</span></div>
        <div class="pks-bar"><i style="width:${pct}%"></i></div>
        <div class="pks-body">${body}</div>
        ${s < DONE ? `<div class="pks-foot"><div>
          ${(canBack || !remote) ? `<button type="button" class="pks-b" data-act="${canBack ? 'back' : 'cancel'}">${canBack ? 'Back' : 'Cancel'}</button>` : ''}
          <button type="button" class="pks-b go" data-act="next" ${nextOk ? '' : 'disabled'}>${next}</button></div></div>` : ''}`;

      pads = {};
      ov.querySelectorAll('[data-pad]').forEach(h => { pads[h.dataset.pad] = makePad(h); });
      wire();
      const bodyEl = ov.querySelector('.pks-body'); if (bodyEl) bodyEl.scrollTop = 0;
    };

    const refreshNext = ok => { const b = ov.querySelector('[data-act="next"]'); if (b) b.disabled = !ok; };

    function wire() {
      const c = ov.querySelector('[data-consent]');
      if (c) c.addEventListener('change', () => { st.consentAt = c.checked ? new Date().toISOString() : null; refreshNext(!!st.consentAt); });
      ov.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.clear; if (pads[k]) pads[k].clear();
        if (k === 'initials') { st.initials = null; st.initialed = {}; render(); }
      }));
      ov.querySelectorAll('[data-name]').forEach(inp => inp.addEventListener('input', () => {
        const k = inp.dataset.name;
        if (k === 'homeowner') st.homeownerName = inp.value; else if (k === 'coowner') st.coownerName = inp.value; else st.repName = inp.value;
      }));
      ov.querySelectorAll('[data-ini]').forEach(b => b.addEventListener('click', () => {
        if (!st.initials) {
          const png = pads.initials && pads.initials.toPng();
          if (!png) { say('Draw your initials in the box first'); return; }
          st.initials = png;
        }
        const k = b.dataset.ini === 'ded' ? 'ded' : Number(b.dataset.ini);
        st.initialed[k] = !st.initialed[k];
        st.at['initial_' + k] = new Date().toISOString();
        render();
      }));
      ov.querySelectorAll('[data-tpa]').forEach(b => b.addEventListener('click', () => {
        st.tpaApplied[b.dataset.tpa] = true; st.at['tpa_' + b.dataset.tpa] = new Date().toISOString(); render();
      }));
      ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
    }

    const result = () => ({
      consentAt: st.consentAt, homeownerName: st.homeownerName.trim(), coowner: st.coowner, coownerName: st.coownerName.trim(),
      initials: st.initials, initialed: st.initialed, sig: st.sig, tpaApplied: st.tpaApplied, at: st.at, repName: st.repName.trim()
    });

    async function runFinish() {
      st.step = DONE; render();
      const box = () => ov.querySelector('[data-done]');
      try {
        const out = await opts.onFinish(result());
        const b = box(); if (!b) return;
        b.innerHTML = remote ? '✓ Signed! Thank you.' : '✓ Signed and saved to the job.';
        const after = document.createElement('div');
        after.innerHTML = `<div class="pks-card" style="font-size:14px;line-height:1.6">${remote
            ? `Your signed copy is ready below. StormShield Pro Roofing has a copy too.<br>You may cancel until midnight on <b>${esc(fmtDate(out.cancelBy))}</b>. Questions? Call 832-910-7735.`
            : `Cancellation window ends <b>${esc(fmtDate(out.cancelBy))}</b> at midnight.`}</div>
          <div style="display:flex;gap:10px">${out.finalBytes ? `<button type="button" class="pks-b${remote ? ' go' : ''}" data-v>${remote ? 'Download my copy' : 'View signed PDF'}</button>` : ''}${remote ? '' : '<button type="button" class="pks-b go" data-x>Done</button>'}</div>`;
        b.parentNode.appendChild(after);
        const v = after.querySelector('[data-v]');
        if (v) v.onclick = () => (remote ? downloadBytes(out.finalBytes, out.fileName || 'StormShield Claim Packet (signed).pdf') : openBlob(out.finalBytes));
        const x = after.querySelector('[data-x]');
        if (x) x.onclick = () => { close(); if (opts.onDone) opts.onDone(); };
      } catch (e) {
        console.error('[packet] finish failed', e);
        const b = box(); if (!b) return;
        b.style.background = '#FDECEC'; b.style.color = '#8A1C1C';
        b.innerHTML = esc(e && e.userMessage ? e.userMessage : 'Could not save the signed packet. Check your connection and try again.') + ' <button type="button" class="pks-link" data-retry>Try again</button>';
        b.querySelector('[data-retry]').onclick = () => { b.style.background = ''; b.style.color = ''; b.textContent = 'Saving…'; runFinish(); };
      }
    }

    async function act(a) {
      if (a === 'cancel') { if (root.confirm('Stop signing? Nothing will be saved.')) close(); return; }
      if (a === 'back') { st.step = Math.max(0, st.step - 1); render(); return; }
      if (a === 'view') { try { openBlob(await buildPdf(fields, {}, {})); } catch (e) { say('Could not open the PDF'); } return; }
      if (a === 'coowner') { st.coowner = true; render(); return; }
      if (a === 'nocoowner') { st.coowner = false; delete st.sig.coowner; st.tpaApplied.coowner = false; render(); return; }
      if (a !== 'next') return;
      if (st.step === 2) {
        if (!st.homeownerName.trim()) { say('Enter your full name'); return; }
        const hp = pads.homeowner && pads.homeowner.toPng();
        if (!hp) { say('Please sign in the box'); return; }
        st.sig.homeowner = hp; st.at.homeowner = new Date().toISOString();
        if (st.coowner) {
          if (!st.coownerName.trim()) { say('Enter the co-owner’s name'); return; }
          const cp = pads.coowner && pads.coowner.toPng();
          if (!cp) { say('Co-owner: please sign in the box'); return; }
          st.sig.coowner = cp; st.at.coowner = new Date().toISOString();
        }
      }
      if (st.step === 3 && remote) { await runFinish(); return; }
      if (st.step === 4 && !remote) {
        if (!st.repName.trim()) { say('Enter the representative name'); return; }
        const rp = pads.sspr && pads.sspr.toPng();
        if (!rp) { say('Representative: please sign'); return; }
        st.sig.sspr = rp; st.at.sspr = new Date().toISOString();
        await runFinish();
        return;
      }
      st.step++; render();
    }

    render();
    return { close };
  }

  function downloadBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // In person, on the rep's phone or tablet.
  function startSigning(jobId) {
    const j = jobById(jobId); if (!j) return;
    const p = ensurePacket(j);
    const miss = missingForSigning(p.fields);
    if (miss.length) { say('Fill in first: ' + miss.join(', ')); return; }
    if (!root.PDFLib) { say('PDF library still loading — try again in a moment'); return; }
    loadTemplate().catch(() => {});
    openSigningFlow({
      fields: p.fields, mode: 'in_person', repName: me(),
      onDone: rerender,
      onFinish: async r => {
        const signedAt = new Date();
        const out = await finalizeSigned(p.fields, r, {
          signedAt, device: navigator.userAgent,
          how: 'In person on a StormShield device. Each signer agreed to sign electronically, initialed each key term, and drew their own signature.',
          details: me() && me() !== r.repName ? ['Logged into the CRM as ' + me()] : []
        });
        const clean = s2 => String(s2 || '').replace(/[\\/:*?"<>|]+/g, '').trim();
        const fname = `${clean(p.fields.name) || 'Homeowner'} - ${clean(p.fields.street) || 'Property'} - Claim Packet (signed) - ${fmtDate(signedAt).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')}.pdf`;
        const file = new File([out.finalBytes], fname, { type: 'application/pdf' });
        let rec = null;
        if (typeof root.intakeJobFile === 'function') rec = await root.intakeJobFile(file, 'packet', null);
        if (!rec) throw new Error('upload failed');
        if (!Array.isArray(j.packetFiles)) j.packetFiles = [];
        j.packetFiles.push(rec);
        p.status = 'signed';
        p.signed = {
          method: 'in_person', at: signedAt.toISOString(), cancelBy: out.cancelBy.toISOString(), sha256: out.hash,
          homeowner: { name: r.homeownerName }, coowner: r.coowner ? { name: r.coownerName } : null,
          rep: { name: r.repName, user: me() }, consentAt: r.consentAt, file: { name: rec.name, path: rec.path || null }
        };
        if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet signed', `Contingency Agreement + Third-Party Authorization signed in person by ${r.homeownerName}${r.coowner ? ' and ' + r.coownerName : ''}. Cancellation window ends ${fmtDate(out.cancelBy)}.`);
        save();
        return out;
      }
    });
  }

  /* ---------------------------------------------------------------- remote links (CRM side) */
  const SIGN_PAGE = 'sign.html';
  const LINK_DAYS = 7;
  const db = () => root.sb || null;

  function randomToken() {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function sha256Text(t) { return sha256Hex(new TextEncoder().encode(t)); }
  function signUrl(token) {
    const base = root.location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + SIGN_PAGE + '?t=' + encodeURIComponent(token);
  }
  function smsHref(phone, body) {
    const num = String(phone || '').replace(/[^\d+]/g, '');
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return 'sms:' + num + (ios ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }
  function linkMessage(f, repName, url) {
    const first = String(f.name || '').trim().split(/\s+/)[0] || 'there';
    return `Hi ${first}, this is ${repName || 'your rep'} with StormShield Pro Roofing. Please review and sign your claim paperwork for ${f.street || 'your property'} here (about 2 minutes): ${url}\nQuestions? Call 832-910-7735.`;
  }

  async function loadLinks(j) {
    if (!db() || !j._sb) return [];
    const { data, error } = await db().from('packet_links')
      .select('id,status,created_at,created_by,expires_at,viewed_at,signed_at,sent_to,signed_summary')
      .eq('job_id', j.id).order('created_at', { ascending: false });
    if (error) { console.warn('[packet] links load failed', error.message || error); return []; }
    return data || [];
  }

  // A homeowner may have signed by link while this job was open: pick that up.
  async function reconcile(j, links) {
    const p = ensurePacket(j);
    // Only a link signed after the last "Start a new packet" counts, and never one already recorded.
    const seen = new Set((p.history || []).concat(p.signed ? [p.signed] : []).map(x => x && (x.linkId || x.at)).filter(Boolean));
    const after = p.restartedAt ? new Date(p.restartedAt) : null;
    const signedLink = links.find(l => l.status === 'signed' && !seen.has(l.id) &&
      !seen.has((l.signed_summary || {}).at) && !(after && new Date(l.signed_at) <= after));
    let changed = false;
    if (signedLink && p.status !== 'signed') {
      const sm = signedLink.signed_summary || {};
      p.status = 'signed';
      p.signed = Object.assign({ method: 'remote', at: signedLink.signed_at }, sm, { linkId: signedLink.id });
      changed = true;
      if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet signed', `Signed remotely by ${(sm.homeowner && sm.homeowner.name) || 'the homeowner'}${sm.coowner ? ' and ' + sm.coowner.name : ''} through a signing link.${sm.cancelBy ? ' Cancellation window ends ' + fmtDate(new Date(sm.cancelBy)) + '.' : ''}`);
    }
    if (signedLink && db()) {
      const { data: rows } = await db().from('job_files').select('id,name,storage_path').eq('job_id', j.id).eq('kind', 'packet');
      const known = new Set((j.packetFiles || []).map(f => f.path));
      for (const r of (rows || [])) {
        if (known.has(r.storage_path)) continue;
        const { data: su } = await db().storage.from('job-files').createSignedUrl(r.storage_path, 60 * 60 * 24 * 7);
        j.packetFiles.push({ name: r.name, path: r.storage_path, _id: r.id, url: su && su.signedUrl, isPdf: true });
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }

  function linkStatus(l) {
    const expired = l.status !== 'signed' && l.status !== 'void' && new Date(l.expires_at) < new Date();
    if (l.status === 'signed') return ['Signed ' + fmtDateTime(l.signed_at), '#34D399'];
    if (l.status === 'void') return ['Cancelled', '#8B94A7'];
    if (expired) return ['Expired', '#8B94A7'];
    if (l.viewed_at) return ['Opened ' + fmtDateTime(l.viewed_at), '#F2C46B'];
    return ['Sent ' + fmtDateTime(l.created_at) + ' — not opened yet', '#9DB8F5'];
  }

  async function renderLinks(j) {
    const host = document.getElementById('pk-links'); if (!host) return;
    const links = await loadLinks(j);
    if (await reconcile(j, links)) { rerender(); return; }
    if (!links.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="pk-sec"><h4>Signing links</h4><div class="pk-files">${links.map(l => {
      const [txt, color] = linkStatus(l);
      const live = l.status !== 'signed' && l.status !== 'void' && new Date(l.expires_at) >= new Date();
      return `<div class="pk-file"><span style="width:9px;height:9px;border-radius:50%;background:${color};flex:none"></span>
        <span class="pk-fn" style="font-weight:500;color:var(--text)">${esc(txt)}${l.sent_to ? ' · ' + esc(l.sent_to) : ''}</span>
        ${live ? `<button type="button" onclick="crmPacket.voidLink('${j.id}','${l.id}')">Cancel link</button>` : ''}</div>`;
    }).join('')}</div><p class="pk-note">A link carries the answers as they were when it was sent. Links expire after ${LINK_DAYS} days. For security a link can't be shown again — send a new one if needed.</p></div>`;
  }

  async function voidLink(jobId, linkId) {
    const j = jobById(jobId); if (!j || !db()) return;
    if (!root.confirm('Cancel this signing link? The homeowner will no longer be able to use it.')) return;
    const { error } = await db().from('packet_links').update({ status: 'void' }).eq('id', linkId).neq('status', 'signed');
    if (error) { say('Could not cancel the link'); return; }
    say('Link cancelled'); renderLinks(j);
  }

  // Rep signs once, then a private link is created and sent from the rep's phone / email.
  function sendForSignature(jobId) {
    const j = jobById(jobId); if (!j) return;
    const p = ensurePacket(j);
    const miss = missingForSigning(p.fields);
    if (miss.length) { say('Fill in first: ' + miss.join(', ')); return; }
    if (!db() || !j._sb) { say('This job isn’t synced yet — try again in a moment'); return; }
    injectStyles();
    const ov = document.createElement('div');
    ov.id = 'pkSign';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Send claim packet for signature');
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => { ov.remove(); document.body.style.overflow = prevOverflow; renderLinks(j); };
    let repName = me(), phone = p.fields.cell_phone || '', email = p.fields.email || '';

    const step1 = () => {
      ov.innerHTML = `<div class="pks-top"><b>Send for signature</b><span>${esc(p.fields.name || '')}</span></div>
        <div class="pks-body">
          <h2>Your signature first</h2>
          <p class="pks-sub">Sign as the StormShield representative. Then a private link is created for the homeowner to review, initial and sign on their own phone.</p>
          <div class="pks-fld"><label for="pks-rn">Representative name</label><input id="pks-rn" value="${esc(repName)}"></div>
          <div class="pks-pad" data-pad="sspr"></div>
          <div class="pks-padbar"><span>Representative signature</span><button type="button" class="pks-link" data-clear>Clear</button></div>
          <div class="pks-fld"><label for="pks-ph">Homeowner mobile</label><input id="pks-ph" inputmode="tel" value="${esc(phone)}"></div>
          <div class="pks-fld"><label for="pks-em">Homeowner email</label><input id="pks-em" inputmode="email" value="${esc(email)}"></div>
        </div>
        <div class="pks-foot"><div><button type="button" class="pks-b" data-cancel>Cancel</button><button type="button" class="pks-b go" data-create>Create signing link</button></div></div>`;
      const pad = makePad(ov.querySelector('[data-pad]'));
      ov.querySelector('[data-clear]').onclick = () => pad.clear();
      ov.querySelector('[data-cancel]').onclick = () => { ov.remove(); document.body.style.overflow = prevOverflow; };
      ov.querySelector('[data-create]').onclick = async () => {
        repName = ov.querySelector('#pks-rn').value.trim();
        phone = ov.querySelector('#pks-ph').value.trim();
        email = ov.querySelector('#pks-em').value.trim();
        const repSig = pad.toPng();
        if (!repName) { say('Enter the representative name'); return; }
        if (!repSig) { say('Please sign first'); return; }
        if (!phone && !email) { say('Enter a mobile number or email'); return; }
        const btn = ov.querySelector('[data-create]'); btn.disabled = true; btn.textContent = 'Creating…';
        try {
          const token = randomToken();
          const now = new Date();
          const { error } = await db().from('packet_links').insert({
            job_id: j.id, token_hash: await sha256Text(token), fields: p.fields,
            rep_name: repName, rep_sig: repSig, rep_signed_at: now.toISOString(),
            created_by: me() || repName, sent_to: [phone, email].filter(Boolean).join(' / '),
            expires_at: new Date(now.getTime() + LINK_DAYS * 864e5).toISOString()
          });
          if (error) throw error;
          if (phone && !p.fields.cell_phone) p.fields.cell_phone = phone;
          if (email && !p.fields.email) p.fields.email = email;
          if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet sent for signature', 'Signing link created by ' + repName + (phone || email ? ' for ' + [phone, email].filter(Boolean).join(' / ') : ''));
          save();
          step2(signUrl(token));
        } catch (e) {
          console.error('[packet] link create failed', e);
          say('Could not create the link — ' + (e.message || 'try again'));
          btn.disabled = false; btn.textContent = 'Create signing link';
        }
      };
    };

    const step2 = url => {
      const msg = linkMessage(p.fields, repName, url);
      ov.innerHTML = `<div class="pks-top"><b>Send for signature</b><span>${esc(p.fields.name || '')}</span></div>
        <div class="pks-body">
          <div class="pks-ok">✓ Link ready — it works for ${LINK_DAYS} days.</div>
          <h2>Send it to the homeowner</h2>
          <p class="pks-sub">Text opens your phone’s Messages app with the message filled in — just hit send.</p>
          ${phone ? `<a class="pks-b go" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-bottom:10px" href="${esc(smsHref(phone, msg))}" data-sent="text">Text from my phone</a>` : ''}
          ${email ? `<a class="pks-b" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-bottom:10px" href="mailto:${esc(email)}?subject=${encodeURIComponent('Your StormShield claim paperwork — please sign')}&body=${encodeURIComponent(msg)}" data-sent="email">Email it</a>` : ''}
          <button type="button" class="pks-b" style="width:100%;margin-bottom:12px" data-copy>Copy link</button>
          <div class="pks-card" style="font-size:13px;color:#3C4658;word-break:break-all">${esc(msg)}</div>
          <p class="pks-legal">For security this link is shown only now. If it’s lost, cancel it and send a new one.</p>
        </div>
        <div class="pks-foot"><div><button type="button" class="pks-b go" data-close>Done</button></div></div>`;
      ov.querySelectorAll('[data-sent]').forEach(a => a.addEventListener('click', () => {
        if (typeof root.logContact === 'function') root.logContact(j, 'client', a.dataset.sent, 'Claim packet signing link sent');
      }));
      ov.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(url); say('Link copied'); } catch (e) { root.prompt('Copy this link:', url); }
      };
      ov.querySelector('[data-close]').onclick = close;
    };
    step1();
  }

  /* ---------------------------------------------------------------- other actions */
  async function uploadPaper(jobId, fileList) {
    const j = jobById(jobId); if (!j) return;
    const files = Array.from(fileList || []); if (!files.length) return;
    const p = ensurePacket(j);
    try {
      say('Uploading…');
      const recs = await Promise.all(files.map(fl => root.intakeJobFile(fl, 'packet', null)));
      j.packetFiles.push(...recs.filter(Boolean));
      if (p.status !== 'signed') {
        const now = new Date();
        p.status = 'signed';
        p.signed = { method: 'paper', at: now.toISOString(), cancelBy: addBusinessDays(now, CANCEL_BUSINESS_DAYS).toISOString(), rep: { name: me(), user: me() } };
      }
      if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet uploaded', 'Signed paper copy uploaded');
      save(); say('Signed packet uploaded'); rerender();
    } catch (e) { console.error('[packet] upload failed', e); say('Upload failed — try again'); }
  }

  async function deleteFile(jobId, i) {
    const j = jobById(jobId); if (!j || !Array.isArray(j.packetFiles)) return;
    if (!root.confirm('Delete this signed packet file?')) return;
    const f = j.packetFiles[i];
    try { if (f && root.deleteJobFile) await root.deleteJobFile(f); } catch (e) { console.warn('[packet] delete failed', e); }
    j.packetFiles.splice(i, 1);
    save(); rerender();
  }

  function startOver(jobId) {
    const j = jobById(jobId); if (!j) return;
    if (!root.confirm('Start a new packet? The signed copy stays in the job; answers carry over so you can edit them.')) return;
    const p = ensurePacket(j);
    const hist = p.history || [];
    if (p.signed && !hist.some(h => h && h.at === p.signed.at)) hist.push(p.signed);
    p.history = hist;
    p.status = 'draft'; p.signed = null;
    p.restartedAt = new Date().toISOString();
    save(); rerender();
  }

  Object.assign(api, { renderPacketTab, startSigning, preview, uploadPaper, deleteFile, startOver, buildPdf, addAuditPage,
    finalizeSigned, openSigningFlow, setTemplateBytes, sendForSignature, voidLink, renderLinks, sha256Hex, CONSENT });
})(typeof window !== 'undefined' ? window : globalThis);
