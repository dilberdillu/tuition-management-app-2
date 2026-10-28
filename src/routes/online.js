const express = require('express');
const db = require('../db');
const config = require('../config');
const online = require('../online');
const { getPayment } = require('../fees');
const { writeReceipt } = require('../receipt');

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

// POST /webhooks/dodo: mounted before the body parsers, because the signature covers the raw bytes.
function webhook(req, res) {
  if (!online.webhookEnabled) return res.status(404).end();
  let event;
  try {
    event = online.verifyWebhook(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '', req.headers);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    online.applyWebhook(event);
  } catch (err) {
    console.error('Dodo webhook failed:', err);
    return res.status(500).json({ error: 'Processing failed' }); // Dodo retries
  }
  res.json({ received: true });
}

// Pages the parent sees. No login: the 32-character token in the link is the key.
const publicRouter = express.Router();
// Answer here instead of falling through to the staff login page.
const notFound = (res) => res.status(404).render('error', { title: 'Link not found', message: 'Please check the payment link you were sent.' });

publicRouter.get('/pay/:token', async (req, res) => {
  let link = online.getLinkByToken(req.params.token);
  if (!link) return notFound(res);
  if (link.status !== 'paid') link = await online.refreshLink(link);
  const payment = link.payment_id ? getPayment(link.payment_id) : null;
  res.set('X-Robots-Tag', 'noindex');
  res.render('pay/public', {
    title: link.status === 'paid' ? 'Payment received' : 'Pay fee',
    link,
    payment,
    returnStatus: String(req.query.status || '').slice(0, 40),
    testMode: link.environment !== 'live_mode',
  });
});

publicRouter.get('/pay/:token/receipt.pdf', (req, res) => {
  const link = online.getLinkByToken(req.params.token);
  const payment = link && link.payment_id ? getPayment(link.payment_id) : null;
  if (!payment) return notFound(res);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Receipt-${payment.receipt_no}.pdf"`);
  writeReceipt(res, payment);
});

// Staff pages (after requireLogin).
const router = express.Router();

router.post('/collect/:id/link', async (req, res, next) => {
  const student = db.prepare(`
    SELECT s.*, b.class_no, b.division FROM students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`).get(req.params.id);
  if (!student) return next();
  if (!online.enabled) {
    req.flash('error', 'Online payments are not set up. Add DODO_PAYMENTS_API_KEY to the settings file.');
    return res.redirect(`/collect/${student.id}`);
  }
  const amount = Number(String(req.body.amount || '').replace(/[,\s₹]/g, ''));
  if (!Number.isInteger(amount) || amount < online.MIN_AMOUNT || amount > 1000000) {
    req.flash('error', `Enter an amount between ₹${online.MIN_AMOUNT} and ₹10,00,000 for an online payment link.`);
    return res.redirect(`/collect/${student.id}`);
  }
  try {
    const id = await online.createLink(student, amount, baseUrl(req));
    res.redirect(`/pay-links/${id}`);
  } catch (err) {
    console.error('Could not create Dodo checkout:', err.status || '', err.message);
    req.flash('error', 'Could not create the payment link. Please try again in a minute.');
    res.redirect(`/collect/${student.id}`);
  }
});

router.get('/pay-links/:id', async (req, res, next) => {
  let link = online.getLink(req.params.id);
  if (!link) return next();
  if (link.status !== 'paid') link = await online.refreshLink(link);
  res.render('pay/link', {
    title: `Payment link · ${link.student_name}`,
    link,
    shareUrl: `${baseUrl(req)}/pay/${link.token}`,
    linkHours: online.LINK_HOURS,
    testMode: link.environment !== 'live_mode',
  });
});

router.post('/pay-links/:id/cancel', (req, res, next) => {
  const link = online.getLink(req.params.id);
  if (!link) return next();
  if (online.cancelLink(link.id)) req.flash('success', 'Payment link cancelled.');
  res.redirect(`/pay-links/${link.id}`);
});

module.exports = { webhook, publicRouter, router };
