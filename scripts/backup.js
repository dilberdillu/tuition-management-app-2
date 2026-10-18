// Consistent online backup of the SQLite database, keeping the newest 30 copies.
//   npm run backup            (writes to ./backups)
//   BACKUP_DIR=/path npm run backup
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { isoDate } = require('../src/util');

const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const keep = Number(process.env.BACKUP_KEEP) || 30;
fs.mkdirSync(dir, { recursive: true });

const stamp = `${isoDate()}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
const file = path.join(dir, `tuition-${stamp}.db`);

db.backup(file)
  .then(() => {
    const old = fs.readdirSync(dir).filter((f) => /^tuition-.*\.db$/.test(f)).sort().reverse().slice(keep);
    old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
    console.log(`Backup written: ${file}${old.length ? ` (removed ${old.length} old)` : ''}`);
  })
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
