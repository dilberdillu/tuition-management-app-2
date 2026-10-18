const bcrypt = require('bcryptjs');
const db = require('./db');

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Reject cross-site form posts. The session cookie is SameSite=Lax too; this is a second layer.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch { /* fall through */ }
  res.status(403).send('Cross-site request blocked');
}

// Simple in-memory brute force guard: 10 failed attempts per IP locks login for 15 minutes.
const failures = new Map();
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;

function isLocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > LOCK_MS) { failures.delete(ip); return false; }
  return f.count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > LOCK_MS) failures.set(ip, { count: 1, first: Date.now() });
  else f.count += 1;
}

function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

function setPassword(username, password) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)
              ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(username, hash);
}

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

module.exports = { requireLogin, sameOrigin, isLocked, recordFailure, failures, verifyUser, setPassword, userCount };
