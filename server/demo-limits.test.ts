import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './api.ts';
import { createDemoLimiter, type DemoLimiter } from './demo-limits.ts';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:test\r\n';
async function serve(options: Parameters<typeof createApp>[0], run: (base: string) => Promise<void>) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const hasRedis = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

test('demo fails closed without Redis and after expiry', async () => {
  const missing = createDemoLimiter({ ZOUAVE_DEMO_UNTIL: '2099-01-01T00:00:00Z' });
  assert.equal(missing.available(), false);
  assert.equal((await missing.take('session', 'test')).allowed, false);
  const expired = createDemoLimiter({ ZOUAVE_DEMO_UNTIL: '2020-01-01T00:00:00Z' });
  assert.equal(expired.available(), false);
  assert.match((await expired.take('tts', 'test')).reason, /ended/);
});

test('blocked paid routes never call their providers and browser Maps key stays private in demo', async () => {
  let calls = 0;
  const cache = await mkdtemp(join(tmpdir(), 'zouave-quota-'));
  const demo = createDemoLimiter({ ZOUAVE_DEMO_UNTIL: '2020-01-01T00:00:00Z' });
  try {
    await serve({ demo, apiKey: 'test-only', tts: { cache: cache+'/' }, google: { tilesKey: 'test-only', browserKey: 'test-browser-only' }, fetcher: (async () => { calls++; throw new Error('No upstream calls allowed'); }) as typeof fetch }, async base => {
      const session = await fetch(base+'/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp }) });
      assert.equal(session.status, 429);
      assert.equal((await fetch(base+'/api/google/3d/v1/3dtiles/root.json')).status, 429);
      assert.equal((await fetch(base+'/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Test only.' }) })).status, 429);
      const config = await (await fetch(base+'/api/config')).json();
      assert.equal(config.voice, false);
      const google = await (await fetch(base+'/api/google/status')).json();
      assert.equal(google.browser_key, null);
      assert.equal(google.tiles3d, false);
    });
    assert.equal(calls, 0);
  } finally { await rm(cache, { recursive: true, force: true }); }
});

test('Live session duration is returned to the browser and forcibly closed by the server', async () => {
  const requests: string[] = [], tasks: Promise<unknown>[] = [];
  const demo: DemoLimiter = { enabled: true, until: Date.now()+1000, sessionSeconds: 0.01, available: () => true, take: async () => ({ allowed: true, retryAfter: 0, reason: '' }) };
  await serve({ demo, apiKey: 'test-only', mode: 'live', background: task => tasks.push(task), fetcher: (async (input, options) => {
    const path = new URL(String(input)).pathname; requests.push(path);
    if (path.endsWith('/hangup')) return new Response(null, { status: 200 });
    const body = JSON.parse(String(options?.body));
    assert.equal(body.session.delegation.responses.max_output_tokens, 256);
    assert.deepEqual(body.session.client.data_channel.allowed_client_events, ['response.item.create', 'response.create', 'session.close']);
    return Response.json({ session: { id: 'test-session', expires_at: 0 }, transport: { sdp: 'v=0\r\nanswer' } });
  }) as typeof fetch }, async base => {
    const response = await fetch(base+'/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).max_duration_ms, 10);
    await Promise.all(tasks);
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /test-session\/hangup$/);
});

test('real shared Redis quota is atomic and survives a new limiter instance', { skip: !hasRedis }, async () => {
  // Separate timestamp namespace, never the public demo's counters. No paid API calls.
  const env = { KV_REST_API_URL: process.env.KV_REST_API_URL, KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN, ZOUAVE_DEMO_UNTIL: new Date(Date.now()+600_000).toISOString(), ZOUAVE_DEMO_MAX_SESSIONS: '2' };
  const limiter = createDemoLimiter(env);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => limiter.take('session', `test-${i}`)));
  assert.equal(results.filter(r => r.allowed).length, 2);
  assert.equal((await createDemoLimiter(env).take('session', 'another-instance')).allowed, false);
  const charsEnv = { ...env, ZOUAVE_DEMO_UNTIL: new Date(Date.now()+610_000).toISOString() };
  const chars = createDemoLimiter(charsEnv);
  assert.equal((await chars.take('tts_chars', 'visitor', 1200)).allowed, true);
  assert.equal((await chars.take('tts_chars', 'visitor', 1)).allowed, false);
  assert.equal((await chars.take('tts_chars', 'visitor-2', 1000)).allowed, false); // shared per-minute character cap
});
