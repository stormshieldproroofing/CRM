/* ============================================================
   StormShield CRM — read a check's $ amount and check number
   ------------------------------------------------------------
   crmCheckAmount.parse(text, words) → { amount, checkNum }
     text   the text Google Vision read from the check
     words  optional: [{ t, x0, y0, x1, y1 }] — each word Vision read and
            where it sits on the photo. When given, the amount is read from
            whatever is written right after the "$" box, which is the most
            reliable place to look.

   Without positions it scores every number in the text, favoring the $ line
   and ignoring the memo ("FOR …"), the payer's address, the date and the
   bank numbers along the bottom — the places a wrong amount usually came from.

   Handles handwriting like "18500.⁰⁰", "18500.°°", "18500,00", "18500."
   and "$ 18 500.00", as well as printed "$****8,432.10" and "$15,000".
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmCheckAmount = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

  // Tidy how handwriting and OCR mangle amounts, before reading numbers.
  function tidy(s) {
    return String(s || '')
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP[c])
      .replace(/(\d)\s*[.,]\s*[°ºoO]{2}\b/g, '$1.00')        // 18500.°° / 18500.oo
      .replace(/(\d)\s*[°º]{2}/g, '$1.00')                    // 18500°°
      .replace(/(\d)\s*\.\s+(\d{2})\b/g, '$1.$2')             // 18500. 00
      .replace(/(\$\s*\**\s*)(\d{1,3})\s(\d{3}(?:[.,]\d{2})?)\b/g, '$1$2$3')    // $ 18 500.00
      .replace(/(\$\s*\**\s*\d{2,6})\s(\d{2})(?!\d)/g, '$1.$2');                   // $ 18500 00 (raised cents)
  }

  // One money string → number, or null. "8,432.10" "18500.00" "18500,00" "18500." "15,000"
  function money(s) {
    s = tidy(s).replace(/[\s*$]/g, '');
    let m = s.match(/^(\d{1,3}(?:,\d{3})+)(?:\.(\d{2}))?(?!\d)/);
    if (m) return +m[1].replace(/,/g, '') + (m[2] ? +m[2] / 100 : 0);
    m = s.match(/^(\d+)[.,](\d{2})(?!\d)/);
    if (m) return +m[1] + +m[2] / 100;
    m = s.match(/^(\d+)(?:[.,]\d?)?(?!\d)/);
    if (m) return +m[1];
    return null;
  }

  /* ---------- with word positions: read what follows "$" ---------- */

  function amountFromWords(words) {
    if (!Array.isArray(words) || !words.length) return null;
    const ws = words.filter(w => w && w.t != null).map(w => Object.assign({}, w, { cy: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));
    const dollars = ws.filter(w => /^\$/.test(w.t));
    let best = null;
    for (const d of dollars) {
      // Words on the same line, to the right of the $, until something that isn't part of a number.
      const line = ws.filter(w => w !== d && w.x0 >= d.x0 - 1 && Math.abs(w.cy - d.cy) < Math.max(d.h, w.h) * 0.9)
        .sort((a, b) => a.x0 - b.x0);
      let s = d.t.replace(/^\$/, ''), lastX = d.x1;
      for (const w of line) {
        if (w.x0 - lastX > d.h * 5) break;                    // too far away
        if (!/^[\d.,*°ºoO⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(w.t)) break;      // a word, not a number
        s += w.t; lastX = w.x1;
      }
      const n = money(s);
      if (n != null && n > 0 && (!best || n > best)) best = n;   // more than one $? the larger is the amount
    }
    return best;
  }

  /* ---------- text only: score every number ---------- */

  const RE = /([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?(?![0-9])|[0-9]+[.,][0-9]{2}(?![0-9])|[0-9]{2,6}[.,]?(?![0-9]))/g;
  const isMemo = l => /^\s*(for|memo|re)\b[\s:.]/i.test(l);
  const isAddress = l => /\b\d{3,6}\s+[A-Za-z][A-Za-z .]*\b(ln|lane|st|street|dr|drive|ave|avenue|rd|road|blvd|ct|court|way|pkwy|cir|circle|trl|trail|pl|place|hwy)\b/i.test(l)
    || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(l);                                  // "Houston, TX 77095"
  const isBankLine = l => /[⑆⑇⑈⑉]|[:|]\s*\d{6,}|\d{9,}/.test(l) || /^[\s:;|'"!iIlL1⑆⑈⑉0-9]{12,}$/.test(l);
  const isDate = l => /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}\b/.test(l);
  const isRouting = l => /\b\d{1,2}-\d{1,4}\/\d{3,4}\b/.test(l);                   // "32-2/1110" fraction code

  function amountFromText(text, checkNum) {
    const lines = tidy(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const cands = [];
    lines.forEach((line, i) => {
      const prev = lines[i - 1] || '';
      const afterLoneDollar = /^\$\s*\**$/.test(prev);
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) {
        const raw = m[1];
        const num = money(raw);
        if (!(num > 0)) continue;
        let score = 0;
        if (num >= 50 && num <= 100000) score += 10;
        if (num >= 200 && num <= 50000) score += 3;
        const dollarAt = line.indexOf('$');
        if (dollarAt >= 0 && dollarAt < m.index) score += 18;          // written after a $ on the same line
        else if (dollarAt >= 0) score += 6;
        if (afterLoneDollar && m.index < 3) score += 16;                // "$" on its own line, amount on the next
        if (/[.,]\d{2}$/.test(raw)) score += 8;                         // has cents
        else if (raw.includes(',')) score += 6;                         // "15,000"
        if (/dollars?/i.test(line)) score += 2;
        if (isMemo(line)) score -= 30;
        if (isAddress(line)) score -= 30;
        if (isBankLine(line)) score -= 40;
        if (isDate(line) && dollarAt < 0) score -= 30;
        if (isRouting(line)) score -= 30;
        if (raw.replace(/\D/g, '').length >= 8 && !/[.,]\d{2}$/.test(raw)) score -= 15;
        if (checkNum && raw.replace(/\D/g, '') === String(checkNum)) score -= 30;   // the check number
        // A bare number with no $ in front and no cents is too weak to trust on its own.
        const strong = (dollarAt >= 0 && dollarAt < m.index) || afterLoneDollar || /[.,]\d{2}$/.test(raw) || raw.includes(',');
        if (!strong) score -= 12;
        cands.push({ num, score });
      }
    });
    cands.sort((a, b) => b.score - a.score || b.num - a.num);
    return cands.length && cands[0].score > 0 ? cands[0].num : null;
  }

  function checkNumber(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/(?:check\s*#|check\s*no\.?|no\.|number)\s*([0-9]{3,10})/i);
      if (m) return m[1];
    }
    for (const line of lines.slice(0, 6)) {
      const m = line.match(/^\s*([0-9]{3,6})\s*$/);
      if (m) return m[1];
    }
    return null;
  }

  function parse(text, words) {
    if (!text && !(words && words.length)) return { amount: null, checkNum: null };
    const checkNum = checkNumber(text);
    const a = amountFromWords(words);
    const amount = a != null ? a : amountFromText(text, checkNum);
    return { amount: amount != null ? Math.round(amount * 100) / 100 : null, checkNum };
  }

  // Vision's fullTextAnnotation → [{ t, x0, y0, x1, y1 }]
  function visionWords(annotation) {
    const out = [];
    ((annotation && annotation.pages) || []).forEach(p => (p.blocks || []).forEach(b => (b.paragraphs || []).forEach(pg => (pg.words || []).forEach(w => {
      const t = (w.symbols || []).map(s => s.text).join('');
      const v = (w.boundingBox && w.boundingBox.vertices) || [];
      if (!t || !v.length) return;
      const xs = v.map(q => q.x || 0), ys = v.map(q => q.y || 0);
      out.push({ t, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }))));
    return out;
  }

  return { tidy, money, amountFromWords, amountFromText, checkNumber, parse, visionWords };
});
