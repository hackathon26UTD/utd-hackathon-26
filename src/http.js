// Small HTTP helpers shared by every route.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Missing or invalid credentials') => new HttpError(401, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export function corsHeaders(env, request) {
  const allowed = (env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin');
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Device-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, replacer), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// Serialize Mongo ObjectIds as plain strings and rename _id -> id.
function replacer(key, value) {
  if (value && typeof value === 'object' && value._bsontype === 'ObjectId') return value.toHexString();
  if (value && typeof value === 'object' && !Array.isArray(value) && '_id' in value) {
    const { _id, ...rest } = value;
    return { id: _id, ...rest };
  }
  return value;
}

const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large (256 KB max)');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large (256 KB max)');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Body must be valid JSON');
  }
}

export function intParam(url, name, { def, min, max }) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw badRequest(`${name} must be an integer`);
  return Math.min(Math.max(n, min), max);
}

export function dateParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return undefined;
  const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} must be an ISO date or epoch ms`);
  return d;
}
