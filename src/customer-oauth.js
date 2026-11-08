import { sha256Hex } from "./auth.js";
import { equal } from "./operator-session.js";
import {
  reply,
  fail,
  random,
  run,
  guarded,
  bodyJson,
  bodyText,
  limit,
  indexes,
  customer,
  audit,
} from "./customer-connect-common.js";
export const SCOPE = "homebeacon:read";
const validUntil = () => ({ $gt: new Date() });
const endpoint = (request) => new URL(request.url).origin;
const resource = (request) => endpoint(request) + "/mcp";
const ip = (request) => request.headers.get("CF-Connecting-IP") || "local";
export function metadata(request, protectedResource = false) {
  const origin = endpoint(request);
  return reply(
    protectedResource
      ? {
          resource: origin + "/mcp",
          authorization_servers: [origin],
          scopes_supported: [SCOPE],
          bearer_methods_supported: ["header"],
          resource_name: "HomeBeacon personal devices",
        }
      : {
          issuer: origin,
          authorization_endpoint: origin + "/oauth/authorize",
          token_endpoint: origin + "/oauth/token",
          registration_endpoint: origin + "/oauth/register",
          revocation_endpoint: origin + "/oauth/revoke",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
            "client_secret_basic",
          ],
          scopes_supported: [SCOPE],
        },
  );
}
function redirectAllowed(value) {
  try {
    const u = new URL(value);
    return (
      value.length <= 2048 &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
async function tokenClient(db, request, b) {
  let id = b.client_id,
    secret = b.client_secret,
    method = "client_secret_post";
  const basic = request.headers.get("Authorization");
  if (basic?.startsWith("Basic ")) {
    try {
      const pair = atob(basic.slice(6));
      const colon = pair.indexOf(":");
      id = decodeURIComponent(pair.slice(0, colon));
      secret = decodeURIComponent(pair.slice(colon + 1));
      method = "client_secret_basic";
    } catch {
      fail(401, "invalid_client");
    }
  }
  if (typeof id !== "string") fail(401, "invalid_client");
  const c = await db.collection("mcp_clients").findOne({ _id: id });
  if (
    !c ||
    (c.method !== "none" &&
      (c.method !== method ||
        typeof secret !== "string" ||
        !equal(await sha256Hex(secret), c.secretHash)))
  )
    fail(401, "invalid_client");
  return c;
}
async function createTokens(db, grant, session) {
  const access = random(),
    refresh = random(),
    now = new Date();
  await db.collection("mcp_tokens").insertMany(
    [
      {
        _id: await sha256Hex(access),
        kind: "access",
        grantId: grant._id,
        expiresAt: new Date(+now + 3600000),
      },
      {
        _id: await sha256Hex(refresh),
        kind: "refresh",
        grantId: grant._id,
        expiresAt: new Date(+now + 30 * 86400000),
        used: false,
      },
    ],
    { session },
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refresh,
    scope: SCOPE,
  };
}
export async function authenticateMcp(db, request) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(
    request.headers.get("Authorization") || "",
  );
  if (!match) return null;
  const t = await db
    .collection("mcp_tokens")
    .findOne({
      _id: await sha256Hex(match[1]),
      kind: "access",
      expiresAt: validUntil(),
    });
  if (!t) return null;
  const g = await db
    .collection("mcp_grants")
    .findOne({ _id: t.grantId, revoked: false, resource: resource(request) });
  if (!g) return null;
  const a = await db.collection("customer_accounts").findOne({ _id: g.email });
  if (
    !a ||
    +new Date(a.passwordChangedAt || a.createdAt || 0) > +new Date(g.createdAt)
  )
    return null;
  return g;
}
export function oauthHandler(action, ctx) {
  return guarded(() =>
    run(ctx, async (db) => {
      await indexes(db);
      const { request, env } = ctx;
      const url = new URL(request.url);
      await limit(
        db,
        env,
        "oauth-" + action,
        ip(request),
        action === "register" ? 10 : 90,
      );
      if (action === "register") {
        if (request.method !== "POST") fail(405, "Method not allowed.");
        const b = await bodyJson(request);
        if (
          !Array.isArray(b.redirect_uris) ||
          !b.redirect_uris.length ||
          b.redirect_uris.length > 8 ||
          !b.redirect_uris.every(redirectAllowed)
        )
          fail(400, "invalid_redirect_uri");
        const method = b.token_endpoint_auth_method || "none";
        if (
          !["none", "client_secret_post", "client_secret_basic"].includes(
            method,
          )
        )
          fail(400, "invalid_client_metadata");
        const id = random(),
          secret = method === "none" ? null : random();
        const name =
          typeof b.client_name === "string"
            ? b.client_name.replace(/[\u0000-\u001f]/g, "").slice(0, 80)
            : "Personal assistant";
        await db
          .collection("mcp_clients")
          .insertOne({
            _id: id,
            name,
            redirectUris: [...new Set(b.redirect_uris)],
            method,
            ...(secret ? { secretHash: await sha256Hex(secret) } : {}),
            createdAt: new Date(),
          });
        return reply(
          {
            client_id: id,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_name: name,
            redirect_uris: b.redirect_uris,
            token_endpoint_auth_method: method,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            ...(secret
              ? { client_secret: secret, client_secret_expires_at: 0 }
              : {}),
          },
          201,
        );
      }
      if (action === "authorize") {
        if (request.method !== "GET") fail(405, "Method not allowed.");
        const b = Object.fromEntries(url.searchParams);
        const c = await db
          .collection("mcp_clients")
          .findOne({ _id: b.client_id });
        if (!c || !c.redirectUris.includes(b.redirect_uri))
          fail(
            400,
            "Invalid assistant callback. Start again from your assistant.",
          );
        if (
          b.response_type !== "code" ||
          b.code_challenge_method !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/.test(b.code_challenge || "") ||
          b.scope !== SCOPE ||
          (b.resource && b.resource !== resource(request)) ||
          (b.state?.length || 0) > 1024
        )
          fail(400, "Unsupported authorization request.");
        const id = random();
        await db
          .collection("mcp_pending")
          .insertOne({
            _id: id,
            clientId: c._id,
            clientName: c.name,
            redirectUri: b.redirect_uri,
            challenge: b.code_challenge,
            state: b.state || "",
            resource: resource(request),
            expiresAt: new Date(Date.now() + 600000),
          });
        return new Response(null, {
          status: 302,
          headers: {
            Location: endpoint(request) + "/customer?connect=" + id,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      if (action === "token" || action === "revoke") {
        if (request.method !== "POST") fail(405, "Method not allowed.");
        if (
          !request.headers
            .get("Content-Type")
            ?.startsWith("application/x-www-form-urlencoded")
        )
          fail(400, "Use form-encoded OAuth parameters.");
        const b = Object.fromEntries(
          new URLSearchParams(await bodyText(request)),
        );
        const c = await tokenClient(db, request, b);
        if (action === "revoke") {
          if (typeof b.token === "string" && b.token.length <= 256) {
            const t = await db
              .collection("mcp_tokens")
              .findOne({ _id: await sha256Hex(b.token) });
            if (t)
              await db
                .collection("mcp_grants")
                .updateOne(
                  { _id: t.grantId, clientId: c._id },
                  { $set: { revoked: true, revokedAt: new Date() } },
                );
          }
          return reply({});
        }
        if (b.resource && b.resource !== resource(request))
          fail(400, "invalid_target");
        let result, replayedGrant;
        const session = db.client.startSession();
        try {
          await session.withTransaction(async () => {
            let grant;
            if (b.grant_type === "authorization_code") {
              if (
                !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || "") ||
                !b.code ||
                b.code.length > 256
              )
                fail(400, "invalid_grant");
              const challenge = Buffer.from(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(b.code_verifier),
                ),
              ).toString("base64url");
              const code = await db
                .collection("mcp_codes")
                .findOneAndDelete(
                  {
                    _id: await sha256Hex(b.code),
                    clientId: c._id,
                    redirectUri: b.redirect_uri,
                    resource: resource(request),
                    challenge,
                    expiresAt: validUntil(),
                  },
                  { session },
                );
              if (!code) fail(400, "invalid_grant");
              grant = await db
                .collection("mcp_grants")
                .findOne({ _id: code.grantId, revoked: false }, { session });
            } else if (b.grant_type === "refresh_token") {
              if (!b.refresh_token || b.refresh_token.length > 256)
                fail(400, "invalid_grant");
              const t = await db
                .collection("mcp_tokens")
                .findOne(
                  {
                    _id: await sha256Hex(b.refresh_token),
                    kind: "refresh",
                    expiresAt: validUntil(),
                  },
                  { session },
                );
              if (!t) fail(400, "invalid_grant");
              grant = await db
                .collection("mcp_grants")
                .findOne(
                  {
                    _id: t.grantId,
                    clientId: c._id,
                    resource: resource(request),
                    revoked: false,
                  },
                  { session },
                );
              if (!grant) fail(400, "invalid_grant");
              if (t.used) {
                replayedGrant = grant._id;
                fail(400, "invalid_grant");
              }
              const used = await db
                .collection("mcp_tokens")
                .updateOne(
                  { _id: t._id, used: false },
                  { $set: { used: true } },
                  { session },
                );
              if (!used.modifiedCount) fail(400, "invalid_grant");
            } else fail(400, "unsupported_grant_type");
            const account =
              grant &&
              (await db
                .collection("customer_accounts")
                .findOne({ _id: grant.email }, { session }));
            if (
              !account ||
              +new Date(account.passwordChangedAt || account.createdAt || 0) >
                +new Date(grant.createdAt)
            )
              fail(400, "invalid_grant");
            result = await createTokens(db, grant, session);
          });
        } catch (e) {
          if (replayedGrant)
            await db
              .collection("mcp_grants")
              .updateOne(
                { _id: replayedGrant },
                { $set: { revoked: true, revokedAt: new Date() } },
              );
          throw e;
        } finally {
          await session.endSession();
        }
        return reply(result);
      }
      fail(404, "Not found.");
    }),
  );
}
export function connectionsHandler(ctx) {
  return guarded(() =>
    run(ctx, async (db) => {
      const email = await customer(ctx, db),
        url = new URL(ctx.request.url);
      await indexes(db);
      if (ctx.request.method === "GET") {
        const pending = url.searchParams.get("pending");
        if (pending) {
          const p = await db
            .collection("mcp_pending")
            .findOne({ _id: pending, expiresAt: validUntil() });
          if (!p)
            fail(
              404,
              "This connection request expired. Start again from your assistant.",
            );
          return reply({
            id: p._id,
            name: p.clientName,
            callbackHost: new URL(p.redirectUri).host,
            scope: SCOPE,
          });
        }
        const list = await db
          .collection("mcp_grants")
          .find(
            { email, revoked: false },
            { projection: { clientName: 1, createdAt: 1 } },
          )
          .limit(30)
          .toArray();
        return reply({
          connections: list.map((g) => ({
            id: g._id,
            name: g.clientName,
            createdAt: g.createdAt,
          })),
          mcpUrl: resource(ctx.request),
        });
      }
      if (ctx.request.method === "DELETE") {
        await db
          .collection("mcp_grants")
          .updateOne(
            { _id: url.searchParams.get("id"), email },
            { $set: { revoked: true, revokedAt: new Date() } },
          );
        await audit(db, email, "customer.mcp.revoke");
        return reply({ revoked: true });
      }
      if (ctx.request.method !== "POST") fail(405, "Method not allowed.");
      const b = await bodyJson(ctx.request);
      if (
        typeof b.requestId !== "string" ||
        !["allow", "deny"].includes(b.decision)
      )
        fail(400, "Choose allow or cancel.");
      const code = random();
      let dest;
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const p = await db
            .collection("mcp_pending")
            .findOneAndDelete(
              { _id: b.requestId, expiresAt: validUntil() },
              { session },
            );
          if (!p)
            fail(
              404,
              "This connection request expired. Start again from your assistant.",
            );
          dest = new URL(p.redirectUri);
          if (p.state) dest.searchParams.set("state", p.state);
          if (b.decision === "deny") {
            dest.searchParams.set("error", "access_denied");
            return;
          }
          const grant = {
            _id: random(),
            email,
            clientId: p.clientId,
            clientName: p.clientName,
            resource: p.resource,
            revoked: false,
            createdAt: new Date(),
          };
          await db.collection("mcp_grants").insertOne(grant, { session });
          await db
            .collection("mcp_codes")
            .insertOne(
              {
                _id: await sha256Hex(code),
                grantId: grant._id,
                clientId: p.clientId,
                redirectUri: p.redirectUri,
                challenge: p.challenge,
                resource: p.resource,
                expiresAt: new Date(Date.now() + 120000),
              },
              { session },
            );
          dest.searchParams.set("code", code);
        });
      } finally {
        await session.endSession();
      }
      await audit(db, email, "customer.mcp." + b.decision);
      return reply({ redirect: dest.toString() });
    }),
  );
}
