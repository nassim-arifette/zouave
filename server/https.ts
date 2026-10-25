// Optional HTTPS listener (ZOUAVE_HTTPS=1) for phones that open Zouave from the QR code: browsers only expose the
// microphone in a secure context. A self-signed certificate for this machine's LAN addresses is generated once and
// cached in .cache/https/ (visitors accept the browser warning once).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generate } from 'selfsigned';

export const httpsEnabled = () => /^(1|on|true)$/i.test(process.env.ZOUAVE_HTTPS ?? '');
export const httpsPort = () => Number(process.env.HTTPS_PORT ?? 3443);
export const lanAddresses = () => Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')).map(item => item!.address);

export async function lanCertificate(ips = lanAddresses(), dir = fileURLToPath(new URL('../.cache/https/', import.meta.url))) {
  const names = ['localhost', '127.0.0.1', ...ips].join(',');
  try {
    const cached = JSON.parse(await readFile(`${dir}cert.json`, 'utf8')) as { names: string; key: string; cert: string; expires: string };
    if (cached.names === names && new Date(cached.expires).getTime() > Date.now() + 86_400_000) return cached;
  } catch { /* first run, or addresses changed */ }
  const notAfterDate = new Date(Date.now() + 180 * 86_400_000);
  const pems = await generate([{ name: 'commonName', value: 'Zouave (local demo)' }], {
    keyType: 'ec', algorithm: 'sha256', notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map(ip => ({ type: 7 as const, ip }))] },
    ],
  });
  const value = { names, key: pems.private, cert: pems.cert, expires: notAfterDate.toISOString() };
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}cert.json`, JSON.stringify(value));
  return value;
}
