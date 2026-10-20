import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/** .env dùng chung cho mọi site, đặt ở gốc repo (chứng chỉ HTTPS, địa chỉ signaling, URL các site…). */
const envDir = fileURLToPath(new URL('../..', import.meta.url));
/** Cổng cố định: trang kho game và các site trỏ link sang nhau theo cổng này khi dev. */
const PORT = 5174;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const https = env.HTTPS_CERT && env.HTTPS_KEY
    ? { cert: fs.readFileSync(env.HTTPS_CERT), key: fs.readFileSync(env.HTTPS_KEY) }
    : undefined;
  return {
    envDir,
    server: { host: true, port: PORT, strictPort: true, https },
    preview: { host: true, port: PORT + 1000, https },
    build: { target: 'es2022', sourcemap: true },
  };
});
