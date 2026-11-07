/* ===========================================================================
 * The portal kit, core: the DOM helper, the four states, and the region that
 * has to choose between them.
 *
 * ⛔⛔ THE WHOLE KIT'S HONESTY RUNS THROUGH `Kit.region`. Every screen loads
 * asynchronously, and there are FOUR outcomes, not two:
 *
 *     loaded      rows came back          -> render them
 *     empty       the read SUCCEEDED and
 *                 there is nothing        -> keep the surface, say what would
 *                                            fill it, offer the create action
 *                                            only where a write path exists
 *     unread      the read FAILED         -> different words, a retry, and NO
 *                                            create button, ever
 *     not set up  the server ANSWERED and
 *                 said the feature is off -> different words again: nothing is
 *                                            broken and nothing is missing
 *
 * The third is the one every implementation drops, because `catch { rows = [] }`
 * is shorter than doing it properly and reads fine in review. It is also how a
 * page tells a manager with fifty employees that they have none.
 *
 * ⛔ A FAILED READ DOES NOT ALWAYS REJECT. The shared ApiClient RETURNS NULL
 * when an interceptor marks an error handled, which both of them do
 * unconditionally for any 401 (js/api.js:267), and a 401 is ordinary during the
 * window after sign-in before the token is ready. So the promise RESOLVES,
 * `.catch` never runs, and without the null guard below `rowsOf(null)` is `[]`
 * and the empty state paints over a store nobody read.
 *
 * ⛔ NO innerHTML anywhere. Every string that reaches this file is tenant data.
 * ⛔ NO colour set from JavaScript. Tone is a class; css/kit.css owns the value.
 * ⛔ NO native control: no <select>, no input[type=date|time|color], no
 *    datalist, no window.confirm/alert/prompt. Those live in js/kit/forms.js as
 *    real components, and __tests__/kit/native-controls.contract.test.js scans
 *    this directory for them.
 *
 * Load order: this file first, then components.js, forms.js, chart.js. Each is
 * an IIFE that extends window.Kit and refuses to run twice.
 *
 * Spec: docs/superpowers/specs/2026-09-02-portal-ui-refresh-design.md, 3.3 and
 * 4. Living doc: docs/ARGUS_PORTAL_DESIGN_SYSTEM.md.
 * =========================================================================== */
(function () {
    'use strict';

    // A second run must be a no-op, not a fresh set of functions replacing the
    // ones an already mounted module is holding. The flag is set at the BOTTOM
    // of the file, so a run that threw halfway does not claim to have loaded.
    if (window.Kit && window.Kit.__core) return;
    window.Kit = window.Kit || {};
    const Kit = window.Kit;

    /* ---------------------------------------------------------------------
     * DOM helper. Verbatim from js/employees/shell.js:19-32.
     *
     * Attr contract: `text` sets textContent, `class` sets className, `dataset`
     * takes an object of data-* keys, anything else goes through setAttribute.
     * A null or undefined attr is SKIPPED, which is what makes
     * `class: cond ? 'x' : null` work, and children are filtered, which is what
     * makes `cond ? node : null` work in a kids array. Every factory in this
     * kit relies on both.
     * ------------------------------------------------------------------- */
    function el(tag, attrs, kids) {
        const n = document.createElement(tag);
        const a = attrs || {};
        Object.keys(a).forEach((k) => {
            const v = a[k];
            if (v == null) return;
            if (k === 'text') n.textContent = v;
            else if (k === 'class') n.className = v;
            else if (k === 'dataset') Object.keys(v).forEach((d) => (n.dataset[d] = v[d]));
            else n.setAttribute(k, v);
        });
        (kids || []).filter(Boolean).forEach((c) => n.appendChild(c));
        return n;
    }

    function checkMark() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.4');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'M20 6L9 17l-5-5');
        svg.appendChild(p);
        return svg;
    }

    /* ---------------------------------------------------------------------
     * The line style (owner pick icons__line-style, "Financials icons, 1.7
     * round"; js/financials/controls.js:198-283 and view-insights.js:141-148,
     * read there, never edited).
     *
     * ONE helper draws every glyph the kit's picked parts show: Kit.glyph. A
     * glyph is path data on a 24-unit grid, stroked in the ink of whatever it
     * sits in (currentColor), 1.7 wide with round caps and joins, never
     * filled. The 1.7 is in the glyph's own 24-unit grid, so it SCALES with the
     * glyph (no vector-effect): a 20px glyph is the 16px one drawn larger, as
     * Financials draws its 14px and 16px glyphs. css/kit-standards.css (.kit-line-style)
     * owns the look; the same values are written as attributes too, so a glyph
     * placed outside a .kit root still draws as a line rather than a black
     * shape. The only colour word is currentColor, which names the cascade.
     *
     * The named set is Financials' own (its 34 control glyphs, the filled
     * checkCircle and the Insights glyphs), Settings Team's warning triangle,
     * the app notification's four circled glyphs, and two names the kit's
     * parts use for the same drawings: close (x) and back (chevronLeft).
     * ------------------------------------------------------------------- */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const GLYPHS = {
        bookmark: ['M7 3.5h10a1 1 0 0 1 1 1V21l-6-4.2L6 21V4.5a1 1 0 0 1 1-1z'],
        filter: ['M4 7h16', 'M7 12h10', 'M10 17h4'],
        chevronDown: ['M6 9l6 6 6-6'],
        chevronUp: ['M6 15l6-6 6 6'],
        chevronRight: ['M9 6l6 6-6 6'],
        chevronLeft: ['M15 6l-6 6 6 6'],
        x: ['M6 6l12 12', 'M18 6L6 18'],
        calendar: ['M4 6h16v14H4z', 'M8 3v4', 'M16 3v4', 'M4 10h16'],
        calendars: ['M3 7h13v13H3z', 'M3 11h13', 'M7 4v4', 'M12 4v4', 'M19.5 10v12.5H8'],
        sliders: [
            'M4 6h3.5',
            'M12.5 6H20',
            'M10 4.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
            'M4 12h9.5',
            'M18.5 12H20',
            'M16 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
            'M4 18h1.5',
            'M10.5 18H20',
            'M8 16.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z'
        ],
        gear: [
            'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
            'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
        ],
        tag: ['M3 4h8l9 9-8 8-9-9z', 'M7.5 8.5h.01'],
        plus: ['M12 5v14', 'M5 12h14'],
        pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
        trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
        arrows: ['M4 8h15', 'M16 5l3 3-3 3', 'M20 16H5', 'M8 13l-3 3 3 3'],
        search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
        coin: [
            'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
            'M14.8 9.3c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.7.8-2.7 1.9s1 1.7 2.7 2.1 2.7.9 2.7 2.1-1.1 2.1-2.7 2.1c-1.3 0-2.4-.5-2.9-1.5',
            'M12 6v1.9',
            'M12 16.1V18'
        ],
        store: ['M4 10v10h16V10', 'M3 4h18l-1.5 6h-15z', 'M10 20v-5h4v5'],
        list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
        eyeOff: [
            'M3 3l18 18',
            'M10.6 5.1c.5-.1.9-.1 1.4-.1 5 0 9 4.5 9 7 0 1.2-.9 2.8-2.4 4.2',
            'M6.6 6.6C4.4 8 3 10.2 3 12c0 2.5 4 7 9 7 1.6 0 3.1-.4 4.4-1.1',
            'M9.9 9.9a3 3 0 0 0 4.2 4.2'
        ],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        chartMixed: ['M5 20v-5', 'M10 20v-8', 'M15 20v-6', 'M20 20V10', 'M4 11l5-4.5 5 3 6-5.5'],
        chartLine: ['M4 4v16h16', 'M7.5 15l3.5-4 3 2.5 5-6'],
        chartColumn: ['M4 4v16h16', 'M8 16v-4', 'M11.5 16V9', 'M15 16v-5', 'M18.5 16V7'],
        sankey: ['M3 12h6', 'M9 12c4 0 5-6 9-6h3', 'M9 12c4 0 5 6 9 6h3', 'M9 12h12'],
        grid: [
            'M4 4h4v4H4z',
            'M10 4h4v4h-4z',
            'M16 4h4v4h-4z',
            'M4 10h4v4H4z',
            'M10 10h4v4h-4z',
            'M16 10h4v4h-4z',
            'M4 16h4v4H4z',
            'M10 16h4v4h-4z',
            'M16 16h4v4h-4z'
        ],
        rows: [
            'M4 4h16',
            'M4 12h16',
            'M4 20h16',
            'M6 7h2v2H6z',
            'M11 7h2v2h-2z',
            'M16 7h2v2h-2z',
            'M6 15h2v2H6z',
            'M11 15h2v2h-2z',
            'M16 15h2v2h-2z'
        ],
        sort: ['M8 4v16', 'M4 8l4-4 4 4', 'M16 20V4', 'M12 16l4 4 4-4'],
        download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 21h16'],
        equals: ['M6 9h12', 'M6 15h12'],
        gte: ['M6 4l12 5-12 5', 'M6 19h12'],
        lte: ['M18 4L6 9l12 5', 'M6 19h12'],
        user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
        // Financials Insights (js/financials/view-insights.js:141-148).
        down: ['M7 7l10 10', 'M17 9v8H9'],
        up: ['M7 17L17 7', 'M9 7h8v8'],
        star: ['M12 4v16', 'M5.1 8l13.8 8', 'M5.1 16l13.8-8'],
        copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
        info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 7.5h.01'],
        // Settings Team's warning (js/settings/team.js:71).
        alert: ['M12 4l8.5 15h-17z', 'M12 10v4.5', 'M12 17v.3'],
        // The app notification's four (js/main.js:11527-11534), each circle
        // written as two arcs and each line and polyline as a path. The round
        // caps are what paint the info glyph's dot, a 0.01px line.
        circleInfo: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
        circleCheck: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
        triangleAlert: [
            'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
            'M12 9v4',
            'M12 17h.01'
        ],
        circleX: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', 'M15 9l-6 6', 'M9 9l6 6']
    };
    // The kit's own words for two of the drawings above: the same paths.
    GLYPHS.close = GLYPHS.x;
    GLYPHS.back = GLYPHS.chevronLeft;
    // The one filled glyph (js/financials/controls.js:290-301): the wine disc
    // with the tick knocked out of it (css/kit-standards.css colours both).
    const CHECK_CIRCLE = [
        ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'kit-line-style__disc'],
        ['M8 12.3l2.7 2.7L16 9.6', 'kit-line-style__knock']
    ];
    const GLYPH_SIZES = [14, 16, 20];

    /**
     * Kit.glyph(icon, { size, cls }) -> <svg> | null
     *
     *   icon  a name from the set above ('close', 'back', 'search',
     *         'chevronDown', 'check', 'checkCircle', ...), or the caller's own
     *         path data: an array of `d` strings on the 24-unit grid.
     *   size  14, 16 (the default) or 20: the three steps. A part that draws
     *         at another size passes its own class and sizes it in kit-standards.css; a
     *         part's own size, written later in the sheet, wins.
     *   cls   the part's own class, beside kit-line-style.
     *
     * Always decorative: aria-hidden, and focusable=false so an old Edge or IE
     * cannot tab into it. A glyph that is the only thing in a button takes its
     * name from the button (its aria-label), never from the glyph. An unknown
     * name draws nothing and says so; an empty list draws nothing.
     */
    function glyph(icon, o) {
        const c = o || {};
        const filled = icon === 'checkCircle';
        // An own name only: 'toString' or 'constructor' is not a glyph, and
        // reading it off the object would hand back a function.
        const named = typeof icon === 'string' && Object.prototype.hasOwnProperty.call(GLYPHS, icon);
        const paths = filled ? CHECK_CIRCLE : Array.isArray(icon) ? icon : named ? GLYPHS[icon] : null;
        if (!paths) {
            // Through Kit.warn, read at call time as the other kit files do,
            // so a page or a test that swaps the sink hears it.
            const say = typeof Kit.warn === 'function' ? Kit.warn : warn;
            say('[Kit] glyph: there is no glyph named `' + String(icon) + '`; drawing none.');
            return null;
        }
        if (!paths.length) return null;
        const size = GLYPH_SIZES.indexOf(c.size) > -1 ? c.size : 16;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute(
            'class',
            'kit-line-style' + (size === 16 ? '' : ' kit-line-style--' + size) + (c.cls ? ' ' + c.cls : '')
        );
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.7');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        paths.forEach((d) => {
            const p = document.createElementNS(SVG_NS, 'path');
            if (Array.isArray(d)) {
                p.setAttribute('d', d[0]);
                p.setAttribute('class', d[1]);
            } else p.setAttribute('d', String(d));
            svg.appendChild(p);
        });
        return svg;
    }
    // The names, for the library's sheet of the whole set.
    glyph.names = Object.keys(GLYPHS).concat(['checkCircle']);

    /* ---------------------------------------------------------------------
     * Answers.
     * ------------------------------------------------------------------- */

    /**
     * Did this read actually produce an answer?
     *
     * ⛔ The one place outside `region` that callers must ask, because the same
     * resolved-null trap applies to every direct API call a screen makes
     * alongside its regions.
     */
    function isAnswer(data) {
        return data !== null && data !== undefined;
    }

    /**
     * The rows out of a response, whatever the endpoint decided to call them.
     *
     * ⛔ `null` is NOT an empty list, and this returns `[]` for one anyway,
     * because callers legitimately pass shapes it does not know. The
     * DISCRIMINATION happens before this is reached: `region` routes a null to
     * the failed state and `isNotSetUp` catches the 200-with-no-rows envelope.
     */
    function rowsOf(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.rows)) return data.rows;
        if (Array.isArray(data.items)) return data.items;
        if (Array.isArray(data.data)) return data.data;
        // ⛔ ONE LEVEL OF `data`, THE SAME UNWRAP isNotSetUp AND blockerOf DO.
        // The house envelope is `{ success: true, data: { rows: [...] } }`, and
        // three functions in one file reading that shape by two different rules
        // is how "No employees yet" gets printed over a full table. No route
        // pairs the two halves today — three route files wrap results as
        // `{ success, data }` and five services return `{ rows }`, but none of
        // them meet — so this closes a latent trap and makes the siblings agree
        // rather than fixing something that is currently breaking.
        const env = data.data;
        if (env && typeof env === 'object' && !Array.isArray(env)) {
            if (Array.isArray(env.rows)) return env.rows;
            if (Array.isArray(env.items)) return env.items;
        }
        return [];
    }

    /**
     * ⛔⛔ THE FOURTH STATE: NOT SET UP YET.
     *
     * `GET /labor/whos-on` answers HTTP 200 with a not-implemented envelope,
     * `{ data: { implemented: false, activation_blocker: {…} } }`, for any
     * tenant with no time clock source connected. That is none of the other
     * three: not "nobody is on the clock", not "the read failed", and certainly
     * not a measured zero. Because it is a 200, no `.catch` and no null guard
     * can see it; the payload has to be read.
     *
     * Four branches, in this order, and the order is the whole point:
     * `implemented === false` is yes; an explicit `implemented === true` is no;
     * rows are no; and only an envelope with none of those lets a stray
     * `activation_blocker` decide. The two middle branches are both there
     * because without them a served page that happened to carry a blocker
     * rendered "not set up" over real rows — the first for a payload that says
     * it is implemented, the second for one that says nothing either way. See
     * the trap notes on each.
     *
     * ⛔ This block has now been wrong twice, both times because a branch was
     * added below it and the count above was not. If you add a fifth, this
     * sentence is part of the change.
     */
    function isNotSetUp(answer) {
        if (!answer || typeof answer !== 'object') return false;
        const env = answer.data && typeof answer.data === 'object' ? answer.data : answer;
        if (env.implemented === false) return true;
        // 🪤 AN EXPLICIT `true` WINS OVER THE FALLBACK BELOW. js/employees/ui.js
        // :166-171, which this ported from, fires on `implemented === false` and
        // nothing else. The blocker fallback covers an envelope that carries a
        // blocker without saying so outright, but a page the server says IS
        // implemented is not unactivated just because a blocker rode along, and
        // treating it as one paints "not set up" over real rows.
        if (env.implemented === true) return false;
        // 🪤 ROWS WIN OVER A BARE BLOCKER. With no `implemented` key at all a
        // stray blocker used to speak for the whole payload, so real rows that
        // happened to carry one were declared unactivated. The envelope already
        // carries `dependencies_met` and `degraded_components`
        // (apps/backend/types/argus-os-api.d.ts:28-29), which is exactly the
        // "real data plus a note that one agent is down" shape. A blocker only
        // decides when the payload has nothing else to say.
        if (rowsOf(answer).length) return false;
        return Boolean(env.activation_blocker || answer.activation_blocker);
    }

    /** The blocker the envelope carried, for a caller that renders its own state. */
    function blockerOf(answer) {
        if (!answer || typeof answer !== 'object') return {};
        const env = answer.data && typeof answer.data === 'object' ? answer.data : answer;
        return env.activation_blocker || answer.activation_blocker || {};
    }

    /* ---------------------------------------------------------------------
     * Surfaces.
     * ------------------------------------------------------------------- */

    /** Classes that already ARE a surface, so wrapping one would double the card. */
    const SURFACES = ['kit-block', 'kit-table', 'kit-list', 'kit-empty', 'kit-unread', 'kit-notsetup', 'kit-skel'];

    /**
     * Put a bare node onto a card.
     *
     * ⛔⛔ FOUND IN A BROWSER, NOT BY A TEST. A state rendered straight into a
     * panel host is plain centred text floating on the page background, so the
     * moment a store has no data the page LOOKS like it failed to render rather
     * than like a working page with nothing in it. jsdom applies no CSS, so no
     * render test can see this; the guard is that every state goes through here.
     */
    function onSurface(node) {
        if (!node) return node;
        const cls = String(node.className || '');
        if (SURFACES.some((c) => cls.split(/\s+/).includes(c))) return node;
        return el('div', { class: 'kit-block' }, [node]);
    }

    /**
     * What a caller's state callback handed back, or a throw.
     *
     * ⛔⛔ FORGETTING TO `return` IS THE SAME MISTAKE IN FIVE PLACES AND IT
     * USED TO FAIL FIVE DIFFERENT WAYS. `empty`, `notSetUp` and `unread` sent
     * the undefined through `onSurface` into `replaceChildren`, which
     * STRINGIFIES it, so the page rendered the literal word "undefined" to a
     * store manager. `render` had its undefined dropped by `el`'s falsy-child
     * filter and rendered a silently empty card instead — wrong in a different
     * direction, and quieter. A callback returning a string threw a raw
     * appendChild TypeError from somewhere deeper still.
     *
     * All of them are now one throw, which the settle-path try turns into the
     * drawing-failed state — the same treatment a callback that throws gets,
     * because it is the same class of bug.
     */
    function elementFrom(node, which) {
        if (node && typeof node.nodeType === 'number') return node;
        const got = node === null ? 'null' : typeof node;
        throw new TypeError('the ' + which + ' callback returned ' + got + ' instead of an element');
    }

    /* ---------------------------------------------------------------------
     * The loading frame.
     * ------------------------------------------------------------------- */

    /** Rows per shape. The table shape renders a header line plus this many. */
    const SKEL_ROWS = { 'kpi-row': 4, table: 5, list: 4, block: 3, form: 3 };

    /**
     * ⛔ TWO PARTS, AND css/kit.css DRAWS BOTH. The sheet has `.kit-skel__box`
     * (a bordered surface) and `.kit-skel__line` (a bar, with `--sm` at 60% and
     * `--xs` at 32% width) and nothing else, so every shape below is composed
     * from those. A `__row` or a `__kpi` invented here would be an unstyled div:
     * no error, no red test, and a loading state that renders as a gap.
     */
    function skelLine(mod) {
        return el('span', { class: 'kit-skel__line' + (mod ? ' kit-skel__line--' + mod : '') });
    }

    function skelBox(lines) {
        return el('div', { class: 'kit-skel__box' }, lines);
    }

    /**
     * The shape of what is coming, while it is coming.
     *
     * ⛔ NOT a spinner and NOT the empty state. Rendering the empty state during
     * a load makes an empty store flash on every navigation, and a spinner over
     * a blank card tells the reader nothing about what will be there. The
     * skeleton is silent: no text at all, `aria-busy` and one label for screen
     * readers, so nobody reads a placeholder as a value.
     *
     * @param shape one of kpi-row, table, list, block, form. Anything else is a
     *              block, because an unknown shape must still paint something.
     * @param n     rows, fields or cells; each shape has its own default.
     */
    function skeleton(shape, n) {
        const kind = Object.prototype.hasOwnProperty.call(SKEL_ROWS, shape) ? shape : 'block';
        const count = typeof n === 'number' && isFinite(n) && n > 0 ? Math.floor(n) : SKEL_ROWS[kind];
        const root = el('div', {
            class: 'kit-skel kit-skel--' + kind,
            // ⛔ WITHOUT A ROLE THE LABEL IS DROPPED. A bare <div> has the
            // implicit `generic` role, which takes no accessible name, so
            // aria-label never reaches a screen reader and only aria-busy
            // survives. `status` accepts a name and is what a loading
            // placeholder is.
            role: 'status',
            'aria-busy': 'true',
            'aria-label': 'Loading'
        });

        // kpi-row is the one shape whose root is a track of boxes; the sheet
        // gives .kit-skel--kpi-row an auto-fit column list for exactly that.
        // Every other shape is one tall box on a single column.
        if (kind === 'kpi-row') {
            for (let i = 0; i < count; i += 1) root.appendChild(skelBox([skelLine('xs'), skelLine('sm')]));
            return root;
        }

        const lines = [];
        if (kind === 'table') {
            lines.push(skelLine('sm'));
            for (let i = 0; i < count; i += 1) lines.push(skelLine());
        } else if (kind === 'list') {
            for (let i = 0; i < count; i += 1) {
                lines.push(skelLine());
                lines.push(skelLine('xs'));
            }
        } else if (kind === 'form') {
            for (let i = 0; i < count; i += 1) {
                lines.push(skelLine('xs'));
                lines.push(skelLine());
            }
        } else {
            lines.push(skelLine('sm'));
            for (let i = 0; i < count; i += 1) lines.push(skelLine());
        }
        root.appendChild(skelBox(lines));
        return root;
    }

    /* ---------------------------------------------------------------------
     * The three settled states.
     * ------------------------------------------------------------------- */

    /**
     * The read SUCCEEDED and there is nothing yet.
     *
     * @param o.what   a lower-case plural noun: "employees", "shifts"
     * @param o.hint   what WOULD be here and where it comes from
     * @param o.action { label, onClick }, and ONLY where a write path exists.
     *                 Omitted for surfaces fed by another system, where a button
     *                 cannot help and a sentence that explains is better.
     */
    function empty(o) {
        const opts = o || {};
        const what = opts.what || 'anything';
        const box = el('div', { class: 'kit-empty' }, [
            el('div', { class: 'kit-empty__mark', 'aria-hidden': 'true' }, [checkMark()]),
            el('div', { class: 'kit-empty__title', text: 'No ' + what + ' yet' }),
            opts.hint ? el('div', { class: 'kit-empty__body', text: opts.hint }) : null
        ]);
        // 🪤 The handler is the CONDITION, not an afterthought: `unread` guards
        // its retry the same way thirty lines below, and an action with no
        // onClick used to render a primary button that silently did nothing.
        if (opts.action && typeof opts.action.onClick === 'function') {
            const b = el('button', {
                class: 'kit-btn kit-btn--primary',
                type: 'button',
                text: opts.action.label || 'Add'
            });
            b.addEventListener('click', opts.action.onClick);
            box.appendChild(el('div', { class: 'kit-empty__action' }, [b]));
        }
        return box;
    }

    /**
     * The read FAILED.
     *
     * ⛔⛔ SEPARATE FROM `empty` ON PURPOSE, WITH DIFFERENT WORDS AND NO CREATE
     * BUTTON, EVER. Telling someone to add their first employee because a
     * request timed out is worse than saying nothing. The retry is the only
     * control here, and it is a plain button: a primary button on this surface
     * would read as the create action the state exists to withhold.
     */
    function unread(o) {
        const opts = o || {};
        const what = opts.what || 'this';
        const box = el('div', { class: 'kit-unread' }, [
            el('div', { class: 'kit-unread__title', text: 'Could not load ' + what }),
            el('div', {
                class: 'kit-unread__body',
                text: 'The request failed, so this is not a statement that there is nothing here.'
            })
        ]);
        if (typeof opts.onRetry === 'function') {
            const b = el('button', { class: 'kit-btn', type: 'button', text: 'Try again' });
            b.addEventListener('click', opts.onRetry);
            box.appendChild(el('div', { class: 'kit-unread__action' }, [b]));
        }
        return box;
    }

    /**
     * The server ANSWERED and said this is not turned on here.
     *
     * ⛔ Deliberately NOT the failure wording and NOT the empty wording. Nothing
     * is broken and nothing is missing; it has not been connected. Telling a
     * store either of the other two sends them looking for a fault that does not
     * exist.
     *
     * 🪤 `what` reads as a SUBJECT here ("The roll call is not set up") while
     * `empty` and `unread` want a lower-case plural noun. `region` hands the
     * same `o.what` to all three, so a module whose noun cannot do both jobs
     * passes its own `notSetUp` instead.
     *
     * @param o.what  the subject of the sentence
     * @param o.needs a noun phrase for what has to be connected
     * @param o.href  a Settings route; renders a Set up link when given
     */
    function notSetUp(o) {
        const opts = o || {};
        const what = opts.what || 'This';
        const box = el('div', { class: 'kit-notsetup' }, [
            el('div', { class: 'kit-notsetup__title', text: what + ' is not set up' }),
            el('div', {
                class: 'kit-notsetup__body',
                text: opts.needs
                    ? 'Nothing is wrong and nothing is missing. It fills in here once ' + opts.needs + ' is connected.'
                    : 'Nothing is wrong and nothing is missing. It has not been connected here yet.'
            })
        ]);
        if (opts.href) {
            box.appendChild(
                el('div', { class: 'kit-notsetup__action' }, [
                    el('a', { class: 'kit-btn', href: opts.href, text: 'Set up' })
                ])
            );
        }
        return box;
    }

    /**
     * The read SUCCEEDED and a caller's own callback threw.
     *
     * ⛔⛔ NOT the `unread` wording. Telling someone "the request failed" when
     * the data is sitting in hand is this file's own class of lie with the
     * polarity reversed, and it points a store manager at their network for
     * what is a frontend bug. It carries NO retry: the same data throws every
     * time, so the button would loop forever.
     *
     * ⛭ It reuses the `.kit-unread` SURFACE because the two states look the
     * same and say different things. The `--render` modifier is not drawn by
     * css/kit.css and changes nothing visually; it exists so that anything
     * selecting `.kit-unread` to mean "the read failed" does not get a false
     * positive on what is really a frontend bug.
     */
    function undrawable(o) {
        const opts = o || {};
        const what = opts.what || 'this';
        return el('div', { class: 'kit-unread kit-unread--render' }, [
            el('div', { class: 'kit-unread__title', text: 'Could not display ' + what }),
            el('div', {
                class: 'kit-unread__body',
                text: 'The data loaded, so nothing is wrong with the request. Something went wrong drawing it.'
            })
        ]);
    }

    /* ---------------------------------------------------------------------
     * The region.
     * ------------------------------------------------------------------- */

    /**
     * One live run per host.
     *
     * ⛔⛔ WHICHEVER READ SETTLES LAST WINS, AND THAT IS NOT ALWAYS THE NEWEST.
     * A double-clicked Try again, or a surface re-reading on a filter or range
     * change, leaves two reads in flight against one host; if the first is the
     * slower one it repaints stale rows over fresh ones and nothing anywhere
     * reports it. Each run claims the host and only the claimant may paint.
     *
     * ⛔ AND IT RESOLVES `undefined`, WHICH IS THE OTHER HALF. Returning the
     * stale payload would only move the staleness from visible to invisible:
     * js/employees/page.js:410 derives a counter straight off a resolved read,
     * so a superseded run that still answered would put the previous range's
     * number on a KPI beside a table showing the current one, with nothing to
     * notice. `undefined` rather than `null` so `isAnswer` skips it by default
     * — the safe direction — while a caller that cares can still tell a
     * superseded run from a failed one.
     */
    const RUNS = new WeakMap();

    /**
     * Run a read and render exactly one of the four states into `host`.
     *
     * @param host  replaced wholesale on each settle
     * @param o
     *   what      noun for the copy ("employees", "certifications")
     *   skeleton  shape for the loading frame; defaults to block
     *   load      () => Promise<any>. Throwing OR RESOLVING NULL is a failed read
     *   isEmpty   (data) => boolean; defaults to "no rows"
     *   render    (data) => Node, for the loaded case
     *   empty     () => Node, overriding the default empty state
     *   unread    (retry) => Node, overriding the default failed state
     *   notSetUp  (blocker) => Node, overriding the default not-set-up state
     *
     * Resolves to one of THREE things, and a caller deriving anything from the
     * result has to tell them apart:
     *
     *   the data   the read answered — including an empty or not-set-up answer
     *   null       the read FAILED — it threw, or resolved null. Also what a
     *              falsy `host` returns, where nothing was read at all
     *   undefined  this run was SUPERSEDED by a newer one on the same host, so
     *              it painted nothing and speaks for nothing
     *
     * `Kit.isAnswer` is false for the last two, so a caller using it skips both
     * by default. The retry re-runs the whole region, skeleton included, which
     * is why `retry` closes over the same options.
     */
    function region(host, o) {
        const opts = o || {};
        if (!host) {
            // ⛔ Silence here is a blank page and an empty console. After an id
            // rename this one line is the only thing that says which surface
            // went missing, and it turns a hunt into a two-second diagnosis.
            warn('[Kit] ' + (opts.what || 'a region') + ' has no host element to render into');
            return Promise.resolve(null);
        }
        const retry = () => region(host, opts);

        const token = (RUNS.get(host) || 0) + 1;
        RUNS.set(host, token);
        const owns = () => RUNS.get(host) === token;

        // Synchronous, before the first microtask: the host is never blank while
        // a read is in flight. `skeleton` always returns a `.kit-skel`, which is
        // already a surface, so this one does not go through `onSurface`.
        host.replaceChildren(skeleton(opts.skeleton || 'block'));

        return Promise.resolve()
            .then(() => opts.load())
            .then((data) => {
                // A newer run owns the host: paint nothing, and answer nothing.
                if (!owns()) return undefined;
                if (data === null || data === undefined) {
                    return fail(host, opts, retry, new Error('the request resolved null (a handled error, e.g. 401)'));
                }
                // ⛔⛔ FOUR OF THE FIVE CALLER CALLBACKS ARE INSIDE THIS TRY:
                // isEmpty, notSetUp, empty and render. All four run after the
                // read has SUCCEEDED, so letting any of them throw into the
                // `.catch` below reports a frontend bug as a failed request
                // over data already in hand, with a retry that loops.
                // `isEmpty` is the one to expect first: `(d) =>
                // !d.summary.rows.length` is a natural thing to write and
                // throws the moment `summary` is absent.
                //
                // 🪤 THE FIFTH, `unread`, IS GUARDED IN `fail` INSTEAD, and
                // deliberately not here — `fail` is reached from outside this
                // try, and its fallback has to be the truthful one. The reason
                // is written out at that call site. Tasks 6 to 8 multiply all
                // five by an order of magnitude.
                try {
                    if (isNotSetUp(data)) {
                        const node = opts.notSetUp
                            ? elementFrom(opts.notSetUp(blockerOf(data)), 'notSetUp')
                            : notSetUp({ what: opts.what });
                        host.replaceChildren(onSurface(node));
                        return data;
                    }
                    const nothing = opts.isEmpty ? opts.isEmpty(data) : !rowsOf(data).length;
                    if (nothing) {
                        host.replaceChildren(
                            onSurface(opts.empty ? elementFrom(opts.empty(), 'empty') : empty({ what: opts.what }))
                        );
                        return data;
                    }
                    // The enter animation belongs to the loaded case only: a
                    // state that says something went wrong should not slide in.
                    // It goes through onSurface for the same reason the other
                    // three do — a render that returns a bare node was the one
                    // state of four left floating on the page background.
                    host.replaceChildren(
                        el('div', { class: 'kit-enter' }, [onSurface(elementFrom(opts.render(data), 'render'))])
                    );
                    return data;
                } catch (err) {
                    warn('[Kit] ' + (opts.what || 'a region') + ' loaded but failed to render:', err);
                    host.replaceChildren(onSurface(undrawable({ what: opts.what })));
                    return data;
                }
            })
            .catch((err) => {
                // ⛔ THE SAME CLAIM CHECK AS THE `.then`, AND THE HALF THAT
                // ACTUALLY FIRES. A double-clicked Try again is the likeliest
                // way to get two reads in flight on one host, and in that path
                // the first read is the FAILING one — which is why the button
                // was on screen. Without this, its failure repaints over the
                // fresh rows the second read just delivered.
                if (!owns()) return undefined;
                return fail(host, opts, retry, err);
            });
    }

    /** The one log sink, so every warning in this file reads the same way. */
    function warn(...args) {
        if (window.Logger && typeof window.Logger.warn === 'function') window.Logger.warn(...args);
        else console.warn(...args);
    }

    /**
     * Render the failed-read state. One implementation, two callers, the
     * `.catch` and the resolved-null guard, so the two ways a read can fail
     * cannot drift into two different renderings.
     */
    function fail(host, o, retry, err) {
        // ⛔ The error is logged, never rendered raw: a 500's body can carry a
        // stack trace or a query, and this surface is shown to a store manager.
        warn('[Kit] ' + (o.what || 'a region') + ' failed to load:', err);
        // ⛔⛔ THE FIFTH CALLER CALLBACK, GUARDED HERE RATHER THAN IN THE
        // SETTLE-PATH TRY. `fail` runs OUTSIDE that try — from the
        // resolved-null branch and from the `.catch` — so a throwing `unread`
        // left the skeleton spinning forever AND rejected region's promise,
        // which is an unhandled rejection in any fire-and-forget caller: the
        // outer `.catch` called `fail` again and it threw again.
        //
        // 🪤 IT FALLS BACK TO THE KIT'S OWN `unread`, NOT TO `undrawable`, and
        // that is the whole reason the guard lives here instead of up there.
        // The read really did fail on this path, and `undrawable` says "the
        // data loaded, so nothing is wrong with the request" — the opposite of
        // the truth. The built-in `unread` and `onSurface` cannot throw, so
        // this cannot recurse, and the reader still gets a working retry.
        let node = null;
        if (o.unread) {
            try {
                node = elementFrom(o.unread(retry), 'unread');
            } catch (e) {
                warn('[Kit] ' + (o.what || 'a region') + ' could not render its own failed state:', e);
                node = null;
            }
        }
        host.replaceChildren(onSurface(node || unread({ what: o.what, onRetry: retry })));
        return null;
    }

    /* ---------------------------------------------------------------------
     * Formatters.
     *
     * ⛔ EVERY ONE RETURNS NULL FOR AN ABSENT VALUE rather than a plausible
     * default, so a caller has to decide what "we do not know" looks like
     * instead of silently printing $0.00 or Jan 1 1970.
     * ------------------------------------------------------------------- */

    /** `YYYY-MM-DD` and nothing after it. */
    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

    /**
     * Parse a value that may be a DATE-ONLY string, without moving it.
     *
     * ⛔⛔ `new Date('2024-03-11')` IS PARSED AS UTC MIDNIGHT, AND EVERY RENDER
     * OF IT WEST OF UTC IS THE PREVIOUS DAY. Found in a browser, not by a test:
     * a hire date of 2024-03-11 rendered as Mar 10 in Chicago, and a
     * certification expiring on the 6th would have said the 5th. Off by one, on
     * every date column, forever, on a page that otherwise looks perfect.
     *
     * A datetime string carries its own offset and must NOT get this treatment,
     * so the split is on the SHAPE: `YYYY-MM-DD` is a calendar day and is built
     * in local time; anything else is an instant and is left alone.
     *
     * ⛔ CI runs under TZ=UTC, where the two branches are the same function, so
     * no behavioural test here can fail on the runner that gates the merge.
     * __tests__/kit/core.render.test.js greps this file's source for the branch.
     */
    function asLocalDate(value) {
        if (!value) return null;
        if (typeof value === 'string' && DATE_ONLY.test(value.trim())) {
            const parts = value.trim().split('-');
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    function date(value) {
        const d = asLocalDate(value);
        if (!d) return null;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function dateShort(value) {
        const d = asLocalDate(value);
        if (!d) return null;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function time(value) {
        if (!value) return null;
        const d = new Date(value);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    /**
     * CENTS IN, dollars out: `123456` is `$1,234.56`.
     *
     * 🪤 Employees' fmtMoney takes DOLLARS. The kit takes cents because that is
     * what the money endpoints send and what Kit.input stores, and a formatter
     * that silently accepts both units is how a price becomes a hundred times
     * itself. Negatives lead with the minus, outside the currency mark, because
     * an accounting bracket reads as a footnote at this size. The grouping is in
     * the string; the tabular figures are the caller's mono class, not a style
     * this function sets.
     */
    function money(cents) {
        const n = Number(cents);
        if (cents === null || cents === undefined || cents === '' || !isFinite(n)) return null;
        const whole = Math.round(Math.abs(n)) / 100;
        const body = whole.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (n < 0 ? '-$' : '$') + body;
    }

    function hours(value) {
        const n = Number(value);
        if (value === null || value === undefined || value === '' || !isFinite(n)) return null;
        return n.toFixed(1);
    }

    /**
     * Calendar days between a date and today. Returns `{ days, over }` or null.
     */
    function daysFromToday(value, now) {
        // Same date-only trap as `date`: a bare YYYY-MM-DD parsed as UTC
        // midnight lands on the previous calendar day west of UTC, which here
        // would report a certification expiring today as expiring yesterday.
        const d = asLocalDate(value);
        if (!d) return null;
        const today = now ? new Date(now) : new Date();
        // Compare calendar days, not instants: a certificate expiring at 23:59
        // tonight expires TODAY, not in 0.03 days.
        const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
        const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        const days = Math.round((a - b) / 86400000);
        return { days, over: days < 0 };
    }

    /**
     * "Due today" / "Overdue by 1 day" / "Due in 6 days". Returns
     * `{ text, over }` or null.
     */
    function relDue(value, now) {
        const r = daysFromToday(value, now);
        if (!r) return null;
        if (r.days === 0) return { text: 'Due today', over: false };
        if (r.days === 1) return { text: 'Due tomorrow', over: false };
        if (r.days < 0) {
            const n = Math.abs(r.days);
            return { text: 'Overdue by ' + n + ' day' + (n === 1 ? '' : 's'), over: true };
        }
        return { text: 'Due in ' + r.days + ' days', over: false };
    }

    /**
     * A person's display name, preferring what they go by. Never invented.
     *
     * 🪤 `name` comes SECOND, before the legal name: `/labor/whos-on` rows carry
     * `name` and nothing else, and the ordering that read `legal_name` first
     * put the payroll spelling on the roll call.
     */
    function personName(row) {
        if (!row) return null;
        return row.preferred_name || row.name || row.employee_name || row.legal_name || null;
    }

    /* ---------------------------------------------------------------------
     * Exports.
     * ------------------------------------------------------------------- */
    Kit.el = el;
    Kit.glyph = glyph;
    Kit.isAnswer = isAnswer;
    Kit.rowsOf = rowsOf;
    Kit.skeleton = skeleton;
    Kit.empty = empty;
    Kit.unread = unread;
    Kit.notSetUp = notSetUp;
    Kit.isNotSetUp = isNotSetUp;
    Kit.blockerOf = blockerOf;
    Kit.onSurface = onSurface;
    Kit.region = region;
    // ⛔ EXPORTED so the other kit files log through one sink instead of
    // reaching for console.warn with a prefix each invented for itself.
    Kit.warn = warn;
    Kit.fmt = {
        date,
        dateShort,
        time,
        money,
        hours,
        relDue,
        daysFromToday,
        asLocalDate,
        personName
    };

    // Last, so a run that threw above leaves the guard open for a retry.
    Kit.__core = true;
})();
