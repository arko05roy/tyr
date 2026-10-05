import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM for backend-held keys. TYR_SECRETS_KEY = 32 random bytes, hex. */
function key(): Buffer {
  const k = process.env.TYR_SECRETS_KEY;
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) throw new Error('TYR_SECRETS_KEY must be 64 hex chars');
  return Buffer.from(k, 'hex');
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

export function open(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  if (!iv || !tag || !body) throw new Error('malformed sealed secret');
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}
