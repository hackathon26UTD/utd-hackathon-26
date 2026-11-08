// npm run hb -- agent <package|verify|simulate|power-plan|test> [options]
// Everything about the Arduino Uno Q agent (agents/unoq): build the release, check it, run it against a
// mock or local dev server with a fake MCU, and print a battery runtime plan. No secrets are read or printed.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage, verifyPackage, version } from '../package-unoq.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const AGENT_DIR = join(ROOT, 'agents', 'unoq');
const PY_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USAGE = `agent <subcommand>
  package                          build public/downloads/unoq (tarball, sha256, manifest, install.sh)
  verify [--pubkey file.pem]       re-check the published release and run the extracted agent self test
  simulate [--duration 40] [--scenario mixed|flood|outage|quiet] [--url http://127.0.0.1:8788 --device-id ID]
                                   run the agent with a fake MCU against a mock API (default) or a local dev server
  power-plan [--mah N --volts V --soc P --chemistry liion --hours 24 ...]   battery runtime plan
  test                             run the Python unit tests`;

// Options come from the dispatcher's parsed flags (npm run hb -- agent simulate --duration 30) and, when this
// module is called directly with raw tokens, from the argument list.
const optFrom = (args, flags = {}) => (name, def) => {
  const f = flags[name.replace(/^--/, '')];
  if (f !== undefined && f !== true && f !== false) return f;
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const PLAN_VALUE = ['mah', 'volts', 'soc', 'soc-source', 'chemistry', 'converter', 'hours', 'last-gasp-hours', 'mains', 'measured'];

function python(args, extra = {}) {
  return spawnSync('python3', ['-B', ...args], { cwd: AGENT_DIR, env: PY_ENV, encoding: 'utf8', ...extra });
}

/** Mock of the device API with the same routes and codes the agent expects. Counts what it sees. */
export function startMockApi(key) {
  const st = { requests: [], eventIds: new Set(), duplicates: 0, acks: [], messages: [], config: null, events: [], settingsReports: [] };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 300_000) req.destroy(); });
    req.on('end', () => {
      const path = req.url.split('?')[0];
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* leave null */ }
      st.requests.push({ method: req.method, path, ok: req.headers['x-device-key'] === key });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers['x-device-key'] !== key) return send(401, { error: 'Invalid device key' });
      if (req.method === 'POST' && path === '/api/beacon/ingest') {
        const dup = st.eventIds.has(body?.event_id);
        if (dup) st.duplicates++;
        st.eventIds.add(body?.event_id);
        return send(202, { accepted: true, duplicate: dup });
      }
      if (req.method === 'POST' && path === '/api/ingest') return send(202, { accepted: body?.readings?.length ?? 0, messages_pending: 0, poll_after_s: 30 });
      if (req.method === 'POST' && path === '/api/events') { st.events.push(body); return send(201, { event: {} }); }
      if (req.method === 'GET' && path === '/api/device/messages') {
        const after = Number(new URL(req.url, 'http://x').searchParams.get('after') || 0);
        const out = st.messages.filter((m) => m.seq > after).slice(0, 3);
        return send(200, { messages: out, cursor: out.length ? out[out.length - 1].seq : after, poll_after_s: 30, ...(st.config ? { configuration: st.config } : {}) });
      }
      if (req.method === 'POST' && path === '/api/device/messages') { st.acks.push([body?.message_id, body?.state]); return send(200, { state: body?.state }); }
      if (req.method === 'POST' && path === '/api/device/settings') {
        st.settingsReports.push(body);
        return st.config && body?.revision === st.config.revision ? send(200, { configuration: st.config }) : send(409, { error: 'stale' });
      }
      if (req.method === 'GET' && path === '/api/device/settings') return send(200, { configuration: st.config });
      return send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ st, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

async function freePort() {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function getJson(url) { const r = await fetch(url); return r.json(); }

async function simulate(args, ctx) {
  const log = ctx.log || console.log;
  const opt = optFrom(args, ctx.flags);
  const duration = Number(opt('--duration', 40));
  const scenario = opt('--scenario', 'mixed');
  const url = opt('--url', '');
  if (python(['--version']).error) { log('python3 is required for the agent simulation.'); return 1; }
  const work = mkdtempSync('/tmp/hbsim-'); // short path: unix sockets have a length limit
  const key = url ? process.env.HB_DEVICE_KEY || '' : `dk_sim_${randomBytes(6).toString('hex')}`;
  const deviceId = url ? opt('--device-id', '') : 'a'.repeat(24);
  let mock = null;
  let base = url;
  if (!url) { mock = await startMockApi(key); base = mock.url; } else {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { log('simulate --url only talks to a local dev server (127.0.0.1 or localhost).'); return 1; }
    if (!key || !/^[0-9a-f]{24}$/i.test(deviceId)) { log('For a dev server set HB_DEVICE_KEY in the environment and pass --device-id <24 hex>.'); return 1; }
  }
  if (mock) {
    mock.st.messages = [
      { seq: 1, id: '0'.repeat(23) + '1', kind: 'info', severity: 'advisory', title: 'Storm watch', body: 'Stay alert tonight', expires_at: '2099-01-01T00:00:00Z', requires_ack: true },
      { seq: 2, id: '0'.repeat(23) + '2', kind: 'instruction', severity: 'info', title: 'CMD', body: 'poll 20', expires_at: '2099-01-01T00:00:00Z', requires_ack: true },
      { seq: 3, id: '0'.repeat(23) + '3', kind: 'instruction', severity: 'info', title: 'CMD', body: 'rm -rf /', expires_at: '2099-01-01T00:00:00Z', requires_ack: true },
    ];
    mock.st.config = { revision: 1, pollAfterSeconds: 45 };
  }
  const statusPort = await freePort();
  const cfgPath = join(work, 'sim.toml');
  writeFileSync(cfgPath, [
    '[api]', `base_url = "${base}"`, `device_id = "${deviceId}"`, 'key_env = "HB_SIM_KEY"',
    '[agent]', `state_dir = "${work}/state"`,
    '[mcu]', 'source = "fake"',
    '[status]', `port = ${statusPort}`,
    '[uplink]', 'relay_mains = true',
    '[power]', 'battery_mah = 6000', 'nominal_v = 7.4', 'chemistry = "liion"', 'converter = "buck"', 'assumed_soc_pct = 80',
    'need_hours = 12', 'assume_mains = "present"', '',
  ].join('\n'));
  log(`simulating ${duration}s, scenario ${scenario}, ${url ? 'dev server ' + url : 'mock API'} (fake MCU, no hardware)`);
  const child = spawn('python3', ['-B', 'run_agent.py', '--config', cfgPath, 'run', '--scenario', scenario, '-v'], {
    cwd: AGENT_DIR, env: { ...PY_ENV, HB_SIM_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', r));
  let status = null;
  const t0 = Date.now();
  while (Date.now() - t0 < duration * 1000) {
    await sleep(1000);
    try { status = await getJson(`http://127.0.0.1:${statusPort}/status`); } catch { /* not up yet */ }
  }
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(8000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  const result = { ok: true, checks: [], summary: {} };
  const check = (name, cond) => { result.checks.push({ name, pass: !!cond }); if (!cond) result.ok = false; };
  if (mock) {
    const by = {};
    for (const r of mock.st.requests) by[`${r.method} ${r.path}`] = (by[`${r.method} ${r.path}`] || 0) + 1;
    result.summary = { requests: by, eventTypes: [...new Set(mock.st.events.map((e) => e.type))], acks: mock.st.acks, duplicates: mock.st.duplicates, settingsReports: mock.st.settingsReports };
    check('only the device key was used', mock.st.requests.every((r) => r.ok));
    check('readings were uploaded', (by['POST /api/ingest'] || 0) >= 1);
    check('beacon telemetry used unique event ids', (by['POST /api/beacon/ingest'] || 0) >= 1 && mock.st.duplicates === 0);
    check('hazard and mode events were sent', ['hub.hazard_seen', 'agent.mode'].every((t) => mock.st.events.some((e) => e.type === t)) || scenario === 'quiet');
    check('info message shown, not auto-acknowledged', mock.st.acks.some(([id, s]) => id.endsWith('1') && s === 'shown') && !mock.st.acks.some(([id, s]) => id.endsWith('1') && s === 'acked'));
    check('allowlisted command acknowledged', mock.st.acks.some(([id, s]) => id.endsWith('2') && s === 'acked'));
    check('dangerous command refused, never run', mock.st.events.some((e) => e.type === 'agent.cmd_refused') && !mock.st.acks.some(([id, s]) => id.endsWith('3') && s === 'acked'));
    check('settings revision reported once applied', mock.st.settingsReports.some((r) => r.revision === 1 && r.pollAfterSeconds === 45));
    await mock.close();
  }
  check('status endpoint answered', status && status.power);
  if (status?.power) {
    result.summary.power = { mode: status.power.mode, cloudSees: status.power.server_mode, reportEveryS: status.power.report_s, pollEveryS: status.power.poll_s, hoursRemaining: status.power.hours_remaining, confidence: status.power.confidence, why: status.power.reasons };
    result.summary.hazard = status.hazard;
    result.summary.queue = status.uplink.queue;
  }
  check('agent exited cleanly on SIGTERM', child.exitCode === 0 || child.signalCode === 'SIGTERM');
  rmSync(work, { recursive: true, force: true });
  log(JSON.stringify(result.summary, null, 2));
  for (const c of result.checks) log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
  if (!result.ok) log('--- agent output (tail) ---\n' + out.split('\n').slice(-25).join('\n'));
  if (ctx.jsonMode) ctx.json(result);
  return result.ok ? 0 : 1;
}

export default {
  name: 'agent',
  summary: 'Uno Q agent: package, verify, simulate, power-plan',
  usage: USAGE,
  booleans: ['hazard'],
  async run(args = [], ctx = {}) {
    const log = ctx.log || console.log;
    const sub = args[0];
    const rest = args.slice(1);
    const opt = optFrom(rest, ctx.flags);
    if (!sub || sub === 'help' || args.includes('--help')) { log(USAGE); return sub ? 0 : 2; }
    if (sub === 'package') {
      const r = buildPackage({});
      log(`built ${r.manifest.file}: ${r.manifest.size} bytes, sha256 ${r.manifest.sha256}${r.manifest.signature ? ', signed' : ', not signed (set UNOQ_SIGNING_KEY to sign)'}`);
      log(`output: ${r.dir}`);
      log(`install on the Uno Q: curl -fsSL https://utd-hackathon-26.pages.dev/downloads/unoq/install.sh | sudo sh`);
      if (ctx.jsonMode) ctx.json({ ok: true, manifest: r.manifest });
      return 0;
    }
    if (sub === 'verify') {
      const r = verifyPackage({ pubkey: opt('--pubkey', undefined) });
      for (const n of r.notes) log(`note: ${n}`);
      for (const p of r.problems) log(`PROBLEM: ${p}`);
      log(r.ok ? `release ${r.manifest.version} verified` : 'release has problems');
      if (ctx.jsonMode) ctx.json({ ok: r.ok, problems: r.problems, notes: r.notes, version: r.manifest?.version });
      return r.ok ? 0 : 1;
    }
    if (sub === 'simulate') return simulate(rest, ctx);
    if (sub === 'power-plan') {
      let pyArgs = rest;
      if (!rest.some((a) => a.startsWith('--'))) {
        pyArgs = [];
        for (const k of PLAN_VALUE) if (ctx.flags?.[k] !== undefined && ctx.flags[k] !== true) pyArgs.push(`--${k}`, String(ctx.flags[k]));
        if (ctx.flags?.hazard) pyArgs.push('--hazard');
        if (ctx.jsonMode) pyArgs.push('--json');
      }
      const r = python(['run_agent.py', 'power-plan', ...pyArgs]);
      if (r.stdout) (ctx.out || log)(r.stdout.trimEnd());
      if (r.stderr) log(r.stderr.trimEnd());
      return r.status ?? 1;
    }
    if (sub === 'test') {
      const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests'], { cwd: AGENT_DIR, env: PY_ENV, encoding: 'utf8' });
      log((r.stdout + r.stderr).trimEnd().split('\n').slice(-6).join('\n'));
      return r.status ?? 1;
    }
    log(`unknown subcommand ${sub}\n${USAGE}`);
    return 2;
  },
};
export { version };
