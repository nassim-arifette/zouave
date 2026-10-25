import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Redis } from '@upstash/redis';

export type DemoAction = 'session' | 'tts' | 'tts_chars' | 'google' | 'google_session' | 'street';
export type QuotaResult = { allowed: boolean; retryAfter: number; reason: string };
export interface DemoLimiter {
  enabled: boolean;
  until: number;
  sessionSeconds: number;
  available(): boolean;
  take(action: DemoAction, identity: string, units?: number): Promise<QuotaResult>;
}

// One atomic decision for the shared total, short global window and per-visitor
// window. A rejected request never spends another action's remaining quota.
export const quotaScript = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local visitor = tonumber(redis.call('GET', KEYS[2]) or '0')
local burst = tonumber(redis.call('GET', KEYS[3]) or '0')
if total + tonumber(ARGV[6]) > tonumber(ARGV[1]) then return {0, tonumber(ARGV[4]), 1} end
if visitor + tonumber(ARGV[6]) > tonumber(ARGV[2]) then return {0, math.max(1, redis.call('TTL', KEYS[2])), 2} end
if burst + tonumber(ARGV[6]) > tonumber(ARGV[3]) then return {0, math.max(1, redis.call('TTL', KEYS[3])), 2} end
redis.call('INCRBY', KEYS[1], tonumber(ARGV[6])); redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
redis.call('INCRBY', KEYS[2], tonumber(ARGV[6])); if visitor == 0 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5])) end
redis.call('INCRBY', KEYS[3], tonumber(ARGV[6])); if burst == 0 then redis.call('EXPIRE', KEYS[3], 60) end
return {1, 0, 0}
`;

const positive = (value: string | undefined, fallback: number, max: number) => {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error('Invalid demo limit.');
  return number;
};

export function createDemoLimiter(env: NodeJS.ProcessEnv = process.env, now = Date.now): DemoLimiter {
  const enabled = Boolean(env.ZOUAVE_DEMO_UNTIL) || env.VERCEL === '1';
  const until = Date.parse(env.ZOUAVE_DEMO_UNTIL ?? '2026-10-26T23:00:00Z');
  if (!Number.isFinite(until)) throw new Error('Invalid demo expiration.');
  const sessionSeconds = positive(env.ZOUAVE_DEMO_SESSION_SECONDS, 60, 60);
  const limits = {
    session: [positive(env.ZOUAVE_DEMO_MAX_SESSIONS, 20, 20), positive(env.ZOUAVE_DEMO_SESSIONS_PER_IP, 2, 2), 4, positive(env.ZOUAVE_DEMO_IP_WINDOW_SECONDS, 300, 300)],
    tts: [positive(env.ZOUAVE_DEMO_MAX_TTS_CALLS, 60, 60), 6, 15, 60],
    tts_chars: [3000, 1200, 1800, 60],
    google_session: [20, 3, 6, 300],
    google: [1000, 200, 300, 60],
    street: [30, 3, 6, 300],
  };
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const redis = url && token ? new Redis({ url, token, retry: { retries: 0 } }) : undefined;
  return {
    enabled, until, sessionSeconds,
    available: () => !enabled || (now() < until && Boolean(redis)),
    async take(action, identity, units = 1) {
      if (!Number.isInteger(units) || units < 1) throw new Error('Invalid quota units.');
      if (!enabled) return { allowed: true, retryAfter: 0, reason: '' };
      if (now() >= until) return { allowed: false, retryAfter: 0, reason: 'This demo has ended. The map and text tools remain available.' };
      if (!redis) return { allowed: false, retryAfter: 60, reason: 'Demo protection is unavailable. Please try again later.' };
      const [total, visitor, burst, window] = limits[action];
      const prefix = `zouave:demo:${until}:${action}`; // Stable across redeploys and preview URLs.
      const visitorKey = createHash('sha256').update(`${token}:${identity}`).digest('hex');
      try {
        const result = await redis.eval(quotaScript,
          [`${prefix}:total`, `${prefix}:ip:${visitorKey}`, `${prefix}:minute`],
          [total, visitor, burst, Math.max(1, Math.ceil((until - now()) / 1000)), window, units]) as [number, number, number];
        return { allowed: result[0] === 1, retryAfter: result[1], reason: result[2] === 1 ? 'The demo quota has been reached. The map and text tools remain available.' : 'Too many requests. Please wait before trying again.' };
      } catch {
        return { allowed: false, retryAfter: 60, reason: 'Demo protection is temporarily unavailable. Please try again later.' };
      }
    },
  };
}

export async function allowDemo(limiter: DemoLimiter, action: DemoAction, req: Request, res: Response, units = 1) {
  // This Vercel header is set by the platform. Never trust client-supplied X-Forwarded-For locally.
  const identity = process.env.VERCEL === '1' ? String(req.headers['x-vercel-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim() : req.socket.remoteAddress ?? 'local';
  const result = await limiter.take(action, identity, units);
  if (!result.allowed) {
    res.setHeader('Cache-Control', 'no-store');
    if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
    res.status(429).json({ error: result.reason });
  }
  return result.allowed;
}
