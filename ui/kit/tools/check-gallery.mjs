// Console + draw check for public/kit.html, with screenshots.
//   node ui/kit/tools/check-gallery.mjs [baseUrl] [--shots]
// Opens ?all=1 in dark then light, fails on any console error, page error,
// failed request or cell that could not draw. Screenshots go to work/shots/kit-*.png.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:8431';
const shots = process.argv.includes('--shots');
const only = (process.argv.find((a) => a.startsWith('--family=')) || '').slice(9);
fs.mkdirSync('work/shots', { recursive: true });
// Use whichever headless shell is installed (the cached build may lag @playwright/test).
const cache = process.env.HOME + '/Library/Caches/ms-playwright';
let executablePath;
try {
    const d = fs.readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop();
    if (d) executablePath = `${cache}/${d}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
} catch (e) { /* default */ }
const browser = await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:executablePath && fs.existsSync(executablePath) ? { executablePath } : {channel:'chrome'});
let bad = 0;
for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    const msgs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => msgs.push('requestfailed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) msgs.push('http ' + r.status() + ': ' + r.url()); });
    await ctx.addInitScript((t) => { try { localStorage.setItem('hbkit-theme', t); } catch (e) {} }, theme);
    await page.goto(base + '/kit.html?all=1' + (only ? '&family=' + only : ''), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__hbgReport && window.__hbgReport.done, null, { timeout: 90000 });
    const rep = await page.evaluate(() => window.__hbgReport);
    console.log(theme, JSON.stringify({ families: rep.families, drawn: rep.drawn, cellErrors: rep.errors.length }));
    rep.errors.slice(0, 40).forEach((e) => console.log('  cell:', e));
    [...new Set(msgs)].slice(0, 40).forEach((m) => console.log('  ', m));
    bad += rep.errors.length + msgs.length;
    if (shots) {
        const fams = await page.$$eval('.hbg-family', (n) => n.map((x) => x.id));
        await page.screenshot({ path: `work/shots/kit-${theme}-top.png` });
        for (const id of fams) {
            const h = await page.$('#' + id);
            await h.scrollIntoViewIfNeeded();
            await page.evaluate((i) => document.getElementById(i).scrollIntoView(), id);
            await page.waitForTimeout(150);
            await page.screenshot({ path: `work/shots/kit-${theme}-${id.replace('family-', '')}.png` });
        }
    }
    await ctx.close();
}
await browser.close();
console.log(bad ? 'PROBLEMS: ' + bad : 'CLEAN');
process.exit(bad ? 1 : 0);
