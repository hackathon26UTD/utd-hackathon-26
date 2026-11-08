/* ===========================================================================
 * The portal kit: the balance card.
 *
 * Kit.balance({ label, badge, series, value, format, decimals, good, fromZero,
 *               state, view, emptyText, note, extra, action, dateFormat, onView })
 *
 * One headline number over its own history, the way a bank shows a balance
 * (owner, 2026-09-22, pointing at Mercury's balance card: "possible to have a
 * KPI card almost just like this ... with the argus spin on it?"):
 *
 *   label + source badge            [chart | table]
 *   $14,748.62                      the figure, cents set small
 *   September 7, 2026        ↗ $120.00
 *   ~~~~~~~ smooth area, scrubbable ~~~~~~~
 *   Aug 28   Sep 2   Sep 7   Sep 12   Sep 17
 *
 *   label      what the number is, in the owner's words
 *   badge      { icon: 'shield'|'register'|'camera'|'clock'|'people'|'phone'|
 *                'box'|'tag', title } where the number comes from. Optional.
 *   series     [{ x, y }]. x is a Date, a 'YYYY-MM-DD' day or an ISO string;
 *              y a finite number. Oldest first. The LAST point is the headline.
 *   value      the figure when there is no series yet (a single reading).
 *   format     'money' | 'number' | 'percent' | (v) => string. Default number.
 *   decimals   places for number/percent (money is always cents).
 *   good       'up' | 'down' | null: which direction of change is good. Unset
 *              means the change has no moral and the arrow stays neutral.
 *   fromZero   draw the fill down to zero (default) or fit the range, for a
 *              level that never nears zero (a balance, a stock value).
 *   state      'notSetUp' | 'notLoaded' | 'incomplete' | 'hidden' — the number
 *              is absent; no chart. 'incomplete' is set up and loaded but
 *              withheld because the data has gaps (days the register sent
 *              nothing): "Not set up" said the wrong thing there (2026-09-26).
 *              'hidden' is a figure this viewer's role may not see.
 *   view       'chart' (default) | 'table'.
 *   emptyText  the line under a figure that has no chart ("Oldest from Sep 19").
 *   note       fine print under the date line, any card ("3 confirmed. 1 has no
 *              price yet."). It does not change while the chart is scrubbed.
 *              Both take a string, or Kit.ref parts (js/kit/components.js):
 *              ['Counts sales from ', { text: 'Aug 29 to Sep 27', target }]
 *              draws its figures bold red, and a figure with a target is a
 *              button that shows where it comes from.
 *   extra      an element the caller owns, placed under a chartless figure and
 *              above its action (a strip of camera status pips, say).
 *   action     { label, onClick }: one button under a figure that has no chart.
 *   dateFormat (x: Date) => string for the date line. Default "September 7, 2026".
 *
 * Returns the root element. Hovering or arrow-keying the chart moves a marker
 * and puts THAT day's value, date and change in the header; leaving resets to
 * the latest, as Mercury does.
 *
 * Motion (Kit.motion, js/kit/motion.js, when it is loaded and the browser may
 * move): the first time a card is seen on a visit to its page it rises into
 * place in a cascade with its neighbours, the figure counts up from zero and
 * the line draws in; a repaint with a new value counts from the old one. The
 * final text is written before any of that, so without motion the card is
 * exactly what it was.
 *
 * ⛔ THE CURVE IS MONOTONE CUBIC, NOT A FREE SPLINE. Kit.chart draws straight
 * segments because "a curve through bucketed data draws values that were
 * never measured" (chart.js linePath). A Catmull-Rom or plain Bezier overshoots
 * between points and draws exactly that. Fritsch-Carlson monotone cubic passes
 * through every measured point and never leaves the range of the two points it
 * joins, so the smoothing adds shape and no values.
 *
 * ⛔ NO CHART UNDER AN ABSENT NUMBER, AND NONE FROM ONE POINT. A series of one
 * is a number, not a trend; the card says there is no history yet instead of
 * drawing a flat line that reads as "nothing changed".
 *
 * Styling is css/kit.css under `.kit .kit-bal`. No class here contains card,
 * panel, widget, tile, -page or spin (see components.js header).
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__balance) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        if (window.console && console.warn) {
            console.warn('[Kit] balance: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const el = Kit.el;

    /** A string as text; Kit.ref parts as figures (plain text without Kit.ref). */
    function words(node, v) {
        if (Array.isArray(v)) {
            if (Kit.ref && typeof Kit.ref.text === 'function') node.replaceChildren(Kit.ref.text(v));
            else
                node.textContent = v
                    .map((p) => (p && typeof p === 'object' ? String(p.text || '') : String(p == null ? '' : p)))
                    .join('');
        } else node.textContent = v;
        return node;
    }
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const VB_W = 600;
    const VB_H = 150;
    const PAD_T = 12;
    const PAD_B = 6;
    const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

    // Each icon is a list of [tag, attributes]: built with createElementNS,
    // never parsed from a string.
    const ICONS = {
        shield: [
            ['path', { d: 'M12 3l8 3v6c0 4.4-3.4 8.2-8 9-4.6-.8-8-4.6-8-9V6l8-3z' }],
            ['path', { d: 'M9 12l2 2 4-4' }]
        ],
        register: [
            ['rect', { x: '3', y: '10', width: '18', height: '10', rx: '2' }],
            ['path', { d: 'M7 10V5h10v5M7 15h2M11 15h2M15 15h2' }]
        ],
        camera: [
            ['rect', { x: '3', y: '7', width: '13', height: '10', rx: '2' }],
            ['path', { d: 'M16 11l5-3v8l-5-3' }]
        ],
        clock: [
            ['circle', { cx: '12', cy: '12', r: '8' }],
            ['path', { d: 'M12 8v4l3 2' }]
        ],
        people: [
            ['circle', { cx: '9', cy: '8', r: '3.2' }],
            [
                'path',
                { d: 'M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M16 5.2a3 3 0 010 5.6M17.5 14.6c1.8.6 2.8 2 3.2 4.4' }
            ]
        ],
        phone: [
            ['path', { d: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z' }]
        ],
        box: [
            ['path', { d: 'M4 8l8-4 8 4v8l-8 4-8-4z' }],
            ['path', { d: 'M4 8l8 4 8-4M12 12v8' }]
        ],
        tag: [
            ['path', { d: 'M3.5 12.5V4.5a1 1 0 011-1h8l8 8-9 9z' }],
            ['circle', { cx: '8', cy: '8', r: '1.4' }]
        ],
        chart: [
            ['path', { d: 'M4 19V5M4 19h16' }],
            ['path', { d: 'M7 15l4-4 3 3 5-6' }]
        ],
        table: [
            ['rect', { x: '3.5', y: '5', width: '17', height: '14', rx: '2' }],
            ['path', { d: 'M3.5 10h17M12 10v9' }]
        ],
        up: [['path', { d: 'M7 17L17 7M9 7h8v8' }]],
        down: [['path', { d: 'M7 7l10 10M17 9v8H9' }]]
    };

    function icon(name, cls) {
        const s = document.createElementNS(SVG_NS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('aria-hidden', 'true');
        if (cls) s.setAttribute('class', cls);
        (ICONS[name] || []).forEach((spec) => {
            const node = document.createElementNS(SVG_NS, spec[0]);
            Object.keys(spec[1]).forEach((k) => node.setAttribute(k, spec[1][k]));
            s.appendChild(node);
        });
        return s;
    }

    /* ── Values ────────────────────────────────────────────────────────── */

    function asDate(x) {
        if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
        if (typeof x === 'string') {
            // A calendar day is LOCAL midnight. `new Date('2026-09-07')` is UTC
            // midnight, which is the evening before west of Greenwich.
            const m = x.match(DAY_RE);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            const d = new Date(x);
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof x === 'number' && isFinite(x)) return new Date(x);
        return null;
    }

    function clean(series) {
        if (!Array.isArray(series)) return [];
        return series
            .map((p) => ({ d: asDate(p && p.x), y: p && typeof p.y === 'number' ? p.y : NaN }))
            .filter((p) => p.d && isFinite(p.y));
    }

    const MONEY = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    /** The figure as [main, fraction]. Money keeps its cents in the second
     *  half so they can be set small, the way a statement prints them. */
    function formatParts(v, o) {
        if (typeof o.format === 'function') return [String(o.format(v)), ''];
        const dec = typeof o.decimals === 'number' ? o.decimals : o.format === 'percent' ? 1 : 0;
        if (o.format === 'money') {
            const s = MONEY.format(v);
            const i = s.lastIndexOf('.');
            return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)];
        }
        if (o.format === 'percent') return [v.toFixed(dec), '%'];
        return [v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }), ''];
    }

    function formatFlat(v, o) {
        const p = formatParts(v, o);
        return p[0] + p[1];
    }

    const LONG_DATE = { month: 'long', day: 'numeric', year: 'numeric' };
    const SHORT_DATE = { month: 'short', day: 'numeric' };

    /* ── Geometry ──────────────────────────────────────────────────────── */

    function f(v) {
        return (Math.round(v * 100) / 100).toString();
    }

    /**
     * Fritsch-Carlson monotone cubic through `pts` ([{x, y}] in viewBox units),
     * as an SVG path. Tangents are zeroed wherever the data turns, and clamped
     * so no segment leaves the range of its two end points.
     */
    function monotonePath(pts) {
        const n = pts.length;
        if (n < 2) return '';
        if (n === 2) return 'M' + f(pts[0].x) + ' ' + f(pts[0].y) + 'L' + f(pts[1].x) + ' ' + f(pts[1].y);
        const dx = [];
        const m = [];
        for (let i = 0; i < n - 1; i++) {
            dx[i] = pts[i + 1].x - pts[i].x;
            m[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
        }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
        t[n - 1] = m[n - 2];
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) {
                t[i] = 0;
                t[i + 1] = 0;
                continue;
            }
            const a = t[i] / m[i];
            const b = t[i + 1] / m[i];
            const h = a * a + b * b;
            if (h > 9) {
                const k = 3 / Math.sqrt(h);
                t[i] = k * a * m[i];
                t[i + 1] = k * b * m[i];
            }
        }
        let d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i] / 3;
            d +=
                'C' +
                [
                    f(pts[i].x + h),
                    f(pts[i].y + h * t[i]),
                    f(pts[i + 1].x - h),
                    f(pts[i + 1].y - h * t[i + 1]),
                    f(pts[i + 1].x),
                    f(pts[i + 1].y)
                ].join(' ');
        }
        return d;
    }

    function geometry(pts, fromZero) {
        const ys = pts.map((p) => p.y);
        let lo = Math.min.apply(null, ys);
        let hi = Math.max.apply(null, ys);
        if (fromZero) lo = Math.min(0, lo);
        if (hi === lo && fromZero) {
            // Every point is zero. A zero drawn mid-plot reads as a level
            // above nothing; on the floor it reads as what it is.
            hi = lo + 1;
        } else if (hi === lo) {
            // A flat level: centre it rather than divide by zero.
            hi = lo + 1;
            lo = lo - 1;
        } else if (!fromZero) {
            const pad = (hi - lo) * 0.12;
            lo -= pad;
            hi += pad;
        }
        const n = pts.length;
        const x = (i) => (n === 1 ? VB_W / 2 : (i / (n - 1)) * VB_W);
        const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (VB_H - PAD_T - PAD_B);
        return { x, y };
    }

    let seq = 0;

    /* ── The card ──────────────────────────────────────────────────────── */

    function balance(opts) {
        const o = opts || {};
        const pts = clean(o.series);
        const hasValue = typeof o.value === 'number' && isFinite(o.value);
        const absent = !!o.state || (pts.length === 0 && !hasValue);
        const root = el('div', { class: 'kit-bal' });
        seq += 1;

        // Head: label, source badge, view switch.
        const head = el('div', { class: 'kit-bal__head' });
        const title = el('div', { class: 'kit-bal__title' }, [
            // One line, ellipsised under a narrow card. No browser tooltip
            // (native UI); the whole label is still the text read out.
            el('span', { class: 'kit-bal__label', text: o.label || '' })
        ]);
        if (o.badge && ICONS[o.badge.icon]) {
            // Where the number comes from, in the kit's own tip (css/kit.css),
            // not a browser tooltip: shown on hover and on keyboard focus.
            const b = el('span', { class: 'kit-bal__badge' });
            if (o.badge.title) {
                b.setAttribute('role', 'img');
                b.setAttribute('aria-label', o.badge.title);
                b.setAttribute('tabindex', '0');
                b.dataset.tip = o.badge.title;
            }
            b.appendChild(icon(o.badge.icon));
            title.appendChild(b);
        }
        head.appendChild(title);

        let view = o.view === 'table' ? 'table' : 'chart';
        const canToggle = !absent && pts.length >= 2;
        let sw = null;
        if (canToggle) {
            sw = el('div', { class: 'kit-bal__switch', role: 'group', 'aria-label': 'Show as' });
            [
                ['chart', 'Chart'],
                ['table', 'Table']
            ].forEach((pair) => {
                const btn = el('button', {
                    class: 'kit-bal__sw',
                    type: 'button',
                    'aria-label': pair[1],
                    'aria-pressed': String(view === pair[0]),
                    dataset: { view: pair[0] }
                });
                btn.appendChild(icon(pair[0]));
                btn.addEventListener('click', () => setView(pair[0]));
                sw.appendChild(btn);
            });
            head.appendChild(sw);
        }
        root.appendChild(head);

        // The figure.
        const fig = el('div', { class: 'kit-bal__fig' });
        const main = el('span', { class: 'kit-bal__main' });
        const frac = el('span', { class: 'kit-bal__frac' });
        fig.appendChild(main);
        fig.appendChild(frac);
        root.appendChild(fig);

        function write(v) {
            const parts = formatParts(v, o);
            main.textContent = parts[0];
            frac.textContent = parts[1];
        }

        // ── Motion ───────────────────────────────────────────────────────
        // Called once the card is finished, with the final text already in
        // it: this only decides whether to PLAY that text in. See motion.js.
        let stopCount = null;
        function moveIn(value, plot, svg) {
            const M = Kit.motion;
            if (!M || typeof M.plan !== 'function') return;
            const p = M.plan('bal:' + (o.label || ''), value);
            if (!p) return;
            // A caller's own format ("3/12") gets whole numbers on the way up,
            // never "2.37/12".
            const whole = typeof o.format === 'function' && Number.isInteger(value) && Number.isInteger(p.from);
            const draw = (v, done) => write(done ? value : whole ? Math.round(v) : v);
            write(p.startAt === null ? p.from : M.at(p, M.now()));
            if (p.first) {
                root.classList.add('is-waiting');
                if (plot) plot.classList.add('is-waiting');
            }
            M.whenSeen(
                root,
                () => {
                    if (p.startAt === null) p.startAt = M.now() + M.delayFor(root, '.kit-bal');
                    // Negative when a rebuilt card joins a count already under
                    // way: the animation starts part-way through, in step.
                    const lag = Math.round(p.startAt - M.now()) + 'ms';
                    if (p.first) {
                        root.classList.remove('is-waiting');
                        root.style.animationDelay = lag;
                        root.classList.add('is-arriving');
                        root.addEventListener('animationend', function arrived(e) {
                            if (e.target !== root) return;
                            root.classList.remove('is-arriving');
                            root.style.animationDelay = '';
                            root.removeEventListener('animationend', arrived);
                        });
                        if (plot && svg) {
                            plot.classList.remove('is-waiting');
                            svg.style.animationDelay = lag;
                            plot.classList.add('is-drawing');
                        }
                    }
                    stopCount = M.tween(p, draw);
                },
                () => {
                    root.classList.remove('is-waiting');
                    if (plot) plot.classList.remove('is-waiting');
                    write(value);
                }
            );
        }

        // The day it is for, and the change.
        const meta = el('div', { class: 'kit-bal__meta' });
        const when = el('span', { class: 'kit-bal__when' });
        const delta = el('span', { class: 'kit-bal__delta' });
        meta.appendChild(when);
        meta.appendChild(delta);
        root.appendChild(meta);
        // The fine print that keeps the figure honest ("3 confirmed. 1 has no
        // price yet."). It stays put while the chart is scrubbed.
        if (o.note) root.appendChild(words(el('div', { class: 'kit-bal__note' }), o.note));

        // A card with no chart has room below the figure for the one thing to
        // do about it ("Review now", "Set up cameras"). A chart card does not:
        // the chart is its body.
        function finish() {
            root.classList.add('is-bare');
            const hasExtra = !!(o.extra && o.extra.nodeType === 1);
            // A spring: at least 18px, and it takes the slack when the grid
            // stretches this card to a chart card's height, so the action sits
            // on the floor and a row of cards lines their buttons up.
            if (hasExtra || (o.action && o.action.label)) root.appendChild(el('div', { class: 'kit-bal__gap' }));
            if (hasExtra) root.appendChild(o.extra);
            if (o.action && o.action.label) {
                const act = el('button', { class: 'kit-btn kit-bal__act', type: 'button', text: o.action.label });
                if (typeof o.action.onClick === 'function') act.addEventListener('click', o.action.onClick);
                root.appendChild(act);
            }
            return root;
        }

        if (absent) {
            main.textContent =
                o.state === 'notSetUp'
                    ? 'Not set up'
                    : o.state === 'incomplete'
                      ? 'Can’t say yet'
                      : o.state === 'hidden'
                        ? 'Hidden'
                        : 'Not loaded';
            root.classList.add('is-absent');
            if (o.emptyText) words(when, o.emptyText);
            return finish();
        }

        const dateFmt =
            typeof o.dateFormat === 'function' ? o.dateFormat : (d) => d.toLocaleDateString('en-US', LONG_DATE);

        if (!pts.length) {
            write(o.value);
            words(when, o.emptyText || 'No history yet');
            finish();
            moveIn(o.value, null, null);
            return root;
        }

        function show(i) {
            // A hand on the chart outranks a count still running.
            if (stopCount) {
                stopCount();
                stopCount = null;
            }
            const p = pts[i];
            write(p.y);
            when.textContent = dateFmt(p.d);
            delta.replaceChildren();
            delta.className = 'kit-bal__delta';
            delta.removeAttribute('aria-label');
            if (i > 0) {
                const diff = p.y - pts[i - 1].y;
                const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
                if (dir === 'flat') {
                    // An arrow over "$0.00" reads as a rise. Say it in words.
                    delta.textContent = 'No change';
                } else {
                    if (o.good === 'up' || o.good === 'down') {
                        delta.classList.add(dir === o.good ? 'is-good' : 'is-bad');
                    }
                    delta.appendChild(icon(dir, 'kit-bal__arw'));
                    delta.appendChild(document.createTextNode(formatFlat(Math.abs(diff), o)));
                }
                delta.setAttribute(
                    'aria-label',
                    (dir === 'flat' ? 'No change' : (dir === 'up' ? 'Up ' : 'Down ') + formatFlat(Math.abs(diff), o)) +
                        ' from ' +
                        dateFmt(pts[i - 1].d)
                );
            }
        }

        const last = pts.length - 1;
        show(last);

        if (pts.length < 2) {
            when.textContent = dateFmt(pts[0].d) + '. No history yet';
            finish();
            moveIn(pts[0].y, null, null);
            return root;
        }

        // The chart.
        const g = geometry(pts, o.fromZero !== false);
        const vp = pts.map((p, i) => ({ x: g.x(i), y: g.y(p.y) }));
        const plot = el('div', { class: 'kit-bal__plot', tabindex: '0', role: 'img' });
        plot.setAttribute(
            'aria-label',
            (o.label || 'Trend') +
                ': ' +
                formatFlat(pts[last].y, o) +
                ' on ' +
                dateFmt(pts[last].d) +
                ', ' +
                pts.length +
                ' points. Arrow keys read each day.'
        );
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'kit-bal__svg');
        svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const gid = 'kit-bal-fill-' + seq;
        const defs = document.createElementNS(SVG_NS, 'defs');
        const grad = document.createElementNS(SVG_NS, 'linearGradient');
        grad.setAttribute('id', gid);
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0');
        grad.setAttribute('y2', '1');
        ['kit-bal__stop-a', 'kit-bal__stop-b'].forEach((c, i) => {
            const s = document.createElementNS(SVG_NS, 'stop');
            s.setAttribute('offset', String(i));
            s.setAttribute('class', c);
            grad.appendChild(s);
        });
        defs.appendChild(grad);
        svg.appendChild(defs);
        const line = monotonePath(vp);
        const fill = document.createElementNS(SVG_NS, 'path');
        fill.setAttribute('class', 'kit-bal__fill');
        fill.setAttribute('fill', 'url(#' + gid + ')');
        fill.setAttribute('d', line + 'L' + f(vp[last].x) + ' ' + f(VB_H) + 'L' + f(vp[0].x) + ' ' + f(VB_H) + 'Z');
        const ln = document.createElementNS(SVG_NS, 'path');
        ln.setAttribute('class', 'kit-bal__ln');
        ln.setAttribute('d', line);
        svg.appendChild(fill);
        svg.appendChild(ln);
        plot.appendChild(svg);
        // Marker and rule are HTML so the dot stays round under the stretch.
        const rule = el('span', { class: 'kit-bal__rule', hidden: 'hidden' });
        const dot = el('span', { class: 'kit-bal__dot', hidden: 'hidden' });
        plot.appendChild(rule);
        plot.appendChild(dot);

        // Axis: four dates at the middle of each quarter, as Mercury spaces
        // them. Ticks pinned to the two ends crowded their neighbours once the
        // end labels were pushed inside the card. A short series can still land
        // a tick on an end; that one is anchored so it never clips.
        const axis = el('div', { class: 'kit-bal__axis', 'aria-hidden': 'true' });
        const seen = new Set();
        for (let k = 0; k < 4; k++) {
            const i = Math.round(((k + 0.5) * last) / 4);
            if (seen.has(i)) continue;
            seen.add(i);
            const lbl = el('span', {
                class: 'kit-bal__tick' + (i === 0 ? ' is-start' : i === last ? ' is-end' : ''),
                text: pts[i].d.toLocaleDateString('en-US', SHORT_DATE)
            });
            lbl.style.left = (vp[i].x / VB_W) * 100 + '%';
            axis.appendChild(lbl);
        }

        const chartWrap = el('div', { class: 'kit-bal__chart' }, [plot, axis]);
        root.appendChild(chartWrap);

        let active = -1;
        function mark(i) {
            active = i;
            if (i < 0) {
                rule.hidden = true;
                dot.hidden = true;
                show(last);
                return;
            }
            const leftPct = (vp[i].x / VB_W) * 100 + '%';
            rule.hidden = false;
            dot.hidden = false;
            rule.style.left = leftPct;
            dot.style.left = leftPct;
            dot.style.top = (vp[i].y / VB_H) * 100 + '%';
            show(i);
        }
        function nearest(clientX) {
            const box = plot.getBoundingClientRect();
            if (!box.width) return last;
            const fx = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
            return Math.round(fx * last);
        }
        plot.addEventListener('pointermove', (e) => mark(nearest(e.clientX)));
        plot.addEventListener('pointerdown', (e) => mark(nearest(e.clientX)));
        plot.addEventListener('pointerleave', () => mark(-1));
        plot.addEventListener('blur', () => mark(-1));
        plot.addEventListener('keydown', (e) => {
            let i = active < 0 ? last : active;
            if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
            else if (e.key === 'ArrowRight') i = Math.min(last, i + 1);
            else if (e.key === 'Home') i = 0;
            else if (e.key === 'End') i = last;
            else if (e.key === 'Escape') i = -1;
            else return;
            e.preventDefault();
            mark(i);
        });

        // The table: the same points as rows, newest first.
        const table = el('div', { class: 'kit-bal__table', hidden: 'hidden' });
        const tbl = el('table', { class: 'kit-bal__tbl' });
        const thead = el('thead');
        thead.appendChild(
            el('tr', {}, [
                el('th', { scope: 'col', text: 'Date' }),
                el('th', { scope: 'col', class: 'is-num', text: o.label || 'Value' }),
                el('th', { scope: 'col', class: 'is-num', text: 'Change' })
            ])
        );
        tbl.appendChild(thead);
        const tbody = el('tbody');
        for (let i = last; i >= 0; i--) {
            const diff = i > 0 ? pts[i].y - pts[i - 1].y : null;
            tbody.appendChild(
                el('tr', {}, [
                    el('td', { text: pts[i].d.toLocaleDateString('en-US', LONG_DATE) }),
                    el('td', { class: 'is-num', text: formatFlat(pts[i].y, o) }),
                    el('td', {
                        class: 'is-num',
                        text:
                            diff === null ? '' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + formatFlat(Math.abs(diff), o)
                    })
                ])
            );
        }
        tbl.appendChild(tbody);
        table.appendChild(tbl);
        root.appendChild(table);

        function setView(id) {
            view = id;
            chartWrap.hidden = id !== 'chart';
            table.hidden = id !== 'table';
            if (sw) {
                sw.querySelectorAll('.kit-bal__sw').forEach((b) => {
                    b.setAttribute('aria-pressed', String(b.dataset.view === id));
                });
            }
            if (id === 'table') mark(-1);
            if (typeof o.onView === 'function') o.onView(id);
        }
        setView(view);
        moveIn(pts[last].y, plot, svg);

        return root;
    }

    Kit.balance = balance;
    Kit.balance._internal = { monotonePath: monotonePath, formatParts: formatParts, asDate: asDate };
    Kit.__balance = true;
})();
