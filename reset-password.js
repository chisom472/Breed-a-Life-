'use strict';
// Usage: npm run reset-password            -> generates a new random password
//        npm run reset-password -- "MyNewPass123" [username]
const crypto = require('crypto');
const { get, run, logActivity } = require('../src/db');
const { hashPassword, validatePassword } = require('../src/auth');

(async () => {
  const supplied = process.argv[2];
  const user = process.argv[3] ? get('SELECT * FROM users WHERE username = ?', process.argv[3]) : get('SELECT * FROM users ORDER BY id LIMIT 1');
  if (!user) { console.error('No matching user found.'); process.exit(1); }
  const password = supplied || crypto.randomBytes(9).toString('base64url') + '7';
  const problem = validatePassword(password);
  if (problem) { console.error(problem); process.exit(1); }
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
  logActivity('system', 'password.reset', `Password reset from the command line for ${user.username}`);
  console.log(`\nPassword reset for "${user.username}".` + (supplied ? '' : `\nNew password: ${password}`) + '\nAll existing sessions were signed out.\n');
})();
