# Tuition Manager

Node.js + Express + SQLite (better-sqlite3) app with server-rendered EJS views. See README.md for features and how fees are calculated.

- Entry point: `server.js`. Settings come from environment variables (`src/config.js`).
- Schema is created automatically in `src/db.js`. Fee ledger logic is in `src/fees.js`.
- Local dev: `npm run dev`. Demo data: `DB_PATH=data/demo.db npm run seed-demo`.

## Deployment

Shared course server. Other students' apps run on it too.

| | |
|---|---|
| Server | 187.127.162.81 (Ubuntu) |
| SSH | `ssh mohammedfadhu@187.127.162.81` (key login) |
| App name | `tuition` |
| Port | 3100 (allowed range 3100–3199) |
| Address | https://mohammedfadhu.dhilber.in → 127.0.0.1:3100 |
| Repo | https://github.com/dilberdillu/tuition-management-app-2 (public) |
| Code | `~/apps/tuition/` |
| Database | `~/data/tuition/tuition.db` |
| Backups | `~/data/tuition/backups/` (daily cron at 21:03 UTC, kept 14 days) |
| Settings and secrets | `~/.config/tuition.env` (chmod 600, never committed) |
| Service | `~/.config/systemd/user/tuition.service` |

### Updating

After pushing changes to GitHub:

```
ssh mohammedfadhu@187.127.162.81 "cd ~/apps/tuition && git pull && npm ci && systemctl --user restart tuition"
```

Then check: `systemctl --user status tuition --no-pager`, `curl -s http://127.0.0.1:3100/login`, and open the address.
Logs: `journalctl --user -u tuition -n 50 --no-pager`.

Create or reset an admin login on the server (the password is read from the environment, never commit it):

```
cd ~/apps/tuition && set -a && . ~/.config/tuition.env && set +a && ADMIN_USER=<name> ADMIN_PASSWORD=<password> node scripts/create-admin.js
```

### Server rules

1. No sudo, apt or `npm install -g`. If something needs root, ask the instructor.
2. Stay inside /home/mohammedfadhu. Never read, change, stop or kill anything you didn't create.
3. Listen on 127.0.0.1 only, on a port in 3100–3199 (never 3000 or 0.0.0.0, including test runs).
4. Don't touch the web server, firewall or DNS.
5. Keep secrets out of git and out of this file. They go only in `~/.config/tuition.env`.
6. Keep the app running with `systemctl --user`, not pm2, nohup, screen or `&`.

The `deploy/` folder (nginx, root systemd unit, /etc/cron.d) is for a dedicated VPS with root access and is **not** used on this server.
