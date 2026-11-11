/* Invoice GoGo – text-based A4 PDF drawn directly with jsPDF (selectable text, small files). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.IGGPdf = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x008080; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const money = (L, v) => L.gbp(v);
  const qty = n => String(Math.round((Number(n) || 0) * 100) / 100);
  const UNIT = { hour: ' hrs', day: ' days', each: '' };
  const LATE_NOTE = 'Statutory interest may be charged on late payments under the Late Payment of Commercial Debts (Interest) Act 1998.';

  /** d: invoice/estimate record · ctx: {L, settings, client, project, status, logo (data URL or ''), jsPDF} → jsPDF doc */
  function build(ctx) {
    const { L, settings: s, client: c = {}, project: proj, jsPDF } = ctx, d = ctx.doc;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const W = 595.28, H = 841.89, M = 44, R = W - M, BOT = H - 60;
    const acc = hex(s.accent), onAcc = lum(acc) > 170 ? [31, 41, 55] : [255, 255, 255];
    const tpl = s.template || 'classic', isEst = d.type === 'estimate', t = L.totals(d), st = ctx.status || d.status;
    const dark = [31, 41, 55], mute = [107, 114, 128], rule = [229, 231, 235];
    const col = c => pdf.setTextColor(c[0], c[1], c[2]), draw = c => pdf.setDrawColor(c[0], c[1], c[2]), fill = c => pdf.setFillColor(c[0], c[1], c[2]);
    const font = (style, size, fam) => { pdf.setFont(fam || 'helvetica', style); pdf.setFontSize(size); };
    pdf.setProperties({ title: (d.number || 'Invoice') + ' – ' + (c.name || ''), author: s.name || '', creator: 'Invoice GoGo' });
    let y = M;

    /* ---- header ---- */
    let headEnd;
    if (tpl === 'modern') { fill(acc); pdf.rect(0, 0, W, 112, 'F'); }
    const headTxt = tpl === 'modern' ? onAcc : dark, headMute = tpl === 'modern' ? onAcc : mute;
    let ly = M;
    if (ctx.logo) {
      try { const p = pdf.getImageProperties(ctx.logo); const k = Math.min(150 / p.width, 48 / p.height, 1); pdf.addImage(ctx.logo, p.fileType || 'PNG', M, ly - 4, p.width * k, p.height * k); ly += p.height * k + 6; } catch (e) { /* ignore bad logo */ }
    }
    font('bold', tpl === 'minimal' ? 14 : 17, tpl === 'classic' ? 'times' : 'helvetica'); col(headTxt); pdf.text(s.name || 'Your business', M, ly + 10); ly += 24;
    font('normal', 9); col(headMute);
    [!ctx.logo && s.tagline, ...(s.address || '').split('\n'), s.email, s.phone, s.vatNumber && 'VAT no. ' + s.vatNumber].filter(Boolean).forEach(line => { pdf.text(String(line), M, ly); ly += 12; });
    font(tpl === 'classic' ? 'normal' : 'bold', tpl === 'minimal' ? 18 : 26, tpl === 'classic' ? 'times' : 'helvetica'); col(tpl === 'modern' ? onAcc : (tpl === 'minimal' ? dark : acc));
    pdf.text(isEst ? 'ESTIMATE' : (d.vatOn ? 'TAX INVOICE' : 'INVOICE'), R, M + 14, { align: 'right', charSpace: tpl === 'classic' ? 3 : (tpl === 'minimal' ? 3 : 0) });
    font('bold', 10); col(tpl === 'modern' ? onAcc : dark); pdf.text(d.number || '', R, M + 32, { align: 'right' });
    font('normal', 9); col(tpl === 'modern' ? onAcc : mute);
    pdf.text((isEst ? 'Date: ' : 'Issued: ') + L.dmy(d.issueDate), R, M + 45, { align: 'right' });
    font('bold', 9); pdf.text((isEst ? 'Valid until: ' : 'Due: ') + L.dmy(d.dueDate), R, M + 58, { align: 'right' });
    headEnd = Math.max(ly, M + 66, tpl === 'modern' ? 112 : 0);
    if (tpl !== 'modern') { draw(tpl === 'minimal' ? [209, 213, 219] : acc); pdf.setLineWidth(tpl === 'classic' ? 1.6 : 0.6); pdf.line(M, headEnd + 6, R, headEnd + 6); if (tpl === 'classic') { pdf.setLineWidth(0.5); pdf.line(M, headEnd + 10, R, headEnd + 10); } headEnd += 8; }
    y = headEnd + 28;

    /* ---- parties ---- */
    font('bold', 7.5); col(tpl === 'minimal' ? mute : acc); pdf.text(isEst ? 'PREPARED FOR' : 'BILL TO', M, y, { charSpace: 0.8 });
    font('bold', 10.5); col(dark); pdf.text(c.name || 'Client', M, y + 14);
    font('normal', 9.5); let by = y + 27;
    [c.contact, ...(c.address || '').split('\n'), c.email].filter(Boolean).forEach(l => { pdf.text(String(l), M, by); by += 12.5; });
    if (proj) { font('bold', 7.5); col(tpl === 'minimal' ? mute : acc); pdf.text('PROJECT', R, y, { align: 'right', charSpace: 0.8 }); font('normal', 9.5); col(dark); pdf.text(proj.name, R, y + 14, { align: 'right' }); }
    y = Math.max(by, y + 40) + 14;

    /* ---- table ---- */
    const xQ = R - 190, xR = R - 105, xA = R, wDesc = xQ - M - 40;
    const head = () => {
      if (tpl === 'modern') { fill([243, 244, 246]); pdf.rect(M, y - 12, R - M, 22, 'F'); }
      font('bold', 7.5); col(tpl === 'minimal' ? mute : acc);
      pdf.text('DESCRIPTION', M + (tpl === 'modern' ? 6 : 0), y + 2, { charSpace: 0.6 }); pdf.text('QTY', xQ, y + 2, { align: 'right', charSpace: 0.6 }); pdf.text('RATE', xR, y + 2, { align: 'right', charSpace: 0.6 }); pdf.text('AMOUNT', xA - (tpl === 'modern' ? 6 : 0), y + 2, { align: 'right', charSpace: 0.6 });
      if (tpl !== 'modern') { draw(tpl === 'minimal' ? dark : acc); pdf.setLineWidth(tpl === 'minimal' ? 0.5 : 1.4); pdf.line(M, y + 9, R, y + 9); }
      y += 24;
    };
    head();
    const lines = (d.lines || []).filter(l => l.desc || l.qty || l.rate);
    font('normal', 9.5);
    lines.forEach(l => {
      font('normal', 9.5); const wrapped = pdf.splitTextToSize(String(l.desc || ''), wDesc); const h = Math.max(1, wrapped.length) * 12.5 + 8;
      if (y + h > BOT - 40) { pdf.addPage(); y = M; head(); }
      col(dark); pdf.text(wrapped, M + (tpl === 'modern' ? 6 : 0), y);
      pdf.text(qty(l.qty) + (UNIT[l.unit] || ''), xQ, y, { align: 'right' }); pdf.text(money(L, Number(l.rate) || 0), xR, y, { align: 'right' }); pdf.text(money(L, L.lineAmount(l)), xA - (tpl === 'modern' ? 6 : 0), y, { align: 'right' });
      y += h - 4; draw(rule); pdf.setLineWidth(0.5); pdf.line(M, y - 6, R, y - 6); y += 2;
    });
    if (!lines.length) { col(mute); pdf.text('No line items', M, y); y += 20; }

    /* ---- totals ---- */
    if (y + 110 > BOT) { pdf.addPage(); y = M; }
    y += 6; const tx = R - 190;
    const row = (label, val, bold) => { font(bold ? 'bold' : 'normal', 9.5); col(dark); pdf.text(label, tx + 6, y); pdf.text(val, R - 6, y, { align: 'right' }); y += 15; };
    row('Subtotal', money(L, t.subtotal));
    if (t.discount) row('Discount' + (d.discountType === 'percent' ? ' (' + qty(d.discountValue) + '%)' : ''), '-' + money(L, t.discount));
    if (d.vatOn) row('VAT (' + qty(d.vatRate) + '%)', money(L, t.vat));
    y += 2; const totalLabel = isEst ? 'Estimated total' : (st === 'paid' ? 'Total paid' : 'Total due');
    if (tpl === 'modern') { fill(acc); pdf.roundedRect(tx, y - 13, 190, 24, 4, 4, 'F'); font('bold', 12); col(onAcc); }
    else { draw(tpl === 'minimal' ? dark : acc); pdf.setLineWidth(tpl === 'minimal' ? 0.5 : 1.4); pdf.line(tx, y - 13, R, y - 13); font('bold', 12); col(tpl === 'minimal' ? dark : acc); }
    pdf.text(totalLabel, tx + 6, y + 3); pdf.text(money(L, t.total), R - 6, y + 3, { align: 'right' }); y += 24;
    if (!isEst && st === 'paid' && d.paidDate) { font('normal', 8.5); col([5, 150, 105]); pdf.text('Paid on ' + L.dmy(d.paidDate), R - 6, y - 4, { align: 'right' }); y += 8; }
    if (st === 'paid' && !isEst) { pdf.saveGraphicsState && pdf.saveGraphicsState(); draw([5, 150, 105]); pdf.setLineWidth(2); font('bold', 22); col([5, 150, 105]); pdf.text('PAID', W - 150, headEnd + 70, { angle: 10, charSpace: 2 }); }

    /* ---- payment details & notes ---- */
    const bank = [s.bankName && 'Bank: ' + s.bankName, s.accountName && 'Account name: ' + s.accountName, s.sortCode && 'Sort code: ' + s.sortCode, s.accountNumber && 'Account number: ' + s.accountNumber].filter(Boolean);
    if (!isEst && s.payRef !== false && bank.length) bank.push('Reference: ' + (d.number || ''));
    const notes = d.notes ? pdf.splitTextToSize(String(d.notes), 230) : [];
    const blockH = Math.max(!isEst ? bank.length * 12.5 : 0, notes.length * 12.5) + 24;
    if ((bank.length && !isEst) || notes.length) {
      y += 22; if (y + blockH > BOT) { pdf.addPage(); y = M; }
      font('bold', 7.5); col(tpl === 'minimal' ? mute : acc);
      if (!isEst && bank.length) { pdf.text('PAYMENT DETAILS', M, y, { charSpace: 0.8 }); font('normal', 9.5); col(dark); bank.forEach((b, i) => pdf.text(b, M, y + 14 + i * 12.5)); }
      if (notes.length) { font('bold', 7.5); col(tpl === 'minimal' ? mute : acc); pdf.text('NOTES', M + 270, y, { charSpace: 0.8 }); font('normal', 9.5); col(dark); pdf.text(notes, M + 270, y + 14); }
      y += blockH;
    }
    if (!isEst && d.lateNote) { if (y + 30 > BOT) { pdf.addPage(); y = M; } font('normal', 8); col(mute); pdf.text(pdf.splitTextToSize(LATE_NOTE, R - M), M, y + 6); y += 24; }

    /* ---- footer + page numbers ---- */
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i); font('normal', 8.5); col(mute);
      if (s.footer && i === pages) { draw(rule); pdf.setLineWidth(0.5); pdf.line(M, H - 54, R, H - 54); pdf.text(String(s.footer), W / 2, H - 38, { align: 'center' }); }
      if (pages > 1) pdf.text('Page ' + i + ' of ' + pages, R, H - 20, { align: 'right' });
    }
    return pdf;
  }
  return { build, LATE_NOTE };
});
