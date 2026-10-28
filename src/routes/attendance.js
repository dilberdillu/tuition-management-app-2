const express = require('express');
const db = require('../db');
const analytics = require('../analytics');
const { today, currentMonth, isValidDate, isValidMonth, batchLabel, monthsBetween, addMonths } = require('../util');

const router = express.Router();

const getBatch = (id) => db.prepare('SELECT * FROM batches WHERE id = ?').get(id);

// Students who were enrolled in the batch on the given date.
const studentsOn = (batchId, date) => db.prepare(`
  SELECT s.id, s.name, s.roll_no, a.status
  FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
  WHERE s.batch_id = ? AND s.joined_on <= ? AND (s.status = 'active' OR s.left_on >= ?)
  ORDER BY CAST(s.roll_no AS INTEGER), s.name`).all(date, batchId, date, date);

router.get('/attendance', (req, res) => {
  const date = isValidDate(req.query.date) && req.query.date <= today() ? req.query.date : today();
  const batch = getBatch(Number(req.query.batch));

  if (!batch) {
    // Overview: every class with its marking status for the date.
    const classes = db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.joined_on <= ?
           AND (s.status = 'active' OR s.left_on >= ?)) AS students,
        (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
           WHERE s.batch_id = b.id AND a.date = ?) AS marked,
        (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
           WHERE s.batch_id = b.id AND a.date = ? AND a.status = 'P') AS present
      FROM batches b ORDER BY b.class_no, b.division`).all(date, date, date, date);
    return res.render('attendance/index', { title: 'Attendance', date, classes, isToday: date === today() });
  }

  const students = studentsOn(batch.id, date);
  const alreadyMarked = students.some((s) => s.status);
  res.render('attendance/mark', {
    title: `Attendance · ${batchLabel(batch)}`, batch, date, students, alreadyMarked,
  });
});

router.post('/attendance', (req, res, next) => {
  const batch = getBatch(Number(req.body.batch));
  const { date } = req.body;
  if (!batch || !isValidDate(date) || date > today()) return next();

  // Checkboxes are "present"; anything unchecked is absent.
  const present = new Set([].concat(req.body.present || []).map(Number));
  const students = studentsOn(batch.id, date);
  const upsert = db.prepare(`INSERT INTO attendance (student_id, date, status) VALUES (?, ?, ?)
                             ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`);
  db.transaction(() => {
    for (const s of students) upsert.run(s.id, date, present.has(s.id) ? 'P' : 'A');
  })();
  const p = students.filter((s) => present.has(s.id)).length;
  analytics.track(req, 'attendance_saved', { class: batchLabel(batch), present: p, absent: students.length - p, backdated: date !== today() });
  req.flash('success', `${batchLabel(batch)} saved: ${p} present, ${students.length - p} absent.`);
  res.redirect(`/attendance?date=${date}`);
});

// Monthly summary per class.
router.get('/attendance/report', (req, res) => {
  const batches = db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
  const batch = getBatch(Number(req.query.batch)) || batches[0];
  const month = isValidMonth(req.query.month) ? req.query.month : currentMonth();

  const days = db.prepare(`
    SELECT DISTINCT a.date FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE s.batch_id = ? AND substr(a.date, 1, 7) = ? ORDER BY a.date`).all(batch.id, month).map((r) => r.date);

  const rows = db.prepare(`
    SELECT s.id, s.name, s.roll_no,
      COALESCE(SUM(a.status = 'P'), 0) AS present,
      COALESCE(SUM(a.status = 'A'), 0) AS absent,
      GROUP_CONCAT(CASE WHEN a.status = 'A' THEN CAST(substr(a.date, 9, 2) AS INTEGER) END) AS absentDays
    FROM students s
    LEFT JOIN attendance a ON a.student_id = s.id AND substr(a.date, 1, 7) = ?
    WHERE s.batch_id = ? AND (s.status = 'active' OR a.date IS NOT NULL)
    GROUP BY s.id ORDER BY CAST(s.roll_no AS INTEGER), s.name`).all(month, batch.id);

  res.render('attendance/report', {
    title: 'Attendance report',
    batches,
    batch,
    month,
    monthOptions: monthsBetween(addMonths(currentMonth(), -11), currentMonth()).reverse(),
    days,
    rows,
  });
});

module.exports = router;
