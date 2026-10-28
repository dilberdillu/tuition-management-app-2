const path = require('path');
require('dotenv').config({ quiet: true });

// Fee months and "today" must follow the center's clock, not the VPS's (often UTC).
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production. See .env.example');
  process.exit(1);
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  dbPath: path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tuition.db')),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  defaultFee: Number(process.env.DEFAULT_MONTHLY_FEE) || 2500,
  center: {
    name: process.env.CENTER_NAME || 'My Tuition Center',
    address: process.env.CENTER_ADDRESS || '',
    phone: process.env.CENTER_PHONE || '',
  },
  paymentModes: ['Cash', 'UPI', 'Bank', 'Cheque'],
  // Mode recorded for fees paid through an online payment link (never chosen by hand).
  onlineMode: 'Online',
  // Base address for links sent to parents, e.g. https://fees.example.com. Defaults to the request's host.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // Online payments through Dodo Payments. Disabled when no API key is set.
  dodo: {
    apiKey: process.env.DODO_PAYMENTS_API_KEY || '',
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY || '',
    // Anything other than an explicit live_mode stays in test mode, so a typo can never charge real money.
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode',
  },
};
