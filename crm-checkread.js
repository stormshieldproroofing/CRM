/* ============================================================
   StormShield CRM — read a check's amount two ways
   ------------------------------------------------------------
   A check states its amount twice: in the $ box and written out
   ("Eight thousand four hundred thirty-two and 10/100 DOLLARS").
   Banks treat the written amount as the legal one. Reading both and
   comparing them catches most misreads.

   crmCheckRead.read(ocrText, numericPick) →
     { amount, status, written, numeric, others }
     status  'match'      both agree
             'mismatch'   they disagree — amount is the written one; ask the person
             'written'    only the written amount could be read
             'numeric'    only the $ box could be read
             'none'       nothing found
     others  other dollar amounts seen on the check, for tap-to-pick

   numericPick(text) → number|null is the CRM's existing $-box reader;
   numericCandidates() below lists every amount it might have meant.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.crmCheckRead = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SCALES = { thousand: 1e3, million: 1e6 };
  const isNum = w => w in ONES || w in TENS || w === 'hundred' || w in SCALES;

  const cents = n => Math.round(n * 100);

  // Words → whole number: ["eight","thousand","four","hundred","thirty","two"] → 8432
  function wordsToNumber(words) {
    let total = 0, cur = 0;
    for (const w of words) {
      if (w in ONES) cur += ONES[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred') cur = (cur || 1) * 100;
      else if (w in SCALES) { total += (cur || 1) * SCALES[w]; cur = 0; }
    }
    return total + cur;
  }

  function tokens(text) {
    return String(text || '').toLowerCase()
      .replace(/[‐-―-]/g, ' ')            // thirty-two → thirty two
      .replace(/(\d)\s*\/\s*(100)\b/g, '$1/$2')      // 10 / 100 → 10/100
      .replace(/[^a-z0-9/*.,$ \n]/g, ' ')
      .split(/[\s*]+/).filter(Boolean);
  }

  // Cents written after the dollars: "and 10/100", "10/100", "xx/100", "no/100", "and ten cents", "10 cents".
  function readCents(tk, i) {
    let j = i;
    const skip = () => { while (j < tk.length && /^(and|dollars?|&|\$)$/.test(tk[j])) j++; };
    skip();
    const t = tk[j] || '';
    let m = t.match(/^(\d{1,2})\/100$/);
    if (m) return { cents: +m[1], end: j + 1 };
    if (/^(xx|no|none|00|0)\/100$/.test(t)) return { cents: 0, end: j + 1 };
    if (/^\d{1,2}$/.test(t) && /^cents?$/.test(tk[j + 1] || '')) return { cents: +t, end: j + 2 };
    // words then "cents"
    let k = j; const ws = [];
    while (k < tk.length && (tk[k] in ONES || tk[k] in TENS)) ws.push(tk[k++]);
    if (ws.length && /^cents?$/.test(tk[k] || '')) return { cents: wordsToNumber(ws), end: k + 1 };
    return null;
  }

  // The written ("legal") amount, in dollars, or null.
  function writtenAmount(text) {
    const tk = tokens(text);
    let best = null;
    for (let i = 0; i < tk.length; i++) {
      if (!isNum(tk[i])) continue;
      // Collect a run of number words; "and" only continues it when another number word follows.
      const run = [];
      let j = i;
      while (j < tk.length) {
        if (isNum(tk[j])) { run.push(tk[j]); j++; }
        else if (tk[j] === 'and' && isNum(tk[j + 1] || '') && !/\/100$/.test(tk[j + 1] || '')) j++;
        else break;
      }
      const dollars = wordsToNumber(run);
      const c = readCents(tk, j);
      const saysDollars = tk.slice(j, j + 4).some(t => /^dollars?$/.test(t));
      // A lone small word ("one", "two") is usually not the amount.
      let score = run.length + (c ? 6 : 0) + (saysDollars ? 4 : 0);
      if (run.length === 1 && !c && !saysDollars) score = -1;
      if (dollars > 0 && score > 0 && (!best || score > best.score)) best = { amount: dollars + (c ? c.cents / 100 : 0), score };
      i = j - 1;
    }
    // Some insurers print digits in the written line: "PAY ****8,432 DOLLARS AND 10 CENTS"
    const m = String(text || '').match(/(\d{1,3}(?:,\d{3})+|\d+)\s*dollars?\s*(?:and\s*)?(\d{1,2})\s*cents?/i);
    if (m && (!best || best.score < 8)) best = { amount: +m[1].replace(/,/g, '') + +m[2] / 100, score: 8 };
    return best ? Math.round(best.amount * 100) / 100 : null;
  }

  // Every dollar amount that looks like money on the check, best first.
  function numericCandidates(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const re = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]{1,3}(?:,[0-9]{3})+(?![0-9.])|[0-9]+\.[0-9]{2})/g;
    const seen = new Map();
    lines.forEach(line => {
      if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) && !/\$/.test(line)) return;   // dates
      let m;
      while ((m = re.exec(line)) !== null) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (!(n > 0)) continue;
        let score = 0;
        if (n >= 50 && n <= 100000) score += 10;
        if (line.includes('$') || line.includes('*')) score += 6;
        if (m[1].includes('.')) score += 6;
        const k = cents(n);
        if (!seen.has(k) || seen.get(k).score < score) seen.set(k, { amount: n, score });
      }
    });
    return [...seen.values()].sort((a, b) => b.score - a.score || b.amount - a.amount).map(c => c.amount);
  }

  function read(text, numericPick) {
    const written = writtenAmount(text);
    const cands = numericCandidates(text);
    const picked = typeof numericPick === 'function' ? numericPick(text) : null;
    const numeric = picked != null && picked > 0 ? picked : (cands[0] != null ? cands[0] : null);
    const others = n => cands.filter(c => n == null || cents(c) !== cents(n)).slice(0, 3);

    if (written != null) {
      // Any amount on the check that equals the written one counts as a match,
      // even if the $-box reader picked something else (a claim number, a date…).
      if (cands.some(c => cents(c) === cents(written)) || (numeric != null && cents(numeric) === cents(written)))
        return { amount: written, status: 'match', written, numeric: written, others: [] };
      if (numeric != null)
        return { amount: written, status: 'mismatch', written, numeric, others: others(written).filter(c => cents(c) !== cents(numeric)) };
      return { amount: written, status: 'written', written, numeric: null, others: others(written) };
    }
    if (numeric != null) return { amount: numeric, status: 'numeric', written: null, numeric, others: others(numeric) };
    return { amount: null, status: 'none', written: null, numeric: null, others: [] };
  }

  return { wordsToNumber, writtenAmount, numericCandidates, read };
});
