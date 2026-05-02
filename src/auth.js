// src/auth.js
// One-shot script: ask Pear Desktop for a token, print it, exit.
// Run with: npm run auth
import 'dotenv/config';
import { YTMDClient } from './ytmd.js';

const host = process.env.YTMD_HOST || 'http://127.0.0.1:26538';
const clientId = process.env.YTMD_CLIENT_ID || 'ytmd-stream-bot';

console.log(`Requesting token from ${host} for client "${clientId}"...`);
console.log('A confirmation dialog should appear in Pear Desktop. Click "Allow".\n');

try {
  const token = await YTMDClient.requestToken({ host, clientId });
  console.log('Success. Add this to your .env file:\n');
  console.log(`YTMD_TOKEN=${token}\n`);
} catch (err) {
  console.error('Failed:', err.message);
  console.error('\nChecklist:');
  console.error('  1. Pear Desktop / YTMD is running.');
  console.error('  2. Settings -> Plugins -> "API Server" is enabled.');
  console.error('  3. The port matches YTMD_HOST in your .env (default 26538).');
  process.exit(1);
}
