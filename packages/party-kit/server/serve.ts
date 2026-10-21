import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { attachSignaling } from './signalingCore';
import { contentType, discoverSites, resolveStatic } from './staticSites';

/**
 * Server production: một cổng duy nhất (mặc định 3003) phục vụ mọi site đã build và signaling WebSocket ở /ws.
 * Đặt sau reverse proxy có HTTPS (nginx, Caddy, Cloudflare Tunnel…) để điện thoại dùng được cảm biến.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3003);
const mounts = discoverSites(repoRoot);
if (!mounts.length) {
  console.error('[serve] Chưa có site nào được build. Chạy `npm run build` trước.');
  process.exit(1);
}

let signaling: ReturnType<typeof attachSignaling> | null = null;

const server = http.createServer((request, response) => {
  const url = request.url ?? '/';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  if (url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok: true, rooms: signaling?.roomCount ?? 0, sites: mounts.map((mount) => mount.prefix) }));
    return;
  }
  const result = resolveStatic(mounts, url);
  if (result.kind === 'redirect') {
    response.writeHead(308, { location: result.location }).end();
    return;
  }
  if (result.kind === 'missing') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Không tìm thấy');
    return;
  }
  const { size } = fs.statSync(result.file);
  response.writeHead(200, {
    'content-type': contentType(result.file),
    'content-length': size,
    // File trong assets/ có hash trong tên nên cache lâu được; index.html luôn hỏi lại để nhận bản mới.
    'cache-control': result.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(result.file).pipe(response);
});

signaling = attachSignaling(server, { path: '/ws' });

server.listen(port, host, () => {
  console.log(`[serve] http://${host === '0.0.0.0' ? 'localhost' : host}:${port} — signaling ở /ws, tối đa ${signaling!.maxControllers} điện thoại/phòng`);
  mounts.slice().reverse().forEach((mount) => console.log(`[serve]   ${mount.prefix.padEnd(10)} ← ${mount.dir}`));
});

function shutdown(): void {
  signaling?.close(() => server.close(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
