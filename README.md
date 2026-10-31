# Tuition Manager

A lightweight, mobile-friendly app for a tuition center to **collect and track fees** and **mark attendance**.
It runs on Node.js + Express, stores data in SQLite, and renders its pages on the server, so there's no build step.

## Features

- **Dashboard:** collected today, this month's collection vs. billed, total pending, today's attendance, a 12-month collection chart, a payment-mode split, class-wise figures, the students with the highest pending fees, and recent payments.
- **Quick fee collection:** search a student, the amount is pre-filled with what they owe, pick Cash/UPI/Bank/Cheque, and save. A PDF receipt is ready to download straight away.
- **Fee ledger:** a monthly fee is charged automatically for every active student from their joining month. Payments settle the oldest month first. Partial and advance payments both work. Single months can be waived.
- **Student profile:** pending amount, month-by-month fee status, every receipt (downloadable PDF) and an attendance summary.
- **Online payments (optional):** from the collect screen, send the parent a payment link. They pay by UPI or card through Dodo Payments, and the fee is recorded with its receipt automatically. See *Online payments* below.
- **Assistant (optional):** an AI chat for staff (💬 icon at the top) that drafts parent notices, makes study plans and explains how to use the app. See *AI assistant* below.
- **Receipts:** numbered per year (`R2026-0001`). A receipt is never deleted, only cancelled, so the numbering has no gaps.
- **Attendance:** pick a class, everyone starts as present, tap the absentees, save. There's also a monthly report per class.
- **Reports:** collections for any date range, filterable by class and mode, with CSV export.
- **Classes:** 8-A to 10-D (12 classes), each with its own monthly fee (Settings).

## Run locally

```bash
npm install
npm run create-admin     # choose a username and password
npm run seed-demo        # optional: fills an empty database with demo data
npm run dev              # http://localhost:3000
```

The database is created at `data/tuition.db`.

## Deploy on an Ubuntu VPS

These steps assume Ubuntu 22.04/24.04 and a domain (e.g. `fees.example.com`) pointing at the server.

```bash
# 1. Node.js 22 LTS, Nginx, Certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx build-essential

# 2. App user and code
sudo useradd --system --create-home --shell /usr/sbin/nologin tuition
sudo mkdir -p /opt/tuition && sudo chown tuition:tuition /opt/tuition
# copy the project into /opt/tuition (git clone, scp or rsync; leave out node_modules and data)
cd /opt/tuition
sudo -u tuition npm ci --omit=dev
sudo -u tuition mkdir -p data backups

# 3. Configuration
sudo -u tuition cp .env.example .env
sudo -u tuition nano .env      # set SESSION_SECRET, CENTER_NAME, CENTER_ADDRESS, CENTER_PHONE
sudo chmod 600 .env

# 4. Admin login
sudo -u tuition sh -c 'set -a; . ./.env; set +a; node scripts/create-admin.js'

# 5. Service
sudo cp deploy/tuition.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tuition
sudo systemctl status tuition

# 6. Nginx + HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tuition   # edit server_name first
sudo ln -s /etc/nginx/sites-available/tuition /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d fees.example.com

# 7. Nightly backups (keeps the latest 30 copies in /opt/tuition/backups)
sudo cp deploy/backup.cron /etc/cron.d/tuition-backup

# 8. Firewall
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

The app listens only on `127.0.0.1`, so it's reachable only through Nginx.
With `NODE_ENV=production`, the session cookie is HTTPS-only, so log in over `https://`.

**Copy backups off the server** from time to time (for example `scp` the `backups/` folder to your laptop), because a backup on the same VPS won't survive losing the VPS.
To restore, stop the service, copy a backup over `data/tuition.db`, then start it again.

### Updating

```bash
cd /opt/tuition
# pull or copy the new code, then:
sudo -u tuition npm ci --omit=dev
sudo systemctl restart tuition
```

## How fees are calculated

- Each class has a monthly fee (Settings). When a month starts, every active student gets that month's fee added as a due. The amount is fixed at that moment, so later fee changes never rewrite past months.
- **Pending = all dues − all payments.** A negative pending amount is shown as an advance and is used up by future months.
- Receipts list the months each payment covered (e.g. `Aug 2026, Sep 2026 (part ₹500)`) and the balance left after it.
- If a student leaves, edit them, set the status to *Left the center* and add the leaving date. No fees are charged after that month.
- **Waive** a month from the student's profile (e.g. a holiday month or a late join).
- To fix a mistaken payment, open the receipt and choose **Cancel this receipt**, then record it again.

## Online payments (Dodo Payments)

Turned on when `DODO_PAYMENTS_API_KEY` is set (see `.env.example`). Leave it empty to hide the feature.

1. On the collect screen, enter the amount and choose **Send online payment link instead**.
2. Share the link (`/pay/<token>`) with the parent. It works for 24 hours. The page shows the student, the amount and a **Pay** button that opens Dodo's checkout (UPI or card).
3. When Dodo confirms the payment, the app records it as mode **Online**, with the Dodo payment id as the reference. The parent's page then shows a downloadable receipt.

How the payment is confirmed:
- **Webhook (recommended):** in the Dodo dashboard add the endpoint `https://<your-domain>/webhooks/dodo` for the `payment.succeeded` event, and put its signing secret in `DODO_PAYMENTS_WEBHOOK_KEY`.
- Without a webhook, the app asks the Dodo API whenever the parent returns from checkout or someone opens the link. This also works on a laptop, where Dodo can't reach the webhook.

A payment is recorded only once, even if Dodo sends the webhook again. Each fee amount becomes one Dodo product the first time it's used (Dodo charges a product's fixed price, priced in INR and tax inclusive).

Testing: use a `dodo_test_` key with `DODO_PAYMENTS_ENVIRONMENT=test_mode`. Payments are in INR with an Indian billing address, so Dodo accepts only Indian methods: pay with UPI ID `success@upi` or the Indian test card `4576 2389 1277 1450` (expiry 06/32, CVV 123). Foreign cards such as `4242…` fail with `PAYMENT_METHOD_UNSUPPORTED`. If a payment fails, the parent's **Pay** button starts a fresh checkout for the same link. Switch to a live key and `live_mode` only when the Dodo account is approved for live payments.

## Usage analytics (PostHog)

Turned on when `POSTHOG_KEY` is set (see `.env.example`). Leave it empty to turn analytics off.

- **Staff pages** load PostHog for page views, clicks and session replay. The script is served from this app (`/static/vendor/posthog.js`, the "no-external" build), so no third-party scripts run. All page text and form inputs are masked in replays and click data, and the student search (`?q=`) is removed from every URL sent.
- **Server events** (`src/analytics.js`): `logged_in`, `login_failed`, `fee_collected`, `receipt_downloaded`, `receipt_cancelled`, `report_exported`, `student_added`, `student_updated`, `fee_waived`, `attendance_saved`, `class_fees_updated`, `password_changed`, and for online payments `pay_link_created`, `pay_page_opened`, `pay_checkout_started`, `pay_link_paid`, `parent_receipt_downloaded`, `pay_link_cancelled`. Server errors are sent as exceptions.
- **No personal data:** events carry classes, payment modes, amounts and counts, never student or parent names, phone numbers or balances. Staff are identified by their login name. Parent pages load no PostHog script; their server events are keyed by the payment link only.
- Every event has `app_env` (`production` or `development`), so testing on a laptop can be filtered out.

## AI assistant (OpenRouter)

Turned on when `OPENROUTER_API_KEY` is set (see `.env.example`). Leave it empty to hide the chat icon.

- Staff open it from the chat icon in the top bar (`/chat`). It drafts notices and messages for parents, answers teaching questions and explains how to use this app.
- It can't see the database: only what staff type is sent to OpenRouter, along with a fixed description of the app. The page asks staff not to type phone numbers or private details.
- The conversation is kept in the browser tab only (cleared on logout or **New chat**). The last 20 messages are sent with each question; replies are capped at 700 tokens.
- Model: `OPENROUTER_MODEL`, default `mistralai/mistral-nemo` (about $0.03 per million tokens, so a reply costs a tiny fraction of a cent). Any model id from openrouter.ai/models works. Free `:free` models also work but are rate-limited.
- Each staff login can ask 60 questions an hour. PostHog gets `assistant_replied` / `assistant_failed` with the model and token counts, never the text.

## Project layout

```
server.js            Express app setup
src/config.js        Environment settings
src/db.js            SQLite schema (created automatically)
src/fees.js          Dues generation, ledger, payment recording
src/receipt.js       PDF receipt (pdfkit)
src/online.js        Online payment links (Dodo Payments)
src/analytics.js     PostHog usage analytics (server events)
src/chat.js          Staff AI assistant (OpenRouter)
src/routes/          Dashboard, students, fees/reports, attendance, settings, auth, online payments, assistant
views/               EJS templates
public/              CSS, small JS enhancements
scripts/             create-admin, seed-demo, backup
deploy/              systemd unit, Nginx site, backup cron
```
