import { unauthorized, HttpError } from './http.js';

// Constant-time-ish string compare to avoid leaking key length/prefix timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSecret(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return prefix + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isAdmin(request, env) {
  if (!env.API_ADMIN_KEY) return false;
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(token, env.API_ADMIN_KEY);
}

export function requireAdmin(request, env) {
  if (!env.API_ADMIN_KEY) throw new HttpError(503, 'API_ADMIN_KEY is not configured on the server');
  if (!isAdmin(request, env)) throw unauthorized('Admin key required: Authorization: Bearer <API_ADMIN_KEY>');
}

// Reads are open when API_PUBLIC_READ=true so a browser dashboard can poll without a secret.
export function requireRead(request, env) {
  if (env.API_PUBLIC_READ === 'true') return;
  requireAdmin(request, env);
}

// Devices authenticate with X-Device-Key; only the SHA-256 hash is stored.
export async function requireDevice(request, db) {
  const key = request.headers.get('X-Device-Key');
  if (!key) throw unauthorized('Device key required: X-Device-Key header');
  const device = await db.collection('devices').findOne({ keyHash: await sha256Hex(key) });
  if (!device || device.disabled) throw unauthorized('Unknown or disabled device key');
  return device;
}
