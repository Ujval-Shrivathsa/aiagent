/**
 * Point Plivo Voice Application webhooks at your public host.
 * Usage: node scripts/configure-plivo-app.mjs https://priya-voice-agent.onrender.com
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

const base = String(process.argv[2] || process.env.APP_URL || '').replace(/\/$/, '');
if (!base || base.includes('ngrok') || base.includes('localhost')) {
  console.error('Usage: node scripts/configure-plivo-app.mjs https://YOUR-PUBLIC-HOST');
  console.error('Pass your Render/Fly/Railway HTTPS URL (not ngrok or localhost).');
  process.exit(1);
}

const env = loadEnv();
const authId = env.PLIVO_AUTH_ID;
const authToken = env.PLIVO_AUTH_TOKEN;
const appId = env.PLIVO_APP_ID;

if (!authId || !authToken) {
  console.error('Missing PLIVO_AUTH_ID or PLIVO_AUTH_TOKEN in .env');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`;
const headers = { Authorization: auth, 'Content-Type': 'application/json' };

async function plivo(pathname, opts = {}) {
  const res = await fetch(`https://api.plivo.com/v1/Account/${authId}${pathname}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${pathname} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const answerUrl = `${base}/api/plivo/answer`;
const hangupUrl = `${base}/api/plivo/status`;

let applications = [];
if (appId) {
  const one = await plivo(`/Application/${appId}/`);
  applications = [one];
} else {
  const list = await plivo('/Application/?limit=20');
  applications = list.objects || [];
  if (applications.length === 0) {
    console.error('No Plivo applications found. Create one in Plivo console or set PLIVO_APP_ID in .env');
    process.exit(1);
  }
}

for (const app of applications) {
  const id = app.app_id || app.application_id || app.id;
  console.log(`Updating Plivo app ${id} (${app.app_name || app.name || 'unnamed'})`);
  await plivo(`/Application/${id}/`, {
    method: 'POST',
    body: JSON.stringify({
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST',
      message_url: app.message_url || '',
      message_method: app.message_method || 'POST',
    }),
  });
  console.log(`  answer_url  → ${answerUrl}`);
  console.log(`  hangup_url  → ${hangupUrl}`);
}

console.log('\nOutbound calls use:', `${base}/api/plivo/outbound`);
console.log('Done. Test inbound by calling your Plivo number.');
