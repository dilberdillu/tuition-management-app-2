const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    class_no INTEGER NOT NULL,
    division TEXT NOT NULL,
    monthly_fee INTEGER NOT NULL,
    UNIQUE (class_no, division)
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    roll_no TEXT,
    phone TEXT,
    guardian_name TEXT,
    guardian_phone TEXT,
    address TEXT,
    joined_on TEXT NOT NULL,          -- YYYY-MM-DD
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    left_on TEXT,                     -- YYYY-MM-DD, set when made inactive
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch_id);

  -- One row per student per month. Amount is copied from the batch fee when the
  -- due is generated, so later fee changes never rewrite history.
  CREATE TABLE IF NOT EXISTS dues (
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    month TEXT NOT NULL,              -- YYYY-MM
    amount INTEGER NOT NULL,
    waived INTEGER NOT NULL DEFAULT 0,
    UNIQUE (student_id, month)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    receipt_no TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    mode TEXT NOT NULL,
    reference TEXT,
    paid_on TEXT NOT NULL,            -- YYYY-MM-DD
    covers TEXT,                      -- human readable months this payment settled
    balance_after INTEGER,            -- student's balance right after this payment
    note TEXT,
    voided INTEGER NOT NULL DEFAULT 0,
    void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
  CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON payments(paid_on);

  CREATE TABLE IF NOT EXISTS attendance (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,               -- YYYY-MM-DD
    status TEXT NOT NULL CHECK (status IN ('P', 'A')),
    PRIMARY KEY (student_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

  -- Online payment links (Dodo Payments checkout sessions). The parent opens /pay/<token>.
  -- A payment row is created only once Dodo confirms the payment.
  CREATE TABLE IF NOT EXISTS pay_links (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    environment TEXT NOT NULL,        -- test_mode / live_mode
    session_id TEXT NOT NULL UNIQUE,
    checkout_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    dodo_payment_id TEXT UNIQUE,
    payment_id INTEGER REFERENCES payments(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pay_links_student ON pay_links(student_id);

  -- One Dodo product per fee amount (Dodo charges a product's fixed price).
  CREATE TABLE IF NOT EXISTS dodo_products (
    environment TEXT NOT NULL,
    amount INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    PRIMARY KEY (environment, amount)
  );
`);

// Create the 12 standard classes (8A..10D) on first run.
const batchCount = db.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
if (batchCount === 0) {
  const insert = db.prepare('INSERT INTO batches (class_no, division, monthly_fee) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const classNo of [8, 9, 10]) {
      for (const division of ['A', 'B', 'C', 'D']) insert.run(classNo, division, config.defaultFee);
    }
  })();
}

module.exports = db;
