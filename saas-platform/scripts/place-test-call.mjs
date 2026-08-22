import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const authId = env.PLIVO_AUTH_ID;
const authToken = env.PLIVO_AUTH_TOKEN;
const from = env.PLIVO_PHONE_NUMBER;
const appUrl = (env.APP_URL || '').replace(/\/$/, '');
const to = process.argv[2] || '+918971901128';
const name = process.argv[3] || 'Customer';

if (!authId || !authToken || !from || !appUrl) {
  console.error('Missing PLIVO_* or APP_URL in .env');
  process.exit(1);
}

const answerUrl =
  `${appUrl}/api/plivo/outbound` +
  `?customerName=${encodeURIComponent(name)}` +
  `&customerPhone=${encodeURIComponent(to)}`;

console.log(`Calling ${to} from ${from}`);
console.log(`answer_url ${answerUrl}`);

const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: `${appUrl}/api/plivo/status`,
    hangup_method: 'POST',
    ring_url: `${appUrl}/api/plivo/status`,
    ring_method: 'POST',
  }),
});

const body = await res.json().catch(() => ({}));
console.log('plivo status', res.status);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 2);
