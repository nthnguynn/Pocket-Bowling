import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { attachSignaling } from './signalingCore';

/** Server ghép phòng chạy riêng khi dev (`npm run signal`). Production dùng serve.ts: web + signaling chung một cổng. */
const host = process.env.SIGNAL_HOST || '0.0.0.0';
const port = Number(process.env.SIGNAL_PORT || 8787);
const certPath = process.env.SIGNAL_TLS_CERT;
const keyPath = process.env.SIGNAL_TLS_KEY;

let signaling: ReturnType<typeof attachSignaling> | null = null;
const requestHandler: http.RequestListener = (_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ service: 'Pocket Arcade signaling', rooms: signaling?.roomCount ?? 0 }));
};
const server = certPath && keyPath
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, requestHandler)
  : http.createServer(requestHandler);
signaling = attachSignaling(server);

server.listen(port, host, () => {
  const scheme = certPath && keyPath ? 'wss' : 'ws';
  console.log(`[signal] ${scheme}://${host}:${port} — room TTL ${Math.round(signaling!.roomTtlMs / 60_000)} phút, tối đa ${signaling!.maxControllers} điện thoại/phòng`);
});

function shutdown(): void {
  signaling?.close(() => server.close(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
