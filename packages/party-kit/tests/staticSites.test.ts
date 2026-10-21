import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverSites, resolveStatic } from '../server/staticSites';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-serve-'));
function write(relative: string, content = 'x'): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
write('sites/pocket-arcade/dist/index.html');
write('sites/pocket-arcade/dist/assets/hub-abc.js');
write('sites/pocket-marble/dist/index.html');
write('sites/pocket-marble/dist/assets/app-123.js');
write('sites/pocket-sumo/src/main.ts'); // chưa build → bỏ qua
write('secret.txt', 'không được lộ');
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const mounts = discoverSites(root);
const file = (url: string) => {
  const result = resolveStatic(mounts, url);
  return result.kind === 'file' ? path.relative(root, result.file).replaceAll(path.sep, '/') : result;
};

describe('server production phục vụ các site đã build', () => {
  it('kho game ở /, mỗi game ở /<id>/, site chưa build bị bỏ qua', () => {
    expect(mounts.map((mount) => mount.prefix).sort()).toEqual(['/', '/marble/']);
    expect(file('/')).toBe('sites/pocket-arcade/dist/index.html');
    expect(file('/marble/')).toBe('sites/pocket-marble/dist/index.html');
    expect(file('/marble/?game=marble&controller=1&room=ABCDE23456')).toBe('sites/pocket-marble/dist/index.html');
    expect(file('/marble/assets/app-123.js')).toBe('sites/pocket-marble/dist/assets/app-123.js');
    expect(resolveStatic(mounts, '/sumo/')).toEqual({ kind: 'missing' });
  });

  it('thêm dấu / cho đường dẫn game và giữ nguyên query (link QR)', () => {
    expect(resolveStatic(mounts, '/marble?controller=1&room=X')).toEqual({ kind: 'redirect', location: '/marble/?controller=1&room=X' });
    expect(resolveStatic(mounts, '/marble')).toEqual({ kind: 'redirect', location: '/marble/' });
  });

  it('chỉ file trong assets/ được cache lâu', () => {
    expect(resolveStatic(mounts, '/assets/hub-abc.js')).toMatchObject({ immutable: true });
    expect(resolveStatic(mounts, '/')).toMatchObject({ immutable: false });
  });

  it('không cho đọc file ngoài thư mục dist', () => {
    for (const url of ['/../secret.txt', '/marble/../../../secret.txt', '/marble/%2e%2e/%2e%2e/%2e%2e/secret.txt', '/marble/..%5c..%5c..%5csecret.txt', '/%00', '/%E0%A4%A']) {
      expect(resolveStatic(mounts, url), url).toEqual({ kind: 'missing' });
    }
  });
});
