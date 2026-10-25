import { chromium } from 'playwright';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? `${homedir()}/.local/bin/google-chrome`, headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
  await page.addInitScript(() => {
    window.voiceEvents = []; window.toolResults = []; window.voiceSession = null;
    window.addEventListener('zouave:voice-event', event => window.voiceEvents.push(event.detail));
    window.addEventListener('zouave:tool', event => window.toolResults.push(event.detail));
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) { const channel = createDataChannel.apply(this, args); window.testVoiceChannel = channel; return channel; };
  });
  page.on('response', async response => {
    if (response.url().endsWith('/api/session')) {
      const json = await response.json();
      const status = { status: response.status(), id: json.id, mode: json.mode, sdpAnswer: typeof json.sdp === 'string' && json.sdp.startsWith('v=0'), error: json.error };
      console.log('POST /api/session:', JSON.stringify(status));
      await writeFile(`${homedir()}/zouave-notes/voice-session-${process.env.ZOUAVE_TEST_MODE ?? 'live'}.json`, JSON.stringify(status, null, 2));
      await page.evaluate(value => { window.voiceSession = value; }, status);
    }
  });
  await page.goto(process.env.ZOUAVE_URL ?? 'http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Activer la voix', exact: true }).click();
  await page.waitForFunction(() => window.voiceSession !== null, { timeout: 40000 });
  const session = await page.evaluate(() => window.voiceSession);
  if (!session.sdpAnswer) { console.log('Session failed; no billable connection kept open.'); process.exitCode = 1; }
  else {
    await page.waitForFunction(() => window.testVoiceChannel?.readyState === 'open', { timeout: 20000 });
    await page.evaluate(mode => {
      const send = event => window.testVoiceChannel.send(JSON.stringify(event));
      if (mode === 'realtime') {
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Appelle maintenant niveau_seine pour me donner le niveau de la Seine.' }] } });
        send({ type: 'response.create' });
      } else {
        send({ type: 'session.instructions.append', delegation_id: null, content: 'Le visiteur demande le niveau actuel de la Seine. Délègue immédiatement au backend et appelle niveau_seine pour lui répondre. Ne donne aucun chiffre sans outil.' });
        send({ type: 'response.create' });
      }
    }, session.mode);
    try { await page.waitForFunction(() => window.toolResults.length > 0, { timeout: 25000 }); }
    catch { console.log('No tool completed within the bounded test window.'); }
    const result = await page.evaluate(() => ({ tools: window.toolResults, events: window.voiceEvents }));
    console.log('TOOL ROUND TRIPS:', JSON.stringify(result.tools));
    console.log('VOICE EVENTS:', JSON.stringify(result.events.map(event => event.type === 'error' ? event : { type: event.type, nestedType: event.event?.type })));
    await page.getByRole('button', { name: 'Arrêter la voix', exact: true }).click();
    await page.waitForTimeout(session.mode === 'live' ? 4200 : 100);
    result.events = await page.evaluate(() => window.voiceEvents);
    await writeFile(`${homedir()}/zouave-notes/voice-events-${session.mode}.json`, JSON.stringify(result, null, 2));
    if (!result.tools.length) process.exitCode = 1;
  }
} finally { await browser.close(); }
