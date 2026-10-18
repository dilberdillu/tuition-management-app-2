const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const today = () => isoDate();
const currentMonth = () => today().slice(0, 7);

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === s;
}

function isValidMonth(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
}

function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Inclusive list of YYYY-MM strings from `from` to `to`.
function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function dateLabel(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function inr(amount) {
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN')}`;
}

function batchLabel(row) {
  return `${row.class_no}-${row.division}`;
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

module.exports = {
  isoDate,
  today,
  currentMonth,
  isValidDate,
  isValidMonth,
  addMonths,
  monthsBetween,
  monthLabel,
  dateLabel,
  inr,
  batchLabel,
  daysInMonth,
};
