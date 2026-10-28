const express = require('express');
const db = require('../db');
const config = require('../config');
const { studentBalances, recordPayment, ledger, syncStudent, getPayment } = require('../fees');
const { writeReceipt } = require('../receipt');
const analytics = require('../analytics');
const { today, currentMonth, isValidDate, batchLabel } = require('../util');

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
router.get('/reports', (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : `${currentMonth()}-01`;
  const to = isValidDate(req.query.to) ? req.query.to : today();
  const modes = [...config.paymentModes, config.onlineMode];
  const mode = modes.includes(req.query.mode) ? req.query.mode : '';
  const batchId = Number(req.query.batch) || null;

  const where = ['p.voided = 0', 'p.paid_on BETWEEN ? AND ?'];
  const params = [from, to];
  if (mode) { where.push('p.mode = ?'); params.push(mode); }
  if (batchId) { where.push('s.batch_id = ?'); params.push(batchId); }
  const payments = db.prepare(`
    SELECT p.*, s.name, s.roll_no, b.class_no, b.division
    FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    WHERE ${where.join(' AND ')} ORDER BY p.paid_on DESC, p.id DESC`).all(...params);

  if (req.query.format === 'csv') {
    analytics.track(req, 'report_exported', { format: 'csv', rows: payments.length });
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Receipt', 'Date', 'Student', 'Class', 'Amount', 'Mode', 'Reference', 'Towards', 'Note'].join(',')];
    for (const p of payments) {
      lines.push([p.receipt_no, p.paid_on, p.name, batchLabel(p), p.amount, p.mode, p.reference, p.covers, p.note]
        .map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="collections-${from}-to-${to}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}`);
  }

  const total = payments.reduce((t, p) => t + p.amount, 0);
  const byMode = {};
  for (const p of payments) byMode[p.mode] = (byMode[p.mode] || 0) + p.amount;
  const batches = db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
  const query = new URLSearchParams({ from, to, mode, batch: batchId || '' }).toString();
  res.render('reports', {
    title: 'Reports', payments, total, byMode, from, to, mode, batchId, batches, modes, query,
  });
});

module.exports = router;
