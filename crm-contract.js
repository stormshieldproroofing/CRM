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

  /* ---- reading a scanned paper contract ---- */
  // The four payment amounts, off the text read from a scan (OCR). → numbers, or null
  // where one wasn't found: { rcv, netClaim, deductible, depreciation }.
  // The text comes in three shapes, and all three are handled:
  //   label and amount on one line      "Deductible amount due $2,500.00"
  //   two labels across one line        "RCV total charge $18,400 Net claim amount due $12,900"
  //   labels first, amounts after       "RCV total charge" / "Net claim amount due" / "$18,400" / "$12,900"
  const AMOUNT_LABELS = [
    ['rcv', /\brcv\b|replacement\s+cost/i],
    ['netClaim', /net\s+claim/i],
    ['deductible', /deductible/i],
    ['depreciation', /depreciation/i],
  ];
  const MONEY_RE = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;
  function moneyIn(s) {
    const m = MONEY_RE.exec(String(s || ''));
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ''));
    return isFinite(v) && v > 0 ? v : null;
  }
  function parseContractAmounts(text) {
    const out = { rcv: null, netClaim: null, deductible: null, depreciation: null };
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let waiting = [], idle = 0;   // labels still waiting for their amount, in order
    const set = (k, v) => { if (out[k] == null && v != null) out[k] = v; };
    lines.forEach(line => {
      const hits = [];
      AMOUNT_LABELS.forEach(([k, re]) => {
        const m = re.exec(line);
        if (m && !(k === 'depreciation' && /non-?\s*recoverable/i.test(line))) hits.push({ k, at: m.index, end: m.index + m[0].length });
      });
      hits.sort((a, b) => a.at - b.at);
      if (hits.length) {
        let any = false;
        const late = [];
        hits.forEach((h, i) => {
          const v = moneyIn(line.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : line.length));
          if (v != null) { set(h.k, v); any = true; } else late.push(h.k);
        });
        // A long line with a label word and no amount is a sentence from the terms, not the form.
        if (any || line.length <= 60) { late.forEach(k => { if (out[k] == null && waiting.indexOf(k) < 0) waiting.push(k); }); idle = 0; }
        return;
      }
      if (waiting.length && /^\$?\s*[\d,]+(?:\.\d{1,2})?$/.test(line)) { set(waiting.shift(), moneyIn(line)); idle = 0; return; }
      if (++idle > 2) waiting = [];
    });
    // An amount bigger than the whole job was misread.
    if (out.rcv != null) ['netClaim', 'deductible', 'depreciation'].forEach(k => { if (out[k] != null && out[k] > out.rcv) out[k] = null; });
    return out;
  }
  // 18400 → "18400", 2500.5 → "2500.50" (how the job's money boxes hold a number)
  const amountText = v => v == null ? '' : (v % 1 ? v.toFixed(2) : String(v));

  const api = { parseContractAmounts, amountText, TEMPLATE_URL, CONTRACT_VERSION, TEXT_FIELDS, DATE_FIELDS, QTY_KEYS, GROUPS, CHECK_KEYS, DEFAULT_ADDL,
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
    beforeUpload: (j, files) => { readPaper(j, files); },
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

  /* ---- a paper contract was scanned or uploaded: read its amounts into the contract price ---- */
  // The job's Contract Summary breaks the contract price into three parts that add up to
  // it (the same three the "Contract Price" editor in the job saves). A scanned contract
  // fills those, and the Contract tab's amounts — never the Insurance section, which is
  // the carrier's numbers, not the contract's.
  //   contract amount → the job's breakdown box for it
  const READ_ROWS = [
    ['netClaim', 'cpNetClaim', 'Net claim'],
    ['deductible', 'cpDeductible', 'Deductible'],
    ['depreciation', 'cpDepreciation', 'Depreciation'],
  ];
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; };
  const usd = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

  // One page at a time as a small JPEG — big enough for Vision to read handwriting,
  // small enough to send over a phone connection in a second or two. (The first version
  // waited for the upload, downloaded the file again and sent up to six full-size pages.)
  const OCR_SIDE = 1800, OCR_PAGES = 4;
  const jpegOf = cv => new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82));
  async function smallImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
      const k = Math.min(1, OCR_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && blob.size < 700000) return blob;
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return (await jpegOf(cv)) || blob;
    } finally { URL.revokeObjectURL(url); }
  }
  // src: a File straight from the scanner / file picker, or a saved file record ({ url, name }).
  async function* pagesOf(src) {
    let blob = src instanceof Blob ? src : (src && src._file instanceof Blob ? src._file : null);
    if (!blob && src && src.url) blob = await (await fetch(src.url)).blob();
    if (!blob) return;
    const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test((src && src.name) || '');
    if (!isPdf) { yield await smallImage(blob); return; }
    if (typeof root.pdfjsLib === 'undefined') return;
    const pdf = await root.pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    for (let p = 1; p <= Math.min(pdf.numPages, OCR_PAGES); p++) {
      const page = await pdf.getPage(p);
      const one = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: OCR_SIDE / Math.max(one.width, one.height) });
      const cv = document.createElement('canvas');
      cv.width = Math.round(viewport.width); cv.height = Math.round(viewport.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport }).promise;
      const b = await jpegOf(cv);
      if (b) yield b;
    }
  }
  // Read pages until the three breakdown amounts are found — the payment schedule is on
  // page 1, so that is normally one page and one request.
  async function readAmounts(sources) {
    const out = { rcv: null, netClaim: null, deductible: null, depreciation: null };
    const done = () => READ_ROWS.every(r => out[r[0]] != null);
    for (const src of sources) {
      try {
        for await (const pg of pagesOf(src)) {
          let text = '';
          try { text = await root.ocrLossFile({ _file: pg, name: 'page.jpg' }); } catch (e) { console.warn('[contract] page read failed', e); }
          const got = parseContractAmounts(text);
          Object.keys(out).forEach(k => { if (out[k] == null && got[k] != null) out[k] = got[k]; });
          if (done()) return out;
        }
      } catch (e) { console.warn('[contract] read failed', src && src.name, e); }
    }
    return out;
  }

  // Called the moment a paper contract is scanned or picked — before the upload, so the
  // reading runs alongside it and the sheet is on screen straight away.
  function readPaper(j, sources) {
    sources = Array.from(sources || []).filter(Boolean);
    if (!j || !sources.length || typeof root.ocrLossFile !== 'function') return;
    openReadSheet(j, readAmounts(sources));
  }

  // The job as the CRM holds it right now. The sheet stays open a while; meanwhile a sync
  // (the upload itself sets one off, and so does coming back from the camera) reloads
  // every job as a new object. Anything saved to the object we started with would then
  // be lost, so always look the job up again.
  const liveJob = j => (j && j.id != null && jobById(j.id)) || j;

  // What the job's contract price breakdown holds now. A job with a contract price but no
  // breakdown yet counts the whole price as net claim — the same way the job's editor opens.
  function breakdownNow(j) {
    const has = j.cpNetClaim != null || j.cpDeductible != null || j.cpDepreciation != null;
    return {
      has,
      netClaim: has ? (num(j.cpNetClaim) || 0) : (num(j.potVal) || 0),
      deductible: has ? (num(j.cpDeductible) || 0) : 0,
      depreciation: has ? (num(j.cpDepreciation) || 0) : 0,
    };
  }

  // Write the confirmed amounts onto the job, the way its own Contract Price editor saves
  // them (three parts and their total), plus the Contract tab's amounts.
  function applyAmounts(j, v) {
    READ_ROWS.forEach(([k, field]) => { j[field] = v[k].toFixed(2); });
    j.potVal = v.total.toFixed(2);
    const c = ensureContract(j);
    READ_ROWS.forEach(([k]) => { c[k] = amountText(v[k]); });
    c.rcv = amountText(v.total);              // the contract's RCV is the total charge
  }
  const hasAmounts = (j, v) => !!j && j.potVal === v.total.toFixed(2) && READ_ROWS.every(([k, field]) => j[field] === v[k].toFixed(2));
  const redraw = () => {
    rerender();
    if (typeof root.renderBoard === 'function') { try { root.renderBoard(); } catch (e) {} }
    if (typeof root.renderJobsPage === 'function') { try { const pg = document.getElementById('jobsPage'); if (pg && pg.style.display !== 'none') root.renderJobsPage(); } catch (e) {} }
  };
  // Save now (not on the usual short delay) so a sync landing in between can't put the old
  // price back; then check twice that the job still has the amounts, and put them back if
  // a reload that started before the save replaced the job.
  async function saveAmounts(j, v) {
    const push = async () => { if (typeof root.flushSaveNow === 'function') { try { await root.flushSaveNow(); return; } catch (e) { console.warn('[contract] save now failed', e); } } save(); };
    await push();
    for (const wait of [1500, 4000]) {
      await new Promise(r => setTimeout(r, wait));
      const now = liveJob(j);
      if (hasAmounts(now, v)) continue;
      applyAmounts(now, v); redraw();
      await push();
    }
  }

  // The amounts off the contract, for the rep to check against the paper before anything
  // is saved. Opens at once, showing "Reading…", and fills in when `reading` resolves.
  function openReadSheet(j, reading) {
    injectStyles();
    const old = document.getElementById('ctRead'); if (old) old.remove();
    j = liveJob(j);
    const now = breakdownNow(j), priceNow = num(j.potVal) || 0;
    let got = null;                        // null while reading
    const bg = document.createElement('div');
    bg.id = 'ctRead';
    bg.innerHTML = `<div class="ct-rd" role="dialog" aria-modal="true" aria-labelledby="ctReadT">
      <div class="ct-rd-h"><b id="ctReadT">Contract price</b><button type="button" class="ct-rd-x" data-rd="skip" aria-label="Close">${ICON && ICON.x ? ICON.x : '&times;'}</button></div>
      <p class="ct-rd-p" data-rdmsg aria-live="polite"><span class="ct-rd-spin" aria-hidden="true"></span>Reading the amounts off the contract…</p>
      <div class="ct-rd-g three">${READ_ROWS.map(([k, , label]) => `<div class="ct-rd-f"><label for="ctRead_${k}">${label} ($)</label>
          <input id="ctRead_${k}" data-rdk="${k}" type="text" inputmode="decimal" autocomplete="off" value="">
          <small data-rdnote="${k}"></small></div>`).join('')}</div>
      <div class="ct-rd-tot"><span>Contract price</span><b data-rdtot></b></div>
      <small class="ct-rd-chk" data-rdchk></small>
      <div class="ct-rd-b"><button type="button" class="ct-rd-skip" data-rd="skip">Skip</button><button type="button" class="ct-rd-ok" data-rd="ok" disabled>Fill in</button></div>
    </div>`;
    const box = k => bg.querySelector(`[data-rdk="${k}"]`);
    // A box left blank keeps what the breakdown has now.
    const values = () => {
      const out = {};
      READ_ROWS.forEach(([k]) => { const v = num(box(k).value); out[k] = v != null && v >= 0 ? v : now[k]; });
      out.total = +(out.netClaim + out.deductible + out.depreciation).toFixed(2);
      return out;
    };
    const recalc = () => {
      const v = values();
      bg.querySelector('[data-rdtot]').textContent = usd(v.total);
      const chk = bg.querySelector('[data-rdchk]');
      const rcv = got && got.rcv;
      // The contract's RCV is the total charge: it should equal the three parts added up.
      const off = rcv != null && Math.abs(rcv - v.total) > 0.004;
      chk.className = 'ct-rd-chk' + (off ? ' diff' : '');
      chk.textContent = off ? 'The contract’s RCV reads ' + usd(rcv) + ', but these add up to ' + usd(v.total) + '. Check the numbers.'
        : rcv != null ? 'Matches the RCV on the contract (' + usd(rcv) + ').'
        : priceNow > 0 && Math.abs(priceNow - v.total) > 0.004 ? 'The job’s contract price is ' + usd(priceNow) + ' now.' : '';
    };
    bg.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.rdk) e.target.dataset.typed = '1'; recalc(); });
    recalc();
    let open = true;
    const close = () => { open = false; bg.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    Promise.resolve(reading).catch(() => null).then(res => {
      if (!open) return;
      got = res || { rcv: null, netClaim: null, deductible: null, depreciation: null };
      const found = READ_ROWS.some(r => got[r[0]] != null);
      READ_ROWS.forEach(([k]) => {
        const el = box(k), v = got[k], has = now.has ? now[k] : 0;
        if (v != null && !el.dataset.typed) el.value = amountText(v);    // never over something the rep typed while waiting
        const note = bg.querySelector(`[data-rdnote="${k}"]`);
        const diff = v != null && has > 0 && Math.abs(has - v) > 0.004;
        note.className = diff ? 'diff' : '';
        note.textContent = v == null ? (found ? 'Not found — type it in, or leave blank' : '') : diff ? 'Breakdown has ' + usd(has) + ' now' : '';
      });
      bg.querySelector('[data-rdmsg]').textContent = found
        ? 'Check these against the paper and fix any that are off. They fill the job’s contract price and the Contract tab; Insurance is not changed.'
        : 'Couldn’t read the amounts on this one. Type them in, or tap Skip.';
      bg.querySelector('[data-rd="ok"]').disabled = false;
      recalc();
    });

    bg.addEventListener('click', e => {
      const b = e.target.closest('[data-rd]');
      if (!b || b.disabled) return;
      if (b.dataset.rd === 'skip') { close(); return; }
      const v = values();
      close();
      j = liveJob(j);
      applyAmounts(j, v);
      if (typeof root.logActivity === 'function') root.logActivity(j, 'file', 'Contract price filled in from the contract',
        READ_ROWS.map(([k, , label]) => label + ' ' + usd(v[k])).join(' · ') + ' · Total ' + usd(v.total));
      redraw();
      say('Contract price filled in · ' + usd(v.total));
      saveAmounts(j, v);
    });
    document.body.appendChild(bg);
    // Focus the sheet, not a box: a focused box would pop the phone keyboard over the amounts.
    const sheet = bg.querySelector('.ct-rd'); sheet.tabIndex = -1; setTimeout(() => sheet.focus({ preventScroll: true }), 50);
  }

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
#ctRead{position:fixed;inset:0;z-index:100000;background:rgba(5,7,11,.72);display:flex;align-items:flex-end;justify-content:center;font-family:Inter,system-ui,sans-serif}
#ctRead .ct-rd{width:100%;max-width:460px;max-height:100%;overflow:auto;box-sizing:border-box;background:#0E1219;color:#E8ECF3;border:1px solid #252B38;border-radius:16px 16px 0 0;padding:14px 16px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px}
#ctRead .ct-rd:focus{outline:none}
#ctRead .ct-rd-h{display:flex;align-items:center;justify-content:space-between;gap:10px}
#ctRead .ct-rd-h b{font-size:17px;font-weight:700}
#ctRead .ct-rd-x{width:44px;height:44px;border-radius:22px;border:0;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
#ctRead .ct-rd-p{font-size:13px;line-height:1.45;color:#A9B1C1;margin:0}
#ctRead .ct-rd-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#ctRead .ct-rd-f{display:flex;flex-direction:column;gap:4px;min-width:0}
#ctRead .ct-rd-f label{font-size:12px;font-weight:600;color:#C4CBD8}
#ctRead .ct-rd-f input{background:#161B24;border:1px solid #33405A;border-radius:10px;padding:11px 12px;color:#fff;font:600 16px Inter,system-ui,sans-serif;text-align:right;font-variant-numeric:tabular-nums;min-width:0;width:100%;box-sizing:border-box}
#ctRead .ct-rd-f input:focus-visible{outline:2px solid #5B93FF;outline-offset:1px}
#ctRead .ct-rd-f small{font-size:12px;line-height:1.35;color:#8B94A7;min-height:16px}
#ctRead .ct-rd-f small.diff{color:#FCD34D}
#ctRead .ct-rd-g.three{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
#ctRead .ct-rd-g.three input{padding:11px 8px;font-size:15px}
#ctRead .ct-rd-tot{display:flex;justify-content:space-between;align-items:center;background:#161B24;border:1px solid #2B3345;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600;color:#C4CBD8}
#ctRead .ct-rd-tot b{font-size:17px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
#ctRead .ct-rd-chk{font-size:12px;line-height:1.4;color:#8B94A7;min-height:17px}
#ctRead .ct-rd-chk.diff{color:#FCD34D}
#ctRead .ct-rd-spin{display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:-2px;border:2px solid #33405A;border-top-color:#8FB4FF;border-radius:50%;animation:ctRdSpin .8s linear infinite}
@keyframes ctRdSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#ctRead .ct-rd-spin{animation-duration:2.4s}}
#ctRead .ct-rd-b{display:flex;gap:12px}
#ctRead .ct-rd-b button{flex:1;min-height:50px;border-radius:12px;font:700 15px Inter,system-ui,sans-serif;cursor:pointer}
#ctRead .ct-rd-skip{background:#1A1F29;color:#E8ECF3;border:1px solid #252B38}
#ctRead .ct-rd-ok{flex:2 !important;background:#2F6FEB;color:#fff;border:0}
#ctRead .ct-rd-ok:disabled{opacity:.5;cursor:default}
@media (min-width:761px){#ctRead{align-items:center}#ctRead .ct-rd{border-radius:16px}}
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

  Object.assign(api, { readPaper, renderContractTab, startSigning: CT.startSigning, preview: CT.preview, uploadPaper: CT.uploadPaper, deleteFile: CT.deleteFile,
    startOver: CT.startOver, sendForSignature: CT.sendForSignature, resendLink: CT.resendLink, voidLink: CT.voidLink, renderLinks: CT.renderLinks });
})(typeof window !== 'undefined' ? window : globalThis);
