// Screenshot individual standards from public/kit.html.
//   node ui/kit/tools/shot.mjs <dark|light> <std-key> [<std-key> ...]
// Writes work/shots/kit-<theme>-<key>.png (the standard's whole card).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [theme, ...keys] = process.argv.slice(2);
const base = process.env.KIT_BASE || 'http://127.0.0.1:8431';
const cache = process.env.HOME + '/Library/Caches/ms-playwright';
const d = fs.readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop();
const executablePath = `${cache}/${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => { try { localStorage.setItem('hbkit-theme', t); } catch (e) {} }, theme);
const page = await ctx.newPage();
await page.goto(base + '/kit.html?all=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__hbgReport && window.__hbgReport.done, null, { timeout: 90000 });
for (const k of keys) {
    const el = await page.$('#std-' + k);
    if (!el) { console.log('missing', k); continue; }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: `work/shots/kit-${theme}-${k}.png` });
    console.log('shot', k);
}
await browser.close();
