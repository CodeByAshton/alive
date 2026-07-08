// Secrets at rest: OAuth tokens (and anything else credential-shaped) are
// AES-256-GCM encrypted before being written into vault records, so synced
// clients and the database only ever see ciphertext — only this server can
// use them. The key comes from VAULT_SECRET_KEY (set it on real deployments:
// stateless containers lose an auto-generated key file and with it every
// connector authorization) or is generated once into server/data/secret.key.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, 'data', 'secret.key');

let key = null;

function loadKey() {
  if (key) return key;
  const fromEnv = process.env.VAULT_SECRET_KEY;
  if (fromEnv) {
    // Accept a 64-char hex key or any passphrase (hashed to 32 bytes).
    key = /^[0-9a-f]{64}$/i.test(fromEnv)
      ? Buffer.from(fromEnv, 'hex')
      : crypto.createHash('sha256').update(fromEnv).digest();
    return key;
  }
  try {
    key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    if (key.length === 32) return key;
  } catch {
    /* no key yet */
  }
  key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob) {
  const [tag1, tag2, ivB64, authB64, dataB64] = String(blob).split(':');
  if (tag1 !== 'enc' || tag2 !== 'v1') throw new Error('not an encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}
