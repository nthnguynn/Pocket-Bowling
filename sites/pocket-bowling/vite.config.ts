import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cert = env.HTTPS_CERT;
  const key = env.HTTPS_KEY;
  const https = cert && key
    ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
    : undefined;

  return {
    server: {
      host: true,
      port: Number(env.WEB_PORT || 5173),
      https,
    },
    preview: { host: true, port: 4173, https },
    build: { target: 'es2022', sourcemap: true },
  };
});
