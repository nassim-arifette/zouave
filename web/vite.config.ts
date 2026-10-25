import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3000', '/cache': 'http://127.0.0.1:3000' } }, build: { outDir: 'dist', emptyOutDir: true } });
