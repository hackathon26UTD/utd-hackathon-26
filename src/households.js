// Household authority is always derived from current account generations and live links.
import { ObjectId } from 'mongodb';
import { withDatabase } from '../lib/mongodb.js';
import { HttpError, badRequest, notFound, json, readJson } from './http.js';
import { sha256Hex } from './auth.js';
import { readCustomerSession, sameOrigin } from './operator-session.js';
import { listCustomerDevices } from './customer.js';
import { loadRisk } from './risk/load.js';
import { customerView } from './risk/customer.js';
import { customerMessages } from './messages.js';

export const HOUSEHOLD_LIMITS = Object.freeze({ owned: 5, links: 20, members: 20, inviteDays: 7 });
const id = () => crypto.randomUUID();
const forbidden = () => new HttpError(403, 'This household is not available to this account.');
const emailOf = v => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null;
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 100;
const indexes = new WeakSet();
export async function ensureHouseholds(db) {
  if (indexes.has(db)) return;
  await Promise.all([
    db.collection('households').createIndex({ ownerEmail: 1, ownerGeneration: 1, active: 1 }),
    db.collection('household_members').createIndex({ householdId: 1, email: 1, status: 1 }),
    db.collection('household_members').createIndex({ email: 1, accountGeneration: 1, status: 1 }),
    db.collection('household_members').createIndex({ householdId: 1, email: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }),
    db.collection('household_members').createIndex({ inviteHash: 1 }, { unique: true, partialFilterExpression: { inviteHash: { $type: 'string' } } }),
    db.collection('household_rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  indexes.add(db);
}
async function account(db, email, options = {}) {
  const a = await db.collection('customer_accounts').findOne({ _id: email, disabled: { $ne: true } }, options);
  if (!a || typeof a.sessionGeneration !== 'string' || !a.sessionGeneration) throw forbidden();
  return a;
}
async function liveLinks(db, household, options = {}) {
  const links = await db.collection('customer_links').find({ _id: { $in: household.linkIds || [] }, customerEmail: household.ownerEmail, active: true, exercise: { $ne: true } }, options).limit(20).toArray();
  const deviceIds = links.map(l => l.deviceId).filter(v => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)).map(v => new ObjectId(v));
  const devices = await db.collection('devices').find({ _id: { $in: deviceIds }, disabled: { $ne: true }, 'meta.exercise': { $ne: true } }, { ...options, projection: { _id: 1 } }).toArray();
  const live = new Set(devices.map(d => String(d._id)));
  return links.filter(l => live.has(l.deviceId));
}
async function resolve(db, { email, householdId, requireOwner = false, requireView = true }, options = {}) {
  if (!validId(householdId) || !emailOf(email)) throw forbidden();
  const a = await account(db, email, options);
  const household = await db.collection('households').findOne({ _id: householdId, active: true }, options);
  if (!household) throw notFound('Household not found.');
  const owner = await account(db, household.ownerEmail, options);
  if (owner.sessionGeneration !== household.ownerGeneration) throw forbidden();
  const member = await db.collection('household_members').findOne({ householdId, email, accountGeneration: a.sessionGeneration, status: 'active' }, options);
  if (!member || !['owner', 'viewer', 'alerts'].includes(member.role)) throw forbidden();
  const isOwner = email === household.ownerEmail && a.sessionGeneration === household.ownerGeneration && member.role === 'owner';
  if ((member.role === 'owner' && !isOwner) || (requireOwner && !isOwner) || (requireView && member.role === 'alerts')) throw forbidden();
  return { household, member, links: await liveLinks(db, household, options) };
}
export async function resolveHousehold(db, options) { return resolve(db, options); }
export async function activeHouseholdMember(db, memberId) {
  if (!validId(memberId)) return null;
  const member = await db.collection('household_members').findOne({ _id: memberId, status: 'active' });
  if (!member) return null;
  try {
    const access = await resolveHousehold(db, { email: member.email, householdId: member.householdId, requireView: false });
    return access.member._id === memberId ? access : null;
  } catch (e) { if (e instanceof HttpError) return null; throw e; }
}
export async function householdSnapshots(db, access, { env = {}, now = new Date(), deps = {} } = {}) {
  const current = await resolveHousehold(db, { email: access.member.email, householdId: access.household._id });
  if (current.member._id !== access.member._id || current.member.accountGeneration !== access.member.accountGeneration) throw forbidden();
  // Reuse the customer summary mapper with a strictly selected link query. No owner
  // credentials, contact information, unselected readings or message writes enter it.
  const selected = current.links.map(l => l._id);
  const scopedDb = { collection(name) {
    const collection = db.collection(name);
    if (name !== 'customer_links') return collection;
    return { find(query, options) { return collection.find({ ...query, _id: { $in: selected }, customerEmail: current.household.ownerEmail, active: true, exercise: { $ne: true } }, options); } };
  } };
  const snapshots = await listCustomerDevices(scopedDb, { email: current.household.ownerEmail, env, now }, { customerView, customerMessages, ...deps, loadRisk: (database, options) => (deps.loadRisk || loadRisk)(database, { ...options, readOnly: true }) });
  const final = await resolveHousehold(db, { email: access.member.email, householdId: access.household._id });
  if (final.member._id !== current.member._id || final.member.accountGeneration !== current.member.accountGeneration) throw forbidden();
  const stillSelected = new Set(final.links.map(l => l._id));
  // Freeform operator help notes may contain private contacts; expose status/text only.
  return snapshots.filter(d => stillSelected.has(d.id)).map(d => ({ ...d, help: { status: d.help.status, text: d.help.text, updatedAt: d.help.updatedAt } }));
}
const publicMember = (m, self = false) => ({ id: m._id, householdId: m.householdId, email: m.email, role: m.role, status: m.status, inviteExpiresAt: m.inviteExpiresAt || null, ...(self ? { preferences: { device: m.preferences?.device === true, weather: m.preferences?.weather === true }, emailVerifiedAt: m.emailVerifiedAt || null } : {}) });
const publicHousehold = a => ({ id: a.household._id, name: a.household.name, linkIds: a.links.map(l => l._id), member: publicMember(a.member, true) });
export async function listHouseholds(db, email) {
  const a = await account(db, email);
  const rows = await db.collection('household_members').find({ email, accountGeneration: a.sessionGeneration, status: 'active' }).toArray();
  const result = [];
  for (const m of rows) {
    const access = await activeHouseholdMember(db, m._id);
    if (access) result.push(publicHousehold(access));
  }
  return result;
}
async function lockAccount(db, a, options) {
  const r = await db.collection('customer_accounts').updateOne({ _id: a._id, sessionGeneration: a.sessionGeneration, disabled: { $ne: true } }, { $inc: { householdRevision: 1 } }, options);
  if (!r.matchedCount) throw forbidden();
}
async function selectedLinks(db, email, linkIds, options) {
  if (!Array.isArray(linkIds) || linkIds.length > 20 || linkIds.some(v => !validId(v)) || new Set(linkIds).size !== linkIds.length) throw badRequest('Choose up to 20 different live devices.');
  const links = await liveLinks(db, { ownerEmail: email, linkIds }, options);
  if (links.length !== linkIds.length) throw badRequest('Choose only your currently linked live devices.');
  // Conflict with concurrent unlink/reassignment while selection commits.
  for (const l of links) {
    const result = await db.collection('customer_links').updateOne({ _id: l._id, customerEmail: email, active: true }, { $inc: { householdRevision: 1 } }, options);
    if (!result.matchedCount) throw forbidden();
  }
  return linkIds;
}
function nameOf(v) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 60 || /[\x00-\x1f\x7f]/.test(v)) throw badRequest('Use a household name of 1–60 characters.');
  return v.trim();
}
const revokeFields = now => ({ status: 'revoked', revokedAt: now, preferences: { device: false, weather: false }, emailVerifiedAt: null, verifiedEmail: null });
export async function mutateHousehold(db, email, body, { now = new Date(), expectedGeneration } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Choose a household action.');
  await ensureHouseholds(db);
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const options = { session }, a = await account(db, email, options);
      if (expectedGeneration && a.sessionGeneration !== expectedGeneration) throw forbidden();
      await lockAccount(db, a, options);
      const households = db.collection('households'), members = db.collection('household_members');
      if (body.action === 'create') {
        if (await households.countDocuments({ ownerEmail: email, ownerGeneration: a.sessionGeneration, active: true }, options) >= 5) throw new HttpError(409, 'You can own up to 5 households.');
        const household = { _id: id(), ownerEmail: email, ownerGeneration: a.sessionGeneration, name: nameOf(body.name), linkIds: await selectedLinks(db, email, body.linkIds, options), active: true, createdAt: now, updatedAt: now, revision: 0 };
        const member = { _id: id(), householdId: household._id, email, accountGeneration: a.sessionGeneration, role: 'owner', status: 'active', inviteHash: null, inviteExpiresAt: null, preferences: { device: false, weather: false }, emailVerifiedAt: null, verifiedEmail: null, createdAt: now, acceptedAt: now };
        await households.insertOne(household, options); await members.insertOne(member, options);
        return { household: publicHousehold({ household, member, links: household.linkIds.map(_id => ({ _id })) }) };
      }
      if (body.action === 'accept') {
        if (typeof body.token !== 'string' || !/^[a-f\d]{64}$/.test(body.token)) throw badRequest('Invitation is unavailable or expired.');
        const inviteHash = await sha256Hex(body.token);
        const member = await members.findOne({ inviteHash, email, status: 'pending', inviteExpiresAt: { $gt: now } }, options);
        if (!member) throw badRequest('Invitation is unavailable or expired for this account.');
        const household = await households.findOne({ _id: member.householdId, active: true }, options);
        if (!household) throw forbidden();
        const owner = await account(db, household.ownerEmail, options);
        if (owner.sessionGeneration !== household.ownerGeneration) throw forbidden();
        await lockAccount(db, owner, options);
        await households.updateOne({ _id: household._id, active: true }, { $inc: { revision: 1 } }, options);
        const result = await members.updateOne({ _id: member._id, status: 'pending', inviteHash, inviteExpiresAt: { $gt: now } }, { $set: { status: 'active', accountGeneration: a.sessionGeneration, acceptedAt: now, inviteHash: null, emailVerifiedAt: null, verifiedEmail: null, preferences: { device: false, weather: false } } }, options);
        if (!result.modifiedCount) throw forbidden();
        return { householdId: household._id };
      }
      const ownerAction = ['update', 'delete', 'invite', 'revoke'].includes(body.action);
      if (!ownerAction && body.action !== 'leave') throw badRequest('Unknown household action.');
      const access = await resolve(db, { email, householdId: body.householdId, requireOwner: ownerAction, requireView: false }, options);
      await households.updateOne({ _id: access.household._id, active: true }, { $inc: { revision: 1 }, $set: { updatedAt: now } }, options);
      if (body.action === 'update') {
        const update = {};
        if (Object.hasOwn(body, 'name')) update.name = nameOf(body.name);
        if (Object.hasOwn(body, 'linkIds')) update.linkIds = await selectedLinks(db, email, body.linkIds, options);
        if (!Object.keys(update).length) throw badRequest('Choose a name or devices to update.');
        await households.updateOne({ _id: body.householdId }, { $set: update }, options); return { ok: true };
      }
      if (body.action === 'delete') {
        await households.updateOne({ _id: body.householdId }, { $set: { active: false, deletedAt: now, linkIds: [] } }, options);
        await members.updateMany({ householdId: body.householdId, status: { $ne: 'revoked' } }, { $set: { ...revokeFields(now), inviteHash: null } }, options); return { ok: true };
      }
      if (body.action === 'invite') {
        const invitedEmail = emailOf(body.email);
        if (!invitedEmail || invitedEmail === email || !['viewer', 'alerts'].includes(body.role)) throw badRequest('Choose another email and a valid access role.');
        // Expired/stale records are retained, but cannot block fresh invitations forever.
        const existing = await members.find({ householdId: body.householdId, status: { $in: ['active', 'pending'] } }, options).toArray();
        for (const m of existing) {
          const current = m.status === 'active' ? await db.collection('customer_accounts').findOne({ _id: m.email, sessionGeneration: m.accountGeneration, disabled: { $ne: true } }, options) : null;
          if ((m.status === 'pending' && new Date(m.inviteExpiresAt) <= now) || (m.status === 'active' && !current)) await members.updateOne({ _id: m._id }, { $set: { ...revokeFields(now), inviteHash: null } }, options);
        }
        if (await members.countDocuments({ householdId: body.householdId, status: { $in: ['active', 'pending'] } }, options) >= 20) throw new HttpError(409, 'A household can have up to 20 members and pending invitations, including its owner.');
        if (await members.findOne({ householdId: body.householdId, email: invitedEmail, status: { $in: ['active', 'pending'] } }, options)) throw new HttpError(409, 'This email already has access or a pending invitation.');
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
        const m = { _id: id(), householdId: body.householdId, email: invitedEmail, role: body.role, status: 'pending', accountGeneration: null, inviteHash: await sha256Hex(token), inviteExpiresAt: new Date(now.getTime() + 7 * 86400000), preferences: { device: false, weather: false }, emailVerifiedAt: null, verifiedEmail: null, createdAt: now };
        await members.insertOne(m, options); return { member: publicMember(m), token, delivery: 'not_emailed' };
      }
      const memberId = body.action === 'leave' ? access.member._id : body.memberId;
      if (!validId(memberId)) throw badRequest('Choose a member.');
      const result = await members.updateOne({ _id: memberId, householdId: body.householdId, role: { $ne: 'owner' }, status: { $in: ['active', 'pending'] } }, { $set: { ...revokeFields(now), inviteHash: null } }, options);
      if (!result.matchedCount) throw badRequest('Member is unavailable. Owners must delete the household instead.');
      return { ok: true };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 4000 });
  } finally { await session.endSession(); }
}
async function rate(db, key, max, now) {
  const bucket = Math.floor(now.getTime() / 900000);
  const _id = `${key}:${bucket}`;
  const row = await db.collection('household_rate_limits').findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 900000) } }, { upsert: true, returnDocument: 'after' });
  if (row.count > max) throw new HttpError(429, 'Too many household changes. Try again in 15 minutes.');
}
export async function householdsHandler(ctx) {
  try {
    const { request, env = {} } = ctx;
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    if (request.method === 'POST' && !sameOrigin(request)) throw new HttpError(403, 'This request must come from Safe Home.');
    const run = ctx.db ? fn => fn(ctx.db) : fn => withDatabase(env, fn);
    return await run(async db => {
      const signed = await readCustomerSession(request, env, db);
      if (!signed) throw new HttpError(401, 'Sign in to manage households.');
      await ensureHouseholds(db);
      if (request.method === 'GET') {
        const householdId = new URL(request.url).searchParams.get('id');
        if (!householdId) {
          const households = await listHouseholds(db, signed.email);
          const current = await account(db, signed.email);
          if (signed.accountGeneration && current.sessionGeneration !== signed.accountGeneration) throw forbidden();
          return json({ households });
        }
        const access = await resolveHousehold(db, { email: signed.email, householdId, requireView: false });
        const result = { household: publicHousehold(access) };
        if (access.member.role !== 'alerts') result.devices = await householdSnapshots(db, access, { env, now: ctx.now, deps: ctx.deps });
        if (access.member.role === 'owner') result.members = (await db.collection('household_members').find({ householdId, status: { $in: ['active', 'pending'] } }).sort({ createdAt: -1 }).limit(20).toArray()).map(m => publicMember(m));
        // Do not disclose management data if a generation/revocation changed mid-read.
        const final = await resolveHousehold(db, { email: signed.email, householdId, requireView: false });
        if (final.member._id !== access.member._id || (signed.accountGeneration && final.member.accountGeneration !== signed.accountGeneration)) throw forbidden();
        return json(result);
      }
      const now = ctx.now || new Date();
      await rate(db, await sha256Hex(`household-account:${signed.email}`), 60, now);
      await rate(db, await sha256Hex(`household-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`), 120, now);
      return json(await mutateHousehold(db, signed.email, await readJson(request), { now, expectedGeneration: signed.accountGeneration }));
    });
  } catch (e) { return json({ error: e instanceof HttpError ? e.message : 'Household service is unavailable. Try again.' }, e instanceof HttpError ? e.status : 503); }
}
