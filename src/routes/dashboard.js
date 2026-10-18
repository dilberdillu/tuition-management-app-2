const express = require('express');
const db = require('../db');
const { studentBalances, ensureDues } = require('../fees');
const { today, currentMonth, isValidMonth, addMonths, monthsBetween, monthLabel } = require('../util');

const router = express.Router();

router.get('/', (req, res) => {
  ensureDues();
  const month = isValidMonth(req.query.month) && req.query.month <= currentMonth() ? req.query.month : currentMonth();
  const date = today();
  const sum = (sql, ...params) => db.prepare(sql).get(...params).total;

  const todayCollected = sum('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE voided = 0 AND paid_on = ?', date);
  const todayCount = sum('SELECT COUNT(*) AS total FROM payments WHERE voided = 0 AND paid_on = ?', date);
  const monthCollected = sum(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE voided = 0 AND substr(paid_on, 1, 7) = ?", month);
  const monthBilled = sum('SELECT COALESCE(SUM(amount), 0) AS total FROM dues WHERE waived = 0 AND month = ?', month);

  const balances = studentBalances();
  const pending = balances.filter((s) => s.balance > 0).sort((a, b) => b.balance - a.balance);
  const outstanding = pending.reduce((t, s) => t + s.balance, 0);

  // 12-month collection trend ending at the selected month.
  const trendMonths = monthsBetween(addMonths(month, -11), month);
  const trendRows = db.prepare(`
    SELECT substr(paid_on, 1, 7) AS month, SUM(amount) AS total FROM payments
    WHERE voided = 0 AND substr(paid_on, 1, 7) BETWEEN ? AND ? GROUP BY 1`).all(trendMonths[0], month);
  const trendMap = Object.fromEntries(trendRows.map((r) => [r.month, r.total]));
  const trend = {
    labels: trendMonths.map((m) => monthLabel(m).replace(/ \d{2}(\d{2})$/, " '$1")),
    values: trendMonths.map((m) => trendMap[m] || 0),
  };

  const modes = db.prepare(`
    SELECT mode, SUM(amount) AS total, COUNT(*) AS count FROM payments
    WHERE voided = 0 AND substr(paid_on, 1, 7) = ? GROUP BY mode ORDER BY total DESC`).all(month);

  // Per-class summary for the selected month plus current outstanding.
  const classes = db.prepare(`
    SELECT b.id, b.class_no, b.division, b.monthly_fee,
      (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.status = 'active') AS students,
      (SELECT COALESCE(SUM(d.amount), 0) FROM dues d JOIN students s ON s.id = d.student_id
         WHERE s.batch_id = b.id AND d.month = ? AND d.waived = 0) AS billed,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN students s ON s.id = p.student_id
         WHERE s.batch_id = b.id AND p.voided = 0 AND substr(p.paid_on, 1, 7) = ?) AS collected
    FROM batches b ORDER BY b.class_no, b.division`).all(month, month);
  for (const c of classes) {
    c.outstanding = pending.filter((s) => s.batch_id === c.id).reduce((t, s) => t + s.balance, 0);
  }

  const recent = db.prepare(`
    SELECT p.id, p.receipt_no, p.amount, p.mode, p.paid_on, s.name, b.class_no, b.division
    FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    WHERE p.voided = 0 ORDER BY p.id DESC LIMIT 8`).all();

  const att = db.prepare(`
    SELECT COUNT(*) AS marked, COALESCE(SUM(status = 'P'), 0) AS present FROM attendance WHERE date = ?`).get(date);

  res.render('dashboard', {
    title: 'Dashboard',
    month,
    isCurrentMonth: month === currentMonth(),
    monthOptions: monthsBetween(addMonths(currentMonth(), -23), currentMonth()).reverse(),
    todayCollected,
    todayCount,
    monthCollected,
    monthBilled,
    outstanding,
    pendingCount: pending.length,
    activeCount: balances.length,
    topPending: pending.slice(0, 10),
    trend,
    modes,
    classes,
    recent,
    att,
  });
});

module.exports = router;
