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

  /* ---------------------------------------------------------------- Packet tab: what's still blank */
  // Per form section, the answers still missing. Only for the "Done / N missing" badges —
  // signing itself is only blocked by missingForSigning().
  function sectionMissing(fields) {
    const f = fields || {};
    const blank = k => !String(f[k] == null ? '' : f[k]).trim();
    const out = {
      client: ['name', 'street', 'city_state', 'zip', 'cell_phone'].filter(blank),
      project: ['changed_insurance', 'prior_claim', 'other_properties'].filter(q => f[q] !== 'yes' && f[q] !== 'no'),
      loss: f.roof_wind === true || f.roof_hail === true ? [] : ['roof_loss'],
      insurance: ['insurance_company', 'policy_number', 'date_of_loss'].filter(blank)
    };
    if (f.changed_insurance === 'yes' && blank('prior_insurance')) out.project.push('prior_insurance');
    if (f.prior_claim === 'yes' && blank('prior_claim_allocated')) out.project.push('prior_claim_allocated');
    return out;
  }

  const api = { TEMPLATE_URL, PACKET_VERSION, TPA_MIRROR, TEXT_FIELDS, CHECK_FIELDS, YES_NO, KEY_TERMS, CANCEL_BUSINESS_DAYS,
    splitAddress, addBusinessDays, fmtDate, fmtDateTime, fmtLooseDate, prefillFromJob, pdfValues, missingForSigning, sectionMissing };
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
.pk-sec{background:var(--card,#161B26);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.pk-sec h4{margin:0 0 10px;font-size:12px;letter-spacing:.04em;color:var(--brand);text-transform:uppercase}
.pk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}
.pk-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 16px}
.pk-fld{display:flex;flex-direction:column;gap:4px;min-width:0}
.pk-fld.full{grid-column:1/-1}
.pk-fld label{font-size:11px;color:var(--muted);font-weight:600}
.pk-fld input,.pk-fld select{background:#1E253A;border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:14px;font-family:inherit;min-width:0;width:100%;box-sizing:border-box}
.pk-fld input:disabled,.pk-fld select:disabled{opacity:.7}
.pk-trk{position:relative;background:var(--card,#161B26);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.pk-hd{display:flex;gap:12px;align-items:center}
.pk-hd-ico{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:none}
.pk-hd h3{margin:0;font-size:16px;font-weight:700;color:var(--brand)}
.pk-hd p{margin:2px 0 0;font-size:12px;color:#8B94A7;line-height:1.4}
.pk-sa{position:relative;display:flex;justify-content:space-between;margin:16px 0 2px;max-width:640px}
.pk-sa::before{content:"";position:absolute;left:38px;right:38px;top:10px;height:3px;border-radius:2px;background:#283044}
.pk-sa-f{position:absolute;left:38px;top:10px;height:3px;border-radius:2px}
.pk-st{position:relative;width:76px;text-align:center;font-size:12px;color:#8B94A7;line-height:1.3}
.pk-st i{display:flex;width:23px;height:23px;border-radius:50%;background:#283044;margin:0 auto 6px;align-items:center;justify-content:center;color:#0A0D13;border:3px solid var(--card,#161B26);box-sizing:content-box}
.pk-st span{display:block}
.pk-st.d{color:var(--brand)}
.pk-st small{display:block;font-size:11px;color:#8B94A7;margin-top:1px}
.pk-acts{position:relative;display:flex;gap:8px;margin-top:14px;max-width:640px}
.pk-b{flex:1;min-width:0;min-height:44px;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 10px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:var(--brand);font-family:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.pk-b:hover{border-color:var(--brand-mid)}
.pk-b.primary{background:#2F6FEB;border-color:#2F6FEB;color:#fff}
.pk-b:disabled{opacity:.5;cursor:not-allowed}
.pk-b.pk-mb{flex:none;width:46px;padding:0}
.pk-b.pk-mb[aria-expanded="true"]{border-color:#5B7BD6;box-shadow:0 0 0 2px rgba(91,123,214,.25)}
.pk-more{position:absolute;right:0;top:calc(100% + 6px);z-index:30;min-width:240px;background:#1E253A;border:1px solid #33405A;border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.55);overflow:hidden}
.pk-more[hidden]{display:none}
.pk-more>button,.pk-more>label{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;min-height:46px;box-sizing:border-box;border:0;border-top:1px solid #2A3346;background:none;color:var(--brand);font-family:inherit;font-size:14px;font-weight:500;line-height:1.3;text-align:left;cursor:pointer;margin:0}
.pk-more>:first-child{border-top:0}
.pk-more>button:hover,.pk-more>label:hover{background:#26304A}
.pk-more .danger{color:#F87171}
.pk-xf{position:relative;display:flex;align-items:center;gap:6px;margin-top:12px;max-width:640px;background:#0F141E;border:1px solid var(--border);border-radius:10px}
.pk-xf-main{flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:9px 12px;background:none;border:0;color:var(--brand);font-family:inherit;text-align:left;cursor:pointer}
.pk-xf-ico{width:26px;height:32px;border-radius:5px;background:rgba(127,166,245,.14);color:#7FA6F5;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.pk-xf-t{min-width:0;display:flex;flex-direction:column}
.pk-xf-t b{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-xf-t small{font-size:11px;color:#8B94A7}
.pk-xf-m{flex:none;width:40px;height:40px;margin-right:4px;border:0;background:none;color:#8B94A7;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:8px}
.pk-formbar{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 12px;padding:13px 14px;border:1px solid var(--border);border-radius:11px;background:#141927;color:var(--brand);font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;text-align:left}
.pk-formbar[aria-expanded="true"]{border-color:#33405A}
.pk-fb-t{flex:1}
.pk-fb-c{display:flex;color:#8B94A7;transition:transform .15s}
.pk-formbar[aria-expanded="true"] .pk-fb-c{transform:rotate(180deg)}
.pk-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:0;text-transform:none}
.pk-badge.ok{background:rgba(52,211,153,.14);color:#34D399}
.pk-badge.need{background:rgba(242,196,107,.14);color:#F2C46B}
.pk-badge.lock{background:#1E2538;color:#8B94A7}
.pk-badge.opt{background:none;color:#5A6580;font-weight:600}
.pk-sec h4{display:flex;align-items:center;gap:8px}
.pk-sec h4 .pk-badge{margin-left:auto}
.pk-fld input.miss,.pk-dt>input.miss{border-color:rgba(242,196,107,.65)}
.pk-follow{margin:2px 0 6px}
.pk-follow[hidden]{display:none}
[data-pkloss].miss .pk-chip[data-pkc="roof_wind"],[data-pkloss].miss .pk-chip[data-pkc="roof_hail"]{border-color:rgba(242,196,107,.65)}
.pk-seg{display:flex;flex:none;background:#1E253A;border:1px solid var(--border);border-radius:10px;padding:3px}
.pk-seg.miss{border-color:rgba(242,196,107,.65)}
.pk-seg button{border:0;background:none;color:#8B94A7;font-family:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:7px;cursor:pointer;min-height:32px}
.pk-seg button.on{background:#34405C;color:#fff}
.pk-seg button:disabled{cursor:default}
.pk-locked .pk-calbtn{display:none}
.pk-dt{position:relative;display:flex;gap:8px}
.pk-sec{overflow:visible}
.pk-dt>input{flex:1}
.pk-calbtn{flex:none;width:44px;border-radius:8px;border:1px solid rgba(77,157,224,.45);background:rgba(77,157,224,.12);color:var(--brand-light,#9DB8F5);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.pk-calbtn[aria-expanded="true"]{background:#1D3A73;border-color:#2F6FEB;color:#fff}
.pk-calbtn:disabled{opacity:.6;cursor:default}
.pk-dd{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:20;background:#1E253A;border:1px solid #33405A;border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.5);overflow:hidden}
.pk-dd[hidden]{display:none}
.pk-ddh{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:9px 14px 7px}
.pk-ddi{position:relative;display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;min-height:46px;box-sizing:border-box;border:0;border-top:1px solid #2A3346;background:none;color:var(--text);font-family:inherit;font-size:14px;font-weight:500;line-height:1.3;text-align:left;cursor:pointer}
.pk-ddh+.pk-ddi,.pk-dd>.pk-ddi:first-child{border-top:0}
.pk-ddi:hover,.pk-ddi:focus-visible{background:#26304A;outline:none}
.pk-ddi span{display:flex;align-items:center;gap:7px}
.pk-ddi small{color:var(--muted);font-size:12px;flex:none}
.pk-ddi.storm span{color:#D8CCFF}
.pk-ddi.storm svg{color:#A78BFA}
.pk-ddi.on{background:#1D3A73}
.pk-ddi.pick{justify-content:flex-start;color:#9DB8F5;font-weight:600}
.pk-ddi.pick .pk-native{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px;border:0;padding:0;margin:0}
.pk-ddi.pick .pk-native::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:100%;height:100%;cursor:pointer}
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
@media (max-width:640px){.pk-grid:not(.pk-keep2),.pk-grid3{grid-template-columns:1fr}}
.pk-q>span:first-child{flex:1;min-width:0;line-height:1.35}

/* signing overlay (homeowner mode) — light theme, large targets */
#pkSign{position:fixed;inset:0;z-index:100000;background:#F6F7F9;color:#141A26;display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
#pkSign *{box-sizing:border-box}
#pkSign .pks-top{background:#0F1E3A;color:#fff;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between;gap:10px}
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
/* phone turned sideways: keep the signing box in view and use the extra width */
@media (orientation:landscape) and (max-height:520px){
#pkSign .pks-top{padding-top:8px;padding-bottom:8px}
#pkSign .pks-body{padding-top:10px}
#pkSign h2{font-size:17px}
#pkSign .pks-sub{display:none}
#pkSign .pks-pad{height:46vh}
#pkSign .pks-pad.small{height:34vh}
#pkSign .pkd-in .pks-pad:not(.small){height:42vh}
#pkSign .pkd-sheet{max-height:78vh}
#pkSign .pks-foot{padding-top:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom))}
#pkSign .pks-b{height:44px}
}
/* in-app PDF viewer + close buttons */
#pkSign .pkd-x{background:none;border:0;color:#fff;width:40px;height:40px;margin:-8px -8px -8px 4px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;border-radius:8px}
#pkView{position:fixed;inset:0;z-index:100001;background:#3B4252;display:flex;flex-direction:column;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
#pkView .pkv-top{background:#0F1E3A;color:#fff;padding:10px 12px calc(10px) 16px;padding-top:calc(10px + env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between;gap:10px}
#pkView .pkv-top b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#pkView .pkv-top span{display:flex;gap:8px;flex:none}
#pkView .pkv-b{height:38px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:none;color:#fff;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}
#pkView .pkv-b.x{background:#fff;color:#0F1E3A;border-color:#fff}
#pkView .pkv-pages{flex:1;min-height:0;overflow:auto;padding:12px;-webkit-overflow-scrolling:touch}
#pkView .pkv-page{display:block;width:100%;max-width:900px;height:auto;margin:0 auto 12px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
#pkView .pkv-msg{color:#fff;text-align:center;padding:40px 16px;font-size:14px}
/* document-view signing */
#pkSign .pks-top .pkd-toplink{background:none;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:8px;padding:6px 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
#pkSign .pkd-prog{background:#fff;border-bottom:1px solid #DDE1E8;display:flex;align-items:center;gap:12px;padding:8px 16px;font-size:13px;color:#4B5565;font-weight:500}
#pkSign .pkd-prog .t{flex:1;height:6px;border-radius:3px;background:#E3E7EE;overflow:hidden}
#pkSign .pkd-prog .t i{display:block;height:6px;width:0;background:#2563EB;transition:width .25s}
#pkSign .pkd-zoom{border:1px solid #C9CFDA;background:#fff;border-radius:8px;height:34px;padding:0 10px;font:600 13px Inter,system-ui,sans-serif;color:#0F1E3A;cursor:pointer}
#pkSign .pkd-scroll{flex:1;min-height:0;overflow:auto;background:#DDE2EA;padding:12px;-webkit-overflow-scrolling:touch}
#pkSign .pkd-loading{padding:40px 16px;text-align:center;color:#4B5565;font-size:14px}
#pkSign .pkd-page{position:relative;overflow:hidden;margin:0 auto 14px;background:#fff;box-shadow:0 1px 4px rgba(15,30,58,.25)}
#pkSign .pkd-page canvas{display:block;width:100%;height:100%}
#pkSign .pkd-layer{position:absolute;inset:0}
#pkSign .pkd-spot{position:absolute;padding:0;margin:0;border:1.5px solid #CA8A04;background:rgba(250,204,21,.45);border-radius:3px;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;overflow:visible;min-width:0}
#pkSign .pkd-spot.on{background:rgba(250,204,21,.8);border:2.5px solid #A16207;box-shadow:0 0 0 5px rgba(250,204,21,.35)}
#pkSign .pkd-spot.done{background:transparent;border-color:transparent;box-shadow:none}
#pkSign .pkd-spot.done.on{border-color:#A16207}
#pkSign .pkd-spot img{max-width:100%;max-height:180%;object-fit:contain;pointer-events:none}
#pkSign .pkd-auto{position:absolute;color:#1E3A8A;background:rgba(219,234,254,.85);border-radius:2px;display:flex;align-items:center;padding:0 .25em;overflow:hidden;white-space:nowrap;pointer-events:none;font-family:Helvetica,Arial,sans-serif}
#pkSign .pkd-pill{position:absolute;background:#FACC15;color:#422006;font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;box-shadow:0 2px 6px rgba(66,32,6,.3);white-space:nowrap;pointer-events:none;z-index:2;line-height:1.2}
#pkSign .pkd-pill.above{transform:translateY(-100%)}
#pkSign .pkd-sheet{flex:none;background:#fff;border-radius:18px 18px 0 0;box-shadow:0 -6px 20px rgba(15,30,58,.18);padding:0 16px calc(14px + env(safe-area-inset-bottom));max-height:62vh;overflow:auto;position:relative;z-index:3}
#pkSign .pkd-in{max-width:720px;margin:0 auto}
#pkSign .pkd-in .pks-pad:not(.small){height:130px}
#pkSign .pkd-grab{display:block;width:100%;height:22px;border:0;background:none;cursor:pointer;padding:0}
#pkSign .pkd-grab i{display:block;width:40px;height:4px;border-radius:2px;background:#C5CCD8;margin:0 auto}
#pkSign .pkd-k{font-size:12px;font-weight:600;color:#4B5565;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px}
#pkSign .pkd-h{font-size:17px;font-weight:700;margin-bottom:6px}
#pkSign .pkd-p{margin:0 0 12px;font-size:14px;line-height:1.5;color:#2B3445}
#pkSign .pkd-row{display:flex;gap:12px;align-items:flex-end;margin-bottom:12px}
#pkSign .pkd-row .pks-pad.small{flex:none;width:180px;height:84px}
#pkSign .pkd-side{display:flex;flex-direction:column;font-size:12px;color:#4B5565;line-height:1.4}
#pkSign .pkd-thumbs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0 0 12px}
#pkSign .pkd-thumbs figure{margin:0;background:#fff;border:1px solid #DDE1E8;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
#pkSign .pkd-thumb{display:block;width:100%;height:150px;overflow:hidden;border:1px solid #E3E7EE;border-radius:6px;background:#F4F6F9;padding:0;cursor:pointer}
#pkSign .pkd-thumbs.big .pkd-thumb{height:240px}
#pkSign .pkd-thumb canvas{display:block;width:100%;height:auto}
#pkSign .pkd-thumbs figcaption{display:flex;flex-direction:column;gap:2px;font-size:13px}
#pkSign .pkd-thumbs figcaption span{font-size:12px;color:#4B5565}
#pkSign .pkd-thumbs figcaption span.ok{color:#166534}
#pkSign .pkd-counts{display:flex;gap:10px;margin-bottom:12px}
#pkSign .pkd-counts div{flex:1;background:#fff;border:1px solid #DDE1E8;border-radius:10px;padding:10px;text-align:center;font-size:13px;color:#2B3445}
#pkSign .pkd-counts b{display:block;font-size:18px}
#pkSign .pkd-disc{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5;color:#3C4658}
#pkSign .pkd-disc li{margin-bottom:4px}
`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- date fields */
  // "mm/dd/yyyy" (+ optional "h:mm AM") <-> the <input type=date / datetime-local> value.
  function nativeVal(text, withTime) {
    const m = String(text || '').match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/);
    if (!m) return '';
    const d = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!withTime) return d;
    let h = m[4] ? +m[4] : 9; const min = m[5] || '00';
    if (m[6]) { const pm = /p/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return `${d}T${String(h).padStart(2, '0')}:${min}`;
  }
  function fromNative(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return '';
    const d = `${m[2]}/${m[3]}/${m[1]}`;
    if (m[4] == null) return d;
    let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${d} ${h}:${m[5]} ${ap}`;
  }
  function chipValue(v) {
    if (v === 'today') return fmtDate(new Date());
    if (v === 'yesterday') return fmtDate(new Date(Date.now() - 864e5));
    if (String(v).indexOf('tmr:') === 0) return fmtDate(new Date(Date.now() + 864e5)) + ' ' + String(v).slice(4);
    if (String(v).indexOf('text:') === 0) return String(v).slice(5);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fromNative(v);
    return String(v || '');
  }
  // Recent storm dates from the hail map (newest first) as one-tap "Date of loss" choices.
  function stormChips() {
    const keys = Object.keys(root.HAIL_SWATHS || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse().slice(0, 3);
    return keys.map(k => {
      const [y, m, d] = k.split('-').map(Number);
      const label = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) + ' storm';
      return [k, label, true];
    });
  }

  /* ---------------------------------------------------------------- Packet tab: status card */
  const SVG = (w, body, fill) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    pen: SVG(18, '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path>'),
    clock: SVG(20, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'),
    check: SVG(20, '<circle cx="12" cy="12" r="9"></circle><path d="M8 12l3 3 5-6"></path>'),
    tick: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>',
    sign: SVG(16, '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path>'),
    send: SVG(16, '<path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path>'),
    eye: SVG(16, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>'),
    dots: SVG(18, '<circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle>', true),
    doc: SVG(16, '<path d="M14 3v4a1 1 0 0 0 1 1h4"></path><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"></path><path d="M9 13h6M9 17h4"></path>'),
    caret: SVG(14, '<path d="M6 9l6 6 6-6"></path>'),
    upload: SVG(16, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M17 8l-5-5-5 5M12 3v12"></path>'),
    printer: SVG(16, '<path d="M6 9V3h12v6"></path><rect x="6" y="14" width="12" height="7"></rect><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>'),
    download: SVG(16, '<path d="M12 4v12M7 11l5 5 5-5"></path><path d="M4 20h16"></path>'),
    refresh: SVG(16, '<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>'),
    trash: SVG(16, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>'),
    x: SVG(16, '<path d="M6 6l12 12M18 6L6 18"></path>')
  };
  const linkCache = new Map();          // job id -> packet_links rows (newest first); not saved with the job
  const formOpen = {};                  // job id -> is the answers form expanded
  const shortTime = d => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const shortDay = d => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

  // Which saved file is the signed packet; everything else (paper scans, earlier copies) is "extra".
  function packetFileSplit(j, p) {
    const all = j.packetFiles || [];
    let main = -1;
    if (p.status === 'signed') {
      const sf = (p.signed && p.signed.file) || null;
      if (sf) main = all.findIndex(x => (sf.path && x.path === sf.path) || (sf.name && x.name === sf.name));
      if (main < 0 && all.length) main = all.length - 1;
    }
    return { main, extras: all.map((x, i) => ({ x, i })).filter(o => o.i !== main) };
  }

  // What the status card shows: title, line under it, the Sent / Opened / Signed steps, buttons, ••• menu.
  function trackState(j, p) {
    const links = linkCache.get(String(j.id)) || [];
    const f = p.fields || {};
    if (p.status === 'signed') {
      const s = p.signed || {};
      const names = [s.homeowner && s.homeowner.name, s.coowner && s.coowner.name].filter(Boolean).join(' & ') || f.name || '';
      const link = s.method === 'remote' ? (links.find(l => l.id === s.linkId) || links.find(l => l.status === 'signed')) : null;
      const steps = s.method === 'remote'
        ? [['Sent', link && link.created_at], ['Opened', link && (link.viewed_at || link.signed_at)], ['Signed', s.at]]
        : s.method === 'paper' ? [['Signed on paper', null], ['Uploaded', s.at]]
        : [['Filled out', null], ['Signed in person', s.at]];
      return { kind: 'done', color: '#34D399', bg: 'rgba(52,211,153,.14)', icon: ICON.check, title: 'Packet signed',
        sub: [names, s.at ? shortDay(s.at) : ''].filter(Boolean).join(' · '), steps: steps.map(x => [x[0], x[1], true]) };
    }
    const after = p.restartedAt ? new Date(p.restartedAt) : null;
    const open = links.find(l => (l.status === 'sent' || l.status === 'viewed') && !(after && new Date(l.created_at) <= after));
    if (open && new Date(open.expires_at) >= new Date()) {
      const to = String(open.sent_to || '').split(' / ').filter(Boolean).join(' and ');
      return { kind: 'wait', link: open, color: '#F2C46B', bg: 'rgba(242,196,107,.14)', icon: ICON.clock, title: 'Waiting for homeowner',
        sub: [to ? 'Sent to ' + to : 'Link sent', 'link expires ' + shortDay(open.expires_at)].join(' · '),
        steps: [['Sent', open.created_at, true], ['Opened', open.viewed_at, !!open.viewed_at], ['Signed', null, false]] };
    }
    return { kind: 'ready', color: '#7FA6F5', bg: 'rgba(47,111,235,.14)', icon: ICON.pen, title: 'Not signed yet',
      sub: open ? 'The last link expired ' + shortDay(open.expires_at) + ' — send a new one' : 'Sign in person, or text/email a link',
      steps: [['Sent', null, false], ['Opened', null, false], ['Signed', null, false]] };
  }

  const menuHtml = (id, items) => `<div class="pk-more" role="menu" data-pkmorem="${id}" hidden>${items.join('')}</div>`;
  const mItem = (act, icon, label, extra) => `<button type="button" role="menuitem" data-pkact="${act}"${extra || ''}>${icon}<span>${label}</span></button>`;
  const uploadItem = jobId => `<label role="menuitem">${ICON.upload}<span>Upload signed paper copy</span><input type="file" accept=".pdf,image/*" style="display:none" onchange="crmPacket.uploadPaper('${jobId}', this.files)"></label>`;

  function trackerHtml(j, p) {
    const t = trackState(j, p);
    const done = t.steps.filter(x => x[2]).length;
    const fill = t.steps.length < 2 || done < 2 ? 0 : (done - 1) / (t.steps.length - 1);
    const steps = `<div class="pk-sa" style="--n:${t.steps.length}"><div class="pk-sa-f" style="background:${t.color};width:calc((100% - 76px) * ${fill})"></div>${t.steps.map(x => `
      <div class="pk-st${x[2] ? ' d' : ''}"><i style="${x[2] ? 'background:' + t.color : ''}">${x[2] ? ICON.tick : ''}</i><span>${esc(x[0])}</span><small>${x[1] ? esc(shortTime(x[1])) : x[2] ? '&nbsp;' : '—'}</small></div>`).join('')}</div>`;
    const more = `<button type="button" class="pk-b pk-mb" data-pkmore="trk" aria-haspopup="menu" aria-expanded="false" aria-label="More actions">${ICON.dots}</button>`;
    const fs = packetFileSplit(j, p);
    let btns, menu;
    if (t.kind === 'done') {
      const has = fs.main >= 0;
      btns = `<button type="button" class="pk-b primary" data-pkact="view" ${has ? '' : 'disabled'}>${ICON.eye} View PDF</button>
        <button type="button" class="pk-b" data-pkact="sendcopy" ${has ? '' : 'disabled'}>${ICON.send} Send copy</button>`;
      menu = [has ? mItem('download', ICON.download, 'Download PDF') : '', uploadItem(j.id), mItem('new', ICON.refresh, 'Start a new packet'),
        has ? mItem('delete', ICON.trash, 'Delete signed PDF…', ' class="danger"') : ''];
    } else if (t.kind === 'wait') {
      btns = `<button type="button" class="pk-b" data-pkact="sign">${ICON.sign} Sign in person</button>
        <button type="button" class="pk-b" data-pkact="resend" data-link="${esc(t.link.id)}">${ICON.send} Resend</button>`;
      menu = [mItem('preview', ICON.printer, 'Preview / print'), uploadItem(j.id), mItem('cancel', ICON.x, 'Cancel link', ` class="danger" data-link="${esc(t.link.id)}"`)];
    } else {
      btns = `<button type="button" class="pk-b" data-pkact="sign">${ICON.sign} Sign in person</button>
        <button type="button" class="pk-b primary" data-pkact="send">${ICON.send} Send link</button>`;
      menu = [mItem('preview', ICON.printer, 'Preview / print'), uploadItem(j.id)];
    }
    // Extra files (paper scans, copies from an earlier packet) only show when there are some.
    const extras = fs.extras.map(({ x, i }) => {
      const ext = (String(x.name || '').match(/\.([a-z0-9]+)$/i) || [])[1] || (x.isPdf ? 'pdf' : 'file');
      const label = t.kind === 'done' ? 'Paper copy' : 'Earlier signed copy';
      return `<div class="pk-xf"><button type="button" class="pk-xf-main" data-pkact="fview" data-i="${i}"><span class="pk-xf-ico">${esc(ext.toUpperCase().slice(0, 4))}</span>
        <span class="pk-xf-t"><b>${esc(x.name || label)}</b><small>${esc([label, x.date].filter(Boolean).join(' · '))}</small></span></button>
        <button type="button" class="pk-xf-m" data-pkmore="f${i}" aria-haspopup="menu" aria-expanded="false" aria-label="More for ${esc(x.name || 'file')}">${ICON.dots}</button>
        ${menuHtml('f' + i, [mItem('fview', ICON.eye, 'View', ` data-i="${i}"`), mItem('fdownload', ICON.download, 'Download', ` data-i="${i}"`), mItem('fdelete', ICON.trash, 'Delete…', ` class="danger" data-i="${i}"`)])}</div>`;
    }).join('');
    return `<div class="pk-hd"><div class="pk-hd-ico" style="background:${t.bg};color:${t.color}">${t.icon}</div><div><h3>${esc(t.title)}</h3><p>${esc(t.sub)}</p></div></div>
      ${steps}
      <div class="pk-acts">${btns}${more}${menuHtml('trk', menu.filter(Boolean))}</div>
      ${extras}`;
  }

  function renderTracker(j) {
    const host = document.getElementById('pk-trk');
    if (!host || String(host.dataset.job) !== String(j.id)) return;
    host.innerHTML = trackerHtml(j, ensurePacket(j));
  }

  async function fileBytes(rec) {
    const fetchOk = async u => { try { const r = await fetch(u); return r.ok ? r : null; } catch (e) { return null; } };
    let r = rec && rec.url && /^(https?:|blob:|data:)/.test(rec.url) ? await fetchOk(rec.url) : null;
    if (!r && rec && rec.path && db()) {
      const { data } = await db().storage.from('job-files').createSignedUrl(rec.path, 600);
      if (data && data.signedUrl) r = await fetchOk(data.signedUrl);
    }
    if (!r) throw new Error('Could not load the file');
    return new Uint8Array(await r.arrayBuffer());
  }

  // One click handler for the whole tab (buttons and ••• menus are redrawn, the panel isn't).
  function wirePanel(panel) {
    if (panel.__pkWired) return;
    panel.__pkWired = true;
    const closeMenus = keep => panel.querySelectorAll('[data-pkmorem]').forEach(m => {
      if (m === keep) return;
      m.hidden = true;
      const b = panel.querySelector(`[data-pkmore="${m.dataset.pkmorem}"]`); if (b) b.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', e => { if (!panel.contains(e.target) || !e.target.closest('[data-pkmorem],[data-pkmore]')) closeMenus(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
    panel.addEventListener('click', async e => {
      const mb = e.target.closest('[data-pkmore]');
      if (mb) {
        const m = panel.querySelector(`[data-pkmorem="${mb.dataset.pkmore}"]`); if (!m) return;
        const open = m.hidden; closeMenus(m); m.hidden = !open; mb.setAttribute('aria-expanded', String(open));
        return;
      }
      const fb = e.target.closest('[data-pkform]');
      if (fb) {
        const id = panel.__pkJob, body = panel.querySelector('[data-pkformbody]');
        formOpen[id] = !(body && !body.hidden);
        if (body) body.hidden = !formOpen[id];
        fb.setAttribute('aria-expanded', String(formOpen[id]));
        return;
      }
      const b = e.target.closest('[data-pkact]'); if (!b || b.disabled) return;
      closeMenus();
      const j = jobById(panel.__pkJob); if (!j) return;
      const p = ensurePacket(j), a = b.dataset.pkact, fs = packetFileSplit(j, p);
      const idx = b.dataset.i != null ? +b.dataset.i : fs.main;
      const rec = (j.packetFiles || [])[idx];
      if (a === 'sign') return startSigning(j.id);
      if (a === 'send') return sendForSignature(j.id);
      if (a === 'resend') return resendLink(j.id, b.dataset.link);
      if (a === 'cancel') return voidLink(j.id, b.dataset.link);
      if (a === 'preview') return preview(j.id);
      if (a === 'new') return startOver(j.id);
      if (!rec) return;
      if (a === 'view' || a === 'fview') { if (typeof root.previewJobFile === 'function') root.previewJobFile('packetFiles', idx); return; }
      if (a === 'delete' || a === 'fdelete') return deleteFile(j.id, idx);
      if (a === 'download' || a === 'fdownload') {
        try { say('Preparing…'); downloadBytes(await fileBytes(rec), rec.name || 'Claim Packet (signed).pdf'); }
        catch (er) { say(er.message || 'Could not download'); }
        return;
      }
      if (a === 'sendcopy') {
        if (!rec.path) { say('This file isn’t synced yet'); return; }
        const s = p.signed || {};
        const to = (root.prompt('Email the signed packet to:', (p.fields && p.fields.email) || s.emailedTo || '') || '').trim();
        if (!to) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { say('That email address doesn’t look right'); return; }
        b.disabled = true; say('Sending…');
        const r = await emailPacket(j, rec.path, to, s.cancelBy);
        b.disabled = false;
        say(r.ok ? 'Sent to ' + to : r.notConfigured ? 'Office email isn’t set up yet' : 'Couldn’t send: ' + (r.error || 'try again'));
      }
    });
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
    const miss = sectionMissing(f);
    const badge = sec => signed ? '' : `<span class="pk-badge ${miss[sec].length ? 'need' : 'ok'}" data-pkbadge="${sec}">${miss[sec].length ? miss[sec].length + ' missing' : 'Done'}</span>`;
    const txt = (k, label, extra) => `<div class="pk-fld${extra && extra.full ? ' full' : ''}"><label for="pk-${k}">${label}</label><input id="pk-${k}" data-pk="${k}" value="${v(k)}" ${extra && extra.type ? 'inputmode="' + extra.type + '"' : ''} ${extra && extra.ph && !signed ? 'placeholder="' + extra.ph + '"' : ''} ${dis}></div>`;
    const chip = (k, label) => `<button type="button" class="pk-chip${f[k] === true ? ' on' : ''}" data-pkc="${k}" aria-pressed="${f[k] === true}" ${dis}>${label}</button>`;
    const yn = (q, label) => `<div class="pk-q"><span>${label}</span><span class="pk-seg" data-pkseg="${q}" role="group" aria-label="${esc(label)}">
      <button type="button" class="${f[q] === 'yes' ? 'on' : ''}" data-pkyn="${q}" data-val="yes" aria-pressed="${f[q] === 'yes'}" ${dis}>Yes</button>
      <button type="button" class="${f[q] === 'no' ? 'on' : ''}" data-pkyn="${q}" data-val="no" aria-pressed="${f[q] === 'no'}" ${dis}>No</button></span></div>`;
    // Date fields: type mm/dd/yyyy, or tap the calendar button for a short menu of likely dates
    // (recent storms, Today/Yesterday…) ending in "Pick from calendar…" (the phone's own picker).
    const CAL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>';
    const STORM = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.6 4.4 0 0 1 0-9h.5A5.5 5.5 0 0 1 18 9a4 4 0 0 1 .5 8"></path><path d="M13 14l-2 4h3l-2 4"></path></svg>';
    const dateFld = (k, label, o) => {
      o = o || {};
      const opts = (o.chips || []).map(c => {
        const val = chipValue(c[0]);
        const sub = /^\d{2}\/\d{2}\/\d{4}/.test(val) ? val.slice(0, 10) : '';
        return `<button type="button" class="pk-ddi${c[2] ? ' storm' : ''}" role="menuitem" data-pkd="${k}" data-v="${esc(c[0])}"><span>${c[2] ? STORM : ''}${esc(c[1])}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
      }).join('');
      return `<div class="pk-fld"><label for="pk-${k}">${label}</label>
        <div class="pk-dt"><input id="pk-${k}" data-pk="${k}" value="${v(k)}" placeholder="${o.time ? 'mm/dd/yyyy h:mm PM' : 'mm/dd/yyyy'}" autocomplete="off" ${dis}>
          <button type="button" class="pk-calbtn" data-pkmenu="${k}" aria-haspopup="menu" aria-expanded="false" aria-label="Choose ${label.toLowerCase()}" ${dis}>${CAL}</button>
          <div class="pk-dd" role="menu" data-pkdd="${k}" hidden>
            ${o.head ? `<div class="pk-ddh">${esc(o.head)}</div>` : ''}${opts}
            <label class="pk-ddi pick">${CAL.replace('width="20" height="20"', 'width="16" height="16"')}<span>${o.time ? 'Pick date &amp; time\u2026' : 'Pick from calendar\u2026'}</span>
              <input type="${o.time ? 'datetime-local' : 'date'}" class="pk-native" data-pkn="${k}" ${dis} aria-label="Pick ${label.toLowerCase()} from a calendar" value="${nativeVal(f[k], o.time)}"></label>
          </div></div></div>`;
    };
    const item = (k, label, unit) => `<div class="pk-item"><label><input type="checkbox" data-pkcb="${k}" ${f[k] === true ? 'checked' : ''} ${dis}>${label}</label>${unit !== null ? `<input type="text" aria-label="${label} ${unit || 'details'}" placeholder="${unit || ''}" data-pk="${k}_detail" value="${v(k + '_detail')}" ${dis}>` : ''}</div>`;

    const formHtml = `
      <div class="pk-sec"><h4>Client${badge('client')}</h4><div class="pk-grid pk-keep2">
        ${txt('name', 'Owner name(s)', { full: true })}
        ${txt('street', 'Street', { full: true })}
        ${txt('city_state', 'City, State')}${txt('zip', 'Zip', { type: 'numeric' })}
        ${txt('cell_phone', 'Cell', { type: 'tel' })}${txt('home_phone', 'Home phone', { type: 'tel', ph: 'Optional' })}
        ${txt('email', 'E-mail', { full: true, type: 'email' })}
      </div></div>

      <div class="pk-sec"><h4>Project information${badge('project')}</h4>
        ${yn('changed_insurance', 'Changed insurance companies in the last 12 months?')}
        <div class="pk-grid pk-follow" data-pkfollow="changed_insurance" ${f.changed_insurance === 'yes' ? '' : 'hidden'}>${txt('prior_insurance', 'Prior insurance co.', { full: true })}</div>
        ${yn('prior_claim', 'Ever paid by homeowner’s insurance, or a claim under the deductible?')}
        <div class="pk-grid pk-follow" data-pkfollow="prior_claim" ${f.prior_claim === 'yes' ? '' : 'hidden'}>${txt('prior_claim_allocated', 'List what was allocated', { full: true })}</div>
        ${yn('other_properties', 'Own any other residential properties?')}
        <div class="pk-grid" style="margin-top:10px">${txt('hoa_company', 'HOA management company', { full: true, ph: 'Optional' })}${txt('pa_name', 'Public adjuster', { full: true, ph: 'Optional' })}</div>
      </div>

      <div class="pk-sec"><h4>Type of loss — roof${badge('loss')}</h4><div data-pkloss>
        <div class="pk-row"><span class="pk-lbl">Wind</span>${chip('roof_wind', 'Wind damage')}${chip('wind_slope_north', 'N')}${chip('wind_slope_south', 'S')}${chip('wind_slope_east', 'E')}${chip('wind_slope_west', 'W')}</div>
        <div class="pk-row"><span class="pk-lbl">Hail</span>${chip('roof_hail', 'Hail damage')}${chip('hail_slope_north', 'N')}${chip('hail_slope_south', 'S')}${chip('hail_slope_east', 'E')}${chip('hail_slope_west', 'W')}</div>
      </div></div>

      <div class="pk-sec"><h4>Exterior<span class="pk-badge opt">Optional</span></h4>
        ${item('ext_ac_units', 'Comb. AC units', 'Qty.')}${item('ext_window_beads', 'Window beads', 'Qty.')}
        ${item('ext_window_screens', 'Window screens', 'Qty.')}${item('ext_gutters', 'Gutters', 'Type')}
        ${item('ext_fence', 'Fence', 'LF')}${item('ext_other', 'Other', 'Describe')}
      </div>
      <div class="pk-sec"><h4>Interior<span class="pk-badge opt">Optional</span></h4>
        ${item('int_ceiling_stains', 'Ceiling stains', '# rooms')}${item('int_sheetrock', 'Sheetrock damage', '# rooms')}${item('int_other', 'Other', 'Describe')}
      </div>

      <div class="pk-sec"><h4>Insurance &amp; claim${badge('insurance')}</h4><div class="pk-grid">
        ${txt('insurance_company', 'Insurance company')}${txt('policy_number', 'Policy #')}
        ${txt('claim_number', 'Claim #', { ph: 'Can be left blank' })}${dateFld('date_of_loss', 'Date of loss', { chips: stormChips(), head: stormChips().length ? 'Recent storms' : '' })}
        ${dateFld('date_claim_filed', 'Date claim filed', { chips: [['today', 'Today'], ['yesterday', 'Yesterday'], ['text:Not filed yet', 'Not filed yet']] })}
        ${dateFld('appointment', 'Adjuster appointment', { time: true, chips: [['tmr:9:00 AM', 'Tomorrow · 9:00 AM'], ['tmr:1:00 PM', 'Tomorrow · 1:00 PM'], ['text:TBD', 'TBD']] })}
        ${txt('adjuster', 'Adjuster')}${txt('adjuster_phone', 'Adjuster phone', { type: 'tel' })}
        ${txt('deductible', 'Deductible ($)', { type: 'decimal' })}
        <div class="pk-fld"><label>Policy type</label><div class="pk-yn">${chip('policy_acv', 'ACV')}${chip('policy_rcv', 'RCV')}</div></div>
        <div class="pk-fld"><label>Mortgage</label><div class="pk-yn">${chip('existing_mortgage', 'Existing mortgage')}${chip('own_outright', 'Own')}</div></div>
        ${txt('mortgage_company', 'Mortgage company')}
      </div></div>
      ${signed ? '' : '<p class="pk-note">Answers save automatically.</p>'}`;

    const total = Object.values(miss).reduce((n, a) => n + a.length, 0);
    const isOpen = formOpen[j.id] !== undefined ? formOpen[j.id] : !signed;
    panel.__pkJob = j.id;
    panel.innerHTML = `<div class="pk-wrap${signed ? ' pk-locked' : ''}">
      <div class="pk-trk" id="pk-trk" data-job="${esc(j.id)}">${trackerHtml(j, p)}</div>
      <button type="button" class="pk-formbar" data-pkform aria-expanded="${isOpen}">${ICON.doc}<span class="pk-fb-t">${signed ? 'Authorization answers' : 'Fill out authorization'}</span>
        ${signed ? '<span class="pk-badge lock">Locked</span>' : `<span class="pk-badge ${total ? 'need' : 'ok'}" data-pktotal>${total ? total + ' missing' : 'All filled'}</span>`}
        <span class="pk-fb-c">${ICON.caret}</span></button>
      <div data-pkformbody ${isOpen ? '' : 'hidden'}>${formHtml}</div>
    </div>`;

    wirePanel(panel);
    renderLinks(j).catch(e => console.warn('[packet] links', e));
    if (signed) return;
    const persist = () => { p.updatedAt = new Date().toISOString(); save(); refreshMissing(); };
    // Badges + amber outlines follow the answers as they're typed.
    const refreshMissing = () => {
      const m = sectionMissing(f), all = [].concat(...Object.values(m));
      Object.keys(m).forEach(sec => { const b = panel.querySelector(`[data-pkbadge="${sec}"]`); if (b) { b.className = 'pk-badge ' + (m[sec].length ? 'need' : 'ok'); b.textContent = m[sec].length ? m[sec].length + ' missing' : 'Done'; } });
      const t = panel.querySelector('[data-pktotal]'); if (t) { t.className = 'pk-badge ' + (all.length ? 'need' : 'ok'); t.textContent = all.length ? all.length + ' missing' : 'All filled'; }
      panel.querySelectorAll('[data-pk]').forEach(el => el.classList.toggle('miss', all.indexOf(el.dataset.pk) >= 0));
      panel.querySelectorAll('[data-pkseg]').forEach(el => el.classList.toggle('miss', all.indexOf(el.dataset.pkseg) >= 0));
      const loss = panel.querySelector('[data-pkloss]'); if (loss) loss.classList.toggle('miss', m.loss.length > 0);
      panel.querySelectorAll('[data-pkfollow]').forEach(el => { el.hidden = f[el.dataset.pkfollow] !== 'yes'; });
    };
    refreshMissing();
    panel.querySelectorAll('[data-pk]').forEach(el => el.addEventListener('input', () => { f[el.dataset.pk] = el.value; persist(); }));
    // Date menus: calendar button opens a short list; picking anything fills mm/dd/yyyy text.
    const closeMenus = except => panel.querySelectorAll('[data-pkdd]').forEach(dd => {
      if (dd.dataset.pkdd === except) return;
      dd.hidden = true;
      const b = panel.querySelector(`[data-pkmenu="${dd.dataset.pkdd}"]`); if (b) b.setAttribute('aria-expanded', 'false');
    });
    const setDate = (k, val) => {
      const txtIn = panel.querySelector(`[data-pk="${k}"]`); if (!txtIn) return;
      txtIn.value = val; f[k] = val; persist(); markChips(k);
      const nv = panel.querySelector(`[data-pkn="${k}"]`); if (nv) nv.value = nativeVal(val, nv.type === 'datetime-local');
    };
    panel.querySelectorAll('[data-pkmenu]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const k = b.dataset.pkmenu, dd = panel.querySelector(`[data-pkdd="${k}"]`); if (!dd) return;
      const open = dd.hidden;
      closeMenus(k);
      dd.hidden = !open; b.setAttribute('aria-expanded', String(open));
      if (open) { const first = dd.querySelector('[data-pkd], .pk-native'); if (first && first.focus) first.focus({ preventScroll: true }); }
    }));
    panel.querySelectorAll('[data-pkn]').forEach(nv => {
      nv.addEventListener('click', e => { e.stopPropagation(); try { if (nv.showPicker) nv.showPicker(); } catch (er) { /* phones open it natively */ } });
      // Date + time: phones fill in a value as soon as the picker opens and update it as the
      // wheels move, so keep the menu (and the picker) open until the picker is dismissed.
      const withTime = nv.type === 'datetime-local';
      nv.addEventListener('change', () => {
        const out = fromNative(nv.value);
        if (out) setDate(nv.dataset.pkn, out);
        if (!withTime) closeMenus();
      });
      if (withTime) nv.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== nv) closeMenus(); }, 150));
    });
    panel.querySelectorAll('[data-pkd]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      setDate(b.dataset.pkd, chipValue(b.dataset.v));
      closeMenus();
      const t = panel.querySelector(`[data-pkmenu="${b.dataset.pkd}"]`); if (t) t.focus({ preventScroll: true });
    }));
    // tap anywhere else (or Escape) closes an open menu
    if (!panel.__pkDdWired) {
      panel.__pkDdWired = true;
      document.addEventListener('click', e => { if (!e.target.closest('.pk-dd') && !e.target.closest('[data-pkmenu]')) panel.querySelectorAll('[data-pkdd]:not([hidden])').forEach(dd => { dd.hidden = true; const b = panel.querySelector(`[data-pkmenu="${dd.dataset.pkdd}"]`); if (b) b.setAttribute('aria-expanded', 'false'); }); });
      panel.addEventListener('keydown', e => { if (e.key === 'Escape') panel.querySelectorAll('[data-pkdd]:not([hidden])').forEach(dd => { dd.hidden = true; const b = panel.querySelector(`[data-pkmenu="${dd.dataset.pkdd}"]`); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); } }); });
    }
    const markChips = k => panel.querySelectorAll(`[data-pkd="${k}"]`).forEach(b => b.classList.toggle('on', chipValue(b.dataset.v) === f[k]));
    ['date_of_loss', 'date_claim_filed', 'appointment'].forEach(markChips);
    panel.querySelectorAll('[data-pk="date_of_loss"],[data-pk="date_claim_filed"],[data-pk="appointment"]').forEach(el => el.addEventListener('input', () => {
      markChips(el.dataset.pk);
      const nv = panel.querySelector(`[data-pkn="${el.dataset.pk}"]`); if (nv) nv.value = nativeVal(el.value, nv.type === 'datetime-local');
    }));
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
      panel.querySelectorAll(`[data-pkyn="${q}"]`).forEach(b => { b.classList.toggle('on', f[q] === b.dataset.val); b.setAttribute('aria-pressed', String(f[q] === b.dataset.val)); });
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

  /* Full-screen panels sit on top of the CRM. The phone's Back button / swipe should close
     the panel, not leave the app (installed web apps have no browser Back button). */
  function trapBack(onBack) {
    let active = true;
    try { history.pushState({ pkPanel: Date.now() }, ''); } catch (e) { /* ignore */ }
    const h = () => { if (!active) return; active = false; root.removeEventListener('popstate', h); onBack(); };
    root.addEventListener('popstate', h);
    return () => {                                    // closed from a button: drop our history entry
      if (!active) return;
      active = false; root.removeEventListener('popstate', h);
      try { history.back(); } catch (e) { /* ignore */ }
    };
  }

  // PDFs open inside the app (a new tab in an installed web app can't be closed).
  function openBlob(bytes, name) {
    viewPdf(bytes, name || 'StormShield Claim Packet.pdf');
  }
  function viewPdf(bytes, name) {
    injectStyles();
    const ov = document.createElement('div');
    ov.id = 'pkView';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'PDF viewer');
    ov.innerHTML = `<div class="pkv-top"><b>${esc(name.replace(/\.pdf$/i, ''))}</b><span>
        <button type="button" class="pkv-b" data-save>Save / share</button>
        <button type="button" class="pkv-b x" data-close aria-label="Close">\u2715 Close</button></span></div>
      <div class="pkv-pages"><div class="pkv-msg">Loading\u2026</div></div>`;
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const shut = () => { ov.remove(); document.body.style.overflow = prevOverflow; };
    const release = trapBack(shut);
    ov.querySelector('[data-close]').onclick = () => { release(); shut(); };
    ov.querySelector('[data-save]').onclick = async () => {
      const file = new File([bytes], name, { type: 'application/pdf' });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      downloadBytes(bytes, name);
    };
    (async () => {
      const host = ov.querySelector('.pkv-pages');
      try {
        const doc = await openPdfDoc(bytes);
        host.innerHTML = '';
        const w = Math.min(host.clientWidth - 24, 900);
        for (let n = 1; n <= doc.numPages; n++) {
          if (!ov.isConnected) return;
          const cv = document.createElement('canvas'); cv.className = 'pkv-page';
          cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Page ' + n);
          host.appendChild(cv);
          await drawPdfPage(doc, n, cv, w);
        }
      } catch (e) {
        console.warn('[packet] viewer', e);
        host.innerHTML = '<div class="pkv-msg">This PDF can\u2019t be shown here. Use Save / share to open it.</div>';
      }
    })();
  }

  async function preview(jobId) {
    const j = jobById(jobId); if (!j) return;
    ensurePacket(j);
    say('Preparing packet…');
    try { openBlob(await buildPdf(j.packet.fields, {}, {})); }
    catch (e) { console.error('[packet] preview failed', e); say('Could not build the packet PDF'); }
  }

  /* ---------------------------------------------------------------- signature pads */
  // Signature / initials pad. Ink is kept as strokes (fractions of the pad's size), so
  // turning the phone sideways or resizing the window redraws it in the right place.
  function makePad(host) {
    host.innerHTML = '<canvas></canvas><div class="pks-line"></div><div class="pks-x">×</div>';
    const canvas = host.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const small = host.classList.contains('small');
    let ratio = 1, W = 1, H = 1;
    const strokes = [];                       // [[{x,y}…]…] in px of the pad size when ink started (refW×refH)
    let refW = 0, refH = 0;
    const k = () => (refW ? Math.min(W / refW, H / refH) : 1);   // keep the ink's shape, never stretch it
    const style = () => { ctx.lineWidth = small ? 4.5 : 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1530'; };
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); style();
      const f = k();
      strokes.forEach(st => {
        if (!st.length) return;
        ctx.beginPath(); ctx.moveTo(st[0].x * f, st[0].y * f);
        if (st.length === 1) ctx.lineTo(st[0].x * f + 0.1, st[0].y * f);
        for (let i = 1; i < st.length; i++) ctx.lineTo(st[i].x * f, st[i].y * f);
        ctx.stroke();
      });
    };
    const size = () => {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ratio = Math.max(1, root.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
      redraw();
    };
    size();
    let lastOrient = root.innerWidth > root.innerHeight;
    const onSize = () => {
      size();
      const o = root.innerWidth > root.innerHeight;
      if (o !== lastOrient) { lastOrient = o; try { host.scrollIntoView({ block: 'center' }); } catch (e) {} }
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(onSize).observe(host);
    else root.addEventListener('resize', onSize);
    let drawing = false, cur = null;
    // Measure the canvas at every touch, so a rotation mid-session can't skew the ink.
    const pos = e => { const r = canvas.getBoundingClientRect(), f = k(); return { x: (e.clientX - r.left) / f, y: (e.clientY - r.top) / f }; };
    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect();
      if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) size();
      if (!strokes.length) { refW = W; refH = H; }
      drawing = true; cur = [pos(e)]; strokes.push(cur);
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p2 = pos(e), last = cur[cur.length - 1], f = k();
      cur.push(p2);
      ctx.beginPath(); ctx.moveTo(last.x * f, last.y * f); ctx.lineTo(p2.x * f, p2.y * f); ctx.stroke();
      e.preventDefault();
    });
    const stop = () => { drawing = false; cur = null; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    const hasInk = () => strokes.some(st => st.length > 1);
    return {
      hasInk,
      clear: () => { strokes.length = 0; refW = refH = 0; redraw(); },
      // Trimmed PNG of the ink only (transparent background)
      toPng: () => {
        if (!hasInk()) return null;
        redraw();
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
  const CONSENT = 'I agree to use electronic records and signatures for this Claim Packet. My electronic initials and signatures have the same effect as signing on paper. I can get a paper copy free, and withdraw this consent, by calling 832-910-7735.';

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
      signers, how: ctx.how, device: ctx.device || '', rep: repName,
      details: (r.reviewedAt ? ['Signed on the filled-in pages shown on screen; reviewed the completed, signed pages ' + fmtDateTime(r.reviewedAt) + ' before submitting'] : []).concat(ctx.details || []),
      consent: CONSENT, consentAt: fmtDateTime(r.consentAt), hash, cancelBy: fmtDate(cancelBy)
    });
    return { finalBytes, hash, cancelBy, sigs };
  }

  /* Full-screen signing, shared by in-person signing (CRM) and the homeowner's
     remote link (sign.html). The signer sees the real, filled-in packet and
     initials / signs on the spots where the ink will land.
     opts: { fields, mode:'in_person'|'remote', repName, onFinish:async(r)=>({finalBytes,cancelBy,fileName}),
             onDone:fn (in-person "Done" button), mount: element (default body) } */
  const PDFJS_VER = '3.11.174';
  let _pdfjs = null;
  function loadPdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (_pdfjs) return _pdfjs;
    const base = root.PDFJS_BASE || ('https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/');
    _pdfjs = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = base + 'pdf.min.js';
      s.onload = () => { root.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; res(root.pdfjsLib); };
      s.onerror = () => { _pdfjs = null; rej(new Error('PDF viewer did not load')); };
      document.head.appendChild(s);
    });
    return _pdfjs;
  }
  async function openPdfDoc(bytes) {
    const lib = await loadPdfJs();
    return lib.getDocument({ data: new Uint8Array(bytes).slice(0) }).promise;
  }
  async function drawPdfPage(doc, n, canvas, cssW) {
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(2.5, root.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: (cssW * dpr) / vp1.width });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }

  // Where each initial / signature / auto-filled value sits on the template (PDF points).
  const SPOT_FIELDS = ['key_initial_1', 'key_initial_2', 'key_initial_3', 'key_initial_4', 'key_initial_5', 'deductible_initials',
    'sig_homeowner', 'homeowner_date', 'sig_coowner', 'coowner_date', 'sig_sspr', 'sspr_date',
    'tpa_sig_insured1', 'tpa_insured1_printed_name', 'tpa_insured1_date', 'tpa_sig_insured2', 'tpa_insured2_printed_name', 'tpa_insured2_date'];
  let _spots = null;
  async function templateSpots() {
    if (_spots) return _spots;
    const pdf = await root.PDFLib.PDFDocument.load(await loadTemplate());
    const pages = pdf.getPages(), form = pdf.getForm(), out = {};
    SPOT_FIELDS.forEach(n => {
      try {
        const r = form.getTextField(n).acroField.getWidgets()[0].getRectangle();
        const pi = n.indexOf('tpa_') === 0 ? 1 : 0, pg = pages[pi];
        out[n] = { page: pi, x: r.x, y: r.y, w: r.width, h: r.height, pw: pg.getWidth(), ph: pg.getHeight() };
      } catch (e) { /* missing field */ }
    });
    _spots = out;
    return out;
  }

  const DISCLOSURE = [
    'You can get this agreement on paper instead, at no charge. Ask your StormShield representative or call 832-910-7735.',
    'You can withdraw this consent any time before you finish signing. After that, ask us and we will give you paper copies.',
    'This consent covers only this Claim Packet.',
    'To read and keep your copy you need a phone or computer with an up-to-date web browser that can open PDF files. You can download your signed copy at the end, and ask us to email or mail one.',
    'Let us know at 832-910-7735 if your phone number or email changes.'
  ];

  function openSigningFlow(opts) {
    injectStyles();
    const fields = opts.fields || {};
    const remote = opts.mode === 'remote';
    const st = {
      phase: 'welcome', consentAt: null, showDisclosure: false,
      homeownerName: (fields.name || '').split(/\s*(?:&|\band\b|,)\s*/)[0] || fields.name || '',
      coowner: false, coownerName: '',
      initials: null, initialed: {},
      sig: {}, tpaApplied: { homeowner: false, coowner: false },
      repName: opts.repName || '', at: {}, copyEmail: fields.email || '',
      active: null, sheetMin: false, redraw: {}, zoom: 1, reviewedAt: null
    };

    const ov = document.createElement('div');
    ov.id = 'pkSign';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Sign claim packet');
    (opts.mount || document.body).appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let release = () => {};
    // Turning the phone re-fits the pages to the new width.
    let lastW = 0, rT = 0;
    const onResize = () => {
      clearTimeout(rT);
      rT = setTimeout(async () => {
        const sc = ov.querySelector('[data-scroll]');
        if (st.phase !== 'doc' || !sc || !pageEls.length || Math.abs(sc.clientWidth - lastW) < 2) return;
        lastW = sc.clientWidth;
        await layoutPages();
        if (st.active) scrollToSpot(st.active);
      }, 200);
    };
    root.addEventListener('resize', onResize);
    const shut = () => { root.removeEventListener('resize', onResize); ov.remove(); document.body.style.overflow = prevOverflow; };
    const close = () => { release(); shut(); };
    // Phone Back while signing: ask first (in person), never silently lose the signatures.
    const arm = () => {
      release = trapBack(() => {
        release = () => {};
        if (st.phase === 'finish' || root.confirm('Stop signing? Nothing will be saved.')) shut(); else arm();
      });
    };
    arm();

    // ---- the to-do list, in the order the signer works through the packet
    const tasks = () => {
      // page order: the deductible "HO initials" box sits above the key terms
      const t = [{ id: 'ded', kind: 'initial', idx: 'ded', field: 'deductible_initials' }]
        .concat(KEY_TERMS.map((k, i) => ({ id: 'ini' + i, kind: 'initial', idx: i, field: 'key_initial_' + (i + 1) })));
      t.push({ id: 'sign', kind: 'sign', field: 'sig_homeowner' });
      t.push({ id: 'tpa', kind: 'tpa', who: 'homeowner', field: 'tpa_sig_insured1' });
      if (st.coowner) t.push({ id: 'tpa2', kind: 'tpa', who: 'coowner', field: 'tpa_sig_insured2' });
      if (!remote) t.push({ id: 'rep', kind: 'rep', field: 'sig_sspr' });
      return t;
    };
    const isDone = t => {
      if (t.kind === 'initial') return !!st.initialed[t.idx] && !!st.initials;
      if (t.kind === 'sign') return !!st.sig.homeowner && (!st.coowner || !!st.sig.coowner);
      if (t.kind === 'tpa') return !!st.tpaApplied[t.who];
      if (t.kind === 'rep') return !!st.sig.sspr;
      return false;
    };
    const nextTask = () => tasks().find(t => !isDone(t)) || null;
    const counts = () => { const all = tasks(); return { done: all.filter(isDone).length, total: all.length }; };
    const undo = t => {
      if (t.kind === 'initial') delete st.initialed[t.idx];
      if (t.kind === 'sign') { delete st.sig.homeowner; delete st.sig.coowner; st.tpaApplied = { homeowner: false, coowner: false }; }
      if (t.kind === 'tpa') st.tpaApplied[t.who] = false;
      if (t.kind === 'rep') delete st.sig.sspr;
    };

    let docBytes = null, pdfDoc = null, spots = null, pageEls = [], pads = {};
    const docReady = (async () => {
      docBytes = await buildPdf(fields, {}, {});
      spots = await templateSpots();
      try { pdfDoc = await openPdfDoc(docBytes); } catch (e) { console.warn('[packet] viewer', e); pdfDoc = null; }
    })();

    /* ---------------- welcome: what this is + e-sign consent */
    async function renderWelcome() {
      const c = counts();
      ov.innerHTML = `<div class="pks-top"><b>StormShield Pro Roofing</b><span style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>Secure signing</span></div>
        <div class="pks-body">
          <p class="pks-sub" style="margin:0 0 2px">Hi ${esc((st.homeownerName || '').trim().split(/\s+/)[0] || 'there')},</p>
          <h2>Your claim paperwork is ready to sign</h2>
          <p class="pks-sub">${st.repName ? 'Sent by ' + esc(st.repName) + ', StormShield Pro Roofing' : 'From StormShield Pro Roofing'}${fields.street ? ', for ' + esc(fields.street) : ''}.</p>
          <div class="pkd-thumbs">
            <figure><div class="pkd-thumb" data-thumb="1"></div><figcaption><b>Contingency Agreement</b><span>Page 1</span></figcaption></figure>
            <figure><div class="pkd-thumb" data-thumb="2"></div><figcaption><b>Third-Party Authorization</b><span>Page 2</span></figcaption></figure>
          </div>
          <div class="pkd-counts"><div><b>2</b>pages to read</div><div><b>${KEY_TERMS.length + 1}</b>initials</div><div><b>${c.total - KEY_TERMS.length - 1}</b>signatures</div></div>
          <div class="pks-card">
            <div style="font-weight:600;font-size:14px;margin-bottom:8px">Signing electronically</div>
            <label class="pks-check" style="border:0;padding:0;margin:0"><input type="checkbox" data-consent ${st.consentAt ? 'checked' : ''}><span>${esc(CONSENT)}</span></label>
            <button type="button" class="pks-link" data-act="disclosure" style="padding:8px 0 0">${st.showDisclosure ? 'Hide' : 'Read'} the full disclosure</button>
            ${st.showDisclosure ? `<ul class="pkd-disc">${DISCLOSURE.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          </div>
        </div>
        <div class="pks-foot"><div>
          ${remote ? '' : '<button type="button" class="pks-b" data-act="cancel">Cancel</button>'}
          <button type="button" class="pks-b go" data-act="start" ${st.consentAt ? '' : 'disabled'}>Review the document</button></div></div>`;
      const cb = ov.querySelector('[data-consent]');
      cb.addEventListener('change', () => { st.consentAt = cb.checked ? new Date().toISOString() : null; ov.querySelector('[data-act="start"]').disabled = !st.consentAt; });
      ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
      try {
        await docReady;
        if (!pdfDoc || st.phase !== 'welcome') return;
        for (const n of [1, 2]) {
          const host = ov.querySelector(`[data-thumb="${n}"]`); if (!host) return;
          const cv = document.createElement('canvas'); host.appendChild(cv);
          await drawPdfPage(pdfDoc, n, cv, host.clientWidth || 160);
        }
      } catch (e) { /* thumbnails are optional */ }
    }

    /* ---------------- document view: the real pages with spots on them */
    function renderDocShell() {
      ov.innerHTML = `<div class="pks-top"><b data-title>Contingency Agreement</b><span style="display:flex;gap:8px;align-items:center">${remote ? '' : '<button type="button" class="pkd-toplink" data-act="cancel" aria-label="Stop signing">\u2715</button>'}<button type="button" class="pkd-toplink" data-act="pdf">Open as PDF</button></span></div>
        <div class="pkd-prog"><div class="t"><i data-bar></i></div><span data-count></span>
          <button type="button" class="pkd-zoom" data-act="zoom" aria-label="Zoom">Zoom ${st.zoom === 1 ? '+' : '−'}</button></div>
        <div class="pkd-scroll" data-scroll><div class="pkd-loading">Loading your agreement…</div></div>
        <div class="pkd-sheet" data-sheet></div>`;
      ov.querySelectorAll('.pks-top [data-act], .pkd-prog [data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
      const sc = ov.querySelector('[data-scroll]');
      sc.addEventListener('scroll', () => {
        const p2 = pageEls[1]; if (!p2) return;
        const onTwo = p2.el.getBoundingClientRect().top < sc.getBoundingClientRect().top + sc.clientHeight / 2;
        const t = ov.querySelector('[data-title]'); if (t) t.textContent = onTwo ? 'Third-Party Authorization' : 'Contingency Agreement';
      }, { passive: true });
      buildPages();
      renderSheet();
    }

    async function buildPages() {
      await docReady;
      const sc = ov.querySelector('[data-scroll]'); if (!sc) return;
      if (!pdfDoc) {
        sc.innerHTML = `<div class="pks-card" style="margin:16px"><b>The page preview didn’t load.</b><p class="pks-legal">You can still read the full agreement as a PDF, then sign below.</p>
          <button type="button" class="pks-b" data-act="pdf" style="width:100%">Open the agreement (PDF)</button></div>`;
        sc.querySelector('[data-act]').onclick = () => act('pdf');
        return;
      }
      sc.innerHTML = '';
      pageEls = [];
      for (const n of [1, 2]) {
        const ref = Object.values(spots).find(s => s.page === n - 1) || { pw: 612, ph: 1008 };
        const el = document.createElement('div');
        el.className = 'pkd-page';
        el.style.aspectRatio = ref.pw + ' / ' + ref.ph;
        el.innerHTML = `<canvas aria-label="Page ${n} of the claim packet" role="img"></canvas><div class="pkd-layer" data-layer="${n - 1}"></div>`;
        sc.appendChild(el);
        pageEls.push({ el, n, pw: ref.pw, ph: ref.ph });
      }
      await layoutPages();
      paintSpots();
    }

    async function layoutPages() {
      const sc = ov.querySelector('[data-scroll]'); if (!sc || !pdfDoc) return;
      lastW = sc.clientWidth;
      const avail = Math.min(sc.clientWidth - 24, 900);
      const w = Math.round(avail * st.zoom);
      for (const p of pageEls) {
        p.el.style.width = w + 'px';
        p.el.style.fontSize = (w / p.pw) + 'px';        // 1em = 1 PDF point
        await drawPdfPage(pdfDoc, p.n, p.el.querySelector('canvas'), w);
      }
    }

    const box = s => `left:${(s.x / s.pw * 100).toFixed(3)}%;top:${((s.ph - s.y - s.h) / s.ph * 100).toFixed(3)}%;width:${(s.w / s.pw * 100).toFixed(3)}%;height:${(s.h / s.ph * 100).toFixed(3)}%`;
    function paintSpots() {
      if (!spots || !pageEls.length) return;
      const today = fmtDate(new Date());
      const all = tasks(), act0 = st.active;
      const layers = [0, 1].map(i => ov.querySelector(`[data-layer="${i}"]`));
      if (!layers[0]) return;
      layers.forEach(l => { l.innerHTML = ''; });
      const add = (field, html) => { const s = spots[field]; if (!s) return; layers[s.page].insertAdjacentHTML('beforeend', html(s)); };
      const imgFor = t => t.kind === 'initial' ? st.initials : t.kind === 'sign' ? st.sig.homeowner : t.kind === 'tpa' ? (t.who === 'coowner' ? st.sig.coowner : st.sig.homeowner) : st.sig.sspr;
      all.forEach(t => {
        const done = isDone(t), on = act0 === t.id;
        const fieldsFor = t.kind === 'sign' && st.coowner ? [t.field, 'sig_coowner'] : [t.field];
        fieldsFor.forEach((f, k) => add(f, s => {
          const img = done ? (k === 1 ? st.sig.coowner : imgFor(t)) : null;
          const label = t.kind === 'initial' ? 'Initial here' : 'Sign here';
          return `<button type="button" class="pkd-spot${on ? ' on' : ''}${done ? ' done' : ''}" style="${box(s)}" data-spot="${t.id}" aria-label="${esc(done ? 'Done: ' + label + ' (tap to redo)' : label)}">${img ? `<img src="${img}" alt="">` : ''}</button>
            ${on && k === 0 ? `<span class="pkd-pill above" style="${s.x > s.pw * 0.55 ? `right:${((s.pw - s.x - s.w) / s.pw * 100).toFixed(3)}%` : `left:${(s.x / s.pw * 100).toFixed(3)}%`};top:calc(${((s.ph - s.y - s.h) / s.ph * 100).toFixed(3)}% - 6px)">${label} ▾</span>` : ''}`;
        }));
      });
      // dates and printed names fill in as each person signs
      const auto = (field, text) => text && add(field, s => `<span class="pkd-auto" style="${box(s)};font-size:${Math.min(8, s.h * 0.62).toFixed(1)}em">${esc(text)}</span>`);
      if (st.sig.homeowner) auto('homeowner_date', today);
      if (st.coowner && st.sig.coowner) auto('coowner_date', today);
      if (st.sig.sspr) auto('sspr_date', today);
      if (st.tpaApplied.homeowner) { auto('tpa_insured1_printed_name', st.homeownerName); auto('tpa_insured1_date', today); }
      if (st.coowner && st.tpaApplied.coowner) { auto('tpa_insured2_printed_name', st.coownerName); auto('tpa_insured2_date', today); }
      ov.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => tapSpot(b.dataset.spot)));
      const c = counts();
      const bar = ov.querySelector('[data-bar]'); if (bar) bar.style.width = Math.round(c.done / c.total * 100) + '%';
      const cnt = ov.querySelector('[data-count]'); if (cnt) cnt.textContent = c.done + ' of ' + c.total + ' done';
    }

    function scrollToSpot(field) {
      const sc = ov.querySelector('[data-scroll]');
      const el = ov.querySelector(`[data-spot="${field}"]`);
      if (!sc || !el) return;
      const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
      sc.scrollTo({
        top: sc.scrollTop + (r.top - sr.top) - sc.clientHeight * 0.4,
        left: st.zoom > 1 ? sc.scrollLeft + (r.left - sr.left) - 24 : 0,
        behavior: 'smooth'
      });
    }

    function tapSpot(id) {
      const t = tasks().find(x => x.id === id); if (!t) return;
      if (isDone(t)) {
        if (!root.confirm('Redo this ' + (t.kind === 'initial' ? 'initial' : 'signature') + '?')) return;
        undo(t);
      }
      setActive(id);
    }

    function setActive(id) {
      st.active = id; st.sheetMin = false; pads = {};
      paintSpots(); renderSheet();
      if (id) requestAnimationFrame(() => scrollToSpot(id));
    }

    function advance() {
      const n = nextTask();
      if (n) { setActive(n.id); return; }
      st.active = null; paintSpots();
      st.phase = 'review'; renderReview();
    }

    /* ---------------- the bottom sheet for the current spot */
    function renderSheet() {
      const sh = ov.querySelector('[data-sheet]'); if (!sh) return;
      const t = tasks().find(x => x.id === st.active) || null;
      const grab = `<button type="button" class="pkd-grab" data-act="min" aria-label="${st.sheetMin ? 'Show' : 'Hide'} signing panel"><i></i></button>`;
      if (st.sheetMin) {
        sh.innerHTML = grab + `<div class="pkd-in"><button type="button" class="pks-b" data-act="min" style="width:100%">${t ? 'Back to ' + (t.kind === 'initial' ? 'initialing' : 'signing') : 'Show signing steps'}</button></div>`;
      } else if (!t) {
        const c = counts();
        sh.innerHTML = grab + `<div class="pkd-in">
          <p class="pkd-p">This is your actual agreement, filled in. Scroll to read both pages${st.zoom === 1 ? ' (tap Zoom to enlarge)' : ''}. The <b>${c.total - c.done} yellow spots</b> are where you initial or sign.</p>
          <button type="button" class="pks-b go" style="width:100%" data-act="begin">${c.done ? 'Continue' : 'Start: first initial'}</button></div>`;
      } else if (t.kind === 'initial') {
        const ded = t.idx === 'ded';
        const term = ded ? ['Deductible', 'I understand my insurance deductible' + (fields.deductible ? ' of $' + fields.deductible : '') + ' is my responsibility.'] : KEY_TERMS[t.idx];
        const drawing = !st.initials || st.redraw.initials;
        sh.innerHTML = grab + `<div class="pkd-in">
          <div class="pkd-k">${ded ? 'Initial · deductible' : 'Key term ' + (t.idx + 1) + ' of ' + KEY_TERMS.length}</div>
          <div class="pkd-h">${esc(term[0])}</div>
          <p class="pkd-p">${esc(term[1])}</p>
          ${drawing ? `<div class="pkd-row"><div class="pks-pad small" data-pad="initials"></div>
              <div class="pkd-side"><span>Draw your initials once — we’ll reuse them.</span><button type="button" class="pks-link" data-clear="initials" style="padding:6px 0">Clear</button></div></div>`
            : `<div class="pks-applied"><img src="${st.initials}" alt="Your initials"><button type="button" class="pks-link" data-act="redraw-initials">Draw again</button></div>`}
          <button type="button" class="pks-b go" style="width:100%" data-act="do">Initial this ${ded ? 'box' : 'term'}</button></div>`;
      } else if (t.kind === 'sign') {
        const cancelBy = fmtDate(addBusinessDays(new Date(), CANCEL_BUSINESS_DAYS));
        sh.innerHTML = grab + `<div class="pkd-in">
          <div class="pkd-h">Sign the agreement</div>
          <p class="pkd-p">You agree to everything on page 1. You can cancel until midnight on <b>${esc(cancelBy)}</b>.</p>
          <div class="pks-fld"><label for="pks-hn">Your full name</label><input id="pks-hn" data-name="homeowner" value="${esc(st.homeownerName)}" autocomplete="name"></div>
          <div class="pks-pad" data-pad="homeowner"></div>
          <div class="pks-padbar"><span>Sign with your finger</span><button type="button" class="pks-link" data-clear="homeowner">Clear</button></div>
          ${st.coowner ? `<div class="pks-fld"><label for="pks-cn">Co-owner full name</label><input id="pks-cn" data-name="coowner" value="${esc(st.coownerName)}"></div>
            <div class="pks-pad" data-pad="coowner"></div>
            <div class="pks-padbar"><span>Co-owner signature</span><span><button type="button" class="pks-link" data-clear="coowner">Clear</button><button type="button" class="pks-link" data-act="nocoowner">Remove co-owner</button></span></div>`
            : `<button type="button" class="pks-link" data-act="coowner" style="padding:0 0 12px">+ Add a co-owner</button>`}
          <button type="button" class="pks-b go" style="width:100%" data-act="do">Sign page 1</button></div>`;
      } else if (t.kind === 'tpa') {
        const co = t.who === 'coowner';
        const sigImg = co ? st.sig.coowner : st.sig.homeowner;
        const drawing = st.redraw[t.who];
        sh.innerHTML = grab + `<div class="pkd-in">
          <div class="pkd-k">${co ? esc(st.coownerName || 'Co-owner') : esc(st.homeownerName || 'Homeowner')}</div>
          <div class="pkd-h">Let StormShield talk to ${esc(fields.insurance_company || 'your insurance company')}</div>
          <p class="pkd-p">Your insurance company may discuss this claim with StormShield Pro Roofing and its staff. StormShield is not a public adjuster and won’t negotiate or settle your claim. This stays in effect through any denial, appeal or appraisal until you revoke it in writing.</p>
          ${drawing ? `<div class="pks-pad" data-pad="tpa"></div><div class="pks-padbar"><span>Sign with your finger</span><button type="button" class="pks-link" data-clear="tpa">Clear</button></div>`
            : `<div class="pks-applied"><img src="${sigImg}" alt="Your signature"><span style="font-size:13px;color:#5A6478">Your signature from page 1</span></div>
               <button type="button" class="pks-link" data-act="redraw-tpa" style="padding:0 0 10px">Draw it again instead</button>`}
          <button type="button" class="pks-b go" style="width:100%" data-act="do">Sign page 2</button></div>`;
      } else if (t.kind === 'rep') {
        sh.innerHTML = grab + `<div class="pkd-in">
          <div class="pks-ok">✓ Thank you! Please hand the device back to your StormShield representative.</div>
          <div class="pkd-h">StormShield representative</div>
          <div class="pks-fld"><label for="pks-rn">Representative name</label><input id="pks-rn" data-name="rep" value="${esc(st.repName)}"></div>
          <div class="pks-pad" data-pad="sspr"></div>
          <div class="pks-padbar"><span>Representative signature</span><button type="button" class="pks-link" data-clear="sspr">Clear</button></div>
          <button type="button" class="pks-b go" style="width:100%" data-act="do">Sign as representative</button></div>`;
      }
      pads = {};
      sh.querySelectorAll('[data-pad]').forEach(h => { pads[h.dataset.pad] = makePad(h); });
      sh.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => { const p = pads[b.dataset.clear]; if (p) p.clear(); }));
      sh.querySelectorAll('[data-name]').forEach(inp => inp.addEventListener('input', () => {
        const k = inp.dataset.name;
        if (k === 'homeowner') st.homeownerName = inp.value; else if (k === 'coowner') st.coownerName = inp.value; else st.repName = inp.value;
      }));
      sh.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
    }

    function complete() {
      const t = tasks().find(x => x.id === st.active); if (!t) return;
      const now = new Date().toISOString();
      if (t.kind === 'initial') {
        if (!st.initials || st.redraw.initials) {
          const png = pads.initials && pads.initials.toPng();
          if (!png) { say('Draw your initials in the box first'); return; }
          st.initials = png; st.redraw.initials = false;
        }
        st.initialed[t.idx] = true; st.at['initial_' + t.idx] = now;
      } else if (t.kind === 'sign') {
        if (!st.homeownerName.trim()) { say('Enter your full name'); return; }
        const hp = pads.homeowner && pads.homeowner.toPng();
        if (!hp) { say('Please sign in the box'); return; }
        let cp = null;
        if (st.coowner) {
          if (!st.coownerName.trim()) { say('Enter the co-owner’s name'); return; }
          cp = pads.coowner && pads.coowner.toPng();
          if (!cp) { say('Co-owner: please sign in the box'); return; }
        }
        st.sig.homeowner = hp; st.at.homeowner = now;
        if (cp) { st.sig.coowner = cp; st.at.coowner = now; }
      } else if (t.kind === 'tpa') {
        if (st.redraw[t.who]) {
          const p = pads.tpa && pads.tpa.toPng();
          if (!p) { say('Please sign in the box'); return; }
          st.sig[t.who] = p; st.redraw[t.who] = false;   // one signature per person, on both pages
        }
        st.tpaApplied[t.who] = true; st.at['tpa_' + t.who] = now;
      } else if (t.kind === 'rep') {
        if (!st.repName.trim()) { say('Enter the representative name'); return; }
        const rp = pads.sspr && pads.sspr.toPng();
        if (!rp) { say('Representative: please sign'); return; }
        st.sig.sspr = rp; st.at.sspr = now;
      }
      advance();
    }

    /* ---------------- review: the finished pages before anything is saved */
    async function renderReview() {
      const cancelBy = fmtDate(addBusinessDays(new Date(), CANCEL_BUSINESS_DAYS));
      ov.innerHTML = `<div class="pks-top"><b>Review &amp; ${remote ? 'submit' : 'save'}</b><span>${counts().total} of ${counts().total} done</span></div>
        <div class="pks-body">
          <h2>Check your signed packet</h2>
          <p class="pks-sub">This is exactly what will be saved. Tap a page to look closer.</p>
          <div class="pkd-thumbs big">
            <figure><button type="button" class="pkd-thumb" data-open="1" aria-label="Open signed page 1"></button><figcaption><b>Page 1 · Agreement</b><span class="ok">${KEY_TERMS.length + 1} initials · signed</span></figcaption></figure>
            <figure><button type="button" class="pkd-thumb" data-open="2" aria-label="Open signed page 2"></button><figcaption><b>Page 2 · Authorization</b><span class="ok">Signed</span></figcaption></figure>
          </div>
          <div class="pks-card">
            <div class="pks-fld" style="margin-bottom:8px"><label for="pks-em">Email ${remote ? 'my' : 'the homeowner a'} signed copy to</label>
              <input id="pks-em" type="email" inputmode="email" autocomplete="email" data-copyemail value="${esc(st.copyEmail)}" placeholder="name@example.com"></div>
            <p class="pks-legal" style="margin:0">${remote ? 'You can also download it on the next screen. StormShield Pro Roofing keeps a copy too. ' : 'The office gets a copy too. '}You may cancel until midnight on <b style="color:#141A26">${esc(cancelBy)}</b>.</p>
          </div>
        </div>
        <div class="pks-foot"><div style="flex-direction:column">
          <button type="button" class="pks-b go" style="flex:none;width:100%" data-act="submit">${remote ? 'Submit signed packet' : 'Finish & save'}</button>
          <button type="button" class="pks-b" style="flex:none;width:100%;height:46px" data-act="back-doc">Go back and change something</button></div></div>`;
      ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
      const em = ov.querySelector('[data-copyemail]');
      if (em) em.addEventListener('input', () => { st.copyEmail = em.value.trim(); });
      const r = result();
      let bytes = null;
      try {
        bytes = await buildPdf(fields, {
          initials: r.initials, homeowner: r.sig.homeowner, coowner: r.coowner ? r.sig.coowner : null, sspr: r.sig.sspr || opts.repSig || null,
          tpa1: r.tpaApplied.homeowner ? r.sig.homeowner : null, tpa2: r.coowner && r.tpaApplied.coowner ? r.sig.coowner : null
        }, { signedAt: new Date(), homeownerName: r.homeownerName, coownerName: r.coownerName });
        ov.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openBlob(bytes)));
        const doc = await openPdfDoc(bytes);
        for (const n of [1, 2]) {
          const host = ov.querySelector(`[data-open="${n}"]`); if (!host) return;
          const cv = document.createElement('canvas'); host.appendChild(cv);
          await drawPdfPage(doc, n, cv, host.clientWidth || 170);
        }
      } catch (e) { console.warn('[packet] review preview', e); }
      st.reviewedAt = new Date().toISOString();
    }

    const result = () => ({
      consentAt: st.consentAt, homeownerName: st.homeownerName.trim(), coowner: st.coowner, coownerName: st.coownerName.trim(),
      initials: st.initials, initialed: st.initialed, sig: st.sig, tpaApplied: st.tpaApplied, at: st.at, repName: st.repName.trim(),
      reviewedAt: st.reviewedAt, copyEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(st.copyEmail || '') ? st.copyEmail.trim() : ''
    });

    async function runFinish() {
      st.phase = 'finish';
      ov.innerHTML = `<div class="pks-top"><b>StormShield Pro Roofing · Claim Packet</b><span>Finishing</span></div>
        <div class="pks-body"><div class="pks-ok" data-done>Saving the signed packet…</div></div>`;
      const box2 = () => ov.querySelector('[data-done]');
      try {
        const out = await opts.onFinish(result());
        const b = box2(); if (!b) return;
        b.innerHTML = remote ? '✓ Signed! Thank you.' : '✓ Signed and saved to the job.';
        const after = document.createElement('div');
        after.innerHTML = `<div class="pks-card" style="font-size:14px;line-height:1.6">${remote
            ? `${out.emailedTo ? `We emailed your signed copy to <b>${esc(out.emailedTo)}</b>. You can also download it below.` : 'Your signed copy is ready below.'} StormShield Pro Roofing has a copy too.<br>You may cancel until midnight on <b>${esc(fmtDate(out.cancelBy))}</b>. Questions? Call 832-910-7735.`
            : `${out.emailedTo ? `Emailed a copy to <b>${esc(out.emailedTo)}</b>.<br>` : out.emailError ? `<span style="color:#8A1C1C">Couldn’t email the copy: ${esc(out.emailError)}</span><br>` : ''}Cancellation window ends <b>${esc(fmtDate(out.cancelBy))}</b> at midnight.`}</div>
          <div style="display:flex;gap:10px">${out.finalBytes ? `<button type="button" class="pks-b${remote ? ' go' : ''}" data-v>${remote ? 'Download my copy' : 'View signed PDF'}</button>` : ''}${remote ? '' : '<button type="button" class="pks-b go" data-x>Done</button>'}</div>`;
        b.parentNode.appendChild(after);
        const v = after.querySelector('[data-v]');
        if (v) v.onclick = () => openBlob(out.finalBytes, out.fileName || 'StormShield Claim Packet (signed).pdf');
        const x = after.querySelector('[data-x]');
        if (x) x.onclick = () => { close(); if (opts.onDone) opts.onDone(); };
      } catch (e) {
        console.error('[packet] finish failed', e);
        const b = box2(); if (!b) return;
        b.style.background = '#FDECEC'; b.style.color = '#8A1C1C';
        b.innerHTML = esc(e && e.userMessage ? e.userMessage : 'Could not save the signed packet. Check your connection and try again.') + ' <button type="button" class="pks-link" data-retry>Try again</button>';
        b.querySelector('[data-retry]').onclick = runFinish;
      }
    }

    async function act(a) {
      if (a === 'cancel') { if (root.confirm('Stop signing? Nothing will be saved.')) close(); return; }
      if (a === 'disclosure') { st.showDisclosure = !st.showDisclosure; renderWelcome(); return; }
      if (a === 'start') { if (!st.consentAt) return; st.phase = 'doc'; renderDocShell(); return; }
      if (a === 'pdf') { try { await docReady; openBlob(docBytes); } catch (e) { say('Could not open the PDF'); } return; }
      if (a === 'zoom') {
        st.zoom = st.zoom === 1 ? 1.7 : 1;
        const zb = ov.querySelector('[data-act="zoom"]'); if (zb) zb.textContent = 'Zoom ' + (st.zoom === 1 ? '+' : '−');
        await layoutPages(); if (st.active) scrollToSpot(st.active);
        return;
      }
      if (a === 'begin') { advance(); return; }
      if (a === 'min') { st.sheetMin = !st.sheetMin; renderSheet(); return; }
      if (a === 'do') { complete(); return; }
      if (a === 'redraw-initials') { st.redraw.initials = true; renderSheet(); return; }
      if (a === 'redraw-tpa') { const t = tasks().find(x => x.id === st.active); if (t) { st.redraw[t.who] = true; renderSheet(); } return; }
      if (a === 'coowner') { st.coowner = true; renderSheet(); paintSpots(); return; }
      if (a === 'nocoowner') { st.coowner = false; delete st.sig.coowner; st.tpaApplied.coowner = false; renderSheet(); paintSpots(); return; }
      if (a === 'back-doc') { st.phase = 'doc'; st.active = null; renderDocShell(); return; }
      if (a === 'submit') { await runFinish(); return; }
    }

    renderWelcome();
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
        // Email the signed PDF to the homeowner (and the office) through Zoho Mail.
        if (r.copyEmail && rec.path) {
          const em = await emailPacket(j, rec.path, r.copyEmail, out.cancelBy);
          if (em.ok) { out.emailedTo = r.copyEmail; p.signed.emailedTo = r.copyEmail; }
          else if (!em.notConfigured) { out.emailError = em.error; p.signed.emailError = em.error; }
          save();
        }
        return out;
      }
    });
  }

  // "Please sign" email with the private link, sent from the office's Zoho Mail.
  async function emailLink(j, token, to, url) {
    if (!db() || !db().functions) return { ok: false, notConfigured: true };
    try {
      const signPage = String(url).split('?')[0];
      const { data, error } = await db().functions.invoke('packet-email', { body: { kind: 'link', job_id: j.id, token, to, signPage } });
      if (error) {
        let msg = error.message || 'send failed';
        try { const b = await error.context.json(); if (b && b.notConfigured) return { ok: false, notConfigured: true }; if (b && b.error) msg = b.error; } catch (e) {}
        return { ok: false, error: msg };
      }
      if (data && data.ok) return { ok: true };
      return { ok: false, notConfigured: !!(data && data.notConfigured), error: (data && data.error) || 'send failed' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function emailPacket(j, path, to, cancelBy) {
    if (!db() || !db().functions) return { ok: false, notConfigured: true };
    try {
      const { data, error } = await db().functions.invoke('packet-email', {
        body: { job_id: j.id, path, to, cancelBy: cancelBy ? new Date(cancelBy).toISOString() : null }
      });
      if (error) {
        let msg = error.message || 'send failed';
        try { const b = await error.context.json(); if (b && b.notConfigured) return { ok: false, notConfigured: true }; if (b && b.error) msg = b.error; } catch (e) {}
        return { ok: false, error: msg };
      }
      if (data && data.ok) {
        if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Signed claim packet emailed', 'Sent to ' + to);
        return { ok: true };
      }
      return { ok: false, notConfigured: !!(data && data.notConfigured), error: (data && data.error) || 'send failed' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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

  // Load this job's signing links, pick up a remote signature, then redraw the status card.
  async function renderLinks(j) {
    const links = await loadLinks(j);
    linkCache.set(String(j.id), links);
    if (await reconcile(j, links)) { rerender(); return; }
    renderTracker(j);
  }

  async function voidLink(jobId, linkId) {
    const j = jobById(jobId); if (!j || !db()) return;
    if (!root.confirm('Cancel this signing link? The homeowner will no longer be able to use it.')) return;
    const { error } = await db().from('packet_links').update({ status: 'void' }).eq('id', linkId).neq('status', 'signed');
    if (error) { say('Could not cancel the link'); return; }
    say('Link cancelled'); renderLinks(j);
  }

  // Rep signs once, then a private link is created and sent from the rep's phone / email.
  // opts.resendFrom = id of an earlier link: replace it with a fresh one, reusing the rep's signature.
  function sendForSignature(jobId, opts) {
    opts = opts || {};
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
    const shut = () => { ov.remove(); document.body.style.overflow = prevOverflow; renderLinks(j); };
    const release = trapBack(shut);                    // phone Back closes this panel
    const close = () => { release(); shut(); };
    ov.addEventListener('click', e => { if (e.target.closest('[data-x-close]')) close(); });
    let repName = me(), phone = p.fields.cell_phone || '', email = p.fields.email || '';

    // Store a new link (only its hash) and return the raw token for the message.
    const createLink = async (repSig, repSignedAt) => {
      const token = randomToken();
      const now = new Date();
      const { error } = await db().from('packet_links').insert({
        job_id: j.id, token_hash: await sha256Text(token), fields: p.fields,
        rep_name: repName, rep_sig: repSig, rep_signed_at: repSignedAt || now.toISOString(),
        created_by: me() || repName, sent_to: [phone, email].filter(Boolean).join(' / '),
        expires_at: new Date(now.getTime() + LINK_DAYS * 864e5).toISOString()
      });
      if (error) throw error;
      if (phone && !p.fields.cell_phone) p.fields.cell_phone = phone;
      if (email && !p.fields.email) p.fields.email = email;
      return token;
    };

    const step1 = () => {
      ov.innerHTML = `<div class="pks-top"><b>Send for signature</b><span>${esc(p.fields.name || '')}</span><button type="button" class="pkd-x" data-x-close aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div>
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
      ov.querySelector('[data-cancel]').onclick = close;
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
          const token = await createLink(repSig, null);
          if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet sent for signature', 'Signing link created by ' + repName + (phone || email ? ' for ' + [phone, email].filter(Boolean).join(' / ') : ''));
          save();
          step2(signUrl(token), token);
        } catch (e) {
          console.error('[packet] link create failed', e);
          say('Could not create the link — ' + (e.message || 'try again'));
          btn.disabled = false; btn.textContent = 'Create signing link';
        }
      };
    };

    const step2 = (url, token) => {
      const mailto = `mailto:${esc(email)}?subject=${encodeURIComponent('Your StormShield claim paperwork \u2014 please sign')}&body=${encodeURIComponent(linkMessage(p.fields, repName, url))}`;
      const msg = linkMessage(p.fields, repName, url);
      ov.innerHTML = `<div class="pks-top"><b>Send for signature</b><span>${esc(p.fields.name || '')}</span><button type="button" class="pkd-x" data-x-close aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div>
        <div class="pks-body">
          <div class="pks-ok">✓ ${opts.resendFrom ? 'New link ready — the old one no longer works. This one' : 'Link ready — it'} works for ${LINK_DAYS} days.</div>
          <h2>Send it to the homeowner</h2>
          <p class="pks-sub">Text opens your phone’s Messages app with the message filled in — just hit send.</p>
          ${phone ? `<a class="pks-b go" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-bottom:10px" href="${esc(smsHref(phone, msg))}" data-sent="text">Text from my phone</a>` : ''}
          ${email ? `<button type="button" class="pks-b" style="width:100%;margin-bottom:4px" data-zemail>Email it to ${esc(email)}</button>
            <p class="pks-legal" style="margin:0 0 10px;text-align:center" data-zemail-note>Sends a branded email from the office with a \u201cReview &amp; sign\u201d button. <a href="${mailto}" data-sent="email" style="color:#2F6FEB">Use my email app instead</a></p>` : ''}
          <button type="button" class="pks-b" style="width:100%;margin-bottom:12px" data-copy>Copy link</button>
          <div class="pks-card" style="font-size:13px;color:#3C4658;word-break:break-all">${esc(msg)}</div>
          <p class="pks-legal">For security this link is shown only now. If it’s lost, cancel it and send a new one.</p>
        </div>
        <div class="pks-foot"><div><button type="button" class="pks-b go" data-close>Done</button></div></div>`;
      ov.querySelectorAll('[data-sent]').forEach(a => a.addEventListener('click', () => {
        if (typeof root.logContact === 'function') root.logContact(j, 'client', a.dataset.sent, 'Claim packet signing link sent');
      }));
      const zb = ov.querySelector('[data-zemail]');
      if (zb) zb.onclick = async () => {
        zb.disabled = true; zb.textContent = 'Sending\u2026';
        const r = await emailLink(j, token, email, url);
        const note = ov.querySelector('[data-zemail-note]');
        if (r.ok) {
          zb.textContent = '\u2713 Emailed to ' + email;
          if (typeof root.logContact === 'function') root.logContact(j, 'client', 'email', 'Claim packet signing link emailed to ' + email);
        } else {
          zb.disabled = false; zb.textContent = 'Email it to ' + email;
          if (note) note.innerHTML = (r.notConfigured ? 'Office email isn\u2019t set up yet. ' : 'Couldn\u2019t send: ' + esc(r.error || 'try again') + '. ')
            + `<a href="${mailto}" data-sent="email" style="color:#2F6FEB">Use my email app instead</a>`;
          const a = note && note.querySelector('[data-sent]');
          if (a) a.addEventListener('click', () => { if (typeof root.logContact === 'function') root.logContact(j, 'client', 'email', 'Claim packet signing link sent'); });
        }
      };
      ov.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(url); say('Link copied'); } catch (e) { root.prompt('Copy this link:', url); }
      };
      ov.querySelector('[data-close]').onclick = close;
    };
    // Resend: no re-signing — reuse the rep's signature from the earlier link.
    const resend = async () => {
      ov.innerHTML = `<div class="pks-top"><b>Resend for signature</b><span>${esc(p.fields.name || '')}</span><button type="button" class="pkd-x" data-x-close aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div>
        <div class="pks-body"><div class="pks-ok">Creating a new link\u2026</div></div>`;
      try {
        const { data: old, error } = await db().from('packet_links')
          .select('id,status,rep_name,rep_sig,rep_signed_at,sent_to').eq('id', opts.resendFrom).maybeSingle();
        if (error) throw error;
        if (!old || old.status === 'signed') { say('That link was already signed'); close(); return; }
        if (!old.rep_sig) { say('Please sign again to send a new link'); step1(); return; }
        repName = old.rep_name || repName;
        String(old.sent_to || '').split(' / ').forEach(x => {
          x = x.trim(); if (!x) return;
          if (x.indexOf('@') > 0) { if (!email) email = x; } else if (!phone) phone = x;
        });
        if (!phone && !email) { say('Add the homeowner\u2019s mobile or email first'); step1(); return; }
        const token = await createLink(old.rep_sig, old.rep_signed_at);
        await db().from('packet_links').update({ status: 'void' }).eq('id', old.id).neq('status', 'signed');
        if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Claim packet signing link resent', 'New signing link created by ' + (me() || repName) + ' for ' + [phone, email].filter(Boolean).join(' / ') + '; the previous link was cancelled');
        save();
        step2(signUrl(token), token);
      } catch (e) {
        console.error('[packet] resend failed', e);
        say('Could not resend \u2014 ' + (e.message || 'try again'));
        close();
      }
    };

    if (opts.resendFrom) resend(); else step1();
  }

  function resendLink(jobId, linkId) { sendForSignature(jobId, { resendFrom: linkId }); }

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
    finalizeSigned, openSigningFlow, setTemplateBytes, templateSpots, sendForSignature, resendLink, voidLink, renderLinks, sha256Hex, CONSENT });
})(typeof window !== 'undefined' ? window : globalThis);
