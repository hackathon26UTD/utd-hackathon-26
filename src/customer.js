// Customer role: pairing, registration, claiming, and the customer-facing device view.
// Credentials stay separate: customer cookie (src/operator-session.js), device keys, operator sessions.
// Advisory only. Missing or stale data is shown as "no recent signal", never as safe.
import { ObjectId } from 'mongodb';
import { matchCustomerAddress } from './customer-location.js';
import { withDatabase } from '../lib/mongodb.js';
import { HttpError, badRequest, notFound } from './http.js';
import { sha256Hex, isAdmin } from './auth.js';
import { passwordHash, equal, sameOrigin, issueCustomerSession, readCustomerSession, customerCookie } from './operator-session.js';

export const FAIL_TEXT = 'Those details do not match an available device.';
export const LOGIN_FAIL_TEXT = 'Email or password is incorrect.';
export const PAIRING_DAYS = 30;
export const MAX_CODE_FAILURES = 10;
export const SILENT_MS = 15 * 60 * 1000;
export const HELP_STATUSES = ['none', 'review_queued', 'follow_up_assigned', 'help_on_the_way', 'resolved'];
export const HELP_TEXT = {
  none: 'No follow-up has been set up for this device.',
  review_queued: 'Your device is in the review queue. A person will look at it.',
  follow_up_assigned: 'A team member has been assigned to follow up.',
  help_on_the_way: 'Help is on the way.',
  resolved: 'The team marked this as resolved.',
};
const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CLIENT_STATUS = ['normal', 'needs_attention', 'urgent', 'no_recent_signal'];
const LADDER_TO_CLIENT = { normal: 'normal', watch: 'needs_attention', elevated: 'needs_attention', critical: 'urgent', unknown: 'no_recent_signal' };

const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const newId = () => hex(crypto.getRandomValues(new Uint8Array(12)));
const randomIndex = max => { const limit = Math.floor(0x100000000 / max) * max; let n; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= limit); return n % max; };

// ---------- input helpers ----------
export function normalizeSerial(value) {
  if (typeof value !== 'string') return null;
  const s = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^HB([A-Z0-9]{8})$/.exec(s);
  if (!m || [...m[1]].some(c => !SERIAL_ALPHABET.includes(c))) return null;
  return `HB-${m[1].slice(0, 4)}-${m[1].slice(4)}`;
}
export function normalizeCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).replace(/\s/g, '');
  return /^\d{6}$/.test(s) ? s : null;
}
export const makeSerial = () => 'HB-' + Array.from({ length: 8 }, () => SERIAL_ALPHABET[randomIndex(SERIAL_ALPHABET.length)]).join('').replace(/^(.{4})/, '$1-');
export const makeCode = () => String(randomIndex(1000000)).padStart(6, '0');
const plain = (value, max, { min = 0 } = {}) => {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
};
const looksSecret = s => /dk_|ak_|[0-9a-f]{32,}|password|secret|token/i.test(s);
const emailOf = value => {
  if (typeof value !== 'string') return null;
  const e = value.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
};
async function readBody(request, max = 4096) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'Request is too large.');
  if (!text) return {};
  try { const body = JSON.parse(text); return body && typeof body === 'object' && !Array.isArray(body) ? body : {}; } catch { throw badRequest('Request must be valid JSON.'); }
}
const hashPairing = (salt, serial, code) => sha256Hex(`${salt}:${serial}:${code}`);

// ---------- indexes and shared writers ----------
const indexed = new WeakSet();
export async function ensureCustomerIndexes(db) {
  if (indexed.has(db)) return;
  await Promise.all([
    db.collection('device_pairing').createIndex({ serial: 1 }, { unique: true }),
    db.collection('customer_links').createIndex({ customerEmail: 1, active: 1 }),
    db.collection('customer_links').createIndex({ deviceId: 1 }, { unique: true, partialFilterExpression: { active: true } }),
  ]);
  indexed.add(db);
}

// Optional neighbours. Missing modules degrade to safe fallbacks (no status, no messages).
const optional = {};
const tryImport = (key, load) => (optional[key] ||= load().catch(() => null));
const loadRiskMod = () => tryImport('risk', () => import('./risk/load.js'));
const customerViewMod = () => tryImport('view', () => import('./risk/customer.js'));
const liveMod = () => tryImport('live', () => import('./live.js'));
const messagesMod = () => tryImport('messages', () => import('./messages.js'));

async function depsFor(ctx) {
  const d = ctx.deps || {};
  return {
    fetcher: d.fetcher || ctx.fetcher,
    loadRisk: d.loadRisk || (await loadRiskMod())?.loadRisk,
    customerView: d.customerView || (await customerViewMod())?.customerView,
    customerMessages: d.customerMessages || (await messagesMod())?.customerMessages,
    markCustomerSeen: Object.hasOwn(d,'markCustomerSeen') ? d.markCustomerSeen : (await messagesMod())?.markCustomerSeen,
    writeAudit: d.writeAudit || (await liveMod())?.writeAudit,
  };
}
async function audit(deps, db, entry) {
  const doc = { at: new Date(), ...entry, details: entry.details || {} };
  try { if (deps.writeAudit) return await deps.writeAudit(db, doc); } catch { /* fall through to direct write */ }
  await db.collection('audit_log').insertOne(doc);
}
const customerActor = async email => ({ type: 'customer', id: (await sha256Hex('customer:' + email)).slice(0, 12) });

// ---------- rate limits ----------
async function rateKey(env, scope, value) { return scope + ':' + await sha256Hex(`${scope}:${value}:${env.SESSION_SECRET || ''}`); }
export async function takeAttempt(db, key, max, now = new Date(), windowMs = 900000) {
  const coll = db.collection('login_attempts');
  const since = new Date(now.getTime() - windowMs);
  await coll.deleteMany({ key, at: { $lt: since } });
  if (await coll.countDocuments({ key, at: { $gte: since } }) >= max) return false;
  await coll.insertOne({ key, at: now });
  return true;
}
const clientIp = request => request.headers.get('CF-Connecting-IP') || 'local';
const tooMany = () => reply({ error: 'Too many attempts. Try again in 15 minutes.' }, 429, { 'Retry-After': '900' });

// ---------- pairing (operator side) ----------
export async function createPairing(db, { deviceId, origin, actor, now = new Date() }) {
  await ensureCustomerIndexes(db);
  const _id = oid(deviceId);
  const device = await db.collection('devices').findOne({ _id });
  if (!device) throw notFound('Device not found.');
  const id = String(_id);
  if (await db.collection('customer_links').findOne({ deviceId: id, active: true })) throw new HttpError(409, 'This device is already linked to a customer. Unlink it first.');
  const existing = await db.collection('device_pairing').findOne({ _id: id });
  const code = makeCode();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = new Date(now.getTime() + PAIRING_DAYS * 86400000);
  const exercise = device.meta?.exercise === true;
  let serial = existing?.serial;
  for (let tries = 0; tries < 8; tries++) {
    const candidate = serial || makeSerial();
    const doc = { serial: candidate, salt, codeHash: await hashPairing(salt, candidate, code), claimed: false, failures: 0, createdAt: now, expiresAt, exercise };
    try {
      await db.collection('device_pairing').updateOne({ _id: id }, { $set: doc }, { upsert: true });
      serial = candidate;
      break;
    } catch (e) {
      if (e?.code !== 11000 || existing) throw e;
      serial = undefined; // serial collision with another device, draw again
    }
  }
  if (!serial) throw new HttpError(503, 'Could not create a pairing serial. Try again.');
  await audit(actor.deps, db, { actor: actor.actor, action: 'pairing.issue', deviceId: id, details: { serial }, exercise });
  return { serial, pairingCode: code, qrPayload: `${origin}/customer#claim=${serial}.${code}`, expiresAt: expiresAt.toISOString(), exercise };
}

function oid(id) {
  if (typeof id !== 'string' || id.length !== 24 || !ObjectId.isValid(id)) throw badRequest('Invalid device id.');
  return new ObjectId(id);
}

// ---------- claiming ----------
class ClaimFailed extends Error {}
// Verifies serial plus code, then links the device. Every failure looks the same to the caller.
export async function claimDevice(db, { email, serial, code, contactName, consent, nickname, address, now = new Date() }, deps = {}) {
  await ensureCustomerIndexes(db);
  const s = normalizeSerial(serial), c = normalizeCode(code);
  if (!s || !c) throw new ClaimFailed();
  const pairing = await db.collection('device_pairing').findOne({ serial: s });
  if (!pairing || pairing.claimed || !pairing.codeHash || (pairing.failures || 0) >= MAX_CODE_FAILURES || new Date(pairing.expiresAt) <= now) throw new ClaimFailed();
  if (!equal(await hashPairing(pairing.salt, s, c), pairing.codeHash)) {
    await db.collection('device_pairing').updateOne({ _id: pairing._id }, { $inc: { failures: 1 } });
    throw new ClaimFailed();
  }
  const matched = address === undefined ? null : await matchCustomerAddress(address, deps.fetcher);
  const link = { _id: newId(), deviceId: pairing._id, customerEmail: email, contactName, nickname: nickname || 'My HomeBeacon', consent, consentAt: consent ? now : null, linkedAt: now, active: true, exercise: pairing.exercise === true };
  const actor = await customerActor(email);
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const options = { session };
      const device = await db.collection('devices').findOne({ _id: new ObjectId(pairing._id) }, options);
      if (!device || device.disabled) throw new ClaimFailed();
      const won = await db.collection('device_pairing').updateOne(
        { _id: pairing._id, claimed: false, codeHash: pairing.codeHash, expiresAt: { $gt: now } },
        { $set: { claimed: true, claimedAt: now }, $unset: { codeHash: '', salt: '' } }, options);
      if (!won.modifiedCount) throw new ClaimFailed();
      if (matched) {
        let homeId = device.homeId;
        if (homeId) {
          // An ingest home is a stable history identity. Never silently rebind it.
          const home = await db.collection('homes').findOne({ _id: homeId }, options);
          const old = home?.location?.coordinates, next = matched.location.coordinates;
          const distance = old?.length === 2 ? Math.hypot((old[0]-next[0])*Math.cos(next[1]*Math.PI/180),old[1]-next[1])*111320 : Infinity;
          if (distance > 250) throw new HttpError(409, 'This device already has a different registered location. Contact your installer.');
        } else {
          const home = await db.collection('homes').insertOne({ label: matched.address.slice(0,80), ...matched, createdAt: now, updatedAt: now }, options);
          homeId = home.insertedId;
        }
        await db.collection('devices').updateOne({ _id: device._id }, { $set: { homeId, 'meta.address': matched.address, 'meta.locationSource': matched.locationSource, updatedAt: now } }, options);
      }
      await db.collection('customer_links').insertOne(link, options);
      await db.collection('audit_log').insertOne({ at: now, actor, action: 'customer.claim', deviceId: pairing._id, details: { consent }, exercise: link.exercise }, options);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 4000 });
  } catch (e) {
    if (e?.code === 11000) throw new ClaimFailed();
    throw e;
  } finally { await session.endSession(); }
  return link;
}

export async function unlinkDevice(db, { email, linkId, now = new Date() }, deps = {}) {
  const link = await db.collection('customer_links').findOneAndUpdate(
    { _id: String(linkId), customerEmail: email, active: true },
    { $set: { active: false, unlinkedAt: now, consent: false }, $unset: { contactName: '', nickname: '' } },
    { returnDocument: 'before' });
  const doc = link?.value !== undefined ? link.value : link; // driver versions differ
  if (!doc) throw notFound('Device not found.');
  await audit(deps, db, { actor: await customerActor(email), action: 'customer.unlink', deviceId: doc.deviceId, details: {}, exercise: doc.exercise === true });
  return true;
}

// ---------- customer view ----------
const agoText = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : m < 90 ? '1 hour' : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`; };

// Maps risk output to what a customer may see. Unknown, offline or silent never renders as normal.
export function customerStatus({ assessment, view, lastSeen, now }) {
  let status = CLIENT_STATUS.includes(view?.status) ? view.status : LADDER_TO_CLIENT[assessment?.status] || 'no_recent_signal';
  let statusText = typeof view?.statusText === 'string' ? view.statusText : '';
  const silentMs = lastSeen ? now.getTime() - new Date(lastSeen).getTime() : Infinity;
  if (status === 'normal' && (!assessment || assessment.status === 'unknown' || assessment.offline || silentMs > SILENT_MS)) {
    status = 'no_recent_signal';
    statusText = '';
  }
  if (!statusText) {
    statusText = status === 'no_recent_signal'
      ? (lastSeen ? `We have not heard from this device for ${agoText(silentMs)}. That does not mean it is safe.` : 'We have not heard from this device yet.')
      : status === 'urgent' ? 'This device reported a serious condition. A person should review it.'
      : status === 'needs_attention' ? 'This device reported a condition worth checking.'
      : 'This device is reporting normally.';
  }
  const conditions = (Array.isArray(view?.conditions) ? view.conditions : []).slice(0, 12)
    .map(c => ({ label: String(c?.label ?? '').slice(0, 60), text: String(c?.text ?? '').slice(0, 240) })).filter(c => c.text);
  return { status, statusText: statusText.slice(0, 300), conditions };
}

export async function listCustomerDevices(db, { email, now = new Date(), env = {} }, deps = {}) {
  const links = await db.collection('customer_links').find({ customerEmail: email, active: true }).sort({ linkedAt: 1 }).limit(20).toArray();
  if (!links.length) return [];
  const ids = links.map(l => l.deviceId);
  const objectIds = ids.filter(i => ObjectId.isValid(i) && i.length === 24).map(i => new ObjectId(i));
  const devices = await db.collection('devices').find({ _id: { $in: objectIds } }, { projection: { lastSeen: 1 } }).toArray();
  const lastSeenOf = new Map(devices.map(d => [String(d._id), d.lastSeen]));
  const helpDocs = await db.collection('device_help').find({ _id: { $in: ids } }).toArray();
  const helpOf = new Map(helpDocs.map(h => [h._id, h]));
  const assessments = new Map();
  if (deps.loadRisk) {
    for (const exercise of [false, true]) {
      const group = links.filter(l => (l.exercise === true) === exercise).map(l => l.deviceId);
      if (!group.length) continue;
      try {
        const result = await deps.loadRisk(db, { deviceIds: group, exercise, now, env });
        for (const a of Array.isArray(result) ? result : result?.assessments || []) assessments.set(String(a.deviceId), a);
      } catch { /* risk unavailable: devices show as no recent signal */ }
    }
  }
  const out = [];
  for (const link of links) {
    const assessment = assessments.get(link.deviceId);
    let view = null;
    try { view = assessment && deps.customerView ? deps.customerView(assessment) : null; } catch { view = null; }
    const lastSeen = lastSeenOf.get(link.deviceId) || null;
    const base = customerStatus({ assessment, view, lastSeen, now });
    let messages = [];
    try { messages = deps.customerMessages ? await deps.customerMessages(db, link.deviceId, now) : []; } catch { messages = []; }
    const help = helpOf.get(link.deviceId);
    out.push({
      id: link._id, nickname: link.nickname || 'My HomeBeacon', exercise: link.exercise === true,
      ...base, lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
      messages: (messages || []).slice(0, 5).map(m => ({ id: String(m.id), title: String(m.title ?? '').slice(0, 20), body: String(m.body ?? '').slice(0, 80), severity: m.severity, expiresAt: m.expiresAt })),
      help: { status: help?.status || 'none', text: HELP_TEXT[help?.status || 'none'], note: help?.note || '', updatedAt: help?.updatedAt ? new Date(help.updatedAt).toISOString() : null },
    });
  }
  return out;
}

// ---------- route handlers ----------
const run = (ctx, fn) => ctx.db ? fn(ctx.db) : withDatabase(ctx.env, fn);
const originOk = request => sameOrigin(request) || false;
const originError = () => reply({ error: 'This request must come from HomeBeacon.' }, 403);

async function signedIn(ctx, db) {
  const session = await readCustomerSession(ctx.request, ctx.env, db);
  return session?.email || null;
}
const unauth = () => reply({ error: 'Sign in to see your devices.' }, 401);

async function dummyHash(password) { return passwordHash(password, 'invalid-customer'); }

const routes = {
  async register(ctx) {
    if (ctx.request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (!originOk(ctx.request)) return originError();
    if (!ctx.env.SESSION_SECRET) return reply({ error: 'Customer sign-in is not configured yet.' }, 503);
    const body = await readBody(ctx.request);
    const email = emailOf(body.email), contactName = plain(body.contactName, 60, { min: 1 });
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email) return reply({ error: 'Enter a valid email address.' }, 400);
    if (password.length < 10 || password.length > 512) return reply({ error: 'Use a password of at least 10 characters.' }, 400);
    if (!contactName) return reply({ error: 'Enter a contact name of up to 60 characters.' }, 400);
    if (typeof body.consent !== 'boolean') return reply({ error: 'Choose whether the response team may contact you.' }, 400);
    if (body.acceptTerms !== true) return reply({ error: 'Please agree to the prototype terms before creating your account.' }, 400);
    const nickname = body.nickname === undefined ? null : plain(body.nickname, 40, { min: 1 });
    if (body.nickname !== undefined && !nickname) return reply({ error: 'Use a device name of up to 40 characters.' }, 400);
    return run(ctx, async db => {
      await ensureCustomerIndexes(db);
      const now = new Date(), serial = normalizeSerial(body.serial);
      if (!await takeAttempt(db, await rateKey(ctx.env, 'cust-ip', clientIp(ctx.request)), 8, now)) return tooMany();
      if (serial && !await takeAttempt(db, await rateKey(ctx.env, 'cust-serial', serial), 5, now)) return tooMany();
      const deps = await depsFor(ctx);
      const accounts = db.collection('customer_accounts');
      const existing = await accounts.findOne({ _id: email });
      // Hash on every path so timing does not reveal whether the email is registered.
      const salt = existing?.salt || crypto.randomUUID();
      const hash = await passwordHash(password, salt);
      if (existing && !equal(hash, existing.hash)) { await dummyPairingCheck(db, serial, body.code); return reply({ error: FAIL_TEXT }, 400); }
      const wantsDevice = body.serial !== undefined || body.code !== undefined;
      if (!wantsDevice) {
        if (existing) return reply({ error: 'Use sign in for an existing account.' }, 400);
        try { await accounts.insertOne({ _id: email, hash, salt, contactName, createdAt: now, termsVersion: '2026-11-07', termsAcceptedAt: now }); }
        catch { return reply({ error: FAIL_TEXT }, 400); }
        await audit(deps, db, {actor:await customerActor(email),action:'customer.register',details:{newAccount:true,acceptedTerms:true,termsVersion:'2026-11-07'}});
        const token = await issueCustomerSession(ctx.env, email);
        return reply({ authenticated: true, linked: false }, 201, { 'Set-Cookie': customerCookie(token) });
      }
      let link;
      try { link = await claimDevice(db, { email, serial, code: body.code, contactName, consent: body.consent, nickname }, deps); }
      catch (e) { if (e instanceof ClaimFailed) return reply({ error: FAIL_TEXT }, 400); throw e; }
      if (!existing) {
        try { await accounts.insertOne({ _id: email, hash, salt, createdAt: now, termsVersion: '2026-11-07', termsAcceptedAt: now }); }
        catch { await unlinkQuiet(db, link); return reply({ error: FAIL_TEXT }, 400); }
      }
      await audit(deps, db, { actor: await customerActor(email), action: 'customer.register', deviceId: link.deviceId, details: { newAccount: !existing, termsVersion: '2026-11-07', acceptedTerms: true }, exercise: link.exercise });
      const token = await issueCustomerSession(ctx.env, email);
      return reply({ authenticated: true, linked: true, id: link._id }, 201, { 'Set-Cookie': customerCookie(token) });
    });
  },

  async login(ctx) {
    if (ctx.request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (!originOk(ctx.request)) return originError();
    if (!ctx.env.SESSION_SECRET) return reply({ error: 'Customer sign-in is not configured yet.' }, 503);
    const body = await readBody(ctx.request);
    const email = emailOf(body.email);
    if (!email || typeof body.password !== 'string' || body.password.length > 512) return reply({ error: 'Enter your email and password.' }, 400);
    return run(ctx, async db => {
      if (!await takeAttempt(db, await rateKey(ctx.env, 'cust-ip', clientIp(ctx.request)), 8)) return tooMany();
      const account = await db.collection('customer_accounts').findOne({ _id: email });
      const hash = await passwordHash(body.password, account?.salt || 'invalid-customer');
      if (!account || !equal(hash, account.hash)) return reply({ error: LOGIN_FAIL_TEXT }, 401);
      const token = await issueCustomerSession(ctx.env, email);
      return reply({ authenticated: true }, 200, { 'Set-Cookie': customerCookie(token) });
    });
  },

  async logout(ctx) {
    if (!['POST', 'DELETE'].includes(ctx.request.method)) return reply({ error: 'Method not allowed.' }, 405);
    if (!originOk(ctx.request)) return originError();
    return reply({ authenticated: false }, 200, { 'Set-Cookie': customerCookie('', 0) });
  },

  async me(ctx) {
    if (ctx.request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
    const session = await readCustomerSession(ctx.request, ctx.env, ctx.db);
    if (!session) return reply({ authenticated: false }, 401);
    return run(ctx, async db => { const account=await db.collection('customer_accounts').findOne({_id:session.email},{projection:{contactName:1}}); return reply({authenticated:true,email:session.email,role:'customer',contactName:account?.contactName || ''}); });
  },

  async claim(ctx) {
    if (ctx.request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (!originOk(ctx.request)) return originError();
    const body = await readBody(ctx.request);
    return run(ctx, async db => {
      const email = await signedIn(ctx, db);
      if (!email) return unauth();
      const contactName = plain(body.contactName, 60, { min: 1 });
      if (!contactName) return reply({ error: 'Enter a contact name of up to 60 characters.' }, 400);
      if (typeof body.consent !== 'boolean') return reply({ error: 'Choose whether the response team may contact you.' }, 400);
      const nickname = body.nickname === undefined ? null : plain(body.nickname, 40, { min: 1 });
      if (body.nickname !== undefined && !nickname) return reply({ error: 'Use a device name of up to 40 characters.' }, 400);
      const now = new Date();
      if (!await takeAttempt(db, await rateKey(ctx.env, 'cust-ip', clientIp(ctx.request)), 8, now)) return tooMany();
      const serial = normalizeSerial(body.serial);
      if (serial && !await takeAttempt(db, await rateKey(ctx.env, 'cust-serial', serial), 5, now)) return tooMany();
      try {
        const link = await claimDevice(db, { email, serial: body.serial, code: body.code, contactName, consent: body.consent, nickname, address: body.address }, await depsFor(ctx));
        return reply({ linked: true, id: link._id }, 201);
      } catch (e) { if (e instanceof ClaimFailed) return reply({ error: FAIL_TEXT }, 400); throw e; }
    });
  },

  async devices(ctx) {
    const method = ctx.request.method;
    if (!['GET', 'DELETE'].includes(method)) return reply({ error: 'Method not allowed.' }, 405);
    if (method === 'DELETE' && !originOk(ctx.request)) return originError();
    return run(ctx, async db => {
      const email = await signedIn(ctx, db);
      if (!email) return unauth();
      if (method === 'DELETE') {
        const id = new URL(ctx.request.url).searchParams.get('id');
        if (!id || !/^[0-9a-f]{24}$/.test(id)) return reply({ error: 'Device not found.' }, 404);
        await unlinkDevice(db, { email, linkId: id }, await depsFor(ctx));
        return reply({ unlinked: true });
      }
      const devices = await listCustomerDevices(db, { email, env: ctx.env }, await depsFor(ctx));
      return reply({ devices, serverTime: new Date().toISOString() });
    });
  },

  async messages(ctx) {
    if (ctx.request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (!originOk(ctx.request)) return originError();
    const body = await readBody(ctx.request);
    return run(ctx, async db => {
      const email = await signedIn(ctx, db);
      if (!email) return unauth();
      const id = new URL(ctx.request.url).searchParams.get('id');
      const link = id && /^[0-9a-f]{24}$/.test(id) ? await db.collection('customer_links').findOne({ _id: id, customerEmail: email, active: true }) : null;
      if (!link) return reply({ error: 'Device not found.' }, 404);
      const deps = await depsFor(ctx);
      const messageId = typeof body.messageId === 'string' ? body.messageId : '';
      const visible = deps.customerMessages ? await deps.customerMessages(db, link.deviceId, new Date()) : [];
      if (!messageId || !visible.some(m => String(m.id) === messageId)) return reply({ error: 'Message not found.' }, 404);
      if (!deps.markCustomerSeen) return reply({ error: 'Message confirmation is not available yet.' }, 503);
      await deps.markCustomerSeen(db, link.deviceId, messageId);
      return reply({ seen: true });
    });
  },
};

async function dummyPairingCheck(db, serial, code) { // keep the work similar on the wrong-password path
  const s = normalizeSerial(serial), c = normalizeCode(code);
  if (!s || !c) return;
  const p = await db.collection('device_pairing').findOne({ serial: s });
  if (p?.salt) await hashPairing(p.salt, s, c);
}
async function unlinkQuiet(db, link) {
  await db.collection('customer_links').updateOne({ _id: link._id }, { $set: { active: false }, $unset: { contactName: '', nickname: '' } });
  await db.collection('device_pairing').updateOne({ _id: link.deviceId }, { $set: { claimed: false } });
}

export async function customerHandler(name, ctx) {
  try { return await routes[name](ctx); }
  catch (e) {
    if (e instanceof HttpError) return reply({ error: e.message }, e.status);
    return reply({ error: 'This service is unavailable right now. Try again shortly.' }, 503);
  }
}

// ---------- operator endpoints ----------
const operatorGate = ctx => {
  if (!isAdmin(ctx.request, ctx.env)) return reply({ error: 'Sign in to view this data.' }, 401);
  if (ctx.data?.operator?.role === 'demo') return reply({ error: 'Demo accounts can view exercise data only.' }, 403);
  return null;
};
const actorOf = (ctx, deps) => ({ deps, actor: { type: 'operator', id: ctx.data?.operator?.email || 'admin-key' } });

export async function pairingHandler(ctx) {
  try {
    const denied = operatorGate(ctx); if (denied) return denied;
    const { request } = ctx, method = request.method, url = new URL(request.url);
    if (method !== 'GET' && !(ctx.data?.operator ? sameOrigin(request) : true)) return originError();
    return await run(ctx, async db => {
      const deps = await depsFor(ctx);
      if (method === 'POST') {
        const body = await readBody(request);
        const out = await createPairing(db, { deviceId: body.device_id, origin: url.origin, ...actorOf(ctx, deps) });
        return reply(out, 201);
      }
      const deviceId = url.searchParams.get('device_id');
      oid(deviceId);
      if (method === 'GET') {
        const pairing = await db.collection('device_pairing').findOne({ _id: deviceId }, { projection: { codeHash: 0, salt: 0 } });
        const link = await db.collection('customer_links').findOne({ deviceId, active: true });
        return reply({ issued: !!pairing, serial: pairing?.serial || null, claimed: pairing?.claimed === true, expiresAt: pairing?.expiresAt || null, linked: !!link, contactName: link?.contactName || null, consent: link ? link.consent === true : null });
      }
      if (method === 'DELETE') { // operator releases a device from its customer
        const link = await db.collection('customer_links').findOneAndUpdate({ deviceId, active: true }, { $set: { active: false, unlinkedAt: new Date(), consent: false }, $unset: { contactName: '', nickname: '' } }, { returnDocument: 'before' });
        const doc = link?.value !== undefined ? link.value : link;
        if (!doc) return reply({ error: 'Device is not linked.' }, 404);
        await audit(deps, db, { actor: actorOf(ctx, deps).actor, action: 'link.release', deviceId, details: {}, exercise: doc.exercise === true });
        return reply({ unlinked: true });
      }
      return reply({ error: 'Method not allowed.' }, 405);
    });
  } catch (e) {
    if (e instanceof HttpError) return reply({ error: e.message }, e.status);
    return reply({ error: 'This service is unavailable right now. Try again shortly.' }, 503);
  }
}

export async function helpStatusHandler(ctx) {
  try {
    const denied = operatorGate(ctx); if (denied) return denied;
    const { request } = ctx, method = request.method, url = new URL(request.url);
    return await run(ctx, async db => {
      if (method === 'GET') {
        const deviceId = url.searchParams.get('device_id'); oid(deviceId);
        const help = await db.collection('device_help').findOne({ _id: deviceId });
        return reply({ help: help ? { status: help.status, note: help.note, updatedAt: help.updatedAt, updatedBy: help.updatedBy, history: help.history || [] } : { status: 'none', note: '', updatedAt: null, history: [] } });
      }
      if (method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
      if (ctx.data?.operator && !sameOrigin(request)) return originError();
      const body = await readBody(request);
      const status = body.status;
      if (!HELP_STATUSES.includes(status)) return reply({ error: 'Choose a valid help status.' }, 400);
      const note = body.note === undefined || body.note === '' ? '' : plain(body.note, 140);
      if (note === null) return reply({ error: 'Keep the note to 140 plain characters.' }, 400);
      if (looksSecret(note)) return reply({ error: 'The note looks like it contains a secret. Remove it.' }, 400);
      const _id = oid(body.device_id);
      const device = await db.collection('devices').findOne({ _id }, { projection: { meta: 1 } });
      if (!device) return reply({ error: 'Device not found.' }, 404);
      const deviceId = String(_id), now = new Date(), by = ctx.data?.operator?.email || 'admin-key';
      const exercise = device.meta?.exercise === true;
      await db.collection('device_help').updateOne({ _id: deviceId }, {
        $set: { status, note, updatedAt: now, updatedBy: by, exercise },
        $push: { history: { $each: [{ status, note, at: now, by }], $slice: -50 } },
      }, { upsert: true });
      await audit(await depsFor(ctx), db, { actor: { type: 'operator', id: by }, action: 'help.set', deviceId, details: { status }, exercise });
      return reply({ help: { status, note, updatedAt: now.toISOString() } });
    });
  } catch (e) {
    if (e instanceof HttpError) return reply({ error: e.message }, e.status);
    return reply({ error: 'This service is unavailable right now. Try again shortly.' }, 503);
  }
}
