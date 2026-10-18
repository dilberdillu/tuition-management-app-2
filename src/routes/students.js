const express = require('express');
const db = require('../db');
const { studentBalances, syncStudent, ledger } = require('../fees');
const { today, currentMonth, isValidDate, isValidMonth } = require('../util');

const router = express.Router();

const batches = () => db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
const getStudent = (id) => db.prepare(`
  SELECT s.*, b.class_no, b.division, b.monthly_fee
  FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`).get(id);

function readForm(body) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const s = {
    name: clean(body.name),
    batch_id: Number(body.batch_id),
    roll_no: clean(body.roll_no) || null,
    phone: clean(body.phone) || null,
    guardian_name: clean(body.guardian_name) || null,
    guardian_phone: clean(body.guardian_phone) || null,
    address: clean(body.address) || null,
    joined_on: clean(body.joined_on),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    left_on: clean(body.left_on) || null,
  };
  const errors = [];
  if (!s.name) errors.push('Name is required.');
  if (!db.prepare('SELECT 1 FROM batches WHERE id = ?').get(s.batch_id)) errors.push('Choose a class.');
  if (!isValidDate(s.joined_on)) errors.push('Joining date is invalid.');
  if (s.status === 'inactive') {
    s.left_on = s.left_on || today();
    if (!isValidDate(s.left_on)) errors.push('Leaving date is invalid.');
    else if (s.left_on < s.joined_on) errors.push('Leaving date cannot be before the joining date.');
  } else {
    s.left_on = null;
  }
  return { s, errors };
}

router.get('/students', (req, res) => {
  const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : 'active';
  const batchId = Number(req.query.batch) || null;
  const q = (req.query.q || '').trim().toLowerCase();
  const pendingOnly = req.query.pending === '1';
  let students = studentBalances({ status, batchId });
  if (q) {
    students = students.filter((s) => s.name.toLowerCase().includes(q)
      || (s.phone || '').includes(q) || (s.guardian_phone || '').includes(q));
  }
  if (pendingOnly) students = students.filter((s) => s.balance > 0);
  res.render('students/index', {
    title: 'Students', students, batches: batches(), status, batchId, q: req.query.q || '', pendingOnly,
  });
});

router.get('/students/new', (req, res) => {
  const s = { batch_id: Number(req.query.batch) || null, joined_on: today(), status: 'active' };
  res.render('students/form', { title: 'Add student', s, batches: batches(), errors: [] });
});

router.post('/students', (req, res) => {
  const { s, errors } = readForm(req.body);
  if (errors.length) return res.status(400).render('students/form', { title: 'Add student', s, batches: batches(), errors });
  const id = db.prepare(`
    INSERT INTO students (name, batch_id, roll_no, phone, guardian_name, guardian_phone, address, joined_on, status, left_on)
    VALUES (@name, @batch_id, @roll_no, @phone, @guardian_name, @guardian_phone, @address, @joined_on, @status, @left_on)`)
    .run(s).lastInsertRowid;
  syncStudent(id);
  req.flash('success', `${s.name} added.`);
  res.redirect(`/students/${id}`);
});

router.get('/students/:id', (req, res, next) => {
  const student = getStudent(req.params.id);
  if (!student) return next();
  syncStudent(student.id);
  const led = ledger(student.id);
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC').all(student.id);
  const month = currentMonth();
  const att = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status = 'P'), 0) AS present,
           COALESCE(SUM(substr(date, 1, 7) = ?), 0) AS monthTotal,
           COALESCE(SUM(substr(date, 1, 7) = ? AND status = 'P'), 0) AS monthPresent
    FROM attendance WHERE student_id = ?`).get(month, month, student.id);
  const recentAbsences = db.prepare(`
    SELECT date FROM attendance WHERE student_id = ? AND status = 'A' ORDER BY date DESC LIMIT 5`).all(student.id);
  res.render('students/show', {
    title: student.name, student, ...led, dues: led.dues.slice().reverse(), payments, att, recentAbsences,
  });
});

router.get('/students/:id/edit', (req, res, next) => {
  const s = getStudent(req.params.id);
  if (!s) return next();
  res.render('students/form', { title: `Edit ${s.name}`, s, batches: batches(), errors: [] });
});

router.post('/students/:id', (req, res, next) => {
  const existing = getStudent(req.params.id);
  if (!existing) return next();
  const { s, errors } = readForm(req.body);
  s.id = existing.id;
  if (errors.length) {
    return res.status(400).render('students/form', { title: `Edit ${existing.name}`, s, batches: batches(), errors });
  }
  db.prepare(`
    UPDATE students SET name = @name, batch_id = @batch_id, roll_no = @roll_no, phone = @phone,
      guardian_name = @guardian_name, guardian_phone = @guardian_phone, address = @address,
      joined_on = @joined_on, status = @status, left_on = @left_on
    WHERE id = @id`).run(s);
  syncStudent(s.id);
  req.flash('success', 'Student details saved.');
  res.redirect(`/students/${s.id}`);
});

// Waive (or restore) one month's fee, e.g. for a holiday month or a mid-month join.
router.post('/students/:id/dues/:month/waive', (req, res, next) => {
  if (!isValidMonth(req.params.month)) return next();
  const waived = req.body.waived === '1' ? 1 : 0;
  const info = db.prepare('UPDATE dues SET waived = ? WHERE student_id = ? AND month = ?')
    .run(waived, req.params.id, req.params.month);
  if (!info.changes) return next();
  req.flash('success', waived ? 'Month fee waived.' : 'Month fee restored.');
  res.redirect(`/students/${req.params.id}#dues`);
});

module.exports = router;
