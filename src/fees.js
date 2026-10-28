// Fee ledger: monthly dues are generated per student, payments are applied to the
// oldest unpaid month first (FIFO). Balance = dues - payments; negative means advance.
const db = require('./db');
const { currentMonth, monthsBetween, monthLabel, inr } = require('./util');

const stmt = {
  student: db.prepare(`
    SELECT s.*, b.class_no, b.division, b.monthly_fee
    FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`),
  allStudents: db.prepare(`
    SELECT s.id, s.joined_on, s.status, s.left_on, b.monthly_fee
    FROM students s JOIN batches b ON b.id = s.batch_id`),
  insertDue: db.prepare('INSERT OR IGNORE INTO dues (student_id, month, amount) VALUES (?, ?, ?)'),
  pruneDues: db.prepare('DELETE FROM dues WHERE student_id = ? AND (month < ? OR month > ?)'),
  dues: db.prepare('SELECT * FROM dues WHERE student_id = ? ORDER BY month'),
  paidTotal: db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE student_id = ? AND voided = 0'),
  lastReceipt: db.prepare("SELECT receipt_no FROM payments WHERE receipt_no LIKE ? ORDER BY id DESC LIMIT 1"),
  insertPayment: db.prepare(`
    INSERT INTO payments (receipt_no, student_id, amount, mode, reference, paid_on, covers, balance_after, note)
    VALUES (@receipt_no, @student_id, @amount, @mode, @reference, @paid_on, @covers, @balance_after, @note)`),
};

// Bring one student's monthly dues in line with their join/leave dates.
function syncStudentDues(s, upTo = currentMonth()) {
  const start = s.joined_on.slice(0, 7);
  let end = upTo;
  if (s.status === 'inactive' && s.left_on && s.left_on.slice(0, 7) < end) end = s.left_on.slice(0, 7);
  stmt.pruneDues.run(s.id, start, end);
  if (start > end) return;
  for (const month of monthsBetween(start, end)) stmt.insertDue.run(s.id, month, s.monthly_fee);
}

const syncStudent = db.transaction((studentId) => {
  const s = stmt.student.get(studentId);
  if (s) syncStudentDues(s);
});

// Generating dues for every student is cheap, but only needed once per month
// (individual students are re-synced whenever they are created or edited).
let lastFullSync = null;
const syncAll = db.transaction(() => {
  for (const s of stmt.allStudents.all()) syncStudentDues(s);
});
function ensureDues() {
  const month = currentMonth();
  if (lastFullSync === month) return;
  syncAll();
  lastFullSync = month;
}

// Dues with a FIFO-computed status, plus totals.
function ledger(studentId) {
  const dues = stmt.dues.all(studentId);
  const paid = stmt.paidTotal.get(studentId).total;
  let remaining = paid;
  let totalDue = 0;
  const rows = dues.map((d) => {
    if (d.waived) return { ...d, label: monthLabel(d.month), settled: 0, status: 'waived' };
    totalDue += d.amount;
    const settled = Math.min(d.amount, remaining);
    remaining -= settled;
    const status = settled === d.amount ? 'paid' : settled > 0 ? 'partial' : 'due';
    return { ...d, label: monthLabel(d.month), settled, status };
  });
  return { dues: rows, totalDue, totalPaid: paid, balance: totalDue - paid };
}

// Describe which months a new payment of `amount` settles, given what was already paid.
function describeCoverage(dues, paidBefore, amount) {
  const parts = [];
  let cursor = 0;
  const start = paidBefore;
  const end = paidBefore + amount;
  for (const d of dues) {
    if (d.waived) continue;
    const dStart = cursor;
    const dEnd = cursor + d.amount;
    cursor = dEnd;
    const overlap = Math.min(end, dEnd) - Math.max(start, dStart);
    if (overlap <= 0) continue;
    parts.push(overlap === d.amount ? monthLabel(d.month) : `${monthLabel(d.month)} (part ${inr(overlap)})`);
  }
  const advance = end - Math.max(start, cursor);
  if (advance > 0) parts.push(`Advance ${inr(advance)}`);
  return parts.join(', ');
}

function nextReceiptNo(paidOn) {
  const prefix = `R${paidOn.slice(0, 4)}-`;
  const last = stmt.lastReceipt.get(`${prefix}%`);
  const seq = last ? Number(last.receipt_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

const recordPayment = db.transaction(({ studentId, amount, mode, reference, paidOn, note }) => {
  syncStudent(studentId);
  const dues = stmt.dues.all(studentId);
  const paidBefore = stmt.paidTotal.get(studentId).total;
  const totalDue = dues.reduce((sum, d) => sum + (d.waived ? 0 : d.amount), 0);
  const info = stmt.insertPayment.run({
    receipt_no: nextReceiptNo(paidOn),
    student_id: studentId,
    amount,
    mode,
    reference: reference || null,
    paid_on: paidOn,
    covers: describeCoverage(dues, paidBefore, amount),
    balance_after: totalDue - paidBefore - amount,
    note: note || null,
  });
  return info.lastInsertRowid;
});

// Every student with their running balance. Used by lists, dashboard and collect screen.
const balancesSql = `
  SELECT s.id, s.name, s.roll_no, s.phone, s.guardian_phone, s.status, s.batch_id,
         b.class_no, b.division, b.monthly_fee,
         COALESCE((SELECT SUM(amount) FROM dues d WHERE d.student_id = s.id AND d.waived = 0), 0)
       - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.voided = 0), 0) AS balance
  FROM students s JOIN batches b ON b.id = s.batch_id`;

function studentBalances({ status = 'active', batchId = null } = {}) {
  ensureDues();
  const where = [];
  const params = [];
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (batchId) { where.push('s.batch_id = ?'); params.push(batchId); }
  const sql = `${balancesSql} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY b.class_no, b.division, CAST(s.roll_no AS INTEGER), s.name`;
  return db.prepare(sql).all(...params);
}

// A payment with the student details a receipt needs.
const getPayment = (id) => db.prepare(`
  SELECT p.*, s.name AS student_name, s.roll_no, s.guardian_name, b.class_no, b.division
  FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
  WHERE p.id = ?`).get(id);

module.exports = { ensureDues, syncStudent, ledger, recordPayment, studentBalances, getPayment };
