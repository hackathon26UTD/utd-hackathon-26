#!/usr/bin/env node
// Screenshots of the command center (street zoom, overlays) and the customer page on a phone.
//   API_ADMIN_KEY=<key> node scripts/e2e-shots.mjs [--base http://127.0.0.1:8788] [--out work/shots]
// Needs a running dev server with seeded exercise devices (run scripts/e2e-platform.mjs first) and SESSION_SECRET in .dev.vars.
// Signs its own operator cookie from SESSION_SECRET. No secret is printed.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { issueSession, COOKIE } from '../src/operator-session.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8788').replace(/\/$/, '');
const out = arg('--out', 'work/shots');
mkdirSync(out, { recursive: true });
const vars = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
const token = await issueSession({ SESSION_SECRET: vars.SESSION_SECRET }, 'e2e-operator@example.test', 'operator');

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const watch = (page, tag) => { page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tiles|openfreemap|net::ERR/i.test(m.text())) errors.push(`${tag}: ${m.text()}`); }); page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`)); };

// ---- command center, desktop, street zoom
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: COOKIE, value: token, url: base, httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage(); watch(page, 'command');
await page.goto(`${base}/command-center?mode=exercise`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#live-pill', { timeout: 20000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/int-command-overview.png` });
// street level: zoom the map onto the cluster centre
const zoomed = await page.evaluate(() => { const m = window.__hbMap; if (!m) return false; m.jumpTo({ center: [-96.75, 32.98], zoom: 15.5 }); return true; });
console.log('map handle exposed for zoom:', zoomed);
if (!zoomed) { const box = await page.locator('.map-wrap').boundingBox(); for (let i = 0; i < 8; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); } }
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/int-command-street.png` });
await page.click('#overlay-toggle'); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/int-command-layers.png` });
await page.keyboard.press('Escape');
await page.screenshot({ path: `${out}/int-command-detail.png`, fullPage: true });
await ctx.close();

// ---- customer page, phone
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const cpage = await pctx.newPage(); watch(cpage, 'customer');
await cpage.goto(`${base}/customer`, { waitUntil: 'domcontentloaded' });
await cpage.waitForTimeout(1500);
await cpage.screenshot({ path: `${out}/int-customer-start.png`, fullPage: true });
const hasScroll = await cpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log('customer page horizontal scroll:', hasScroll);
await pctx.close();
await browser.close();
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
