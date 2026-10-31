const express = require('express');
const db = require('../db');
const config = require('../config');
const { studentBalances, recordPayment, ledger, syncStudent, getPayment } = require('../fees');
const { writeReceipt } = require('../receipt');
const analytics = require('../analytics');
const {
  today, currentMonth, isValidDate, batchLabel, addMonths, monthsBetween, monthLabel, dateLabel, daysInMonth,
} = require('../util');

const router = express.Router();

const getStudent = (id) => db.prepare(`
  SELECT s.*, b.class_no, b.division, b.monthly_fee
  FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`).get(id);

// Step 1 of quick collect: find the student.
router.get('/collect', (req, res) => {
  const students = studentBalances();
  const batches = db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
  res.render('collect/pick', { title: 'Collect fee', students, batches });
});

function collectForm(res, student, values, errors = [], status = 200) {
  syncStudent(student.id);
  const led = ledger(student.id);
  const pendingMonths = led.dues.filter((d) => d.status === 'due' || d.status === 'partial');
  res.status(status).render('collect/form', {
    title: `Collect fee · ${student.name}`,
    student,
    balance: led.balance,
    pendingMonths,
    modes: config.paymentModes,
    values,
    errors,
  });
}

// Step 2: amount is pre-filled with the pending balance (or one month's fee if nothing is due).
router.get('/collect/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  syncStudent(student.id);
  const { balance } = ledger(student.id);
  collectForm(res, student, {
    amount: balance > 0 ? balance : student.monthly_fee,
    mode: 'Cash',
    paid_on: today(),
    reference: '',
    note: '',
  });
});

router.post('/collect/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  const values = {
    amount: String(req.body.amount || '').replace(/[,\s₹]/g, ''),
    mode: req.body.mode,
    paid_on: req.body.paid_on,
    reference: (req.body.reference || '').trim().slice(0, 100),
    note: (req.body.note || '').trim().slice(0, 300),
  };
  const errors = [];
  const amount = Number(values.amount);
  if (!Number.isInteger(amount) || amount <= 0) errors.push('Enter the amount in whole rupees.');
  else if (amount > 1000000) errors.push('Amount looks too large.');
  if (!config.paymentModes.includes(values.mode)) errors.push('Choose a payment mode.');
  if (!isValidDate(values.paid_on)) errors.push('Payment date is invalid.');
  else if (values.paid_on > today()) errors.push('Payment date cannot be in the future.');
  if (errors.length) return collectForm(res, student, values, errors, 400);

  const paymentId = recordPayment({
    studentId: student.id,
    amount,
    mode: values.mode,
    reference: values.reference,
    paidOn: values.paid_on,
    note: values.note,
  });
  analytics.track(req, 'fee_collected', { amount, mode: values.mode, class: batchLabel(student), backdated: values.paid_on !== today() });
  res.redirect(`/payments/${paymentId}?new=1`);
});

router.get('/payments/:id', (req, res, next) => {
  const payment = getPayment(req.params.id);
  if (!payment) return next();
  const { balance } = ledger(payment.student_id);
  res.render('payments/show', { title: `Receipt ${payment.receipt_no}`, payment, balance, isNew: req.query.new === '1' });
});

router.get('/payments/:id/receipt.pdf', (req, res, next) => {
  const payment = getPayment(req.params.id);
  if (!payment) return next();
  const safeName = payment.student_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const disposition = req.query.view === '1' ? 'inline' : 'attachment';
  analytics.track(req, 'receipt_downloaded', { view: disposition, mode: payment.mode });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="Receipt-${payment.receipt_no}-${safeName}.pdf"`);
  writeReceipt(res, payment);
});

// Payments are never deleted, only cancelled, so receipt numbers stay continuous.
router.post('/payments/:id/void', (req, res, next) => {
  const payment = getPayment(req.params.id);
  if (!payment) return next();
  const reason = (req.body.reason || '').trim().slice(0, 200) || 'Cancelled';
  const info = db.prepare('UPDATE payments SET voided = 1, void_reason = ? WHERE id = ? AND voided = 0').run(reason, payment.id);
  if (info.changes) analytics.track(req, 'receipt_cancelled', { amount: payment.amount, mode: payment.mode });
  req.flash('success', `Receipt ${payment.receipt_no} cancelled. The amount is back in the student's pending balance.`);
  res.redirect(`/payments/${payment.id}`);
});

// Collections report for any date range, with CSV export.
const REPORT_SORTS = [
  { value: 'newest', label: 'Newest first', sql: 'p.paid_on DESC, p.id DESC' },
  { value: 'oldest', label: 'Oldest first', sql: 'p.paid_on, p.id' },
  { value: 'amount', label: 'Highest amount', sql: 'p.amount DESC, p.paid_on DESC, p.id DESC' },
  { value: 'student', label: 'Student name', sql: 's.name COLLATE NOCASE, p.paid_on DESC' },
  { value: 'class', label: 'Class', sql: 'b.class_no, b.division, s.name COLLATE NOCASE, p.paid_on DESC' },
];

// Quick date ranges shown above the report.
function reportPresets() {
  const month = currentMonth();
  const lastMonth = addMonths(month, -1);
  return [
    { label: 'Today', from: today(), to: today() },
    { label: 'This month', from: `${month}-01`, to: today() },
    { label: 'Last month', from: `${lastMonth}-01`, to: `${lastMonth}-${daysInMonth(lastMonth)}` },
    { label: 'Last 3 months', from: `${addMonths(month, -2)}-01`, to: today() },
    { label: 'This year', from: `${month.slice(0, 4)}-01-01`, to: today() },
  ];
}

router.get('/reports', (req, res) => {
  let from = isValidDate(req.query.from) ? req.query.from : `${currentMonth()}-01`;
  let to = isValidDate(req.query.to) ? req.query.to : today();
  if (from > to) [from, to] = [to, from];
  const modes = [...config.paymentModes, config.onlineMode];
  const mode = modes.includes(req.query.mode) ? req.query.mode : '';
  const batches = db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
  const classNos = [...new Set(batches.map((b) => b.class_no))];
  // "batch" is one division by id (8-A), or a whole class as "class-8".
  const classMatch = /^class-(\d+)$/.exec(req.query.batch || '');
  const classNo = classMatch && classNos.includes(Number(classMatch[1])) ? Number(classMatch[1]) : null;
  const batchId = classNo ? null : Number(req.query.batch) || null;
  const batchValue = classNo ? `class-${classNo}` : batchId || '';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const status = ['cancelled', 'all'].includes(req.query.status) ? req.query.status : '';
  const sort = REPORT_SORTS.find((s) => s.value === req.query.sort) || REPORT_SORTS[0];
  const inScope = (batch, cls) => (!batchId || batch === batchId) && (!classNo || cls === classNo);

  const where = ['p.paid_on BETWEEN ? AND ?'];
  const params = [from, to];
  if (mode) { where.push('p.mode = ?'); params.push(mode); }
  if (batchId) { where.push('s.batch_id = ?'); params.push(batchId); }
  if (classNo) { where.push('b.class_no = ?'); params.push(classNo); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.roll_no = ? OR p.receipt_no LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\')");
    params.push(like, q, like, like);
  }
  const rows = db.prepare(`
    SELECT p.*, s.name, s.roll_no, s.batch_id, b.class_no, b.division
    FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    WHERE ${where.join(' AND ')} ORDER BY ${sort.sql}`).all(...params);
  // Totals only ever count valid receipts; cancelled ones are listed on request.
  const valid = rows.filter((p) => !p.voided);
  const cancelled = rows.filter((p) => p.voided);
  const payments = status === 'all' ? rows : status === 'cancelled' ? cancelled : valid;

  if (req.query.format === 'csv') {
    analytics.track(req, 'report_exported', { format: 'csv', rows: payments.length });
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Receipt', 'Date', 'Student', 'Roll no', 'Class', 'Amount', 'Mode', 'Reference', 'Towards', 'Note', 'Status']
      .join(',')];
    for (const p of payments) {
      const state = p.voided ? `Cancelled: ${p.void_reason || ''}` : 'Valid';
      lines.push([p.receipt_no, p.paid_on, p.name, p.roll_no, batchLabel(p), p.amount, p.mode, p.reference, p.covers, p.note, state]
        .map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="collections-${from}-to-${to}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}`);
  }

  const sumOf = (list) => list.reduce((t, p) => t + p.amount, 0);
  const tally = (map, key, amount) => {
    map[key] = map[key] || { total: 0, count: 0 };
    map[key].total += amount;
    map[key].count += 1;
  };
  const byMode = {};
  for (const p of valid) tally(byMode, p.mode, p.amount);

  // Up to a month is shown day by day, longer ranges month by month.
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const daily = (Date.parse(to) - Date.parse(from)) / 86400000 < 31;
  const periodMap = {};
  for (const p of valid) tally(periodMap, daily ? p.paid_on : p.paid_on.slice(0, 7), p.amount);
  const byPeriod = (daily ? Object.keys(periodMap).sort() : months).map((key) => ({
    label: daily ? dateLabel(key) : monthLabel(key),
    ...(periodMap[key] || { total: 0, count: 0 }),
  }));

  // Fees billed for the months the range touches, and what is pending today, per class.
  const billedRows = db.prepare(`
    SELECT s.batch_id, SUM(d.amount) AS total FROM dues d JOIN students s ON s.id = d.student_id
    WHERE d.waived = 0 AND d.month BETWEEN ? AND ? GROUP BY s.batch_id`).all(months[0], months[months.length - 1]);
  const billedMap = Object.fromEntries(billedRows.map((r) => [r.batch_id, r.total]));
  const balances = studentBalances().filter((s) => inScope(s.batch_id, s.class_no));
  const owing = balances.filter((s) => s.balance > 0);

  const byClass = batches.filter((b) => inScope(b.id, b.class_no)).map((b) => {
    const paid = valid.filter((p) => p.batch_id === b.id);
    const classOwing = owing.filter((s) => s.batch_id === b.id);
    return {
      ...b,
      students: balances.filter((s) => s.batch_id === b.id).length,
      studentsPaid: new Set(paid.map((p) => p.student_id)).size,
      receipts: paid.length,
      collected: sumOf(paid),
      billed: billedMap[b.id] || 0,
      pending: classOwing.reduce((t, s) => t + s.balance, 0),
      pendingCount: classOwing.length,
    };
  }).filter((c) => !q || c.receipts);

  const filters = { from, to, mode, batch: batchValue, q, status, sort: sort.value };
  const presets = reportPresets().map((p) => ({
    ...p,
    active: p.from === from && p.to === to,
    href: `/reports?${new URLSearchParams({ ...filters, from: p.from, to: p.to })}`,
  }));
  res.render('reports', {
    title: 'Reports',
    payments,
    total: sumOf(valid),
    receiptCount: valid.length,
    studentsPaid: new Set(valid.map((p) => p.student_id)).size,
    activeStudents: balances.length,
    cancelledTotal: sumOf(cancelled),
    cancelledCount: cancelled.length,
    billed: byClass.reduce((t, c) => t + c.billed, 0),
    // Collected vs billed only compares like with like when every payment of the class is counted.
    showRate: !mode && !q,
    pendingTotal: owing.reduce((t, s) => t + s.balance, 0),
    pendingCount: owing.length,
    byMode,
    byPeriod,
    daily,
    byClass,
    months,
    ...filters,
    batchValue,
    sorts: REPORT_SORTS,
    classNos,
    batches,
    modes,
    presets,
    query: new URLSearchParams(filters).toString(),
  });
});

module.exports = router;
