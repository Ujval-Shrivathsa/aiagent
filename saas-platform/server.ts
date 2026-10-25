import { createServer } from 'http';
import { utimesSync } from 'fs';
import path from 'path';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { setupGemini } from './src/voice/logic';
import { clearOutboundOpeningInstructionCache } from './src/voice/opening-prewarm-cache';
import { VOICE_BEHAVIOR_VERSION } from './src/voice/kannada-script';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = Number(process.env.PORT) || 3000;

app.prepare().then(() => {
  // Drop any in-memory opening prompts from a previous process so updated
  // greeting / silence / name rules always win after restart or deploy.
  const cleared = clearOutboundOpeningInstructionCache();
  if (cleared > 0) {
    console.log(`> Cleared ${cleared} stale outbound opening cache entr(y/ies)`);
  }
  console.log(`> Voice behavior version: ${VOICE_BEHAVIOR_VERSION}`);

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || '', true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    console.log('[WS] New voice connection received (Gemini Live)');
    const reqUrl = new URL(req.url || '/media-stream', `http://${req.headers.host || 'localhost'}`);
    // The origin Plivo actually reached us on. The hangup API has to hand Plivo
    // a callback URL, so this handshake is the one address we can trust; an env
    // var can be unset or stale in the dashboard and that silently killed every
    // remote hangup. Render terminates TLS in front of us, hence the forwarded
    // proto.
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
    const host = String(req.headers.host || '').split(',')[0].trim();
    const publicBaseUrl = host ? `${proto}://${host}` : undefined;
    setupGemini(ws as any, reqUrl.searchParams, { publicBaseUrl });
  });

  server.on('upgrade', (req, socket, head) => {
    const reqUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    if (reqUrl.pathname === '/media-stream') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
    console.log(`> WebSocket listening on ws://localhost:${port}/media-stream`);
    console.log(
      `> Voice provider: ${process.env.VOICE_PROVIDER || 'twilio'} | Stack: Gemini Live | APP_URL: ${process.env.APP_URL ? 'set' : 'missing'}`,
    );
    if (dev) {
      // Turbopack can boot with nested route handlers missing. A file event
      // under app/ a few seconds later rebuilds that tree. Without it,
      // POST /api/campaign/start stays 404 for the whole dev session.
      const campaignRoute = path.resolve(process.cwd(), 'src/app/api/campaign/start/route.ts');
      setTimeout(() => {
        try {
          const now = new Date();
          utimesSync(campaignRoute, now, now);
        } catch {
          // A missed nudge only leaves the dev 404 this boot already had.
        }
      }, 8000);
    }
  });
});
