import { createServer } from 'http';
import next from 'next';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { setupGemini } from './src/voice/logic';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env.local' });
dotenv.config({ path: '../.env' });

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = Number(process.env.PORT || 3000);

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    console.log('[WS] New voice connection received');
    setupGemini(ws as any);
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
  });
});
