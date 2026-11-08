import { join } from 'node:path';
import { run } from '../lib/hb-proc.mjs';
import { ageOf } from '../lib/hb-ui.mjs';
import { isLocalSite } from '../lib/hb-http.mjs';

export async function feedFreshness(sources, now) {
  return sources.filter((s) => s.cadenceSeconds).map((s) => {
    const last = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : null;
    const ageMs = last ? now - last : null;
    let state = 'unknown';
    if (s.requiresCredential && s.configured === false) state = 'needs_key';
    else if (ageMs === null) state = 'never';
    else state = ageMs <= s.cadenceSeconds * 2000 ? 'fresh' : 'stale';
    return { id: s.id ?? s._id, name: s.name, state, status: s.status, lastSuccessAt: s.lastSuccessAt || null, cadenceSeconds: s.cadenceSeconds };
  });
}

export default {
  name: 'status',
  summary: 'Site readiness, deployment, feed freshness and device counts',
  usage: 'hb status [--no-deployment] [--json] [--local | --site <url>]',
  async run(args, ctx) {
    const now = ctx.now();
    const [ready, catalog, live] = await Promise.all([
      ctx.api('/api/ready'),
      ctx.api('/api/ops/data-catalog', { auth: 'admin' }).catch((e) => ({ ok: false, status: 0, data: null, error: e.message })),
      ctx.api('/api/ops/live', { auth: 'admin' }).catch((e) => ({ ok: false, status: 0, data: null, error: e.message })),
    ]);
    const sources = catalog.ok ? await feedFreshness(catalog.data?.sources || [], now) : null;
    const devices = live.ok ? live.data?.devices || [] : null;
    let deployment = null;
    const wantDeploy = !ctx.flags['no-deployment'] && ctx.flags.deployment !== false && !isLocalSite(ctx.site) && ctx.env.CLOUDFLARE_ACCOUNT_ID;
    if (wantDeploy) {
      const r = await run(process.execPath, [join(ctx.repoRoot, 'scripts/site.mjs'), 'status'], { cwd: ctx.repoRoot, env: process.env, timeoutMs: 25000 });
      try { deployment = JSON.parse(r.out); } catch { deployment = { error: ctx.redact((r.err || 'deployment lookup unavailable').split('\n')[0]) }; }
    }
    const data = {
      site: ctx.site,
      ready: ready.ok && ready.data?.status === 'ready',
      readyMs: ready.ms,
      deployment: deployment ? (deployment.error ? deployment : { project: deployment.project, url: deployment.url, ...deployment.latest }) : 'skipped',
      feeds: sources ? { total: sources.length, fresh: sources.filter((s) => s.state === 'fresh').length, stale: sources.filter((s) => s.state === 'stale').length, needsKey: sources.filter((s) => s.state === 'needs_key').length, never: sources.filter((s) => s.state === 'never').length, sources } : { error: catalog.error || `HTTP ${catalog.status}` },
      devices: devices ? { total: devices.length, online: devices.filter((d) => !d.offline).length, offline: devices.filter((d) => d.offline).length } : { error: live.error || `HTTP ${live.status}` },
    };
    ctx.emit(data, () => {
      const c = ctx.c;
      ctx.out(`${data.ready ? c.green('READY') : c.red('NOT READY')}  ${ctx.site}  ${c.dim(`${ready.ms} ms`)}`);
      if (deployment && !deployment.error) ctx.out(`  deploy   ${deployment.latest?.status || '?'} ${deployment.latest?.environment || ''} ${(deployment.latest?.commit || '').slice(0, 7)} ${c.dim(ageOf(deployment.latest?.createdAt, now) + ' ago')}`);
      else if (deployment?.error) ctx.out(`  deploy   ${c.yellow('unavailable')} ${deployment.error}`);
      if (data.feeds.error) ctx.out(`  feeds    ${c.yellow('unavailable')} ${data.feeds.error}`);
      else ctx.out(`  feeds    ${c.green(data.feeds.fresh + ' fresh')}, ${data.feeds.stale ? c.red(data.feeds.stale + ' stale') : '0 stale'}, ${data.feeds.needsKey} need a key, ${data.feeds.never} never fetched`);
      if (data.devices.error) ctx.out(`  devices  ${c.yellow('unavailable')} ${data.devices.error}`);
      else ctx.out(`  devices  ${c.green(data.devices.online + ' online')}, ${data.devices.offline ? c.yellow(data.devices.offline + ' offline') : '0 offline'} (${data.devices.total} total)`);
    });
    return data.ready ? 0 : 1;
  },
};
