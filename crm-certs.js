/* ============================================================
   StormShield CRM — license-style certificates
   ------------------------------------------------------------
   Builds the printable Lifetime Workmanship Warranty and the
   Certificate of Completion. Both share one framed "board
   license" look: cream paper, engraved border, StormShield logo,
   gold seal, and the authorized signature.

   Pure functions only: index.html gathers the job data, opens the
   print window, and writes the HTML these functions return.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmCerts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INK = '#0B2149';
  const GOLD = '#A8843A';
  const PAPER = '#FBF8F1';
  const MUTED = '#6B6B6B';
  const TEXT = '#2A2A2A';
  const COMPANY = 'StormShield Pro Roofing';
  const TRANSFER_FEE = 500;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isISO(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

  function fmtDate(iso) {
    if (!isISO(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // "10011 Clarkbrook Dr, Houston, TX, 77089" → "10011 Clarkbrook Dr, Houston, TX 77089"
  function cleanAddress(addr) {
    const a = String(addr || '').trim();
    if (!a || a === '—') return '';
    return a.replace(/,\s*([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)\s*$/, ', $1 $2');
  }

  // Warranty certificate number: SSPR-<install year>-<house number>,
  // falling back to the last digits of the job id.
  function warrantyDefaultNo(job, installISO, todayISO) {
    const year = (isISO(installISO) ? installISO : (todayISO || '')).slice(0, 4) || String(new Date().getFullYear());
    const house = (cleanAddress(job && job.address).match(/^\s*(\d+)/) || [])[1];
    const digits = String((job && job.id) || '').replace(/[^0-9]/g, '');
    const tail = house || digits.slice(-4) || '0000';
    return 'SSPR-' + year + '-' + tail;
  }

  // Everything the warranty certificate prints. `job.warranty` holds the
  // choices saved from the options panel so reprints match.
  function warrantyData(job, todayISO) {
    const j = job || {};
    const c = j.contract || {};
    const s = j.warranty || {};
    const installISO = isISO(s.installDate) ? s.installDate : (isISO(j.buildDate) ? j.buildDate : '');
    const issuedISO = isISO(s.issuedDate) ? s.issuedDate : installISO;
    return {
      owner: s.owner != null ? s.owner : (j.name || c.customer || ''),
      addr: s.addr != null ? s.addr : cleanAddress((j.address && j.address !== '—') ? j.address : (c.address || '')),
      installISO,
      installDate: fmtDate(installISO),
      issuedISO,
      issuedDate: fmtDate(issuedISO),
      certNo: s.certNo || warrantyDefaultNo(j, installISO, todayISO),
      signed: s.signed !== false,
    };
  }

  // ── Shared pieces ──────────────────────────────────────────────
  const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Pinyon+Script&family=Cinzel:wght@500;600;700&display=swap" rel="stylesheet">';

  const BASE_CSS = `
    @page{size:letter;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:'Cormorant Garamond',Georgia,serif;color:${INK};font-variant-numeric:lining-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pg{width:816px;height:1056px;position:relative;background:${PAPER};overflow:hidden;page-break-after:always;break-after:page}
    .pg:last-child{page-break-after:auto;break-after:auto}
    .frame{position:absolute;left:0;top:0}
    .wm{position:absolute;left:168px;top:330px;width:480px;opacity:.05;filter:grayscale(1)}
    .content{position:absolute;left:76px;top:64px;right:76px;bottom:70px;display:flex;flex-direction:column;align-items:center;text-align:center}
    .logo{width:118px;height:auto;display:block}
    .tag{margin-top:6px;font-style:italic;font-size:14px;letter-spacing:.06em;color:#5A4A2A}
    .rule{display:flex;align-items:center;gap:10px;margin-top:12px}
    .rule i{display:block;width:150px;height:1px;background:${GOLD}}
    .rule b{display:block;width:6px;height:6px;background:${GOLD};transform:rotate(45deg)}
    .pre{margin-top:12px;font-family:Cinzel,Georgia,serif;font-weight:500;font-size:15px;letter-spacing:.42em;color:#5A4A2A}
    h1{margin:6px 0 0;font-family:Cinzel,Georgia,serif;font-weight:600;font-size:32px;letter-spacing:.08em;line-height:1.08;color:${INK}}
    .script{font-family:'Pinyon Script',cursive;font-size:30px;line-height:1;color:${INK}}
    .say{font-size:15px;font-style:italic;color:#3A3A3A}
    .fill{display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid ${INK};color:${INK};font-variant-numeric:lining-nums}
    .lbl{margin-top:4px;font-family:Cinzel,Georgia,serif;font-size:9.5px;letter-spacing:.22em;color:${MUTED};text-transform:uppercase}
    .body{font-size:15px;line-height:1.45;color:${TEXT}}
    .cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:36px;width:100%;text-align:left}
    .cols h2,.sec{margin:0;font-family:Cinzel,Georgia,serif;font-weight:700;font-size:11.5px;letter-spacing:.2em;color:${INK};text-align:center;text-transform:uppercase}
    .cols p{margin:5px 0 0;font-size:12.5px;line-height:1.45;color:${TEXT};text-align:justify}
    .sigrow{display:grid;grid-template-columns:minmax(0,1fr) 124px minmax(0,1fr);gap:20px;align-items:end;width:100%}
    .sigcol{display:flex;flex-direction:column;gap:3px}
    .sigline{display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid ${INK};height:58px;font-size:16px;font-weight:600;line-height:1.2;font-variant-numeric:lining-nums;color:${INK}}
    .sigline img{height:64px;width:auto;display:block;margin-bottom:-24px}
    .signame{margin-top:8px;font-size:13px;font-weight:600;color:${INK};min-height:16px}
    .seal{display:flex;justify-content:center}
    .fine{margin-top:auto;width:100%;border-top:1px solid ${GOLD};padding-top:8px;text-align:left}
    .fine .sec{font-size:9px;letter-spacing:.22em;margin-bottom:4px}
    .fine p{margin:0;font-size:10px;line-height:1.35;color:#3A3A3A;text-align:justify;font-variant-numeric:lining-nums}
    .contact{margin-top:7px;font-family:Cinzel,Georgia,serif;font-size:9px;letter-spacing:.16em;color:#5A4A2A;text-align:center;font-variant-numeric:lining-nums;text-transform:uppercase}
    .btn{position:fixed;top:12px;right:12px;background:${INK};color:#fff;border:none;padding:10px 18px;border-radius:6px;font:600 13px -apple-system,Segoe UI,Arial,sans-serif;cursor:pointer;z-index:10}
    @media print{.btn{display:none}}
    @media screen{body{background:#e9edf2}.pg{margin:14px auto;box-shadow:0 2px 12px rgba(0,0,0,.15)}}
  `;

  const CORNER = 'L36 30 L43 33 L36 36 L33 43 L30 36 L23 33 L30 30 Z';
  function star(cx, cy) {
    // Re-anchor the 4-point star (drawn around 33,33) on (cx,cy).
    return `<path transform="translate(${cx - 33} ${cy - 33})" d="M33 23 ${CORNER}"></path>`;
  }

  // Engraved border: patterned band, double rule, gold inner line, corner stars.
  function frameSvg() {
    return `<svg class="frame" width="816" height="1056" viewBox="0 0 816 1056" aria-hidden="true">
      <defs>
        <pattern id="guilA" width="18" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 6 Q4.5 0 9 6 T18 6" fill="none" stroke="${INK}" stroke-width="0.7"></path>
          <path d="M0 6 Q4.5 12 9 6 T18 6" fill="none" stroke="${INK}" stroke-width="0.7"></path>
          <path d="M0 3 Q4.5 9 9 3 T18 3" fill="none" stroke="${GOLD}" stroke-width="0.5"></path>
          <path d="M0 9 Q4.5 3 9 9 T18 9" fill="none" stroke="${GOLD}" stroke-width="0.5"></path>
        </pattern>
        <pattern id="guilB" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="4" fill="none" stroke="${INK}" stroke-width="0.4"></circle>
          <circle cx="0" cy="0" r="4" fill="none" stroke="${INK}" stroke-width="0.4"></circle>
          <circle cx="10" cy="10" r="4" fill="none" stroke="${INK}" stroke-width="0.4"></circle>
        </pattern>
      </defs>
      <rect x="22" y="22" width="772" height="1012" fill="url(#guilA)"></rect>
      <rect x="44" y="44" width="728" height="968" fill="${PAPER}"></rect>
      <rect x="22" y="22" width="772" height="1012" fill="none" stroke="${INK}" stroke-width="2.5"></rect>
      <rect x="44" y="44" width="728" height="968" fill="none" stroke="${INK}" stroke-width="1.2"></rect>
      <rect x="52" y="52" width="712" height="952" fill="none" stroke="${GOLD}" stroke-width="0.8"></rect>
      <g fill="${PAPER}" stroke="${INK}" stroke-width="1.2">
        <circle cx="33" cy="33" r="15"></circle><circle cx="783" cy="33" r="15"></circle>
        <circle cx="33" cy="1023" r="15"></circle><circle cx="783" cy="1023" r="15"></circle>
      </g>
      <g fill="${GOLD}">${star(33, 33)}${star(783, 33)}${star(33, 1023)}${star(783, 1023)}</g>
      <rect x="60" y="60" width="696" height="936" fill="url(#guilB)" opacity="0.05"></rect>
    </svg>`;
  }

  // Gold ribbon seal with the logo in the middle and two arc captions.
  function sealSvg(top, bottom, logoUrl, id) {
    const t = 'sealT' + id, b = 'sealB' + id;
    return `<svg width="112" height="120" viewBox="0 0 140 150" role="img" aria-label="${esc(top)} — ${esc(bottom)} seal">
      <path d="M48 98 L36 146 L52 136 L60 148 L68 104 Z" fill="${INK}"></path>
      <path d="M92 98 L104 146 L88 136 L80 148 L72 104 Z" fill="${INK}"></path>
      <circle cx="70" cy="66" r="60" fill="none" stroke="${GOLD}" stroke-width="9" stroke-dasharray="3.2 2.1"></circle>
      <circle cx="70" cy="66" r="56" fill="${GOLD}"></circle>
      <circle cx="70" cy="66" r="51" fill="none" stroke="#FBF3DC" stroke-width="1"></circle>
      <circle cx="70" cy="66" r="33" fill="none" stroke="#FBF3DC" stroke-width="1"></circle>
      <defs>
        <path id="${t}" d="M28 66 A42 42 0 0 1 112 66"></path>
        <path id="${b}" d="M24 66 A46 46 0 0 0 116 66"></path>
      </defs>
      <text font-family="Cinzel, Georgia, serif" font-size="8.5" font-weight="700" letter-spacing="0.9" fill="#FBF3DC"><textPath href="#${t}" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
      <text font-family="Cinzel, Georgia, serif" font-size="8.5" font-weight="700" letter-spacing="0.9" fill="#FBF3DC"><textPath href="#${b}" startOffset="50%" text-anchor="middle">${esc(bottom)}</textPath></text>
      <circle cx="70" cy="66" r="30" fill="${PAPER}"></circle>
      ${logoUrl ? `<image href="${esc(logoUrl)}" x="46" y="43" width="48" height="45"></image>` : ''}
    </svg>`;
  }

  function header(logoUrl, tagline) {
    return `${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="${COMPANY}">` : `<div style="font-family:Cinzel,serif;font-weight:700;font-size:19px;letter-spacing:.26em">STORMSHIELD PRO ROOFING</div>`}
      <div class="tag">${esc(tagline)}</div>
      <div class="rule"><i></i><b></b><i></i></div>`;
  }

  function signatureRow(o) {
    // o: { signed, signatureUrl, signerName, dateText, sealTop, sealBottom, logoUrl, sealId }
    const sigLine = (o.signed && o.signatureUrl)
      ? `<div class="sigline"><img src="${esc(o.signatureUrl)}" alt="Signature"></div>`
      : '<div class="sigline"></div>';
    return `<div class="sigrow">
      <div class="sigcol">
        ${sigLine}
        <div class="signame">${o.signed ? esc(o.signerName || '') : ''}</div>
        <div class="lbl" style="margin-top:0">Authorized Representative</div>
      </div>
      <div class="seal">${sealSvg(o.sealTop, o.sealBottom, o.logoUrl, o.sealId)}</div>
      <div class="sigcol">
        <div class="sigline">${esc(o.dateText || '')}</div>
        <div class="signame" aria-hidden="true"></div>
        <div class="lbl" style="margin-top:0">${esc(o.dateLabel || 'Date')}</div>
      </div>
    </div>`;
  }

  function contactLine(ci) {
    const c = ci || {};
    const parts = [
      [c.address, c.cityStateZip].filter(Boolean).join(', '),
      c.phone,
      String(c.website || 'stormshieldproroofing.com').replace(/^https?:\/\//, '').replace(/^www\./, ''),
    ].filter(Boolean).map(esc);
    if (c.license) parts.push('Lic. ' + esc(c.license));
    return `<div class="contact">${parts.join(' &nbsp;·&nbsp; ')}</div>`;
  }

  function page(inner, logoUrl) {
    return `<div class="pg">${frameSvg()}${logoUrl ? `<img class="wm" src="${esc(logoUrl)}" alt="" aria-hidden="true">` : ''}<div class="content">${inner}</div></div>`;
  }

  // Long notes or scope text: step the small print down until the page fits,
  // so the signature and seal never get pushed off the sheet.
  const FIT_SCRIPT = `(function(){function fit(){document.querySelectorAll('.pg > .content').forEach(function(c){var ps=c.querySelectorAll('.cols p'),size=12.5,guard=0;while(c.scrollHeight>c.clientHeight+1&&size>9&&guard++<20){size-=0.5;ps.forEach(function(p){p.style.fontSize=size+'px'})}})}if(document.fonts&&document.fonts.ready){document.fonts.ready.then(fit)}else{window.addEventListener('load',fit)}})();`;

  function doc(title, pages, extraCss) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>${FONTS}<style>${BASE_CSS}${extraCss || ''}</style></head><body>
      <button class="btn" onclick="window.print()">🖨 Print / Save PDF</button>
      ${pages}
      <script>${FIT_SCRIPT}</script>
    </body></html>`;
  }

  // ── Lifetime Workmanship Warranty ──────────────────────────────
  // d: warrantyData(); a: { logoUrl, signatureUrl, signerName, company }
  function warrantyHtml(d, a) {
    const ci = (a && a.company) || {};
    const fee = '$' + TRANSFER_FEE;
    const inner = `
      ${header(a.logoUrl, 'Storm Damage Experts · Pearland, Texas')}
      <div class="pre">CERTIFICATE OF</div>
      <h1>Lifetime Workmanship<br>Warranty</h1>
      <div class="script" style="margin-top:12px">This is to certify that</div>
      <div class="say" style="margin-top:4px">the roofing system installed for</div>
      <div class="fill script" style="width:480px;margin-top:10px;height:34px">${esc(d.owner)}</div>
      <div class="lbl">Property Owner</div>
      <div class="say" style="margin-top:8px">at the property located at</div>
      <div class="fill" style="width:480px;margin-top:8px;height:24px;font-size:17px;font-weight:600;line-height:1.2">${esc(d.addr)}</div>
      <div class="lbl">Property Address</div>
      <p class="body" style="margin:10px 0 0;max-width:560px">is warranted by ${COMPANY} against defects in installation workmanship for the lifetime of the roof, subject to the terms and conditions set forth in this certificate.</p>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:60px;width:480px;margin-top:10px">
        <div><div class="fill" style="height:22px;font-size:16px;font-weight:600;line-height:1.2">${esc(d.installDate)}</div><div class="lbl">Date of Installation</div></div>
        <div><div class="fill" style="height:22px;font-size:16px;font-weight:600;line-height:1.2">${esc(d.certNo)}</div><div class="lbl">Certificate No.</div></div>
      </div>
      <div class="cols" style="margin-top:16px">
        <div><h2>Warranty Coverage</h2><p>This Lifetime Workmanship Warranty covers defects resulting directly from installation workmanship performed by ${COMPANY}. Covered workmanship defects will be repaired at no cost to the property owner, subject to the exclusions and conditions below.</p></div>
        <div><h2>Transferability</h2><p>Transferable to a subsequent owner during the life of the roof. The new owner must notify ${COMPANY} within ninety (90) days of closing, provide updated contact information, and pay a ${fee} transfer fee. Failure to complete the transfer may result in termination of coverage.</p></div>
      </div>
      <div style="width:100%;margin-top:0">${signatureRow({
        signed: d.signed, signatureUrl: a.signatureUrl, signerName: a.signerName,
        dateText: d.issuedDate, dateLabel: 'Date Issued',
        sealTop: 'QUALITY WORKMANSHIP', sealBottom: 'BUILT TO LAST', logoUrl: a.logoUrl, sealId: 'w',
      })}</div>
      <div class="fine">
        <div class="sec">Terms, Conditions &amp; Exclusions</div>
        <p>An on-site inspection by ${COMPANY} is required before any warranty claim is approved. This warranty covers workmanship only and does not cover manufacturer material defects. Any lifted, displaced, damaged, or detached flashing resulting from wind, storms, hail, hurricanes, tornadoes, or other weather-related events is excluded, as is damage caused by falling objects, fire, flooding, lightning, structural movement, or other acts of God. ${COMPANY} reserves the right to inspect, repair, or deny claims that fall outside workmanship-related defects. This warranty is separate from and in addition to any applicable manufacturer warranty.</p>
        ${contactLine(ci)}
      </div>`;
    return doc('Lifetime Workmanship Warranty - ' + (d.owner || 'Homeowner'), page(inner, a.logoUrl));
  }

  // ── Certificate of Completion ──────────────────────────────────
  // d: the CRM's certCompletionData(); a: { logoUrl, signatureUrl, signerName, company, photos }
  function completionHtml(d, a) {
    const ci = (a && a.company) || d.ci || {};
    const coName = ci.name || COMPANY;
    const detail = (label, val) => val ? `<div><div class="dv">${esc(val)}</div><div class="lbl">${label}</div></div>` : '';
    const details = [
      detail('Date of Completion', d.compDate),
      detail('Claim No.', d.claimNum),
      detail('Insurance Carrier', d.carrier),
      detail('Policy No.', d.policyNum),
      detail('Date of Loss', d.dateOfLoss),
      detail('Project Representative', d.rep),
    ].filter(Boolean);
    const years = parseInt(d.warrYears, 10) || 0;
    const system = d.material
      ? `<p><b>Roofing system:</b> ${esc(d.material)}${d.color ? ' — ' + esc(d.color) : ''}.</p>` : '';
    const inner = `
      ${header(a.logoUrl, 'Storm Damage Experts · Pearland, Texas')}
      <div class="pre">CERTIFICATE OF</div>
      <h1>Completion</h1>
      <div class="cno">Certificate No. <b>${esc(d.certNo)}</b></div>
      <div class="script" style="margin-top:10px">This is to certify that</div>
      <div class="say" style="margin-top:4px">the roofing work for</div>
      <div class="fill script" style="width:480px;margin-top:8px;height:34px">${esc(d.customer)}</div>
      <div class="lbl">Property Owner</div>
      <div class="say" style="margin-top:6px">at the property located at</div>
      <div class="fill" style="width:480px;margin-top:6px;height:24px;font-size:17px;font-weight:600;line-height:1.2">${esc(cleanAddress(d.addr))}</div>
      <div class="lbl">Property Address</div>
      <p class="body" style="margin:8px 0 0;max-width:600px">has been completed in full by ${esc(coName)} in accordance with the contracted scope of work${(d.carrier || d.claimNum) ? ', the applicable insurance-approved scope' : ''}, the manufacturer’s installation requirements, and applicable building codes and industry standards.</p>
      ${details.length ? `<div class="details" style="grid-template-columns:repeat(${Math.min(3, details.length)},minmax(0,1fr))">${details.join('')}</div>` : ''}
      <div class="cols" style="margin-top:14px">
        <div><h2>Scope of Work</h2>
          <p>${esc(d.scope)}</p>
          ${d.notes ? `<p><b>Notes:</b> ${esc(d.notes)}</p>` : ''}
          ${system}
        </div>
        <div><h2>Warranty</h2>
          <p><b>Workmanship.</b> ${esc(coName)} warrants its installation workmanship for <b>${years} year${years === 1 ? '' : 's'}</b> from the date of completion. If a leak or defect results from an installation error during this period, we will repair it at no charge.</p>
          <p><b>Materials.</b> Roofing materials are covered by the manufacturer’s limited warranty under the manufacturer’s published terms${d.mfrWarranty ? ' (' + esc(d.mfrWarranty) + ')' : ''}.</p>
        </div>
      </div>
      <div style="width:100%;margin-top:auto">${signatureRow({
        signed: d.signed, signatureUrl: a.signatureUrl, signerName: a.signerName,
        dateText: d.signed ? d.compDate : '', dateLabel: 'Date',
        sealTop: 'CERTIFIED COMPLETE', sealBottom: (d.compISO || '').slice(0, 4) || 'STORMSHIELD', logoUrl: a.logoUrl, sealId: 'c',
      })}</div>
      <div class="fine" style="margin-top:10px">${contactLine(ci)}</div>`;

    const photos = (a && a.photos) || [];
    const photoPages = photos.map((p, i) => `<div class="pg">${frameSvg()}<div class="content pp">
        <div class="pp-head"><span>${esc(coName)}</span><span>Certificate No. ${esc(d.certNo)}</span></div>
        <div class="pp-cap">Completion Photo ${i + 1} of ${photos.length}${d.addr ? ' — ' + esc(String(d.addr).split(',')[0]) : ''}</div>
        <img src="${esc(p.url)}" class="pp-img" alt="Completion photo ${i + 1}">
      </div></div>`).join('');

    const css = `
      .logo{width:100px}
      .cno{margin-top:6px;font-family:Cinzel,Georgia,serif;font-size:10px;letter-spacing:.18em;color:${MUTED};font-variant-numeric:lining-nums}
      .cno b{color:${INK}}
      .details{display:grid;gap:10px 28px;width:100%;margin-top:14px;padding:10px 0 8px;border-top:1px solid ${GOLD};border-bottom:1px solid ${GOLD}}
      .details .dv{font-size:15px;font-weight:600;color:${INK};line-height:1.2;font-variant-numeric:lining-nums}
      .details .lbl{margin-top:2px;font-size:8.5px}
      .cols p{font-size:12px}
      .cols p + p{margin-top:4px}
      .pp{text-align:left;align-items:stretch}
      .pp-head{display:flex;justify-content:space-between;font-family:Cinzel,Georgia,serif;font-size:10px;letter-spacing:.14em;color:${INK};border-bottom:1px solid ${GOLD};padding-bottom:6px;text-transform:uppercase}
      .pp-cap{font-size:16px;font-weight:600;color:${INK};margin:10px 0}
      .pp-img{flex:1;min-height:0;width:100%;object-fit:contain;border:1px solid #d5cdb8;background:#fff}
    `;
    return doc('Certificate of Completion - ' + (d.customer || 'Homeowner'), page(inner, a.logoUrl) + photoPages, css);
  }

  return {
    TRANSFER_FEE, esc, fmtDate, cleanAddress, warrantyDefaultNo, warrantyData,
    warrantyHtml, completionHtml,
  };
});
