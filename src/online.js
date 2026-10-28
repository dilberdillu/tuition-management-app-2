// Online fee payments through Dodo Payments' hosted checkout.
// Staff create a pay link for a student and amount; the parent opens /pay/<token> and pays.
// A payment is recorded only after Dodo confirms it: by a signed webhook, or by asking the
// Dodo API when the parent comes back from checkout or someone views the link.
const crypto = require('crypto');
const DodoPayments = require('dodopayments');
const db = require('./db');
const config = require('./config');
const { recordPayment } = require('./fees');
const { isoDate } = require('./util');

const enabled = Boolean(config.dodo.apiKey);
const client = enabled
  ? new DodoPayments({
    bearerToken: config.dodo.apiKey,
    environment: config.dodo.environment,
    webhookKey: config.dodo.webhookKey || null,
  })
  : null;

// Dodo checkout sessions expire after 24 hours.
const LINK_HOURS = 24;
// Dodo's smallest one-time charge is about US$0.50.
const MIN_AMOUNT = 50;

const stmt = {
  product: db.prepare('SELECT product_id FROM dodo_products WHERE environment = ? AND amount = ?'),
  saveProduct: db.prepare('INSERT OR IGNORE INTO dodo_products (environment, amount, product_id) VALUES (?, ?, ?)'),
  insertLink: db.prepare(`
    INSERT INTO pay_links (token, student_id, amount, environment, session_id, checkout_url)
    VALUES (@token, @student_id, @amount, @environment, @session_id, @checkout_url)`),
  link: db.prepare(`
    SELECT l.*, s.name AS student_name, b.class_no, b.division
    FROM pay_links l JOIN students s ON s.id = l.student_id JOIN batches b ON b.id = s.batch_id
    WHERE l.id = ?`),
  linkIdByToken: db.prepare('SELECT id FROM pay_links WHERE token = ?'),
  linkIdBySession: db.prepare('SELECT id FROM pay_links WHERE session_id = ?'),
  markPaid: db.prepare("UPDATE pay_links SET status = 'paid', dodo_payment_id = ?, payment_id = ? WHERE id = ?"),
  cancel: db.prepare("UPDATE pay_links SET status = 'cancelled' WHERE id = ? AND status = 'pending'"),
  forStudent: db.prepare('SELECT * FROM pay_links WHERE student_id = ? ORDER BY id DESC LIMIT 10'),
};

function withState(link) {
  if (!link) return link;
  const ageMs = Date.now() - Date.parse(`${link.created_at.replace(' ', 'T')}Z`);
  const expired = link.status === 'pending' && ageMs > LINK_HOURS * 3600 * 1000;
  return { ...link, expired, state: expired ? 'expired' : link.status };
}

const getLink = (id) => withState(stmt.link.get(id));
const getLinkByToken = (token) => {
  const row = /^[a-f0-9]{32}$/.test(token || '') ? stmt.linkIdByToken.get(token) : null;
  return row ? getLink(row.id) : null;
};
const linksForStudent = (studentId) => stmt.forStudent.all(studentId).map(withState);

// Dodo charges a product's own price, so each distinct fee amount gets one product (created once).
async function productFor(amount) {
  const env = config.dodo.environment;
  const row = stmt.product.get(env, amount);
  if (row) return row.product_id;
  const product = await client.products.create({
    name: 'Tuition fee',
    description: `Tuition fee payment of Rs. ${amount.toLocaleString('en-IN')}`,
    price: { type: 'one_time_price', currency: 'INR', price: amount * 100, tax_inclusive: true },
    tax_category: 'edtech',
  });
  stmt.saveProduct.run(env, amount, product.product_id);
  return stmt.product.get(env, amount).product_id;
}

async function createLink(student, amount, baseUrl) {
  const token = crypto.randomBytes(16).toString('hex');
  const productId = await productFor(amount);
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    billing_currency: 'INR',
    billing_address: { country: 'IN' },
    metadata: { pay_link: token, student_id: String(student.id) },
    return_url: `${baseUrl}/pay/${token}`,
  });
  const info = stmt.insertLink.run({
    token,
    student_id: student.id,
    amount,
    environment: config.dodo.environment,
    session_id: session.session_id,
    checkout_url: session.checkout_url,
  });
  return info.lastInsertRowid;
}

// Record a confirmed Dodo payment against its link, exactly once. Returns the payments.id or null.
// A cancelled or expired link is still recorded: if the parent paid, the money was received.
const applyPayment = db.transaction((linkId, payment) => {
  const link = stmt.link.get(linkId);
  if (!link) return null;
  if (link.status === 'paid') return link.payment_id;
  if (payment.status !== 'succeeded') return null;
  if (payment.metadata?.pay_link !== link.token || payment.currency !== 'INR' || payment.total_amount < link.amount * 100) {
    console.error(`Dodo payment ${payment.payment_id} does not match pay link ${link.id}; not recorded`);
    return null;
  }
  const paidAt = new Date(payment.created_at);
  const paymentId = recordPayment({
    studentId: link.student_id,
    amount: link.amount,
    mode: config.onlineMode,
    reference: payment.payment_id,
    paidOn: Number.isNaN(paidAt.getTime()) ? isoDate() : isoDate(paidAt),
    note: 'Paid online',
  });
  stmt.markPaid.run(payment.payment_id, paymentId, link.id);
  return paymentId;
});

// Ask Dodo whether a pending link has been paid. Safe to call often; never throws.
async function refreshLink(link) {
  if (!enabled || !link || link.status === 'paid' || link.environment !== config.dodo.environment) return link;
  try {
    const session = await client.checkoutSessions.retrieve(link.session_id);
    if (session.payment_id && session.payment_status === 'succeeded') {
      applyPayment(link.id, await client.payments.retrieve(session.payment_id));
      return getLink(link.id);
    }
  } catch (err) {
    console.error(`Could not check pay link ${link.id} with Dodo:`, err.message);
  }
  return link;
}

// Check a webhook's signature and return the event. Throws if it is not from Dodo.
function verifyWebhook(rawBody, headers) {
  return client.webhooks.unwrap(rawBody, {
    headers: {
      'webhook-id': headers['webhook-id'],
      'webhook-signature': headers['webhook-signature'],
      'webhook-timestamp': headers['webhook-timestamp'],
    },
  });
}

// Dodo retries webhooks and may also be checked by refreshLink(); applyPayment() makes both safe.
function applyWebhook(event) {
  if (event.type !== 'payment.succeeded') return;
  const payment = event.data;
  const row = (payment.metadata?.pay_link && stmt.linkIdByToken.get(payment.metadata.pay_link))
    || (payment.checkout_session_id && stmt.linkIdBySession.get(payment.checkout_session_id));
  if (row) applyPayment(row.id, payment);
}

const cancelLink = (id) => stmt.cancel.run(id).changes > 0;

module.exports = {
  enabled,
  webhookEnabled: enabled && Boolean(config.dodo.webhookKey),
  testMode: config.dodo.environment !== 'live_mode',
  MIN_AMOUNT,
  LINK_HOURS,
  createLink,
  getLink,
  getLinkByToken,
  linksForStudent,
  refreshLink,
  verifyWebhook,
  applyWebhook,
  cancelLink,
};
