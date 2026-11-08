// Generates ui/kit/theme-homebeacon.css from the vendored ARGUS token blocks.
//   node ui/kit/tools/make-theme.mjs
// 1. Reads the four token blocks (kit.css light/dark, kit-standards.css light/dark).
// 2. Re-colours every colour literal with a hue-bucket transform (neutral ->
//    dusk/paper ramp, wine/red -> signal amber, ARGUS green -> beacon teal-green).
// 3. Applies the hand-chosen CORE palette on top (the tokens listed in CORE).
// 4. Re-declares the few font-family literals the kit hard-codes.
// 5. Checks WCAG contrast for the documented text pairs and writes
//    docs/UI_KIT_CONTRAST.md. Exits 1 if any text pair is under 4.5:1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..');
const root = path.join(kitDir, '..', '..');
const read = (f) => fs.readFileSync(path.join(kitDir, 'vendor/css', f), 'utf8');

/* ------------------------------------------------------------------ palette */
// Beacon / lamp-at-dusk. Dark = dusk (aubergine-indigo ground, lamp-white ink,
// signal amber). Light = lamp-lit paper (warm paper, indigo ink, burnt amber).
const CORE = {
    light: {
        '--kit-bg': '#f5efe3',
        '--kit-surface': '#fffcf5',
        '--kit-surface-2': '#faf5e9',
        '--kit-line': '#e6dcc6',
        '--kit-line-2': '#d2c5a8',
        '--kit-ink': '#1d1a26',
        '--kit-ink-2': '#4a4557',
        '--kit-ink-3': '#656072',
        '--kit-accent': '#b45f06',
        '--kit-accent-ink': '#8a4600',
        '--kit-accent-tint': '#fcefd6',
        '--kit-accent-line': '#efcf98',
        '--kit-accent-tint-hover': '#f8e3bd',
        '--kit-ok': '#12775a',
        '--kit-ok-tint': '#e1f2ea',
        '--kit-ok-line': '#bddccd',
        '--kit-warn': '#6b5600',
        '--kit-warn-tint': '#f7efc9',
        '--kit-bad': '#b4232c',
        '--kit-bad-tint': '#fbe8e6',
        '--kit-bad-line': '#e6b3b1',
        '--kit-amber': '#d98a0e',
        '--kit-need-warn': '#d99a1c',
        '--kit-hero': '#9a5200',
        '--kit-hero-hover': '#7f4300',
        '--kit-hero-fg': '#ffffff',
        '--kit-status-dot-info': '#1f5fbf',
        '--kit-notification-info': '#2f6fd0',
        '--kit-chart-tip-ground': '#1d1a26',
        '--kit-chart-tip-ink': '#fff8ea',
        '--kit-chart-tip-line': '#1d1a26',
        '--kit-danger-fill': '#c0262d',
        '--kit-danger-fill-hover': '#a11d24',
        '--kit-danger-fill-ink': '#ffffff',
        '--kit-skip-link-bg': '#7f4300',
        '--kit-slider-ring': '#e8a032',
        '--kit-file-drop-refused': '#b4232c'
    },
    dark: {
        '--kit-bg': '#14121c',
        '--kit-surface': '#1d1b28',
        '--kit-surface-2': '#191722',
        '--kit-line': '#2d2a3b',
        '--kit-line-2': '#423e55',
        '--kit-ink': '#f8f1e5',
        '--kit-ink-2': '#d3cbdd',
        '--kit-ink-3': '#aaa2ba',
        '--kit-accent': '#f6a623',
        '--kit-accent-ink': '#ffc660',
        '--kit-accent-tint': '#2b2012',
        '--kit-accent-line': '#5c4417',
        '--kit-accent-tint-hover': '#37281a',
        '--kit-ok': '#5fd3a6',
        '--kit-ok-tint': '#102620',
        '--kit-ok-line': '#1f4a3c',
        '--kit-warn': '#e6cf55',
        '--kit-warn-tint': '#29250f',
        '--kit-bad': '#ff8088',
        '--kit-bad-tint': '#2d171c',
        '--kit-bad-line': '#70303b',
        '--kit-amber': '#f6a623',
        '--kit-need-warn': '#f0b03a',
        '--kit-hero': '#f6a623',
        '--kit-hero-hover': '#ffb940',
        '--kit-hero-fg': '#1c1204',
        '--kit-status-dot-info': '#7db7ff',
        '--kit-notification-info': '#7db7ff',
        '--kit-chart-tip-ground': '#2a2738',
        '--kit-chart-tip-ink': '#f8f1e5',
        '--kit-chart-tip-line': '#423e55',
        '--kit-danger-fill': '#d93a44',
        '--kit-danger-fill-hover': '#c02e38',
        '--kit-danger-fill-ink': '#ffffff',
        '--kit-skip-link-bg': '#f6a623',
        '--kit-slider-ring': '#f6a623',
        '--kit-file-drop-refused': '#ff8088'
    }
};
const FONTS = {
    display: "'Young Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
    sans: "'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "'Spline Sans Mono Variable', 'Spline Sans Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
};

/* ------------------------------------------------------------------- colour */
function parse(c) {
    c = c.trim();
    let m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
        let h = m[1];
        if (h.length === 3) h = h.split('').map((x) => x + x).join('');
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    throw new Error('cannot parse colour ' + c);
}
function toHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
    }
    return { h, s, l };
}
function fromHsl({ h, s, l }) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
const hex2 = (n) => n.toString(16).padStart(2, '0');
function out({ r, g, b, a }) {
    if (a >= 0.9995) return '#' + hex2(r) + hex2(g) + hex2(b);
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}
function lum({ r, g, b }) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function over(fg, bg) { // composite fg (with alpha) on opaque bg
    return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
export function contrast(fg, bg) {
    const A = parse(fg), B = parse(bg);
    const F = A.a < 1 ? over(A, B) : A;
    const l1 = lum(F), l2 = lum(B);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const BAD_NAME = /bad|danger|refused|-down\b|lost|error|line-table-out|sign-in-bad|spend/;
const ACCENT_NAME = /accent|hero|filter-chip|section-menu-(on|hover-ink)|skip-link|slider-ring|status-figure-rule|working-sign|opening-screen-(sweep|halo)/;
function recolor(token, value, theme) {
    return value.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, (lit) => {
        const c = parse(lit);
        const { h, s, l } = toHsl(c);
        const dark = theme === 'dark';
        // pure white / black overlays stay as they are
        if (s < 0.04 && (l > 0.97 || l < 0.03) && c.a < 1) return lit;
        // exact white surface in light -> the paper surface
        if (!dark && c.a === 1 && l > 0.995) return '#fffcf5';
        const neutral = s < 0.2 || (h >= 190 && h <= 260 && s < 0.4);
        if (neutral) {
            const nh = dark ? 255 : 38;
            const ns = dark ? Math.min(0.18, 0.04 + s * 0.4) : Math.min(0.3, 0.06 + s * 0.8) * (1 - Math.max(0, l - 0.96) * 8);
            return out({ ...fromHsl({ h: nh, s: l > 0.985 && !dark ? 0.35 : ns, l }), a: c.a });
        }
        const red = h >= 330 || h <= 14;
        if (red) {
            if (BAD_NAME.test(token) && !ACCENT_NAME.test(token)) return out({ ...fromHsl({ h: 356, s, l }), a: c.a });
            return out({ ...fromHsl({ h: 36, s: Math.min(1, s * 1.1), l: dark ? Math.max(l, 0.3) : l }), a: c.a });
        }
        if (h > 14 && h <= 64) return out({ ...fromHsl({ h: 47, s, l }), a: c.a }); // amber -> caution yellow
        if (h >= 90 && h <= 175) return out({ ...fromHsl({ h: 158, s, l }), a: c.a }); // green -> beacon teal-green
        return lit; // blues, hue wheels
    });
}

/* -------------------------------------------------------------- token blocks */
function blocks(file) {
    const src = read(file);
    const lines = src.split('\n');
    const res = {};
    const starts = lines.map((l, i) => [l, i]).filter(([l]) => l === '.kit {' || l === 'body:not(.light-mode) .kit {');
    // first light block and first dark block that appear in token position
    for (const [l, i] of starts) {
        const key = l === '.kit {' ? 'light' : 'dark';
        if (res[key]) continue;
        let j = i + 1;
        // token block ends at first line that is exactly '}'
        while (lines[j] !== '}') j++;
        const tokens = [];
        const text = lines.slice(i + 1, j).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.push([m[1], m[2].replace(/\s+/g, ' ').trim()]);
        res[key] = tokens;
    }
    return res;
}
const kit = blocks('kit.css');
const std = blocks('kit-standards.css');

function themed(tokens, theme) {
    const lines = [];
    for (const [name, val] of tokens) {
        if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(val)) continue; // radius, motion, type sizes stay the kit's
        let nv = recolor(name, val, theme);
        if (CORE[theme][name]) nv = CORE[theme][name];
        lines.push(`    ${name}: ${nv};`);
    }
    return lines;
}

/* ------------------------------------------------- hard-coded font literals */
function fontRules() {
    const rules = [];
    for (const f of ['kit.css', 'kit-standards.css', 'kit-table.css']) {
        const src = read(f);
        const re = /([^{}]+)\{([^{}]*?font-family:\s*([^;]+);[^{}]*)\}/g;
        let m;
        while ((m = re.exec(src))) {
            const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
            const fam = m[3].replace(/\s+/g, ' ').trim();
            if (/^inherit$|^var\(--font-(sans|mono)/.test(fam)) continue;
            if (/^(\.kit|body:not)/.test(sel) && sel.split(',').length === 1 && !/--/.test(m[2].split(';')[0]) && false) continue;
            let repl;
            if (/Fraunces/.test(fam)) repl = ['var(--font-display)', 'font-weight: 400;'];
            else if (/Lexend|Peta/.test(fam)) repl = ['var(--font-display)', ''];
            else if (/mono|Mono|Monaco|Menlo/.test(fam)) repl = ['var(--font-mono)', ''];
            else if (/Inter/.test(fam)) repl = ['var(--font-mono)', 'font-weight: 600;\n    letter-spacing: -0.035em;'];
            else continue;
            rules.push({ file: f, sel, fam, repl });
        }
    }
    return rules;
}

/* ------------------------------------------------------------------ emit css */
let css = `/* ===========================================================================
 * HomeBeacon theme for the vendored ARGUS UI kit. GENERATED:
 *   node ui/kit/tools/make-theme.mjs
 * Do not hand-edit tokens here; edit CORE in the generator and re-run.
 *
 * Identity: beacon / lamp at dusk. Dark is dusk (aubergine-indigo ground,
 * lamp-white ink, signal amber). Light is lamp-lit paper (warm paper, indigo
 * ink, burnt amber). It replaces ARGUS's neutral grey + wine/red + Inter/
 * Fraunces/JetBrains Mono. Anatomy, states, radii, motion and sizes are the
 * kit's own and are not touched.
 *
 * Selectors are the kit's own two token selectors, repeated, so this sheet
 * wins by order alone. Load it after kit.css, kit-standards.css and glue.css.
 * =========================================================================== */
`;
const light = themed(kit.light, 'light').concat(themed(std.light, 'light'));
const dark = themed(kit.dark, 'dark').concat(themed(std.dark, 'dark'));
const fontTokens = [
    `    --font-display: ${FONTS.display};`,
    `    --font-sans: ${FONTS.sans};`,
    `    --font-mono: ${FONTS.mono};`,
    `    --kit-chart-font: ${FONTS.sans};`
];
css += `\n.kit {\n${fontTokens.join('\n')}\n${light.join('\n')}\n}\n`;
css += `\nbody:not(.light-mode) .kit {\n${fontTokens.join('\n')}\n${dark.join('\n')}\n}\n`;

css += `\n/* The page that hosts a kit (body.kit-body): ground and ink follow the theme. */\nbody.kit-body {\n    background: ${CORE.light['--kit-bg']};\n    color: ${CORE.light['--kit-ink']};\n}\nbody.kit-body:not(.light-mode) {\n    background: ${CORE.dark['--kit-bg']};\n    color: ${CORE.dark['--kit-ink']};\n}\n`;

css += `\n/* Hard-coded font families in the vendored sheets, restated with the HomeBeacon faces. */\n`;
const seen = new Set();
for (const r of fontRules()) {
    const key = r.sel + '|' + r.repl[0];
    if (seen.has(key)) continue;
    seen.add(key);
    css += `/* was ${r.fam} (${r.file}) */\n${r.sel} {\n    font-family: ${r.repl[0]};${r.repl[1] ? '\n    ' + r.repl[1] : ''}\n}\n`;
}
fs.writeFileSync(path.join(kitDir, 'theme-homebeacon.css'), css);

/* ---------------------------------------------------------------- contrast */
const val = (theme, name) => {
    const all = themed(kit[theme], theme).concat(themed(std[theme], theme));
    const hit = all.reverse().find((l) => l.trim().startsWith(name + ':'));
    return hit ? hit.split(':').slice(1).join(':').replace(';', '').trim() : null;
};
const PAIRS = [
    // [label, fg token, bg token, minimum]
    ['Body text on page ground', '--kit-ink', '--kit-bg', 4.5],
    ['Body text on surface', '--kit-ink', '--kit-surface', 4.5],
    ['Body text on raised surface', '--kit-ink', '--kit-surface-2', 4.5],
    ['Secondary text on surface', '--kit-ink-2', '--kit-surface', 4.5],
    ['Muted text on surface', '--kit-ink-3', '--kit-surface', 4.5],
    ['Muted text on page ground', '--kit-ink-3', '--kit-bg', 4.5],
    ['Accent text on surface', '--kit-accent-ink', '--kit-surface', 4.5],
    ['Accent text on accent tint', '--kit-accent-ink', '--kit-accent-tint', 4.5],
    ['Primary button text on primary fill', '--kit-hero-fg', '--kit-hero', 4.5],
    ['Primary fill hover with its text', '--kit-hero-fg', '--kit-hero-hover', 4.5],
    ['Done (ok) text on its tint', '--kit-ok', '--kit-ok-tint', 4.5],
    ['Done (ok) text on surface', '--kit-ok', '--kit-surface', 4.5],
    ['Caution text on its tint', '--kit-warn', '--kit-warn-tint', 4.5],
    ['Critical text on its tint', '--kit-bad', '--kit-bad-tint', 4.5],
    ['Critical text on surface', '--kit-bad', '--kit-surface', 4.5],
    ['Info text on surface', '--kit-status-dot-info', '--kit-surface', 4.5],
    ['Delete button text on its fill', '--kit-danger-fill-ink', '--kit-danger-fill', 4.5],
    ['Chart tooltip text on tooltip', '--kit-chart-tip-ink', '--kit-chart-tip-ground', 4.5],
    ['Accent mark on surface (non-text)', '--kit-accent', '--kit-surface', 3],
    ['Line-2 border on surface (non-text)', '--kit-line-2', '--kit-surface', 1.3]
];
let md = `# HomeBeacon kit contrast table\n\nGenerated by \`node ui/kit/tools/make-theme.mjs\`. WCAG 2.x ratio, text pairs need 4.5:1, non-text marks 3:1.\n\n| Pair | Dark | Light | Need |\n|---|---|---|---|\n`;
let fail = 0;
for (const [label, fg, bg, need] of PAIRS) {
    const cells = ['dark', 'light'].map((t) => {
        const f = val(t, fg), b = val(t, bg);
        const r = contrast(f, b);
        if (r < need) fail++;
        return `${r.toFixed(2)}:1 (${f} on ${b})${r < need ? ' FAIL' : ''}`;
    });
    md += `| ${label} | ${cells[0]} | ${cells[1]} | ${need}:1 |\n`;
}
fs.writeFileSync(path.join(root, 'docs/UI_KIT_CONTRAST.md'), md);
console.log(md);
console.log(fail ? `FAIL: ${fail} pair(s) under minimum` : 'all pairs pass');
process.exit(fail ? 1 : 0);
