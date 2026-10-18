// Create an admin login or reset its password.
//   npm run create-admin              (prompts for username and password)
//   ADMIN_USER=x ADMIN_PASSWORD=y npm run create-admin   (non-interactive)
const readline = require('readline');
const { setPassword } = require('../src/auth');

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

(async () => {
  const username = process.env.ADMIN_USER || (await ask('Username: ')) || 'admin';
  const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 8 chars): ', true));
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  setPassword(username, password);
  console.log(`Admin "${username}" is ready. You can log in now.`);
})();
