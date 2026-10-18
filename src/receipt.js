const PDFDocument = require('pdfkit');
const config = require('./config');
const { dateLabel, batchLabel } = require('./util');

// PDFKit's built-in fonts have no ₹ glyph, so receipts spell out "Rs.".
const rs = (n) => `Rs. ${Number(n).toLocaleString('en-IN')}`;
const plain = (text) => (text || '').replace(/₹/g, 'Rs. ');

function amountInWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]} ${ones[x % 10]}`.trim());
  const three = (x) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(' ');
}

// Streams an A5 receipt PDF for `payment` (joined with student + batch fields) into `out`.
function writeReceipt(out, payment) {
  const balanceAfter = payment.balance_after;
  const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Receipt ${payment.receipt_no}` } });
  doc.pipe(out);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const accent = '#1f5f8b';

  doc.fillColor(accent).font('Helvetica-Bold').fontSize(18).text(config.center.name, { align: 'center' });
  doc.fillColor('#444').font('Helvetica').fontSize(9);
  if (config.center.address) doc.text(config.center.address, { align: 'center' });
  if (config.center.phone) doc.text(`Phone: ${config.center.phone}`, { align: 'center' });
  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(accent).lineWidth(1.5).stroke();
  doc.moveDown(0.8);

  doc.fillColor('#111').font('Helvetica-Bold').fontSize(13).text('FEE RECEIPT', { align: 'center' });
  if (payment.voided) {
    doc.fillColor('#c0392b').fontSize(11).text('CANCELLED', { align: 'center' });
  }
  doc.moveDown(0.8);

  const row = (label, value) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#666').text(label, left, y, { width: 110 });
    doc.font('Helvetica-Bold').fillColor('#111').text(value || '-', left + 115, y, { width: width - 115 });
    doc.moveDown(0.45);
  };

  row('Receipt No.', payment.receipt_no);
  row('Date', dateLabel(payment.paid_on));
  row('Student', payment.student_name);
  row('Class', batchLabel(payment) + (payment.roll_no ? `   (Roll No. ${payment.roll_no})` : ''));
  if (payment.guardian_name) row('Parent / Guardian', payment.guardian_name);
  row('Payment mode', payment.mode + (payment.reference ? `  (Ref: ${payment.reference})` : ''));
  row('Towards', payment.covers ? `Tuition fee - ${plain(payment.covers)}` : 'Tuition fee');
  if (payment.note) row('Note', plain(payment.note));

  doc.moveDown(0.5);
  const boxY = doc.y;
  doc.roundedRect(left, boxY, width, 52, 6).fillAndStroke('#eef5fa', '#cfe0ec');
  doc.fillColor('#666').font('Helvetica').fontSize(10).text('Amount received', left + 12, boxY + 10);
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(20).text(rs(payment.amount), left + 12, boxY + 10, {
    width: width - 24,
    align: 'right',
  });
  doc.fillColor('#444').font('Helvetica-Oblique').fontSize(9)
    .text(`Rupees ${amountInWords(payment.amount)} only`, left + 12, boxY + 34, { width: width - 24 });
  doc.y = boxY + 64;
  doc.x = left;

  if (balanceAfter !== null && balanceAfter !== undefined) {
    const label = balanceAfter > 0 ? `Balance pending: ${rs(balanceAfter)}`
      : balanceAfter < 0 ? `Advance credit: ${rs(-balanceAfter)}` : 'No pending fees. Thank you!';
    doc.font('Helvetica').fontSize(10).fillColor('#333').text(label, left, doc.y, { width });
  }

  doc.font('Helvetica').fontSize(9).fillColor('#888')
    .text('Authorised signatory', left, doc.page.height - doc.page.margins.bottom - 40, { width, align: 'right' })
    .text('This is a computer generated receipt.', left, doc.page.height - doc.page.margins.bottom - 20, {
      width,
      align: 'center',
    });

  doc.end();
}

module.exports = { writeReceipt, amountInWords };
