import express from 'express';
import { waitUntil } from '@vercel/functions';
import { createApp } from '../server/api.ts';
import { cacheDir } from '../server/street.ts';
const app = createApp({ background: task => waitUntil(task) });
app.use(['/cache/street', '/api/cache/street'], express.static(cacheDir, { maxAge: '1d' }));
export default app;
