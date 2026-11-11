/* Invoice GoGo – pure logic (no DOM). Works in browser (window.IGG) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IGG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- money (integer pennies internally) ---------- */
  const toPence = n => Math.round((Number(n) || 0) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7));
  const fromPence = p => p / 100;
  const round2 = n => fromPence(toPence(n));
  const gbp = n => {
    const v = Number(n) || 0;
    const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-£' : '£') + s;
  };

  function lineAmount(l) {
    // qty may be fractional (e.g. 7.5 hours); amount rounded to the penny
    return fromPence(toPence((Number(l.qty) || 0) * (Number(l.rate) || 0)));
  }

  /** doc: {lines:[{qty,rate}], discountType:'percent'|'amount', discountValue, vatOn, vatRate} */
  function totals(doc) {
    const lines = doc.lines || [];
    const sub = lines.reduce((a, l) => a + toPence(lineAmount(l)), 0);
    let disc = 0;
    const dv = Number(doc.discountValue) || 0;
    if (dv > 0) {
      disc = doc.discountType === 'percent' ? Math.round(sub * dv / 100) : toPence(dv);
      if (disc > sub) disc = sub;
    }
    const taxable = sub - disc;
    const vat = doc.vatOn ? Math.round(taxable * (Number(doc.vatRate) || 0) / 100) : 0;
    return {
      subtotal: fromPence(sub), discount: fromPence(disc), taxable: fromPence(taxable),
      vat: fromPence(vat), total: fromPence(taxable + vat),
      hours: lines.filter(l => l.unit === 'hour').reduce((a, l) => a + (Number(l.qty) || 0), 0)
    };
  }

  /* ---------- dates (always LOCAL, never toISOString for date-only) ---------- */
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const parseYMD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const todayYMD = () => ymd(new Date());
  const addDays = (s, n) => { const d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dmy = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; };
  const hm = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
  const monthKey = s => s.slice(0, 7);
  const monthLabel = k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y; };
  const daysBetween = (a, b) => Math.round((parseYMD(b) - parseYMD(a)) / 86400000);

  /* ---------- status ---------- */
  /** Effective status. Overdue only applies to SENT, unpaid invoices past their due date. */
  function effStatus(doc, today) {
    today = today || todayYMD();
    if (doc.type === 'estimate') {
      if (doc.convertedTo) return 'converted';
      return doc.status || 'draft';
    }
    if (doc.status === 'paid') return 'paid';
    if (doc.status === 'sent' && doc.dueDate && doc.dueDate < today) return 'overdue';
    return doc.status || 'draft';
  }

  /* ---------- numbering ---------- */
  function nextNumber(docs, type, prefix, counter) {
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    let max = 0;
    (docs || []).forEach(d => { if (d.type === type) { const m = re.exec(d.number || ''); if (m) max = Math.max(max, +m[1]); } });
    const n = Math.max(Number(counter) || 1, max + 1);
    return { n, number: prefix + String(n).padStart(4, '0') };
  }

  /* ---------- timesheet import ---------- */
  function sessionKey(dateYMD, inHM, outHM) { return dateYMD + '|' + inHM + '|' + outHM; }

  function normaliseSession(raw) {
    const a = new Date(raw.in), b = new Date(raw.out);
    if (isNaN(a) || isNaN(b)) return null;
    const hours = raw.hours != null && !isNaN(+raw.hours) ? +raw.hours : Math.round((b - a) / 36000) / 100;
    const rate = raw.rate != null && !isNaN(+raw.rate) ? +raw.rate : 22;
    const date = ymd(a);
    return {
      key: sessionKey(date, hm(a), hm(b)), date, inHM: hm(a), outHM: hm(b),
      hours, rate, earnings: raw.earnings != null && !isNaN(+raw.earnings) ? +raw.earnings : round2(hours * rate),
      location: raw.location || '', notes: raw.notes || ''
    };
  }

  function parseCSVText(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
      } else cur += c;
    }
    row.push(cur); if (row.some(x => x !== '')) rows.push(row);
    return rows;
  }

  function parseTime(t) {
    t = String(t || '').replace(/[\u202F\u00A0]/g, ' ').trim();
    const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([aApP]\.?[mM]\.?)?$/.exec(t);
    if (!m) return null;
    let h = +m[1]; const min = +m[2];
    if (m[4]) { const pm = /^p/i.test(m[4]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h > 23 || min > 59) return null;
    return p2(h) + ':' + p2(min);
  }

  /** returns normalised sessions from the timesheet's CSV export */
  function parseTimesheetCSV(text) {
    const rows = parseCSVText(text);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim().toLowerCase());
    const idx = n => head.indexOf(n);
    const iD = idx('date'), iI = idx('in'), iO = idx('out');
    if (iD < 0 || iI < 0 || iO < 0) throw new Error('This CSV does not look like a timesheet export (expected header: Date,In,Out,Hours,Rate,Earnings,Location,Notes).');
    const body = rows.slice(1);
    // decide day/month order across ALL rows
    let dayFirst = false, monthFirst = false;
    body.forEach(r => {
      const m = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/.exec((r[iD] || '').trim());
      if (m && m[1].length <= 2) { if (+m[1] > 12) dayFirst = true; if (+m[2] > 12) monthFirst = true; }
    });
    const useMDY = monthFirst && !dayFirst;
    const out = [];
    body.forEach(r => {
      const ds = (r[iD] || '').trim();
      let y, mo, d, m;
      if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ds))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(ds))) {
        y = +m[3]; if (y < 100) y += 2000;
        if (useMDY) { mo = +m[1]; d = +m[2]; } else { d = +m[1]; mo = +m[2]; }
      } else return;
      const tin = parseTime(r[iI]), tout = parseTime(r[iO]);
      if (!tin || !tout) return;
      const date = y + '-' + p2(mo) + '-' + p2(d);
      const num = n => { const i = idx(n); return i >= 0 && r[i] !== '' && !isNaN(+r[i]) ? +r[i] : null; };
      let hours = num('hours');
      if (hours == null) {
        let a = +tin.slice(0, 2) * 60 + +tin.slice(3), b = +tout.slice(0, 2) * 60 + +tout.slice(3);
        if (b <= a) b += 1440; hours = Math.round((b - a) / 60 * 100) / 100;
      }
      const rate = num('rate') != null ? num('rate') : 22;
      const earn = num('earnings') != null ? num('earnings') : round2(hours * rate);
      const li = idx('location'), ni = idx('notes');
      out.push({ key: sessionKey(date, tin, tout), date, inHM: tin, outHM: tout, hours, rate, earnings: earn,
        location: li >= 0 ? (r[li] || '') : '', notes: ni >= 0 ? (r[ni] || '') : '' });
    });
    return out;
  }

  function parseTimesheetFile(text) {
    const t = String(text).replace(/^\uFEFF/, '').trim();
    if (t[0] === '{' || t[0] === '[') {
      let data; try { data = JSON.parse(t); } catch (e) { throw new Error('That file is not valid JSON.'); }
      const arr = Array.isArray(data) ? data : data.sessions;
      if (!Array.isArray(arr)) throw new Error('No "sessions" list found. Use the timesheet app\'s Backup (JSON) or CSV export.');
      const sessions = arr.map(normaliseSession).filter(Boolean);
      return { kind: 'json', sessions: dedupeSessions(sessions), rate: data.settings && data.settings.rate };
    }
    return { kind: 'csv', sessions: dedupeSessions(parseTimesheetCSV(t)) };
  }
  function dedupeSessions(list) {
    const seen = new Set(); const out = [];
    list.forEach(s => { if (!seen.has(s.key)) { seen.add(s.key); out.push(s); } });
    return out.sort((a, b) => (a.date + a.inHM).localeCompare(b.date + b.inHM));
  }

  function weekStart(s) { const d = parseYMD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
  function rangeFor(kind, today) {
    today = today || todayYMD();
    const ws = weekStart(today);
    if (kind === 'this-week') return { from: ws, to: addDays(ws, 6) };
    if (kind === 'last-week') return { from: addDays(ws, -7), to: addDays(ws, -1) };
    const t = parseYMD(today);
    if (kind === 'this-month') return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
    if (kind === 'last-month') return { from: ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: ymd(new Date(t.getFullYear(), t.getMonth(), 0)) };
    return { from: '0000-01-01', to: '9999-12-31' };
  }

  function sessionLine(s, item) {
    return { desc: (item && item.name || 'Content work') + ' – ' + dmy(s.date) + ' (' + s.inHM + '–' + s.outHM + ')', qty: s.hours, rate: s.rate, unit: 'hour', sessionKey: s.key };
  }

  /* ---------- reports ---------- */
  function taxYearOf(dateYMD) { // UK: 6 Apr – 5 Apr
    const y = +dateYMD.slice(0, 4); const afterApr6 = dateYMD >= y + '-04-06';
    return afterApr6 ? y : y - 1;
  }
  function taxYearRange(startYear) { return { from: startYear + '-04-06', to: (startYear + 1) + '-04-05' }; }

  return { toPence, fromPence, round2, gbp, lineAmount, totals, ymd, parseYMD, todayYMD, addDays, dmy, hm, monthKey, monthLabel, daysBetween,
    effStatus, nextNumber, sessionKey, normaliseSession, parseCSVText, parseTime, parseTimesheetCSV, parseTimesheetFile,
    weekStart, rangeFor, sessionLine, taxYearOf, taxYearRange, p2 };
});
