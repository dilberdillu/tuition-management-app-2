const express = require('express');
const auth = require('../auth');

const router = express.Router();

// Only allow redirects back into this app after login.
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Login', next: safeNext(req.query.next), error: null, noUsers: auth.userCount() === 0 });
});

router.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const next = safeNext(req.body.next);
  const render = (error) => res.status(401).render('login', { title: 'Login', next, error, noUsers: auth.userCount() === 0 });

  if (auth.isLocked(req.ip)) return render('Too many failed attempts. Try again in 15 minutes.');
  const user = auth.verifyUser(username.trim(), password);
  if (!user) {
    auth.recordFailure(req.ip);
    return render('Wrong username or password.');
  }
  auth.failures.delete(req.ip);
  req.session.user = user;
  res.redirect(next);
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
