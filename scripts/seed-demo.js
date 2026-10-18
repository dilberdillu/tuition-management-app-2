// Fill an EMPTY database with demo students, payments and attendance for trying the app.
//   npm run seed-demo
const db = require('../src/db');
const { syncStudent, ensureDues, ledger, recordPayment } = require('../src/fees');
const { isoDate, addMonths, currentMonth } = require('../src/util');

if (db.prepare('SELECT COUNT(*) AS n FROM students').get().n > 0) {
  console.error('Database already has students. Demo data is only added to an empty database.');
  process.exit(1);
}

const first = ['Aarav', 'Diya', 'Arjun', 'Ananya', 'Rohan', 'Meera', 'Kiran', 'Sneha', 'Rahul', 'Fathima', 'Nikhil',
  'Aisha', 'Vishnu', 'Gauri', 'Adil', 'Lakshmi', 'Joel', 'Nandana', 'Sidharth', 'Riya', 'Abhinav', 'Theertha',
  'Hari', 'Anjali', 'Faiz', 'Devika', 'Amal', 'Keerthana', 'Gokul', 'Sana'];
const last = ['Nair', 'Menon', 'Kumar', 'Thomas', 'Pillai', 'Joseph', 'Rahman', 'Varghese', 'Das', 'Krishnan'];
const pick = (arr, i) => arr[i % arr.length];

let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const batches = db.prepare('SELECT * FROM batches ORDER BY class_no, division').all();
const startMonth = addMonths(currentMonth(), -5);
const insert = db.prepare(`INSERT INTO students (name, batch_id, roll_no, guardian_name, guardian_phone, joined_on)
                           VALUES (?, ?, ?, ?, ?, ?)`);

let n = 0;
db.transaction(() => {
  for (const b of batches) {
    const count = 10 + Math.floor(rand() * 6);
    for (let r = 1; r <= count; r += 1) {
      const name = `${pick(first, n * 7 + r)} ${pick(last, n + r * 3)}`;
      const joinMonth = rand() < 0.85 ? startMonth : addMonths(startMonth, 1 + Math.floor(rand() * 4));
      const phone = `9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`;
      insert.run(name, b.id, String(r), `${pick(first, n + 11)} ${name.split(' ')[1]}`, phone, `${joinMonth}-01`);
      n += 1;
    }
  }
})();

ensureDues();
const students = db.prepare('SELECT id, joined_on FROM students').all();
const modes = ['Cash', 'Cash', 'UPI', 'UPI', 'UPI', 'Bank'];
for (const s of students) {
  syncStudent(s.id);
  const { dues } = ledger(s.id);
  // Most students pay most months around the 5th-15th; some fall behind.
  const reliability = rand();
  for (const d of dues) {
    const isCurrent = d.month === currentMonth();
    if (rand() > (isCurrent ? 0.55 : 0.6 + reliability * 0.4)) continue;
    const day = 3 + Math.floor(rand() * 13);
    const date = isoDate(new Date(Number(d.month.slice(0, 4)), Number(d.month.slice(5)) - 1, day));
    if (date > isoDate()) continue;
    const mode = pick(modes, Math.floor(rand() * 100));
    recordPayment({
      studentId: s.id,
      amount: d.amount,
      mode,
      reference: mode === 'UPI' ? `UPI${Math.floor(rand() * 1e8)}` : '',
      paidOn: date,
      note: '',
    });
  }
}

// Attendance for weekdays of the last 30 days.
const att = db.prepare('INSERT OR IGNORE INTO attendance (student_id, date, status) VALUES (?, ?, ?)');
db.transaction(() => {
  for (let i = 30; i >= 1; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue;
    const date = isoDate(d);
    for (const s of students) if (s.joined_on <= date) att.run(s.id, date, rand() < 0.9 ? 'P' : 'A');
  }
})();

console.log(`Demo data added: ${students.length} students with payments and attendance.`);
