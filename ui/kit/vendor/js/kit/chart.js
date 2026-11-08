/* ===========================================================================
 * The portal kit: charts.
 *
 * Kit.chart(host, { kind, series, compare, yFormat, xFormat, ariaLabel })
 *   kind    'area' | 'bars' | 'bars-by-hour' | 'hbars'
 *   series  [{ x, y }], y a finite number; fewer than two usable points and
 *           the call returns null and touches nothing, because a single value
 *           is a Kit.kpi, not a chart.
 *   compare [{ x, y }] drawn as one dashed overlay path, index-aligned.
 *   returns { update(series, compare), destroy() }, or null.
 *   The area marks its last point (`.kit-chart__dot`: the endpoint is today);
 *   every bar kind lights its largest bar (`.is-lit`) in the module accent and
 *   keeps the rest quiet. Colour comes from css/kit.css reading `--crm-mod` /
 *   `--crm-mod-ink` with the kit accent as the fallback outside a module.
 *
 * ⛔ THIS IS NOT js/charts.js RESTYLED, AND IT MAY NOT BECOME ONE. That file
 * still serves the dashboard and stays where it is. Four things in it are why
 * the kit does not build on it, all four still true today:
 *   · every colour is an SVG attribute out of an options object
 *     (`lineColor: '#FF3131'`, charts.js:47), so the theme toggle cannot reach
 *     a single one of them;
 *   · the line redraws itself over a full second on EVERY render, with no
 *     prefers-reduced-motion path at all (charts.js:268);
 *   · the fill gradient's id is `fill-gradient-${this.container.id}`
 *     (charts.js:158), so two charts whose hosts share an id, or have
 *     none, collide, and one of them paints with the other's gradient;
 *   · the tooltip is assembled with innerHTML from `point.data.label`
 *     (charts.js:332-338), which is tenant data.
 * It is also not an IIFE. At column 0 it declares `_chartDotStroke`,
 * `chartDotStroke`, `LineChart`, `ChartManager`, `generateSampleChartData`,
 * `generateHourlyData` and `style`; a second classic script that redeclares any
 * of those throws at parse time and takes the page with it. Nothing in this
 * file is at column 0.
 *
 * 🪤 preserveAspectRatio="none" STRETCHES TEXT. The svg is width: 100% over a
 * fixed 720-unit viewBox, so the horizontal scale is containerWidth / 720 and
 * every <text> glyph would be that much wider than it is tall. So the axis
 * labels are HTML spans in two layers over the svg, and the svg holds marks
 * only. Strokes carry vector-effect: non-scaling-stroke, so a hairline stays a
 * hairline at any width. The svg's height ATTRIBUTE is its own viewBox height,
 * which pins one vertical user unit to one CSS pixel; only x stretches.
 *
 * Styling lives in css/kit.css, under `.kit .kit-chart*` and `.kit.kit-tip*` —
 * the tooltip is body-appended, so the .kit root is the tip element itself. Not
 * one colour is set from here; see __tests__/kit/chart.render.test.js.
 *
 * Spec: docs/superpowers/specs/2026-09-02-portal-ui-refresh-design.md 3.3.
 * =========================================================================== */
(function () {
    'use strict';

    const Kit = window.Kit;
    // core.js runs first: index.html orders the four kit scripts and
    // __tests__/kit/load-order.contract.test.js pins that order. Without it,
    // register nothing. That is the shape js/main.js:4077-4079 documents for
    // the employees files, so a load-order regression fails loudly instead of
    // half-working.
    //
    // ⛔ console.warn HERE AND NOWHERE ELSE IN THIS FILE, for the same reason
    // js/kit/components.js:50-59 and js/kit/forms.js:35-45 say it: Kit.warn is
    // core's, and core is exactly what is missing on this branch. Silence here
    // would surface as `Kit.chart is not a function` from inside a panel
    // instead of one line naming the load order.
    if (!Kit || !Kit.el) {
        if (window.console && console.warn) {
            console.warn('[Kit] chart: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }
    // ⛭ The flag is read off the local `Kit`, not off `window.Kit`, because
    // unlike core, components and forms this file reaches the namespace before
    // it guards. Same assertion about the same flag;
    // __tests__/kit/iife.contract.test.js accepts both spellings and says why.
    // It is also set HERE rather than on the last line: a chart file that threw
    // halfway is a chart that does not draw, which is better than a namespace
    // that re-registers a second Kit.chart under a mounted module's feet.
    if (Kit.__chart) return;
    Kit.__chart = true;

    const el = Kit.el;
    const NS = 'http://www.w3.org/2000/svg';

    /**
     * ⛔ ONE SINK, NOT TWO, and READ THROUGH A WRAPPER rather than captured.
     * core.js routes through window.Logger when the portal has one and
     * console.warn otherwise, and exports that as Kit.warn; a reference bound
     * at load is invisible to a portal that installs its own logger later, and
     * to a test that asks what this file actually said. js/kit/components.js
     * and js/kit/forms.js read it exactly this way, and `arguments` is
     * forwarded because core's sink is variadic.
     */
    function warn() {
        const sink = typeof Kit.warn === 'function' ? Kit.warn : null;
        if (sink) sink.apply(null, arguments);
        else if (window.console && console.warn) console.warn.apply(console, arguments);
    }

    /**
     * A data slot: a list, or nothing, said out loud.
     *
     * ⛔ `series` and `compare` hold RECORDS, so they are data slots and the
     * kit's one rule for those applies: an omitted option says nothing, a list
     * passes through, and anything else is named — factory, option and shape —
     * and renders empty. Feeding a chart straight off a house envelope
     * (`{ success, data }`) is the first thing a module conversion will do, and
     * without this it returns null in silence and the screen shows a hole with
     * no explanation anywhere.
     *
     * components.js's own listOf, reached through Kit rather than copied, so
     * `rows` on a table and `series` on a chart cannot drift apart about what
     * an accidental envelope does. The local fallback covers a page that
     * somehow loaded an older components.js, the same shape and for the same
     * reason as js/kit/forms.js:83-97: chart.js does not otherwise need
     * components, so requiring it would be a load-order claim it need not make.
     */
    function listOf(v, factory, option) {
        if (typeof Kit.listOf === 'function') return Kit.listOf(v, factory, option);
        if (v === null || v === undefined) return [];
        if (Array.isArray(v)) return v.filter(Boolean);
        warn(
            '[Kit] ' +
                factory +
                ': `' +
                option +
                '` must be an array of records; got ' +
                (typeof v === 'object' ? 'an object with keys: ' + Object.keys(v).slice(0, 5).join(', ') : typeof v) +
                '. Rendering nothing rather than inventing a record.'
        );
        return [];
    }

    /* -----------------------------------------------------------------------
     * The viewBox, in user units. Vertical units are CSS pixels exactly
     * (the height attribute equals the viewBox height); horizontal ones are
     * CSS pixels only when the chart happens to be 720 wide, and stretch
     * proportionally past that.
     * --------------------------------------------------------------------- */
    const VB_W = 720;
    const PAD_T = 8;
    const PAD_B = 8;
    const PLOT_H = 152;
    const ROW_H = 30;
    /** At most this many bands between gridlines, so at most this many plus one lines. */
    const MAX_BANDS = 5;
    /** At most this many labels on the category axis; the stride is derived. */
    const MAX_X_LBL = 6;
    /** references/marks-and-anatomy.md caps a bar at 24px; 18 units lands there
     *  at the widths a .kit-block body actually gets (roughly 700 to 1000). */
    const BAR_W_MAX = 18;
    /** The surface gap that separates adjacent bars. Never a border. */
    const BAR_GAP = 2;
    const BAR_R = 3;

    const KINDS = {
        area: { label: 'Area chart', noun: 'points' },
        bars: { label: 'Bar chart', noun: 'bars' },
        'bars-by-hour': { label: 'Bar chart by hour', noun: 'bars' },
        hbars: { label: 'Horizontal bar chart', noun: 'bars' }
    };

    /**
     * ⛔ `KINDS[kind]` WALKS THE PROTOTYPE CHAIN. 'constructor', 'toString',
     * 'valueOf', 'hasOwnProperty' and '__proto__' are all truthy on any object
     * literal, so a kind of any of those passed the guard, drew whichever
     * branch the ifs fell through to, emitted no warning, and produced
     * `KINDS[kind].label` of undefined — a screen reader reading out
     * "undefined, 6 undefined". An own-property check is the whole fix.
     */
    const kindOf = (k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k) ? KINDS[k] : null);

    /** ⛔ NEVER the host id. Two hosts can share one, and a host can have none. */
    let seq = 0;

    /**
     * ⛔ Kit.el CANNOT BUILD SVG, and the way it fails is quiet. It calls
     * `document.createElement(tag)`, which creates in the HTML namespace, so
     * `el('path', …)` returns an HTMLUnknownElement named <path>: it accepts
     * every attribute, it carries the class, and `querySelectorAll('.kit-chart__bar')`
     * finds it — a class-keyed test would pass while the chart painted nothing
     * at all, because an HTML <path> is not an SVG path and no renderer draws
     * it. Measured on jsdom 30.0.1 (`constructor.name` HTMLUnknownElement,
     * namespaceURI …/xhtml).
     *
     * ⛭ NOT "className is a read-only SVGAnimatedString so the assignment is a
     * silent no-op". That describes a node Kit.el never produces, and on a real
     * SVGElement under 'use strict' the assignment THROWS TypeError rather than
     * passing silently — measured, both halves. The failure to look for is a
     * blank chart whose classes are all present, not a missing class.
     */
    function svgEl(tag, attrs) {
        const n = document.createElementNS(NS, tag);
        const a = attrs || {};
        Object.keys(a).forEach((k) => {
            if (a[k] == null) return;
            n.setAttribute(k, a[k]);
        });
        return n;
    }

    const p = (v) => Math.round(v * 100) / 100;
    const pt = (x, y) => p(x) + ',' + p(y);
    /** Float dust off a tick value: 0.1 * 3 is 0.30000000000000004. */
    const tidy = (v) => parseFloat(v.toPrecision(12));

    /**
     * Thousands separators without a locale. toLocaleString reads the runner's
     * ICU, which is not the reader's, and a chart label that differs between CI
     * and the browser is a test nobody can trust.
     *
     * ⛔ THE GROUPING RUNS ON THE INTEGER PART ONLY. Over the whole string the
     * same regex puts a separator inside the FRACTION — 0.0001 printed as
     * "0.0,001" and 0.000123 as "0.000,123", a comma where there is no
     * thousand. This is the default y formatter, so every rate, error fraction
     * and per-unit cost hit it. An exponent survives untouched, because a
     * string like "1e-7" holds no run of three digits to group.
     */
    function num(v) {
        if (!Number.isFinite(v)) return '';
        const a = Math.abs(v);
        let r = v;
        if (a >= 1000) r = Math.round(v);
        else if (a >= 1) r = Math.round(v * 100) / 100;
        else r = parseFloat(v.toPrecision(3));
        const s = String(r);
        const dot = s.indexOf('.');
        const head = dot < 0 ? s : s.slice(0, dot);
        return head.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dot < 0 ? '' : s.slice(dot));
    }

    /** The 1 / 2 / 5 ladder: the step at or above `raw` that reads as a number. */
    function nice(raw) {
        if (!(raw > 0) || !isFinite(raw)) return 1;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        let mult = 10;
        if (norm <= 1) mult = 1;
        else if (norm <= 2) mult = 2;
        else if (norm <= 5) mult = 5;
        return mult * mag;
    }

    /** The next rung up the same ladder. */
    function coarser(step) {
        const mag = Math.pow(10, Math.floor(Math.log10(step)));
        const norm = Math.round(step / mag);
        let mult = 10;
        if (norm < 2) mult = 2;
        else if (norm < 5) mult = 5;
        return mult * mag;
    }

    /**
     * A zero-anchored scale with clean ticks.
     *
     * ⛔ NOT charts.js:149-150 (`min * 0.9` to `max * 1.1`), which never starts
     * at zero and turns inside out on a negative value. A bar's length and an
     * area's fill both encode magnitude by size, so a baseline anywhere but
     * zero misstates the quantity. Because `lo` is a whole multiple of the
     * step and the domain always spans zero, zero always lands exactly on a
     * gridline, which is what makes a negative bar readable.
     */
    function scaleFor(values) {
        let lo0 = 0;
        let hi0 = 0;
        values.forEach((v) => {
            if (v < lo0) lo0 = v;
            if (v > hi0) hi0 = v;
        });
        let step = nice((hi0 - lo0 || 1) / MAX_BANDS);
        let lo = Math.floor(lo0 / step) * step;
        let bands = Math.max(1, Math.ceil((hi0 - lo) / step));
        let guard = 0;
        while (bands > MAX_BANDS && guard < 12) {
            step = coarser(step);
            lo = Math.floor(lo0 / step) * step;
            bands = Math.max(1, Math.ceil((hi0 - lo) / step));
            guard += 1;
        }
        const ticks = [];
        for (let i = 0; i <= bands; i += 1) ticks.push(tidy(lo + step * i));
        return { lo: tidy(lo), hi: tidy(lo + step * bands), ticks: ticks };
    }

    /** Only points with a real number. A string '30' is not one: Number(null)
     *  is 0, and coercing would turn a missing value into a drawn zero. */
    function finite(series, option) {
        return listOf(series, 'chart', option).filter((q) => q && typeof q.y === 'number' && Number.isFinite(q.y));
    }

    /**
     * The overlay's points, or none.
     *
     * ⛔ TWO, THE SAME MINIMUM `series` ENFORCES. One point cannot be a line:
     * the path painted nothing while the legend still claimed a second series
     * and the readout held that single value against every point in the main
     * one. `length === 1`, not `< 2`, because `compare: []` is how a caller
     * says "no previous period" and naming that would be noise on every render.
     */
    function overlay(v) {
        const c = finite(v, 'compare');
        if (c.length === 1) {
            warn('[Kit] chart: `compare` needs two usable points to draw a line; got 1. Dropping the overlay.');
            return [];
        }
        return c;
    }

    function defaultX(kind) {
        if (kind === 'bars-by-hour') {
            return (x) => (Number.isFinite(x) ? String(x).padStart(2, '0') + ':00' : String(x == null ? '' : x));
        }
        return (x) => (x == null ? '' : String(x));
    }

    /**
     * The two mappings every kind needs: a value onto the value axis, and an
     * index onto the category axis. `i` takes fractions, so a compare series of
     * a different length lands on the same span.
     */
    function geometry(kind, n, sc, vbH) {
        const horiz = kind === 'hbars';
        const span = sc.hi - sc.lo || 1;
        const plotH = vbH - PAD_T - PAD_B;
        let slot = VB_W / n;
        if (horiz) slot = ROW_H;
        // An area's points sit ON the edges, so its columns tile at n - 1.
        else if (kind === 'area') slot = n < 2 ? VB_W : VB_W / (n - 1);
        return {
            horiz: horiz,
            slot: slot,
            vbH: vbH,
            v: function (val) {
                const f = (val - sc.lo) / span;
                return horiz ? VB_W * f : PAD_T + plotH * (1 - f);
            },
            i: function (idx) {
                if (horiz) return PAD_T + (idx + 0.5) * ROW_H;
                if (kind === 'area') return n < 2 ? VB_W / 2 : (idx * VB_W) / (n - 1);
                return ((idx + 0.5) * VB_W) / n;
            }
        };
    }

    /**
     * A rect with its corners rounded per `rr` = [tl, tr, br, bl]. Only the
     * DATA end is rounded; the baseline end stays square, which is what makes a
     * bar read as growing out of the axis rather than floating over it.
     */
    /** The bar that gets the accent: the largest value, first on a tie. */
    function litIndex(pts) {
        let best = -1;
        for (let i = 0; i < pts.length; i++) {
            if (best === -1 || pts[i].y > pts[best].y) best = i;
        }
        return best;
    }
    /** One decimal, no trailing noise: the same shape linePath writes. */
    function fmt(v) {
        return String(Math.round(v * 10) / 10);
    }

    function roundRect(x, y, w, h, rr) {
        const cap = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
        const r = rr.map((v) => Math.max(0, Math.min(v, cap)));
        const arc = (rad, ex, ey) => (rad ? 'A' + p(rad) + ',' + p(rad) + ' 0 0 1 ' + pt(ex, ey) : 'L' + pt(ex, ey));
        return [
            'M' + pt(x + r[0], y),
            'L' + pt(x + w - r[1], y),
            arc(r[1], x + w, y + r[1]),
            'L' + pt(x + w, y + h - r[2]),
            arc(r[2], x + w - r[2], y + h),
            'L' + pt(x + r[3], y + h),
            arc(r[3], x, y + h - r[3]),
            'L' + pt(x, y + r[0]),
            arc(r[0], x + r[0], y),
            'Z'
        ].join('');
    }

    /** Straight segments, never a spline: a curve through bucketed data draws
     *  values that were never measured. */
    const linePath = (pts) => pts.map((q, i) => (i ? 'L' : 'M') + pt(q.x, q.y)).join('');

    function paint(st) {
        const kind = st.kind;
        const pts = st.pts;
        const cmp = st.cmp;
        const n = pts.length;
        const horiz = kind === 'hbars';
        const vbH = horiz ? PAD_T + ROW_H * n + PAD_B : PAD_T + PLOT_H + PAD_B;
        const sc = scaleFor(pts.map((q) => q.y).concat(cmp.map((q) => q.y)));
        const g = geometry(kind, n, sc, vbH);

        const svg = svgEl('svg', {
            class: 'kit-chart kit-chart--' + kind,
            viewBox: '0 0 ' + VB_W + ' ' + vbH,
            height: vbH,
            preserveAspectRatio: 'none',
            role: 'img',
            tabindex: '0',
            'aria-label': st.ariaLabel,
            'aria-describedby': st.hintId
        });

        // The wash. Its two stops take their colour from CSS classes; only the
        // reference is written here, because a gradient must be addressed by id.
        if (kind === 'area') {
            const grad = svgEl('linearGradient', { id: st.gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
            grad.appendChild(svgEl('stop', { offset: '0', class: 'kit-chart__stop-a' }));
            grad.appendChild(svgEl('stop', { offset: '1', class: 'kit-chart__stop-b' }));
            const defs = svgEl('defs', null);
            defs.appendChild(grad);
            svg.appendChild(defs);
        }

        // Grid: solid hairlines, one step off the surface, never dashed.
        sc.ticks.forEach((t) => {
            const c = g.v(t);
            const line = horiz
                ? svgEl('line', { x1: p(c), y1: 0, x2: p(c), y2: vbH })
                : svgEl('line', { x1: 0, y1: p(c), x2: VB_W, y2: p(c) });
            line.setAttribute('class', 'kit-chart__grid' + (t === 0 ? ' kit-chart__grid--zero' : ''));
            svg.appendChild(line);
        });

        const marks = [];
        if (kind === 'area') {
            const line = pts.map((q, i) => ({ x: g.i(i), y: g.v(q.y) }));
            const base = g.v(0);
            svg.appendChild(
                svgEl('path', {
                    class: 'kit-chart__fill',
                    fill: 'url(#' + st.gradId + ')',
                    d: linePath(line) + 'L' + pt(line[n - 1].x, base) + 'L' + pt(line[0].x, base) + 'Z'
                })
            );
            svg.appendChild(svgEl('path', { class: 'kit-chart__ln', d: linePath(line) }));
            // The endpoint is marked because the endpoint is today. A zero-length
            // <line> with a round, non-scaling cap is the one mark that stays a
            // circle under the horizontal stretch (a <circle> becomes an ellipse).
            const last = line[n - 1];
            svg.appendChild(
                svgEl('line', {
                    class: 'kit-chart__dot',
                    x1: fmt(last.x),
                    y1: fmt(last.y),
                    x2: fmt(last.x),
                    y2: fmt(last.y)
                })
            );
        } else {
            const zero = g.v(0);
            // One bar is lit: the largest, in the module accent. The others stay
            // quiet so the comparison reads at a glance. Ties light the first.
            const lit = litIndex(pts);
            pts.forEach((q, i) => {
                const c = g.i(i);
                const val = g.v(q.y);
                const thick = Math.max(1, Math.min(g.slot - BAR_GAP * 2, BAR_W_MAX));
                let d;
                if (horiz) {
                    const rr = q.y < 0 ? [BAR_R, 0, 0, BAR_R] : [0, BAR_R, BAR_R, 0];
                    d = roundRect(Math.min(zero, val), c - thick / 2, Math.abs(val - zero), thick, rr);
                } else {
                    const rr = q.y < 0 ? [0, 0, BAR_R, BAR_R] : [BAR_R, BAR_R, 0, 0];
                    d = roundRect(c - thick / 2, Math.min(zero, val), thick, Math.abs(val - zero), rr);
                }
                const bar = svgEl('path', {
                    class: 'kit-chart__bar' + (i === lit ? ' is-lit' : ''),
                    d: d,
                    'data-i': String(i)
                });
                svg.appendChild(bar);
                marks.push(bar);
            });
        }

        // The previous period: one path for every kind, dashed, so identity is
        // never carried by colour alone.
        if (cmp.length) {
            const m = cmp.length;
            const line = cmp.map((q, i) => {
                const along = g.i((m < 2 ? 0.5 : i / (m - 1)) * (n - 1));
                return horiz ? { x: g.v(q.y), y: along } : { x: along, y: g.v(q.y) };
            });
            svg.appendChild(svgEl('path', { class: 'kit-chart__cmp', d: linePath(line) }));
        }

        // The crosshair. A reader aims at a date, never at a 2px line, and a
        // <line> with a non-scaling stroke survives the horizontal stretch that
        // would turn a <circle> into an ellipse.
        let cross = null;
        if (kind === 'area') {
            cross = svgEl('line', {
                class: 'kit-chart__cross kit-chart__cross--off',
                x1: 0,
                y1: 0,
                x2: 0,
                y2: vbH
            });
            svg.appendChild(cross);
        }

        // Hit targets: the whole column or row, never the painted pixels.
        const hits = pts.map((q, i) => {
            const c = g.i(i);
            const a = Math.max(0, c - g.slot / 2);
            const b = Math.min(horiz ? vbH : VB_W, c + g.slot / 2);
            const hit = horiz
                ? svgEl('rect', { x: 0, y: p(a), width: VB_W, height: p(b - a) })
                : svgEl('rect', { x: p(a), y: 0, width: p(b - a), height: vbH });
            hit.setAttribute('class', 'kit-chart__hit');
            hit.setAttribute('data-i', String(i));
            svg.appendChild(hit);
            return hit;
        });

        // The label layers. HTML, not <text>: see the header.
        const gut = el('div', { class: 'kit-chart__gut' });
        const axis = el('div', { class: 'kit-chart__axis' });
        const kids = [gut, svg, axis];

        if (horiz) {
            pts.forEach((q, i) => {
                gut.appendChild(
                    el('span', {
                        class: 'kit-chart__lbl kit-chart__lbl--cat',
                        style: 'top:' + p(g.i(i)) + 'px',
                        text: st.xFormat(q.x, i)
                    })
                );
            });
            sc.ticks.forEach((t) => {
                axis.appendChild(
                    el('span', {
                        class: 'kit-chart__lbl kit-chart__lbl--x',
                        style: 'left:' + p((g.v(t) / VB_W) * 100) + '%',
                        text: st.yFormat(t)
                    })
                );
            });
            const vals = el('div', { class: 'kit-chart__vals' });
            pts.forEach((q, i) => {
                vals.appendChild(
                    el('span', {
                        class: 'kit-chart__lbl kit-chart__lbl--val' + (q.y < 0 ? ' kit-chart__lbl--val-l' : ''),
                        style: 'left:' + p((g.v(q.y) / VB_W) * 100) + '%; top:' + p(g.i(i)) + 'px',
                        text: st.yFormat(q.y)
                    })
                );
            });
            kids.push(vals);
        } else {
            sc.ticks.forEach((t) => {
                gut.appendChild(
                    el('span', {
                        class: 'kit-chart__lbl kit-chart__lbl--y',
                        style: 'top:' + p(g.v(t)) + 'px',
                        text: st.yFormat(t)
                    })
                );
            });
            const stride = Math.max(1, Math.ceil(n / MAX_X_LBL));
            for (let i = 0; i < n; i += stride) {
                const f = g.i(i) / VB_W;
                // 🪤 A LABEL CENTRED ON A POINT THAT SITS ON THE PLOT BOUNDARY
                // HANGS HALF OF ITSELF OFF IT. An area's points sit ON the
                // edges (its columns tile at n - 1), so the last one is at
                // f === 1 and the gutter beyond it is 16px; measured in
                // Chromium, 19.9px of a 71.9px label was cut. Weekday names
                // survive it, dates and store names do not. The flag comes off
                // the POSITION and not off the kind, so the bar kinds — whose
                // columns are centred in their slots and never reach an edge —
                // are untouched, and any later kind that does sit on the edge
                // is covered without being remembered.
                let edge = '';
                if (f <= 0) edge = ' kit-chart__lbl--x-first';
                else if (f >= 1) edge = ' kit-chart__lbl--x-last';
                axis.appendChild(
                    el('span', {
                        class: 'kit-chart__lbl kit-chart__lbl--x' + edge,
                        style: 'left:' + p(f * 100) + '%',
                        text: st.xFormat(pts[i].x, i)
                    })
                );
            }
        }

        const root = el('div', { class: 'kit-chart__root kit-chart__root--' + kind });
        // ⛔ THE DESCRIPTION AND THE LIVE REGION CANNOT BE ONE NODE. A
        // role=status node is announced whenever its text changes; an
        // aria-describedby target is announced on focus. Point the second at
        // the first and focusing reads the value twice — once as the
        // description, once as the live update. A static hint is the honest
        // thing to describe the chart WITH, and it answers the other half at
        // the same time: nothing otherwise tells a keyboard reader that the
        // arrows do anything at all.
        root.appendChild(
            el('span', {
                class: 'kit-chart__hint',
                id: st.hintId,
                text: 'Use the arrow keys to read each point.'
            })
        );
        if (cmp.length) {
            root.appendChild(
                el('div', { class: 'kit-chart__key' }, [
                    el('span', { class: 'kit-chart__key-i' }, [
                        el('span', { class: 'kit-chart__key-ln kit-chart__key-ln--now' }),
                        el('span', { text: 'This period' })
                    ]),
                    el('span', { class: 'kit-chart__key-i' }, [
                        el('span', { class: 'kit-chart__key-ln kit-chart__key-ln--prev' }),
                        el('span', { text: 'Previous period' })
                    ])
                ])
            );
        }
        root.appendChild(el('div', { class: 'kit-chart__wrap kit-chart__wrap--' + kind }, kids));

        return { root: root, svg: svg, hits: hits, marks: marks, cross: cross, geo: g, vbH: vbH };
    }

    Kit.chart = function chart(host, opts) {
        const o = opts || {};
        let kind = o.kind;
        if (!kindOf(kind)) {
            warn('[Kit] chart: unknown kind ' + JSON.stringify(kind) + ', drawing an area chart instead.');
            kind = 'area';
        }
        const pts = finite(o.series, 'series');
        // Fewer than two usable points is not a chart, it is a Kit.kpi. Return
        // null and leave the host alone: the caller's region owns the states.
        if (!host || pts.length < 2) return null;

        // A second chart on one host would orphan the first tooltip in body.
        if (host.__kitChart) host.__kitChart.destroy();

        seq += 1;
        const st = {
            kind: kind,
            pts: pts,
            cmp: overlay(o.compare),
            yFormat: typeof o.yFormat === 'function' ? o.yFormat : num,
            xFormat: typeof o.xFormat === 'function' ? o.xFormat : defaultX(kind),
            gradId: 'kit-chart-fill-' + seq,
            tipId: 'kit-chart-tip-' + seq,
            hintId: 'kit-chart-hint-' + seq,
            ariaLabel: o.ariaLabel || KINDS[kind].label + ', ' + pts.length + ' ' + KINDS[kind].noun
        };

        // ⛔ The tooltip cannot live in the host: .kit-block sets
        // overflow: hidden, so a readout above the top point would be cut off.
        // A body-appended surface carries `class="kit"` so the tokens and the
        // dark scope (body:not(.light-mode) .kit) still reach it. role=status
        // makes an arrow-key walk audible.
        const tip = el('div', { class: 'kit kit-tip', id: st.tipId, role: 'status' });
        document.body.appendChild(tip);

        let view = null;
        let active = -1;
        let dead = false;
        let tracking = false;

        function mark(i) {
            const lit = litIndex(st.pts);
            view.marks.forEach((m, j) =>
                m.setAttribute('class', 'kit-chart__bar' + (j === lit ? ' is-lit' : '') + (j === i ? ' is-active' : ''))
            );
            if (!view.cross) return;
            if (i >= 0) {
                const x = p(view.geo.i(i));
                view.cross.setAttribute('x1', x);
                view.cross.setAttribute('x2', x);
            }
            view.cross.setAttribute('class', 'kit-chart__cross' + (i < 0 ? ' kit-chart__cross--off' : ''));
        }

        function place(i) {
            // In jsdom this rect is all zeros and the tooltip lands at 0,0.
            // Harmless: nothing here derives STRUCTURE from a measurement.
            const box = view.svg.getBoundingClientRect();
            const g = view.geo;
            const fx = g.horiz ? g.v(st.pts[i].y) / VB_W : g.i(i) / VB_W;
            const fy = g.horiz ? g.i(i) / view.vbH : g.v(st.pts[i].y) / view.vbH;
            tip.style.left = Math.round(box.left + box.width * fx) + 'px';
            tip.style.top = Math.round(box.top + box.height * fy) + 'px';
        }

        /**
         * The readout is `position: fixed`, anchored to a rect measured when it
         * opened, so anything that moves the chart under it leaves it naming a
         * mark it is nowhere near — measured by the review at 420px adrift
         * after a 500px scroll, and 63px after a narrowing. The keyboard path
         * has no rescue of its own at all: the chart keeps focus while the page
         * scrolls, so no pointer event ever fires to correct it.
         *
         * ⛭ IT REPOSITIONS WHERE js/kit/forms.js:874-882 CLOSES. Same two
         * listeners, same capture flag, opposite response, and the difference
         * is what the surface IS: a popover is a menu anchored to a control and
         * a scroll usually means the reader moved on, while this is a readout
         * attached to a mark the reader is still walking with the keyboard.
         * Closing it there would dismiss the thing they are reading.
         *
         * ⛭ CAPTURE, like forms.js:895. A scroll event does not bubble past the
         * element that scrolled, so a bubble listener on window never hears
         * `.portal-main` move — which is the element that actually scrolls in
         * this portal.
         */
        function track(on) {
            if (on === tracking) return;
            tracking = on;
            if (on) {
                window.addEventListener('scroll', onView, true);
                window.addEventListener('resize', onView);
            } else {
                window.removeEventListener('scroll', onView, true);
                window.removeEventListener('resize', onView);
            }
        }

        function onView() {
            // ⛔ SELF-HEAL FIRST, the shape js/kit/forms.js:311-327 chose for
            // the same caller bug: a module that re-renders its host out from
            // under an open surface leaves a visible node behind with nothing
            // left that can dismiss it. Here that is a readout naming a chart
            // that is gone, and no pointerleave will ever arrive to clear it.
            // ⚠️ It still needs A scroll or A resize to notice, exactly as the
            // dialog still needs a keystroke. A page that does neither keeps
            // the orphan; only a MutationObserver would close that, and that is
            // a standing cost on every chart for a case that is already a
            // caller bug.
            if (!view || !view.svg.isConnected) {
                api.destroy();
                return;
            }
            if (active >= 0) place(active);
        }

        function hide() {
            track(false);
            active = -1;
            tip.className = 'kit kit-tip';
            tip.replaceChildren();
            if (view) mark(-1);
        }

        function show(i) {
            if (i < 0 || i >= st.pts.length) return;
            // ⛔ EVERY POINTERMOVE INSIDE ONE COLUMN USED TO REDO ALL OF THIS.
            // Measured by the review: 40 moves across a single column produced
            // 40 forced layouts and 122 mutation records on a role=status node
            // whose text never changed — and every one of those records is an
            // announcement. place() anchors to the DATA POINT and never to the
            // pointer, so the position inside a column is identical and the
            // work is pure waste. A real mouse sweep produces hundreds.
            if (i === active) return;
            active = i;
            const q = st.pts[i];
            // ⛔ textContent, all the way down. `Kit.el` sets `text` with
            // textContent for exactly this reason; charts.js:335 does not.
            tip.replaceChildren(
                el('div', { class: 'kit-tip__v', text: st.yFormat(q.y) }),
                el('div', { class: 'kit-tip__k', text: st.xFormat(q.x, i) })
            );
            if (st.cmp.length) {
                const m = st.cmp.length;
                const j = Math.min(m - 1, Math.round((i / Math.max(1, st.pts.length - 1)) * (m - 1)));
                tip.appendChild(
                    el('div', { class: 'kit-tip__row' }, [
                        el('span', { class: 'kit-tip__ln' }),
                        el('span', { class: 'kit-tip__t', text: 'Previous period' }),
                        el('span', { class: 'kit-tip__n', text: st.yFormat(st.cmp[j].y) })
                    ])
                );
            }
            tip.className = 'kit kit-tip kit-tip--on';
            place(i);
            mark(i);
            track(true);
        }

        function onPointer(e) {
            const node = e.target && e.target.closest ? e.target.closest('.kit-chart__hit') : null;
            if (!node) {
                hide();
                return;
            }
            show(Number(node.getAttribute('data-i')));
        }

        function onFocus() {
            if (active < 0) show(0);
        }

        function onKey(e) {
            const last = st.pts.length - 1;
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
            // ⛔ A REDRAW REPLACES THE ELEMENT THE READER WAS WALKING, so
            // without this a polling chart throws them back to the document
            // body on every refresh, mid-walk.
            const wasAt = active;
            const hadFocus = !!(view && view.svg === document.activeElement);
            view = paint(st);
            view.svg.addEventListener('pointermove', onPointer);
            view.svg.addEventListener('pointerleave', hide);
            view.svg.addEventListener('focus', onFocus);
            view.svg.addEventListener('blur', hide);
            view.svg.addEventListener('keydown', onKey);
            host.replaceChildren(view.root);
            hide();
            if (!hadFocus) return;
            // ⛭ show() BEFORE focus(), not after. focus() fires onFocus, which
            // starts the walk at 0 whenever nothing is active; restoring the
            // cursor first makes that a no-op, so the reader is announced once,
            // at the point they were actually on. If the series shrank past it,
            // the fallback to 0 is what they get, which is the sensible answer.
            // ⛭ GUARDED ON isConnected, like js/kit/forms.js:1400: focusing a
            // node that is not in the document is a silent no-op, and a host
            // that is itself detached would leave the keyboard on the body with
            // this function believing it had put it back.
            if (wasAt >= 0 && wasAt < st.pts.length) show(wasAt);
            if (view.svg.isConnected && typeof view.svg.focus === 'function') view.svg.focus();
        }

        draw();

        const api = {
            update: function update(series, compare) {
                // ⛭ THIS is the observable half of `dead`. Without it a refetch
                // that lands after destroy() draws the chart straight back into
                // the host with its tooltip already out of the document, so the
                // readout is gone and nothing anywhere says why. Measured.
                if (dead) return false;
                const next = finite(series, 'series');
                // A refetch never blanks the chart: hold the last frame and say
                // so, rather than flashing an empty box at the reader.
                if (next.length < 2) return false;
                st.pts = next;
                st.cmp = overlay(compare);
                if (!o.ariaLabel) {
                    st.ariaLabel = KINDS[kind].label + ', ' + next.length + ' ' + KINDS[kind].noun;
                }
                draw();
                return true;
            },
            destroy: function destroy() {
                // ⛭ Belt and braces, and said out loud so nobody reads it as
                // load-bearing: with it deleted a second destroy() is still a
                // no-op — the host is already empty, the flag already gone,
                // tip.parentNode already null — so no test can hold it and
                // none pretends to. It is here for whatever this function
                // grows next, and `dead = true` on the line below is the part
                // that does the work, through update().
                if (dead) return;
                dead = true;
                track(false);
                host.replaceChildren();
                if (host.__kitChart === api) delete host.__kitChart;
                if (tip.parentNode) tip.parentNode.removeChild(tip);
                view = null;
            }
        };
        host.__kitChart = api;
        return api;
    };
})();
