import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  oauthHandler,
  connectionsHandler,
  authenticateMcp,
  metadata,
  SCOPE,
} from "../src/customer-oauth.js";
import { mcpHandler } from "../src/customer-mcp.js";
import {
  accountHandler,
  buildHandler,
  assistantHandler,
} from "../src/customer-self-service.js";
import {
  passwordHash,
  issueCustomerSession as issueCustomerBound,
  authenticationAccount,
  customerCookie,
  readCustomerSession,
} from "../src/operator-session.js";
import { sha256Hex } from "../src/auth.js";
import { setupBeacon } from "../src/beacon.js";
import { handle } from "../src/app.js";
async function issueCustomerSession(settings,email) {
  return issueCustomerBound(settings,email,{verifiedAccount:await authenticationAccount(db,'customer',email),db});
}
const origin = "https://home.test",
  email = "owner@example.test",
  other = "other@example.test",
  password = "owner-test-password";
let mongo, client, db, cookie, otherCookie, env;
const addressFetch = async () =>
  Response.json({
    result: {
      addressMatches: [
        {
          matchedAddress: "800 W CAMPBELL RD, RICHARDSON, TX, 75080",
          coordinates: { x: -96.7501, y: 32.9857 },
        },
      ],
    },
  });
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("connect_test");
  env = {
    SESSION_SECRET: "test-customer-connect-secret",
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: "connect_test",
  };
  for (const _id of [email, other])
    await db.collection("customer_accounts").insertOne({
      _id,
      contactName: "Test Owner",
      salt: _id,
      hash: await passwordHash(password, _id),
      createdAt: new Date(Date.now() - 1000),
    });
  cookie = customerCookie(await issueCustomerSession(env, email)).split(";")[0];
  otherCookie = customerCookie(await issueCustomerSession(env, other)).split(
    ";",
  )[0];
  await setupBeacon(db);
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function call(
  fn,
  method,
  path,
  { body, form, cookie: c = cookie, headers = {}, deps = {} } = {},
) {
  const req = new Request(origin + path, {
    method,
    headers: {
      ...(c ? { Cookie: c } : {}),
      ...(["GET", "HEAD"].includes(method) ? {} : { Origin: origin }),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });
  const res = await fn({
    request: req,
    db,
    env,
    deps: { fetcher: addressFetch, ...deps },
  });
  let data;
  try {
    data = await res.clone().json();
  } catch {}
  return { res, data, status: res.status };
}
const oauth = (a) => (ctx) => oauthHandler(a, ctx);
async function connection(c = cookie) {
  const reg = await call(oauth("register"), "POST", "/oauth/register", {
    cookie: null,
    body: {
      client_name: "Test assistant",
      redirect_uris: ["https://assistant.example/callback"],
      token_endpoint_auth_method: "none",
    },
  });
  assert.equal(reg.status, 201);
  const verifier = "v".repeat(64);
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const params = {
    client_id: reg.data.client_id,
    redirect_uri: "https://assistant.example/callback",
    response_type: "code",
    scope: SCOPE,
    resource: origin + "/mcp",
    state: "state-check",
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  const a = await call(
    oauth("authorize"),
    "GET",
    "/oauth/authorize?" + new URLSearchParams(params),
    { cookie: null },
  );
  assert.equal(a.status, 302);
  const pending = new URL(a.res.headers.get("location")).searchParams.get(
    "connect",
  );
  const consent = await call(
    connectionsHandler,
    "POST",
    "/api/customer/connections",
    { cookie: c, body: { requestId: pending, decision: "allow" } },
  );
  assert.equal(consent.status, 200);
  const callback = new URL(consent.data.redirect);
  assert.equal(callback.searchParams.get("state"), "state-check");
  return {
    clientId: reg.data.client_id,
    code: callback.searchParams.get("code"),
    verifier,
    pending,
  };
}
async function tokens(flow) {
  const r = await call(oauth("token"), "POST", "/oauth/token", {
    cookie: null,
    form: {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code: flow.code,
      code_verifier: flow.verifier,
      redirect_uri: "https://assistant.example/callback",
      resource: origin + "/mcp",
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
let box, access, flow;
test("self-built registration is atomic, starts unknown, issues only a hashed hardware key", async () => {
  const id = crypto.randomUUID();
  const r = await call(buildHandler, "POST", "/api/customer/build", {
    body: {
      name: "My bench box",
      address: "800 W Campbell Rd Richardson TX",
      password,
      consent: false,
      requestId: id,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  box = r.data;
  const device = await db
    .collection("devices")
    .findOne({ _id: new ObjectId(box.deviceId) });
  assert.equal(device.lastSeen, null);
  assert.equal(device.keyHash, await sha256Hex(box.deviceKey));
  assert.equal(device.meta.builderEmail, undefined);
  assert.ok(device.homeId);
  const link = await db.collection("customer_links").findOne({ _id: box.id });
  assert.equal(link.customerEmail, email);
  const dup = await call(buildHandler, "POST", "/api/customer/build", {
    body: {
      name: "My bench box",
      address: "800 W Campbell Rd Richardson TX",
      password,
      consent: false,
      requestId: id,
    },
  });
  assert.equal(dup.status, 409);
  assert.equal(
    await db.collection("devices").countDocuments({ "meta.selfBuilt": true }),
    1,
  );
  assert.equal(
    JSON.stringify(
      await db.collection("audit_log").find({}).toArray(),
    ).includes(box.deviceKey),
    false,
  );
});
test("self-built keys work with the existing ingest and replay contract", async () => {
  const body = {
    device_id: box.deviceId,
    event_id: "connect-test-1",
    water_detected: true,
    battery_pct: 52,
  };
  for (const duplicate of [false, true]) {
    const r = await handle(
      new Request(origin + "/api/beacon/ingest", {
        method: "POST",
        headers: {
          "X-Device-Key": box.deviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env,
      { db },
    );
    assert.equal(r.status, 202);
    assert.equal((await r.json()).duplicate, duplicate);
  }
  assert.ok(
    (
      await db
        .collection("devices")
        .findOne({ _id: new ObjectId(box.deviceId) })
    ).lastSeen,
  );
});
test("self-service rejects unauthenticated, cross-origin, wrong-password and foreign-key operations", async () => {
  assert.equal(
    (await call(buildHandler, "GET", "/api/customer/build", { cookie: null }))
      .status,
    401,
  );
  assert.equal(
    (
      await call(buildHandler, "POST", "/api/customer/build", {
        body: {},
        headers: { Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(buildHandler, "PATCH", "/api/customer/build", {
        body: { linkId: box.id, password: "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(buildHandler, "PATCH", "/api/customer/build", {
        cookie: otherCookie,
        body: { linkId: box.id, password },
      })
    ).status,
    404,
  );
});
test("OAuth discovery, strict callback matching, PKCE, code replay, audience and cookies", async () => {
  assert.equal(
    (await metadata(new Request(origin), true).json()).resource,
    origin + "/mcp",
  );
  const unauth = await call(mcpHandler, "POST", "/mcp", {
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  assert.equal(unauth.status, 401);
  assert.match(
    unauth.res.headers.get("www-authenticate"),
    /oauth-protected-resource\/mcp/,
  );
  flow = await connection();
  const bad = await call(oauth("token"), "POST", "/oauth/token", {
    cookie: null,
    form: {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code: flow.code,
      code_verifier: "z".repeat(64),
      redirect_uri: "https://assistant.example/callback",
    },
  });
  assert.equal(bad.status, 400);
  access = await tokens(flow);
  assert.equal(
    (
      await call(oauth("token"), "POST", "/oauth/token", {
        cookie: null,
        form: {
          grant_type: "authorization_code",
          client_id: flow.clientId,
          code: flow.code,
          code_verifier: flow.verifier,
          redirect_uri: "https://assistant.example/callback",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    await authenticateMcp(
      db,
      new Request("https://other.test/mcp", {
        headers: { Authorization: "Bearer " + access.access_token },
      }),
    ),
    null,
  );
  assert.equal(
    (
      await call(
        oauth("authorize"),
        "GET",
        "/oauth/authorize?client_id=" +
          flow.clientId +
          "&redirect_uri=https://evil.test",
      )
    ).status,
    400,
  );
});
test("real MCP SDK initializes, lists tools and returns only owned reports without credentials or addresses", async () => {
  const sdk = new Client({ name: "integration-check", version: "1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(origin + "/mcp"),
    {
      requestInit: {
        headers: { Authorization: "Bearer " + access.access_token },
      },
      fetch: async (input, init) =>
        mcpHandler({ request: new Request(input, init), db, env }),
    },
  );
  await sdk.connect(transport);
  const tools = await sdk.listTools();
  assert.equal(tools.tools.length, 5);
  assert.ok(tools.tools.every((t) => t.annotations.readOnlyHint));
  const list = await sdk.callTool({
    name: "homebeacon_list_devices",
    arguments: {},
  });
  assert.equal(list.structuredContent.devices.length, 1);
  const reports = await sdk.callTool({
    name: "homebeacon_get_device_reports",
    arguments: { device_link_id: box.id },
  });
  assert.equal(reports.structuredContent.readings[0].water_detected, true);
  for (const secret of [box.deviceKey, email, "CAMPBELL", "keyHash"])
    assert.equal(JSON.stringify(reports).includes(secret), false);
  const foreignId = new ObjectId().toString();
  await db.collection("customer_links").insertOne({
    _id: foreignId,
    deviceId: new ObjectId().toString(),
    customerEmail: other,
    active: true,
    linkedAt: new Date(),
  });
  const foreign = await sdk.callTool({
    name: "homebeacon_get_device_reports",
    arguments: { device_link_id: foreignId },
  });
  assert.equal(foreign.isError, true);
  await sdk.close();
});
test("refresh tokens rotate and a disconnected grant immediately loses access", async () => {
  const r = await call(oauth("token"), "POST", "/oauth/token", {
    form: {
      grant_type: "refresh_token",
      client_id: flow.clientId,
      refresh_token: access.refresh_token,
    },
    cookie: null,
  });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.refresh_token, access.refresh_token);
  assert.equal(
    (
      await call(oauth("token"), "POST", "/oauth/token", {
        form: {
          grant_type: "refresh_token",
          client_id: flow.clientId,
          refresh_token: access.refresh_token,
        },
        cookie: null,
      })
    ).status,
    400,
  );
  assert.equal(
    await authenticateMcp(
      db,
      new Request(origin + "/mcp", {
        headers: { Authorization: "Bearer " + r.data.access_token },
      }),
    ),
    null,
  );
  const fresh = await tokens(await connection());
  const grants = await call(
    connectionsHandler,
    "GET",
    "/api/customer/connections",
  );
  const id = grants.data.connections[0].id;
  await call(
    connectionsHandler,
    "DELETE",
    "/api/customer/connections?id=" + id,
  );
  assert.equal(
    await authenticateMcp(
      db,
      new Request(origin + "/mcp", {
        headers: { Authorization: "Bearer " + fresh.access_token },
      }),
    ),
    null,
  );
});
test("NVIDIA key is encrypted, never returned, fixed-host only, and foreign device requests never call the provider", async () => {
  const key = "nvapi-test-only-private-provider-key";
  let r = await call(assistantHandler, "PUT", "/api/customer/assistant", {
    body: { apiKey: key, password },
  });
  assert.equal(r.status, 200);
  const stored = await db
    .collection("customer_assistant_settings")
    .findOne({ _id: email });
  assert.equal(JSON.stringify(stored).includes(key), false);
  assert.equal(
    JSON.stringify(
      (await call(assistantHandler, "GET", "/api/customer/assistant")).data,
    ).includes(key),
    false,
  );
  let calls = 0;
  const nvidiaFetch = async (url, opts) => {
    calls++;
    assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(opts.headers.Authorization, "Bearer " + key);
    assert.equal(opts.redirect, "error");
    for (const secret of [email, box.deviceKey, key, "CAMPBELL"])
      assert.equal(opts.body.includes(secret), false);
    return Response.json({
      choices: [
        {
          message: {
            content: "The water sensor reported water. Review this report.",
          },
        },
      ],
    });
  };
  r = await call(assistantHandler, "POST", "/api/customer/assistant", {
    body: {
      question: "What changed?",
      linkId: new ObjectId().toString(),
      shareData: true,
    },
    deps: { nvidiaFetch },
  });
  assert.equal(r.status, 404);
  assert.equal(calls, 0);
  r = await call(assistantHandler, "POST", "/api/customer/assistant", {
    body: { question: "What changed?", linkId: box.id, shareData: true },
    deps: { nvidiaFetch },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(calls, 1);
  assert.equal(
    (
      await call(assistantHandler, "POST", "/api/customer/assistant", {
        body: { question: "Hi", shareData: false },
        deps: { nvidiaFetch },
      })
    ).status,
    400,
  );
});
test("email change preserves ownership and encrypted key, revokes old sessions and connections, rejects duplicates", async () => {
  const f = await connection();
  const t = await tokens(f);
  assert.equal(
    (
      await call(accountHandler, "PATCH", "/api/customer/account", {
        body: { email: other, confirmEmail: other, password },
      })
    ).status,
    409,
  );
  const next = "changed@example.test";
  const r = await call(accountHandler, "PATCH", "/api/customer/account", {
    body: { email: next, confirmEmail: next, password },
  });
  assert.equal(r.status, 200);
  const newCookie = r.res.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    await readCustomerSession(
      new Request(origin, { headers: { Cookie: cookie } }),
      env,
      db,
    ),
    null,
  );
  assert.equal(
    (
      await readCustomerSession(
        new Request(origin, { headers: { Cookie: newCookie } }),
        env,
        db,
      )
    ).email,
    next,
  );
  assert.equal(
    await authenticateMcp(
      db,
      new Request(origin + "/mcp", {
        headers: { Authorization: "Bearer " + t.access_token },
      }),
    ),
    null,
  );
  assert.equal(
    (await db.collection("customer_links").findOne({ _id: box.id }))
      .customerEmail,
    next,
  );
  assert.equal(
    (
      await call(assistantHandler, "GET", "/api/customer/assistant", {
        cookie: newCookie,
      })
    ).data.configured,
    true,
  );
  await db.collection("customer_accounts").insertOne({
    _id: email,
    contactName: "New person",
    salt: email,
    hash: await passwordHash(password, email),
    createdAt: new Date(),
  });
  assert.equal(
    await readCustomerSession(
      new Request(origin, { headers: { Cookie: cookie } }),
      env,
      db,
    ),
    null,
  );
});

test("expired OAuth codes/tokens and untrusted MCP origins are refused", async () => {
  const f = await connection(otherCookie);
  await db
    .collection("mcp_codes")
    .updateOne(
      { _id: await sha256Hex(f.code) },
      { $set: { expiresAt: new Date(0) } },
    );
  const expired = await call(oauth("token"), "POST", "/oauth/token", {
    cookie: null,
    form: {
      grant_type: "authorization_code",
      client_id: f.clientId,
      code: f.code,
      code_verifier: f.verifier,
      redirect_uri: "https://assistant.example/callback",
    },
  });
  assert.equal(expired.status, 400);
  const t = await tokens(await connection(otherCookie));
  assert.equal(
    (
      await call(mcpHandler, "POST", "/mcp", {
        cookie: null,
        headers: {
          Authorization: "Bearer " + t.access_token,
          Origin: "https://evil.test",
        },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      })
    ).status,
    403,
  );
  await db
    .collection("mcp_tokens")
    .updateOne(
      { _id: await sha256Hex(t.access_token) },
      { $set: { expiresAt: new Date(0) } },
    );
  assert.equal(
    await authenticateMcp(
      db,
      new Request(origin + "/mcp", {
        headers: { Authorization: "Bearer " + t.access_token },
      }),
    ),
    null,
  );
});

test("simultaneous self-built registrations cannot exceed the account limit or leave an orphan", async () => {
  await db
    .collection("customer_accounts")
    .updateOne({ _id: other }, { $set: { selfBuiltCount: 4 } });
  const homes = await db.collection("homes").countDocuments();
  const requests = await Promise.all(
    [1, 2].map((n) =>
      call(buildHandler, "POST", "/api/customer/build", {
        cookie: otherCookie,
        body: {
          name: "Quota box " + n,
          address: "800 W Campbell Rd Richardson TX",
          password,
          consent: false,
          requestId: crypto.randomUUID(),
        },
      }),
    ),
  );
  assert.deepEqual(requests.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await db.collection("customer_accounts").findOne({ _id: other }))
      .selfBuiltCount,
    5,
  );
  assert.equal(await db.collection("homes").countDocuments(), homes + 1);
});
