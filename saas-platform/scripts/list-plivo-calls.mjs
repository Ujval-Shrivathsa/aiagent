import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const auth = `Basic ${Buffer.from(`${env.PLIVO_AUTH_ID}:${env.PLIVO_AUTH_TOKEN}`).toString('base64')}`;
const res = await fetch(`https://api.plivo.com/v1/Account/${env.PLIVO_AUTH_ID}/Call/?limit=8`, {
  headers: { Authorization: auth },
});
const data = await res.json();
for (const c of data.objects || []) {
  console.log({
    to: c.to_number,
    state: c.call_state,
    duration: c.bill_duration,
    hangup: c.hangup_cause_name,
    init: c.initiation_time,
  });
}
