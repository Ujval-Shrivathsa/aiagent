/**
 * Build a paste-ready env block for Render Blueprint / Environment.
 * Usage: node scripts/generate-render-env.mjs [outputPath]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const outPath = path.resolve(__dirname, '..', process.argv[2] || 'render-env.paste.txt');

const skip = new Set(['RECORDINGS_DIR', 'CALL_LOGS_DIR', 'APP_URL', 'VOICE_SERVER_URL']);

function parseEnv(file) {
  const map = new Map();
  for (const line of file.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map.set(t.slice(0, i).trim(), v);
  }
  return map;
}

if (!fs.existsSync(envPath)) {
  console.error('Missing .env at', envPath);
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const lines = [
  '# Paste into Render → priya-voice-agent → Environment → Add from .env',
  '# After first deploy, set APP_URL and VOICE_SERVER_URL to your Render HTTPS URL.',
  '',
];

for (const [key, value] of env) {
  if (skip.has(key)) continue;
  lines.push(`${key}=${value}`);
}

lines.push('');
lines.push('# Set AFTER you know the public Render URL (example):');
lines.push('# APP_URL=https://priya-voice-agent.onrender.com');
lines.push('# VOICE_SERVER_URL=https://priya-voice-agent.onrender.com');

fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${outPath} (${env.size - skip.size} keys, APP_URL/VOICE_SERVER_URL excluded)`);
