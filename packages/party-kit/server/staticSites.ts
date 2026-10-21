import fs from 'node:fs';
import path from 'node:path';

/** Một site đã build, phục vụ dưới tiền tố đường dẫn: kho game ở '/', game ở '/<id>/'. */
export interface SiteMount {
  prefix: string;
  dir: string;
}

export type StaticResult =
  | { kind: 'file'; file: string; immutable: boolean }
  | { kind: 'redirect'; location: string }
  | { kind: 'missing' };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Tìm các site đã build trong `sites/`: `pocket-arcade/dist` ở '/', `pocket-<id>/dist` ở '/<id>/'.
 * Không cần biết trước tên game nào; site chưa build thì bỏ qua.
 */
export function discoverSites(repoRoot: string, arcadeFolder = 'pocket-arcade'): SiteMount[] {
  const sitesDir = path.join(repoRoot, 'sites');
  return fs.readdirSync(sitesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sitesDir, entry.name, 'dist', 'index.html')))
    .map((entry) => ({
      prefix: entry.name === arcadeFolder ? '/' : `/${entry.name.replace(/^pocket-/, '')}/`,
      dir: path.join(sitesDir, entry.name, 'dist'),
    }))
    // Tiền tố dài xét trước để '/marble/' không bị '/' nuốt mất.
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Ánh xạ đường dẫn URL sang file trong bản build, không bao giờ ra ngoài thư mục `dist` của site. */
export function resolveStatic(mounts: SiteMount[], rawUrl: string): StaticResult {
  const [rawPath = '/', query] = rawUrl.split('?', 2);
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return { kind: 'missing' };
  }
  if (pathname.includes('\0')) return { kind: 'missing' };

  for (const mount of mounts) {
    // '/marble' thiếu dấu '/' cuối thì đường dẫn tương đối của bản build sẽ sai: chuyển hướng, giữ query.
    if (mount.prefix !== '/' && pathname === mount.prefix.slice(0, -1)) {
      return { kind: 'redirect', location: `${mount.prefix}${query === undefined ? '' : `?${query}`}` };
    }
    if (!pathname.startsWith(mount.prefix)) continue;
    const relative = pathname.slice(mount.prefix.length);
    let file = path.resolve(mount.dir, relative || 'index.html');
    if (file !== mount.dir && !file.startsWith(mount.dir + path.sep)) return { kind: 'missing' };
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { kind: 'missing' };
    return { kind: 'file', file, immutable: relative.startsWith('assets/') };
  }
  return { kind: 'missing' };
}
