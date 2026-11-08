// Email events: who gets what, when. Dedupe and throttle live in the email_events collection (TTL 30 days).
// Every entry point is safe to call from a request: it never throws and never blocks the response when
// fired through fire(ctx, ...). Email is off unless RESEND_API_KEY is set, and then costs nothing.
import { withDb } from './db.js';
import { emailConfig, hashRecipient, isEmail, sendEmail } from './email.js';
import { renderEmail, HELP_EMAIL_STATUSES } from './email-templates/index.js';

export const EVENT_TTL_S = 30 * 86400;
export const MAX_PER_HOUR = { customer: 4, operator: 12 };
const HOUR = 3600_000;

const indexed = new Set();
export async function ensureEmailIndexes(db) {
  const name = db.databaseName || 'db';
  if (indexed.has(name)) return;
  await Promise.all([
    db.collection('email_events').createIndex({ createdAt: 1 }, { expireAfterSeconds: EVENT_TTL_S }),
    db.collection('email_events').createIndex({ recipient: 1, createdAt: -1 }),
  ]);
  indexed.add(name);
}

/**
 * Runs `work(db)` in the background after the response. Skips everything (no connection opened)
 * when email is not configured. Errors are swallowed and counted in the log only.
 */
export function fire(ctx, work) {
  const env = ctx?.env || {};
  if (!emailConfig(env).enabled) return Promise.resolve({ skipped: true, reason: 'disabled' });
  const job = (async () => {
    try { return await withDb(env, ctx.db, async (db) => { await ensureEmailIndexes(db); return work(db, env); }); }
    catch (e) { console.error('email event failed', e?.name); return { ok: false, reason: 'error' }; }
  })();
  try { ctx?.waitUntil?.(job); } catch { /* no waitUntil in this runtime */ }
  return job;
}

/**
 * Core delivery: consent, dedupe, throttle, render, send, record.
 * spec = {event, template, data, to, audience, deviceId, token, windowMs, requireConsent, consent}
 */
export async function deliver(db, env, spec, deps = {}) {
  try {
    const cfg = emailConfig(env);
    if (!cfg.enabled) return { ok: false, skipped: true, reason: 'disabled' };
    const to = String(spec.to || '').trim().toLowerCase();
    if (!isEmail(to)) return { ok: false, skipped: true, reason: 'invalid_recipient' };
    if (spec.requireConsent && spec.consent !== true) return { ok: false, skipped: true, reason: 'no_consent' };
    const now = deps.now || new Date();
    const recipient = await hashRecipient(to, env);
    const windowMs = spec.windowMs ?? HOUR;
    const bucket = Math.floor(now.getTime() / windowMs);
    const id = [spec.event, spec.deviceId || '-', recipient, spec.token || '-', bucket].join(':');
    const limit = MAX_PER_HOUR[spec.audience === 'operator' ? 'operator' : 'customer'];
    const recent = await db.collection('email_events').countDocuments({ recipient, status: { $in: ['pending', 'sent'] }, createdAt: { $gte: new Date(now.getTime() - HOUR) } });
    if (recent >= limit) return { ok: false, skipped: true, reason: 'throttled' };
    try {
      await db.collection('email_events').insertOne({ _id: id, event: spec.event, template: spec.template, deviceId: spec.deviceId || null, recipient, status: 'pending', createdAt: now, exercise: spec.data?.exercise === true });
    } catch (e) {
      if (e?.code === 11000) return { ok: false, skipped: true, reason: 'duplicate' };
      throw e;
    }
    const mail = renderEmail(spec.template, { ...spec.data, now: spec.data?.now || now.toISOString() }, { origin: cfg.origin });
    const result = await sendEmail(env, { to, subject: mail.subject, html: mail.html, text: mail.text, template: spec.template, idempotencyKey: id, tags: [{ name: 'template', value: spec.template.replace(/[^a-z0-9_-]/gi, '_') }] }, deps);
    await db.collection('email_events').updateOne({ _id: id }, { $set: { status: result.ok ? 'sent' : 'failed', providerId: result.id || null, httpStatus: result.status ?? null, reason: result.reason || null, finishedAt: new Date() } });
    return result;
  } catch (e) {
    console.error('email deliver failed', e?.name);
    return { ok: false, reason: 'error' };
  }
}

const activeLink = (db, deviceId) => db.collection('customer_links').findOne({ deviceId: String(deviceId), active: true });

/** Customer account created or a device claimed. Transactional: sent even if the contact consent is off. */
export async function notifyWelcome(db, env, { email, contactName, nickname, linked = true, consent, linkId, linkedAt = new Date(), exercise = false }, deps) {
  return deliver(db, env, { event: 'welcome', template: 'welcome', audience: 'customer', to: email, token: linkId || 'account', windowMs: 24 * HOUR, data: { contactName, nickname, linked, consent: consent === true, linkedAt, exercise } }, deps);
}

/** Help status changed. Needs the customer's contact consent. `none` sends nothing. */
export async function notifyHelpStatus(db, env, { deviceId, status, updatedAt = new Date() }, deps) {
  if (!HELP_EMAIL_STATUSES.includes(status)) return { ok: false, skipped: true, reason: 'status_not_emailed' };
  const link = await activeLink(db, deviceId);
  if (!link) return { ok: false, skipped: true, reason: 'no_customer' };
  return deliver(db, env, { event: 'help-status', template: 'help-status', audience: 'customer', to: link.customerEmail, deviceId, token: status, windowMs: HOUR, requireConsent: true, consent: link.consent, data: { status, nickname: link.nickname, updatedAt, exercise: link.exercise === true } }, deps);
}

/** A customer-visible device message was confirmed on the device. Needs consent. */
export async function notifyMessageReceipt(db, env, { deviceId, messageId, title, state, at = new Date() }, deps) {
  const link = await activeLink(db, deviceId);
  if (!link) return { ok: false, skipped: true, reason: 'no_customer' };
  return deliver(db, env, { event: 'receipt', template: 'receipt', audience: 'customer', to: link.customerEmail, deviceId, token: `${messageId}:${state}`, windowMs: 24 * HOUR, requireConsent: true, consent: link.consent, data: { deviceName: link.nickname, title, state, at, exercise: link.exercise === true } }, deps);
}

/** Critical incident to the configured operator addresses. Exercise events are tagged, never hidden. */
export async function notifyCriticalIncident(db, env, incident, deps) {
  const cfg = emailConfig(env);
  const out = [];
  for (const to of cfg.operatorTo) out.push(await deliver(db, env, { event: 'critical-incident', template: 'critical-incident', audience: 'operator', to, deviceId: incident.deviceId, token: incident.stale ? 'stale' : 'live', windowMs: 30 * 60_000, data: incident }, deps));
  return out;
}

export async function notifyDigest(db, env, digest, deps) {
  const cfg = emailConfig(env);
  const out = [];
  for (const to of cfg.operatorTo) out.push(await deliver(db, env, { event: 'digest', template: 'digest', audience: 'operator', to, token: digest.periodLabel || 'latest', windowMs: HOUR, data: digest }, deps));
  return out;
}

/** Password changed, recovery code used or sign-in notice. Carries no code, no link that signs in. */
export async function notifyAccountNotice(db, env, { email, kind, role = 'customer', at = new Date() }, deps) {
  return deliver(db, env, { event: 'account-notice', template: 'account-notice', audience: 'customer', to: email, token: kind, windowMs: 10 * 60_000, data: { kind, role, at } }, deps);
}
