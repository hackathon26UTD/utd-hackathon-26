import { sha256Hex } from './auth.js';
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCharacters(length) {
  let out = '';
  const limit = Math.floor(256 / PAIRING_ALPHABET.length) * PAIRING_ALPHABET.length;
  while (out.length < length) for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
    if (byte < limit && out.length < length) out += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  }
  return out;
}
export function inventorySerial() {
  const body = randomCharacters(7);
  const sum = [...body].reduce((n, c, i) => n + PAIRING_ALPHABET.indexOf(c) * (i + 1), 0);
  const s = body + PAIRING_ALPHABET[sum % PAIRING_ALPHABET.length];
  return `HB-${s.slice(0,4)}-${s.slice(4)}`;
}
export async function pairingDigest(pairing, code, env = {}) {
  if (pairing.version !== 2) return sha256Hex(`${pairing.salt}:${pairing.serial}:${code}`);
  if (!env.SESSION_SECRET) throw new Error('Pairing secret unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`pairing-v2:${pairing.salt}:${pairing.serial}:${code}`));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
}
