#!/usr/bin/env node
// Email tooling. Usage:
//   node scripts/email.mjs list
//   node scripts/email.mjs preview [template|all] [--out work/email-preview] [--shots]
//   node scripts/email.mjs send-test <template> [--to delivered@resend.dev] [--keychain] [--dry-run]
// send-test only sends to Resend sink addresses (or EMAIL_TEST_ALLOWLIST). The key comes from RESEND_API_KEY,
// or with --keychain from the macOS Keychain (service vault:resend-api-key). It is never printed or written.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailConfig, isEmail, isSink, sendEmail } from '../src/email.js';
import { renderEmail, TEMPLATES } from '../src/email-templates/index.js';
import { sampleFor } from '../src/email-templates/samples.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SHOT_WIDTHS = { desktop: 800, mobile: 375 };

export function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['shots', 'keychain', 'dry-run', 'json', 'dark'].includes(key)) flags[key] = true;
      else flags[key] = argv[++i];
    } else rest.push(a);
  }
  return { flags, rest };
}

export async function preview({ templates, out, shots = false, log = console.log }) {
  const dir = resolve(out || join(ROOT, 'work/email-preview'));
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const name of templates) {
    const mail = renderEmail(name, sampleFor(name));
    await writeFile(join(dir, `${name}.html`), mail.html);
    await writeFile(join(dir, `${name}.txt`), `Subject: ${mail.subject}\nPreheader: ${mail.preheader}\n\n${mail.text}`);
    files.push(join(dir, `${name}.html`));
    log(`wrote ${name}.html (${mail.html.length} bytes)`);
  }
  if (shots) {
    const { chromium } = await import('playwright');
    // Prefer the bundled browser; fall back to the installed Chrome so no download is needed.
    const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
    try {
      for (const scheme of ['light', 'dark']) {
        for (const [label, width] of Object.entries(SHOT_WIDTHS)) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
          const page = await ctx.newPage();
          for (const name of templates) {
            await page.goto('file://' + join(dir, `${name}.html`));
            const path = join(dir, `${name}.${label}.${scheme}.png`);
            await page.screenshot({ path, fullPage: true });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            log(`shot ${name}.${label}.${scheme}.png${overflow ? ' HORIZONTAL OVERFLOW' : ''}`);
          }
          await ctx.close();
        }
      }
    } finally { await browser.close(); }
  }
  return { dir, files };
}

function keychainKey() {
  try { return execFileSync('security', ['find-generic-password', '-s', 'vault:resend-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

export async function sendTest({ template, to = 'delivered@resend.dev', env, dryRun = false, keychain = false, deps = {} }) {
  if (!TEMPLATES.includes(template)) throw new Error(`template must be one of ${TEMPLATES.join(', ')}`);
  const e = { ...env };
  if (keychain && !e.RESEND_API_KEY) e.RESEND_API_KEY = keychainKey();
  const cfg = emailConfig(e);
  const addr = String(to).trim().toLowerCase();
  if (!isEmail(addr)) throw new Error('Recipient is not a valid address.');
  if (!isSink(addr) && !cfg.testAllowlist.includes(addr)) throw new Error('Refusing to send: only Resend sink addresses (delivered@, bounced@, complained@resend.dev) or EMAIL_TEST_ALLOWLIST.');
  const mail = renderEmail(template, sampleFor(template, { exercise: true }), { origin: cfg.origin });
  if (dryRun) return { dryRun: true, template, subject: mail.subject, from: cfg.from };
  if (!cfg.enabled) throw new Error('No RESEND_API_KEY. Set it in the environment or pass --keychain.');
  const result = await sendEmail(e, { to: addr, subject: mail.subject, html: mail.html, text: mail.text, template: `test:${template}`, idempotencyKey: `cli:${template}:${Date.now()}` }, deps);
  return { sent: result.ok, template, status: result.status ?? null, attempts: result.attempts, reason: result.reason || null, from: cfg.from };
}

export async function main(argv, env = process.env, log = console.log) {
  const { flags, rest } = parseArgs(argv);
  const [cmd, arg] = rest;
  if (cmd === 'list') { for (const t of TEMPLATES) log(t); return 0; }
  if (cmd === 'preview') {
    const names = !arg || arg === 'all' ? TEMPLATES : [arg];
    for (const n of names) if (!TEMPLATES.includes(n)) { log(`Unknown template ${n}. Try: ${TEMPLATES.join(', ')}`); return 2; }
    await preview({ templates: names, out: flags.out, shots: flags.shots === true, log });
    return 0;
  }
  if (cmd === 'send-test') {
    try {
      const r = await sendTest({ template: arg || 'welcome', to: flags.to, env, dryRun: flags['dry-run'] === true, keychain: flags.keychain === true });
      log(JSON.stringify(r));
      return r.dryRun || r.sent ? 0 : 1;
    } catch (e) { log(e.message); return 2; }
  }
  log('Usage: email <list | preview [template|all] [--out dir] [--shots] | send-test <template> [--to sink] [--keychain] [--dry-run]>');
  return cmd ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
