/* Full outbound-agent health check. Run: node scripts/health-check.js */
const dotenv = require('dotenv');
dotenv.config({ path: '.env', override: true });

const fs = require('fs');
const WebSocket = require('ws');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const AUTH_ID = process.env.PLIVO_AUTH_ID;
const AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN;
const FROM = process.env.PLIVO_PHONE_NUMBER;
const plivoAuth = 'Basic ' + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64');

async function main() {
  // 1. Env
  report('env: VOICE_PROVIDER=plivo', (process.env.VOICE_PROVIDER || '').toLowerCase() === 'plivo', process.env.VOICE_PROVIDER);
  report('env: APP_URL is public https', /^https:\/\//.test(APP_URL) && !APP_URL.includes('localhost'), APP_URL);
  report('env: PLIVO creds present', Boolean(AUTH_ID && AUTH_TOKEN && FROM), FROM || 'missing');
  report('env: GEMINI_API_KEY present', Boolean(process.env.GEMINI_API_KEY));
  report('env: GROQ_API_KEY present', Boolean(process.env.GROQ_API_KEY));

  // 2. Local server
  try {
    const r = await fetch('http://localhost:3000/api/plivo/outbound?customerPhone=%2B917000000000', { method: 'POST' });
    const xml = await r.text();
    report('local: outbound answer XML', r.status === 200 && xml.includes('media-stream') && xml.includes('isOutbound=true'));
    report('local: XML has no Plivo <Record>', !/<Record/i.test(xml));
  } catch (e) {
    report('local: outbound answer XML', false, e.message);
  }

  // 3. Public (ngrok) endpoints
  for (const [name, path, method] of [
    ['public: outbound answer', '/api/plivo/outbound?customerPhone=%2B917000000000', 'POST'],
    ['public: inbound answer', '/api/plivo/answer', 'POST'],
    ['public: hangup/status', '/api/plivo/status', 'GET'],
  ]) {
    try {
      const r = await fetch(APP_URL + path, { method, headers: { 'ngrok-skip-browser-warning': '1' } });
      report(name, r.status === 200, `HTTP ${r.status}`);
    } catch (e) {
      report(name, false, e.message);
    }
  }

  // 4. WebSocket handshake through ngrok
  await new Promise((resolve) => {
    const wsUrl = APP_URL.replace(/^https/, 'wss') + '/media-stream?isOutbound=true&customerPhone=917000000000';
    const ws = new WebSocket(wsUrl, { headers: { 'ngrok-skip-browser-warning': '1' } });
    const timer = setTimeout(() => {
      report('public: WebSocket /media-stream handshake', false, 'timeout 8s');
      try { ws.terminate(); } catch {}
      resolve();
    }, 8000);
    ws.on('open', () => {
      clearTimeout(timer);
      report('public: WebSocket /media-stream handshake', true);
      ws.close();
      resolve();
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      report('public: WebSocket /media-stream handshake', false, e.message);
      resolve();
    });
  });

  // 5. Plivo account + number
  try {
    const r = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID}/`, { headers: { Authorization: plivoAuth } });
    const b = await r.json();
    report('plivo: credentials valid', r.status === 200, b.name || `HTTP ${r.status}`);
  } catch (e) {
    report('plivo: credentials valid', false, e.message);
  }
  try {
    const num = String(FROM || '').replace(/\D/g, '');
    const r = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID}/Number/${num}/`, { headers: { Authorization: plivoAuth } });
    const b = await r.json();
    if (r.status === 200) {
      report('plivo: number active', true, `${b.number} app=${b.application || b.app_id || 'none'} voice=${b.voice_enabled}`);
    } else {
      report('plivo: number active', false, `HTTP ${r.status} ${b.error || ''}`);
    }
  } catch (e) {
    report('plivo: number active', false, e.message);
  }

  // 6. Gemini key sanity (model list; cheap, no live session)
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=1`);
    report('gemini: API key accepted', r.status === 200, `HTTP ${r.status}`);
  } catch (e) {
    report('gemini: API key accepted', false, e.message);
  }

  // 7. Database
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const count = await prisma.lead.count();
    report('db: Prisma -> Postgres', true, `leads=${count}`);
    await prisma.$disconnect();
  } catch (e) {
    report('db: Prisma -> Postgres', false, String(e.message).split('\n')[0]);
  }

  // 8. Capture dirs writable
  for (const dir of ['recordings', 'call_logs']) {
    try {
      const probe = `${dir}/.write-probe`;
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      report(`capture: ${dir}/ writable`, true);
    } catch (e) {
      report(`capture: ${dir}/ writable`, false, e.message);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('health-check crashed:', e);
  process.exit(1);
});
