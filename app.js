/* Invoice GoGo – app (vanilla JS, localStorage prefix igg_) */
(function () {
'use strict';
const L = window.IGG;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const gbp = L.gbp, dmy = L.dmy;
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const qtyFmt = n => (Math.round(n * 100) / 100).toString();

/* ================= storage ================= */
const KEYS = ['clients', 'invoices', 'items', 'expenses', 'projects', 'settings', 'imported'];
const DEFAULT_SETTINGS = {
  name: 'James Moriarty', tagline: 'Product photography & video', address: 'Cornwall, UK', email: '', phone: '', vatNumber: '',
  bankName: '', accountName: '', sortCode: '', accountNumber: '', payRef: true,
  terms: 14, invPrefix: 'INV-', estPrefix: 'EST-', nextInvoice: 1, nextEstimate: 1, estValidDays: 30,
  vatDefaultOn: false, vatRate: 20, lateNote: false,
  accent: '#008080', template: 'classic', logo: '', footer: 'Thank you for your business.', seeded: false, preDemo: null
};
const LATE_NOTE = 'Statutory interest may be charged on late payments under the Late Payment of Commercial Debts (Interest) Act 1998.';
const DEFAULTS = { clients: [], invoices: [], items: [], expenses: [], projects: [], settings: DEFAULT_SETTINGS, imported: {} };
const CATEGORIES = ['Equipment', 'Software & subscriptions', 'Travel & transport', 'Materials & props', 'Insurance', 'Marketing', 'Phone & internet', 'Training', 'Accountancy & fees', 'Other'];
let db = {};
function load() {
  KEYS.forEach(k => {
    let v = null; try { v = JSON.parse(localStorage.getItem('igg_' + k)); } catch (e) { v = null; }
    db[k] = v == null ? clone(DEFAULTS[k]) : v;
  });
  db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
  if (!db.settings.seeded) {
    db.clients.push({ id: uid(), name: 'The Sewing Studio', contact: '', email: '', phone: '', address: '10 Chapel Street\nRedruth\nCornwall', notes: 'Regular client – hours imported from the timesheet app.' });
    db.items.push({ id: uid(), name: 'Content work', description: 'Product photography, video & editing', rate: 22, unit: 'hour' });
    db.settings.seeded = true; KEYS.forEach(save);
  }
}
let storageWarned = false;
function save(k) {
  try { localStorage.setItem('igg_' + k, JSON.stringify(db[k])); }
  catch (e) { if (!storageWarned) { storageWarned = true; toast('Storage is full – export a backup and remove big receipt photos.'); } }
}
const saveAll = () => KEYS.forEach(save);

/* ================= helpers ================= */
const clientOf = id => db.clients.find(c => c.id === id);
const projectOf = id => db.projects.find(p => p.id === id);
const docOf = id => db.invoices.find(d => d.id === id);
const clientName = id => (clientOf(id) || {}).name || '— no client —';
const status = d => L.effStatus(d);
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', accepted: 'Accepted', declined: 'Declined', converted: 'Converted' };
const badge = d => { const s = status(d); return `<span class="badge b-${s}">${STATUS_LABEL[s] || s}</span>`; };
const invoices = () => db.invoices.filter(d => d.type === 'invoice');
const estimates = () => db.invoices.filter(d => d.type === 'estimate');
const docTotal = d => L.totals(d).total;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const r2 = L.round2;
const demoBadge = o => o.demo ? ' <span class="badge b-demo">Demo</span>' : '';
const termsLabel = t => ({ 0: 'Due on receipt', 7: '7 days', 14: '14 days', 30: '30 days', custom: 'Custom date' }[t] || t + ' days');

const IC = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  invoices: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  estimates: '<path d="M9 4h6v3H9z"/><path d="M7 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><path d="M8 14l2.5 2.5L16 11"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.7 3.5 2.6 3.5 5.5"/>',
  projects: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  items: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  expenses: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cashflow: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  apps: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', print: '<path d="M7 9V3h10v6"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>',
  drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10M16 3l-6 10M6 20l4-7h12"/>'
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

let toastT;
function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200);
}

function resizeImage(file, max, type, q) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Could not read the image'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('That file is not an image'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const x = c.getContext('2d'); if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL(type, q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function download(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/* ================= modal ================= */
function modal(title, bodyHTML, buttons) {
  closeModal();
  const bg = document.createElement('div'); bg.id = 'modalBg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div id="modalBody">${bodyHTML}</div><div class="foot">${(buttons || []).map((b, i) => `<button class="btn ${b.cls || ''}" data-mb="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  bg.addEventListener('click', e => {
    const b = e.target.closest('[data-mb]'); if (!b) return;
    const def = buttons[+b.dataset.mb]; const r = def.fn ? def.fn(bg) : undefined; if (r !== false) closeModal();
  });
  $('#overlay').appendChild(bg);
  const f = $('input,select,textarea', bg); if (f && !/Mobi|Android/i.test(navigator.userAgent)) f.focus();
  return bg;
}
function closeModal() { const m = $('#modalBg'); if (m) m.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('#newMenu') && $('#newMenu').remove(); } });

/** field spec -> html; values -> object */
function fieldsHTML(fields, v) {
  return fields.map(f => {
    const val = v[f.k] == null ? '' : v[f.k];
    let inp;
    if (f.type === 'textarea') inp = `<textarea data-k="${f.k}" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
    else if (f.type === 'select') inp = `<select data-k="${f.k}">${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    else if (f.type === 'image') inp = `<input type="file" accept="image/*" data-k="${f.k}" data-img="1"><div class="note" data-imgnote="${f.k}">${val ? '✓ Photo attached' : 'Optional'}</div>`;
    else inp = `<input type="${f.type || 'text'}" data-k="${f.k}" value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
    return `<div class="fg"><label>${esc(f.label)}</label>${inp}</div>`;
  }).join('');
}
function readFields(root, fields, v) {
  const out = Object.assign({}, v);
  fields.forEach(f => {
    const el = $(`[data-k="${f.k}"]`, root); if (!el) return;
    if (f.type === 'image') { if (root._img && root._img[f.k] !== undefined) out[f.k] = root._img[f.k]; }
    else out[f.k] = f.type === 'number' ? (el.value === '' ? '' : num(el.value)) : el.value.trim();
  });
  return out;
}
function formModal(title, fields, values, onSave, extraButtons) {
  const bg = modal(title, fieldsHTML(fields, values), [
    { label: 'Cancel' }, ...(extraButtons || []),
    { label: 'Save', cls: 'primary', fn: m => {
      const out = readFields(m, fields, values);
      for (const f of fields) if (f.req && (out[f.k] === '' || out[f.k] == null)) { toast(f.label + ' is required'); return false; }
      return onSave(out);
    } }
  ]);
  bg._img = {};
  $$('input[data-img]', bg).forEach(inp => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    try { bg._img[inp.dataset.k] = await resizeImage(f, 1100, 'image/jpeg', 0.72); $(`[data-imgnote="${inp.dataset.k}"]`, bg).textContent = '✓ Photo ready'; } catch (e) { toast(e.message); }
  }));
  return bg;
}

/* ================= invoice paper ================= */
function onColour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#1f2937' : '#fff';
}
const UNIT_SHORT = { hour: 'hrs', day: 'days', each: '' };
function renderPaper(d, opts) {
  opts = opts || {};
  const s = db.settings, t = L.totals(d), c = clientOf(d.clientId) || { name: '' }, proj = projectOf(d.projectId);
  const isEst = d.type === 'estimate';
  const acc = s.accent || '#008080';
  const lines = (d.lines || []).filter(l => l.desc || l.qty || l.rate);
  const st = status(d);
  const bank = [s.bankName && ('Bank: ' + s.bankName), s.accountName && ('Account name: ' + s.accountName), s.sortCode && ('Sort code: ' + s.sortCode), s.accountNumber && ('Account number: ' + s.accountNumber)].filter(Boolean).join('\n');
  const stamp = !isEst && st === 'paid' ? `<div class="p-stamp">Paid</div>` : (isEst && st === 'accepted' ? `<div class="p-stamp">Accepted</div>` : '');
  return `<div class="paper t-${esc(s.template)}" id="paper" style="--acc:${esc(acc)};--on-acc:${onColour(acc)}">
  ${stamp}
  <div class="p-head">
    <div>${s.logo ? `<img class="p-logo" src="${s.logo}" alt="">` : ''}<div class="p-biz">${esc(s.name || 'Your business')}</div>
      ${s.tagline && !s.logo ? `<div class="p-addr">${esc(s.tagline)}</div>` : ''}
      <div class="p-addr">${esc([s.address, s.email, s.phone].filter(Boolean).join('\n'))}${s.vatNumber ? '\nVAT no. ' + esc(s.vatNumber) : ''}</div></div>
    <div><div class="p-title">${isEst ? 'Estimate' : (s.vatDefaultOn || d.vatOn ? 'Tax Invoice' : 'Invoice')}</div>
      <div class="p-meta"><b>${esc(d.number || (isEst ? 'EST-XXXX' : 'INV-XXXX'))}</b><br>
      ${isEst ? 'Date' : 'Issued'}: ${dmy(d.issueDate)}<br>${isEst ? 'Valid until' : 'Due'}: ${isEst ? dmy(d.dueDate) : `<b>${dmy(d.dueDate)}</b>`}</div></div>
  </div>
  <div class="p-parties">
    <div><div class="p-lbl">${isEst ? 'Prepared for' : 'Bill to'}</div><div class="p-bill"><b>${esc(c.name || 'Client name')}</b>${c.contact ? '\n' + esc(c.contact) : ''}${c.address ? '\n' + esc(c.address) : ''}${c.email ? '\n' + esc(c.email) : ''}</div></div>
    ${proj ? `<div style="text-align:right"><div class="p-lbl">Project</div><div>${esc(proj.name)}</div></div>` : ''}
  </div>
  <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
  ${lines.length ? lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="r">${qtyFmt(num(l.qty))}${UNIT_SHORT[l.unit] ? ' ' + UNIT_SHORT[l.unit] : ''}</td><td class="r">${gbp(num(l.rate))}</td><td class="r">${gbp(L.lineAmount(l))}</td></tr>`).join('') : '<tr><td colspan="4" style="color:#9ca3af">No line items yet</td></tr>'}
  </tbody></table>
  <div class="p-tot">
    <div><span>Subtotal</span><span>${gbp(t.subtotal)}</span></div>
    ${t.discount ? `<div><span>Discount${d.discountType === 'percent' ? ' (' + qtyFmt(num(d.discountValue)) + '%)' : ''}</span><span>-${gbp(t.discount)}</span></div>` : ''}
    ${d.vatOn ? `<div><span>VAT (${qtyFmt(num(d.vatRate))}%)</span><span>${gbp(t.vat)}</span></div>` : ''}
    <div class="g"><span>${isEst ? 'Estimated total' : (st === 'paid' ? 'Total paid' : 'Total due')}</span><span>${gbp(t.total)}</span></div>
    ${!isEst && st === 'paid' && d.paidDate ? `<div style="font-size:11px;color:#059669"><span>Paid on</span><span>${dmy(d.paidDate)}</span></div>` : ''}
  </div>
  ${(!isEst && (bank || d.notes)) || (isEst && d.notes) ? `<div class="p-pay">
    ${!isEst && bank ? `<div><div class="p-lbl">Payment details</div><div class="p-box">${esc(bank)}${s.payRef ? '\nReference: ' + esc(d.number || '') : ''}</div></div>` : '<div></div>'}
    ${d.notes ? `<div><div class="p-lbl">Notes</div><div class="p-box">${esc(d.notes)}</div></div>` : '<div></div>'}</div>` : ''}
  ${!isEst && d.lateNote ? `<div class="p-late">${esc(LATE_NOTE)}</div>` : ''}
  ${s.footer ? `<div class="p-foot">${esc(s.footer)}</div>` : ''}
  </div>`;
}

/* ================= shell & router ================= */
const NAV = [
  ['dashboard', 'Dashboard', 'home'], ['invoices', 'Invoices', 'invoices'], ['estimates', 'Estimates', 'estimates'], ['clients', 'Clients', 'clients'],
  ['projects', 'Projects', 'projects'], ['items', 'Items', 'items'], ['expenses', 'Expenses', 'expenses'], ['cashflow', 'Cash flow', 'cashflow'],
  ['reports', 'Reports', 'reports'], ['apps', 'Integrated apps', 'apps'], ['settings', 'Settings', 'settings']
];
const TABS = [['dashboard', 'Home', 'home'], ['invoices', 'Invoices', 'invoices'], ['clients', 'Clients', 'clients'], ['expenses', 'Expenses', 'expenses'], ['more', 'More', 'more']];

function buildShell() {
  $('#topbar').innerHTML = `<a class="brand" href="#/dashboard"><img src="icon.svg" alt=""><span class="nm">Invoice <b>GoGo</b></span></a><div class="top-spacer"></div>
    <button class="btn-grey" id="btnNew" aria-haspopup="true">${ico('plus')} New</button>`;
  $('#sidebar').innerHTML = NAV.map((n, i) => `${i === 3 || i === 7 || i === 9 ? '<div class="sep"></div>' : ''}<a href="#/${n[0]}" data-nav="${n[0]}">${ico(n[2])}<span>${n[1]}</span></a>`).join('');
  $('#tabbar').innerHTML = TABS.map(n => `<a href="#/${n[0]}" data-nav="${n[0]}">${ico(n[2])}<span>${n[1]}</span></a>`).join('');
  $('#btnNew').addEventListener('click', e => {
    e.stopPropagation();
    const ex = $('#newMenu'); if (ex) { ex.remove(); return; }
    const m = document.createElement('div'); m.id = 'newMenu';
    m.innerHTML = [['invoice', 'New invoice', 'invoices'], ['estimate', 'New estimate', 'estimates'], ['client', 'New client', 'clients'], ['expense', 'New expense', 'expenses'], ['project', 'New project', 'projects'], ['import', 'Import hours from timesheet', 'clock']]
      .map(x => `<button data-new="${x[0]}">${ico(x[2])}${x[1]}</button>`).join('');
    document.body.appendChild(m);
  });
  document.addEventListener('click', e => {
    const nb = e.target.closest('[data-new]');
    if (nb) { const k = nb.dataset.new; $('#newMenu') && $('#newMenu').remove(); ({ invoice: () => go('invoice/new'), estimate: () => go('estimate/new'), client: () => editClient(), expense: () => editExpense(), project: () => editProject(), import: () => go('import') })[k](); return; }
    if (!e.target.closest('#newMenu')) { const m = $('#newMenu'); if (m) m.remove(); }
  });
}
const go = h => { location.hash = '#/' + h; };
function setNav(route) {
  const map = { invoice: 'invoices', estimate: 'estimates', client: 'clients', project: 'projects', import: 'apps', more: 'more' };
  const key = map[route] || route;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === key || (key === 'more' && false)));
  if (['more', 'items', 'projects', 'estimates', 'cashflow', 'reports', 'apps', 'settings', 'import'].includes(route) || map[route] && !['invoice', 'client'].includes(route)) {
    const more = $('#tabbar [data-nav="more"]'); if (more && !TABS.some(t => t[0] === key)) more.classList.add('active');
  }
}
let ed = null; // invoice editor draft
const VIEWS = {};
function render() {
  closeModal();
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const route = parts[0];
  if (!((route === 'invoice' || route === 'estimate') && (parts[1] === 'new' || parts[2] === 'edit'))) ed = null;
  setNav(route);
  const page = $('#page');
  let fn = VIEWS[route];
  if (route === 'invoice' || route === 'estimate') fn = parts[1] === 'new' ? VIEWS.editor : (parts[2] === 'edit' ? VIEWS.editor : VIEWS.docView);
  if (!fn) { go('dashboard'); return; }
  try { page.innerHTML = fn(parts) || page.innerHTML; } catch (e) { console.error(e); page.innerHTML = `<div class="card"><b>Something went wrong.</b><pre>${esc(e.stack || e)}</pre></div>`; }
  window.scrollTo(0, 0);
  const after = VIEWS['after_' + route]; if (after) after(parts);
}
window.addEventListener('hashchange', render);

/* generic click delegation */
const ACT = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('click', e => {
  const r = e.target.closest('[data-href]'); if (r && !e.target.closest('button,a,input,select')) go(r.dataset.href);
});

/* ================= charts ================= */
function barChart(data, opts) {
  opts = opts || {};
  const W = 640, H = opts.h || 230, pl = 52, pb = 30, pt = 12, pr = 8;
  const max = Math.max(1, ...data.flatMap(d => [d.a, d.b || 0]));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  const ih = H - pt - pb, iw = W - pl - pr, bw = iw / data.length;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = nice * i / 4, y = pt + ih - ih * i / 4;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#eef0f2"/><text x="${pl - 6}" y="${y + 4}" font-size="11" fill="#9ca3af" text-anchor="end">${v >= 1000 ? '£' + (v / 1000) + 'k' : '£' + v}</text>`;
  }
  data.forEach((d, i) => {
    const x0 = pl + i * bw + bw * 0.14, w = bw * 0.72, h1 = ih * d.a / nice, h2 = ih * (d.b || 0) / nice;
    g += `<rect x="${x0}" y="${pt + ih - h1}" width="${w / 2 - 1}" height="${Math.max(0, h1)}" rx="3" fill="#008080"><title>${d.label}: in ${gbp(d.a)}</title></rect>`;
    g += `<rect x="${x0 + w / 2 + 1}" y="${pt + ih - h2}" width="${w / 2 - 1}" height="${Math.max(0, h2)}" rx="3" fill="#E5A361"><title>${d.label}: out ${gbp(d.b || 0)}</title></rect>`;
    g += `<text x="${pl + i * bw + bw / 2}" y="${H - 9}" font-size="11" fill="#6b7280" text-anchor="middle">${d.label}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Cash flow chart')}">${g}</svg>
  <div class="legend"><span><i style="background:#008080"></i>Money in (paid)</span><span><i style="background:#E5A361"></i>Money out (expenses)</span></div>`;
}
function lastMonths(n, endKey) {
  const t = L.parseYMD(endKey ? endKey + '-01' : L.todayYMD().slice(0, 7) + '-01'); const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); out.push(d.getFullYear() + '-' + L.p2(d.getMonth() + 1)); }
  return out;
}
const shortMonth = k => L.monthLabel(k).slice(0, 3) + (k.slice(5) === '01' ? " '" + k.slice(2, 4) : '');
function monthFlow(keys) {
  return keys.map(k => ({
    key: k, label: shortMonth(k),
    a: r2(sum(invoices().filter(d => d.status === 'paid' && (d.paidDate || '').startsWith(k)), docTotal)),
    b: r2(sum(db.expenses.filter(x => (x.date || '').startsWith(k)), x => num(x.amount)))
  }));
}

/* ================= Dashboard ================= */
function listRows(docs, kind) {
  if (!docs.length) return `<div class="empty">Nothing here yet.</div>`;
  return `<div class="list"><div class="li hd"><span>Number</span><span>Client</span><span>${kind === 'estimate' ? 'Valid until' : 'Due'}</span><span>Status</span><span style="text-align:right">Amount</span></div>` +
    docs.map(d => `<div class="li" data-href="${d.type}/${d.id}"><span class="num">${esc(d.number)}${demoBadge(d)}</span><span class="client">${esc(clientName(d.clientId))}</span><span class="due meta">${dmy(d.dueDate)}</span><span class="st">${badge(d)}</span><span class="amt">${gbp(docTotal(d))}</span></div>`).join('') + '</div>';
}
const attRow = d => `<div class="att" data-href="invoice/${d.id}"><div><b>${esc(d.number)}</b> <span class="meta">${esc(clientName(d.clientId))}</span><div class="meta">${status(d) === 'overdue' ? L.daysBetween(d.dueDate, L.todayYMD()) + ' days late · was due ' + dmy(d.dueDate) : 'due ' + dmy(d.dueDate)}</div></div><div style="text-align:right"><div class="amt">${gbp(docTotal(d))}</div>${badge(d)}</div></div>`;
VIEWS.dashboard = function () {
  const today = L.todayYMD(), mk = today.slice(0, 7);
  const inv = invoices();
  const unpaid = inv.filter(d => ['sent', 'overdue'].includes(status(d)));
  const overdue = inv.filter(d => status(d) === 'overdue');
  const drafts = inv.filter(d => status(d) === 'draft');
  const paidMonth = inv.filter(d => d.status === 'paid' && (d.paidDate || '').startsWith(mk));
  const expMonth = db.expenses.filter(x => (x.date || '').startsWith(mk));
  const flow = monthFlow(lastMonths(6));
  const attention = unpaid.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const recent = db.invoices.slice().sort((a, b) => (b.issueDate + b.number).localeCompare(a.issueDate + a.number)).slice(0, 6);
  const first = !db.invoices.length;
  return `<div class="page-head"><h1>Dashboard</h1><span class="sub">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span><span class="sp"></span>
    <a class="btn" href="#/import">${ico('clock')} Import hours</a><a class="btn primary" href="#/invoice/new">${ico('plus')} New invoice</a></div>
  <div class="grid g4" style="margin-bottom:1rem">
    <div class="stat"><span>Owed to you</span><strong>${gbp(sum(unpaid, docTotal))}</strong><small>${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}</small></div>
    <div class="stat ${overdue.length ? 'warn' : ''}"><span>Overdue</span><strong>${gbp(sum(overdue, docTotal))}</strong><small>${overdue.length} overdue</small></div>
    <div class="stat good"><span>Paid this month</span><strong>${gbp(sum(paidMonth, docTotal))}</strong><small>${paidMonth.length} invoice${paidMonth.length === 1 ? '' : 's'}</small></div>
    <div class="stat fawn"><span>Expenses this month</span><strong>${gbp(sum(expMonth, x => num(x.amount)))}</strong><small>${drafts.length} draft invoice${drafts.length === 1 ? '' : 's'} waiting</small></div>
  </div>
  ${first ? `<div class="card"><h3>Welcome to Invoice GoGo</h3><p style="margin-top:0">Nothing to show yet. The quickest start: bring in your hours from the Sewing Studio Timesheet, or just create an invoice. You can also look around with demo data (clearly labelled, removable any time).</p>
    <div class="btn-row"><a class="btn primary" href="#/import">${ico('clock')} Import hours</a><a class="btn" href="#/invoice/new">New invoice</a><button class="btn" data-act="loadDemo">Load demo data</button></div></div>` : ''}
  <div class="grid g2" style="align-items:start">
    <div class="card"><h3>Cash flow – last 6 months</h3>${barChart(flow)}</div>
    <div class="card"><h3>Needs attention</h3>${attention.length ? `<div class="list">${attention.map(attRow).join('')}</div>` : '<div class="empty"><b>All clear</b>No unpaid invoices.</div>'}
    <div class="note" style="margin-top:.7rem">Only invoices marked “Sent” can become overdue.</div></div>
  </div>
  <div class="card"><div class="card-h">Recent invoices &amp; estimates<span class="sp"></span><a class="btn small" href="#/invoices">View all</a></div>${listRows(recent)}</div>`;
};
ACT.loadDemo = () => loadDemo();

/* ================= Invoices & Estimates lists ================= */
let listFilter = { invoice: 'all', estimate: 'all', q: '' };
function docList(type) {
  const isEst = type === 'estimate';
  const all = db.invoices.filter(d => d.type === type);
  const f = listFilter[type];
  const keys = isEst ? ['all', 'draft', 'sent', 'accepted', 'declined', 'converted'] : ['all', 'draft', 'sent', 'overdue', 'paid'];
  const q = listFilter.q.toLowerCase();
  let rows = all.filter(d => (f === 'all' || status(d) === f) && (!q || (d.number + ' ' + clientName(d.clientId)).toLowerCase().includes(q)));
  rows.sort((a, b) => (b.issueDate + b.number).localeCompare(a.issueDate + a.number));
  const total = sum(rows, docTotal);
  return `<div class="page-head"><h1>${isEst ? 'Estimates' : 'Invoices'}</h1><span class="sp"></span>
    <a class="btn" href="#/import">${ico('clock')} Import hours</a><a class="btn primary" href="#/${type}/new">${ico('plus')} New ${type}</a></div>
  <div class="card">
    <div class="chips">${keys.map(k => `<button class="chip ${f === k ? 'on' : ''}" data-act="filter" data-type="${type}" data-v="${k}">${k === 'all' ? 'All' : STATUS_LABEL[k]}<small>${k === 'all' ? all.length : all.filter(d => status(d) === k).length}</small></button>`).join('')}</div>
    <div class="fg"><input type="search" id="docSearch" placeholder="Search number or client…" value="${esc(listFilter.q)}"></div>
    ${rows.length ? listRows(rows, type) + `<div style="text-align:right;margin-top:.7rem" class="sub">${rows.length} shown · total <b>${gbp(total)}</b></div>` :
      `<div class="empty"><b>No ${isEst ? 'estimates' : 'invoices'} ${all.length ? 'match' : 'yet'}</b>${all.length ? 'Try another filter.' : `Create your first ${type}, or import your hours.`}</div>`}
  </div>`;
}
VIEWS.invoices = () => docList('invoice');
VIEWS.estimates = () => docList('estimate');
ACT.filter = el => { listFilter[el.dataset.type] = el.dataset.v; render(); };
document.addEventListener('input', e => { if (e.target.id === 'docSearch') { listFilter.q = e.target.value; const pos = e.target.selectionStart; const route = location.hash.split('/')[1]; render(); const i = $('#docSearch'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });

/* ================= Editor ================= */
function blankLine(item) { return item ? { desc: item.name + (item.description ? ' – ' + item.description : ''), qty: 1, rate: item.rate, unit: item.unit || 'each' } : { desc: '', qty: 1, rate: 0, unit: 'each' }; }
function newDoc(type, pre) {
  const s = db.settings, today = L.todayYMD(), isEst = type === 'estimate';
  const terms = isEst ? s.estValidDays : s.terms;
  return Object.assign({ id: uid(), type, number: '', clientId: '', projectId: '', issueDate: today, terms, dueDate: L.addDays(today, +terms), status: 'draft',
    lines: [blankLine()], discountType: 'percent', discountValue: 0, vatOn: !!s.vatDefaultOn, vatRate: s.vatRate, notes: '', lateNote: !!s.lateNote && !isEst, isNew: true }, pre || {});
}
function peekNumber(d) {
  const s = db.settings; return d.type === 'estimate' ? L.nextNumber(db.invoices, 'estimate', s.estPrefix, s.nextEstimate) : L.nextNumber(db.invoices, 'invoice', s.invPrefix, s.nextInvoice);
}
VIEWS.editor = function (parts) {
  const type = parts[0];
  if (parts[1] === 'new') { if (!ed || !ed.isNew || ed.type !== type) ed = newDoc(type); }
  else { const d = docOf(parts[1]); if (!d) { go(type + 's'); return; } if (!ed || ed.id !== d.id) ed = clone(d); }
  const isEst = ed.type === 'estimate';
  ed.number = ed.isNew ? peekNumber(ed).number : ed.number;
  const clientOpts = `<option value="">Select client…</option>` + db.clients.map(c => `<option value="${c.id}" ${c.id === ed.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const projOpts = `<option value="">No project</option>` + db.projects.filter(p => !ed.clientId || p.clientId === ed.clientId || p.id === ed.projectId).map(p => `<option value="${p.id}" ${p.id === ed.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const termsSel = [0, 7, 14, 30, 'custom'].map(t => `<option value="${t}" ${String(ed.terms) === String(t) ? 'selected' : ''}>${termsLabel(t)}</option>`).join('');
  const itemOpts = `<option value="">+ Add saved item…</option>` + db.items.map(i => `<option value="${i.id}">${esc(i.name)} – ${gbp(i.rate)}/${i.unit}</option>`).join('');
  return `<div class="page-head"><h1>${ed.isNew ? 'New' : 'Edit'} ${isEst ? 'estimate' : 'invoice'} <span class="sub" id="edNum">${esc(ed.number)}</span></h1><span class="sp"></span>
    <button class="btn" data-act="edCancel">Cancel</button><button class="btn primary" data-act="edSave">Save ${isEst ? 'estimate' : 'invoice'}</button></div>
  ${ed.sessionKeys && ed.sessionKeys.length ? `<div class="card" style="background:#ecfdf5;border-color:#a7f3d0"><b>Imported from timesheet:</b> ${ed.sessionKeys.length} sessions · ${qtyFmt(L.totals(ed).hours)} hours. Check the lines, then Save.</div>` : ''}
  <div class="editor"><div>
    <div class="card"><h3>Details</h3>
      <div class="row2"><div class="fg"><label>Client</label><select data-f="clientId">${clientOpts}</select><button class="btn small" style="margin-top:.4rem" data-act="edNewClient">+ New client</button></div>
        <div class="fg"><label>Project (optional)</label><select data-f="projectId">${projOpts}</select></div></div>
      <div class="row3"><div class="fg"><label>${isEst ? 'Estimate' : 'Invoice'} date</label><input type="date" data-f="issueDate" value="${ed.issueDate}"></div>
        <div class="fg"><label>${isEst ? 'Valid for' : 'Payment terms'}</label><select data-f="terms">${termsSel}</select></div>
        <div class="fg"><label>${isEst ? 'Valid until' : 'Due date'}</label><input type="date" data-f="dueDate" value="${ed.dueDate}"></div></div>
    </div>
    <div class="card"><h3>Line items</h3>
      <div class="lines" id="lines"></div>
      <div class="btn-row" style="margin-top:.4rem"><button class="btn small" data-act="edAddLine">+ Add line</button>
        <select id="pickItem" style="width:auto;max-width:260px;padding:.4rem .6rem;font-size:.85rem">${itemOpts}</select></div>
      <div class="row2" style="margin-top:1rem"><div class="fg"><label>Discount</label><div style="display:flex;gap:.4rem"><input type="number" step="0.01" min="0" data-f="discountValue" value="${ed.discountValue || ''}" placeholder="0"><select data-f="discountType" style="width:90px"><option value="percent" ${ed.discountType === 'percent' ? 'selected' : ''}>%</option><option value="amount" ${ed.discountType === 'amount' ? 'selected' : ''}>£</option></select></div></div>
        <div class="fg"><label>VAT</label><div style="display:flex;gap:.6rem;align-items:center"><label class="chk"><input type="checkbox" data-f="vatOn" ${ed.vatOn ? 'checked' : ''}> Add VAT</label><input type="number" step="0.1" min="0" data-f="vatRate" value="${ed.vatRate}" style="width:80px"> %</div></div></div>
      <div class="totals-box" id="edTotals"></div>
    </div>
    <div class="card"><h3>Notes</h3><div class="fg"><textarea data-f="notes" placeholder="e.g. Thank you! Shoot dates, usage terms…">${esc(ed.notes)}</textarea></div>
      ${isEst ? '' : `<label class="chk"><input type="checkbox" data-f="lateNote" ${ed.lateNote ? 'checked' : ''}> Add late-payment (statutory interest) note</label>`}</div>
    <div class="btn-row"><button class="btn primary" data-act="edSave">Save ${isEst ? 'estimate' : 'invoice'}</button><button class="btn" data-act="edCancel">Cancel</button></div>
  </div>
  <div class="preview-col"><div class="card" style="padding:.7rem"><div class="card-h" style="margin-bottom:.5rem">Live preview</div><div id="edPreview" class="doc-wrap"></div></div></div></div>`;
};
VIEWS.after_invoice = VIEWS.after_estimate = function (parts) { if (parts[1] === 'new' || parts[2] === 'edit') { paintLines(); paintTotals(); } };
function paintLines() {
  const el = $('#lines'); if (!el) return;
  el.innerHTML = `<div class="lrow hd"><span>Description</span><span>Qty / hrs</span><span>Unit</span><span>Rate £</span><span style="text-align:right">Amount</span><span></span></div>` +
    ed.lines.map((l, i) => `<div class="lrow"><input class="d" type="text" data-l="${i}:desc" value="${esc(l.desc)}" placeholder="Description"><input class="q" type="number" step="0.01" min="0" inputmode="decimal" data-l="${i}:qty" value="${l.qty}" aria-label="Quantity">
      <select class="u" data-l="${i}:unit"><option value="each" ${l.unit === 'each' ? 'selected' : ''}>qty</option><option value="hour" ${l.unit === 'hour' ? 'selected' : ''}>hrs</option><option value="day" ${l.unit === 'day' ? 'selected' : ''}>days</option></select>
      <input class="r" type="number" step="0.01" min="0" inputmode="decimal" data-l="${i}:rate" value="${l.rate}" aria-label="Rate"><span class="a amt" data-amt="${i}">${gbp(L.lineAmount(l))}</span><button class="x" data-act="edDelLine" data-i="${i}" aria-label="Remove line">×</button></div>`).join('');
}
function paintTotals() {
  const t = L.totals(ed), el = $('#edTotals'); if (!el) return;
  el.innerHTML = `<div><span>Subtotal</span><span>${gbp(t.subtotal)}</span></div>${t.discount ? `<div><span>Discount</span><span>-${gbp(t.discount)}</span></div>` : ''}${ed.vatOn ? `<div><span>VAT ${qtyFmt(num(ed.vatRate))}%</span><span>${gbp(t.vat)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${gbp(t.total)}</span></div>`;
  ed.lines.forEach((l, i) => { const a = $(`[data-amt="${i}"]`); if (a) a.textContent = gbp(L.lineAmount(l)); });
  const p = $('#edPreview'); if (p) {
    const sc = Math.min(1, ((p.clientWidth || 400) - 2) / 794);
    p.innerHTML = `<div class="pv-outer" style="width:${794 * sc}px;margin:0 auto;overflow:hidden"><div class="pv-inner" style="transform:scale(${sc});transform-origin:top left;width:794px">${renderPaper(ed)}</div></div>`;
    $('.pv-outer', p).style.height = ($('.pv-inner', p).offsetHeight * sc) + 'px';
  }
}
function edField(el) {
  if (el.dataset.l) {
    const [i, k] = el.dataset.l.split(':'); const l = ed.lines[+i]; if (!l) return;
    l[k] = (k === 'qty' || k === 'rate') ? (el.value === '' ? 0 : num(el.value)) : el.value; paintTotals(); return;
  }
  const f = el.dataset.f; if (!f) return;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  if (['discountValue', 'vatRate'].includes(f)) ed[f] = num(v); else ed[f] = v;
  if (f === 'issueDate' || f === 'terms') {
    if (f === 'terms') ed.terms = v === 'custom' ? 'custom' : +v;
    if (ed.terms !== 'custom' && ed.issueDate) { ed.dueDate = L.addDays(ed.issueDate, +ed.terms); const dd = $('[data-f="dueDate"]'); if (dd) dd.value = ed.dueDate; }
  }
  if (f === 'dueDate') { ed.terms = 'custom'; const t = $('[data-f="terms"]'); if (t) t.value = 'custom'; }
  if (f === 'clientId') {
    const sel = $('[data-f="projectId"]'); const ps = db.projects.filter(p => !v || p.clientId === v);
    if (ed.projectId && !ps.some(p => p.id === ed.projectId)) ed.projectId = '';
    sel.innerHTML = `<option value="">No project</option>` + ps.map(p => `<option value="${p.id}" ${p.id === ed.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  paintTotals();
}
document.addEventListener('input', e => { if (ed && (e.target.dataset.l || e.target.dataset.f)) edField(e.target); });
document.addEventListener('change', e => {
  if (ed && (e.target.dataset.l || e.target.dataset.f)) edField(e.target);
  if (e.target.id === 'pickItem' && ed) { const it = db.items.find(i => i.id === e.target.value); if (it) { if (ed.lines.length === 1 && !ed.lines[0].desc && !num(ed.lines[0].rate)) ed.lines = []; ed.lines.push(blankLine(it)); paintLines(); paintTotals(); } e.target.value = ''; }
});
ACT.edAddLine = () => { ed.lines.push(blankLine()); paintLines(); paintTotals(); const ins = $$('#lines .d'); ins[ins.length - 1].focus(); };
ACT.edDelLine = el => { ed.lines.splice(+el.dataset.i, 1); if (!ed.lines.length) ed.lines.push(blankLine()); paintLines(); paintTotals(); };
ACT.edCancel = () => { const wasNew = ed && ed.isNew; const id = ed && ed.id; const t = ed && ed.type; ed = null; if (wasNew) go(t + 's'); else go(t + '/' + id); };
ACT.edNewClient = () => editClient(null, c => { ed.clientId = c.id; render(); });
ACT.edSave = () => {
  const d = ed; if (!d) return;
  if (!d.clientId) { toast('Please choose a client'); $('[data-f="clientId"]').focus(); return; }
  d.lines = d.lines.filter(l => l.desc || num(l.qty) * num(l.rate));
  if (!d.lines.length) { toast('Add at least one line item'); d.lines = [blankLine()]; paintLines(); return; }
  if (d.isNew) {
    const s = db.settings, nn = peekNumber(d); d.number = nn.number;
    if (d.type === 'estimate') s.nextEstimate = nn.n + 1; else s.nextInvoice = nn.n + 1;
    d.createdAt = new Date().toISOString(); delete d.isNew; db.invoices.push(d); save('settings');
    if (d.sessionKeys) { d.sessionKeys.forEach(k => db.imported[k] = d.id); save('imported'); }
  } else { const i = db.invoices.findIndex(x => x.id === d.id); db.invoices[i] = d; }
  if (d.status === 'paid' && !d.paidDate) d.paidDate = L.todayYMD();
  save('invoices'); const id = d.id, t = d.type; ed = null; toast((t === 'estimate' ? 'Estimate ' : 'Invoice ') + d.number + ' saved'); go(t + '/' + id);
};

/* ================= Document view ================= */
VIEWS.docView = function (parts) {
  ed = null;
  const d = docOf(parts[1]); if (!d) { go(parts[0] + 's'); return; }
  const isEst = d.type === 'estimate', st = status(d), c = clientOf(d.clientId) || {};
  const acts = [];
  acts.push(`<a class="btn" href="#/${d.type}s">‹ Back</a>`);
  acts.push(`<button class="btn primary" data-act="print">${ico('print')} Print / Save as PDF</button>`);
  acts.push(`<button class="btn" data-act="pdf" data-id="${d.id}">Download PDF</button>`);
  if (!isEst && st === 'draft') acts.push(`<button class="btn fawn" data-act="markSent" data-id="${d.id}">Mark as sent</button>`);
  if (!isEst && st !== 'paid' && st !== 'draft') acts.push(`<button class="btn fawn" data-act="markPaid" data-id="${d.id}">Mark paid</button>`);
  if (!isEst && st === 'paid') acts.push(`<button class="btn" data-act="markUnpaid" data-id="${d.id}">Mark unpaid</button>`);
  if (isEst && !d.convertedTo) {
    if (st === 'draft') acts.push(`<button class="btn" data-act="estStatus" data-id="${d.id}" data-v="sent">Mark as sent</button>`);
    if (st === 'sent') acts.push(`<button class="btn" data-act="estStatus" data-id="${d.id}" data-v="accepted">Accepted</button><button class="btn" data-act="estStatus" data-id="${d.id}" data-v="declined">Declined</button>`);
    acts.push(`<button class="btn fawn" data-act="convert" data-id="${d.id}">Convert to invoice</button>`);
  }
  if (isEst && d.convertedTo && docOf(d.convertedTo)) acts.push(`<a class="btn" href="#/invoice/${d.convertedTo}">View ${esc(docOf(d.convertedTo).number)}</a>`);
  acts.push(`<a class="btn" href="#/${d.type}/${d.id}/edit">Edit</a>`);
  if (c.email) acts.push(`<a class="btn" href="mailto:${esc(c.email)}?subject=${encodeURIComponent((isEst ? 'Estimate ' : 'Invoice ') + d.number + ' from ' + (db.settings.name || ''))}&body=${encodeURIComponent('Hi ' + (c.contact || c.name) + ',\n\nPlease find ' + (isEst ? 'estimate ' : 'invoice ') + d.number + ' for ' + gbp(docTotal(d)) + ' attached (' + (isEst ? 'valid until ' : 'due ') + dmy(d.dueDate) + ').\n\nKind regards,\n' + (db.settings.name || ''))}">Email client</a>`);
  acts.push(`<button class="btn" data-act="duplicate" data-id="${d.id}">Duplicate</button><button class="btn danger" data-act="delDoc" data-id="${d.id}">Delete</button>`);
  return `<div class="page-head"><h1>${esc(d.number)} ${badge(d)}${demoBadge(d)}</h1><span class="sub">${esc(c.name || '')} · ${gbp(docTotal(d))}</span></div>
  <div class="doc-actions">${acts.join('')}</div>
  ${d.sessionKeys && d.sessionKeys.length ? `<div class="note no-print" style="margin-bottom:.7rem">Created from ${d.sessionKeys.length} timesheet sessions.</div>` : ''}
  <div class="doc-wrap">${renderPaper(d)}</div>
  <div class="note no-print" style="text-align:center;margin-top:.8rem">Tip: in the print dialog choose “Save as PDF” and turn off “Headers and footers”. Mark as sent after you've sent it – only sent invoices become overdue.</div>`;
};
ACT.print = () => window.print();
function loadScript(src) { return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(el); }); }
ACT.pdf = async el => {
  const d = docOf(el.dataset.id);
  try {
    toast('Building PDF…');
    if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const host = document.createElement('div'); host.className = 'pdf-capture'; host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff'; host.innerHTML = renderPaper(d); document.body.appendChild(host);
    const paper = host.firstElementChild; await new Promise(r => setTimeout(r, 60));
    const canvas = await window.html2canvas(paper, { scale: 2, backgroundColor: '#ffffff', useCORS: true }); host.remove();
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }); const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const imgH = canvas.height * pw / canvas.width, img = canvas.toDataURL('image/jpeg', 0.92);
    let y = 0, left = imgH;
    if (imgH > ph && imgH <= ph * 1.1) { const k = ph / imgH; pdf.addImage(img, 'JPEG', (pw - pw * k) / 2, 0, pw * k, ph); left = 0; } // slightly long: shrink to one page
    else { pdf.addImage(img, 'JPEG', 0, 0, pw, imgH); left -= ph; }
    while (left > 2) { pdf.addPage(); y -= ph; pdf.addImage(img, 'JPEG', 0, y, pw, imgH); left -= ph; }
    pdf.save(d.number + '.pdf'); toast('PDF downloaded');
  } catch (e) { console.warn(e); const h = $('.pdf-capture'); if (h) h.remove(); toast('PDF download needs internet – opening Print / Save as PDF instead'); setTimeout(() => window.print(), 600); }
};
ACT.markSent = el => { const d = docOf(el.dataset.id); d.status = 'sent'; save('invoices'); toast('Marked as sent'); render(); };
ACT.markUnpaid = el => { const d = docOf(el.dataset.id); d.status = 'sent'; d.paidDate = ''; save('invoices'); render(); };
ACT.markPaid = el => {
  const d = docOf(el.dataset.id);
  modal('Mark ' + d.number + ' as paid', `<div class="fg"><label>Date received</label><input type="date" id="paidDate" value="${L.todayYMD()}"></div><div class="note">Amount: <b>${gbp(docTotal(d))}</b> from ${esc(clientName(d.clientId))}</div>`,
    [{ label: 'Cancel' }, { label: 'Mark paid', cls: 'primary', fn: m => { const v = $('#paidDate', m).value; if (!v) { toast('Pick a date'); return false; } d.status = 'paid'; d.paidDate = v; save('invoices'); toast('Marked as paid'); render(); } }]);
};
ACT.estStatus = el => { const d = docOf(el.dataset.id); d.status = el.dataset.v; save('invoices'); render(); };
ACT.convert = el => {
  const e = docOf(el.dataset.id); const s = db.settings, today = L.todayYMD();
  const nn = L.nextNumber(db.invoices, 'invoice', s.invPrefix, s.nextInvoice);
  const inv = Object.assign(clone(e), { id: uid(), type: 'invoice', number: nn.number, status: 'draft', issueDate: today, terms: s.terms, dueDate: L.addDays(today, +s.terms), convertedFrom: e.id, convertedTo: undefined, paidDate: '', lateNote: !!s.lateNote, createdAt: new Date().toISOString() });
  delete inv.convertedTo; s.nextInvoice = nn.n + 1; e.convertedTo = inv.id; e.status = e.status === 'declined' ? 'sent' : e.status;
  db.invoices.push(inv); saveAll(); toast('Created ' + inv.number + ' from ' + e.number); go('invoice/' + inv.id);
};
ACT.duplicate = el => {
  const d = docOf(el.dataset.id); const copy = newDoc(d.type, { clientId: d.clientId, projectId: d.projectId, lines: clone(d.lines), discountType: d.discountType, discountValue: d.discountValue, vatOn: d.vatOn, vatRate: d.vatRate, notes: d.notes, lateNote: d.lateNote });
  ed = copy; go(d.type + '/new');
};
ACT.delDoc = el => {
  const d = docOf(el.dataset.id); if (!confirm('Delete ' + d.number + '? This cannot be undone.')) return;
  db.invoices = db.invoices.filter(x => x.id !== d.id);
  Object.keys(db.imported).forEach(k => { if (db.imported[k] === d.id) delete db.imported[k]; }); // release timesheet sessions
  db.invoices.forEach(x => { if (x.convertedTo === d.id) delete x.convertedTo; });
  saveAll(); toast(d.number + ' deleted'); go(d.type + 's');
};

/* ================= Clients ================= */
const CLIENT_FIELDS = [
  { k: 'name', label: 'Client / business name', req: 1 }, { k: 'contact', label: 'Contact person (optional)' },
  { k: 'email', label: 'Email', type: 'email' }, { k: 'phone', label: 'Phone', type: 'tel' },
  { k: 'address', label: 'Address', type: 'textarea' }, { k: 'notes', label: 'Private notes', type: 'textarea' }
];
function editClient(id, cb) {
  const c = id ? clientOf(id) : { id: uid(), name: '', contact: '', email: '', phone: '', address: '', notes: '' };
  const extra = id ? [{ label: 'Delete', cls: 'danger', fn: () => {
    if (db.invoices.some(d => d.clientId === id)) { toast('This client has invoices – delete or reassign them first.'); return false; }
    if (!confirm('Delete ' + c.name + '?')) return false; db.clients = db.clients.filter(x => x.id !== id); db.projects = db.projects.filter(p => p.clientId !== id); saveAll(); go('clients'); render();
  } }] : [];
  formModal(id ? 'Edit client' : 'New client', CLIENT_FIELDS, c, out => {
    if (id) Object.assign(c, out); else db.clients.push(out);
    save('clients'); toast('Client saved'); if (cb) cb(id ? c : out); else render();
  }, extra);
}
const clientStats = id => { const ds = invoices().filter(d => d.clientId === id); return { n: ds.length, billed: sum(ds.filter(d => d.status !== 'draft'), docTotal), owed: sum(ds.filter(d => ['sent', 'overdue'].includes(status(d))), docTotal), paid: sum(ds.filter(d => d.status === 'paid'), docTotal) }; };
VIEWS.clients = function () {
  const rows = db.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="page-head"><h1>Clients</h1><span class="sp"></span><button class="btn primary" data-act="newClient">${ico('plus')} New client</button></div>
  <div class="card">${rows.length ? `<div class="list"><div class="li hd c4"><span>Client</span><span>Contact</span><span style="text-align:right">Owed</span><span style="text-align:right">Paid</span><span style="text-align:right">Invoices</span></div>` +
    rows.map(c => { const s = clientStats(c.id); return `<div class="li c4" data-href="client/${c.id}"><span><b>${esc(c.name)}</b>${demoBadge(c)}</span><span class="meta">${esc(c.email || c.phone || '—')}</span><span class="amt" style="${s.owed ? 'color:var(--danger)' : ''}">${gbp(s.owed)}</span><span class="amt">${gbp(s.paid)}</span><span class="amt">${s.n}</span></div>`; }).join('') + '</div>' :
    '<div class="empty"><b>No clients yet</b>Add the people you invoice.</div>'}</div>`;
};
ACT.newClient = () => editClient();
VIEWS.client = function (parts) {
  const c = clientOf(parts[1]); if (!c) { go('clients'); return; }
  const s = clientStats(c.id), docs = db.invoices.filter(d => d.clientId === c.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const ps = db.projects.filter(p => p.clientId === c.id);
  return `<div class="page-head"><a class="btn small" href="#/clients">‹ Clients</a><h1>${esc(c.name)}</h1><span class="sp"></span><button class="btn" data-act="editClient" data-id="${c.id}">Edit</button><a class="btn primary" href="#/invoice/new" data-act="newInvFor" data-id="${c.id}">New invoice</a></div>
  <div class="grid g3" style="margin-bottom:1rem"><div class="stat"><span>Owed</span><strong>${gbp(s.owed)}</strong></div><div class="stat good"><span>Paid to date</span><strong>${gbp(s.paid)}</strong></div><div class="stat fawn"><span>Invoices</span><strong>${s.n}</strong></div></div>
  <div class="card"><h3>Details</h3><div class="row3"><div><div class="l note">Contact</div>${esc(c.contact || '—')}</div><div><div class="note">Email / phone</div>${esc([c.email, c.phone].filter(Boolean).join(' · ') || '—')}</div><div><div class="note">Address</div><div style="white-space:pre-line">${esc(c.address || '—')}</div></div></div>${c.notes ? `<p class="note" style="margin-bottom:0">${esc(c.notes)}</p>` : ''}</div>
  ${ps.length ? `<div class="card"><h3>Projects</h3>${ps.map(p => `<a href="#/project/${p.id}" class="chip" style="display:inline-block;margin-right:.4rem">${esc(p.name)}</a>`).join('')}</div>` : ''}
  <div class="card"><h3>Invoices &amp; estimates</h3>${listRows(docs)}</div>`;
};
ACT.editClient = el => editClient(el.dataset.id);
ACT.newInvFor = el => { ed = newDoc('invoice', { clientId: el.dataset.id }); go('invoice/new'); };

/* ================= Projects ================= */
const PROJECT_FIELDS = (db) => [
  { k: 'name', label: 'Project name', req: 1 }, { k: 'clientId', label: 'Client', type: 'select', options: [['', '— none —']].concat(db.clients.map(c => [c.id, c.name])) },
  { k: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['done', 'Completed']] }, { k: 'notes', label: 'Notes', type: 'textarea' }
];
function editProject(id) {
  const p = id ? projectOf(id) : { id: uid(), name: '', clientId: '', status: 'active', notes: '' };
  const extra = id ? [{ label: 'Delete', cls: 'danger', fn: () => { if (!confirm('Delete this project? Invoices stay, just ungrouped.')) return false; db.projects = db.projects.filter(x => x.id !== id); db.invoices.forEach(d => { if (d.projectId === id) d.projectId = ''; }); db.expenses.forEach(x => { if (x.projectId === id) x.projectId = ''; }); saveAll(); go('projects'); render(); } }] : [];
  formModal(id ? 'Edit project' : 'New project', PROJECT_FIELDS(db), p, out => { if (id) Object.assign(p, out); else db.projects.push(out); save('projects'); toast('Project saved'); render(); }, extra);
}
const projStats = id => {
  const ds = invoices().filter(d => d.projectId === id), ex = db.expenses.filter(x => x.projectId === id);
  return { ds, ex, hours: sum(ds, d => L.totals(d).hours), billed: sum(ds, docTotal), paid: sum(ds.filter(d => d.status === 'paid'), docTotal), exp: sum(ex, x => num(x.amount)) };
};
VIEWS.projects = function () {
  return `<div class="page-head"><h1>Projects</h1><span class="sp"></span><button class="btn primary" data-act="newProject">${ico('plus')} New project</button></div>
  ${db.projects.length ? `<div class="grid g3">${db.projects.map(p => { const s = projStats(p.id); return `<div class="card" style="cursor:pointer" data-href="project/${p.id}"><div class="card-h">${esc(p.name)}<span class="sp"></span><span class="badge b-${p.status === 'done' ? 'done' : 'active'}">${p.status === 'done' ? 'Completed' : 'Active'}</span></div>
    <div class="sub" style="margin-bottom:.6rem">${esc(clientName(p.clientId))}${demoBadge(p)}</div><table class="t"><tr><td>Invoiced</td><td class="r">${gbp(s.billed)}</td></tr><tr><td>Hours billed</td><td class="r">${qtyFmt(s.hours)}</td></tr><tr><td>Expenses</td><td class="r">${gbp(s.exp)}</td></tr></table></div>`; }).join('')}</div>` :
    `<div class="card"><div class="empty"><b>No projects yet</b>Group invoices, hours and expenses by job or client.</div></div>`}`;
};
ACT.newProject = () => editProject();
VIEWS.project = function (parts) {
  const p = projectOf(parts[1]); if (!p) { go('projects'); return; }
  const s = projStats(p.id);
  return `<div class="page-head"><a class="btn small" href="#/projects">‹ Projects</a><h1>${esc(p.name)}</h1><span class="sp"></span><button class="btn" data-act="editProject" data-id="${p.id}">Edit</button><a class="btn primary" href="#/invoice/new" data-act="newInvForProject" data-id="${p.id}">New invoice</a></div>
  <div class="sub" style="margin-bottom:1rem">${esc(clientName(p.clientId))} · ${p.status === 'done' ? 'Completed' : 'Active'}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
  <div class="grid g4" style="margin-bottom:1rem"><div class="stat"><span>Invoiced</span><strong>${gbp(s.billed)}</strong></div><div class="stat good"><span>Paid</span><strong>${gbp(s.paid)}</strong></div><div class="stat fawn"><span>Hours billed</span><strong>${qtyFmt(s.hours)}</strong></div><div class="stat"><span>Expenses</span><strong>${gbp(s.exp)}</strong></div></div>
  <div class="card"><h3>Invoices</h3>${listRows(s.ds)}</div>
  <div class="card"><h3>Expenses</h3>${s.ex.length ? `<table class="t"><tbody>${s.ex.map(x => `<tr><td>${dmy(x.date)}</td><td>${esc(x.category)}</td><td>${esc(x.note)}</td><td class="r">${gbp(num(x.amount))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No expenses linked. Link an expense to this project when you add it.</div>'}</div>`;
};
ACT.editProject = el => editProject(el.dataset.id);
ACT.newInvForProject = el => { const p = projectOf(el.dataset.id); ed = newDoc('invoice', { clientId: p.clientId, projectId: p.id }); go('invoice/new'); };

/* ================= Items ================= */
const ITEM_FIELDS = [{ k: 'name', label: 'Name', req: 1 }, { k: 'description', label: 'Description (optional)' }, { k: 'rate', label: 'Price (£)', type: 'number', step: '0.01' }, { k: 'unit', label: 'Charged per', type: 'select', options: [['hour', 'Hour'], ['day', 'Day'], ['each', 'Each / fixed']] }];
function editItem(id) {
  const it = id ? db.items.find(x => x.id === id) : { id: uid(), name: '', description: '', rate: 0, unit: 'hour' };
  const extra = id ? [{ label: 'Delete', cls: 'danger', fn: () => { if (!confirm('Delete this item?')) return false; db.items = db.items.filter(x => x.id !== id); save('items'); render(); } }] : [];
  formModal(id ? 'Edit item' : 'New item', ITEM_FIELDS, it, out => { out.rate = num(out.rate); if (id) Object.assign(it, out); else db.items.push(out); save('items'); toast('Item saved'); render(); }, extra);
}
VIEWS.items = function () {
  return `<div class="page-head"><h1>Items</h1><span class="sub">Saved products &amp; services you can add to any invoice</span><span class="sp"></span><button class="btn primary" data-act="newItem">${ico('plus')} New item</button></div>
  <div class="card">${db.items.length ? `<table class="t"><thead><tr><th>Name</th><th>Description</th><th class="r">Price</th><th>Per</th><th></th></tr></thead><tbody>${db.items.map(i => `<tr><td><b>${esc(i.name)}</b>${demoBadge(i)}</td><td>${esc(i.description)}</td><td class="r">${gbp(i.rate)}</td><td>${i.unit === 'each' ? 'each' : i.unit}</td><td class="r"><button class="btn small" data-act="editItem" data-id="${i.id}">Edit</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><b>No saved items</b></div>'}</div>`;
};
ACT.newItem = () => editItem(); ACT.editItem = el => editItem(el.dataset.id);

/* ================= Expenses ================= */
function editExpense(id) {
  const x = id ? db.expenses.find(e => e.id === id) : { id: uid(), date: L.todayYMD(), category: CATEGORIES[0], amount: '', note: '', projectId: '', receipt: '' };
  const fields = [{ k: 'date', label: 'Date', type: 'date', req: 1 }, { k: 'category', label: 'Category', type: 'select', options: CATEGORIES }, { k: 'amount', label: 'Amount (£)', type: 'number', step: '0.01', req: 1 },
    { k: 'note', label: 'Note (what / who)' }, { k: 'projectId', label: 'Project (optional)', type: 'select', options: [['', '— none —']].concat(db.projects.map(p => [p.id, p.name])) }, { k: 'receipt', label: 'Receipt photo', type: 'image' }];
  const extra = id ? [{ label: 'Delete', cls: 'danger', fn: () => { if (!confirm('Delete this expense?')) return false; db.expenses = db.expenses.filter(e => e.id !== id); save('expenses'); render(); } }] : [];
  formModal(id ? 'Edit expense' : 'New expense', fields, x, out => { out.amount = num(out.amount); if (id) Object.assign(x, out); else db.expenses.push(out); save('expenses'); toast('Expense saved'); render(); }, extra);
}
let expFilter = { cat: '', month: '' };
VIEWS.expenses = function () {
  let rows = db.expenses.slice().sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(rows.map(x => x.date.slice(0, 7)))];
  if (expFilter.cat) rows = rows.filter(x => x.category === expFilter.cat);
  if (expFilter.month) rows = rows.filter(x => x.date.startsWith(expFilter.month));
  return `<div class="page-head"><h1>Expenses</h1><span class="sp"></span><button class="btn" data-act="expCSV">Export CSV</button><button class="btn primary" data-act="newExpense">${ico('plus')} New expense</button></div>
  <div class="card"><div class="row2" style="margin-bottom:.8rem"><select data-xf="cat"><option value="">All categories</option>${CATEGORIES.map(c => `<option ${expFilter.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select data-xf="month"><option value="">All months</option>${months.map(m => `<option value="${m}" ${expFilter.month === m ? 'selected' : ''}>${L.monthLabel(m)}</option>`).join('')}</select></div>
  ${rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Project</th><th>Receipt</th><th class="r">Amount</th><th></th></tr></thead><tbody>${rows.map(x => `<tr><td>${dmy(x.date)}</td><td>${esc(x.category)}${demoBadge(x)}</td><td>${esc(x.note)}</td><td>${esc((projectOf(x.projectId) || {}).name || '')}</td><td>${x.receipt ? `<img class="thumb" src="${x.receipt}" data-act="viewReceipt" data-id="${x.id}" alt="Receipt">` : ''}</td><td class="r">${gbp(num(x.amount))}</td><td class="r"><button class="btn small" data-act="editExpense" data-id="${x.id}">Edit</button></td></tr>`).join('')}
    <tr class="tot"><td colspan="5">Total (${rows.length})</td><td class="r">${gbp(sum(rows, x => num(x.amount)))}</td><td></td></tr></tbody></table></div>` : '<div class="empty"><b>No expenses</b>Log kit, software, travel and anything else you spend on the business.</div>'}</div>`;
};
document.addEventListener('change', e => { if (e.target.dataset.xf) { expFilter[e.target.dataset.xf] = e.target.value; render(); } });
ACT.newExpense = () => editExpense(); ACT.editExpense = el => editExpense(el.dataset.id);
ACT.viewReceipt = el => { const x = db.expenses.find(e => e.id === el.dataset.id); modal('Receipt – ' + dmy(x.date), `<img src="${x.receipt}" style="width:100%;border-radius:8px" alt="Receipt">`, [{ label: 'Close' }]); };
ACT.expCSV = () => download('invoice-gogo-expenses.csv', toCSV([['Date', 'Category', 'Amount', 'Note', 'Project']].concat(db.expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => [x.date, x.category, num(x.amount).toFixed(2), x.note, (projectOf(x.projectId) || {}).name || '']))), 'text/csv');

/* ================= Cash flow ================= */
VIEWS.cashflow = function () {
  const flow = monthFlow(lastMonths(12)); let run = 0;
  const today = L.todayYMD();
  const upcoming = invoices().filter(d => ['sent', 'overdue'].includes(status(d))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const buckets = {}; upcoming.forEach(d => { const k = d.dueDate < today ? 'Overdue – chase now' : L.monthLabel(d.dueDate.slice(0, 7)); (buckets[k] = buckets[k] || []).push(d); });
  return `<div class="page-head"><h1>Cash flow</h1><span class="sub">Money in = invoices by date paid · Money out = expenses</span></div>
  <div class="card"><h3>Last 12 months</h3>${barChart(flow)}</div>
  <div class="grid g2">
  <div class="card"><h3>Month by month</h3><div class="scroll-x"><table class="t"><thead><tr><th>Month</th><th class="r">In</th><th class="r">Out</th><th class="r">Net</th><th class="r">Running</th></tr></thead><tbody>${flow.map(m => { const net = r2(m.a - m.b); run = r2(run + net); return `<tr><td>${L.monthLabel(m.key)}</td><td class="r">${gbp(m.a)}</td><td class="r">${gbp(m.b)}</td><td class="r" style="color:${net < 0 ? 'var(--danger)' : 'var(--success)'}">${gbp(net)}</td><td class="r">${gbp(run)}</td></tr>`; }).join('')}
    <tr class="tot"><td>12-month total</td><td class="r">${gbp(sum(flow, m => m.a))}</td><td class="r">${gbp(sum(flow, m => m.b))}</td><td class="r">${gbp(r2(sum(flow, m => m.a - m.b)))}</td><td></td></tr></tbody></table></div></div>
  <div class="card"><h3>Expected money in</h3>${upcoming.length ? Object.keys(buckets).map(k => `<div style="margin-bottom:.8rem"><div class="sub" style="font-weight:700;${k.startsWith('Overdue') ? 'color:var(--danger)' : ''}">${k} · ${gbp(sum(buckets[k], docTotal))}</div>
    ${buckets[k].map(attRow).join('')}</div>`).join('') : '<div class="empty"><b>Nothing outstanding</b>Sent, unpaid invoices will show here by due date.</div>'}</div></div>`;
};

/* ================= Reports ================= */
let rep = { period: 'ty:' + L.taxYearOf(L.todayYMD()), from: '', to: '' };
function repRange() {
  if (rep.period.startsWith('ty:')) return L.taxYearRange(+rep.period.slice(3));
  if (rep.period.startsWith('cy:')) { const y = rep.period.slice(3); return { from: y + '-01-01', to: y + '-12-31' }; }
  if (rep.period === 'custom') return { from: rep.from || '0000-01-01', to: rep.to || '9999-12-31' };
  return { from: '0000-01-01', to: '9999-12-31' };
}
const inR = (d, r) => d && d >= r.from && d <= r.to;
function repData() {
  const r = repRange(), inv = invoices();
  const issued = inv.filter(d => d.status !== 'draft' && inR(d.issueDate, r));
  const paid = inv.filter(d => d.status === 'paid' && inR(d.paidDate, r));
  const exps = db.expenses.filter(x => inR(x.date, r));
  const outstanding = inv.filter(d => ['sent', 'overdue'].includes(status(d)));
  const months = {};
  paid.forEach(d => { const k = d.paidDate.slice(0, 7); (months[k] = months[k] || { in: 0, out: 0 }).in += docTotal(d); });
  exps.forEach(x => { const k = x.date.slice(0, 7); (months[k] = months[k] || { in: 0, out: 0 }).out += num(x.amount); });
  const clients = {}; const cl = id => (clients[id] = clients[id] || { name: clientName(id), invoiced: 0, received: 0, owed: 0 });
  issued.forEach(d => cl(d.clientId).invoiced += docTotal(d)); paid.forEach(d => cl(d.clientId).received += docTotal(d)); outstanding.forEach(d => cl(d.clientId).owed += docTotal(d));
  const cats = {}; exps.forEach(x => cats[x.category] = (cats[x.category] || 0) + num(x.amount));
  const vatIn = sum(paid.filter(d => d.vatOn), d => L.totals(d).vat);
  return { r, issued, paid, exps, outstanding, months, clients, cats, invoiced: r2(sum(issued, docTotal)), received: r2(sum(paid, docTotal)), expenses: r2(sum(exps, x => num(x.amount))), owed: r2(sum(outstanding, docTotal)), vatIn: r2(vatIn) };
}
VIEWS.reports = function () {
  const D = repData();
  const tys = new Set([L.taxYearOf(L.todayYMD())]), cys = new Set([+L.todayYMD().slice(0, 4)]);
  invoices().forEach(d => { tys.add(L.taxYearOf(d.issueDate)); cys.add(+d.issueDate.slice(0, 4)); }); db.expenses.forEach(x => { tys.add(L.taxYearOf(x.date)); });
  const opts = [...tys].sort().reverse().map(y => [`ty:${y}`, `Tax year ${y}/${String(y + 1).slice(2)} (6 Apr–5 Apr)`]).concat([...cys].sort().reverse().map(y => [`cy:${y}`, `Calendar year ${y}`]), [['all', 'All time'], ['custom', 'Custom dates']]);
  const profit = r2(D.received - D.expenses);
  const mk = Object.keys(D.months).sort();
  return `<div class="page-head"><h1>Reports</h1><span class="sp"></span><button class="btn" data-act="repCSV">Export report CSV</button><button class="btn" data-act="invCSV">Export invoices CSV</button></div>
  <div class="card"><div class="row3"><div class="fg" style="margin:0"><label>Period</label><select id="repPeriod">${opts.map(o => `<option value="${o[0]}" ${rep.period === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>
    ${rep.period === 'custom' ? `<div class="fg" style="margin:0"><label>From</label><input type="date" id="repFrom" value="${rep.from}"></div><div class="fg" style="margin:0"><label>To</label><input type="date" id="repTo" value="${rep.to}"></div>` : ''}</div>
    <p class="note" style="margin:.7rem 0 0">Income counts when an invoice is <b>paid</b> (cash basis). Summary only – not tax advice.</p></div>
  <div class="grid g4" style="margin-bottom:1rem"><div class="stat"><span>Invoiced</span><strong>${gbp(D.invoiced)}</strong><small>${D.issued.length} invoices issued</small></div><div class="stat good"><span>Income received</span><strong>${gbp(D.received)}</strong><small>${D.paid.length} paid</small></div>
    <div class="stat fawn"><span>Expenses</span><strong>${gbp(D.expenses)}</strong><small>${D.exps.length} items</small></div><div class="stat ${profit < 0 ? 'warn' : 'good'}"><span>Profit</span><strong>${gbp(profit)}</strong><small>Outstanding now: ${gbp(D.owed)}</small></div></div>
  <div class="grid g2"><div class="card"><h3>Income by month</h3>${mk.length ? `<table class="t"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Profit</th></tr></thead><tbody>${mk.map(k => `<tr><td>${L.monthLabel(k)}</td><td class="r">${gbp(r2(D.months[k].in))}</td><td class="r">${gbp(r2(D.months[k].out))}</td><td class="r">${gbp(r2(D.months[k].in - D.months[k].out))}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="r">${gbp(D.received)}</td><td class="r">${gbp(D.expenses)}</td><td class="r">${gbp(profit)}</td></tr></tbody></table>` : '<div class="empty">No income or expenses in this period.</div>'}</div>
  <div class="card"><h3>Income by client</h3>${Object.keys(D.clients).length ? `<table class="t"><thead><tr><th>Client</th><th class="r">Invoiced</th><th class="r">Received</th><th class="r">Owed</th></tr></thead><tbody>${Object.values(D.clients).sort((a, b) => b.received - a.received).map(c => `<tr><td>${esc(c.name)}</td><td class="r">${gbp(r2(c.invoiced))}</td><td class="r">${gbp(r2(c.received))}</td><td class="r">${gbp(r2(c.owed))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'}</div></div>
  <div class="grid g2"><div class="card"><h3>Expenses by category</h3>${Object.keys(D.cats).length ? `<table class="t"><tbody>${Object.entries(D.cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${gbp(r2(v))}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="r">${gbp(D.expenses)}</td></tr></tbody></table>` : '<div class="empty">No expenses in this period.</div>'}</div>
  <div class="card"><h3>Outstanding invoices</h3>${D.outstanding.length ? listRows(D.outstanding) : '<div class="empty"><b>None</b>Everything sent has been paid.</div>'}${D.vatIn ? `<p class="note">VAT charged on paid invoices in period: ${gbp(D.vatIn)}</p>` : ''}</div></div>`;
};
document.addEventListener('change', e => {
  if (e.target.id === 'repPeriod') { rep.period = e.target.value; render(); }
  if (e.target.id === 'repFrom') { rep.from = e.target.value; render(); } if (e.target.id === 'repTo') { rep.to = e.target.value; render(); }
});
ACT.repCSV = () => {
  const D = repData(); const rows = [['Invoice GoGo report'], ['Period', D.r.from === '0000-01-01' ? 'All time' : D.r.from + ' to ' + D.r.to], [],
    ['Summary'], ['Invoiced', D.invoiced.toFixed(2)], ['Income received', D.received.toFixed(2)], ['Expenses', D.expenses.toFixed(2)], ['Profit', r2(D.received - D.expenses).toFixed(2)], ['Outstanding now', D.owed.toFixed(2)], [],
    ['Month', 'Income', 'Expenses', 'Profit']].concat(Object.keys(D.months).sort().map(k => [k, D.months[k].in.toFixed(2), D.months[k].out.toFixed(2), r2(D.months[k].in - D.months[k].out).toFixed(2)]),
    [[], ['Client', 'Invoiced', 'Received', 'Owed']], Object.values(D.clients).map(c => [c.name, c.invoiced.toFixed(2), c.received.toFixed(2), c.owed.toFixed(2)]),
    [[], ['Expense category', 'Total']], Object.entries(D.cats).map(([k, v]) => [k, v.toFixed(2)]));
  const flat = []; rows.forEach(r => Array.isArray(r[0]) ? r.forEach(x => flat.push(x)) : flat.push(r));
  download('invoice-gogo-report.csv', toCSV(flat), 'text/csv');
};
ACT.invCSV = () => download('invoice-gogo-invoices.csv', toCSV([['Number', 'Type', 'Client', 'Project', 'Issue date', 'Due date', 'Status', 'Paid date', 'Subtotal', 'Discount', 'VAT', 'Total']].concat(db.invoices.slice().sort((a, b) => a.issueDate.localeCompare(b.issueDate)).map(d => { const t = L.totals(d); return [d.number, d.type, clientName(d.clientId), (projectOf(d.projectId) || {}).name || '', d.issueDate, d.dueDate, status(d), d.paidDate || '', t.subtotal.toFixed(2), t.discount.toFixed(2), t.vat.toFixed(2), t.total.toFixed(2)]; }))), 'text/csv');

/* ================= Integrated apps ================= */
VIEWS.apps = function () {
  const card = (icon, title, body, btn) => `<div class="card app-card"><div class="logo">${ico(icon)}</div><div style="flex:1"><h4>${title}</h4><p>${body}</p>${btn || ''}</div></div>`;
  const imported = Object.keys(db.imported).filter(k => docOf(db.imported[k])).length;
  return `<div class="page-head"><h1>Integrated apps</h1></div>
  <div class="grid g2">
  ${card('clock', 'Sewing Studio Timesheet <span class="badge b-done">Available</span>', `Turn the hours you log into an invoice in a couple of taps. Export <b>Backup (JSON)</b> or <b>CSV</b> from the timesheet app, then import it here. ${imported ? `<br><b>${imported}</b> sessions already invoiced.` : ''}`, `<div class="btn-row"><a class="btn primary" href="#/import">Import from Sewing Studio Timesheet</a><a class="btn" target="_blank" rel="noopener" href="https://sewing-studio-timesheet.netlify.app/">Open timesheet app</a></div>`)}
  ${card('drive', 'Google Drive <span class="badge b-draft">Planned</span>', 'Not connected yet. For now: open an invoice → Print / Save as PDF (or Download PDF) and drop the file in your Drive folder. Automatic “save every sent invoice to Drive” is on the wishlist.')}
  ${card('apps', 'Netlify &amp; GitHub <span class="badge b-draft">Hosting</span>', 'Invoice GoGo is a plain static site, so it deploys straight to Netlify from the GitHub repo. Your invoice data never leaves your device – it lives in this browser\'s storage.')}
  ${card('invoices', 'Accounting software <span class="badge b-draft">Via CSV</span>', 'Xero, QuickBooks, FreeAgent and similar can take a CSV. Use Reports → Export invoices CSV / report CSV. Direct connections are not built.', `<a class="btn" href="#/reports">Open reports</a>`)}
  ${card('cashflow', 'Online card payments <span class="badge b-draft">Planned</span>', 'Stripe / PayPal / GoCardless “Pay now” links are not included. For now invoices show your bank details and a payment reference.')}
  ${card('settings', 'Backup &amp; sync <span class="badge b-draft">Manual</span>', 'Data is stored on this device only. Use Settings → Backup to move it to your phone or Mac, or to keep a safe copy.', `<a class="btn" href="#/settings">Open settings</a>`)}
  </div>`;
};

/* ================= Timesheet import ================= */
let imp = null;
const IMP_RANGES = [['this-week', 'This week'], ['last-week', 'Last week'], ['this-month', 'This month'], ['last-month', 'Last month'], ['all', 'All in file'], ['custom', 'Custom']];
const isInvoiced = key => { const id = db.imported[key]; return id && docOf(id) ? docOf(id) : null; };
function impRangeSessions() {
  if (!imp) return [];
  const r = imp.range === 'custom' ? { from: imp.from || '0000-01-01', to: imp.to || '9999-12-31' } : L.rangeFor(imp.range);
  return imp.sessions.filter(s => s.date >= r.from && s.date <= r.to);
}
function impSelectDefault() { imp.sel = new Set(impRangeSessions().filter(s => !isInvoiced(s.key)).map(s => s.key)); }
function impLoadText(text, name) {
  try {
    const r = L.parseTimesheetFile(text);
    if (!r.sessions.length) { toast('No sessions found in that file.'); return; }
    imp = { name, kind: r.kind, sessions: r.sessions, range: 'all', from: '', to: '', sel: new Set(), clientId: (db.clients.find(c => /sewing studio/i.test(c.name)) || db.clients[0] || {}).id || '' };
    for (const k of ['this-week', 'last-week', 'this-month', 'last-month', 'all']) { imp.range = k; if (impRangeSessions().some(s => !isInvoiced(s.key))) break; }
    impSelectDefault(); render();
  } catch (e) { toast(e.message); }
}
VIEWS.import = function () {
  const rows = impRangeSessions();
  const chosen = imp ? imp.sessions.filter(s => imp.sel.has(s.key)) : [];
  const hours = sum(chosen, s => s.hours), amount = r2(sum(chosen, s => L.lineAmount({ qty: s.hours, rate: s.rate })));
  return `<div class="page-head"><a class="btn small" href="#/apps">‹ Apps</a><h1>Import hours from Sewing Studio Timesheet</h1></div>
  <div class="card"><h3>1. Choose your timesheet export</h3>
    <label class="dz" id="dz" for="impFile" style="display:block"><b>Tap to choose a file</b> or drop it here<br><span class="note">Backup JSON (sewing_studio_timesheet_backup.json) or CSV (sewing_studio_timesheet.csv) from the timesheet app</span></label>
    <input type="file" id="impFile" accept=".json,.csv,application/json,text/csv,text/plain" class="hidden">
    ${imp ? `<p class="note" style="margin:.7rem 0 0">✓ <b>${esc(imp.name)}</b> – ${imp.sessions.length} sessions (${imp.kind.toUpperCase()}), ${dmy(imp.sessions[0].date)} to ${dmy(imp.sessions[imp.sessions.length - 1].date)}</p>` : ''}</div>
  ${imp ? `<div class="card"><h3>2. Pick a date range</h3><div class="chips">${IMP_RANGES.map(r => `<button class="chip ${imp.range === r[0] ? 'on' : ''}" data-act="impRange" data-v="${r[0]}">${r[1]}</button>`).join('')}</div>
    ${imp.range === 'custom' ? `<div class="row2"><div class="fg"><label>From</label><input type="date" id="impFrom" value="${imp.from}"></div><div class="fg"><label>To</label><input type="date" id="impTo" value="${imp.to}"></div></div>` : ''}</div>
  <div class="card"><h3>3. Preview sessions</h3>
    ${rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th></th><th>Date</th><th>Time</th><th class="r">Hours</th><th class="r hm">Rate</th><th class="r">Amount</th><th class="hm">Type</th><th>Status</th></tr></thead><tbody>${rows.map(s => { const inv = isInvoiced(s.key); return `<tr style="${inv ? 'opacity:.6' : ''}"><td><input type="checkbox" data-impchk="${esc(s.key)}" ${imp.sel.has(s.key) ? 'checked' : ''} ${inv ? 'disabled' : ''} aria-label="Include"></td><td>${dmy(s.date)}</td><td style="white-space:nowrap">${s.inHM}–${s.outHM}</td><td class="r">${qtyFmt(s.hours)}</td><td class="r hm">${gbp(s.rate)}</td><td class="r">${gbp(L.lineAmount({ qty: s.hours, rate: s.rate }))}</td><td class="hm">${esc(s.location)}${s.notes ? ` <span class="note">· ${esc(s.notes)}</span>` : ''}</td><td>${inv ? `<a href="#/invoice/${inv.id}"><span class="badge b-converted">Invoiced ${esc(inv.number)}</span></a>` : '<span class="badge b-active">New</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="totals-box" style="max-width:none;text-align:right;margin-top:.8rem"><b>${chosen.length}</b> sessions selected · <b>${qtyFmt(hours)}</b> hours · <b style="color:var(--teal-dark)">${gbp(amount)}</b></div>` : '<div class="empty"><b>No sessions in this range</b>Try another range.</div>'}</div>
  <div class="card"><h3>4. Create the invoice</h3><div class="row2"><div class="fg"><label>Bill to</label><select id="impClient">${db.clients.map(c => `<option value="${c.id}" ${c.id === imp.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
    <p class="note">Each session becomes a line like <i>Content work – 09/11/2026 (09:30–17:00)</i>, hours × the rate from the timesheet. Sessions already on an invoice are skipped so nothing is billed twice.</p>
    <button class="btn primary" data-act="impCreate" ${chosen.length ? '' : 'disabled'}>Create invoice (${gbp(amount)})</button></div>` : `<div class="card"><h3>How it works</h3><ol style="margin:0;padding-left:1.2rem;line-height:1.8"><li>In the timesheet app tap <b>Export JSON</b> (Backup) or <b>Export CSV</b>.</li><li>Choose that file above.</li><li>Pick the week or month, check the sessions, create the invoice.</li></ol><p class="note">The file is read in your browser only – nothing is uploaded anywhere.</p></div>`}`;
};
VIEWS.after_import = function () {
  const inp = $('#impFile'); const dz = $('#dz');
  const read = f => { if (!f) return; const fr = new FileReader(); fr.onload = () => impLoadText(fr.result, f.name); fr.onerror = () => toast('Could not read that file'); fr.readAsText(f); };
  inp.addEventListener('change', () => read(inp.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => read(e.dataTransfer.files[0]));
};
ACT.impRange = el => { imp.range = el.dataset.v; impSelectDefault(); render(); };
document.addEventListener('change', e => {
  if (!imp) return;
  if (e.target.dataset.impchk) { const k = e.target.dataset.impchk; e.target.checked ? imp.sel.add(k) : imp.sel.delete(k); render(); }
  if (e.target.id === 'impFrom') { imp.from = e.target.value; impSelectDefault(); render(); }
  if (e.target.id === 'impTo') { imp.to = e.target.value; impSelectDefault(); render(); }
  if (e.target.id === 'impClient') imp.clientId = e.target.value;
});
ACT.impCreate = () => {
  const chosen = imp.sessions.filter(s => imp.sel.has(s.key) && !isInvoiced(s.key)); if (!chosen.length) return;
  const item = db.items.find(i => /content work/i.test(i.name));
  const range = chosen[0].date === chosen[chosen.length - 1].date ? dmy(chosen[0].date) : dmy(chosen[0].date) + ' – ' + dmy(chosen[chosen.length - 1].date);
  ed = newDoc('invoice', { clientId: imp.clientId, lines: chosen.map(s => L.sessionLine(s, item)), sessionKeys: chosen.map(s => s.key), notes: 'Hours worked ' + range + '.' });
  go('invoice/new');
};

/* ================= Settings ================= */
const S_TEXT = (k, label, type, ph) => `<div class="fg"><label>${label}</label><input type="${type || 'text'}" data-s="${k}" value="${esc(db.settings[k])}" placeholder="${esc(ph || '')}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''}></div>`;
function sampleDoc() {
  const t = L.todayYMD(); const c = db.clients[0];
  return { type: 'invoice', number: db.settings.invPrefix + '0001', clientId: c && c.id, issueDate: t, dueDate: L.addDays(t, db.settings.terms), status: 'sent', terms: db.settings.terms,
    lines: [{ desc: 'Content work – ' + dmy(t) + ' (09:30–17:00)', qty: 7.5, rate: 22, unit: 'hour' }, { desc: 'Product photography – extra shoot day', qty: 1, rate: 150, unit: 'each' }], discountType: 'percent', discountValue: 0, vatOn: false, vatRate: db.settings.vatRate, notes: 'Sample preview – your real invoices will look like this.', lateNote: db.settings.lateNote };
}
VIEWS.settings = function () {
  const s = db.settings;
  return `<div class="page-head"><h1>Settings</h1></div>
  <div class="grid g2" style="align-items:start"><div>
  <div class="card"><h3>Your business</h3>${S_TEXT('name', 'Business / your name')}${S_TEXT('tagline', 'Tagline (shown when no logo)')}
    <div class="fg"><label>Address</label><textarea data-s="address">${esc(s.address)}</textarea></div>${S_TEXT('email', 'Email', 'email')}${S_TEXT('phone', 'Phone', 'tel')}${S_TEXT('vatNumber', 'VAT number (only if registered)')}</div>
  <div class="card"><h3>Payment details</h3><p class="note" style="margin-top:0">Shown on invoices. Stored only on this device.</p>${S_TEXT('bankName', 'Bank name')}${S_TEXT('accountName', 'Account name')}
    <div class="row2">${S_TEXT('sortCode', 'Sort code', 'text', '00-00-00')}${S_TEXT('accountNumber', 'Account number', 'text', '00000000')}</div>
    <label class="chk"><input type="checkbox" data-s="payRef" ${s.payRef ? 'checked' : ''}> Show invoice number as payment reference</label></div>
  <div class="card"><h3>Invoice defaults</h3>
    <div class="fg"><label>Default payment terms</label><select data-s="terms">${[0, 7, 14, 30].map(t => `<option value="${t}" ${+s.terms === t ? 'selected' : ''}>${termsLabel(t)}</option>`).join('')}</select></div>
    <div class="row2">${S_TEXT('invPrefix', 'Invoice prefix')}${S_TEXT('nextInvoice', 'Next invoice number', 'number')}${S_TEXT('estPrefix', 'Estimate prefix')}${S_TEXT('nextEstimate', 'Next estimate number', 'number')}</div>
    <div class="row2">${S_TEXT('estValidDays', 'Estimates valid for (days)', 'number')}${S_TEXT('vatRate', 'VAT rate %', 'number')}</div>
    <label class="chk" style="margin-bottom:.6rem"><input type="checkbox" data-s="vatDefaultOn" ${s.vatDefaultOn ? 'checked' : ''}> Add VAT to new invoices by default <span class="note">(off – only if you're VAT registered)</span></label>
    <label class="chk"><input type="checkbox" data-s="lateNote" ${s.lateNote ? 'checked' : ''}> Add the late-payment (statutory interest) note to new invoices</label>
    <p class="note">“${esc(LATE_NOTE)}”</p></div>
  </div><div>
  <div class="card"><h3>Invoice design</h3>
    <div class="fg"><label>Template</label><div class="tpl-pick">${['classic', 'modern', 'minimal'].map(t => `<label class="${s.template === t ? 'on' : ''}"><input type="radio" name="tpl" value="${t}" data-s="template" ${s.template === t ? 'checked' : ''}>${t[0].toUpperCase() + t.slice(1)}</label>`).join('')}</div></div>
    <div class="fg"><label>Accent colour</label><div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><input type="color" data-s="accent" value="${esc(s.accent)}"><input type="text" data-s="accentHex" value="${esc(s.accent)}" style="width:110px" aria-label="Hex colour">
      ${['#008080', '#E5A361', '#1d4ed8', '#9d174d', '#374151', '#15803d'].map(c => `<button class="chip" data-act="setAccent" data-c="${c}" style="background:${c};border-color:${c};width:28px;height:28px;padding:0" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="fg"><label>Logo</label><div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap">${s.logo ? `<img class="logo-prev" src="${s.logo}" alt="Logo">` : '<span class="note">No logo</span>'}<input type="file" id="logoFile" accept="image/*" style="width:auto">${s.logo ? '<button class="btn small danger" data-act="rmLogo">Remove</button>' : ''}</div></div>
    ${S_TEXT('footer', 'Footer text')}
    <div class="label note" style="margin-bottom:.4rem">Live preview</div><div id="setPreview" class="doc-wrap"></div></div>
  <div class="card"><h3>Data &amp; backup</h3><p class="note" style="margin-top:0">Everything is stored in this browser (keys start with <code>igg_</code>). Make a backup before clearing browser data.</p>
    <div class="btn-row"><button class="btn primary" data-act="backup">Download backup (JSON)</button><label class="btn" for="restoreFile">Restore from backup…</label><input type="file" id="restoreFile" accept=".json,application/json" class="hidden"></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
    <div class="btn-row"><button class="btn fawn" data-act="loadDemo">Load demo data</button><button class="btn" data-act="removeDemo">Remove demo data</button></div>
    <p class="note">Demo data is clearly labelled “Demo” and can be removed in one click without touching your real records.</p>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0"><button class="btn danger" data-act="wipe">Erase everything…</button></div>
  </div></div>`;
};
VIEWS.after_settings = function () {
  paintSetPreview();
  $('#logoFile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { db.settings.logo = await resizeImage(f, 420, 'image/png'); save('settings'); render(); } catch (err) { toast(err.message); } });
  $('#restoreFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => restore(fr.result); fr.readAsText(f); e.target.value = ''; });
};
function paintSetPreview() {
  const p = $('#setPreview'); if (!p) return; const sc = Math.min(1, ((p.clientWidth || 400) - 2) / 794);
  p.innerHTML = `<div class="pv-outer" style="width:${794 * sc}px;margin:0 auto;overflow:hidden"><div class="pv-inner" style="transform:scale(${sc});transform-origin:top left;width:794px">${renderPaper(sampleDoc())}</div></div>`;
  $('.pv-outer', p).style.height = ($('.pv-inner', p).offsetHeight * sc) + 'px';
}
const HEX = /^#[0-9a-f]{6}$/i;
function setSetting(el) {
  const k = el.dataset.s, s = db.settings; let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'accentHex') { if (!HEX.test(v)) return; s.accent = v; const c = $('[data-s="accent"]'); if (c) c.value = v; }
  else if (k === 'accent') { s.accent = v; const h = $('[data-s="accentHex"]'); if (h) h.value = v; }
  else if (['terms', 'estValidDays', 'nextInvoice', 'nextEstimate', 'vatRate'].includes(k)) { v = num(v); if (['nextInvoice', 'nextEstimate'].includes(k)) v = Math.max(1, Math.floor(v)); s[k] = v; }
  else s[k] = v;
  if (k === 'template') $$('.tpl-pick label').forEach(l => l.classList.toggle('on', $('input', l).checked));
  save('settings'); paintSetPreview();
}
document.addEventListener('input', e => { if (e.target.dataset.s && e.target.type !== 'radio') setSetting(e.target); });
document.addEventListener('change', e => { if (e.target.dataset.s) setSetting(e.target); });
ACT.setAccent = el => { db.settings.accent = el.dataset.c; save('settings'); render(); };
ACT.rmLogo = () => { db.settings.logo = ''; save('settings'); render(); };
ACT.backup = () => {
  const data = {}; KEYS.forEach(k => data[k] = db[k]);
  download('invoice-gogo-backup-' + L.todayYMD() + '.json', JSON.stringify({ app: 'invoice-gogo', version: 1, exported: new Date().toISOString(), data }, null, 1), 'application/json');
  toast('Backup downloaded');
};
function restore(text) {
  try {
    const j = JSON.parse(text); if (!j || j.app !== 'invoice-gogo' || !j.data) throw new Error('not an Invoice GoGo backup');
    if (!confirm('Restore this backup? It will REPLACE everything currently in the app (' + (j.data.invoices || []).length + ' invoices/estimates in the file).')) return;
    KEYS.forEach(k => { db[k] = j.data[k] != null ? j.data[k] : clone(DEFAULTS[k]); }); db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings, { seeded: true });
    saveAll(); toast('Backup restored'); render();
  } catch (e) { toast('Could not restore: ' + e.message); }
}
ACT.wipe = () => { if (!confirm('Erase ALL invoices, clients, expenses and settings from this device? Download a backup first if unsure.')) return; if (!confirm('Really erase everything?')) return; KEYS.forEach(k => localStorage.removeItem('igg_' + k)); load(); toast('All data erased'); go('dashboard'); render(); };

/* ================= Demo data ================= */
function loadDemo() {
  if (db.clients.some(c => c.demo)) { toast('Demo data is already loaded'); return; }
  const s = db.settings; s.preDemo = { nextInvoice: s.nextInvoice, nextEstimate: s.nextEstimate };
  const T = L.todayYMD(), ago = n => L.addDays(T, -n), D = o => Object.assign({ demo: true }, o);
  const cs = [D({ id: uid(), name: 'Harbour Surf Co.', contact: 'Tamsin Pascoe', email: 'tamsin@harboursurf.example', phone: '', address: '4 The Wharf\nPadstow\nCornwall', notes: '' }),
    D({ id: uid(), name: 'Kernow Ceramics', contact: 'Ben Trevithick', email: 'ben@kernowceramics.example', phone: '', address: 'Unit 3, Foundry Row\nHayle\nCornwall', notes: '' }),
    D({ id: uid(), name: 'Trevose Bakery', contact: '', email: 'hello@trevosebakery.example', phone: '', address: '12 Fore Street\nSt Ives\nCornwall', notes: '' })];
  db.clients.push(...cs); const [hb, kc, tb] = cs;
  const ps = [D({ id: uid(), name: 'Summer lookbook', clientId: hb.id, status: 'active', notes: 'Photo + short video set' }), D({ id: uid(), name: 'Web shop product photos', clientId: kc.id, status: 'done', notes: '' })];
  db.projects.push(...ps);
  db.items.push(D({ id: uid(), name: 'Product shoot – half day', description: 'Up to 4 hours, edited selects', rate: 150, unit: 'each' }), D({ id: uid(), name: 'Photo editing', description: 'Retouching & colour', rate: 25, unit: 'hour' }));
  const mk = (c, proj, issueAgo, lines, st, terms, paidAfter) => {
    const nn = L.nextNumber(db.invoices, 'invoice', s.invPrefix, s.nextInvoice); s.nextInvoice = nn.n + 1;
    const issue = ago(issueAgo), due = L.addDays(issue, terms);
    const d = D({ id: uid(), type: 'invoice', number: nn.number, clientId: c.id, projectId: proj ? proj.id : '', issueDate: issue, terms, dueDate: due, status: st, lines, discountType: 'percent', discountValue: 0, vatOn: false, vatRate: s.vatRate, notes: '', lateNote: false, createdAt: new Date().toISOString() });
    if (st === 'paid') d.paidDate = L.addDays(issue, paidAfter || 12);
    db.invoices.push(d); return d;
  };
  const shoot = n => ({ desc: 'Product shoot – half day', qty: n, rate: 150, unit: 'each' }), edit = n => ({ desc: 'Photo editing', qty: n, rate: 25, unit: 'hour' }), work = n => ({ desc: 'Content work', qty: n, rate: 22, unit: 'hour' });
  mk(hb, ps[0], 150, [shoot(2), edit(6)], 'paid', 14, 9); mk(kc, ps[1], 118, [work(24)], 'paid', 14, 15); mk(tb, null, 92, [shoot(1), edit(4)], 'paid', 14, 11);
  mk(hb, ps[0], 16, [shoot(1), edit(2)], 'paid', 14, 7); mk(hb, ps[0], 63, [shoot(3), edit(10)], 'paid', 14, 13); mk(kc, ps[1], 41, [work(30), { desc: 'Travel to Hayle', qty: 1, rate: 18, unit: 'each' }], 'paid', 14, 12);
  mk(tb, null, 32, [shoot(2)], 'sent', 14); // overdue
  mk(hb, ps[0], 9, [shoot(1), edit(3)], 'sent', 14); mk(kc, null, 2, [work(15)], 'draft', 14);
  const en = L.nextNumber(db.invoices, 'estimate', s.estPrefix, s.nextEstimate); s.nextEstimate = en.n + 1;
  db.invoices.push(D({ id: uid(), type: 'estimate', number: en.number, clientId: hb.id, projectId: ps[0].id, issueDate: ago(5), terms: 30, dueDate: L.addDays(ago(5), 30), status: 'sent', lines: [{ desc: 'Autumn campaign – 2 shoot days + editing', qty: 2, rate: 280, unit: 'each' }, edit(8)], discountType: 'percent', discountValue: 10, vatOn: false, vatRate: s.vatRate, notes: 'Includes usage on web and social.', lateNote: false, createdAt: new Date().toISOString() }));
  const ex = [[160, 'Equipment', 'Prime lens 50mm', 389], [128, 'Software & subscriptions', 'Photo editing subscription', 19.97], [98, 'Software & subscriptions', 'Photo editing subscription', 19.97], [68, 'Software & subscriptions', 'Photo editing subscription', 19.97], [37, 'Software & subscriptions', 'Photo editing subscription', 19.97],
    [6, 'Software & subscriptions', 'Photo editing subscription', 19.97], [105, 'Insurance', 'Public liability insurance', 96], [55, 'Travel & transport', 'Fuel – St Ives shoot', 34.2], [20, 'Materials & props', 'Backdrops & foam boards', 41.5], [12, 'Equipment', 'Portable LED panel', 79.99], [3, 'Travel & transport', 'Parking – Hayle', 6.4]];
  ex.forEach(e => db.expenses.push(D({ id: uid(), date: ago(e[0]), category: e[1], note: e[2], amount: e[3], projectId: '', receipt: '' })));
  saveAll(); toast('Demo data loaded – everything is labelled “Demo”'); render();
}
ACT.removeDemo = () => {
  if (!confirm('Remove all demo data? Your own records are kept.')) return;
  ['clients', 'invoices', 'items', 'expenses', 'projects'].forEach(k => db[k] = db[k].filter(x => !x.demo));
  Object.keys(db.imported).forEach(k => { if (!docOf(db.imported[k])) delete db.imported[k]; });
  if (db.settings.preDemo) { db.settings.nextInvoice = db.settings.preDemo.nextInvoice; db.settings.nextEstimate = db.settings.preDemo.nextEstimate; db.settings.preDemo = null; }
  saveAll(); toast('Demo data removed'); render();
};

/* ================= More (mobile menu) ================= */
VIEWS.more = function () {
  return `<div class="page-head"><h1>More</h1></div><div class="card"><div class="list">${NAV.filter(n => !['dashboard', 'invoices', 'clients', 'expenses'].includes(n[0])).map(n => `<a class="li c3" style="grid-template-columns:30px 1fr;color:inherit" href="#/${n[0]}">${ico(n[2])}<b>${n[1]}</b></a>`).join('')}
  <a class="li c3" style="grid-template-columns:30px 1fr;color:inherit" href="#/import">${ico('clock')}<b>Import hours</b></a></div></div>`;
};

/* ================= init ================= */
load(); buildShell();
if (!location.hash) location.hash = '#/dashboard';
render();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__igg = { db: () => db, L, render, state: () => ({ ed, imp }) };
})();
