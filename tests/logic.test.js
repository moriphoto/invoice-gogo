const assert = require('assert');
const L = require('../logic.js');
const fs = require('fs');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  -', name); } catch (e) { console.error('FAIL -', name, '\n', e.message); process.exitCode = 1; } };

t('timezone is Europe/London for these tests', () => assert.strictEqual(process.env.TZ, 'Europe/London'));
t('112.5h x £22 = £2,475.00', () => { const x = L.totals({ lines: [{ qty: 112.5, rate: 22 }] }); assert.strictEqual(x.total, 2475); assert.strictEqual(L.gbp(x.total), '£2,475.00'); });
t('discount % and 20% VAT', () => {
  const x = L.totals({ lines: [{ qty: 10, rate: 22 }, { qty: 1, rate: 80.5 }], discountType: 'percent', discountValue: 10, vatOn: true, vatRate: 20 });
  assert.strictEqual(x.subtotal, 300.5); assert.strictEqual(x.discount, 30.05); assert.strictEqual(x.taxable, 270.45); assert.strictEqual(x.vat, 54.09); assert.strictEqual(x.total, 324.54);
});
t('discount fixed amount capped, VAT off by default', () => {
  const x = L.totals({ lines: [{ qty: 2, rate: 10 }], discountType: 'amount', discountValue: 50 });
  assert.strictEqual(x.total, 0);
  const y = L.totals({ lines: [{ qty: 3, rate: 33.33 }], discountType: 'amount', discountValue: 5 }); assert.strictEqual(y.total, 94.99);
});
t('float-prone amounts', () => { assert.strictEqual(L.lineAmount({ qty: 1.005, rate: 100 }), 100.5); assert.strictEqual(L.lineAmount({ qty: 0.1, rate: 3 }), 0.3); assert.strictEqual(L.gbp(-1234.5), '-£1,234.50'); });
t('local dates in BST / midnight', () => {
  const d = new Date(2026, 5, 15, 0, 30); assert.strictEqual(L.ymd(d), '2026-06-15'); // toISOString would say 14th
  assert.strictEqual(L.addDays('2026-03-28', 14), '2026-04-11'); // over clock change
  assert.strictEqual(L.addDays('2026-10-25', 1), '2026-10-26');
  assert.strictEqual(L.dmy('2026-11-09'), '09/11/2026');
  assert.strictEqual(L.daysBetween('2026-10-24', '2026-10-26'), 2);
});
t('overdue status', () => {
  const inv = { type: 'invoice', status: 'sent', dueDate: '2026-11-10' };
  assert.strictEqual(L.effStatus(inv, '2026-11-10'), 'sent'); assert.strictEqual(L.effStatus(inv, '2026-11-11'), 'overdue');
  assert.strictEqual(L.effStatus({ ...inv, status: 'paid' }, '2027-01-01'), 'paid');
  assert.strictEqual(L.effStatus({ ...inv, status: 'draft' }, '2027-01-01'), 'draft');
  assert.strictEqual(L.effStatus({ type: 'estimate', status: 'sent', convertedTo: 'x' }), 'converted');
});
t('numbering', () => {
  assert.strictEqual(L.nextNumber([], 'invoice', 'INV-', 1).number, 'INV-0001');
  const docs = [{ type: 'invoice', number: 'INV-0007' }, { type: 'estimate', number: 'EST-0020' }];
  assert.strictEqual(L.nextNumber(docs, 'invoice', 'INV-', 3).number, 'INV-0008');
  assert.strictEqual(L.nextNumber(docs, 'estimate', 'EST-', 1).number, 'EST-0021');
  assert.strictEqual(L.nextNumber(docs, 'invoice', 'INV-', 12).number, 'INV-0012');
});
t('range helpers', () => {
  assert.deepStrictEqual(L.rangeFor('this-week', '2026-11-11'), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepStrictEqual(L.rangeFor('last-week', '2026-11-11'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepStrictEqual(L.rangeFor('this-month', '2026-11-11'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual(L.rangeFor('last-month', '2026-01-11'), { from: '2025-12-01', to: '2025-12-31' });
  assert.strictEqual(L.taxYearOf('2027-04-05'), 2026); assert.strictEqual(L.taxYearOf('2027-04-06'), 2027);
});
const json = fs.readFileSync(__dirname + '/../samples/sewing_studio_timesheet_backup.json', 'utf8');
const csv = fs.readFileSync(__dirname + '/../samples/sewing_studio_timesheet.csv', 'utf8');
t('import JSON sample (15 days, 112.5h, £2,475)', () => {
  const r = L.parseTimesheetFile(json); assert.strictEqual(r.sessions.length, 15);
  assert.strictEqual(r.sessions.reduce((a, s) => a + s.hours, 0), 112.5);
  assert.strictEqual(L.round2(r.sessions.reduce((a, s) => a + s.earnings, 0)), 2475);
  assert.strictEqual(r.sessions[0].date, '2026-10-21'); assert.strictEqual(r.sessions[0].inHM, '09:30'); assert.strictEqual(r.sessions[0].outHM, '17:00');
});
t('CSV and JSON produce identical session keys (dedupe across formats)', () => {
  const a = L.parseTimesheetFile(json).sessions.map(s => s.key), b = L.parseTimesheetFile(csv).sessions.map(s => s.key);
  assert.deepStrictEqual(a, b);
});
t('CSV en-US style (m/d/yyyy, h:mm:ss AM/PM with narrow NBSP)', () => {
  const c = 'Date,In,Out,Hours,Rate,Earnings,Location,Notes\n"11/13/2026","9:30:00\u202FAM","5:00:00\u202FPM",7.5,22,165,"Studio","a, ""quoted""\nnote"\n"11/2/2026","12:15:00 PM","1:00:00 PM",0.75,22,16.5,"Home",""\n';
  const s = L.parseTimesheetFile(c).sessions;
  assert.strictEqual(s.length, 2); assert.strictEqual(s[0].date, '2026-11-02'); assert.strictEqual(s[0].inHM, '12:15'); assert.strictEqual(s[1].date, '2026-11-13');
  assert.strictEqual(s[1].outHM, '17:00'); assert.strictEqual(s[1].notes, 'a, "quoted"\nnote');
});
t('CSV ambiguous dates default to UK dd/mm', () => {
  const s = L.parseTimesheetFile('Date,In,Out,Hours,Rate,Earnings,Location,Notes\n"03/11/2026","09:30:00","17:00:00",7.5,22,165,"Studio",""\n').sessions;
  assert.strictEqual(s[0].date, '2026-11-03');
});
t('late-night session & BST session keep local date', () => {
  const raw = { in: new Date(2026, 5, 10, 23, 30).toISOString(), out: new Date(2026, 5, 11, 1, 0).toISOString(), hours: 1.5, rate: 22, earnings: 33, location: 'Home', notes: '' };
  const s = L.normaliseSession(raw); assert.strictEqual(s.date, '2026-06-10'); assert.strictEqual(s.inHM, '23:30'); assert.strictEqual(s.outHM, '01:00');
});
t('session -> invoice line text', () => {
  const s = L.parseTimesheetFile(json).sessions[0]; const l = L.sessionLine(s, { name: 'Content work' });
  assert.strictEqual(l.desc, 'Content work – 21/10/2026 (09:30–17:00)'); assert.strictEqual(l.qty, 7.5); assert.strictEqual(l.rate, 22);
});
t('bad files rejected', () => { assert.throws(() => L.parseTimesheetFile('{"foo":1}')); assert.throws(() => L.parseTimesheetFile('a,b\n1,2')); assert.throws(() => L.parseTimesheetFile('{bad')); });

t('MIME: multipart message parses with Python email; subject/body/attachment survive; header injection blocked', () => {
  const bin = Buffer.alloc(5000); for (let i = 0; i < bin.length; i++) bin[i] = (i * 7 + 13) % 256;
  const msg = L.buildMime({ to: 'client@example.com', bcc: 'me@example.com', subject: 'Invoice INV-0001 – £2,475.00 from James Moriarty ✓\r\nBcc: evil@example.com', body: 'Hi Tamsin,\nPlease find the invoice (£2,475.00) attached.\n\nThanks – James', attachment: { filename: 'INV-0001 – The Sewing Studio.pdf', mime: 'application/pdf', binary: bin.toString('binary') } });
  assert(!/\r\nBcc: evil/.test(msg)); assert(/\r\n/.test(msg) && !/[^\r]\n/.test(msg), 'CRLF only'); assert(msg.split('\r\n').every(l => l.length <= 998));
  fs.writeFileSync('/tmp/igg-test.eml', msg); fs.writeFileSync('/tmp/igg-test.bin', bin);
  const out = require('child_process').execSync(`python3 - <<'PY'
import email, email.policy, json
m = email.message_from_bytes(open('/tmp/igg-test.eml','rb').read(), policy=email.policy.default)
body = m.get_body(preferencelist=('plain',)).get_content()
att = [p for p in m.iter_attachments()][0]
print(json.dumps({'to': m['To'], 'bcc': m['Bcc'], 'subject': m['Subject'], 'body': body, 'fn': att.get_filename(), 'ct': att.get_content_type(), 'ok': att.get_content() == open('/tmp/igg-test.bin','rb').read(), 'ctype': m.get_content_type()}))
PY`).toString(); const r = JSON.parse(out);
  assert.strictEqual(r.ctype, 'multipart/mixed'); assert.strictEqual(r.to, 'client@example.com'); assert.strictEqual(r.bcc, 'me@example.com');
  assert.strictEqual(r.subject, 'Invoice INV-0001 – £2,475.00 from James Moriarty ✓ Bcc: evil@example.com'); assert(r.body.startsWith('Hi Tamsin,\r\nPlease find') || r.body.startsWith('Hi Tamsin,\nPlease find'));
  assert(r.body.includes('£2,475.00') && r.body.includes('Thanks – James')); assert.strictEqual(r.fn, 'INV-0001 – The Sewing Studio.pdf'); assert.strictEqual(r.ct, 'application/pdf'); assert.strictEqual(r.ok, true);
});
t('MIME raw is base64url without padding; templates fill', () => {
  const raw = L.mimeToRaw(L.buildMime({ to: 'a@b.co', subject: 'x', body: 'y' })); assert(/^[A-Za-z0-9_-]+$/.test(raw));
  assert.strictEqual(L.fillTemplate('Invoice {number} for {total} – {nope}', { number: 'INV-0001', total: '£5.00' }), 'Invoice INV-0001 for £5.00 – {nope}');
});
console.log(n + ' tests passed');
