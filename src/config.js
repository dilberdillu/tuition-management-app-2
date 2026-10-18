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
};
