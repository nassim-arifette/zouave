import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './api.ts';
const app = createApp();
const dist = fileURLToPath(new URL('../web/dist/', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => { res.sendFile(`${dist}index.html`); });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => console.log(`Zouave listening on http://localhost:${port} (voice: ${process.env.OPENAI_API_KEY ? process.env.ZOUAVE_VOICE ?? 'live' : 'disabled'})`));
