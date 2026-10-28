const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const config = require('./src/config');
require('./src/db');
const util = require('./src/util');
const { requireLogin, sameOrigin } = require('./src/auth');
const online = require('./src/online');
const onlineRoutes = require('./src/routes/online');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // behind Nginx

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"], // progress bar widths etc.
      imgSrc: ["'self'", 'data:'],
    },
  },
  // "no-referrer" makes browsers send `Origin: null` on form posts, which sameOrigin() rejects.
  referrerPolicy: { policy: 'same-origin' },
}));
// Dodo Payments webhook: needs the raw body for its signature, and comes from Dodo, not a browser.
app.post('/webhooks/dodo', express.raw({ type: 'application/json', limit: '1mb' }), onlineRoutes.webhook);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieSession({
  name: 'tm_session',
  secret: config.sessionSecret,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
}));
app.use(sameOrigin);

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.use('/static/vendor', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), {
  maxAge: config.isProd ? '30d' : 0,
}));

// Helpers and per-request values available in every view.
app.use((req, res, next) => {
  res.locals.u = util;
  res.locals.center = config.center;
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  res.locals.onlineEnabled = online.enabled;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => { req.session.flash = { type, message }; };
  next();
});

app.use(require('./src/routes/auth'));
app.use(onlineRoutes.publicRouter);
app.use(requireLogin);
app.use(require('./src/routes/dashboard'));
app.use(require('./src/routes/students'));
app.use(require('./src/routes/fees'));
app.use(require('./src/routes/attendance'));
app.use(require('./src/routes/settings'));
app.use(onlineRoutes.router);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again.' });
});

app.listen(config.port, config.host, () => {
  console.log(`Tuition manager running on http://${config.host}:${config.port}`);
});
