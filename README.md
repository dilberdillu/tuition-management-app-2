# Tuition Manager

A lightweight, mobile-friendly app for a tuition center to **collect and track fees** and **mark attendance**.
It runs on Node.js + Express, stores data in SQLite, and renders its pages on the server, so there's no build step.

## Features

- **Dashboard:** collected today, this month's collection vs. billed, total pending, today's attendance, a 12-month collection chart, a payment-mode split, class-wise figures, the students with the highest pending fees, and recent payments.
- **Quick fee collection:** search a student, the amount is pre-filled with what they owe, pick Cash/UPI/Bank/Cheque, and save. A PDF receipt is ready to download straight away.
- **Fee ledger:** a monthly fee is charged automatically for every active student from their joining month. Payments settle the oldest month first. Partial and advance payments both work. Single months can be waived.
- **Student profile:** pending amount, month-by-month fee status, every receipt (downloadable PDF) and an attendance summary.
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

## Project layout

```
server.js            Express app setup
src/config.js        Environment settings
src/db.js            SQLite schema (created automatically)
src/fees.js          Dues generation, ledger, payment recording
src/receipt.js       PDF receipt (pdfkit)
src/routes/          Dashboard, students, fees/reports, attendance, settings, auth
views/               EJS templates
public/              CSS, small JS enhancements
scripts/             create-admin, seed-demo, backup
deploy/              systemd unit, Nginx site, backup cron
```
