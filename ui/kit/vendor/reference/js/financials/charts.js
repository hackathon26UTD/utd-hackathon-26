/* ===========================================================================
 * Financials: the charts.  window.FinCharts
 *
 * SVG charts for the Financials page, copied from Mercury's Insights and
 * Transactions screens (docs/financials/mercury-reference/overview.md 3,
 * moneyout.md 3, moneyin.md 3, transactions.md 3) in everything EXCEPT
 * colour, which is ours (docs/ARGUS_INVENTORY_UI_CONTRACT.md 11):
 *
 *   money in      --crm-revenue   the only green on the page
 *   money out     --crm-spend     the dark red; NEVER --crm-danger
 *   counts        --crm-volume
 *   named groups  --crm-cat-1..5  (a validated categorical set, argus-crm.css)
 *
 * Every factory is  FinCharts.<kind>(el, data)  and returns
 * { update(partial), destroy() }. update() MERGES into the last data; when the
 * partial carries no `state`, the state is derived again from the data.
 *
 *   overview(el, { buckets:[{label, from, to, moneyIn, moneyOut, note?}],
 *                  direction:'all'|'in'|'out', average, compare, totals?, state })
 *                 `note` is a bucket's own caveat for its tooltip;
 *                 `totals` {moneyIn, moneyOut, net} are the READ's totals, for
 *                 the screen-reader summary (a sum of buckets is unknown as soon
 *                 as one bucket is, while the read's total is not)
 *                 `layout: 'full'` (the Overview landing) spends less of the
 *                 width on the edges and draws fatter bars, capped so a range
 *                 of two buckets never draws slabs. `leadNote: true` names a
 *                 run of two or more leading buckets that hold NO figure at
 *                 all ("No records before Aug 17"): the slots stay empty, the
 *                 words say why, and nothing there is drawn as a zero.
 *   line(el, { buckets:[{label, from, to}],
 *              series:[{key, label, tone, values, negate}], direction, state })
 *   stacked(el, { buckets:[{label, from, to, values:{key:cents}}],
 *                 groups:[{key, label}], direction, state })
 *   sankey(el, { sources:[{label, cents}], total, sinks:[{label, cents}],
 *                net, outTotal, direction, state })
 *                 all: sources -> Money in -> Expenses (outTotal) -> sinks
 *   shareBar(el | null, { pct, offsetPct, tone })  mounted, or an HTML string
 *   cumulative(el, { days:[{date, moneyIn, moneyOut}], state })
 *   topBars(el, { rows:[{label, cents} | {label, pair:{in, out}}], state })
 *                 a pair is Mercury's in/out bars under ONE label (out is a
 *                 flow: negative for money out). A zero half is its cap on the
 *                 baseline, in its own side's colour, as Mercury draws it.
 *
 * Money is integer CENTS. Money out is a POSITIVE magnitude on the wire
 * (design doc, "Data contract"); the charts print the minus sign.
 *
 * THREE WAYS A READ SETTLES, and they never look alike (contract 4, 13):
 *   state 'loading'  the dotted field shimmers; no marks, no figures
 *   state 'failed'   NO marks at all, not even a baseline, and a sentence.
 *                    A baseline under a request that failed is a claim that
 *                    the figure is zero, the one most likely to be believed.
 *                    `onRetry` (optional function) adds Try again INSIDE the
 *                    plate; leave it out where asking again cannot help.
 *   state 'empty'    a real zero baseline, labelled "0". A quiet period is a
 *                    measured zero and draws like one.
 * A null value is a GAP (no bar, a break in the line), never a zero.
 *   derived 'unavailable'  the read answered but NOT ONE value is known
 *                    (every bucket null): the failed plate with `reason`
 *                    (or "These figures are not available for this period.").
 *                    Never the zero line, which would say "quiet period".
 *   sankey `total: null` (money in unknown) in all-cashflow mode draws money
 *                    out alone with `reason` as a caption: no "Money in $0",
 *                    no Shortfall worked out from a null.
 *
 * Colour never comes from here. Every mark carries a class and css/
 * financials-charts.css paints it from the tokens, so the theme toggle
 * reaches every one of them. No hex, rgb or named colour appears below.
 *
 * Coordinates are real CSS pixels: the svg's viewBox is its measured width,
 * so a circle stays a circle and 1px stays 1px (Kit.chart stretches a fixed
 * viewBox instead, which is why it has to draw its text in HTML). Labels are
 * HTML here too, in an overlay, so a long name can ellipsize with CSS. A
 * ResizeObserver redraws when the container width changes.
 *
 * Accessibility: the svg is role="img" with a one-sentence aria-label, it is
 * focusable and the arrow keys walk the buckets (the readout is a role=status
 * node, so a walk is audible), and a visually hidden <table> carries every
 * value the chart draws, so nothing is gated behind a hover.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.FinCharts) return;
    if (!window.FinFormat) {
        if (window.console && console.warn) {
            console.warn('[FinCharts] js/financials/format.js must load first; nothing registered.');
        }
        return;
    }

    const NS = 'http://www.w3.org/2000/svg';
    const TONES = ['revenue', 'spend', 'volume', 'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5'];
    let seq = 0;

    const Fm = () => window.FinFormat;

    /* ── small builders ─────────────────────────────────────────────────── */

    function s(tag, attrs, parent) {
        const n = document.createElementNS(NS, tag);
        if (attrs) {
            Object.keys(attrs).forEach((k) => {
                if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
            });
        }
        if (parent) parent.appendChild(n);
        return n;
    }

    /** An HTML node. Text goes in through textContent: labels are tenant data. */
    function h(tag, cls, text, parent) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== null && text !== undefined) n.textContent = String(text);
        if (parent) parent.appendChild(n);
        return n;
    }

    const r2 = (v) => Math.round(v * 100) / 100;
    /** Snap a 1px line to the pixel grid. */
    const px = (v) => Math.round(v) + 0.5;

    /** A money value in cents, or null when it is not known. */
    function val(v) {
        if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function list(v) {
        return Array.isArray(v) ? v.filter((x) => x !== null && typeof x === 'object') : [];
    }

    function toneOf(t) {
        return TONES.indexOf(t) >= 0 ? t : 'volume';
    }

    /** A total, or null when any part of it is unknown. */
    function sum(arr) {
        let t = 0;
        let any = false;
        for (const v of arr) {
            if (v === null) return null;
            t += v;
            any = true;
        }
        return any ? t : null;
    }

    /* ── scales ─────────────────────────────────────────────────────────── */

    /** The smallest 1 / 2 / 2.5 / 5 x 10^k at or above raw. */
    function niceStep(raw) {
        if (!(raw > 0)) return 0;
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const m = raw / p;
        const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
        return k * p;
    }

    /**
     * Mercury's two axis shapes, measured off its captures:
     *   symmetric (all cashflow)  about four steps a side: $1.7M -> +/-$2M by $500K
     *   one-sided (in or out)     about five steps: $430K -> $500K by $100K
     * Returns null when there is nothing to scale (every value zero or unknown).
     */
    function scaleFor(max, symmetric) {
        if (!(max > 0)) return null;
        const step = niceStep(max / (symmetric ? 4 : 5));
        const n = Math.max(1, Math.ceil(max / step - 1e-9));
        return { step: step, n: n, top: step * n };
    }

    /** Mercury's band layout: 4 buckets in 713px sit on a 131px pitch, bars 58px.
     *  `full` (overview's layout: 'full'): a third of a slot at each edge
     *  instead of three quarters, and bars 62% of a slot, never past 72px. */
    const FULL_EDGE = 0.3;
    const FULL_BAR = 0.62;
    const FULL_BAR_MAX = 72;
    function band(plotL, plotW, n, full) {
        const edge = full ? FULL_EDGE : 0.7215;
        const pitch = plotW / (Math.max(1, n) + edge * 2);
        const bw = full ? Math.min(pitch * FULL_BAR, FULL_BAR_MAX) : pitch * 0.443;
        return {
            pitch: pitch,
            barW: Math.max(1, bw),
            cx: (i) => plotL + pitch * (edge + i + 0.5)
        };
    }

    /** At most one x label per ~48px, so dates never collide; a longer label
     *  ("Oct 2024", "Sep 22, 2025" on a range that spans years) gets the room
     *  its text needs (13px Inter runs about 7px a character). */
    function stride(n, plotW, labels) {
        let longest = 0;
        (labels || []).forEach((t) => {
            if (t && t.length > longest) longest = t.length;
        });
        const room = Math.max(48, Math.ceil(longest * 7 + 12));
        return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / room))));
    }

    function bucketLabel(b) {
        if (b && typeof b.label === 'string' && b.label) return b.label;
        if (b && b.from) return Fm().month(b.from);
        return '';
    }

    /* ── shared svg pieces ──────────────────────────────────────────────── */

    function gradient(defs, id, vertical, stops, user) {
        const g = s(
            'linearGradient',
            user
                ? Object.assign({ id: id, gradientUnits: 'userSpaceOnUse' }, user)
                : { id: id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 },
            defs
        );
        stops.forEach((st) => s('stop', { offset: st[0], class: st[1] }, g));
        return g;
    }

    /**
     * The dotted plot background (overview.md 3.2): 2x2 dots, 14px apart
     * across, and each y-tick interval divided evenly into as many rows as
     * fit at 14px or more (Mercury: 53px -> 3 rows, 84px -> 6, 105px -> 7),
     * faded out over the top and bottom 15%. The fade is an ALPHA mask, so
     * it needs no colour of its own.
     */
    function dotField(svg, defs, uid, box, zeroY, tickGap) {
        const rows = Math.max(1, Math.floor(tickGap / 14));
        const ph = tickGap / rows;
        const pat = s(
            'pattern',
            {
                id: uid + '-dots',
                patternUnits: 'userSpaceOnUse',
                width: 14,
                height: r2(ph),
                x: r2(box.l - 1),
                y: r2(zeroY - 1)
            },
            defs
        );
        s('rect', { class: 'fin-chart__dot', x: 0, y: 0, width: 2, height: 2 }, pat);
        const fade = s('linearGradient', { id: uid + '-fade', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
        [
            [0, 0],
            [0.15, 1],
            [0.85, 1],
            [1, 0]
        ].forEach((st) => s('stop', { offset: st[0], 'stop-opacity': st[1] }, fade));
        const mask = s(
            'mask',
            {
                id: uid + '-mask',
                maskUnits: 'userSpaceOnUse',
                'mask-type': 'alpha',
                x: 0,
                y: 0,
                width: '100%',
                height: '100%'
            },
            defs
        );
        s(
            'rect',
            { x: box.l - 2, y: box.t, width: box.r - box.l + 4, height: box.b - box.t, fill: 'url(#' + uid + '-fade)' },
            mask
        );
        s(
            'rect',
            {
                class: 'fin-chart__dots',
                x: box.l - 1,
                y: box.t,
                width: box.r - box.l + 2,
                height: box.b - box.t,
                fill: 'url(#' + uid + '-dots)',
                mask: 'url(#' + uid + '-mask)'
            },
            svg
        );
    }

    function yLabel(layer, text, y, cls) {
        const n = h('span', 'fin-chart__y' + (cls ? ' ' + cls : ''), text, layer);
        n.style.top = r2(y) + 'px';
        return n;
    }

    function xLabel(layer, text, x, y, i) {
        const n = h('span', 'fin-chart__x', text, layer);
        n.style.left = r2(x) + 'px';
        n.style.top = r2(y) + 'px';
        if (i !== undefined) n.setAttribute('data-i', String(i));
        return n;
    }

    function hLine(svg, cls, x1, x2, y) {
        return s('line', { class: cls, x1: r2(x1), x2: r2(x2), y1: px(y), y2: px(y) }, svg);
    }

    /** Break a list of {x, y|null} into runs of known points. */
    function runs(pts) {
        const out = [];
        let cur = [];
        pts.forEach((p) => {
            if (p.y === null) {
                if (cur.length) out.push(cur);
                cur = [];
            } else cur.push(p);
        });
        if (cur.length) out.push(cur);
        return out;
    }

    const linePath = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + r2(p.x) + ',' + r2(p.y)).join('');

    /**
     * Monotone cubic through the points (the d3 curveMonotoneX algorithm):
     * smooth like Mercury's running-total chart, and it can never overshoot a
     * plateau, so a flat stretch stays flat and the curve never dips below a
     * value it passed through.
     */
    function monoPath(pts) {
        const n = pts.length;
        if (n < 3) return linePath(pts);
        const sgn = (v) => (v < 0 ? -1 : 1);
        const m = new Array(n);
        for (let i = 1; i < n - 1; i++) {
            const h0 = pts[i].x - pts[i - 1].x;
            const h1 = pts[i + 1].x - pts[i].x;
            const s0 = (pts[i].y - pts[i - 1].y) / (h0 || 1e-9);
            const s1 = (pts[i + 1].y - pts[i].y) / (h1 || 1e-9);
            const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1e-9);
            m[i] = (sgn(s0) + sgn(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
        }
        const end = (a, b, t) => {
            const hh = b.x - a.x;
            return hh ? (3 * (b.y - a.y)) / hh / 2 - t / 2 : t;
        };
        m[0] = end(pts[0], pts[1], m[1]);
        m[n - 1] = end(pts[n - 2], pts[n - 1], m[n - 2]);
        let d = 'M' + r2(pts[0].x) + ',' + r2(pts[0].y);
        for (let i = 0; i < n - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const dx = (b.x - a.x) / 3;
            d += 'C' + r2(a.x + dx) + ',' + r2(a.y + dx * m[i]) + ' ';
            d += r2(b.x - dx) + ',' + r2(b.y - dx * m[i + 1]) + ' ' + r2(b.x) + ',' + r2(b.y);
        }
        return d;
    }

    /**
     * A visually hidden table of every value the chart draws.
     * ⛔ It sits in a clipping DIV, never carries the clip itself: a table is
     * not a block container, so `overflow: hidden` and `width: 1px` do not
     * apply to it, and its nowrap caption laid out 1,200px wide and ran past
     * the viewport (a horizontal scrollbar on the page, caught by eye).
     */
    function srTable(root, caption, head, rows) {
        const wrap = h('div', 'fin-chart__sr');
        const t = h('table', 'fin-chart__sr-table', null, wrap);
        h('caption', null, caption, t);
        const thead = h('thead', null, null, t);
        const tr = h('tr', null, null, thead);
        head.forEach((c) => {
            const th = h('th', null, c, tr);
            th.setAttribute('scope', 'col');
        });
        const tb = h('tbody', null, null, t);
        rows.forEach((r) => {
            const row = h('tr', null, null, tb);
            r.forEach((c, i) => {
                const cell = h(i ? 'td' : 'th', null, c, row);
                if (!i) cell.setAttribute('scope', 'row');
            });
        });
        root.appendChild(wrap);
        return t;
    }

    /** A legend of toggles (overview.md 3.4): a square swatch and a label. */
    function legend(root, items, hidden, onToggle) {
        const lg = h('div', 'fin-legend');
        items.forEach((it) => {
            const b = h('button', 'fin-legend__item' + (hidden[it.key] ? ' is-muted' : ''), null, lg);
            b.type = 'button';
            b.setAttribute('data-key', it.key);
            h('span', 'fin-legend__sw fin-bg-' + it.tone + (it.dashed ? ' fin-legend__sw--dash' : ''), null, b);
            h('span', 'fin-legend__t', it.label, b);
            if (onToggle) {
                b.setAttribute('aria-pressed', hidden[it.key] ? 'false' : 'true');
                b.addEventListener('click', () => onToggle(it.key));
            } else {
                b.disabled = true;
            }
        });
        root.appendChild(lg);
        return lg;
    }

    /* ── the two states that draw no chart ──────────────────────────────── */

    const FAILED_TEXT = 'Could not load these figures, so no chart is drawn.';

    function drawLoading(root, height, label) {
        root.setAttribute('aria-busy', 'true');
        const box = h('div', 'fin-chart__skel', null, root);
        box.style.height = height + 'px';
        h('span', 'fin-chart__sr', label || 'Loading chart', box);
        return null;
    }

    /* onRetry (optional): the failed read's way back, drawn INSIDE the plate,
       under the sentence, so a failed chart looks like every other failed box
       on the page (one outlined Try again, in the box that failed). */
    function drawFailed(root, height, text, onRetry) {
        const box = h('div', 'fin-chart__plate', null, root);
        box.style.height = height + 'px';
        h('p', 'fin-chart__msg', text || FAILED_TEXT, box);
        if (typeof onRetry === 'function') {
            const b = h('button', 'fin-chart__retry', 'Try again', box);
            b.type = 'button';
            b.addEventListener('click', () => onRetry());
        }
        return null;
    }

    /**
     * CSS text-overflow cuts a name at the last glyph that fits, spaces
     * included, so a bar's label read "Register …" and "Oakline …". This
     * cuts it the same way and then drops the trailing space, as Mercury's
     * "Ventur…" does. The full name stays on the title. Needs layout: in a
     * document with no layout (tests) nothing overflows and nothing changes.
     */
    function fitNames(root) {
        const names = root.querySelectorAll('.fin-chart__x--cat, .fin-sankey__name');
        Array.prototype.forEach.call(names, (e) => {
            const full = e.textContent || '';
            if (!full || !(e.clientWidth > 0) || e.scrollWidth <= e.clientWidth) return;
            let lo = 0;
            let hi = full.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                e.textContent = full.slice(0, mid).trimEnd() + '\u2026';
                if (e.scrollWidth <= e.clientWidth) lo = mid;
                else hi = mid - 1;
            }
            e.textContent = full.slice(0, lo).trimEnd() + '\u2026';
        });
    }

    /**
     * The read answered, but not ONE value in it is known (money in with no
     * register feed: every bucket null). That is not a quiet period, so it
     * must not draw the zero line a quiet period draws: the same plate as a
     * failure, with the reason (the design doc: null renders as "-" with the
     * reason, never $0). data-state="unavailable".
     */
    const UNKNOWN_TEXT = 'These figures are not available for this period.';

    function drawUnknown(root, st, ctx) {
        const box = h('div', 'fin-chart__plate fin-chart__plate--unknown', null, root);
        box.style.height = ctx.h + 'px';
        h('p', 'fin-chart__msg', st.reason ? String(st.reason) : UNKNOWN_TEXT, box);
        return { unavailable: true };
    }

    /* ── the tooltip, portalled to <body> ───────────────────────────────── */

    function makeTip() {
        const el = document.createElement('div');
        el.className = 'fin-tip';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
        return {
            el: el,
            /** Beside the mark: right of `cx`, or flipped to the left of `lx`
             *  (the mark's far edge) when the right side would leave the screen. */
            show(model, cx, cy, lx) {
                el.replaceChildren();
                if (model.head) h('div', 'fin-tip__head', model.head, el);
                (model.rows || []).forEach((r) => {
                    if (r.divider) {
                        h('div', 'fin-tip__div', null, el);
                        return;
                    }
                    const row = h('div', 'fin-tip__row' + (r.strong ? ' is-strong' : ''), null, el);
                    if (r.tone)
                        h('span', 'fin-tip__k fin-bg-' + r.tone + (r.dashed ? ' fin-tip__k--dash' : ''), null, row);
                    h('span', 'fin-tip__l', r.label, row);
                    h('span', 'fin-tip__v', r.value, row);
                });
                if (model.note) h('div', 'fin-tip__note', model.note, el);
                el.classList.add('is-on');
                const w = el.offsetWidth || 0;
                const hh = el.offsetHeight || 0;
                const vw = window.innerWidth || 0;
                const vh = window.innerHeight || 0;
                let left = cx + 14;
                if (vw && left + w + 8 > vw) left = (lx === undefined ? cx : lx) - 14 - w;
                let top = cy - hh / 2;
                if (vh) top = Math.max(8, Math.min(top, vh - hh - 8));
                el.style.left = Math.round(Math.max(8, left)) + 'px';
                el.style.top = Math.round(top) + 'px';
            },
            hide() {
                el.classList.remove('is-on');
                el.replaceChildren();
            },
            destroy() {
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        };
    }

    /* ── the factory every chart goes through ───────────────────────────── */

    function measure(el, fallback) {
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        const w = Math.floor((r && r.width) || el.clientWidth || 0);
        return w > 0 ? w : fallback;
    }

    function mount(kind, spec) {
        return function factory(el, data) {
            if (!el || typeof el.appendChild !== 'function') {
                if (window.console && console.warn) console.warn('[FinCharts] ' + kind + ': no element to draw into.');
                return null;
            }
            if (el.__finChart) el.__finChart.destroy();

            const uid = 'fin-' + kind + '-' + ++seq;
            let st = Object.assign({}, data || {});
            let dead = false;
            let lastW = 0;
            let view = null;
            let active = -1;
            let raf = 0;
            const memo = { hidden: {} };
            const tip = makeTip();

            function hide() {
                active = -1;
                tip.hide();
                if (view && view.clear) view.clear();
            }

            function show(i) {
                if (!view || !view.focus || i < 0 || i >= view.count) return;
                if (i === active) return;
                active = i;
                const f = view.focus(i);
                const box = view.svg.getBoundingClientRect();
                tip.show(f.model, box.left + f.x, box.top + f.y, f.lx === undefined ? undefined : box.left + f.lx);
            }

            function onMove(e) {
                const hit = e.target && e.target.closest ? e.target.closest('[data-hit]') : null;
                if (!hit) {
                    hide();
                    return;
                }
                show(Number(hit.getAttribute('data-hit')));
            }

            function onKey(e) {
                const last = view.count - 1;
                let i;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = active < 0 ? 0 : Math.min(last, active + 1);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = active < 0 ? last : Math.max(0, active - 1);
                else if (e.key === 'Home') i = 0;
                else if (e.key === 'End') i = last;
                else if (e.key === 'Escape') {
                    hide();
                    return;
                } else return;
                e.preventDefault();
                show(i);
            }

            function draw() {
                if (dead) return;
                const hadFocus = !!(view && view.svg && view.svg === document.activeElement);
                const wasAt = active;
                hide();
                const w = measure(el, spec.width);
                lastW = w;
                const root = h('div', 'fin-chart fin-chart--' + kind);
                const height = Number(st.height) > 0 ? Number(st.height) : spec.height;
                const state = st.state;
                root.setAttribute('data-state', state === 'loading' || state === 'failed' ? state : 'ready');
                if (state === 'loading') view = drawLoading(root, height, st.loadingText);
                else if (state === 'failed') view = drawFailed(root, height, st.failedText, st.onRetry);
                else view = spec.draw(root, st, { w: w, h: height, uid: uid, memo: memo, redraw: draw });
                if (view && view.empty) root.setAttribute('data-state', 'empty');
                if (view && view.unavailable) root.setAttribute('data-state', 'unavailable');
                el.replaceChildren(root);
                fitNames(root);
                if (!view || !view.svg) return;
                const svg = view.svg;
                svg.setAttribute('tabindex', '0');
                svg.addEventListener('pointermove', onMove);
                svg.addEventListener('pointerleave', hide);
                svg.addEventListener('blur', hide);
                svg.addEventListener('focus', () => {
                    if (active < 0) show(0);
                });
                svg.addEventListener('keydown', onKey);
                if (hadFocus && svg.isConnected) {
                    if (wasAt >= 0 && wasAt < view.count) show(wasAt);
                    svg.focus();
                }
            }

            let ro = null;
            if (typeof window.ResizeObserver === 'function') {
                ro = new window.ResizeObserver(() => {
                    if (dead || raf) return;
                    if (Math.abs(measure(el, spec.width) - lastW) < 1) return;
                    const go = () => {
                        raf = 0;
                        draw();
                    };
                    if (window.requestAnimationFrame) raf = window.requestAnimationFrame(go);
                    else go();
                });
                ro.observe(el);
            }

            draw();

            const api = {
                update(next) {
                    if (dead) return false;
                    const n = next || {};
                    st = Object.assign({}, st, n);
                    if (!Object.prototype.hasOwnProperty.call(n, 'state')) delete st.state;
                    draw();
                    return true;
                },
                destroy() {
                    if (dead) return;
                    dead = true;
                    if (ro) ro.disconnect();
                    if (raf && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
                    tip.destroy();
                    el.replaceChildren();
                    if (el.__finChart === api) delete el.__finChart;
                    view = null;
                }
            };
            el.__finChart = api;
            return api;
        };
    }

    /** Light the marks of one bucket; the CSS dims the rest. */
    function light(root, i) {
        root.classList.toggle('is-hovering', i >= 0);
        root.querySelectorAll('.is-on').forEach((n) => n.classList.remove('is-on'));
        if (i < 0) return;
        root.querySelectorAll('[data-i="' + i + '"]').forEach((n) => n.classList.add('is-on'));
    }

    /** Hit targets: the whole column, never the painted pixels. */
    function hits(svg, n, xAt, width, top, bottom) {
        for (let i = 0; i < n; i++) {
            s(
                'rect',
                {
                    class: 'fin-chart__hit',
                    'data-hit': i,
                    x: r2(xAt(i) - width / 2),
                    y: r2(top),
                    width: r2(Math.max(1, width)),
                    height: r2(Math.max(1, bottom - top))
                },
                svg
            );
        }
    }

    function frame(root, w, hgt) {
        const wrap = h('div', 'fin-chart__plot', null, root);
        wrap.style.height = hgt + 'px';
        const svg = s('svg', {
            class: 'fin-chart__svg',
            width: w,
            height: hgt,
            viewBox: '0 0 ' + w + ' ' + hgt,
            role: 'img'
        });
        wrap.appendChild(svg);
        const defs = s('defs', null, svg);
        const labels = h('div', 'fin-chart__labels', null, wrap);
        labels.setAttribute('aria-hidden', 'true');
        return { wrap: wrap, svg: svg, defs: defs, labels: labels };
    }

    /**
     * The quiet-period sentence. `top` is where its centre goes, chosen by
     * each chart so it never sits on the zero line it is explaining (in
     * all-cashflow mode that line runs through the middle of the plot).
     */
    function emptyNote(root, text, top) {
        if (!text) return;
        const n = h('p', 'fin-chart__note', text, root);
        if (top !== undefined) n.style.top = r2(top) + 'px';
    }

    /** Centre of the empty sentence: the upper half's middle when zero is
     *  mid-plot, the plot's middle when zero is the bottom edge. */
    const noteTop = (box, zeroY) => (zeroY < box.b - 1 ? box.t + (zeroY - box.t) / 2 : box.t + (box.b - box.t) / 2);

    function periodSpan(labels) {
        const n = labels.length;
        if (!n) return ', no periods';
        return ', ' + n + (n === 1 ? ' period, ' + labels[0] : ' periods from ' + labels[0] + ' to ' + labels[n - 1]);
    }

    /* =====================================================================
     * overview: bars + net line (all cashflow), or one direction with an
     * average line. overview.md 3.3, moneyout.md 3.2, moneyin.md 3.3.
     * ===================================================================== */

    function drawOverview(root, st, ctx) {
        const F = Fm();
        const dir = st.direction === 'in' || st.direction === 'out' ? st.direction : 'all';
        const buckets = list(st.buckets);
        const n = buckets.length;
        const W = ctx.w;
        const H = ctx.h;
        const cmp = st.compare && typeof st.compare === 'object' ? list(st.compare.buckets) : [];
        const hasCmp = cmp.length > 0;
        const cmpLabel = hasCmp && st.compare.label ? String(st.compare.label) : 'Previous period';
        const legendH = hasCmp ? 28 : 0;
        // One direction sits 6px lower at the top and 2px at the baseline than
        // all cashflow (moneyin/moneyout captures: ticks 431..853 vs 425..851);
        // the month labels stay put.
        const one = dir !== 'all';
        const box = { l: 60, r: W, t: one ? 14 : 8, b: H - (one ? 28 : 30) - legendH };
        const plotW = box.r - box.l;
        const plotH = box.b - box.t;
        const neg = (v) => (v === null ? null : -v);

        // Money out is a magnitude that can go NEGATIVE: vendor credits beat
        // the spending in that bucket. The sign is kept. Math.abs here once
        // drew a credit as spending and took it OFF the net instead of adding
        // it to the net.
        const rows = buckets.map((b, i) => {
            const mi = val(b.moneyIn);
            const mo = val(b.moneyOut);
            return {
                i: i,
                label: bucketLabel(b),
                mi: mi,
                mo: mo,
                net: mi === null || mo === null ? null : mi - mo,
                note: b.note ? String(b.note) : null
            };
        });
        const pick = (mi, mo) => (dir === 'in' ? mi : dir === 'out' ? mo : mi === null || mo === null ? null : mi - mo);
        const prim = rows.map((r) => pick(r.mi, r.mo));
        // Not one figure of THIS period is known: say so, draw no zero.
        const knownAny = rows.some((r) =>
            dir === 'in' ? r.mi !== null : dir === 'out' ? r.mo !== null : r.mi !== null || r.mo !== null
        );
        if (n && !knownAny) return drawUnknown(root, st, ctx);
        const cmpVals = rows.map((r, i) => {
            const c = cmp[i];
            if (!c) return null;
            return pick(val(c.moneyIn), val(c.moneyOut));
        });

        let avg = null;
        if (dir !== 'all') {
            if (st.average === undefined) {
                const known = prim.filter((v) => v !== null);
                avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
            } else avg = val(st.average);
        }
        // One direction draws up from a baseline at the bottom, UNLESS a value
        // runs the other way (refunds beat sales, credits beat spending). Then
        // the axis is two-sided like all cashflow, and that bar sits below
        // zero instead of down among the month labels.
        const two =
            dir === 'all' ||
            prim
                .concat(cmpVals)
                .concat([avg])
                .some((v) => v !== null && v < 0);

        let max = 0;
        const bump = (v) => {
            if (v !== null && Math.abs(v) > max) max = Math.abs(v);
        };
        rows.forEach((r) => {
            if (dir === 'all') {
                bump(r.mi);
                bump(r.mo);
                bump(r.net);
            } else bump(dir === 'in' ? r.mi : r.mo);
        });
        cmpVals.forEach(bump);
        if (avg !== null) bump(avg);
        const sc = scaleFor(max, two);
        const empty = !sc;

        const f = frame(root, W, H - legendH);
        const svg = f.svg;
        const zeroY = two ? box.t + plotH / 2 : box.b;
        const y = (v) => (!sc ? zeroY : two ? zeroY - (v / sc.top) * (plotH / 2) : box.b - (v / sc.top) * plotH);
        const tickGap = sc ? (two ? plotH / 2 / sc.n : plotH / sc.n) : two ? plotH / 8 : plotH / 5;

        dotField(svg, f.defs, ctx.uid, box, zeroY, tickGap);

        // Axis labels. A tick the average pill would sit on is dropped
        // (moneyin.md 3.3: "$500K" is not shown under "$477K avg.").
        const avgY = avg !== null && sc ? y(avg) : null;
        if (sc) {
            for (let k = two ? -sc.n : 0; k <= sc.n; k++) {
                const t = k * sc.step;
                // 22px = half the 24px pill + half a 20px label: any closer
                // and they overlap (Mercury keeps -$200K 23px under its pill).
                if (avgY !== null && Math.abs(y(t) - avgY) < 22) continue;
                yLabel(f.labels, F.axis(dir === 'out' ? -t : t), y(t));
            }
        } else yLabel(f.labels, '0', zeroY);

        hLine(svg, 'fin-chart__zero', box.l, box.r, zeroY);

        const gIn = ctx.uid + '-gin';
        const gOutUp = ctx.uid + '-goutup';
        const gOutDown = ctx.uid + '-goutdn';
        // Strong at the bar's END, faint at the baseline, both directions:
        // sampled off overview-btn7 (in 218 at the top, 245 by zero; out 248
        // by zero, 236 at the bottom).
        gradient(f.defs, gIn, true, [
            [0, 'fin-stop fin-stop--revenue-a'],
            [1, 'fin-stop fin-stop--revenue-b']
        ]);
        // A money-in bar BELOW zero (refunds beat sales): strong at its end.
        const gInDown = ctx.uid + '-gindn';
        gradient(f.defs, gInDown, true, [
            [0, 'fin-stop fin-stop--revenue-b'],
            [1, 'fin-stop fin-stop--revenue-a']
        ]);
        gradient(f.defs, gOutUp, true, [
            [0, 'fin-stop fin-stop--spend-a'],
            [1, 'fin-stop fin-stop--spend-b']
        ]);
        gradient(f.defs, gOutDown, true, [
            [0, 'fin-stop fin-stop--spend-b'],
            [1, 'fin-stop fin-stop--spend-a']
        ]);

        const bd = band(box.l, plotW, n, st.layout === 'full');
        const bw = bd.barW;
        // Past ~90 days a dot per bucket is a smear; they show on hover only.
        const dense = bd.pitch < 12 ? ' fin-pt--dense' : '';
        const bars = s('g', { class: 'fin-chart__bars' }, svg);

        function bar(i, top, bottom, grad, capY, tone) {
            const x = bd.cx(i) - bw / 2;
            if (bottom - top >= 0.5) {
                s(
                    'rect',
                    {
                        class: 'fin-bar fin-bar--' + tone + ' fin-mark',
                        'data-i': i,
                        x: r2(x),
                        y: r2(top),
                        width: r2(bw),
                        height: r2(bottom - top),
                        fill: 'url(#' + grad + ')'
                    },
                    bars
                );
            }
            s(
                'line',
                {
                    class: 'fin-cap fin-stroke-' + tone + ' fin-mark',
                    'data-i': i,
                    x1: r2(x),
                    x2: r2(x + bw),
                    y1: r2(capY),
                    y2: r2(capY)
                },
                bars
            );
        }

        rows.forEach((r) => {
            if (dir === 'all') {
                // Mercury draws nothing for a zero bar here; the net point on
                // the baseline carries the measured zero.
                if (r.mi !== null && r.mi > 0) bar(r.i, y(r.mi), zeroY, gIn, y(r.mi), 'revenue');
                if (r.mo !== null && r.mo > 0) bar(r.i, zeroY, y(-r.mo), gOutDown, y(-r.mo), 'spend');
            } else {
                const v = dir === 'in' ? r.mi : r.mo;
                // A KNOWN zero keeps its cap on the baseline; an unknown value
                // draws nothing. That is the difference between a quiet month
                // and a month nobody could read, made visible. A value that
                // runs the other way hangs below zero (the axis is two-sided).
                if (v !== null) {
                    const up = v >= 0;
                    const grad = dir === 'in' ? (up ? gIn : gInDown) : up ? gOutUp : gOutDown;
                    bar(r.i, up ? y(v) : zeroY, up ? zeroY : y(v), grad, y(v), dir === 'in' ? 'revenue' : 'spend');
                }
            }
        });

        // Net cashflow: green above zero, spend-red below, split by clipping.
        if (dir === 'all' && n) {
            const cPos = ctx.uid + '-cpos';
            const cNeg = ctx.uid + '-cneg';
            s('rect', { x: 0, y: 0, width: W, height: r2(zeroY) }, s('clipPath', { id: cPos }, f.defs));
            s('rect', { x: 0, y: r2(zeroY), width: W, height: r2(H - zeroY) }, s('clipPath', { id: cNeg }, f.defs));
            gradient(
                f.defs,
                ctx.uid + '-apos',
                true,
                [
                    [0, 'fin-stop fin-stop--net-pos-a'],
                    [1, 'fin-stop fin-stop--net-pos-b']
                ],
                { x1: 0, x2: 0, y1: r2(box.t), y2: r2(zeroY) }
            );
            gradient(
                f.defs,
                ctx.uid + '-aneg',
                true,
                [
                    [0, 'fin-stop fin-stop--net-neg-b'],
                    [1, 'fin-stop fin-stop--net-neg-a']
                ],
                { x1: 0, x2: 0, y1: r2(zeroY), y2: r2(box.b) }
            );
            const pts = rows.map((r) => ({ x: bd.cx(r.i), y: r.net === null ? null : y(r.net), i: r.i, v: r.net }));
            const netG = s('g', { class: 'fin-net' }, svg);
            runs(pts).forEach((run) => {
                if (run.length < 2) return;
                const d = linePath(run);
                if (empty) {
                    // Every net is zero: a real zero line, in the neutral ink,
                    // rather than a line split down its middle by the clips.
                    s('path', { class: 'fin-netline fin-stroke-volume', d: d }, netG);
                    return;
                }
                const area =
                    d + 'L' + r2(run[run.length - 1].x) + ',' + r2(zeroY) + 'L' + r2(run[0].x) + ',' + r2(zeroY) + 'Z';
                s(
                    'path',
                    {
                        class: 'fin-area',
                        d: area,
                        fill: 'url(#' + ctx.uid + '-apos)',
                        'clip-path': 'url(#' + cPos + ')'
                    },
                    netG
                );
                s(
                    'path',
                    {
                        class: 'fin-area',
                        d: area,
                        fill: 'url(#' + ctx.uid + '-aneg)',
                        'clip-path': 'url(#' + cNeg + ')'
                    },
                    netG
                );
                s('path', { class: 'fin-netline fin-stroke-revenue', d: d, 'clip-path': 'url(#' + cPos + ')' }, netG);
                s('path', { class: 'fin-netline fin-stroke-spend', d: d, 'clip-path': 'url(#' + cNeg + ')' }, netG);
            });
            pts.forEach((p) => {
                if (p.y === null) return;
                const tone = p.v < 0 ? 'spend' : p.v > 0 ? 'revenue' : 'volume';
                s(
                    'circle',
                    {
                        class: 'fin-pt fin-mark fin-fill-' + tone + dense,
                        'data-i': p.i,
                        cx: r2(p.x),
                        cy: r2(p.y),
                        r: 3
                    },
                    netG
                );
            });
        }

        // The previous period, dashed, so identity is never colour alone.
        if (hasCmp) {
            const cpts = cmpVals.map((v, i) => ({ x: bd.cx(i), y: v === null ? null : y(v) }));
            runs(cpts).forEach((run) => {
                if (run.length > 1) s('path', { class: 'fin-cmp', d: linePath(run) }, svg);
                else s('circle', { class: 'fin-cmp-pt', cx: r2(run[0].x), cy: r2(run[0].y), r: 2.5 }, svg);
            });
        }

        // The average line and its pill (single direction only).
        if (avgY !== null) {
            hLine(svg, 'fin-avg', box.l, box.r, avgY);
            const pill = h('span', 'fin-avg-pill', F.compact(dir === 'out' ? -avg : avg) + ' avg.', f.labels);
            pill.style.top = r2(avgY) + 'px';
        }

        const cross = s('line', { class: 'fin-chart__cross', x1: 0, x2: 0, y1: r2(box.t), y2: r2(box.b) }, svg);

        const sx = stride(
            n,
            plotW,
            rows.map((r) => r.label)
        );
        rows.forEach((r) => {
            if (r.i % sx === 0) xLabel(f.labels, r.label, bd.cx(r.i), H - legendH - 10, r.i);
        });

        hits(svg, n, bd.cx, bd.pitch, 0, box.b + 8);

        // A leading run with no figure at all (before the register reported
        // and before the first booked expense): the slots stay empty and a
        // quiet line over them says why, so the gap reads as "no records",
        // not as a chart that failed to draw.
        if (st.leadNote === true && n > 1) {
            const blank = (r) =>
                dir === 'in' ? r.mi === null : dir === 'out' ? r.mo === null : r.mi === null && r.mo === null;
            let lead = 0;
            while (lead < n && blank(rows[lead])) lead += 1;
            if (lead >= 2 && lead < n) {
                const note = h('p', 'fin-chart__lead', 'No records before ' + rows[lead].label, f.labels);
                const left = bd.cx(0) - bd.pitch / 2;
                const right = bd.cx(lead - 1) + bd.pitch / 2;
                note.style.left = r2((left + right) / 2) + 'px';
                note.style.maxWidth = r2(Math.max(80, right - left - 8)) + 'px';
                note.style.top = r2(noteTop(box, zeroY)) + 'px';
            }
        }

        if (hasCmp) {
            legend(
                root,
                [
                    { key: 'now', label: 'This period', tone: dir === 'out' ? 'spend' : 'revenue' },
                    { key: 'cmp', label: cmpLabel, tone: 'volume', dashed: true }
                ],
                {},
                null
            );
        }

        // Words. The period's totals are the READ's own when the view hands
        // them over: a sum over the buckets is "not known" as soon as one
        // bucket is (a register feed that starts mid-period), while the read's
        // total counts the days it has. Told "Money in -" beside a KPI that
        // prints $3.2M, a screen-reader user is told something false.
        const given = st.totals && typeof st.totals === 'object' ? st.totals : null;
        const fromRead = (k) => (given && k in given ? { v: val(given[k]), read: true } : null);
        const known = (arr) => {
            let t = 0;
            let k = 0;
            arr.forEach((v) => {
                if (v === null) return;
                t += v;
                k += 1;
            });
            return { v: k ? t : null, gaps: arr.length - k };
        };
        const inT = fromRead('moneyIn') || known(rows.map((r) => r.mi));
        const outT = fromRead('moneyOut') || known(rows.map((r) => r.mo));
        const netT =
            fromRead('net') ||
            (inT.v === null || outT.v === null
                ? { v: null }
                : { v: inT.v - outT.v, gaps: Math.max(inT.gaps || 0, outT.gaps || 0) });
        const gapNote = (t, what) =>
            t.gaps ? ' (' + what + ' is not known for ' + t.gaps + ' of ' + n + ' periods)' : '';
        const span = periodSpan(rows.map((r) => r.label));
        let label;
        if (dir === 'all') {
            label =
                'Cashflow chart' +
                span +
                '. Revenue ' +
                F.money(inT.v) +
                gapNote(inT, 'revenue') +
                ', expenses ' +
                F.money(neg(outT.v)) +
                gapNote(outT, 'expenses') +
                ', net ' +
                F.money(netT.v) +
                '.';
        } else if (dir === 'in') {
            label =
                'Revenue chart' +
                span +
                '. Total ' +
                F.money(inT.v) +
                gapNote(inT, 'revenue') +
                (avg !== null ? ', average ' + F.money(avg) : '') +
                '.';
        } else {
            label =
                'Expenses chart' +
                span +
                '. Total ' +
                F.money(neg(outT.v)) +
                gapNote(outT, 'expenses') +
                (avg !== null ? ', average ' + F.money(-avg) : '') +
                '.';
        }
        if (empty) label += ' Every period is zero.';
        svg.setAttribute('aria-label', label);

        const head =
            dir === 'all'
                ? ['Period', 'Revenue', 'Expenses', 'Net']
                : ['Period', dir === 'in' ? 'Revenue' : 'Expenses'];
        if (hasCmp) head.push(cmpLabel);
        srTable(
            root,
            label,
            head,
            rows.map((r, i) => {
                const cells =
                    dir === 'all'
                        ? [r.label, F.moneyCents(r.mi), F.moneyCents(neg(r.mo)), F.moneyCents(r.net)]
                        : [r.label, F.moneyCents(dir === 'in' ? r.mi : neg(r.mo))];
                if (hasCmp) cells.push(F.moneyCents(dir === 'out' ? neg(cmpVals[i]) : cmpVals[i]));
                return cells;
            })
        );
        if (empty)
            emptyNote(
                root,
                st.emptyText || (st.state === 'empty' ? 'Nothing came in or went out in this period.' : ''),
                noteTop(box, zeroY)
            );

        return {
            svg: svg,
            count: n,
            empty: empty,
            clear() {
                light(root, -1);
                cross.classList.remove('is-on');
            },
            focus(i) {
                const r = rows[i];
                light(root, i);
                cross.setAttribute('x1', px(bd.cx(i)));
                cross.setAttribute('x2', px(bd.cx(i)));
                cross.classList.add('is-on');
                const model = { rows: [] };
                if (dir === 'all') {
                    model.rows.push({ label: 'Revenue', value: F.moneyCents(r.mi) });
                    model.rows.push({ label: 'Expenses', value: F.moneyCents(neg(r.mo)) });
                    model.rows.push({ divider: true });
                    model.rows.push({ label: r.label + ' net', value: F.moneyCents(r.net), strong: true });
                } else {
                    model.rows.push({
                        label: r.label + (dir === 'in' ? ' revenue' : ' expenses'),
                        value: F.moneyCents(dir === 'in' ? r.mi : neg(r.mo)),
                        strong: true
                    });
                }
                if (hasCmp) {
                    model.rows.push({
                        label: cmpLabel,
                        value: F.moneyCents(dir === 'out' ? neg(cmpVals[i]) : cmpVals[i]),
                        tone: 'volume',
                        dashed: true
                    });
                }
                // A bucket's own caveat (money out before the ledger began)
                // wins; otherwise the read's reason money in is not known.
                const why = r.note || ((r.mi === null || r.mo === null) && st.reason ? String(st.reason) : null);
                if (why) model.note = why;
                const v = dir === 'all' ? r.net : dir === 'in' ? r.mi : r.mo;
                return { model: model, x: bd.cx(i) + bw / 2, lx: bd.cx(i) - bw / 2, y: v === null ? zeroY : y(v) };
            }
        };
    }

    /* =====================================================================
     * line: one polyline per series with a dot at each bucket, and a legend
     * of toggles. overview.md 3.4, moneyout.md 3.3, moneyin.md 3.4.
     * A known zero is drawn ON the zero line (Mercury skips leading zeros;
     * a quiet month is a measured zero here). A null is a break.
     * ===================================================================== */

    function drawLine(root, st, ctx) {
        const F = Fm();
        const buckets = list(st.buckets);
        const n = buckets.length;
        const all = list(st.series).map((sr, k) => ({
            key: String(sr.key !== undefined ? sr.key : 's' + k),
            label: String(sr.label !== undefined ? sr.label : ''),
            tone: toneOf(sr.tone),
            values: Array.from({ length: n }, (_, i) => {
                const v = Array.isArray(sr.values) ? val(sr.values[i]) : null;
                // negate flips a money-out magnitude to a flow. -Math.abs()
                // here drew a credit (a NEGATIVE magnitude) as spending.
                return v === null ? null : sr.negate ? -v : v;
            })
        }));
        // Judged on every series, hidden or not: hiding one is not unknowing it.
        if (n && !all.some((sr) => sr.values.some((v) => v !== null))) return drawUnknown(root, st, ctx);
        const hidden = ctx.memo.hidden;
        const shown = all.filter((sr) => !hidden[sr.key]);
        let dir = st.direction;
        if (dir !== 'all' && dir !== 'in' && dir !== 'out') {
            dir = all.some((sr) => sr.values.some((v) => v !== null && v < 0)) ? 'all' : 'in';
        }
        // A value that runs the other way (refunds beat sales, credits beat
        // spending) makes a one-direction axis two-sided, so it is drawn below
        // zero rather than folded up onto the spending side.
        const two = dir === 'all' || shown.some((sr) => sr.values.some((v) => v !== null && v < 0));

        const W = ctx.w;
        const H = ctx.h;
        const legendH = 28;
        const box = { l: 60, r: W, t: 8, b: H - 30 - legendH };
        const plotW = box.r - box.l;
        const plotH = box.b - box.t;

        let max = 0;
        shown.forEach((sr) =>
            sr.values.forEach((v) => {
                if (v !== null && Math.abs(v) > max) max = Math.abs(v);
            })
        );
        const sc = scaleFor(max, two);
        const empty = !all.some((sr) => sr.values.some((v) => v !== null && v !== 0));

        const f = frame(root, W, H - legendH);
        const svg = f.svg;
        const zeroY = two ? box.t + plotH / 2 : box.b;
        const y = (v) => (!sc ? zeroY : two ? zeroY - (v / sc.top) * (plotH / 2) : box.b - (v / sc.top) * plotH);
        const tickGap = sc ? (two ? plotH / 2 / sc.n : plotH / sc.n) : plotH / 8;

        dotField(svg, f.defs, ctx.uid, box, zeroY, tickGap);
        if (sc) {
            for (let k = two ? -sc.n : 0; k <= sc.n; k++) {
                const t = k * sc.step;
                yLabel(f.labels, F.axis(dir === 'out' ? -t : t), y(t));
            }
        } else yLabel(f.labels, '0', zeroY);
        hLine(svg, 'fin-chart__zero', box.l, box.r, zeroY);

        const bd = band(box.l, plotW, n);
        const dense = bd.pitch < 12 ? ' fin-pt--dense' : '';
        const cross = s('line', { class: 'fin-chart__cross', x1: 0, x2: 0, y1: r2(box.t), y2: r2(box.b) }, svg);
        const lines = s('g', { class: 'fin-chart__lines' }, svg);
        shown.forEach((sr) => {
            const pts = sr.values.map((v, i) => ({ x: bd.cx(i), y: v === null ? null : y(v) }));
            runs(pts).forEach((run) => {
                if (run.length > 1)
                    s('path', { class: 'fin-line fin-stroke-' + sr.tone, 'data-key': sr.key, d: linePath(run) }, lines);
            });
            pts.forEach((p, i) => {
                if (p.y === null) return;
                s(
                    'circle',
                    {
                        class: 'fin-dot fin-mark fin-fill-' + sr.tone + dense,
                        'data-i': i,
                        'data-key': sr.key,
                        cx: r2(p.x),
                        cy: r2(p.y),
                        r: 3
                    },
                    lines
                );
            });
        });

        const sx = stride(n, plotW, buckets.map(bucketLabel));
        buckets.forEach((b, i) => {
            if (i % sx === 0) xLabel(f.labels, bucketLabel(b), bd.cx(i), box.b + 19, i);
        });
        hits(svg, n, bd.cx, bd.pitch, 0, box.b + 8);

        legend(root, all, hidden, (key) => {
            hidden[key] = !hidden[key];
            ctx.redraw();
        });

        const show = (v) => F.moneyCents(v === null ? null : dir === 'out' ? -v : v);
        const label =
            'Line chart of ' +
            all.map((sr) => sr.label).join(' and ') +
            periodSpan(buckets.map(bucketLabel)) +
            '.' +
            (empty ? ' Every value is zero.' : '');
        svg.setAttribute('aria-label', label);
        srTable(
            root,
            label,
            ['Period'].concat(all.map((sr) => sr.label)),
            buckets.map((b, i) => [bucketLabel(b)].concat(all.map((sr) => show(sr.values[i]))))
        );
        if (empty) emptyNote(root, st.emptyText, noteTop(box, zeroY));

        return {
            svg: svg,
            count: n,
            empty: empty,
            clear() {
                light(root, -1);
                cross.classList.remove('is-on');
            },
            focus(i) {
                light(root, i);
                cross.setAttribute('x1', px(bd.cx(i)));
                cross.setAttribute('x2', px(bd.cx(i)));
                cross.classList.add('is-on');
                let yy = zeroY;
                const rows = shown.map((sr) => {
                    const v = sr.values[i];
                    if (v !== null) yy = Math.min(yy, y(v));
                    return { label: sr.label, value: show(v), tone: sr.tone };
                });
                return {
                    model: { head: bucketLabel(buckets[i]), rows: rows },
                    x: bd.cx(i) + 6,
                    lx: bd.cx(i) - 6,
                    y: yy
                };
            }
        };
    }

    /* =====================================================================
     * stacked: one column per bucket stacked by group, top 4 + "Other".
     * overview.md 3.5, moneyout.md 3.4, moneyin.md 3.5.
     * ===================================================================== */

    /**
     * Top 4 named groups take cat-1..4 in the order given; "Other" (and any
     * fifth-or-later group, folded into it) takes cat-5. A hue is never
     * generated or cycled, and it follows the GROUP: hiding one from the
     * legend does not repaint the rest.
     */
    function foldGroups(groups) {
        const out = [];
        const fold = [];
        let other = null;
        groups.forEach((g) => {
            const key = String(g.key);
            const isOther = key === 'other' || String(g.label).toLowerCase() === 'other';
            if (isOther) other = { key: key, label: String(g.label || 'Other') };
            else if (out.length < 4) out.push({ key: key, label: String(g.label !== undefined ? g.label : key) });
            else fold.push(key);
        });
        out.forEach((g, i) => (g.tone = 'cat-' + (i + 1)));
        if (other || fold.length) {
            const o = other || { key: 'other', label: 'Other' };
            o.tone = 'cat-5';
            o.members = (other ? [other.key] : []).concat(fold);
            out.push(o);
        }
        out.forEach((g) => {
            if (!g.members) g.members = [g.key];
        });
        return out;
    }

    function drawStacked(root, st, ctx) {
        const F = Fm();
        const buckets = list(st.buckets);
        const n = buckets.length;
        const groups = foldGroups(list(st.groups));
        const hidden = ctx.memo.hidden;
        const shown = groups.filter((g) => !hidden[g.key]);
        const valueOf = (b, g) => {
            const vs = b && b.values && typeof b.values === 'object' ? b.values : {};
            let t = null;
            g.members.forEach((k) => {
                const v = val(vs[k]);
                if (v !== null) t = (t || 0) + v;
            });
            return t;
        };
        const raw = buckets.map((b) => groups.map((g) => valueOf(b, g)));
        if (n && !raw.some((r) => r.some((v) => v !== null))) return drawUnknown(root, st, ctx);
        let dir = st.direction;
        if (dir !== 'all' && dir !== 'in' && dir !== 'out') {
            dir = raw.some((r) => r.some((v) => v !== null && v < 0)) ? 'all' : 'in';
        }
        // One direction stacks up from zero, so a group that runs the other
        // way in a bucket (refunds beat sales, credits beat spending) is drawn
        // as nothing there, never folded onto the other side. Math.abs once
        // drew a vendor credit as spending. said() prints the real figure.
        const cell = (i, gi) => {
            const v = raw[i][gi];
            if (v === null) return null;
            return dir === 'out' || dir === 'in' ? Math.max(0, v) : v;
        };

        const W = ctx.w;
        const H = ctx.h;
        const legendH = 28;
        const box = { l: 60, r: W, t: 8, b: H - 30 - legendH };
        const plotW = box.r - box.l;
        const plotH = box.b - box.t;

        let max = 0;
        for (let i = 0; i < n; i++) {
            let up = 0;
            let down = 0;
            groups.forEach((g, gi) => {
                if (hidden[g.key]) return;
                const v = cell(i, gi);
                if (v === null) return;
                if (v >= 0) up += v;
                else down -= v;
            });
            max = Math.max(max, up, down);
        }
        const sc = scaleFor(max, dir === 'all');
        const empty = !raw.some((r) => r.some((v) => v !== null && v !== 0));

        const f = frame(root, W, H - legendH);
        const svg = f.svg;
        const zeroY = dir === 'all' ? box.t + plotH / 2 : box.b;
        const y = (v) =>
            !sc ? zeroY : dir === 'all' ? zeroY - (v / sc.top) * (plotH / 2) : box.b - (v / sc.top) * plotH;
        const tickGap = sc ? (dir === 'all' ? plotH / 2 / sc.n : plotH / sc.n) : plotH / 8;

        dotField(svg, f.defs, ctx.uid, box, zeroY, tickGap);
        if (sc) {
            for (let k = dir === 'all' ? -sc.n : 0; k <= sc.n; k++) {
                const t = k * sc.step;
                yLabel(f.labels, F.axis(dir === 'out' ? -t : t), y(t));
            }
        } else yLabel(f.labels, '0', zeroY);

        const bd = band(box.l, plotW, n);
        const bw = bd.barW;
        const bandsG = s('g', { class: 'fin-chart__bands' }, svg);
        for (let i = 0; i < n; i++) {
            s(
                'rect',
                {
                    class: 'fin-chart__band',
                    'data-i': i,
                    x: r2(bd.cx(i) - bw / 2 - 8),
                    y: r2(box.t),
                    width: r2(bw + 16),
                    height: r2(plotH)
                },
                bandsG
            );
        }
        hLine(svg, 'fin-chart__zero', box.l, box.r, zeroY);

        // Segments stack from the baseline in legend order, a 1px surface gap
        // between them (Mercury's separator; never a stroke round a mark).
        const segs = s('g', { class: 'fin-chart__segs' }, svg);
        for (let i = 0; i < n; i++) {
            let up = 0;
            let down = 0;
            let kUp = 0;
            let kDown = 0;
            groups.forEach((g, gi) => {
                if (hidden[g.key]) return;
                const v = cell(i, gi);
                if (v === null || v === 0) return;
                let top;
                let bot;
                if (v > 0) {
                    top = y(up + v);
                    bot = y(up) - (kUp ? 1 : 0);
                    up += v;
                    kUp += 1;
                } else {
                    top = y(-down) + (kDown ? 1 : 0);
                    bot = y(-down + v);
                    down -= v;
                    kDown += 1;
                }
                if (bot - top < 0.5) return;
                s(
                    'rect',
                    {
                        class: 'fin-seg fin-mark fin-fill-' + g.tone,
                        'data-i': i,
                        'data-key': g.key,
                        x: r2(bd.cx(i) - bw / 2),
                        y: r2(top),
                        width: r2(bw),
                        height: r2(bot - top)
                    },
                    segs
                );
            });
        }

        const sx = stride(n, plotW, buckets.map(bucketLabel));
        buckets.forEach((b, i) => {
            if (i % sx === 0) xLabel(f.labels, bucketLabel(b), bd.cx(i), box.b + 19, i);
        });
        hits(svg, n, bd.cx, bd.pitch, 0, box.b + 8);

        legend(root, groups, hidden, (key) => {
            hidden[key] = !hidden[key];
            ctx.redraw();
        });

        // The PRINTED figure is the real one. cell() clamps a negative to 0
        // in a one-direction stack so it can be drawn; a refund-heavy group
        // must still read negative in the tooltip and the table, and a credit
        // positive, never $0.00.
        const said = (i, gi) => {
            const v = raw[i][gi];
            return v === null ? null : dir === 'out' ? -v : v;
        };
        const label =
            'Stacked bar chart by ' +
            groups.map((g) => g.label).join(', ') +
            periodSpan(buckets.map(bucketLabel)) +
            '.' +
            (empty ? ' Every value is zero.' : '');
        svg.setAttribute('aria-label', label);
        srTable(
            root,
            label,
            ['Period'].concat(groups.map((g) => g.label)),
            buckets.map((b, i) => [bucketLabel(b)].concat(groups.map((g, gi) => F.moneyCents(said(i, gi)))))
        );
        if (empty) emptyNote(root, st.emptyText, noteTop(box, zeroY));

        return {
            svg: svg,
            count: n,
            empty: empty,
            clear() {
                light(root, -1);
            },
            focus(i) {
                light(root, i);
                const rows = shown.map((g) => ({
                    label: g.label,
                    value: F.moneyCents(said(i, groups.indexOf(g))),
                    tone: g.tone
                }));
                const known = shown.map((g) => said(i, groups.indexOf(g))).filter((v) => v !== null);
                rows.push({ divider: true });
                rows.push({
                    label: 'Total',
                    value: F.moneyCents(known.length ? sum(known) : null),
                    strong: true
                });
                return {
                    model: { head: bucketLabel(buckets[i]), rows: rows },
                    x: bd.cx(i) + bw / 2,
                    lx: bd.cx(i) - bw / 2,
                    y: box.t + plotH / 2
                };
            }
        };
    }

    /* =====================================================================
     * sankey, word for word Mercury's (overview.md 3.6, moneyout.md 3.5,
     * moneyin.md 3.6):
     *   direction 'all'  sources -> "Money in" -> "Expenses" -> expense groups.
     *                    Four columns: Mercury's middle stage (its "Expenses",
     *                    beside "Transfers Out", which has no data here) is
     *                    kept. What money in did NOT spend is not drawn as a
     *                    node: it is the part of the Money in bar no ribbon
     *                    leaves, as Mercury shows it. When money out beat
     *                    money in, a "Shortfall" source makes up the rest, so
     *                    the ribbon into Expenses is never wider than what fed
     *                    it.
     *   direction 'in'   sources -> Money in (a terminal on the right)
     *   direction 'out'  Money out (on the left) -> sinks
     * `outTotal` (all) is the period's money out as the cashflow read gives
     * it; the sinks are the breakdown's rows, which fold credits into Other.
     * ===================================================================== */

    function drawSankey(root, st, ctx) {
        const F = Fm();
        const W = ctx.w;
        const H = ctx.h;
        const node = (x, tone) => ({
            label: String(x.label !== undefined ? x.label : ''),
            v: Math.abs(val(x.cents) || 0),
            tone: tone
        });
        const sources = list(st.sources)
            .map((x) => node(x, 'revenue'))
            .filter((x) => x.v > 0);
        const sinks = list(st.sinks)
            .map((x) => node(x, 'spend'))
            .filter((x) => x.v > 0);
        let dir = st.direction;
        if (dir !== 'all' && dir !== 'in' && dir !== 'out') {
            dir = sinks.length && !sources.length ? 'out' : !sinks.length ? 'in' : 'all';
        }
        const srcSum = sources.reduce((a, x) => a + x.v, 0);
        const sinkSum = sinks.reduce((a, x) => a + x.v, 0);
        // `total` left out is worked out from the flows. `total: null` is a
        // figure that is NOT KNOWN (money in with no register feed), and it
        // must never become "Money in $0" or a Shortfall the size of every
        // expense. With money out still known, the chart shows that alone.
        let aside = null;
        if (st.total !== undefined && val(st.total) === null) {
            if (dir !== 'all' || !sinks.length) return drawUnknown(root, st, ctx);
            dir = 'out';
            aside = st.reason ? String(st.reason) : 'Revenue is not available, so only expenses are shown.';
        }
        let total = aside ? null : val(st.total);
        if (total === null) total = dir === 'out' ? (val(st.outTotal) === null ? sinkSum : val(st.outTotal)) : srcSum;
        total = Math.abs(total);

        const left = dir === 'out' ? [] : sources.slice();
        const right = dir === 'in' ? [] : sinks.slice();
        // The middle stage (all only): Mercury's "Expenses". Its bar is the
        // period's money out; the ribbons out of it are the groups.
        let exp = null;
        if (dir === 'all') {
            const given = val(st.outTotal);
            const outV = given === null ? sinkSum : Math.abs(given);
            if (outV > 0 || sinkSum > 0)
                exp = { label: 'Expenses', v: outV, bar: Math.max(outV, sinkSum), tone: 'spend' };
            let net = val(st.net);
            if (net === null) net = total - (exp ? exp.v : 0);
            if (net < 0) left.push({ label: 'Shortfall', v: -net, tone: 'spend', shortfall: true });
        }
        const centerLabel = st.centerLabel && !aside ? String(st.centerLabel) : dir === 'out' ? 'Expenses' : 'Revenue';
        const center = { label: centerLabel, v: total, tone: dir === 'out' ? 'spend' : 'revenue' };
        const inSide = left.reduce((a, x) => a + x.v, 0);
        const outSide = dir === 'all' ? (exp ? exp.v : 0) : right.reduce((a, x) => a + x.v, 0);
        const centerV = Math.max(total, inSide, outSide);
        const empty = centerV <= 0 && !(exp && exp.bar > 0);

        const f = frame(root, W, H);
        const svg = f.svg;
        const pad = 8;
        const avail = H - pad * 2;
        const NODE_W = 2;
        // Mercury's label columns are 132px a side at 773 wide; a narrow
        // container shrinks them rather than running the labels into the flow.
        const side = Math.max(64, Math.min(132, Math.round(W * 0.171)));
        const leftX = side;
        const rightX = W - side - 2;
        const third = (rightX - leftX) / 3;
        const colX =
            dir === 'in'
                ? { l: leftX, c: rightX }
                : dir === 'out'
                  ? { c: leftX, r: rightX }
                  : { l: leftX, c: Math.round(leftX + third), e: Math.round(leftX + 2 * third), r: rightX };
        const most = Math.max(left.length, right.length, 1);
        const gap = most > 1 ? Math.min(44, (avail * 0.6) / (most - 1)) : 0;
        let k = Infinity;
        [left, right].forEach((col) => {
            const tot = col.reduce((a, x) => a + x.v, 0);
            if (tot > 0) k = Math.min(k, (avail - gap * (col.length - 1)) / tot);
        });
        if (centerV > 0) k = Math.min(k, avail / centerV);
        if (exp && exp.bar > 0) k = Math.min(k, avail / exp.bar);
        if (!Number.isFinite(k)) k = 0;

        function stack(col) {
            const tot = col.reduce((a, x) => a + x.v * k, 0) + gap * Math.max(0, col.length - 1);
            let yy = pad + (avail - tot) / 2;
            col.forEach((x) => {
                x.y0 = yy;
                x.y1 = yy + x.v * k;
                yy = x.y1 + gap;
            });
        }
        stack(left);
        stack(right);
        center.y0 = pad + (avail - centerV * k) / 2;
        center.y1 = center.y0 + total * k;
        const centerBottom = center.y0 + centerV * k;
        if (exp) {
            exp.y0 = pad + (avail - exp.bar * k) / 2;
            exp.y1 = exp.y0 + exp.v * k;
        }

        const linksG = s('g', { class: 'fin-sankey__links' }, svg);
        const nodesG = s('g', { class: 'fin-sankey__nodes' }, svg);
        const links = [];
        const ribbon = (x0, a0, a1, x1, b0, b1) => {
            const xm = (x0 + x1) / 2;
            const P = (x, yy) => r2(x) + ',' + r2(yy);
            return (
                'M' +
                P(x0, a0) +
                'C' +
                P(xm, a0) +
                ' ' +
                P(xm, b0) +
                ' ' +
                P(x1, b0) +
                'L' +
                P(x1, b1) +
                'C' +
                P(xm, b1) +
                ' ' +
                P(xm, a1) +
                ' ' +
                P(x0, a1) +
                'Z'
            );
        };
        if (exp) {
            gradient(
                f.defs,
                ctx.uid + '-flow',
                false,
                [
                    [0, 'fin-stop fin-stop--flow-in'],
                    [1, 'fin-stop fin-stop--flow-out']
                ],
                { x1: colX.c + NODE_W, x2: colX.e, y1: 0, y2: 0 }
            );
        }

        let cy = center.y0;
        left.forEach((x) => {
            const hh = x.v * k;
            const i = links.length;
            s(
                'path',
                {
                    class: 'fin-sankey__link fin-mark fin-link-' + x.tone,
                    'data-i': i,
                    'data-hit': i,
                    d: ribbon(colX.l + NODE_W, x.y0, x.y1, colX.c, cy, cy + hh)
                },
                linksG
            );
            links.push({ node: x, side: 'in', y: (x.y0 + x.y1) / 2, x: colX.l + NODE_W });
            cy += hh;
        });
        // Money in -> Expenses: one ribbon, the width of money out, leaving
        // the TOP of the Money in bar (Mercury). Whatever is left of the bar
        // below it was not spent.
        if (exp && exp.v > 0) {
            const hh = Math.min(exp.v, centerV) * k;
            const i = links.length;
            const p = s(
                'path',
                {
                    class: 'fin-sankey__link fin-mark fin-link-flow',
                    'data-i': i,
                    'data-hit': i,
                    d: ribbon(colX.c + NODE_W, center.y0, center.y0 + hh, colX.e, exp.y0, exp.y0 + hh)
                },
                linksG
            );
            p.setAttribute('fill', 'url(#' + ctx.uid + '-flow)');
            links.push({ node: exp, side: 'mid', y: exp.y0 + hh / 2, x: colX.e });
        }
        let ry = dir === 'all' && exp ? exp.y0 : center.y0;
        const fromX = dir === 'all' && exp ? colX.e : colX.c;
        right.forEach((x) => {
            const hh = x.v * k;
            const i = links.length;
            s(
                'path',
                {
                    class: 'fin-sankey__link fin-mark fin-link-' + x.tone,
                    'data-i': i,
                    'data-hit': i,
                    d: ribbon(fromX + NODE_W, ry, ry + hh, colX.r, x.y0, x.y1)
                },
                linksG
            );
            links.push({ node: x, side: 'out', y: (x.y0 + x.y1) / 2, x: colX.r });
            ry += hh;
        });

        const nodeRect = (xx, y0, y1, tone, i) =>
            s(
                'rect',
                {
                    class: 'fin-sankey__node fin-mark fin-fill-' + tone,
                    'data-i': i,
                    x: xx,
                    y: r2(y0),
                    width: NODE_W,
                    height: r2(Math.max(1, y1 - y0))
                },
                nodesG
            );
        left.forEach((x, j) => nodeRect(colX.l, x.y0, x.y1, x.tone, j));
        right.forEach((x, j) => nodeRect(colX.r, x.y0, x.y1, x.tone, left.length + (exp ? 1 : 0) + j));
        // The middle node: money in, with any shortfall stacked under it.
        nodeRect(colX.c, center.y0, center.y1, center.tone, 'c');
        if (dir === 'all' && centerBottom - center.y1 >= 0.5) nodeRect(colX.c, center.y1, centerBottom, 'spend', 'c');
        if (exp) nodeRect(colX.e, exp.y0, exp.y0 + exp.bar * k, 'spend', 'e');

        function nodeLabel(y0, y1, xx, pos, text, amt, i, maxW) {
            const lb = h('span', 'fin-sankey__label fin-sankey__label--' + pos, null, f.labels);
            if (pos === 'l') lb.style.right = r2(W - xx + 8) + 'px';
            else lb.style.left = r2(xx + NODE_W + 8) + 'px';
            lb.style.top = r2((y0 + y1) / 2) + 'px';
            lb.setAttribute('data-i', String(i));
            lb.style.maxWidth = r2(Math.max(48, (maxW || side) - 10)) + 'px';
            const name = h('span', 'fin-sankey__name', text, lb);
            name.title = text;
            h('span', 'fin-sankey__amt', amt, lb);
            return lb;
        }
        left.forEach((x, j) => nodeLabel(x.y0, x.y1, colX.l, 'l', x.label, F.compact(x.shortfall ? -x.v : x.v), j));
        right.forEach((x, j) =>
            nodeLabel(x.y0, x.y1, colX.r, 'r', x.label, F.compact(-x.v), left.length + (exp ? 1 : 0) + j)
        );
        nodeLabel(
            center.y0,
            center.y1,
            colX.c,
            dir === 'in' ? 'r' : 'l',
            centerLabel,
            F.compact(dir === 'out' ? -total : total),
            'c',
            dir === 'all' ? third : side
        );
        if (exp) nodeLabel(exp.y0, exp.y0 + exp.bar * k, colX.e, 'l', exp.label, F.compact(-exp.v), 'e', third);

        const lower = centerLabel.toLowerCase();
        const label =
            (dir === 'out' ? 'Expenses' : dir === 'in' ? 'Revenue' : 'Cashflow') +
            ' flow chart. ' +
            centerLabel +
            ' ' +
            F.money(dir === 'out' ? -total : total) +
            (left.length ? ', from ' + left.map((x) => x.label).join(', ') : '') +
            (exp ? '. Expenses ' + F.money(-exp.v) : '') +
            (right.length ? ', to ' + right.map((x) => x.label).join(', ') : '') +
            '.' +
            (aside ? ' ' + aside : '');
        svg.setAttribute('aria-label', label);
        if (aside) h('p', 'fin-chart__aside', aside, root);
        const rows = [];
        left.forEach((x) =>
            rows.push([
                x.label,
                x.shortfall ? 'Shortfall into ' + lower : 'Into ' + lower,
                F.moneyCents(x.shortfall ? -x.v : x.v)
            ])
        );
        rows.push([centerLabel, 'Total', F.moneyCents(dir === 'out' ? -total : total)]);
        if (exp) rows.push([exp.label, 'Out of ' + lower, F.moneyCents(-exp.v)]);
        right.forEach((x) => rows.push([x.label, 'Out of ' + (exp ? 'expenses' : lower), F.moneyCents(-x.v)]));
        srTable(root, label, ['Name', 'Flow', 'Amount'], rows);
        if (empty) {
            hLine(svg, 'fin-chart__zero', colX.c - 40, colX.c + 40, H / 2);
            emptyNote(
                root,
                st.emptyText || (st.state === 'empty' ? 'Nothing came in or went out in this period.' : ''),
                H / 4
            );
        }

        return {
            svg: svg,
            count: links.length,
            empty: empty,
            clear() {
                light(root, -1);
            },
            focus(i) {
                const l = links[i];
                light(root, i);
                root.querySelectorAll('[data-i="c"]').forEach((nn) => nn.classList.add('is-on'));
                if (l.side !== 'in') root.querySelectorAll('[data-i="e"]').forEach((nn) => nn.classList.add('is-on'));
                const x = l.node;
                const signedV = x.shortfall || l.side !== 'in' ? -x.v : x.v;
                const model = { rows: [{ label: x.label, value: F.moneyCents(signedV), tone: x.tone, strong: true }] };
                const of = l.side === 'out' && exp ? exp.v : total;
                if (of > 0)
                    model.note = F.pct((x.v / of) * 100) + ' of ' + (l.side === 'out' && exp ? 'expenses' : lower);
                return { model: model, x: l.x, y: l.y };
            }
        };
    }

    /* =====================================================================
     * shareBar: the staircase "% of total" bar in the breakdown tables
     * (overview.md 6): a 4px track, and a fill of width pct that starts
     * where the rows above it ended, 1px after it.
     * ===================================================================== */

    function shareGeometry(o) {
        const opts = o || {};
        const clamp = (v) => Math.max(0, Math.min(100, v));
        const pct = val(opts.pct);
        const off = clamp(val(opts.offsetPct) || 0);
        if (pct === null || pct <= 0) return { tone: toneOf(opts.tone), fill: null };
        const w = r2(Math.min(clamp(pct), 100 - off));
        return {
            tone: toneOf(opts.tone),
            fill: {
                left: off > 0 ? 'calc(' + r2(off) + '% + 1px)' : '0',
                width: off > 0 ? 'calc(' + w + '% - 1px)' : w + '%'
            }
        };
    }

    /** The bar as an HTML string, for a table cell renderer. Numbers only. */
    function shareBarHtml(o) {
        const g = shareGeometry(o);
        const fill = g.fill
            ? '<span class="fin-share__fill fin-bg-' +
              g.tone +
              '" style="left:' +
              g.fill.left +
              ';width:' +
              g.fill.width +
              '"></span>'
            : '';
        return '<span class="fin-share" aria-hidden="true"><span class="fin-share__track">' + fill + '</span></span>';
    }

    function shareBarNode(o) {
        const g = shareGeometry(o);
        const root = h('span', 'fin-share');
        root.setAttribute('aria-hidden', 'true');
        const track = h('span', 'fin-share__track', null, root);
        if (g.fill) {
            const fill = h('span', 'fin-share__fill fin-bg-' + g.tone, null, track);
            fill.style.left = g.fill.left;
            fill.style.width = g.fill.width;
        }
        return root;
    }

    function shareBar(el, o) {
        if (!el || typeof el.appendChild !== 'function') return shareBarHtml(o === undefined ? el : o);
        let opts = Object.assign({}, o || {});
        el.replaceChildren(shareBarNode(opts));
        return {
            update(next) {
                opts = Object.assign({}, opts, next || {});
                el.replaceChildren(shareBarNode(opts));
                return true;
            },
            destroy() {
                el.replaceChildren();
            }
        };
    }

    /* =====================================================================
     * cumulative: the Transactions KPI chart, running totals of money in
     * (green line + soft area) and money out (spend line), weekly ticks.
     * transactions.md 3.1.
     * ===================================================================== */

    /** A round top for a running total: $4.12M -> $4.5M (half-steps). */
    function halfTop(max) {
        if (!(max > 0)) return 0;
        const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
        return Math.ceil(max / step - 1e-9) * step;
    }

    function drawCumulative(root, st, ctx) {
        const F = Fm();
        const days = list(st.days);
        const n = days.length;
        const W = ctx.w;
        const H = ctx.h;
        const box = { l: 52, r: W - 15, t: 10, b: H - 32 };
        const plotW = box.r - box.l;
        const plotH = box.b - box.t;

        // Once a day is unknown, every running total after it is unknown too.
        const run = (key) => {
            let t = 0;
            let broken = false;
            return days.map((d) => {
                const v = val(d[key]);
                if (broken || v === null) {
                    broken = true;
                    return null;
                }
                // Signed: money out is a magnitude, and a day whose vendor
                // credits beat its spending LOWERS the running total. Math.abs
                // once raised it.
                t += v;
                return t;
            });
        };
        const cin = run('moneyIn');
        const cout = run('moneyOut');
        if (n && !cin.concat(cout).some((v) => v !== null)) return drawUnknown(root, st, ctx);
        let max = 0;
        let min = 0;
        cin.concat(cout).forEach((v) => {
            if (v !== null && v > max) max = v;
            if (v !== null && v < min) min = v;
        });
        const top = halfTop(max);
        // A running total that dips below zero (refunds or credits first)
        // gets room under the baseline instead of running off the plot.
        const floor = min < 0 ? -halfTop(-min) : 0;
        const empty = !(top > 0) && !(floor < 0);

        const f = frame(root, W, H);
        const svg = f.svg;
        const x = (i) => (n < 2 ? box.l + plotW / 2 : box.l + (i / (n - 1)) * plotW);
        const y = (v) => (empty ? box.b : box.b - ((v - floor) / (top - floor)) * plotH);

        // Weekly ticks on Sundays, thinned so at most six ever show.
        const ticks = [];
        days.forEach((d, i) => {
            const dt = F.parseDay(d.date);
            if (i > 0 && dt && dt.getUTCDay() === 0) ticks.push(i);
        });
        const tStride = Math.max(1, Math.ceil(ticks.length / 6));
        ticks.forEach((i, j) => {
            if (j % tStride) return;
            s('line', { class: 'fin-chart__vgrid', x1: px(x(i)), x2: px(x(i)), y1: r2(box.t), y2: r2(box.b) }, svg);
            xLabel(f.labels, F.date(days[i].date), x(i), box.b + 21, i);
        });

        if (empty) {
            yLabel(f.labels, '0', box.b, 'fin-chart__y--kpi');
            hLine(svg, 'fin-chart__zero', box.l, box.r, box.b);
        } else {
            if (top > 0) {
                yLabel(f.labels, F.compact(top), y(top), 'fin-chart__y--kpi');
                yLabel(f.labels, F.compact(top / 2), y(top / 2), 'fin-chart__y--kpi');
            }
            if (floor < 0) {
                yLabel(f.labels, '0', y(0), 'fin-chart__y--kpi');
                hLine(svg, 'fin-chart__zero', box.l, box.r, y(0));
                if (y(floor) - y(0) >= 14) yLabel(f.labels, F.compact(floor), y(floor), 'fin-chart__y--kpi');
            }
        }

        // The soft fill sits under the LARGER running total, whichever side
        // that is (the owner's reference: money out ahead, filled in spend;
        // Mercury's demo: money in ahead, filled in green). Judged on the last
        // day both are known.
        const lastBoth = (() => {
            for (let i = n - 1; i >= 0; i--) if (cin[i] !== null && cout[i] !== null) return i;
            return -1;
        })();
        const fillOut =
            lastBoth >= 0
                ? cout[lastBoth] > cin[lastBoth]
                : cin.every((v) => v === null) && cout.some((v) => v !== null);
        const fillTone = fillOut ? 'cumout' : 'cum';
        gradient(
            f.defs,
            ctx.uid + '-cfill',
            true,
            [
                [0, 'fin-stop fin-stop--' + fillTone + '-a'],
                [1, 'fin-stop fin-stop--' + fillTone + '-b']
            ],
            { x1: 0, x2: 0, y1: r2(box.t), y2: r2(box.b) }
        );
        const g = s('g', { class: 'fin-chart__cum' }, svg);
        const ptsIn = cin.map((v, i) => ({ x: x(i), y: v === null ? null : y(v) }));
        const ptsOut = cout.map((v, i) => ({ x: x(i), y: v === null ? null : y(v) }));
        const baseY = r2(empty ? box.b : y(0));
        runs(fillOut ? ptsOut : ptsIn).forEach((r) => {
            if (r.length < 2) return;
            const d = monoPath(r) + 'L' + r2(r[r.length - 1].x) + ',' + baseY + 'L' + r2(r[0].x) + ',' + baseY + 'Z';
            s(
                'path',
                { class: 'fin-area', 'data-key': fillOut ? 'out' : 'in', d: d, fill: 'url(#' + ctx.uid + '-cfill)' },
                g
            );
        });
        runs(ptsOut).forEach((r) => {
            if (r.length > 1)
                s('path', { class: 'fin-cumline fin-stroke-spend', 'data-key': 'out', d: monoPath(r) }, g);
        });
        runs(ptsIn).forEach((r) => {
            if (r.length > 1)
                s('path', { class: 'fin-cumline fin-stroke-revenue', 'data-key': 'in', d: monoPath(r) }, g);
        });
        const cross = s('line', { class: 'fin-chart__cross', x1: 0, x2: 0, y1: r2(box.t), y2: r2(box.b) }, svg);
        const dotIn = s('circle', { class: 'fin-cumdot fin-fill-revenue', r: 3.5, cx: -10, cy: -10 }, svg);
        const dotOut = s('circle', { class: 'fin-cumdot fin-fill-spend', r: 3.5, cx: -10, cy: -10 }, svg);
        hits(svg, n, x, n > 1 ? plotW / (n - 1) : plotW, 0, H);

        // The last KNOWN running total, and the day it runs to. A feed that
        // ends Sep 10 leaves every later day null; the last day's null said
        // "Money in -" while the legend beside it printed the month's figure.
        const lastKnown = (arr, flip) => {
            for (let i = n - 1; i >= 0; i--) {
                if (arr[i] === null) continue;
                return F.money(flip ? -arr[i] : arr[i]) + (i < n - 1 ? ' through ' + F.date(days[i].date) : '');
            }
            return F.money(null);
        };
        const label =
            'Running totals, ' +
            n +
            ' days' +
            (n ? ' from ' + F.date(days[0].date) + ' to ' + F.date(days[n - 1].date) : '') +
            '. Revenue ' +
            lastKnown(cin, false) +
            ', expenses ' +
            lastKnown(cout, true) +
            '.';
        svg.setAttribute('aria-label', label);
        srTable(
            root,
            label,
            ['Day', 'Revenue so far', 'Expenses so far'],
            days.map((d, i) => [F.date(d.date), F.moneyCents(cin[i]), F.moneyCents(cout[i] === null ? null : -cout[i])])
        );
        if (empty) emptyNote(root, st.emptyText, noteTop(box, box.b));

        return {
            svg: svg,
            count: n,
            empty: empty,
            clear() {
                root.classList.remove('is-hovering');
                cross.classList.remove('is-on');
                [dotIn, dotOut].forEach((d) => d.classList.remove('is-on'));
            },
            focus(i) {
                root.classList.add('is-hovering');
                const xx = px(x(i));
                cross.setAttribute('x1', xx);
                cross.setAttribute('x2', xx);
                cross.classList.add('is-on');
                [
                    [dotIn, cin[i]],
                    [dotOut, cout[i]]
                ].forEach((p) => {
                    p[0].classList.toggle('is-on', p[1] !== null);
                    if (p[1] === null) return;
                    p[0].setAttribute('cx', r2(x(i)));
                    p[0].setAttribute('cy', r2(y(p[1])));
                });
                return {
                    model: {
                        head: F.date(days[i].date),
                        rows: [
                            { label: 'Revenue', value: F.moneyCents(cin[i]), tone: 'revenue' },
                            {
                                label: 'Expenses',
                                value: F.moneyCents(cout[i] === null ? null : -cout[i]),
                                tone: 'spend'
                            }
                        ]
                    },
                    x: x(i) + 4,
                    lx: x(i) - 4,
                    y: cin[i] === null ? (cout[i] === null ? box.b : y(cout[i])) : y(cin[i])
                };
            }
        };
    }

    /* =====================================================================
     * topBars: the Transactions "To/From" chart, the top counterparties as
     * thin bars: money in green, money out spend-red, one bar each.
     * transactions.md 3.2.
     * ===================================================================== */

    function drawTopBars(root, st, ctx) {
        const F = Fm();
        // A row is one bar ({label, cents}) or Mercury's in/out PAIR under one
        // label ({label, pair: {in, out}}; out is a flow, negative for money
        // out). A pair is two thin bars side by side, so a store's money in
        // and money out never print its name twice.
        const rows = list(st.rows)
            .slice(0, 5)
            .map((r) => {
                const label = String(r.label !== undefined ? r.label : '');
                if (r.pair && typeof r.pair === 'object') {
                    return { label: label, pair: true, a: val(r.pair.in), b: val(r.pair.out) };
                }
                return { label: label, pair: false, v: val(r.cents) };
            });
        const valuesOf = (r) => (r.pair ? [r.a, r.b] : [r.v]);
        const n = rows.length;
        if (n && !rows.some((r) => valuesOf(r).some((v) => v !== null))) return drawUnknown(root, st, ctx);
        const pairMode = rows.some((r) => r.pair);
        const W = ctx.w;
        const H = ctx.h;
        const box = { l: 45, r: W, t: 11, b: H - 27 };
        const plotH = box.b - box.t;
        let max = 0;
        rows.forEach((r) =>
            valuesOf(r).forEach((v) => {
                if (v !== null && Math.abs(v) > max) max = Math.abs(v);
            })
        );
        const empty = !(max > 0);
        const f = frame(root, W, H);
        const svg = f.svg;
        const y = (v) => (empty ? box.b : box.b - (Math.abs(v) / max) * plotH);
        const slot = (box.r - box.l) / Math.max(1, n || 5);
        const cx = (i) => box.l + slot * (i + 0.5);
        const BW = 15;
        // Pairs sit 2px apart, centred on the label.
        const GAP = 2;

        if (empty) yLabel(f.labels, '0', box.b, 'fin-chart__y--kpi');
        else {
            yLabel(f.labels, F.compact(max), y(max), 'fin-chart__y--kpi');
            yLabel(f.labels, F.compact(max / 2), y(max / 2), 'fin-chart__y--kpi');
            hLine(svg, 'fin-chart__grid', box.l, box.r, y(max / 2));
        }
        // No baseline under real bars (Mercury draws the caps alone); an
        // empty chart keeps one, so a quiet period still reads as zero.
        if (empty) hLine(svg, 'fin-chart__zero', box.l, box.r, box.b);
        ['revenue', 'spend'].forEach((t) =>
            gradient(f.defs, ctx.uid + '-' + t, true, [
                [0, 'fin-stop fin-stop--' + t + '-a'],
                [1, 'fin-stop fin-stop--' + t + '-b']
            ])
        );
        const g = s('g', { class: 'fin-chart__bars' }, svg);
        function barAt(i, left, v, zeroTone) {
            if (v === null) return;
            // A zero half of an in/out pair keeps its side's colour: Mercury
            // draws it as that side's cap on the baseline.
            const tone = v > 0 ? 'revenue' : v < 0 ? 'spend' : zeroTone || 'volume';
            const top = y(v);
            if (box.b - top >= 1) {
                s(
                    'rect',
                    {
                        class: 'fin-bar fin-bar--' + tone + ' fin-mark',
                        'data-i': i,
                        x: r2(left),
                        y: r2(top),
                        width: BW,
                        height: r2(box.b - top),
                        fill: 'url(#' + ctx.uid + '-' + (tone === 'spend' ? 'spend' : 'revenue') + ')'
                    },
                    g
                );
            }
            // A zero or near-zero bar is just its cap, on the baseline.
            const capY = r2(Math.min(top, box.b - 1));
            s(
                'line',
                {
                    class: 'fin-cap fin-cap--thick fin-stroke-' + tone + ' fin-mark',
                    'data-i': i,
                    x1: r2(left),
                    x2: r2(left + BW),
                    y1: capY,
                    y2: capY
                },
                g
            );
        }
        rows.forEach((r, i) => {
            if (r.pair) {
                barAt(i, cx(i) - BW - GAP / 2, r.a, 'revenue');
                barAt(i, cx(i) + GAP / 2, r.b, 'spend');
            } else barAt(i, cx(i) - BW / 2, r.v);
        });
        rows.forEach((r, i) => {
            const lb = xLabel(f.labels, r.label, cx(i), box.b + 16, i);
            lb.classList.add('fin-chart__x--cat');
            lb.style.width = r2(slot - 4) + 'px';
            lb.title = r.label;
        });
        hits(svg, n, cx, slot, 0, H);

        // A pair's zero half is drawn (its cap on the baseline, Mercury's
        // look) but not SAID: "McLane money in $0" is noise to a listener.
        const said = (r) => {
            if (!r.pair) return r.label + ' ' + F.money(r.v);
            const parts = [];
            if (r.a !== 0) parts.push('revenue ' + F.money(r.a));
            if (r.b !== 0) parts.push('expenses ' + F.money(r.b));
            return r.label + ' ' + (parts.length ? parts.join(', ') : F.money(0));
        };
        const half = (v) => (v === 0 ? '' : F.moneyCents(v));
        const label = 'Top ' + n + ' by amount' + (n ? ': ' + rows.map(said).join(', ') : '') + '.';
        svg.setAttribute('aria-label', label);
        srTable(
            root,
            label,
            pairMode ? ['Name', 'Revenue', 'Expenses'] : ['Name', 'Amount'],
            rows.map((r) => {
                if (!pairMode) return [r.label, F.moneyCents(r.v)];
                if (r.pair) return [r.label, half(r.a), half(r.b)];
                return r.v !== null && r.v < 0 ? [r.label, '', F.moneyCents(r.v)] : [r.label, F.moneyCents(r.v), ''];
            })
        );
        if (empty) emptyNote(root, st.emptyText, noteTop(box, box.b));

        return {
            svg: svg,
            count: n,
            empty: empty,
            clear() {
                light(root, -1);
            },
            focus(i) {
                light(root, i);
                const r = rows[i];
                if (r.pair) {
                    const tops = [r.a, r.b].filter((v) => v !== null).map(y);
                    return {
                        model: {
                            head: r.label,
                            rows: [
                                { label: 'Revenue', value: F.moneyCents(r.a), tone: 'revenue' },
                                { label: 'Expenses', value: F.moneyCents(r.b), tone: 'spend' }
                            ]
                        },
                        x: cx(i) + BW + GAP / 2,
                        lx: cx(i) - BW - GAP / 2,
                        y: tops.length ? Math.min.apply(null, tops) : box.b
                    };
                }
                return {
                    model: { rows: [{ label: r.label, value: F.moneyCents(r.v), strong: true }] },
                    x: cx(i) + BW / 2,
                    lx: cx(i) - BW / 2,
                    y: r.v === null ? box.b : y(r.v)
                };
            }
        };
    }

    window.FinCharts = Object.freeze({
        TONES: TONES.slice(),
        overview: mount('overview', { draw: drawOverview, width: 773, height: 464 }),
        line: mount('line', { draw: drawLine, width: 773, height: 464 }),
        stacked: mount('stacked', { draw: drawStacked, width: 773, height: 464 }),
        sankey: mount('sankey', { draw: drawSankey, width: 773, height: 464 }),
        cumulative: mount('cumulative', { draw: drawCumulative, width: 502, height: 200 }),
        topBars: mount('topBars', { draw: drawTopBars, width: 342, height: 165 }),
        shareBar: shareBar,
        shareBarHtml: shareBarHtml,
        /** Exposed for the tests and for a page that wants the same axis. */
        scaleFor: scaleFor,
        foldGroups: foldGroups
    });
})();
