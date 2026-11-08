// Shared email shell: table-based, inline CSS, 600px, dark-mode aware, no remote assets, no tracking.
// Templates describe content as blocks; this file turns the same blocks into HTML and plain text.
// Every dynamic value is escaped here, so a template cannot forget to do it.
export const BRAND = {
  ground: '#14121c', ink: '#f8f1e5', amber: '#f6a623', paper: '#f5efe3', critical: '#b4232c', ok: '#12775a',
  text: '#1f1b16', muted: '#5b5247', link: '#7a4300', rule: '#d9cfbd',
};
export const DEFAULT_ORIGIN = 'https://utd-hackathon-26.pages.dev';
export const PROTOTYPE_NOTE = 'This is a prototype. Call emergency services for emergencies.';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
/** One line of untrusted text: no control characters, collapsed spaces, capped length. */
const UNSAFE = new RegExp('[' + [[0, 31], [127, 159], [8232, 8233], [8234, 8238], [8294, 8297]].map(([a, b]) => String.fromCharCode(92) + 'u' + a.toString(16).padStart(4, '0') + '-' + String.fromCharCode(92) + 'u' + b.toString(16).padStart(4, '0')).join('') + ']', 'g');
export const clean = (value, max = 120) => String(value ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Only same-origin https links built from a known path. Anything else falls back to the origin root. */
export function safeUrl(origin, path = '/') {
  try {
    const base = new URL(origin || DEFAULT_ORIGIN);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost') return DEFAULT_ORIGIN + '/';
    const url = new URL(path, base.origin);
    return url.origin === base.origin ? url.href : base.origin + '/';
  } catch { return DEFAULT_ORIGIN + '/'; }
}

// Block constructors
export const h1 = (text) => ({ t: 'h1', text });
export const p = (text, opts = {}) => ({ t: 'p', text, ...opts });
export const kv = (rows) => ({ t: 'kv', rows });
export const button = (label, href) => ({ t: 'button', label, href });
export const list = (items, title) => ({ t: 'list', items, title });
export const callout = (text, tone = 'info') => ({ t: 'callout', text, tone });
export const stat = (items) => ({ t: 'stat', items });

const TONE = { info: BRAND.amber, critical: BRAND.critical, ok: BRAND.ok, unknown: '#6b6455' };
const FONT = 'Arial,Helvetica,sans-serif';

function rowHtml([k, v, tone]) {
  const color = tone === 'critical' ? BRAND.critical : tone === 'ok' ? BRAND.ok : BRAND.text;
  return `<tr><td class="rule mute" width="38%" valign="top" style="padding:9px 12px 9px 0;border-bottom:1px solid ${BRAND.rule};font:600 14px/1.4 ${FONT};color:${BRAND.muted}">${esc(k)}</td><td class="rule ${tone === 'critical' ? 'crit' : 'ink'}" valign="top" style="padding:9px 0;border-bottom:1px solid ${BRAND.rule};font:${tone ? '700' : '400'} 15px/1.4 ${FONT};color:${color}">${esc(v)}</td></tr>`;
}

function blockHtml(b) {
  switch (b.t) {
    case 'h1': return `<tr><td class="ink" style="padding:0 32px 8px 32px;font:700 24px/1.3 ${FONT};color:${BRAND.text}"><h1 style="margin:0;font:inherit;color:inherit">${esc(b.text)}</h1></td></tr>`;
    case 'p': return `<tr><td class="${b.muted ? 'mute' : 'ink'}" style="padding:6px 32px;font:${b.small ? '13px/1.5' : '16px/1.55'} ${FONT};color:${b.muted ? BRAND.muted : BRAND.text}">${esc(b.text)}</td></tr>`;
    case 'kv': return `<tr><td style="padding:10px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rule" style="border-top:1px solid ${BRAND.rule}">${b.rows.map(rowHtml).join('')}</table></td></tr>`;
    case 'button': return `<tr><td style="padding:14px 32px 10px 32px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BRAND.amber}" style="background:${BRAND.amber};border-radius:6px"><a href="${esc(b.href)}" style="display:inline-block;padding:12px 22px;font:700 16px/1.2 ${FONT};color:${BRAND.ground};text-decoration:none">${esc(b.label)}</a></td></tr></table></td></tr>`;
    case 'list': return `<tr><td class="ink" style="padding:8px 32px;font:15px/1.5 ${FONT};color:${BRAND.text}">${b.title ? `<div style="font-weight:700;margin-bottom:4px">${esc(b.title)}</div>` : ''}<table role="presentation" cellpadding="0" cellspacing="0" border="0">${b.items.map((i) => `<tr><td valign="top" class="mute" style="padding:2px 10px 2px 0;color:${BRAND.muted}">&bull;</td><td class="ink" style="padding:2px 0">${esc(i)}</td></tr>`).join('')}</table></td></tr>`;
    case 'callout': return `<tr><td style="padding:10px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="5" bgcolor="${TONE[b.tone] || TONE.info}" style="background:${TONE[b.tone] || TONE.info};font-size:0;line-height:0">&nbsp;</td><td class="well ink" style="padding:12px 14px;background:#ece3d0;font:15px/1.5 ${FONT};color:${BRAND.text}">${esc(b.text)}</td></tr></table></td></tr>`;
    case 'stat': return `<tr><td style="padding:10px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.items.map(([n, label]) => `<td class="well" align="center" width="${Math.floor(100 / b.items.length)}%" style="padding:12px 4px;background:#ece3d0;border:3px solid ${BRAND.paper}"><div class="ink" style="font:700 26px/1.1 ${FONT};color:${BRAND.text}">${esc(n)}</div><div class="mute" style="font:12px/1.3 ${FONT};color:${BRAND.muted}">${esc(label)}</div></td>`).join('')}</tr></table></td></tr>`;
    default: return '';
  }
}

function blockText(b) {
  switch (b.t) {
    case 'h1': return b.text.toUpperCase();
    case 'p': case 'callout': return b.text;
    case 'kv': return b.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'button': return `${b.label}: ${b.href}`;
    case 'list': return (b.title ? b.title + '\n' : '') + b.items.map((i) => `- ${i}`).join('\n');
    case 'stat': return b.items.map(([n, l]) => `${l}: ${n}`).join('\n');
    default: return '';
  }
}

/**
 * Renders {subject, preheader, html, text}. `blocks` hold plain strings; escaping happens here.
 * The lantern mark is built from table cells so there is no image to block or track.
 */
export function renderLayout({ subject, preheader, blocks, origin = DEFAULT_ORIGIN, footerNote = 'HomeBeacon is a prototype built for a hackathon.', exercise = false }) {
  const title = clean(subject, 150).replace(/[<>]/g, '');
  const pre = clean(preheader, 140);
  const home = safeUrl(origin, '/');
  const banner = exercise ? `<tr><td align="center" bgcolor="${BRAND.amber}" style="background:${BRAND.amber};padding:6px 12px;font:700 13px/1.3 ${FONT};color:${BRAND.ground}">EXERCISE: synthetic data, not a real event</td></tr>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
 body,.page{background:#0d0c13 !important}
 .card{background:#1d1a26 !important}
 .ink{color:#f8f1e5 !important}
 .mute{color:#c9bfae !important}
 .rule{border-color:#3a3548 !important}
 .well{background:#2a2535 !important;border-color:#1d1a26 !important}
 .crit{color:#ff8a8f !important}
 a.lnk{color:#f6a623 !important}
}
@media only screen and (max-width:620px){.wrap{width:100% !important}}
</style></head>
<body class="page" style="margin:0;padding:0;background:#e9e1d0;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(pre)}${'&nbsp;&zwnj;'.repeat(20)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e1d0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
${banner}
<tr><td bgcolor="${BRAND.ground}" style="background:${BRAND.ground};padding:22px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-hidden="true"><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="10" height="5" style="border:2px solid ${BRAND.ink};border-bottom:0;border-radius:6px 6px 0 0;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" height="5" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="5" height="24" bgcolor="${BRAND.amber}" style="background:${BRAND.amber};border-radius:0 0 0 5px;font-size:0;line-height:0">&nbsp;</td><td width="20" height="24" bgcolor="#ffd98a" style="background:#ffd98a;font-size:0;line-height:0">&nbsp;</td><td width="5" height="24" bgcolor="${BRAND.amber}" style="background:${BRAND.amber};border-radius:0 0 5px 0;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" height="5" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:0 0 3px 3px;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr></table></td>
<td valign="middle" style="font:700 22px/1 ${FONT};color:${BRAND.ink};letter-spacing:0.3px">HomeBeacon</td>
</tr></table></td></tr>
<tr><td class="card" bgcolor="${BRAND.paper}" style="background:${BRAND.paper}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="height:24px;font-size:0;line-height:0">&nbsp;</td></tr>
${blocks.map(blockHtml).join('\n')}
<tr><td style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>
</table></td></tr>
<tr><td class="card" bgcolor="${BRAND.paper}" style="background:${BRAND.paper};padding:0 32px 26px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule mute" style="border-top:1px solid ${BRAND.rule};padding-top:14px;font:12px/1.5 ${FONT};color:${BRAND.muted}">${esc(footerNote)} <a class="lnk" href="${esc(home)}" style="color:${BRAND.link}">${esc(new URL(home).host)}</a></td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
  const parts = [exercise ? 'EXERCISE: synthetic data, not a real event.' : '', 'HomeBeacon', ...blocks.map(blockText).filter(Boolean), '--\n' + footerNote].filter(Boolean);
  return { subject: title, preheader: pre, html, text: parts.join('\n\n') + '\n' };
}
