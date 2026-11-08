// Serial helpers, label sheet HTML and per-box secrets headers for box provisioning. Pure functions, no I/O.
// Everything that reaches HTML goes through esc(). The sheet contains pairing codes (not device keys).
import { randomBytes } from 'node:crypto';
import { qrSvg } from './qr.mjs';

export const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 characters, no I, L, O, 0, 1
export const SERIAL_RE = /^HB-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
export const CODE_V2_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
export const CODE_V1_RE = /^\d{6}$/;
export const DEVICE_KEY_RE = /^dk_[A-Za-z0-9_-]{16,}$/;

/** Check character for a 7 character serial body: sum of (position 1..7) x alphabet index, mod 31. */
export function checkChar(body7) {
  const body = String(body7).toUpperCase();
  if (body.length !== 7) return null;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const v = SERIAL_ALPHABET.indexOf(body[i]);
    if (v < 0) return null;
    sum += (i + 1) * v;
  }
  return SERIAL_ALPHABET[sum % SERIAL_ALPHABET.length];
}

/** Build a v2 serial (HB-XXXX-XXXC) from 7 body characters. */
export function serialFromBody(body7) {
  const c = checkChar(body7);
  if (!c) return null;
  const b = String(body7).toUpperCase() + c;
  return `HB-${b.slice(0, 4)}-${b.slice(4)}`;
}

/** Random v2 serial. Used by tests and the dry-run example only; the server issues real serials. */
export function randomSerial(bytes = randomBytes) {
  const raw = bytes(7);
  let body = '';
  for (let i = 0; i < 7; i++) body += SERIAL_ALPHABET[raw[i] % SERIAL_ALPHABET.length];
  return serialFromBody(body);
}

/** Result of checking a serial the server returned. checksum is null for the legacy 8 random character form. */
export function checkSerial(serial) {
  const s = String(serial || '').toUpperCase();
  if (!SERIAL_RE.test(s)) return { valid: false, checksum: false };
  const body = s.slice(3).replace('-', '');
  return { valid: true, checksum: checkChar(body.slice(0, 7)) === body[7] };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

/** Group a code for reading: XXXX-XXXX stays as is, 6 digits become NNN NNN. */
export const prettyCode = (code) => (CODE_V1_RE.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : String(code));

const CSS = `
:root{color-scheme:light;--ink:#14181f;--mute:#586271;--line:#c9d0da;--bg:#eef1f5;--panel:#fff;--accent:#0b5cad}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 48px}
.notice{background:#fff7e0;border:1px solid #e6c36a;border-radius:8px;padding:12px 14px;margin:0 0 18px}
.notice strong{display:block;margin-bottom:2px}
h1{font-size:22px;margin:0 0 4px}
.meta{color:var(--mute);margin:0 0 18px}
.meta span{margin-right:14px;white-space:nowrap}
.box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 16px}
.box>h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);margin:0 0 10px;font-weight:600}
.pair{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
@media(min-width:760px){.pair{grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:start}}
.part-title{font-size:12px;color:var(--mute);margin:0 0 6px}
.sticker,.card{border:1.5px dashed #7c8798;border-radius:6px;background:#fff;color:#000;padding:3.2mm 4mm}
.sticker{min-height:29mm;display:flex;flex-direction:column;justify-content:space-between}
.brand{font-weight:700;font-size:12px;letter-spacing:.02em}
.serial{font:700 21px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;margin:3px 0;overflow-wrap:anywhere}
.small{font-size:11px;line-height:1.3;color:#222}
.card{display:grid;grid-template-columns:34mm minmax(0,1fr);gap:4mm;align-items:center}
.card svg{width:34mm;height:34mm;display:block}
.card h3{margin:0 0 3px;font-size:14px}
.card ol{margin:0 0 6px;padding-left:16px;font-size:11px;line-height:1.35}
.code{font:700 19px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em;margin:2px 0}
.keep{font-size:10.5px;line-height:1.3;border-top:1px solid #bbb;padding-top:4px;margin-top:4px}
@media(max-width:430px){.card{grid-template-columns:minmax(0,1fr)}.card svg{margin:0 auto;width:min(60vw,44mm);height:auto}}
@page{size:auto;margin:9mm}
@media print{
 body{background:#fff;font-size:11px}
 .wrap{max-width:none;padding:0}
 .notice,.meta,h1,.part-title{display:none}
 .box{border:0;padding:0;margin:0 0 7mm;break-inside:avoid}
 .box>h2{font-size:9px;margin:0 0 2mm}
 .pair{grid-template-columns:62mm 86mm;gap:6mm}
 .sticker{width:62mm;height:29mm;min-height:0;padding:2.4mm 3mm}
 .card{width:86mm;min-height:54mm;grid-template-columns:34mm 1fr}
}`;

function stickerHtml(d) {
  return `<div class="sticker"><div><div class="brand">HomeBeacon</div><div class="serial">${esc(d.serial)}</div></div><div class="small">The pairing card is inside the box. If you need help, tell us the serial only. Never share the code.</div></div>`;
}

function cardHtml(d, host) {
  const svg = qrSvg(d.qrPayload, { label: `Pairing QR code for ${d.serial}` });
  return `<div class="card">${svg}<div><h3>Connect your box</h3><ol><li>Sign in at ${esc(host)}/customer</li><li>Choose Add my box</li><li>Scan the code, or type the serial and code</li></ol><div class="small">Serial</div><div class="code" style="font-size:14px">${esc(d.serial)}</div><div class="small">Pairing code</div><div class="code">${esc(prettyCode(d.pairingCode))}</div><div class="keep">Keep this card private. Whoever holds it can add this box to an account. It works once.</div></div></div>`;
}

/**
 * Printable label sheet. devices: [{ name, serial, pairingCode, qrPayload }]. Returns a full HTML document
 * with no scripts and a strict content security policy.
 */
export function buildSheet(devices, { batch = '', origin = '', createdAt = new Date().toISOString() } = {}) {
  let host = '';
  try { host = new URL(origin).host; } catch { host = String(origin || ''); }
  const boxes = devices.map((d, i) => `<section class="box" aria-label="${esc(d.serial)}"><h2>Box ${i + 1} of ${devices.length}, ${esc(d.name)}</h2><div class="pair"><div><p class="part-title">Outer sticker, goes on the case</p>${stickerHtml(d)}</div><div><p class="part-title">Pairing card, goes inside the box</p>${cardHtml(d, host)}</div></div></section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="robots" content="noindex">
<title>Label sheet ${esc(batch)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="notice"><strong>This sheet holds pairing codes.</strong>Print it to PDF or paper, then delete the file. Do not upload it or share it. Device keys are not on this sheet.</div>
<h1>Label sheet</h1>
<p class="meta"><span>Batch ${esc(batch)}</span><span>${devices.length} box${devices.length === 1 ? '' : 'es'}</span><span>Created ${esc(createdAt)}</span></p>
${boxes}
</div>
</body>
</html>
`;
}

const q = (v) => JSON.stringify(String(v ?? '')).replace(/\?/g, '\\?'); // C string literal; ?? trigraph guard

/**
 * Header for one stand-alone box. The device key lives only in this file (mode 600, git-ignored).
 * wifi: { ssid, pass } from the bench environment, or empty so the installer fills them in.
 */
export function buildSecretsHeader(d, { apiBase, wifi = {}, rand = randomBytes } = {}) {
  const pmk = rand(16).toString('hex'), lmk = rand(16).toString('hex');
  return [
    `// Generated by \`hb provision\` for ${String(d.serial).replace(/[^A-Z0-9-]/g, '')}. Git-ignored. Do not commit or share.`,
    '#pragma once',
    `#define MY_NODE_ID ${q(d.serial)}`,
    `#define WIFI_SSID ${q(wifi.ssid || '')}`,
    `#define WIFI_PASS ${q(wifi.pass || '')}`,
    `#define API_BASE ${q(apiBase)}`,
    '// Stand-alone box: private mesh keys, not shared with any other box.',
    `#define ESPNOW_PMK ${q(pmk)}`,
    `#define ESPNOW_LMK ${q(lmk)}`,
    '#define MESH_NODES { \\',
    `  { ${q(d.serial)}, "00:00:00:00:00:00", ${q(d.id)}, ${q(d.deviceKey)} }, \\`,
    '}',
    '',
  ].join('\n');
}
