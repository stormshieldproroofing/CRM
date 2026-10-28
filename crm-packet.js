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

  // Add n business days (Mon–Fri). Federal holidays are not skipped.
  function addBusinessDays(date, n) {
    const d = new Date(date.getTime());
    let left = n;
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return d;
  }

  function fmtDate(d) {
    if (!d) return '';
    const x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return String(d);
    return String(x.getMonth() + 1).padStart(2, '0') + '/' + String(x.getDate()).padStart(2, '0') + '/' + x.getFullYear();
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

  const api = { TEMPLATE_URL, PACKET_VERSION, TPA_MIRROR, TEXT_FIELDS, CHECK_FIELDS, YES_NO, KEY_TERMS,
    splitAddress, addBusinessDays, fmtDate, fmtLooseDate, prefillFromJob, pdfValues, missingForSigning };
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
             <button type="button" class="pk-btn" onclick="crmPacket.preview('${j.id}')"><i class="ti ti-printer"></i> Preview / print</button>`}
        <label class="pk-btn" style="margin:0"><i class="ti ti-upload"></i> Upload signed paper copy
          <input type="file" accept=".pdf,image/*" style="display:none" onchange="crmPacket.uploadPaper('${j.id}', this.files)"></label>
      </div>
      ${files ? `<div class="pk-sec"><h4>Signed packets</h4><div class="pk-files">${files}</div></div>` : ''}

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
    line('In person on a StormShield device. Each signer agreed to sign electronically, initialed each key term, and drew their own signature.', { indent: 10 });
    line('Device: ' + (audit.device || 'unknown'), { indent: 10, color: grey });
    line('Prepared and witnessed by: ' + (audit.rep || 'StormShield representative'), { indent: 10 });
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

  function startSigning(jobId) {
    const j = jobById(jobId); if (!j) return;
    const p = ensurePacket(j);
    const miss = missingForSigning(p.fields);
    if (miss.length) { say('Fill in first: ' + miss.join(', ')); return; }
    if (!root.PDFLib) { say('PDF library still loading — try again in a moment'); return; }
    loadTemplate().catch(() => {});
    injectStyles();

    const st = {
      step: 0, consentAt: null,
      homeownerName: (p.fields.name || '').split(/\s*(?:&|\band\b|,)\s*/)[0] || p.fields.name || '',
      coowner: false, coownerName: '',
      initials: null, initialed: {},
      sig: {}, tpaApplied: { homeowner: false, coowner: false },
      repName: me(), at: {}
    };
    const steps = ['Agree to sign electronically', 'Initial the key terms', 'Sign the agreement', 'Sign the authorization', 'StormShield signature', 'Done'];

    const ov = document.createElement('div');
    ov.id = 'pkSign';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Sign claim packet');
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => { ov.remove(); document.body.style.overflow = prevOverflow; };

    let pads = {};
    const render = () => {
      const s = st.step;
      const pct = Math.round((s / (steps.length - 1)) * 100);
      let body = '', next = 'Continue', canBack = s > 0 && s < 5, nextOk = true;
      if (s === 0) {
        body = `<h2>Hi ${esc(st.homeownerName || 'there')}</h2>
          <p class="pks-sub">This is your Contingency Agreement and Third-Party Authorization with StormShield Pro Roofing for <b>${esc(p.fields.street || '')}</b>. It takes about 2 minutes.</p>
          <div class="pks-card"><button type="button" class="pks-link" data-act="view" style="padding:0"><i class="ti ti-file-text"></i> Read the full agreement (PDF)</button></div>
          <label class="pks-check"><input type="checkbox" data-consent ${st.consentAt ? 'checked' : ''}><span>${esc(CONSENT)}</span></label>`;
        nextOk = !!st.consentAt;
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
          <div class="pks-term"><p><b>Deductible.</b> I understand my insurance deductible${p.fields.deductible ? ' of $' + esc(p.fields.deductible) : ''} is my responsibility.</p>
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
            : `<button type="button" class="pks-link" data-act="coowner" style="padding:0 0 12px"><i class="ti ti-user-plus"></i> Add a co-owner signature</button>`}
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
      } else if (s === 4) {
        body = `<div class="pks-ok"><i class="ti ti-circle-check" style="font-size:20px"></i> Thank you! Please hand the device back to your StormShield representative.</div>
          <h2>StormShield representative</h2>
          <div class="pks-fld"><label for="pks-rn">Representative name</label><input id="pks-rn" data-name="rep" value="${esc(st.repName)}"></div>
          <div class="pks-pad" data-pad="sspr"></div>
          <div class="pks-padbar"><span>Representative signature</span><button type="button" class="pks-link" data-clear="sspr">Clear</button></div>`;
        next = 'Finish & save';
      } else {
        body = `<div class="pks-ok" data-done><i class="ti ti-loader-2" style="font-size:20px"></i> Saving the signed packet…</div>`;
        canBack = false;
      }
      ov.innerHTML = `<div class="pks-top"><b>Claim Packet</b><span>${s < 5 ? 'Step ' + (s + 1) + ' of 5 · ' + esc(steps[s]) : 'Finishing'}</span></div>
        <div class="pks-bar"><i style="width:${pct}%"></i></div>
        <div class="pks-body">${body}</div>
        ${s < 5 ? `<div class="pks-foot"><div>
          <button type="button" class="pks-b" data-act="${canBack ? 'back' : 'cancel'}">${canBack ? 'Back' : 'Cancel'}</button>
          <button type="button" class="pks-b go" data-act="next" ${nextOk ? '' : 'disabled'}>${next}</button></div></div>` : ''}`;

      pads = {};
      ov.querySelectorAll('[data-pad]').forEach(h => { pads[h.dataset.pad] = makePad(h); });
      wire();
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

    async function act(a) {
      if (a === 'cancel') { if (root.confirm('Stop signing? Nothing will be saved.')) close(); return; }
      if (a === 'back') { st.step = Math.max(0, st.step - 1); render(); return; }
      if (a === 'view') { try { openBlob(await buildPdf(p.fields, {}, {})); } catch (e) { say('Could not open the PDF'); } return; }
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
      if (st.step === 4) {
        if (!st.repName.trim()) { say('Enter the representative name'); return; }
        const rp = pads.sspr && pads.sspr.toPng();
        if (!rp) { say('Representative: please sign'); return; }
        st.sig.sspr = rp; st.at.sspr = new Date().toISOString();
        st.step = 5; render();
        try { await finish(); } catch (e) {
          console.error('[packet] finish failed', e);
          const box = ov.querySelector('[data-done]');
          if (box) { box.style.background = '#FDECEC'; box.style.color = '#8A1C1C'; box.innerHTML = 'Could not save the signed packet. Check your connection and try again. <button type="button" class="pks-link" data-retry>Retry</button>'; box.querySelector('[data-retry]').onclick = () => { box.innerHTML = 'Saving…'; finish().catch(err => { console.error(err); box.textContent = 'Still failing — please contact the office.'; }); }; }
        }
        return;
      }
      st.step++; render();
    }

    async function finish() {
      const signedAt = new Date();
      const cancelBy = addBusinessDays(signedAt, CANCEL_BUSINESS_DAYS);
      const sigs = {
        initials: st.initials, homeowner: st.sig.homeowner, coowner: st.coowner ? st.sig.coowner : null, sspr: st.sig.sspr,
        tpa1: st.tpaApplied.homeowner ? st.sig.homeowner : null,
        tpa2: st.coowner && st.tpaApplied.coowner ? st.sig.coowner : null
      };
      const signedBytes = await buildPdf(p.fields, sigs, { signedAt, homeownerName: st.homeownerName.trim(), coownerName: st.coownerName.trim() });
      const hash = await sha256Hex(signedBytes);
      const local = d => new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      const signers = [{ role: 'Property owner', name: st.homeownerName.trim(), at: local(st.at.homeowner) }];
      if (sigs.coowner) signers.push({ role: 'Co-owner', name: st.coownerName.trim(), at: local(st.at.coowner) });
      signers.push({ role: 'StormShield representative', name: st.repName.trim(), at: local(st.at.sspr) });
      const audit = {
        property: [p.fields.street, p.fields.city_state, p.fields.zip].filter(Boolean).join(', '),
        signers, device: navigator.userAgent, rep: st.repName.trim() + (me() && me() !== st.repName.trim() ? ' (logged in as ' + me() + ')' : ''),
        consent: CONSENT, consentAt: local(st.consentAt), hash, cancelBy: fmtDate(cancelBy)
      };
      const finalBytes = await addAuditPage(signedBytes, audit);

      const clean = s2 => String(s2 || '').replace(/[\\/:*?"<>|]+/g, '').trim();
      const fname = `${clean(p.fields.name) || 'Homeowner'} - ${clean(p.fields.street) || 'Property'} - Claim Packet (signed) - ${signedAt.toISOString().slice(0, 10)}.pdf`;
      const file = new File([finalBytes], fname, { type: 'application/pdf' });
      let rec = null;
      if (typeof root.intakeJobFile === 'function') rec = await root.intakeJobFile(file, 'packet', null);
      if (!rec) throw new Error('upload failed');
      if (!Array.isArray(j.packetFiles)) j.packetFiles = [];
      j.packetFiles.push(rec);

      p.status = 'signed';
      p.signed = {
        method: 'in_person', at: signedAt.toISOString(), cancelBy: cancelBy.toISOString(), sha256: hash,
        homeowner: { name: st.homeownerName.trim() }, coowner: sigs.coowner ? { name: st.coownerName.trim() } : null,
        rep: { name: st.repName.trim(), user: me() }, consentAt: st.consentAt, file: { name: rec.name, path: rec.path || null }
      };
      if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet signed', `Contingency Agreement + Third-Party Authorization signed in person by ${st.homeownerName.trim()}${sigs.coowner ? ' and ' + st.coownerName.trim() : ''}. Cancellation window ends ${fmtDate(cancelBy)}.`);
      save();

      const box = ov.querySelector('[data-done]');
      if (box) {
        box.innerHTML = '<i class="ti ti-circle-check" style="font-size:20px"></i> Signed and saved to the job.';
        const after = document.createElement('div');
        after.innerHTML = `<div class="pks-card" style="font-size:14px;line-height:1.6">Cancellation window ends <b>${esc(fmtDate(cancelBy))}</b> at midnight.<br>Send the homeowner their copy from the job’s Packet tab.</div>
          <div style="display:flex;gap:10px"><button type="button" class="pks-b" data-v>View signed PDF</button><button type="button" class="pks-b go" data-x>Done</button></div>`;
        box.parentNode.appendChild(after);
        after.querySelector('[data-v]').onclick = () => openBlob(finalBytes);
        after.querySelector('[data-x]').onclick = () => { close(); rerender(); };
      }
    }

    render();
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
    p.history = (p.history || []).concat(p.signed ? [p.signed] : []);
    p.status = 'draft'; p.signed = null;
    save(); rerender();
  }

  Object.assign(api, { renderPacketTab, startSigning, preview, uploadPaper, deleteFile, startOver, buildPdf });
})(typeof window !== 'undefined' ? window : globalThis);
