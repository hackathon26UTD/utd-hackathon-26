// Page weight and Lighthouse-style metrics (FCP, LCP, CLS, TBT, load) with Playwright + CDP.
//   node scripts/bench-site.mjs [--url https://utd-hackathon-26.pages.dev] [--paths /,/login,/simulations] [--profile mobile|desktop] [--runs 3] [--json]
// Cold cache each run. "mobile" throttles to about 1.6 Mbps, 150 ms RTT and 4x slower CPU.
import { chromium } from '@playwright/test';

const PROFILES = {
  desktop: { net: null, cpu: 1, viewport: { width: 1280, height: 800 } },
  mobile: { net: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 }, cpu: 4, viewport: { width: 390, height: 844 } },
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

export async function measure(browser, url, profile) {
  const p = PROFILES[profile];
  const ctx = await browser.newContext({ viewport: p.viewport });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (p.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.net.latency, downloadThroughput: p.net.down, uploadThroughput: p.net.up });
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type }));
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  await page.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, tbt: 0, fcp: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  let status = 0;
  page.on('response', (r) => { if (r.url() === url) status = r.status(); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({ ...window.__m, dcl: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart }));
  const rows = [...reqs.values()].filter((r) => r.bytes != null);
  const by = (re) => rows.filter((r) => re.test(r.url)).reduce((a, r) => a + r.bytes, 0);
  const result = {
    status, wallMs: Date.now() - t0,
    requests: rows.length, kb: Math.round(rows.reduce((a, r) => a + r.bytes, 0) / 1024),
    jsKb: Math.round(by(/\.m?js(\?|$)/) / 1024), cssKb: Math.round(by(/\.css(\?|$)/) / 1024),
    fontKb: Math.round(by(/\.woff2?(\?|$)/) / 1024), imgKb: Math.round(by(/\.(png|jpe?g|webp|svg|gif)(\?|$)/) / 1024),
    fcp: Math.round(m.fcp), lcp: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000, tbt: Math.round(m.tbt), dcl: Math.round(m.dcl),
    top: rows.sort((a, b) => b.bytes - a.bytes).slice(0, 4).map((r) => `${r.url.split('/').pop().slice(0, 40)} ${Math.round(r.bytes / 1024)}KB`),
  };
  await ctx.close();
  return result;
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
  const base = flag('url', 'https://utd-hackathon-26.pages.dev').replace(/\/$/, '');
  const paths = (flag('paths', '/,/login,/simulations')).split(',');
  const profile = flag('profile', 'mobile');
  const runs = Number(flag('runs', 3)) || 3;
  const browser = await chromium.launch(process.env.HB_CHROME ? { executablePath: process.env.HB_CHROME } : { channel: 'chrome' });
  const out = [];
  try {
    for (const path of paths) {
      const samples = [];
      for (let i = 0; i < runs; i++) samples.push(await measure(browser, base + path, profile));
      const pick = (k) => median(samples.map((s) => s[k]));
      out.push({ path, profile, runs, status: samples[0].status, requests: pick('requests'), kb: pick('kb'), jsKb: pick('jsKb'), cssKb: pick('cssKb'), fontKb: pick('fontKb'), imgKb: pick('imgKb'), fcp: pick('fcp'), lcp: pick('lcp'), cls: pick('cls'), tbt: pick('tbt'), dcl: pick('dcl'), top: samples[0].top });
    }
  } finally { await browser.close(); }
  if (argv.includes('--json')) { log(JSON.stringify(out, null, 2)); return 0; }
  log(`${base} profile=${profile} runs=${runs} (median, cold cache)`);
  log('path'.padEnd(16), 'req', 'KB'.padStart(6), 'js'.padStart(6), 'css'.padStart(6), 'font'.padStart(5), 'img'.padStart(5), 'FCP'.padStart(6), 'LCP'.padStart(6), 'CLS'.padStart(6), 'TBT'.padStart(5));
  for (const r of out) log(r.path.padEnd(16), String(r.requests).padStart(3), String(r.kb).padStart(6), String(r.jsKb).padStart(6), String(r.cssKb).padStart(6), String(r.fontKb).padStart(5), String(r.imgKb).padStart(5), String(r.fcp).padStart(6), String(r.lcp).padStart(6), String(r.cls).padStart(6), String(r.tbt).padStart(5));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
