import { withDatabase } from "../lib/mongodb.js";
import { HttpError } from "./http.js";
import { sha256Hex } from "./auth.js";
import {
  passwordHash,
  equal,
  readCustomerSession,
  sameOrigin,
} from "./operator-session.js";
export const reply = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export const random = () =>
  crypto.randomUUID().replaceAll("-", "") +
  crypto.randomUUID().replaceAll("-", "");
export const run = (ctx, fn) =>
  ctx.db ? fn(ctx.db) : withDatabase(ctx.env, fn);
export async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    return reply(
      {
        error:
          e instanceof HttpError
            ? e.message
            : "The service is unavailable. Try again shortly.",
      },
      e instanceof HttpError ? e.status : 503,
    );
  }
}
export async function bodyText(request, max = 16384) {
  if (Number(request.headers.get("Content-Length")) > max)
    fail(413, "Request is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  let count = 0,
    chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > max) {
        await reader.cancel();
        fail(413, "Request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(count);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function bodyJson(request) {
  let b;
  try {
    b = JSON.parse(await bodyText(request));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, "Enter valid request details.");
  }
  if (!b || typeof b !== "object" || Array.isArray(b))
    fail(400, "Enter valid request details.");
  return b;
}
export async function limit(
  db,
  env,
  scope,
  identity,
  max = 20,
  windowMs = 900000,
) {
  const bucket = Math.floor(Date.now() / windowMs),
    _id = await sha256Hex(
      `${env.SESSION_SECRET}:${scope}:${identity}:${bucket}`,
    );
  const r = await db
    .collection("connect_limits")
    .findOneAndUpdate(
      { _id },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) },
      },
      { upsert: true, returnDocument: "after" },
    );
  if (r.count > max) fail(429, "Too many requests. Try again later.");
}
export async function customer(ctx, db) {
  if (!["GET", "HEAD"].includes(ctx.request.method) && !sameOrigin(ctx.request))
    fail(403, "Use this setting on HomeBeacon.");
  const session = await readCustomerSession(ctx.request, ctx.env, db);
  if (!session) fail(401, "Sign in to your HomeBeacon account.");
  await limit(db, ctx.env, "customer-settings", session.email, 120);
  return session.email;
}
export async function reauthenticate(db, env, email, password) {
  await limit(db, env, "customer-password", email, 8);
  if (typeof password !== "string" || password.length > 512)
    fail(400, "Enter your current password.");
  const account = await db
    .collection("customer_accounts")
    .findOne({ _id: email });
  if (
    !account ||
    !equal(await passwordHash(password, account.salt), account.hash)
  )
    fail(403, "The current password is incorrect.");
  return account;
}
export async function indexes(db) {
  await Promise.all(
    ["connect_limits", "mcp_pending", "mcp_codes", "mcp_tokens"].map((n) =>
      db.collection(n).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ),
  );
}
export async function audit(db, email, action, details = {}) {
  await db
    .collection("audit_log")
    .insertOne({
      at: new Date(),
      actor: {
        type: "customer",
        id: (await sha256Hex("customer:" + email)).slice(0, 12),
      },
      action,
      details,
      exercise: false,
    });
}
export async function encryptKey(env, email, value) {
  if (!env.SESSION_SECRET) fail(503, "Private key storage is unavailable.");
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      "homebeacon:customer-nvidia:v1:" + env.SESSION_SECRET,
    ),
  );
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(email) },
    key,
    new TextEncoder().encode(value),
  );
  return {
    iv: Buffer.from(iv).toString("base64"),
    data: Buffer.from(data).toString("base64"),
  };
}
export async function decryptKey(env, email, record) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      "homebeacon:customer-nvidia:v1:" + env.SESSION_SECRET,
    ),
  );
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "decrypt",
  ]);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(record.iv, "base64"),
        additionalData: new TextEncoder().encode(email),
      },
      key,
      Buffer.from(record.data, "base64"),
    ),
  );
}
