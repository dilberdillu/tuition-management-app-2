const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { currentMonth, batchLabel } = require('../util');

const router = express.Router();

function render(res, extra = {}) {
  const batches = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.status = 'active') AS students
    FROM batches b ORDER BY b.class_no, b.division`).all();
  res.render('settings', { title: 'Settings', batches, passwordError: null, ...extra });
}

router.get('/settings', (req, res) => render(res));

// Update monthly fees. New fees apply to months generated from now on; optionally also
// to the current month's dues (useful when the change is made at the start of a month).
router.post('/settings/fees', (req, res) => {
  const includeCurrent = req.body.include_current === '1';
  const month = currentMonth();
  const batches = db.prepare('SELECT * FROM batches').all();
  const errors = [];
  let changed = 0;
  db.transaction(() => {
    for (const b of batches) {
      const raw = req.body[`fee_${b.id}`];
      if (raw === undefined) continue;
      const fee = Number(String(raw).replace(/[,\s₹]/g, ''));
      if (!Number.isInteger(fee) || fee < 0 || fee > 1000000) { errors.push(batchLabel(b)); continue; }
      if (fee === b.monthly_fee) continue;
      db.prepare('UPDATE batches SET monthly_fee = ? WHERE id = ?').run(fee, b.id);
      if (includeCurrent) {
        db.prepare(`UPDATE dues SET amount = ? WHERE month = ?
                    AND student_id IN (SELECT id FROM students WHERE batch_id = ?)`).run(fee, month, b.id);
      }
      changed += 1;
    }
  })();
  if (errors.length) req.flash('error', `Invalid fee for ${errors.join(', ')}. Other changes were saved.`);
  else req.flash('success', changed ? `Fees updated for ${changed} class${changed > 1 ? 'es' : ''}.` : 'No changes.');
  res.redirect('/settings');
});

router.post('/settings/password', (req, res) => {
  const { current = '', password = '', confirm = '' } = req.body;
  const { username } = req.session.user;
  let passwordError = null;
  if (!auth.verifyUser(username, current)) passwordError = 'Current password is wrong.';
  else if (password.length < 8) passwordError = 'New password must be at least 8 characters.';
  else if (password !== confirm) passwordError = 'New passwords do not match.';
  if (passwordError) return render(res.status(400), { passwordError });
  auth.setPassword(username, password);
  req.flash('success', 'Password changed.');
  res.redirect('/settings');
});

module.exports = router;
