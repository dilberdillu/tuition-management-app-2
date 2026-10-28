# Tuition Manager

Node.js + Express + SQLite (better-sqlite3) app with server-rendered EJS views. See README.md for features and how fees are calculated.

- Entry point: `server.js`. Settings come from environment variables (`src/config.js`).
- Schema is created automatically in `src/db.js`. Fee ledger logic is in `src/fees.js`.
- Online payments (Dodo Payments) are in `src/online.js` and `src/routes/online.js`; see README "Online payments". Keys come from `DODO_PAYMENTS_*` env vars (local: `.env`, gitignored). Never put keys in `.env.example`.
- Local dev: `npm run dev`. Demo data: `DB_PATH=data/demo.db npm run seed-demo`.

## Deployment

Shared course server. Other students' apps run on it too.

| | |
|---|---|
| Server | 187.127.162.81 (Ubuntu 26.04) |
| SSH | `ssh dhilber@187.127.162.81` (key login) |
| App name | `tuition` |
| Port | 3000 (allowed range 3000–3099) |
| Address | https://dhilber.dhilber.in → 127.0.0.1:3000 |
| Repo | https://github.com/dilberdillu/tuition-management-app-2 (public) |
| Code | `~/apps/tuition/` |
| Database | `~/data/tuition/tuition.db` |
| Backups | `~/data/tuition/backups/` (daily cron at 21:00 UTC, kept 14 days) |
| Settings and secrets | `~/.config/tuition.env` (chmod 600, never committed). Quote values containing spaces, e.g. `CENTER_NAME="Bright Future Tuition"` |
| Admin login | user `admin`; generated password stored only in `~/.config/tuition-admin.txt` (chmod 600) |
| Service | `~/.config/systemd/user/tuition.service` |
| Online payments | Dodo Payments, **test mode**. Keys in `~/.config/tuition.env` (`DODO_PAYMENTS_*`). Webhook `https://dhilber.dhilber.in/webhooks/dodo` for `payment.succeeded` (Dodo endpoint `ep_3LIpMIpKU91DfXFvWsaj76KKFp2`); its signing secret is `DODO_PAYMENTS_WEBHOOK_KEY` |

### Updating

After pushing changes to GitHub:

```
ssh dhilber@187.127.162.81 "cd ~/apps/tuition && git pull && npm ci && systemctl --user restart tuition"
```

Then check: `systemctl --user status tuition --no-pager`, `curl -s http://127.0.0.1:3000/login`, and open the address.
Logs: `journalctl --user -u tuition -n 50 --no-pager`.

Create or reset an admin login on the server (the password is read from the environment, never commit it):

```
cd ~/apps/tuition && set -a && . ~/.config/tuition.env && set +a && ADMIN_USER=<name> ADMIN_PASSWORD=<password> node scripts/create-admin.js
```

### Server rules

1. No sudo, apt or `npm install -g`. If something needs root, ask the instructor.
2. Stay inside /home/dhilber. Never read, change, stop or kill anything you didn't create.
3. Listen on 127.0.0.1 only, on a port in 3000–3099 (never 0.0.0.0 or a port outside the range, including test runs).
4. Don't touch the web server, firewall or DNS.
5. Keep secrets out of git and out of this file. They go only in `~/.config/tuition.env`.
6. Keep the app running with `systemctl --user`, not pm2, nohup, screen or `&`.

The `deploy/` folder (nginx, root systemd unit, /etc/cron.d) is for a dedicated VPS with root access and is **not** used on this server.
