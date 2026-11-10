// Resend transport. Pure fetch, no SDK, no secrets in logs. Failure never throws to callers of sendEmail:
// it returns {ok:false, reason}. Config names: RESEND_API_KEY (secret), EMAIL_FROM, EMAIL_REPLY_TO,
// EMAIL_OPERATOR_TO, EMAIL_ENABLED, EMAIL_TEST_ALLOWLIST, APP_ORIGIN.
import { sha256Hex } from './auth.js';
import { clean } from './email-templates/layout.js';

export const RESEND_URL = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'Safe Home <noreply@safehomemesh.us>';
export const SINK_ADDRESSES = ['delivered@resend.dev', 'bounced@resend.dev', 'complained@resend.dev'];
export const MAX_ATTEMPTS = 3;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export const isEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(value.trim());
/** Resend sink addresses, including the `delivered+label@resend.dev` form. */
export const isSink = (value) => typeof value === 'string' && /^(delivered|bounced|complained)(\+[a-z0-9._-]{1,40})?@resend\.dev$/i.test(value.trim());

/** Reads configuration from env. `enabled` is false unless a key exists and EMAIL_ENABLED is not "false". */
export function emailConfig(env = {}) {
  const flag = String(env.EMAIL_ENABLED ?? '').toLowerCase();
  const key = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  const enabled = Boolean(key) && !['false', '0', 'off', 'no'].includes(flag);
  const list = (v) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(isEmail);
  return {
    enabled, hasKey: Boolean(key), from: String(env.EMAIL_FROM || DEFAULT_FROM).trim(),
    replyTo: isEmail(env.EMAIL_REPLY_TO) ? env.EMAIL_REPLY_TO.trim() : null,
    operatorTo: list(env.EMAIL_OPERATOR_TO), testAllowlist: list(env.EMAIL_TEST_ALLOWLIST),
    origin: /^https:\/\//.test(env.APP_ORIGIN || '') ? new URL(env.APP_ORIGIN).origin : undefined,
  };
}

/** Subject safety: one line, no control or bidi characters, bounded. */
export const safeSubject = (s) => clean(s, 120).replace(/[<>]/g, '') || 'HomeBeacon notice';

export async function hashRecipient(address, env = {}) {
  return (await sha256Hex(`email:${String(address).trim().toLowerCase()}:${env.SESSION_SECRET || ''}`)).slice(0, 16);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryDelay = (res, attempt) => {
  const header = Number(res?.headers?.get?.('retry-after'));
  const base = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 5000) : 300 * 2 ** attempt;
  return Math.min(base, 5000);
};

/**
 * Sends one message. `message` = {to, subject, html, text, idempotencyKey, tags}.
 * Returns {ok, id, status, attempts, reason}. Logs one structured line with no body and no address.
 * `deps` = {fetcher, sleep, log} for tests.
 */
export async function sendEmail(env, message, deps = {}) {
  const cfg = emailConfig(env);
  const fetcher = deps.fetcher || fetch, sleep = deps.sleep || defaultSleep, log = deps.log || ((o) => console.log(JSON.stringify(o)));
  const to = String(message.to || '').trim();
  const rid = isEmail(to) ? await hashRecipient(to, env) : 'invalid';
  const done = (r) => { log({ event: 'email.send', template: message.template || null, recipient: rid, ok: r.ok, status: r.status ?? null, attempts: r.attempts ?? 0, reason: r.reason || null, id: r.id || null }); return r; };
  if (!cfg.enabled && !deps.force) return done({ ok: false, skipped: true, reason: cfg.hasKey ? 'disabled' : 'no_key' });
  if (!isEmail(to)) return done({ ok: false, skipped: true, reason: 'invalid_recipient' });
  const payload = { from: cfg.from, to: [to], subject: safeSubject(message.subject), html: message.html, text: message.text, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}), ...(Array.isArray(message.tags) ? { tags: message.tags.slice(0, 5) } : {}) };
  const headers = { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'homebeacon-email/1', ...(message.idempotencyKey ? { 'Idempotency-Key': String(message.idempotencyKey).slice(0, 256) } : {}) };
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetcher(RESEND_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout?.(8000) });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        return done({ ok: true, id: typeof body.id === 'string' ? body.id : null, status: res.status, attempts: attempt + 1 });
      }
      last = { ok: false, status: res.status, attempts: attempt + 1, reason: RETRY_STATUS.has(res.status) ? 'provider_busy' : 'rejected' };
      if (!RETRY_STATUS.has(res.status)) return done(last);
      if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelay(res, attempt));
    } catch {
      last = { ok: false, status: null, attempts: attempt + 1, reason: 'network' };
      if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelay(null, attempt));
    }
  }
  return done(last);
}
