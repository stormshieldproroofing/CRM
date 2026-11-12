/* ==========================================================================
   Contract — Contract Confirmation (work order, specs, payment) + Terms & Conditions.

   One legal sheet per job (front: contract confirmation, back: terms). The CRM fills
   it from the job, the rep picks the materials, the homeowner initials and signs on
   the rep's phone or through a private link, and the signed PDF is saved to the job.
   The signing screens, status card and links come from the engine in crm-packet.js.

   Data (all inside the job's contract JSON, which Supabase already stores):
     j.contract             customer, street, citystatezip, email, cell, rep, contractDate,
                            buildDate, rcv, netClaim, deductible, depreciation, addl[8],
                            checks{key:bool}, qty{key:text}  (same keys the old form used)
     j.contract.sign        { status:'draft'|'signed', signed:{…}, history, restartedAt }
     j.signedContractFiles  signed PDFs / paper scans (job_files kind 'signed_contract')

   The pure helpers at the top are also exported for Node tests.
   ========================================================================== */
(function (root) {
  'use strict';

  const TEMPLATE_URL = 'StormShield_Contract.pdf';
  const CONTRACT_VERSION = 'SSPR Contract Confirmation · ver. 11/2026';

  // Plain text answers (CRM key → PDF field)
  const TEXT_FIELDS = { customer: 'customer', street: 'street', citystatezip: 'citystatezip', email: 'email', cell: 'cell', rep: 'rep',
    rcv: 'rcv', netClaim: 'net_claim', deductible: 'deductible', depreciation: 'depreciation' };
  const DATE_FIELDS = { contractDate: 'contract_date', buildDate: 'build_date' };
  // Qty / "other" boxes next to a checkbox (same name in the CRM and the PDF)
  const QTY_KEYS = ['vent_ridge_lf', 'vent_power_qty', 'vent_solar_qty', 'vent_static_qty', 'vent_turbine_qty', 'vent_color_qty',
    'plumbing_3in1_qty', 'plumbing_1_5_lead_qty', 'plumbing_2_lead_qty', 'plumbing_3_lead_qty',
    'shingles_other', 'color_other', 'start_strip_other', 'underlayment_other', 'ridge_other', 'valley_other', 'drip_edge_size', 'decking_other'];
  // Every checkbox, grouped the way the form shows them: [key, label, otherKey?]
  const GROUPS = {
    shingles_certainteed: [['shingles_certainteed_1', 'CertainTeed'], ['shingles_certainteed_2', 'Landmark'], ['shingles_certainteed_3', 'Landmark Pro'],
      ['shingles_certainteed_4', 'Landmark Climate Flex'], ['shingles_certainteed_5', 'Presidential Shake'], ['shingles_certainteed_6', 'Presidential Shake TL'],
      ['shingles_certainteed_7', 'Carriage House'], ['shingles_certainteed_8', 'Belmont'], ['shingles_certainteed_9', 'Grand Manor'], ['shingles_certainteed_10', 'Solaris']],
    shingles_tamko: [['shingles_tamko_1', 'Tamko'], ['shingles_tamko_2', 'Heritage'], ['shingles_tamko_3', 'Titan XT'], ['shingles_tamko_4', 'StormFighter FLEX'],
      ['shingles_tamko_5', 'HailGuard'], ['shingles_tamko_6', 'Other', 'shingles_other']],
    colors: [['colors_1', 'Burnt Sienna / Rustic Hickory'], ['colors_2', 'Georgetown / Oxford Gray'], ['colors_3', 'Cobblestone Gray / Antique Slate'],
      ['colors_4', 'Thunderstorm Gray'], ['colors_5', 'Espresso / Black Walnut'], ['colors_6', 'Heather Blend / Natural Timber'], ['colors_7', 'Moire Black / Rustic Black'],
      ['colors_8', 'Silver Birch / Old English Pewter'], ['colors_9', 'Resawn Shake / Rustic Cedar'], ['colors_10', 'Weathered Wood'], ['colors_11', 'Other', 'color_other']],
    start_strip: [['start_strip_1', 'Swift Start'], ['start_strip_2', 'Tamko Starter Strip'], ['start_strip_3', 'Other', 'start_strip_other']],
    underlayment: [['underlayment_1', 'Roof Runner'], ['underlayment_2', 'Synthetic'], ['underlayment_3', 'Radiant Barrier'], ['underlayment_4', 'Other', 'underlayment_other']],
    ridge: [['ridge_1', 'Shadow Ridge'], ['ridge_2', 'Cedar Crest'], ['ridge_3', 'Tamko Heritage'], ['ridge_4', 'Tamko Heritage Designer'], ['ridge_5', 'Tamko Proline'], ['ridge_6', 'Other', 'ridge_other']],
    valley: [['valley_1', 'Ice & Water Shield'], ['valley_2', '"W" Metal'], ['valley_3', 'Valley Metal'], ['valley_4', 'Other', 'valley_other']],
    drip_edge: [['drip_edge_1', 'Use existing'], ['drip_edge_2', 'Pre-finished edge', 'drip_edge_size']],
    drip_color: [['de_color_black', 'Black'], ['de_color_white', 'White'], ['de_color_brown', 'Brown'], ['de_color_almond', 'Almond'], ['de_color_bronze', 'Bronze'], ['de_color_gray', 'Gray'], ['de_color_tan', 'Tan']],
    ventilation: [['vent_left_1', 'Ridge vent', 'vent_ridge_lf', 'LF'], ['vent_left_2', 'Power vents', 'vent_power_qty', 'Qty'], ['vent_left_3', 'Solar vents', 'vent_solar_qty', 'Qty'],
      ['vent_right_1', 'Static vents', 'vent_static_qty', 'Qty'], ['vent_right_2', 'Turbines', 'vent_turbine_qty', 'Qty'], ['vent_right_3', 'Vent color', 'vent_color_qty', 'Color']],
    plumbing: [['plumbing_1', '3-in-1', 'plumbing_3in1_qty', 'Qty'], ['plumbing_2', '1-1/2" lead', 'plumbing_1_5_lead_qty', 'Qty'], ['plumbing_3', '2" lead', 'plumbing_2_lead_qty', 'Qty'], ['plumbing_4', '3" lead', 'plumbing_3_lead_qty', 'Qty']],
    decking: [['decking_1', 'OSB'], ['decking_2', 'Plywood'], ['decking_3', 'Radiant Barrier'], ['decking_4', 'Other', 'decking_other']],
    warranty: [['warranty_standard', 'Standard'], ['warranty_3star', '3-Star (20-yr non-prorated)'], ['warranty_4star', '4-Star (50-yr non-prorated)'], ['warranty_5star', '5-Star'],
      ['warranty_lifetime', 'Lifetime Workmanship'], ['warranty_class3', 'Class 3 Impact + 160 mph wind + 10-yr algae']],
    review: [['review_submitted', 'All reviews have been submitted']]
  };
  const CHECK_KEYS = [].concat(...Object.values(GROUPS)).map(x => x[0]);
  const DEFAULT_ADDL = ['Project manager on site', 'Protect landscaping + A/C unit', 'Tear-off, haul away, and disposal of all roofing debris.', 'Clean up + 3x magnetic sweeping', '', '', '', ''];

  /* ---------------------------------------------------------------- pure helpers */
  const isBlank = v => v == null || String(v).trim() === '' || String(v).trim() === '—';
  // ISO yyyy-mm-dd → mm/dd/yyyy; anything else passes through
  function fmtLooseDate(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[2] + '/' + m[3] + '/' + m[1]) : String(v || '');
  }
  const TZ = 'America/Chicago';
  function todayIso() {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(x => { parts[x.type] = x.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  // "123 Main St, Pearland, TX 77584" → { street, cityStateZip }
  function splitAddress(addr) {
    const s = String(addr || '').trim();
    if (!s || s === '—') return { street: '', cityStateZip: '' };
    const parts = s.split(',').map(p => p.trim()).filter(Boolean);
    const street = parts.shift() || '';
    return { street, cityStateZip: parts.join(', ').replace(/,\s*(USA|United States)$/i, '') };
  }
  const money = v => { const s = String(v == null ? '' : v).replace(/^\$\s*/, '').trim(); return s === '0' ? '' : s; };

  // The contract object on a job, with every part present and the empty parts filled from the job.
  // Returns the keys it filled (so the caller can save once).
  function ensureContract(j) {
    if (!j.contract || typeof j.contract !== 'object') j.contract = {};
    const c = j.contract;
    if (!c.checks || typeof c.checks !== 'object') c.checks = {};
    if (!c.qty || typeof c.qty !== 'object') c.qty = {};
    if (!Array.isArray(c.addl) || !c.addl.length) c.addl = DEFAULT_ADDL.slice();
    while (c.addl.length < 8) c.addl.push('');
    if (!c.sign || typeof c.sign !== 'object') c.sign = { status: 'draft', signed: null };
    if (!c.sign.status) c.sign.status = c.sign.signed ? 'signed' : 'draft';
    if (!Array.isArray(j.signedContractFiles)) j.signedContractFiles = [];
    return c;
  }
  function prefillFromJob(j) {
    const c = ensureContract(j);
    if (c.sign.status === 'signed') return [];
    const a = splitAddress(j.address);
    const rep = (typeof root.jobRep === 'function') ? (root.jobRep(j) || {}).name : '';
    const src = {
      customer: j.name && j.name !== '—' ? j.name : '', street: a.street, citystatezip: a.cityStateZip, email: j.email, cell: j.phone,
      rep: rep && rep !== 'Unassigned' ? rep : (j.salesman || ''), contractDate: todayIso(), buildDate: j.buildDate && /^\d{4}-\d{2}-\d{2}/.test(j.buildDate) ? j.buildDate.slice(0, 10) : '',
      rcv: money(j.rcv), netClaim: money(j.netClaim), deductible: money(j.deductible), depreciation: money(j.recoverableDep)
    };
    const done = [];
    Object.keys(src).forEach(k => { if (isBlank(c[k]) && !isBlank(src[k])) { c[k] = String(src[k]).trim(); done.push(k); } });
    return done;
  }

  // Contract → flat { pdfFieldName: value } (text, or true for a checked box). Also the link's snapshot.
  function contractFields(c) {
    c = c || {};
    const f = {};
    Object.keys(TEXT_FIELDS).forEach(k => { if (!isBlank(c[k])) f[TEXT_FIELDS[k]] = String(c[k]).trim(); });
    Object.keys(DATE_FIELDS).forEach(k => { if (!isBlank(c[k])) f[DATE_FIELDS[k]] = fmtLooseDate(c[k]); });
    (c.addl || []).forEach((v, i) => { if (i < 8 && !isBlank(v)) f['addl_' + (i + 1)] = String(v).trim(); });
    const q = c.qty || {};
    QTY_KEYS.forEach(k => { if (!isBlank(q[k])) f[k] = String(q[k]).trim(); });
    const ck = c.checks || {};
    CHECK_KEYS.forEach(k => { if (ck[k] === true) f[k] = true; });
    return f;
  }

  // What still needs filling before anyone can sign.
  function missingForSigning(c) {
    c = c || {};
    const need = [];
    if (isBlank(c.customer)) need.push('Customer name');
    if (isBlank(c.street)) need.push('Street address');
    return need;
  }
  // Per section, what's still blank — only for the "Done / N missing" badges.
  function sectionMissing(c) {
    c = c || {};
    const ck = c.checks || {}, q = c.qty || {};
    const any = keys => keys.some(k => ck[k] === true);
    const out = {
      customer: ['customer', 'street', 'citystatezip', 'cell'].filter(k => isBlank(c[k])),
      specs: [],
      payment: isBlank(c.rcv) ? ['rcv'] : []
    };
    if (!any(GROUPS.shingles_certainteed.concat(GROUPS.shingles_tamko).map(x => x[0]))) out.specs.push('shingles');
    if (!any(GROUPS.colors.map(x => x[0]))) out.specs.push('color');
    if (!any(GROUPS.warranty.map(x => x[0]))) out.specs.push('warranty');
    if (ck.shingles_tamko_6 && isBlank(q.shingles_other)) out.specs.push('shingles_other');
    if (ck.colors_11 && isBlank(q.color_other)) out.specs.push('color_other');
    return out;
  }
  // "Tamko Titan XT · Weathered Wood" for the status card
  function specSummary(c) {
    c = c || {};
    const ck = c.checks || {}, q = c.qty || {};
    const pick = (keys, otherKey) => keys.filter(x => ck[x[0]] === true && x[0] !== otherKey).map(x => x[1]);
    const sh = pick(GROUPS.shingles_tamko, 'shingles_tamko_6').filter(x => x !== 'Tamko').map(x => 'Tamko ' + x)
      .concat(pick(GROUPS.shingles_certainteed, 'shingles_certainteed_1').map(x => 'CertainTeed ' + x));
    if (ck.shingles_tamko_6 && !isBlank(q.shingles_other)) sh.push(String(q.shingles_other).trim());
    const col = pick(GROUPS.colors, 'colors_11');
    if (ck.colors_11 && !isBlank(q.color_other)) col.push(String(q.color_other).trim());
    return sh.concat(col).join(' · ');
  }

  const api = { TEMPLATE_URL, CONTRACT_VERSION, TEXT_FIELDS, DATE_FIELDS, QTY_KEYS, GROUPS, CHECK_KEYS, DEFAULT_ADDL,
    splitAddress, fmtLooseDate, ensureContract, prefillFromJob, contractFields, missingForSigning, sectionMissing, specSummary };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.crmContract = api;

  /* ================================================================ browser + server */
  const pk = () => root.crmPacket;
  const eng = () => root.crmPacket.engine;

  const CONSENT = 'I agree to use electronic records and signatures for this Contract. My electronic initials and signature have the same effect as signing on paper. I can get a paper copy free, and withdraw this consent, by calling 832-910-7735.';
  const DISCLOSURE = [
    'You can get this contract on paper instead, at no charge. Ask your StormShield representative or call 832-910-7735.',
    'You can withdraw this consent any time before you finish signing. After that, ask us and we will give you paper copies.',
    'This consent covers only this Contract.',
    'To read and keep your copy you need a phone or computer with an up-to-date web browser that can open PDF files. You can download your signed copy at the end, and ask us to email or mail one.',
    'Let us know at 832-910-7735 if your phone number or email changes.'
  ];

  /* ---------------------------------------------------------------- PDF building */
  let _templateBytes = null;
  function setTemplateBytes(bytes) { _templateBytes = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer; }
  async function loadTemplate() {
    if (_templateBytes) return _templateBytes.slice(0);
    const resp = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('Could not load ' + TEMPLATE_URL + ' (HTTP ' + resp.status + ')');
    _templateBytes = await resp.arrayBuffer();
    return _templateBytes.slice(0);
  }

  // fields: contractFields(); sigs: { initials, homeowner, rep } — PNG data URLs
  async function buildPdf(fields, sigs, meta) {
    if (!root.PDFLib) throw new Error('PDF library not loaded yet');
    const { PDFDocument } = root.PDFLib;
    const pdf = await PDFDocument.load(await loadTemplate());
    const form = pdf.getForm();
    const f = fields || {};
    Object.keys(f).forEach(k => {
      if (f[k] === true) { try { form.getCheckBox(k).check(); } catch (e) { /* not a checkbox */ } }
      else if (typeof f[k] === 'string' && f[k]) { try { form.getTextField(k).setText(f[k]); } catch (e) { /* field missing */ } }
    });
    sigs = sigs || {};
    meta = meta || {};
    const day = meta.signedAt ? pk().fmtDate(meta.signedAt) : '';
    const setT = (k, val) => { if (!val) return; try { form.getTextField(k).setText(String(val)); } catch (e) {} };
    if (sigs.homeowner) setT('homeowner_date', day);
    if (sigs.rep) setT('rep_date', day);
    await eng().drawInk(pdf, [
      ['initials_supplements', sigs.initials, { center: true, extraH: 2 }],
      ['initials_terms', sigs.initials, { center: true, extraH: 2 }],
      ['sig_homeowner', sigs.homeowner, { extraH: 4 }],
      ['sig_rep', sigs.rep, { extraH: 4 }]
    ]);
    return pdf.save();
  }

  const SPOT_FIELDS = ['initials_supplements', 'initials_terms', 'sig_homeowner', 'homeowner_date', 'sig_rep', 'rep_date'];
  let _spots = null;
  async function templateSpots() {
    if (_spots) return _spots;
    const pdf = await root.PDFLib.PDFDocument.load(await loadTemplate());
    _spots = eng().pdfSpots(pdf, SPOT_FIELDS);
    return _spots;
  }

  function contractSigs(r, repSig) {
    return { initials: r.initials, homeowner: r.sig.homeowner, rep: r.sig.sspr || repSig || null };
  }

  // Finished signing session → final PDF (pages 1–2 + signature record page).
  // r: result of openSigningFlow; ctx: { signedAt, how, details, device, repName, repSig, repSignedAt }
  async function finalizeSigned(fields, r, ctx) {
    const P = pk();
    const signedAt = ctx.signedAt || new Date();
    const sigs = contractSigs(r, ctx.repSig || null);
    const signedBytes = await buildPdf(fields, sigs, { signedAt, homeownerName: r.homeownerName, repName: r.repName || ctx.repName });
    const hash = await P.sha256Hex(signedBytes);
    const signers = [{ role: 'Customer', name: r.homeownerName, at: P.fmtDateTime(r.at.homeowner) }];
    const repName = r.repName || ctx.repName || '';
    if (sigs.rep) signers.push({ role: 'StormShield representative', name: repName, at: P.fmtDateTime(r.at.sspr || ctx.repSignedAt || signedAt) });
    const finalBytes = await P.addAuditPage(signedBytes, {
      title: 'StormShield Pro Roofing — Contract',
      version: CONTRACT_VERSION + ' · Contract Confirmation (page 1) and Terms & Conditions (page 2)',
      property: [fields.street, fields.citystatezip].filter(Boolean).join(', '),
      signers, how: ctx.how, device: ctx.device || '', rep: repName,
      details: (r.reviewedAt ? ['Signed on the filled-in pages shown on screen; reviewed the completed, signed pages ' + P.fmtDateTime(r.reviewedAt) + ' before submitting'] : []).concat(ctx.details || []),
      consent: CONSENT, consentAt: P.fmtDateTime(r.consentAt), hash
    });
    return { finalBytes, hash, cancelBy: null, sigs };
  }

  // What the signing screens show for the contract.
  const CONTRACT_DOC = {
    key: 'contract', title: 'Contract', aria: 'Sign contract',
    heading: 'Your roofing contract is ready to sign',
    consent: CONSENT, disclosure: DISCLOSURE,
    pages: [
      { title: 'Contract Confirmation', caption: 'Page 1', reviewTitle: 'Page 1 · Contract', review: () => 'Initialed · signed' },
      { title: 'Terms & Conditions', caption: 'Page 2', reviewTitle: 'Page 2 · Terms', review: () => 'Initialed' }
    ],
    coowner: false, cancelDays: 0,
    fileName: 'StormShield Contract.pdf',
    build: buildPdf, sigs: contractSigs, spots: templateSpots,
    tasks: (st, remote) => {
      const t = [
        { id: 'supp', kind: 'initial', idx: 'supp', field: 'initials_supplements', what: 'paragraph' },
        { id: 'terms', kind: 'initial', idx: 'terms', field: 'initials_terms', what: 'page' },
        { id: 'sign', kind: 'sign', field: 'sig_homeowner' }
      ];
      if (!remote) t.push({ id: 'rep', kind: 'rep', field: 'sig_rep' });
      return t;
    },
    kicker: t => t.idx === 'supp' ? 'Initial · supplements (page 1)' : 'Initial · terms & conditions (page 2)',
    term: t => t.idx === 'supp'
      ? ['Supplements', 'Sometimes supplements are required to complete the work: re-deck, building permit, additional ventilation, ridge cap, overhead and profit, or additional material. By initialing you allow StormShield to supplement your insurance carrier for those funds, which are payable to StormShield.']
      : ['Terms & Conditions', 'I have read and understand the Terms & Conditions on page 2. They are part of this contract.'],
    signHeading: 'Sign the contract',
    signCopy: fields => 'You agree to the work order, specifications and payment schedule on page 1 and the Terms & Conditions on page 2'
      + (fields.rcv ? ' (replacement cost value <b>$' + eng().esc(fields.rcv) + '</b>)' : '') + '.',
    signButton: 'Sign the contract',
    autos: (st, today) => {
      const out = [];
      if (st.sig.homeowner) out.push(['homeowner_date', today]);
      if (st.sig.sspr) out.push(['rep_date', today]);
      return out;
    }
  };

  // Remote signing page (sign.html) entry point.
  function openSigningFlow(opts) { return pk().openSigningFlow(Object.assign({}, opts, { doc: CONTRACT_DOC })); }

  Object.assign(api, { buildPdf, templateSpots, finalizeSigned, openSigningFlow, setTemplateBytes, CONSENT, CONTRACT_DOC,
    fmtDate: (...a) => pk().fmtDate(...a), fmtDateTime: (...a) => pk().fmtDateTime(...a) });

  /* ================================================================ CRM side (needs a DOM) */
  if (typeof document === 'undefined') return;

  const E = eng();
  const { esc, say, save, rerender, me, jobById, ICON } = E;
  const formOpen = {};                  // job id -> is the form expanded

  const CONTRACT = {
    key: 'contract', label: 'Contract', noun: 'contract', longName: 'Contract', what: 'Contract Confirmation + Terms & Conditions',
    fileKind: 'signed_contract', filesProp: 'signedContractFiles', formOpen,
    files: j => { ensureContract(j); return j.signedContractFiles; },
    state: j => ensureContract(j).sign,
    fields: j => contractFields(ensureContract(j)),
    contact: j => { const c = ensureContract(j); return { name: c.customer || '', street: c.street || '', phone: c.cell || '', email: c.email || '' }; },
    missing: j => missingForSigning(ensureContract(j)),
    rememberContact: (j, phone, email) => { const c = ensureContract(j); if (phone && isBlank(c.cell)) c.cell = phone; if (email && isBlank(c.email)) c.email = email; },
    doc: CONTRACT_DOC, finalize: finalizeSigned, warm: () => loadTemplate().catch(() => {}),
    fileName: 'StormShield Contract (signed).pdf',
    signedFileName: (f, at) => `${E.cleanName(f.customer) || 'Homeowner'} - ${E.cleanName(f.street) || 'Property'} - Contract (signed) - ${E.fileDay(at)}.pdf`,
    linkSubject: 'Your StormShield roofing contract — please sign',
    linkMessage: (ct, repName, url) => {
      const first = String(ct.name || '').trim().split(/\s+/)[0] || 'there';
      return `Hi ${first}, this is ${repName || 'your rep'} with StormShield Pro Roofing. Please review and sign your roofing contract for ${ct.street || 'your property'} here (about 3 minutes): ${url}\nQuestions? Call 832-910-7735.`;
    },
    // ••• menu: certificate of completion, lifetime warranty, and scanning a paper copy with the camera
    extraMenu: (j, kind) => {
      const items = [];
      if (typeof root.ssScan === 'function') items.push(`<button type="button" role="menuitem" data-pkact="scan">${ICON.upload}<span>Scan signed paper copy</span></button>`);
      if (typeof root.printCertificateOfCompletion === 'function') items.push(`<button type="button" role="menuitem" data-pkact="cert-print">${ICON.cert}<span>Print Certificate of Completion</span></button>`);
      if (typeof root.emailCertificateOfCompletion === 'function') items.push(`<button type="button" role="menuitem" data-pkact="cert-email">${ICON.send}<span>Email Certificate of Completion</span></button>`);
      if (typeof root.printWarrantyCertificate === 'function') items.push(`<button type="button" role="menuitem" data-pkact="warranty-print">${ICON.cert}<span>Print Lifetime Warranty</span></button>`);
      if (typeof root.emailWarrantyCertificate === 'function') items.push(`<button type="button" role="menuitem" data-pkact="warranty-email">${ICON.send}<span>Email Lifetime Warranty</span></button>`);
      return items;
    },
    onAction: (j, a) => {
      if (a === 'scan') { root.ssScan('doc', files => CT.uploadPaper(j.id, files), { title: 'Scan signed contract' }); return true; }
      if (a === 'cert-print') { root.printCertificateOfCompletion(j.id); return true; }
      if (a === 'cert-email') { root.emailCertificateOfCompletion(j.id); return true; }
      if (a === 'warranty-print') { root.printWarrantyCertificate(j.id); return true; }
      if (a === 'warranty-email') { root.emailWarrantyCertificate(j.id); return true; }
      return false;
    }
  };
  const CT = E.makeSignable(CONTRACT);

  function injectStyles() {
    E.injectStyles();
    if (document.getElementById('ct-styles')) return;
    const st = document.createElement('style');
    st.id = 'ct-styles';
    st.textContent = `
.ct-sub{font-size:11px;font-weight:700;color:#8B94A7;letter-spacing:.04em;text-transform:uppercase;margin:12px 0 6px}
.ct-sub:first-child{margin-top:0}
.ct-chips{display:flex;flex-wrap:wrap;gap:6px}
.ct-chips .pk-chip{padding:6px 11px;font-size:12.5px;min-height:32px}
.ct-other{display:inline-flex;align-items:center;gap:6px}
.ct-other input{width:130px;background:#1E253A;border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);font-size:12.5px;font-family:inherit;min-height:32px}
.ct-other input:disabled{opacity:.7}
.ct-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.ct-addl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}
.ct-addl .pk-fld input{padding:7px 9px;font-size:13px}
.ct-pay .pk-fld input{text-align:right;font-variant-numeric:tabular-nums}
.ct-files{margin-top:4px}
@media (max-width:640px){.ct-two,.ct-addl{grid-template-columns:1fr}}
`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- Contract tab */
  function renderContractTab(j) {
    const panel = document.getElementById('dpBody');
    if (!panel || !j) return;
    injectStyles();
    const c = ensureContract(j);
    if (prefillFromJob(j).length) save();
    const p = c.sign;
    const signed = p.status === 'signed';
    const dis = signed ? 'disabled' : '';
    const v = k => esc(c[k] == null ? '' : c[k]);
    const qv = k => esc(c.qty[k] == null ? '' : c.qty[k]);
    const miss = sectionMissing(c);
    const badge = sec => signed ? '' : `<span class="pk-badge ${miss[sec].length ? 'need' : 'ok'}" data-ctbadge="${sec}">${miss[sec].length ? miss[sec].length + ' missing' : 'Done'}</span>`;
    const txt = (k, label, o) => { o = o || {}; return `<div class="pk-fld${o.full ? ' full' : ''}"><label for="ct-${k}">${label}</label><input id="ct-${k}" data-ct="${k}" value="${v(k)}" ${o.type ? 'type="' + o.type + '"' : ''} ${o.mode ? 'inputmode="' + o.mode + '"' : ''} ${o.ph && !signed ? 'placeholder="' + esc(o.ph) + '"' : ''} ${dis}></div>`; };
    const chip = x => `<button type="button" class="pk-chip${c.checks[x[0]] === true ? ' on' : ''}" data-ctc="${x[0]}" aria-pressed="${c.checks[x[0]] === true}" ${dis}>${esc(x[1])}</button>`;
    const chips = (keys, o) => `<div class="ct-chips" data-ctgroup="${o && o.group || ''}">${keys.map(x => x[2] && !x[3]
      ? `<span class="ct-other">${chip(x)}<input data-ctq="${x[2]}" value="${qv(x[2])}" placeholder="${esc(x[1] === 'Other' ? 'Describe' : 'Size')}" aria-label="${esc(x[1])} details" ${dis}></span>`
      : chip(x)).join('')}</div>`;
    const items = keys => keys.map(x => `<div class="pk-item"><label><input type="checkbox" data-ctcb="${x[0]}" ${c.checks[x[0]] === true ? 'checked' : ''} ${dis}>${esc(x[1])}</label>${x[2]
      ? `<input type="text" aria-label="${esc(x[1])} ${esc(x[3] || 'details')}" placeholder="${esc(x[3] || '')}" data-ctq="${x[2]}" value="${qv(x[2])}" ${dis}>` : ''}</div>`).join('');

    const formHtml = `
      <div class="pk-sec"><h4>Customer &amp; project${badge('customer')}</h4><div class="pk-grid pk-keep2">
        ${txt('customer', 'Customer', { full: true })}
        ${txt('street', 'Street address', { full: true })}
        ${txt('citystatezip', 'City, State, Zip')}${txt('cell', 'Cell #', { mode: 'tel' })}
        ${txt('email', 'Email', { mode: 'email' })}${txt('rep', 'Representative')}
        ${txt('contractDate', 'Contract date', { type: 'date' })}${txt('buildDate', 'Build date', { type: 'date' })}
      </div></div>

      <div class="pk-sec"><h4>Materials &amp; specifications${badge('specs')}</h4>
        <div class="ct-sub">Shingles — CertainTeed</div>${chips(GROUPS.shingles_certainteed)}
        <div class="ct-sub">Shingles — Tamko</div>${chips(GROUPS.shingles_tamko)}
        <div class="ct-sub">Color</div>${chips(GROUPS.colors)}
        <div class="ct-two">
          <div><div class="ct-sub">Start strip</div>${chips(GROUPS.start_strip)}</div>
          <div><div class="ct-sub">Underlayment</div>${chips(GROUPS.underlayment)}</div>
          <div><div class="ct-sub">Ridge</div>${chips(GROUPS.ridge)}</div>
          <div><div class="ct-sub">Valley</div>${chips(GROUPS.valley)}</div>
          <div><div class="ct-sub">Drip edge</div>${chips(GROUPS.drip_edge)}<div class="ct-sub" style="margin-top:8px">Drip edge color</div>${chips(GROUPS.drip_color)}</div>
          <div><div class="ct-sub">Decking</div>${chips(GROUPS.decking)}</div>
          <div><div class="ct-sub">Ventilation</div>${items(GROUPS.ventilation)}</div>
          <div><div class="ct-sub">Plumbing stacks</div>${items(GROUPS.plumbing)}</div>
        </div>
      </div>

      <div class="pk-sec"><h4>Additional items<span class="pk-badge opt">Optional</span></h4><div class="ct-addl">
        ${c.addl.map((val, i) => `<div class="pk-fld"><label for="ct-addl-${i}">${i + 1}.</label><input id="ct-addl-${i}" data-ctaddl="${i}" value="${esc(val)}" ${dis}></div>`).join('')}
      </div></div>

      <div class="pk-sec"><h4>Warranty</h4>${chips(GROUPS.warranty)}</div>

      <div class="pk-sec ct-pay"><h4>Payment schedule${badge('payment')}</h4><div class="pk-grid pk-keep2">
        ${txt('rcv', 'RCV total charge ($)', { mode: 'decimal' })}${txt('netClaim', 'Net claim amount due ($)', { mode: 'decimal' })}
        ${txt('deductible', 'Deductible amount due ($)', { mode: 'decimal' })}${txt('depreciation', 'Depreciation amount due ($)', { mode: 'decimal' })}
      </div><div style="margin-top:8px">${items(GROUPS.review)}</div></div>
      ${signed ? '' : '<p class="pk-note">Changes save automatically. The signed PDF shows exactly what was checked here.</p>'}`;

    // Older contract files uploaded under the previous Contract tab (job_files kind 'contract')
    const legacy = (Array.isArray(j.contracts) ? j.contracts : []).map((f, i) => {
      const ext = (String(f.name || '').match(/\.([a-z0-9]+)$/i) || [])[1] || (f.isPdf ? 'pdf' : 'file');
      return `<div class="pk-xf"><button type="button" class="pk-xf-main" data-ctlegacy="${i}"><span class="pk-xf-ico">${esc(ext.toUpperCase().slice(0, 4))}</span>
        <span class="pk-xf-t"><b>${esc(f.name || 'Contract file')}</b><small>${esc(['Other contract file', f.date].filter(Boolean).join(' · '))}</small></span></button>
        <button type="button" class="pk-xf-m" data-ctlegacydel="${i}" aria-label="Delete ${esc(f.name || 'file')}">${ICON.trash}</button></div>`;
    }).join('');

    const total = Object.values(miss).reduce((n, a) => n + a.length, 0);
    const isOpen = formOpen[j.id] !== undefined ? formOpen[j.id] : false;   // starts closed; tap the bar to open
    panel.__pkJob = j.id;
    panel.dataset.pkdoc = 'contract';
    const spec = specSummary(c);
    panel.innerHTML = CT.shellHtml(j, p, {
      formTitle: 'Fill out contract', lockedTitle: 'Contract details', open: isOpen, formHtml,
      badgeHtml: `<span class="pk-badge ${total ? 'need' : 'ok'}" data-cttotal>${total ? total + ' missing' : (spec ? esc(spec) : 'All filled')}</span>`,
      afterHtml: legacy ? `<div class="ct-files">${legacy}</div>` : ''
    });
    CT.wirePanel(panel);
    CT.renderLinks(j).catch(e => console.warn('[contract] links', e));
    panel.querySelectorAll('[data-ctlegacy]').forEach(b => b.addEventListener('click', () => { if (typeof root.previewJobFile === 'function') root.previewJobFile('contracts', +b.dataset.ctlegacy); }));
    panel.querySelectorAll('[data-ctlegacydel]').forEach(b => b.addEventListener('click', () => { if (typeof root.contractFileDelete === 'function') root.contractFileDelete(j.id, +b.dataset.ctlegacydel); }));
    if (signed) return;

    const persist = () => { c.updatedAt = new Date().toISOString(); save(); refreshMissing(); };
    const refreshMissing = () => {
      const m = sectionMissing(c), all = [].concat(...Object.values(m));
      Object.keys(m).forEach(sec => { const b = panel.querySelector(`[data-ctbadge="${sec}"]`); if (b) { b.className = 'pk-badge ' + (m[sec].length ? 'need' : 'ok'); b.textContent = m[sec].length ? m[sec].length + ' missing' : 'Done'; } });
      const t = panel.querySelector('[data-cttotal]');
      if (t) { const s = specSummary(c); t.className = 'pk-badge ' + (all.length ? 'need' : 'ok'); t.textContent = all.length ? all.length + ' missing' : (s || 'All filled'); }
      panel.querySelectorAll('[data-ct]').forEach(el => el.classList.toggle('miss', all.indexOf(el.dataset.ct) >= 0));
      panel.querySelectorAll('[data-ctq]').forEach(el => el.classList.toggle('miss', all.indexOf(el.dataset.ctq) >= 0));
    };
    refreshMissing();
    panel.querySelectorAll('[data-ct]').forEach(el => el.addEventListener('input', () => { c[el.dataset.ct] = el.value; persist(); }));
    panel.querySelectorAll('[data-ctq]').forEach(el => el.addEventListener('input', () => {
      c.qty[el.dataset.ctq] = el.value;
      // typing in an "Other" / qty box ticks its checkbox
      if (el.value.trim()) {
        const owner = [].concat(...Object.values(GROUPS)).find(x => x[2] === el.dataset.ctq);
        if (owner && c.checks[owner[0]] !== true) {
          c.checks[owner[0]] = true;
          const chipEl = panel.querySelector(`[data-ctc="${owner[0]}"]`); if (chipEl) { chipEl.classList.add('on'); chipEl.setAttribute('aria-pressed', 'true'); }
          const cb = panel.querySelector(`[data-ctcb="${owner[0]}"]`); if (cb) cb.checked = true;
        }
      }
      persist();
    }));
    panel.querySelectorAll('[data-ctaddl]').forEach(el => el.addEventListener('input', () => { c.addl[+el.dataset.ctaddl] = el.value; persist(); }));
    panel.querySelectorAll('[data-ctcb]').forEach(el => el.addEventListener('change', () => { c.checks[el.dataset.ctcb] = el.checked; persist(); }));
    panel.querySelectorAll('[data-ctc]').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.ctc;
      c.checks[k] = !(c.checks[k] === true);
      el.classList.toggle('on', c.checks[k]); el.setAttribute('aria-pressed', String(c.checks[k]));
      // picking a Tamko / CertainTeed product also ticks the brand box on the form
      const brand = /^shingles_certainteed_(?!1$)/.test(k) ? 'shingles_certainteed_1' : /^shingles_tamko_(?!1$)/.test(k) ? 'shingles_tamko_1' : null;
      if (brand && c.checks[k] && c.checks[brand] !== true) { c.checks[brand] = true; const b = panel.querySelector(`[data-ctc="${brand}"]`); if (b) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); } }
      persist();
    }));
  }

  Object.assign(api, { renderContractTab, startSigning: CT.startSigning, preview: CT.preview, uploadPaper: CT.uploadPaper, deleteFile: CT.deleteFile,
    startOver: CT.startOver, sendForSignature: CT.sendForSignature, resendLink: CT.resendLink, voidLink: CT.voidLink, renderLinks: CT.renderLinks });
})(typeof window !== 'undefined' ? window : globalThis);
