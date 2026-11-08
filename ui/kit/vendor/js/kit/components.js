/* ===========================================================================
 * The portal kit: components.
 *
 * The factories a converted module calls once its data has arrived. The four
 * absent states (skeleton, empty, could-not-load, not-set-up) are core.js's
 * job; everything here assumes a reading exists and renders it.
 *
 * Loads second of four: core.js, components.js, forms.js, chart.js. It reads
 * Kit.el from core and Kit.rangePicker from forms: the first at build time
 * because core is already there, the second AT CLICK TIME because forms.js has
 * not run yet when this file executes.
 *
 * ⛔ WHAT A FACTORY RETURNS, AND WHEN IT RETURNS A HANDLE. The default is a
 * bare Element: the caller appends it and owns it. A factory returns
 * `{ el, ... }` ONLY when it owns state something outside has to change later
 * — `tabs` (setActive, setCount) and `period` (setValue), and the picked
 * `mainTabs` and `subTabs` (setActive), `sideTabs` (setActive, setApplied)
 * and `inlineSwitch` (setValue), the picked `goodNews` and `notice`
 * (show, hide), the picked `notify` (dismiss), `openingScreen` (say,
 * leave) and `progressBar` (set), and the picked `sectionMenu` (setActive,
 * setCollapsed, setQuery).
 * Everything else
 * returns an Element, so `host.appendChild(Kit.table(...))` reads the same
 * everywhere and there is no guessing which shape a call gives back.
 *
 * The reason `period` needs one: the bar is usually mounted INSIDE the element
 * its own onChange replaces. Click 7D, the caller re-reads and re-renders, and
 * the rebuilt bar shows whatever key the caller still had in its config — so
 * the control and the number disagree about which window is on screen, and the
 * keyboard user loses focus to <body> every time. Mount the handle's `el` once
 * and call `setValue` instead of rebuilding.
 *
 * ⛔ NO COLOUR IS WRITTEN HERE. Not as an inline style, not as an SVG
 * presentation attribute, not read back out of getComputedStyle. Employees
 * does all three (today.js:151-157 reads --emp-ok off the document and writes
 * it into a stroke; today.js:227 sets style.color on an absent KPI) and both
 * survive a theme flip unchanged, because nothing re-runs a factory when the
 * theme changes. A tone is a CLASS; kit.css owns what the class looks like.
 * The single exception is `currentColor` on the magnifier glyph, which names
 * the cascade rather than a value.
 *
 * ⛔ Styling lives in css/kit.css under `.kit`. Nothing below sets a class
 * containing `card`, `panel`, `widget`, `tile`, `-page` or `spin`: the first
 * four are repainted by a shell-theme wildcard inside `.portal-main`
 * (shell-theme.css:6854-6858), `-page` is repainted by an h1/h2/h3/p
 * !important rule (shell-theme.css:5292-5301), and `spin` re-enables an
 * infinite animation in main.css. That is why the pager's classes are
 * `.kit-paging*` while the factory is still called `pager`.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__components) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        // Registering half a namespace is worse than registering none: the
        // caller gets `Kit.table is not a function` from somewhere deep in a
        // panel instead of one line naming the load order.
        // ⛔ console.warn HERE AND NOWHERE ELSE IN THIS FILE. Kit.warn is core's,
        // and core is exactly what is missing on this branch.
        if (window.console && console.warn) {
            console.warn('[Kit] components: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const el = Kit.el;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * ⛔ ONE RULE WITH TWO HALVES: CONTENT TAKES A NODE OR A LIST, DATA TAKES A
     * LIST. Nineteen factories consumed by every module should agree, and
     * before this they did not — `head` and `block` accepted a bare node,
     * `table` quietly defended with an isArray check, and `toolbar`, `list`,
     * `tabs` and `segs` threw "(c.filters || []).filter is not a function".
     *
     * But the two halves are not the same problem, and collapsing them costs
     * more than the inconsistency did. A CONTENT slot (`actions`, `body`,
     * `filters`) holds nodes the caller built, so a bare Node is unambiguous
     * and wrapping it is right. A DATA slot (`rows`, `columns`, `tabs`,
     * `options`) holds records, and a bare object there is almost always a
     * mistake — an API envelope, or a forgotten `.rows`. Wrapping THAT
     * fabricates one record that does not exist and paints a row of "Unknown",
     * which is the kit asserting something about a store it never read. It is
     * quieter than a throw and louder than an empty state, and it is the only
     * option that puts a false record on screen. So data slots say what
     * happened and render nothing.
     */
    function many(v) {
        if (v === null || v === undefined) return [];
        return (Array.isArray(v) ? v : [v]).filter(Boolean);
    }

    /** What a caller most likely passed, phrased so the mistake is obvious. */
    function shapeOf(v) {
        if (typeof v !== 'object') return typeof v;
        const keys = Object.keys(v).slice(0, 5);
        return 'an object with keys: ' + (keys.length ? keys.join(', ') : '(none)');
    }

    /**
     * A data slot: a list, or nothing.
     *
     * An omitted option is not a mistake and says nothing; anything that is
     * neither absent nor a list is named, with the factory and the option, so
     * "[Kit] table: `rows` … an object with keys: success, data" points
     * straight at the envelope that caused it. The prefix matches the other
     * warnings in this file, which read `[Kit] kpi:` and `[Kit] period:`.
     */
    function listOf(v, factory, option) {
        if (v === null || v === undefined) return [];
        if (Array.isArray(v)) return v.filter(Boolean);
        warn(
            '[Kit] ' +
                factory +
                ': `' +
                option +
                '` must be an array of records; got ' +
                shapeOf(v) +
                '. Rendering nothing rather than inventing a record.'
        );
        return [];
    }

    /**
     * ⛔ ONE SINK, NOT TWO. core.js already routes through window.Logger when
     * the portal has one and console.warn otherwise, and it exports that as
     * Kit.warn. Calling console.warn directly here would put a second logging
     * convention in one kit, with a prefix invented per call site. The local
     * fallback covers a page that somehow loaded an older core.
     *
     * ⛭ READ AT CALL TIME, NOT CAPTURED. It used to bind Kit.warn once at load,
     * which made every warning in this file invisible to anything that swapped
     * the sink afterwards — a portal installing its own logger late, and a test
     * asking what this file actually said. js/kit/forms.js reads it the same
     * way, and `arguments` is forwarded because core's warn is variadic.
     */
    function warn() {
        const sink = typeof Kit.warn === 'function' ? Kit.warn : null;
        if (sink) sink.apply(null, arguments);
        else if (window.console && console.warn) console.warn.apply(console, arguments);
    }

    /* ---------------------------------------------------------------------
     * Page head.
     * ------------------------------------------------------------------- */

    function head(o) {
        const c = o || {};
        const actions = many(c.actions);
        // ⛔ FLAT CHILDREN, NO WRAPPER. `.kit .kit-head` is a two-column grid
        // (css/kit.css): eyebrow, title and summary take column 1 in order and
        // the actions span every row in column 2. A `__main` div would be a
        // grid item the sheet has no track for, and everything inside it would
        // stack in one cell.
        return el('header', { class: 'kit-head' }, [
            c.eyebrow ? el('div', { class: 'kit-head__eyebrow', text: c.eyebrow }) : null,
            el('h1', { class: 'kit-head__title', text: c.title || '' }),
            c.summary ? el('p', { class: 'kit-head__summary', text: c.summary }) : null,
            actions.length ? el('div', { class: 'kit-head__actions' }, actions) : null
        ]);
    }

    /* ---------------------------------------------------------------------
     * The tab bar.
     * ------------------------------------------------------------------- */

    /**
     * Set or hide a count badge.
     *
     * ⛔ `n` must be a real number. null, undefined and NaN HIDE the badge
     * rather than rendering a zero nobody measured: a "0" beside Team on a
     * store whose roster failed to load is a claim about the roster.
     *
     * The text is cleared as well as hidden because `hidden` is the weakest
     * rule in the document: it works through the UA sheet's
     * `[hidden] { display: none }` and loses to any rule that sets a display.
     * kit.css carries `.kit[hidden], .kit [hidden] { display: none }` LATE in
     * the sheet (measured 2026-09-03, css/kit.css:2672-2675), so it wins on
     * source order at equal specificity and needs no `!important`. That makes
     * it order-dependent rather than absolute, which is exactly why clearing
     * the text is the belt to that stylesheet's braces.
     */
    function setBadge(badge, n) {
        if (typeof n !== 'number' || !isFinite(n)) {
            badge.textContent = '';
            badge.hidden = true;
            return;
        }
        badge.textContent = String(n);
        badge.hidden = false;
    }

    const ARROW_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };

    /**
     * @param o
     *   tabs     - [{ id, label, count, warn, tier }]; tier 2 sits after a split
     *   active   - the id that starts selected
     *   label    - the tablist's accessible name (default "Sections")
     *   onChange - (id) => void, on click and on an arrow key
     * @returns { el, setActive(id), setCount(id, n) }
     */
    function tabs(o) {
        const c = o || {};
        const items = listOf(c.tabs, 'tabs', 'tabs');
        let active = c.active || (items[0] && items[0].id) || null;

        const nav = el('nav', {
            class: 'kit-tabs',
            role: 'tablist',
            'aria-label': c.label || 'Sections'
        });

        let splitPlaced = false;
        items.forEach((t) => {
            if (t.tier === 2 && !splitPlaced) {
                nav.appendChild(el('span', { class: 'kit-tabs__split', 'aria-hidden': 'true' }));
                splitPlaced = true;
            }
            const btn = el('button', {
                class: 'kit-tab' + (t.tier === 2 ? ' kit-tab--tier2' : ''),
                type: 'button',
                role: 'tab',
                'aria-selected': String(t.id === active),
                dataset: { tab: t.id },
                text: t.label || t.id
            });
            btn.tabIndex = t.id === active ? 0 : -1;
            const badge = el('span', {
                class: 'kit-count' + (t.warn ? ' kit-count--warn' : ''),
                dataset: { count: t.id }
            });
            setBadge(badge, t.count);
            btn.appendChild(badge);
            btn.addEventListener('click', () => pick(t.id, false));
            nav.appendChild(btn);
        });

        nav.addEventListener('keydown', onKey);

        function buttons() {
            return [].slice.call(nav.querySelectorAll('.kit-tab'));
        }

        /**
         * ⛔ A FIND, NOT A SELECTOR. Tab ids come from module config, and
         * '.kit-tab[data-tab="' + id + '"]' throws a DOMException the moment
         * one contains a quote.
         */
        function buttonFor(id) {
            return buttons().filter((b) => b.dataset.tab === id)[0] || null;
        }

        function onKey(e) {
            // hasOwnProperty, not `in`: `'constructor' in ARROW_KEYS` is true
            // through the prototype and would hand the arithmetic a function.
            if (!Object.prototype.hasOwnProperty.call(ARROW_KEYS, e.key)) return;
            const list = buttons();
            if (!list.length) return;
            const move = ARROW_KEYS[e.key];
            const at = list.findIndex((b) => b.dataset.tab === active);
            let next;
            if (move === 'first') next = 0;
            else if (move === 'last') next = list.length - 1;
            else next = ((at < 0 ? 0 : at) + move + list.length) % list.length;
            e.preventDefault();
            pick(list[next].dataset.tab, true);
        }

        /**
         * ⛔ ROVING TABINDEX. A tablist is one tab stop: Tab reaches the bar
         * and leaves it, the arrows move inside it. Every button at 0 turns an
         * eight-tab bar into eight stops between the page and its content.
         */
        function paint() {
            buttons().forEach((b) => {
                const on = b.dataset.tab === active;
                b.setAttribute('aria-selected', String(on));
                b.tabIndex = on ? 0 : -1;
            });
        }

        function pick(id, focus) {
            if (!items.some((t) => t.id === id)) return;
            active = id;
            paint();
            if (focus) {
                const b = buttonFor(id);
                if (b) b.focus();
            }
            if (typeof c.onChange === 'function') c.onChange(id);
        }

        return {
            el: nav,
            /** The caller telling the bar what already happened. Fires no onChange. */
            setActive(id) {
                if (!items.some((t) => t.id === id)) return;
                active = id;
                paint();
            },
            setCount(id, n) {
                const b = buttonFor(id);
                const badge = b && b.querySelector('.kit-count');
                if (badge) setBadge(badge, n);
            }
        };
    }

    /* ---------------------------------------------------------------------
     * Blocks, toolbars, search and segmented filters.
     * ------------------------------------------------------------------- */

    function block(o) {
        const c = o || {};
        const actions = many(c.actions);
        const headed = !!(c.title || c.sub || actions.length);
        return el('div', { class: 'kit-block' }, [
            // Flat children again: `.kit .kit-block__head` is the same
            // two-column grid as the page head, so title and sub stack in
            // column 1 and the actions span both rows in column 2.
            headed
                ? el('div', { class: 'kit-block__head' }, [
                      c.title ? el('div', { class: 'kit-block__title', text: c.title }) : null,
                      c.sub ? el('div', { class: 'kit-block__sub', text: c.sub }) : null,
                      actions.length ? el('div', { class: 'kit-block__actions' }, actions) : null
                  ])
                : null,
            el('div', { class: 'kit-block__body' }, many(c.body))
        ]);
    }

    function toolbar(o) {
        const c = o || {};
        const kids = [c.search || null, c.segs || null]
            .concat(many(c.filters))
            .concat([
                el('span', { class: 'kit-toolbar__spacer' }),
                c.primary || null,
                c.note ? el('span', { class: 'kit-toolbar__note', text: c.note }) : null
            ]);
        return el('div', { class: 'kit-toolbar' }, kids);
    }

    /**
     * @param o
     *   placeholder - also the accessible name; there is no visible label
     *   value       - ⛔ required whenever the caller keeps its query in state
     *                 that outlives the render, or the field paints blank while
     *                 the list stays filtered
     *   onInput     - (value) => void, on `input` so the list filters as you type
     */
    function searchBox(o) {
        const c = o || {};
        const name = c.placeholder || 'Search';
        const wrap = el('div', { class: 'kit-search' }, [magnifier()]);
        const input = el('input', {
            // 🪤 shell-theme.css:4331-4337 paints every
            // `body.light-mode input[type='search']` with !important at
            // (0,2,2). kit.css is linked after it so source order already wins,
            // but `.kit .kit-search input[type='search']` is (0,3,1), which
            // outranks it on the class column too, so a future sheet reorder
            // cannot undo it. The `kit-input` class is what carries the shared
            // control height, the floor reset and the focus ring, which every
            // kit field takes from the same rule.
            class: 'kit-input',
            type: 'search',
            placeholder: name,
            'aria-label': name
        });
        if (c.value) input.value = c.value;
        if (typeof c.onInput === 'function') input.addEventListener('input', () => c.onInput(input.value));
        wrap.appendChild(input);
        return wrap;
    }

    /** `currentColor` names the cascade, not a value: the one colour word allowed here. */
    function magnifier() {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', '11');
        c.setAttribute('cy', '11');
        c.setAttribute('r', '7');
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', 'M21 21l-4.3-4.3');
        svg.appendChild(c);
        svg.appendChild(p);
        return svg;
    }

    /**
     * A segmented filter.
     *
     * State is `aria-pressed` and nothing else. Employees carries a companion
     * `.is-on` class (ui.js:283-294) and the two can disagree; kit.css styles
     * `.kit .kit-seg[aria-pressed='true']` off the attribute the screen reader
     * already reads.
     */
    function segs(o) {
        const c = o || {};
        const items = listOf(c.options, 'segs', 'options');
        const wrap = el('div', { class: 'kit-segs', role: 'group', 'aria-label': c.label || 'Filter' });
        items.forEach((it) => {
            const b = el('button', {
                class: 'kit-seg',
                type: 'button',
                'aria-pressed': String(it.id === c.value),
                dataset: { seg: it.id },
                text: it.label || it.id
            });
            b.addEventListener('click', () => {
                wrap.querySelectorAll('.kit-seg').forEach((x) => {
                    x.setAttribute('aria-pressed', String(x.dataset.seg === it.id));
                });
                if (typeof c.onChange === 'function') c.onChange(it.id);
            });
            wrap.appendChild(b);
        });
        return wrap;
    }

    /* ---------------------------------------------------------------------
     * The period bar.
     *
     * ⛔⛔ LABELS AND DAY COUNTS COME FROM ArgusRangePicker, NOT FROM HERE.
     * On 2026-08-19 an audit mounted every range control in the product side by
     * side: the same window had four names and one of them was not the same
     * window ("Last 4 weeks" spanned 28 days while every trigger that opened it
     * said 30). One vocabulary, one owner. __tests__/range-vocabulary.contract.test.js
     * lists this file as a consumer and compares the literals below against
     * windowLabel(key, true), so a table edit that leaves them behind is red
     * here rather than invisible until the one boot where they render.
     * ------------------------------------------------------------------- */

    const SEGMENT_KEYS = ['7d', '30d', '90d', 'mtd', 'ytd'];
    const DAY_MS = 86400000;

    /** The vocabulary, read at CALL time. Never captured at load. */
    function vocabulary() {
        const p = window.ArgusRangePicker;
        return p && typeof p.windowLabel === 'function' ? p : null;
    }

    /** The SHORT form of a window, for a segment that has to fit six on a line. */
    function L(key, fallback) {
        const p = vocabulary();
        return p ? p.windowLabel(key, true) : fallback;
    }

    /**
     * ⛔ SPELLED OUT ONE CALL PER KEY, NOT LOOPED OVER A TABLE. The vocabulary
     * guard greps this file for `L('key', 'literal')` and compares each literal
     * to the shared table. A loop over a fallback object would render exactly
     * the same thing and be invisible to that guard, which is how the fallbacks
     * drifted the first time.
     */
    function segmentLabel(key) {
        if (key === '7d') return L('7d', '7D');
        if (key === '30d') return L('30d', '30D');
        if (key === '90d') return L('90d', '90D');
        if (key === 'mtd') return L('mtd', 'MTD');
        if (key === 'ytd') return L('ytd', 'YTD');
        return key;
    }

    /**
     * The roomy name, for the segment's tooltip and for the emitted label.
     *
     * ⛔ NO LITERAL OF ITS OWN. With the picker absent this repeats the short
     * name rather than carrying a second table that can drift out of step with
     * the first one.
     */
    function longName(key, shortForm) {
        const p = vocabulary();
        return p ? p.windowLabel(key) : shortForm;
    }

    /**
     * The same arithmetic as ArgusRangePicker.WINDOW_RANGE, for the boot where
     * the picker has not landed. components.render.test.js pins the two
     * together against a fixed clock.
     */
    const LOCAL_RANGE = {
        '7d': (t) => [new Date(t.getTime() - 6 * DAY_MS), t],
        '30d': (t) => [new Date(t.getTime() - 29 * DAY_MS), t],
        '90d': (t) => [new Date(t.getTime() - 89 * DAY_MS), t],
        mtd: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), t],
        ytd: (t) => [new Date(t.getFullYear(), 0, 1), t]
    };

    /**
     * ⛔ LOCAL, NOT UTC. `toISOString().slice(0, 10)` converts to UTC first, so
     * for every user west of Greenwich the window started and ended a day
     * earlier than the control showed, silently and only part of the day.
     */
    function isoDay(d) {
        const pad = (n) => (n < 10 ? '0' + n : String(n));
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function rangeFor(key) {
        const p = window.ArgusRangePicker;
        const shared = p && p.WINDOW_RANGE && typeof p.WINDOW_RANGE[key] === 'function' ? p.WINDOW_RANGE[key] : null;
        const fn = shared || LOCAL_RANGE[key];
        if (!fn) return null;
        const pair = fn(new Date());
        return { from: isoDay(pair[0]), to: isoDay(pair[1]) };
    }

    function shortDate(iso) {
        return (Kit.fmt && typeof Kit.fmt.dateShort === 'function' && Kit.fmt.dateShort(iso)) || iso;
    }

    /**
     * @param o
     *   value    - the key that starts selected (default '30d')
     *   custom   - false removes the Custom segment
     *   onChange - ({ key, from, to, label }) => void; from and to are local
     *              ISO dates, and key is 'custom' for a hand-picked window
     * @returns { el, setValue(key) } — a handle, not an Element, because the
     *          bar outlives the repaint its own onChange triggers. See the
     *          handle rule at the top of this file.
     */
    function period(o) {
        const c = o || {};
        let active = c.value || '30d';

        const bar = el('div', { class: 'kit-period', role: 'group', 'aria-label': 'Date range' });

        SEGMENT_KEYS.forEach((key) => {
            const shortForm = segmentLabel(key);
            const b = el('button', {
                class: 'kit-period__seg',
                type: 'button',
                'aria-pressed': String(key === active),
                // The roomy name is the accessible one; no browser tooltip.
                'aria-label': longName(key, shortForm),
                dataset: { rangeKey: key },
                text: shortForm
            });
            b.addEventListener('click', () => choose(key));
            bar.appendChild(b);
        });

        if (c.custom !== false) {
            const b = el('button', {
                class: 'kit-period__seg kit-period__seg--custom',
                type: 'button',
                'aria-pressed': String(active === 'custom'),
                'aria-label': 'Custom: pick a range',
                dataset: { rangeKey: 'custom' },
                text: 'Custom'
            });
            b.addEventListener('click', openCustom);
            bar.appendChild(b);
        }

        function paint(key) {
            active = key;
            bar.querySelectorAll('.kit-period__seg').forEach((x) => {
                x.setAttribute('aria-pressed', String(x.dataset.rangeKey === key));
            });
        }

        function choose(key) {
            const r = rangeFor(key);
            if (!r) return;
            paint(key);
            if (typeof c.onChange === 'function') {
                c.onChange({ key, from: r.from, to: r.to, label: longName(key, segmentLabel(key)) });
            }
        }

        function openCustom() {
            // ⛔ READ AT CLICK TIME. Kit.rangePicker ships in js/kit/forms.js,
            // which loads AFTER this file, so capturing it at build time would
            // capture undefined on every page load.
            if (typeof Kit.rangePicker !== 'function') {
                warn('[Kit] period: js/kit/forms.js has not loaded; the Custom range is inert.');
                return;
            }
            const from = rangeFor(active === 'custom' ? '30d' : active) || {};
            Promise.resolve(Kit.rangePicker({ from: from.from, to: from.to, maxDate: isoDay(new Date()) }))
                .then((picked) => {
                    if (!picked || !picked.from || !picked.to) return;
                    paint('custom');
                    if (typeof c.onChange === 'function') {
                        c.onChange({
                            key: 'custom',
                            from: picked.from,
                            to: picked.to,
                            label: shortDate(picked.from) + ' to ' + shortDate(picked.to)
                        });
                    }
                })
                .catch((err) => {
                    // ⛔ AN UNWRITTEN CROSS-TASK CONTRACT, CLOSED HERE. Rejecting on
                    // cancel is a normal picker design and js/kit/forms.js writes
                    // that picker, so without this a cancelled pick is an unhandled
                    // rejection. One catch costs less than a constraint the other
                    // file has to remember.
                    warn('[Kit] period: the range picker did not return a window:', err);
                });
        }

        return {
            el: bar,
            /**
             * The caller telling the bar which window is now on screen. Fires
             * no onChange — it is a repaint, not a choice, and firing would
             * loop straight back into the read that called it. Mirrors
             * tabs.setActive.
             */
            setValue(key) {
                const known = SEGMENT_KEYS.indexOf(key) >= 0 || key === 'custom';
                if (!known) return;
                paint(key);
            }
        };
    }

    /* ---------------------------------------------------------------------
     * KPI cards.
     * ------------------------------------------------------------------- */

    const SPARK_W = 74;
    const SPARK_H = 30;
    const SPARK_TONES = ['accent', 'ok', 'warn', 'bad', 'mut'];

    /**
     * A sparkline in real pixel space.
     *
     * Returns null for no series, fewer than two points, or any hole in the
     * data. A chart looks equally authoritative whether or not the numbers
     * support it, so the refusal is the feature.
     *
     * ⛔ THE TONE IS A CLASS AND ONLY A CLASS. Employees reads --emp-ok off
     * document.documentElement and writes the resolved colour into a stroke
     * attribute (today.js:151-157). That paints correctly once and then keeps
     * the old theme's colour forever, because nothing re-runs the factory when
     * the user flips light and dark. kit.css owns .kit-spark--ok.
     */
    function sparkline(points, tone) {
        if (!Array.isArray(points) || points.length < 2) return null;
        if (!points.every((v) => typeof v === 'number' && isFinite(v))) return null;

        const min = Math.min.apply(null, points);
        const max = Math.max.apply(null, points);
        const pad = 3;
        const span = max - min;
        const x = (i) => (i / (points.length - 1)) * SPARK_W;
        // A flat series has no range to scale into; centring it is the only
        // honest render, and dividing by zero would produce NaN co-ordinates.
        const y = (v) => (span === 0 ? SPARK_H / 2 : pad + (1 - (v - min) / span) * (SPARK_H - pad * 2));
        const t = SPARK_TONES.indexOf(String(tone)) >= 0 ? String(tone) : 'mut';

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'kit-spark kit-spark--' + t);
        svg.setAttribute('viewBox', '0 0 ' + SPARK_W + ' ' + SPARK_H);
        svg.setAttribute('width', String(SPARK_W));
        svg.setAttribute('height', String(SPARK_H));
        svg.setAttribute('aria-hidden', 'true');

        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('class', 'kit-spark__ln');
        line.setAttribute(
            'd',
            points.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ')
        );

        const tip = document.createElementNS(SVG_NS, 'circle');
        tip.setAttribute('class', 'kit-spark__tip');
        tip.setAttribute('cx', x(points.length - 1).toFixed(2));
        tip.setAttribute('cy', y(points[points.length - 1]).toFixed(2));
        // Geometry, not colour, and the ONLY place the radius is written:
        // css/kit.css paints the tip and deliberately declares no `r`, because
        // an attribute and a CSS property of different values is two numbers
        // for one circle and the answer depends on the browser.
        tip.setAttribute('r', '2.4');

        svg.appendChild(line);
        svg.appendChild(tip);
        return svg;
    }

    const DELTA_ARROW = { up: '▲', down: '▼', flat: '' };

    /**
     * @param d { text, dir: 'up'|'down'|'flat', good }
     *
     * ⛔ `good` is per KPI, never global. More open tasks and more expiring
     * certifications are not improvements, so up is not green everywhere.
     * `good` unset means the direction has no moral: the pill is neutral.
     */
    function deltaChip(d) {
        if (!d || !d.text) return null;
        const dir = Object.prototype.hasOwnProperty.call(DELTA_ARROW, d.dir) ? d.dir : 'flat';
        let cls = 'kit-trend kit-trend--' + dir;
        if (d.good === true) cls += ' is-good';
        else if (d.good === false) cls += ' is-bad';
        const chip = el('span', { class: cls });
        if (DELTA_ARROW[dir]) {
            chip.appendChild(el('span', { class: 'kit-trend__arw', text: DELTA_ARROW[dir], 'aria-hidden': 'true' }));
        }
        chip.appendChild(document.createTextNode(String(d.text)));
        return chip;
    }

    const KPI_NONE = { notSetUp: 'Not set up', notLoaded: 'Not loaded' };

    /**
     * @param o
     *   label, value, unit, sub, subWarn
     *   state   - 'notSetUp' (the server said this source is not connected) or
     *             'notLoaded' (the read failed). Anything else truthy reads as
     *             notLoaded, and a null value with no state reads as notLoaded.
     *   delta   - { text, dir, good }
     *   series  - numbers for the sparkline; tone picks its class
     *   range   - { value, onChange } renders a period bar in the card head.
     *             ⛔ `value` is required whenever the caller keeps the window in
     *             state that outlives the render, or the bar paints the old
     *             window beside the new number after the re-read its own
     *             onChange triggered. A card that re-reads on range change is
     *             better served by mounting Kit.period's handle itself and
     *             calling setValue — see the handle rule at the top.
     *   onClick - makes the card a <button>. ⛔ Ignored when `range` is given:
     *             a <button> may not contain the period bar's buttons.
     */
    function kpi(o) {
        const c = o || {};
        const hasRange = !!(c.range && typeof c.range === 'object');
        const clickable = typeof c.onClick === 'function' && !hasRange;
        if (hasRange && typeof c.onClick === 'function') {
            warn(
                '[Kit] kpi: a card with a range bar cannot also be a button (nested interactive content); ' +
                    'onClick ignored for "' +
                    (c.label || '') +
                    '".'
            );
        }

        const root = el(clickable ? 'button' : 'div', {
            class: 'kit-kpi' + (clickable ? ' kit-kpi--link' : '') + (hasRange ? ' kit-kpi--range' : ''),
            type: clickable ? 'button' : null
        });
        if (clickable) root.addEventListener('click', c.onClick);

        // ⛔ THE RANGE BAR RIDES INSIDE THE EYEBROW. css/kit.css turns
        // `.kit .kit-kpi--range .kit-kpi__k` into a spaced flex row for exactly
        // this, so the card keeps returning the same flat children whether or
        // not it carries a range. A `__head` wrapper would be an element the
        // sheet has no rule for.
        const eyebrow = el('div', { class: 'kit-kpi__k' });
        eyebrow.appendChild(document.createTextNode(c.label || ''));
        if (hasRange) eyebrow.appendChild(period(c.range).el);
        root.appendChild(eyebrow);

        // ⛔ AN UNREADABLE NUMBER IS AN ABSENCE, NOT A VALUE. A KPI is usually a
        // derived rate and dividing by a quiet day's zero is not a bug, so NaN
        // and Infinity reach this factory in normal operation and used to print
        // as the words "NaN" and "Infinity". setBadge and sparkline both refuse
        // non-finite input already, and core's fmt.money treats '' and
        // non-finite as absent; this is that same rule at the one component
        // whose whole job is displaying a number. A formatted string like
        // "4h 20m" is a reading and stays one.
        const unreadable = c.value === '' || (typeof c.value === 'number' && !isFinite(c.value));
        const absent = !!c.state || c.value === null || c.value === undefined || unreadable;
        let shown;
        if (absent) {
            shown = el('div', {
                class: 'kit-kpi__none',
                text: KPI_NONE[c.state] || KPI_NONE.notLoaded
            });
        } else {
            shown = el('div', { class: 'kit-kpi__value' });
            shown.appendChild(document.createTextNode(String(c.value)));
            if (c.unit) shown.appendChild(el('small', { class: 'kit-kpi__unit', text: c.unit }));
        }

        root.appendChild(
            el('div', { class: 'kit-kpi__vrow' }, [
                el('div', { class: 'kit-kpi__vwrap' }, [shown, deltaChip(c.delta)]),
                // No trend line beside a number nobody read.
                absent ? null : sparkline(c.series, c.tone)
            ])
        );
        if (c.sub) {
            root.appendChild(
                el('div', { class: 'kit-kpi__sub' + (c.subWarn ? ' kit-kpi__sub--warn' : ''), text: c.sub })
            );
        }
        return root;
    }

    /* ---------------------------------------------------------------------
     * Tables.
     * ------------------------------------------------------------------- */

    /**
     * Anything that owns its own click or keystroke.
     *
     * ⛔ ONE RULE, EVERY PLACE A CONTAINER IS ALSO A CONTROL. `kpi` refuses to
     * be a button when it carries a period bar; the two points below are
     * structurally identical and each forgot it once. An activatable table row
     * must not claim a click that landed on a control inside a cell, and a
     * clickable list row must not swallow an interactive trailing into its own
     * <button> — the parser re-homes a nested button and both break.
     */
    const OWNS_INPUT = 'button, a, input, select, textarea, [role="button"]';

    /** Did this event land on a control that speaks for itself? */
    function onOwnControl(e, root) {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return false;
        const hit = t.closest(OWNS_INPUT);
        return !!hit && hit !== root && root.contains(hit);
    }

    /**
     * `align: 'right'` means a number column: right aligned AND tabular, which
     * is the only reason a column in this portal is right aligned. `mono` is
     * the mono family, for ids, codes and clock times.
     */
    function cellClass(base, col) {
        return (
            base +
            (col.align === 'right' ? ' is-num' : '') +
            (col.align === 'center' ? ' is-mid' : '') +
            (col.mono ? ' is-mono' : '') +
            // `hideSm`: the column drops on a phone (css/kit.css, max-width
            // 640px) so the columns that matter keep their room instead of the
            // whole table scrolling sideways past the row's action.
            (col.hideSm ? ' is-hide-sm' : '')
        );
    }

    /**
     * A cell for a value that was not read.
     *
     * ⛔ The word "Unknown", never a blank and never a zero. A blank cell reads
     * as "this person has no wage"; this reads as "we did not read one", which
     * is the truth when the column is absent from the payload. Employees writes
     * an em dash and then paints it with an inline style (ui.js:354-364); the
     * word carries the same meaning to a screen reader and the colour is
     * .kit-td--unknown's job.
     */
    function unknownCell(col) {
        return el('td', { class: cellClass('kit-td', col || {}) + ' kit-td--unknown', text: 'Unknown' });
    }

    function cell(raw, col) {
        // Only null and undefined are unknown. An empty string is a value the
        // row actually carries, and calling it unknown would be its own lie.
        if (raw === null || raw === undefined) return unknownCell(col);
        // ⛔ A render that already returned a cell IS the cell. Kit.unknownCell
        // hands back a <td>, so wrapping it put a <td> inside a <td> and left
        // that export with no correct caller-side use.
        if (raw instanceof Node && raw.nodeName === 'TD') return raw;
        const td = el('td', { class: cellClass('kit-td', col) });
        if (raw instanceof Node) td.appendChild(raw);
        else td.textContent = String(raw);
        return td;
    }

    /**
     * @param o
     *   columns   - [{ key, label, align: 'right'|'center', mono, width, hideSm, render }]
     *               hideSm: drop this column on a phone (max-width 640px)
     *   rows      - the records; `render(row, i)` may return a string or a Node
     *   rowKey    - (row, i) => string, written to data-key
     *   onRow     - (row, i) => void; makes the row focusable and activatable
     *   emptyText - the one line a table with no rows shows under its header
     */
    function table(o) {
        const c = o || {};
        const cols = listOf(c.columns, 'table', 'columns');
        const rows = listOf(c.rows, 'table', 'rows');
        const t = el('table');

        if (cols.some((col) => col.width)) {
            const group = el('colgroup');
            cols.forEach((col) => {
                const co = el('col', col.hideSm ? { class: 'is-hide-sm' } : {});
                // The one inline style in this file, and it is geometry: a
                // per-caller column width cannot live in a static stylesheet.
                if (col.width) co.style.width = typeof col.width === 'number' ? col.width + 'px' : String(col.width);
                group.appendChild(co);
            });
            t.appendChild(group);
        }

        const hr = el('tr');
        cols.forEach((col) => {
            hr.appendChild(el('th', { class: cellClass('kit-th', col), scope: 'col', text: col.label || '' }));
        });
        t.appendChild(el('thead', null, [hr]));

        const body = el('tbody');
        if (!rows.length) {
            body.appendChild(
                el('tr', { class: 'kit-row kit-row--empty' }, [
                    el('td', {
                        class: 'kit-td',
                        colspan: String(Math.max(1, cols.length)),
                        text: c.emptyText || 'Nothing to show'
                    })
                ])
            );
        }
        rows.forEach((row, i) => body.appendChild(bodyRow(c, cols, row, i)));
        t.appendChild(body);

        // ⛔ TWO ELEMENTS, NOT ONE. `.kit .kit-table` is the surface: it owns
        // the border, the radius and `overflow: hidden`, which is what rounds
        // the corners. `.kit .kit-table__wrap` inside it is the only horizontal
        // scroller, so a wide table scrolls within its own surface rather than
        // moving the page. Returning the <table> as a direct child of
        // `.kit-table` would clip it instead of scrolling it.
        return el('div', { class: 'kit-table' }, [el('div', { class: 'kit-table__wrap' }, [t])]);
    }

    function bodyRow(c, cols, row, i) {
        const link = typeof c.onRow === 'function';
        const tr = el('tr', { class: 'kit-row' + (link ? ' kit-row--link' : '') });
        if (link) tr.tabIndex = 0;
        if (typeof c.rowKey === 'function') tr.dataset.key = String(c.rowKey(row, i));
        cols.forEach((col) => {
            tr.appendChild(cell(typeof col.render === 'function' ? col.render(row, i) : row[col.key], col));
        });
        if (link) {
            // ⛔ BOTH HANDLERS CHECK THE TARGET, NOT JUST THE CLICK. `col.render`
            // is documented to return a Node, so a cell legitimately holds a
            // button. Without this, one click fires the control AND opens the
            // row, and Space fires the row while its preventDefault suppresses
            // the button's own activation.
            tr.addEventListener('click', (e) => {
                if (onOwnControl(e, tr)) return;
                c.onRow(row, i);
            });
            tr.addEventListener('keydown', (e) => {
                // ' ' is the modern spelling; 'Spacebar' is what older WebKit
                // sends and costs one comparison to keep working.
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                if (onOwnControl(e, tr)) return;
                e.preventDefault();
                c.onRow(row, i);
            });
        }
        return tr;
    }

    /* ---------------------------------------------------------------------
     * List rows, pills, chips.
     * ------------------------------------------------------------------- */

    const DOT_TONES = ['accent', 'warn', 'danger'];

    function list(o) {
        const c = o || {};
        return el('div', { class: 'kit-list' }, listOf(c.rows, 'list', 'rows').map(listRow));
    }

    function listRow(r) {
        // ⛔ THE SAME INVARIANT `kpi` ENFORCES, AT THE POINT NEXT DOOR. A Node
        // trailing that is itself interactive cannot ride inside a <button>
        // row: the parser re-homes it and the row loses either its click or
        // its control. The nested control wins and the row reverts to a div,
        // which is the trade `kpi` already makes for its range bar.
        const nested =
            r.trailing instanceof Element && (r.trailing.matches(OWNS_INPUT) || !!r.trailing.querySelector(OWNS_INPUT));
        const link = typeof r.onClick === 'function' && !nested;
        if (nested && typeof r.onClick === 'function') {
            warn(
                '[Kit] list: a row with an interactive trailing cannot also be a button ' +
                    '(nested interactive content); onClick ignored for "' +
                    (r.title || '') +
                    '".'
            );
        }
        const row = el(link ? 'button' : 'div', { class: 'kit-lrow', type: link ? 'button' : null });
        if (link) row.addEventListener('click', r.onClick);
        if (r.tone) {
            const tone = DOT_TONES.indexOf(String(r.tone)) >= 0 ? String(r.tone) : 'accent';
            row.appendChild(el('span', { class: 'kit-lrow__dot kit-lrow__dot--' + tone, 'aria-hidden': 'true' }));
        }
        row.appendChild(
            el('div', { class: 'kit-lrow__main' }, [
                el('div', { class: 'kit-lrow__title', text: r.title || '' }),
                r.sub ? el('div', { class: 'kit-lrow__sub', text: r.sub }) : null
            ])
        );
        if (r.trailing) {
            row.appendChild(
                r.trailing instanceof Node
                    ? r.trailing
                    : el('span', { class: 'kit-lrow__trail', text: String(r.trailing) })
            );
        }
        if (link) row.appendChild(el('span', { class: 'kit-lrow__go', 'aria-hidden': 'true', text: '›' }));
        return row;
    }

    const PILL_TONES = ['ok', 'warn', 'bad', 'mut', 'draft', 'night'];

    function pill(text, tone) {
        const t = PILL_TONES.indexOf(String(tone)) >= 0 ? String(tone) : 'mut';
        return el('span', { class: 'kit-pill kit-pill--' + t, text: text == null ? '' : String(text) });
    }

    function count(n, o) {
        const c = o || {};
        const badge = el('span', { class: 'kit-count' + (c.warn ? ' kit-count--warn' : '') });
        setBadge(badge, n);
        return badge;
    }

    function roleChip(label) {
        return el('span', { class: 'kit-rolechip', text: label == null ? '' : String(label) });
    }

    const PRIO_LEVELS = ['urgent', 'high', 'normal', 'low'];

    function prio(level) {
        const l = String(level || 'normal').toLowerCase();
        const known = PRIO_LEVELS.indexOf(l) >= 0 ? l : 'normal';
        return el('span', { class: 'kit-prio kit-prio--' + known, text: known.toUpperCase() });
    }

    /* ---------------------------------------------------------------------
     * Paging.
     *
     * ⛔ The classes are `.kit-paging*`, not `.kit-pager*`: `kit-pager` carries
     * the substring `-page`, and shell-theme.css:5292-5301 repaints every h1,
     * h2, h3 and p inside `[class*='-page']` with !important. The factory keeps
     * the name `pager`, because a JS identifier is not matched by a CSS
     * attribute selector.
     * ------------------------------------------------------------------- */

    function pager(o) {
        const c = o || {};
        // ⛔ "Showing 1 to 20 of undefined" is a fabricated measurement with
        // extra steps. No total, no pager; the caller shows its own state.
        if (!Number.isFinite(c.total) || !Number.isFinite(c.pageSize) || c.pageSize <= 0) return null;

        const total = Math.max(0, c.total);
        const size = c.pageSize;
        // ⛔ CLAMPED TO A PAGE THAT EXISTS, AND FLOORED. A caller holding `page`
        // in state while a search narrows the results is ordinary — it is the
        // toolbar + search + pager combination this kit encourages — and an
        // unclamped page 3 of a one-page result printed "Showing 41 to 10 of
        // 10" with Previous enabled, a slice that does not exist. Math.floor
        // also settles a fractional page, which offset every number in the line.
        const pages = Math.max(1, Math.ceil(total / size));
        const page = Math.min(pages, Math.max(1, Math.floor(Number(c.page)) || 1));
        const first = total === 0 ? 0 : (page - 1) * size + 1;
        const last = Math.min(page * size, total);

        const prev = el('button', { class: 'kit-btn kit-paging__btn', type: 'button', text: 'Previous' });
        const next = el('button', { class: 'kit-btn kit-paging__btn', type: 'button', text: 'Next' });
        prev.disabled = page <= 1;
        next.disabled = total === 0 || last >= total;
        if (typeof c.onPage === 'function') {
            prev.addEventListener('click', () => c.onPage(page - 1));
            next.addEventListener('click', () => c.onPage(page + 1));
        }

        return el('div', { class: 'kit-paging' }, [
            prev,
            el('span', {
                // ⛔ A <span>, and named `__count` because that is what
                // css/kit.css draws. It carries the mono family from that rule
                // rather than a companion class, so there is one source of
                // truth for it, and it is not a <p>: the shell's
                // `[class*='-page'] p` override does not reach `kit-paging`,
                // but a paragraph in a control row is wrong on its own terms.
                class: 'kit-paging__count',
                text: total === 0 ? 'Showing 0 of 0' : 'Showing ' + first + ' to ' + last + ' of ' + total
            }),
            next
        ]);
    }

    function loadMore(o) {
        const c = o || {};
        const left = c.remaining;
        // Nothing left is not a disabled button, it is no button.
        if (!Number.isFinite(left) || left <= 0) return null;
        // Grouped the way core's fmt.money groups, so one kit does not print
        // 12,345 in a table and 12345 in the button under it.
        const shown = String(left).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const btn = el('button', { class: 'kit-btn kit-more__btn', type: 'button', text: 'Load ' + shown + ' more' });
        if (typeof c.onMore === 'function') btn.addEventListener('click', c.onMore);
        return el('div', { class: 'kit-more' }, [btn]);
    }

    /* ---------------------------------------------------------------------
     * Tabs and switches (owner picks, 2026-09-28, docs/ui-library/standards.md).
     *
     * Four new factories beside Kit.tabs, which is unchanged: the in-page
     * switch (Kit.inlineSwitch), the main tabs (Kit.mainTabs), the side tabs
     * (Kit.sideTabs) and the sub tabs (Kit.subTabs). Each is copied from the
     * control the owner picked, read there and never edited:
     * FinControls.segmented and the Filters menu's rail
     * (js/financials/controls.js:980, :1703), Financials' tab row
     * (js/financials/page.js:461, :1056) and Inventory's view rows
     * (js/inventory/stock.js:455, js/inventory/receive.js:1675).
     * css/kit-standards.css draws them.
     *
     * All four take the WAI-ARIA tabs keyboard: the row is ONE tab stop (a
     * roving tabindex), the arrow keys step along it and wrap, Home and End
     * jump to the ends. Whether landing on a tab opens it is each source's
     * own answer, and each factory below says which.
     * ------------------------------------------------------------------- */

    // Every glyph the tabs draw is Kit.glyph (core.js), the kit's one line
    // style. A tab whose filter is in use shows the one filled glyph in place
    // of its own: the wine disc with the tick knocked out of it
    // (js/financials/controls.js:290-301).

    const STEPS = {
        row: { ArrowLeft: -1, ArrowRight: 1 },
        column: { ArrowUp: -1, ArrowDown: 1 },
        any: { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
    };

    /**
     * Where a key moves along `n` items from `at`: the step keys wrap, Home
     * and End jump to the ends, and anything else is -1. hasOwnProperty, not
     * `in`, for the reason tabs() gives above.
     */
    function stepFrom(key, at, n, steps) {
        if (!n) return -1;
        if (key === 'Home') return 0;
        if (key === 'End') return n - 1;
        if (!Object.prototype.hasOwnProperty.call(steps, key)) return -1;
        return ((at < 0 ? 0 : at) + steps[key] + n) % n;
    }

    let tabUid = 0;
    function tabId(prefix) {
        tabUid += 1;
        return 'kit-' + prefix + '-' + tabUid;
    }

    /**
     * Makes the caller's `panel` the tabpanel every tab controls: its role, an
     * id, and each tab's aria-controls; paint() names it by the selected tab.
     * With no panel no tab names a target, so no reference dangles. The panel
     * joins the tab order itself, as the pattern asks of a panel whose first
     * content may not be focusable; a caller that wants otherwise sets its own
     * tabindex first.
     */
    function bindPanel(panel, buttons) {
        if (!panel || panel.nodeType !== 1) return null;
        if (!panel.id) panel.id = tabId('tabpanel');
        panel.setAttribute('role', 'tabpanel');
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '0');
        buttons.forEach((b) => b.setAttribute('aria-controls', panel.id));
        return panel;
    }

    /**
     * The three tab factories' one body.
     *   spec.name    the factory's name, for listOf's warning
     *   spec.cls     the row's class; each tab is `<cls>__tab`
     *   spec.steps   STEPS.row, or STEPS.column for a vertical rail
     *   spec.follow  true: landing on a tab opens it (automatic activation);
     *                false: the keys move focus only and Enter or Space, the
     *                button's own click, opens it (manual activation)
     *   spec.fill    (tab, button, on) draws the tab's contents, again on
     *                every paint
     */
    function tabSet(o, spec) {
        const c = o || {};
        const items = listOf(c.tabs, spec.name, 'tabs');
        const ids = items.map((t) => String(t.id));
        let active = c.active != null && ids.indexOf(String(c.active)) > -1 ? String(c.active) : ids[0] || null;
        const root = el('div', {
            class: spec.cls,
            role: 'tablist',
            // Kit.tabs' default: a tablist with no name reads as "tab list"
            // and nothing else.
            'aria-label': c.label || 'Sections',
            'aria-orientation': spec.steps === STEPS.column ? 'vertical' : null
        });
        const buttons = items.map((t, i) => {
            const b = el('button', {
                class: spec.cls + '__tab',
                type: 'button',
                role: 'tab',
                // tabId adds the `kit-` itself: `kit-main-tabs-tab-3`.
                id: tabId(spec.cls.replace(/^kit-/, '') + '-tab'),
                dataset: { tab: ids[i] }
            });
            b.addEventListener('click', () => open(ids[i], false));
            root.appendChild(b);
            return b;
        });
        const panel = bindPanel(c.panel, buttons);

        function paint() {
            buttons.forEach((b, i) => {
                const on = ids[i] === active;
                b.setAttribute('aria-selected', String(on));
                b.tabIndex = on ? 0 : -1;
                spec.fill(items[i], b, on);
            });
            const at = ids.indexOf(active);
            if (panel && at > -1) panel.setAttribute('aria-labelledby', buttons[at].id);
        }

        function open(id, focus) {
            const at = ids.indexOf(id);
            if (at < 0) return;
            const changed = id !== active;
            active = id;
            paint();
            if (focus) buttons[at].focus();
            if (changed && typeof c.onChange === 'function') c.onChange(id);
        }

        root.addEventListener('keydown', (e) => {
            const at = buttons.indexOf(document.activeElement);
            if (at < 0) return;
            const next = stepFrom(e.key, at, buttons.length, spec.steps);
            if (next < 0) return;
            e.preventDefault();
            if (spec.follow) {
                open(ids[next], true);
                return;
            }
            buttons.forEach((b, i) => {
                b.tabIndex = i === next ? 0 : -1;
            });
            buttons[next].focus();
        });

        // Manual activation walks the one tab stop without opening anything,
        // so leaving the row hands it back to the selected tab: the one Tab
        // returns to (js/financials/page.js:1075-1079).
        if (!spec.follow) {
            root.addEventListener('focusout', (e) => {
                if (e.relatedTarget && root.contains(e.relatedTarget)) return;
                buttons.forEach((b, i) => {
                    b.tabIndex = ids[i] === active ? 0 : -1;
                });
            });
        }

        paint();
        return {
            el: root,
            /** The caller telling the row what already happened. Fires no onChange. */
            setActive(id) {
                if (ids.indexOf(String(id)) < 0) return;
                active = String(id);
                paint();
            },
            repaint: paint
        };
    }

    /**
     * An underline tab's words, set once. `data-label` is read by css/kit-standards.css
     * to reserve the bold width, so the selected tab's 600 weight does not
     * push its neighbours (css/financials.css:141-168).
     */
    function underlineFill(t, b) {
        if (b.childNodes.length) return;
        const words = String(t.label != null ? t.label : t.id);
        b.setAttribute('data-label', words);
        b.textContent = words;
    }

    /**
     * The main tabs (pick tabs__main-tabs, "Financials tabs"): the section's
     * underline row, the WAI-ARIA tabs pattern with MANUAL activation, as
     * Financials' own row is (js/financials/page.js:1056): Left and Right
     * (wrapping) and Home and End move FOCUS along the row, and Enter or Space
     * opens the focused tab. Moving onto a tab does not open it, because
     * opening one starts reads. Leaving the row puts the one tab stop back on
     * the selected tab.
     *
     * @param o.tabs     [{ id, label }]
     * @param o.active   the id that starts selected (default the first)
     * @param o.label    the tablist's accessible name (default "Sections")
     * @param o.panel    the element the tabs show, optional: it becomes the
     *                   role="tabpanel" every tab controls, named by the
     *                   selected tab
     * @param o.onChange (id) when a different tab is opened
     * @returns { el, setActive(id) }; setActive fires no onChange
     */
    function mainTabs(o) {
        const t = tabSet(o, {
            name: 'mainTabs',
            cls: 'kit-main-tabs',
            steps: STEPS.row,
            follow: false,
            fill: underlineFill
        });
        return { el: t.el, setActive: t.setActive };
    }

    /**
     * The sub tabs (pick tabs__sub-tabs, "Sub-tabs"): the same underline row
     * one step down, for the views inside a section. The same keyboard as the
     * main tabs, MANUAL activation: the arrow keys and Home and End move focus,
     * Enter or Space opens. Inventory's rows it is copied from
     * (js/inventory/stock.js:455) have no arrow keys at all; they take the
     * row above them's, since opening a view there starts reads too.
     *
     * Options and return as Kit.mainTabs.
     */
    function subTabs(o) {
        const t = tabSet(o, {
            name: 'subTabs',
            cls: 'kit-sub-tabs',
            steps: STEPS.row,
            follow: false,
            fill: underlineFill
        });
        return { el: t.el, setActive: t.setActive };
    }

    /**
     * The side tabs (pick tabs__side-tabs, "Financials filter menu tabs"): a
     * vertical rail, the WAI-ARIA tabs pattern with aria-orientation
     * "vertical" and AUTOMATIC activation, as the Filters menu's rail is
     * (js/financials/controls.js:1825): Up and Down (wrapping) and Home and
     * End move to a tab AND open it, since opening one only swaps the pane
     * beside the rail. The selected tab carries a chevron; a tab whose filter
     * is in use shows the filled wine check in place of its glyph.
     *
     * @param o.tabs     [{ id, label, icon }]; icon is a glyph name
     *                   (calendar, gte, tag, store, filter) or path data
     * @param o.active   the id that starts selected (default the first)
     * @param o.applied  [id]: the tabs whose filter is in use
     * @param o.label    the tablist's accessible name (default "Sections")
     * @param o.panel    the pane beside the rail, optional, as Kit.mainTabs
     * @param o.onChange (id) when a different tab is opened
     * @returns { el, setActive(id), setApplied(ids) }; neither fires onChange
     */
    function sideTabs(o) {
        const c = o || {};
        let applied = listOf(c.applied, 'sideTabs', 'applied').map(String);
        const t = tabSet(c, {
            name: 'sideTabs',
            cls: 'kit-side-tabs',
            steps: STEPS.column,
            follow: true,
            fill(tab, b, on) {
                const inUse = applied.indexOf(String(tab.id)) > -1;
                b.replaceChildren(
                    el('span', { class: 'kit-side-tabs__icon' }, [
                        inUse
                            ? Kit.glyph('checkCircle', { cls: 'kit-side-tabs__check' })
                            : Kit.glyph(tab.icon || 'filter', { cls: 'kit-side-tabs__glyph' })
                    ]),
                    el('span', { class: 'kit-side-tabs__label', text: String(tab.label != null ? tab.label : tab.id) })
                );
                if (on) b.appendChild(Kit.glyph('chevronRight', { cls: 'kit-side-tabs__chev' }));
            }
        });
        return {
            el: t.el,
            setActive: t.setActive,
            setApplied(ids) {
                applied = listOf(ids, 'sideTabs', 'applied').map(String);
                t.repaint();
            }
        };
    }

    /**
     * The in-page switch (pick tabs__in-page-switch, "Financials segmented
     * control"): a few choices side by side, the chosen one a lifted segment.
     * Copied from FinControls.segmented (js/financials/controls.js:980), with
     * AUTOMATIC activation as there: the arrow keys and Home and End move the
     * choice and the focus together, wrapping. One tab stop.
     *
     * It picks a VALUE, so it is a radio group, as the source is
     * (role="radiogroup", each segment role="radio" with aria-checked), and
     * all four arrows step. Given a `panel` it switches a VIEW instead, so it
     * is a tablist (role="tab", aria-selected, aria-controls, the panel a
     * tabpanel) and only Left and Right step, per the WAI-ARIA tabs pattern.
     *
     * @param o.options  [{ value, label, icon }]; icon is a glyph name
     *                   (chartMixed, chartLine, chartColumn, sankey) or path data
     * @param o.value    the value that starts chosen (default the first)
     * @param o.label    the group's accessible name (default "View")
     * @param o.full     true to fill the width, split evenly
     * @param o.icons    true for 38px glyph-only segments; each label is then
     *                   its segment's accessible name
     * @param o.panel    the element it switches, optional
     * @param o.onChange (value) when a different segment is chosen
     * @returns { el, setValue(v) }; setValue fires no onChange
     */
    function inlineSwitch(o) {
        const c = o || {};
        const options = listOf(c.options, 'inlineSwitch', 'options');
        const values = options.map((x) => String(x.value));
        const asTabs = !!(c.panel && c.panel.nodeType === 1);
        const stateAttr = asTabs ? 'aria-selected' : 'aria-checked';
        let value = c.value != null && values.indexOf(String(c.value)) > -1 ? String(c.value) : values[0] || null;
        const root = el('div', {
            class:
                'kit-inline-switch' +
                (c.full ? ' kit-inline-switch--full' : '') +
                (c.icons ? ' kit-inline-switch--icons' : ''),
            role: asTabs ? 'tablist' : 'radiogroup',
            'aria-label': c.label || 'View'
        });
        const segs = options.map((opt, i) => {
            const words = String(opt.label != null ? opt.label : opt.value);
            const b = el(
                'button',
                {
                    class: 'kit-inline-switch__opt',
                    type: 'button',
                    role: asTabs ? 'tab' : 'radio',
                    id: asTabs ? tabId('inline-switch-tab') : null,
                    'aria-label': c.icons ? words : null,
                    dataset: { value: values[i] }
                },
                [
                    opt.icon ? Kit.glyph(opt.icon, { cls: 'kit-inline-switch__icon' }) : null,
                    c.icons ? null : document.createTextNode(words)
                ]
            );
            b.addEventListener('click', () => pick(values[i], false));
            root.appendChild(b);
            return b;
        });
        const panel = asTabs ? bindPanel(c.panel, segs) : null;

        function paint() {
            segs.forEach((b, i) => {
                const on = values[i] === value;
                b.setAttribute(stateAttr, String(on));
                b.tabIndex = on ? 0 : -1;
            });
            const at = values.indexOf(value);
            if (panel && at > -1) panel.setAttribute('aria-labelledby', segs[at].id);
        }

        function pick(v, focus) {
            const at = values.indexOf(v);
            if (at < 0) return;
            const changed = v !== value;
            value = v;
            paint();
            if (focus) segs[at].focus();
            if (changed && typeof c.onChange === 'function') c.onChange(v);
        }

        root.addEventListener('keydown', (e) => {
            const at = segs.indexOf(document.activeElement);
            if (at < 0) return;
            const next = stepFrom(e.key, at, segs.length, asTabs ? STEPS.row : STEPS.any);
            if (next < 0) return;
            e.preventDefault();
            pick(values[next], true);
        });

        paint();
        return {
            el: root,
            /** The caller telling the switch what already happened. Fires no onChange. */
            setValue(v) {
                if (values.indexOf(String(v)) < 0) return;
                value = String(v);
                paint();
            }
        };
    }

    /* ---------------------------------------------------------------------
     * Chips and tags (owner picks, 2026-09-28, docs/ui-library/standards.md).
     *
     * Three new display parts beside Kit.pill, the status tag, which was
     * picked as it is, and beside Kit.count and Kit.roleChip, all unchanged:
     * the number badge (Kit.numberBadge), the label on a camera picture
     * (Kit.overlayLabel) and the plain tag (Kit.plainTag). None takes the
     * pointer; the two chips that do (Kit.filterChip, Kit.pickChips) are
     * controls and live in forms.js. A tone or a state is a class or a data
     * attribute; css/kit-standards.css owns what it looks like.
     * ------------------------------------------------------------------- */

    const BADGE_TONES = ['warn', 'ok', 'bad'];

    /**
     * The number badge (pick chips__number-badge, "Grey count on a tab"): a
     * count in tabular figures on the grey chip, lighter with the full ink on
     * the selected tab. Copied from .emp-count (css/employees.css:560-579).
     * Inside a role="tab" it follows that tab's aria-selected by itself.
     *
     * ⛔ `n` must be a real number. null, undefined and NaN HIDE the badge,
     * as Kit.count's do (setBadge, above), rather than print a zero nobody
     * measured.
     *
     * @param n          the count
     * @param o.tone     'warn' (needs a look), 'ok' (all clear) or 'bad'
     *                   (critical); none for the grey
     * @param o.selected true for the badge of a selected tab that is not a
     *                   role="tab" the stylesheet can see
     * @returns the <span>
     */
    function numberBadge(n, o) {
        const c = o || {};
        const tone = BADGE_TONES.indexOf(String(c.tone)) > -1 ? String(c.tone) : null;
        const badge = el('span', {
            class: 'kit-number-badge' + (tone ? ' kit-number-badge--' + tone : '') + (c.selected ? ' is-selected' : '')
        });
        setBadge(badge, n);
        return badge;
    }

    const OVERLAY_STATES = ['connecting', 'reconnecting', 'offline', 'auth_expired', 'video_loss', 'live', 'demo'];

    /**
     * The label on a camera picture (pick chips__overlay-label, "Label on a
     * camera picture"): small words on dark glass in the picture's top-left
     * corner, coloured by what the camera is doing. Copied from .live-chip
     * (css/argus-wall.css:128-290). Live is a green dot that pulses and paints
     * no words, so it is an image with a name. The picture it sits on must be
     * position: relative.
     *
     * @param o.text  the words: the camera's name, or what is happening
     * @param o.state 'connecting' (blue), 'reconnecting' (amber), 'offline',
     *                'auth_expired' or 'video_loss' (red), 'live' (the dot),
     *                'demo' (a camera showing sample footage: the plain grey
     *                label, reading "Demo" unless given words); none for the
     *                plain grey words
     * @param o.label the live dot's name (default "Live")
     * @returns the <span>
     */
    function overlayLabel(o) {
        const c = o || {};
        const state = OVERLAY_STATES.indexOf(String(c.state)) > -1 ? String(c.state) : null;
        const live = state === 'live';
        return el('span', {
            class: 'kit-overlay-label',
            dataset: state ? { state: state } : null,
            role: live ? 'img' : null,
            'aria-label': live ? c.label || 'Live' : null,
            text: live ? null : c.text != null ? String(c.text) : state === 'demo' ? 'Demo' : null
        });
    }

    const TAG_TONES = ['muted', 'ok', 'warn', 'bad'];

    /**
     * The plain tag (pick chips__plain-tag, "Outline tag"): a name in a
     * hairline outline and no fill, a category or a kind, not a status (a
     * status is Kit.pill). Copied from ArgusTable's .atbl-badge
     * (css/kit-table.css:424-452); the ok, warn and bad outlines are the Loss
     * prevention badges' (css/argus.css:13530-13565).
     *
     * @param text     the words
     * @param o.tone   'muted', 'ok', 'warn' or 'bad'; none for the plain outline
     * @param o.small  true for the 18px a narrow table cell takes, ending in
     *                 an ellipsis (no browser tooltip: the kit draws none)
     * @returns the <span>
     */
    function plainTag(text, o) {
        const c = o || {};
        const tone = TAG_TONES.indexOf(String(c.tone)) > -1 ? String(c.tone) : null;
        const words = text == null ? '' : String(text);
        return el('span', {
            class: 'kit-plain-tag' + (tone ? ' kit-plain-tag--' + tone : '') + (c.small ? ' kit-plain-tag--small' : ''),
            text: words
        });
    }

    const LINE_HEAD = ['Name', '% of total', 'Amount'];
    const LINE_STATES = ['loading', 'failed', 'empty', 'ready'];

    /**
     * An absent figure: the kit's missing figure (Kit.missingFigure, the
     * feedback family's one dash), named for a screen reader.
     */
    function lineNone(reason) {
        return missingFigure({ label: reason });
    }

    /** Cents as the source prints them: U+2212 minus, the cents raised. */
    function lineMoney(cents) {
        const n = typeof cents === 'number' && isFinite(cents) ? Math.round(cents) : null;
        if (n === null) return lineNone('No amount');
        const s = Kit.fmt.money(Math.abs(n));
        const dot = s.lastIndexOf('.');
        return el('span', null, [
            el('span', { text: (n < 0 ? '−' : '') + s.slice(0, dot) }),
            el('span', { class: 'kit-line-table__cents', text: s.slice(dot) })
        ]);
    }

    /**
     * The rows' shape as the kit's loading placeholder (Kit.loadingPlaceholder,
     * the feedback family's one bar): a cell's words, a shorter share and the
     * amount at the right edge. They breathe while the table is busy; under an
     * empty table's sentence they hold still (css/kit-standards.css).
     */
    function lineGhost(n) {
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push(
                el('tr', { class: 'kit-line-table__row kit-line-table__row--ghost', 'aria-hidden': 'true' }, [
                    el('td', { class: 'kit-line-table__name' }, [loadingPlaceholder({ size: 'cell' })]),
                    el('td', { class: 'kit-line-table__pctcell' }, [loadingPlaceholder({ size: 'cell', short: true })]),
                    el('td', { class: 'kit-line-table__amt' }, [loadingPlaceholder({ size: 'amount' })])
                ])
            );
        }
        return out;
    }

    /**
     * The line table (pick tables__line-table, "Financials top money in /
     * out"): lines inside a card or a dialog, with no frame of its own. Three
     * columns: what it is, its share of the total (the figure and a bar that
     * starts where the rows above it ended), and the amount. Copied from
     * Financials Insights' breakdown (js/financials/view-insights.js:2697-2810,
     * .fi-bd in css/financials-insights.css:618-748).
     *
     * @param o.label      the table's name for a screen reader
     * @param o.head       its three headings (default Name, % of total, Amount)
     * @param o.rows       [{ name, pct, cents, onOpen }]: pct 0 to 100, cents
     *                     whole cents (money out negative). A row with onOpen
     *                     opens something: its name is the button that does it,
     *                     and a click anywhere on the row does it too.
     * @param o.tone       'in' or 'out' (the default): the bar's colour
     * @param o.state      'loading', 'failed', 'empty' or 'ready'; left out,
     *                     no rows is empty and rows: null (a failed read) is
     *                     failed
     * @param o.emptyText  the sentence over the empty table
     * @param o.failedText the sentence a failed read shows, on its own
     * @param o.onRetry    adds Try again under failedText
     * @param o.ghostRows  how many rows loading draws (default 7)
     * @param o.hint       optional: what a named row opens, said to a screen
     *                     reader and not shown, as the source's sentence is
     *                     ("Each named row opens Transactions filtered to it.")
     * @returns the <div>
     */
    let lineUid = 0;
    function lineTable(o) {
        const c = o || {};
        const rows = c.rows === null ? null : listOf(c.rows, 'lineTable', 'rows');
        let state = LINE_STATES.indexOf(c.state) > -1 && c.state !== 'ready' ? c.state : null;
        if (!state) state = rows === null ? 'failed' : rows.length ? 'ready' : 'empty';
        const head = Array.isArray(c.head) && c.head.length === 3 ? c.head.map(String) : LINE_HEAD;
        const root = el('div', {
            class: 'kit-line-table' + (c.tone === 'in' ? ' kit-line-table--in' : ''),
            'aria-busy': state === 'loading' ? 'true' : null
        });

        // A failed read says so and nothing else: no header, no bars, no zero.
        if (state === 'failed') {
            const plate = el('div', { class: 'kit-line-table__fail', role: 'alert' }, [
                el('p', { class: 'kit-line-table__fail-text', text: c.failedText || 'Could not load these rows.' })
            ]);
            if (typeof c.onRetry === 'function') {
                const retry = el('button', { type: 'button', class: 'kit-everyday', text: 'Try again' });
                retry.addEventListener('click', () => c.onRetry());
                plate.appendChild(retry);
            }
            root.appendChild(plate);
            return root;
        }

        // A table a screen reader cannot name reads as "table" and nothing else.
        if (!c.label) warn('[Kit] lineTable: no label, so a screen reader cannot tell this table from the next one.');
        const tbody = el('tbody', { role: 'rowgroup' });
        const table = el('table', { class: 'kit-line-table__table', role: 'table', 'aria-label': c.label || null }, [
            el('thead', { role: 'rowgroup' }, [
                el('tr', { class: 'kit-line-table__row kit-line-table__row--head', role: 'row' }, [
                    el('th', { class: 'kit-line-table__name', role: 'columnheader', scope: 'col', text: head[0] }),
                    el('th', { class: 'kit-line-table__pctcell', role: 'columnheader', scope: 'col', text: head[1] }),
                    el('th', { class: 'kit-line-table__amt', role: 'columnheader', scope: 'col', text: head[2] })
                ])
            ]),
            tbody
        ]);
        root.appendChild(table);

        if (state === 'loading') {
            const n = Math.max(1, Math.min(20, Math.floor(Number(c.ghostRows)) || 7));
            lineGhost(n).forEach((tr) => tbody.appendChild(tr));
            return root;
        }
        // An honest empty keeps the table's shape: still bars under a sentence.
        if (state === 'empty') {
            lineGhost(3).forEach((tr) => tbody.appendChild(tr));
            root.appendChild(
                el('p', { class: 'kit-line-table__msg', role: 'status', text: c.emptyText || 'Nothing to show yet.' })
            );
            return root;
        }

        let offset = 0;
        const round = (v) => Math.round(v * 100) / 100;
        const clamp = (v) => Math.max(0, Math.min(100, v));
        let opens = false;
        rows.forEach((r) => {
            const name = r.name == null || r.name === '' ? null : String(r.name);
            let open = typeof r.onOpen === 'function' ? r.onOpen : null;
            if (open && !name) {
                // The name is the button a keyboard opens the row with; with
                // no name there is nothing to reach, so the row opens nothing
                // rather than open for the pointer alone.
                warn(
                    '[Kit] lineTable: a row with onOpen has no name, so no keyboard can open it; drawn as a plain row.'
                );
                open = null;
            }
            if (open) opens = true;
            const tr = el('tr', { class: 'kit-line-table__row' + (open ? ' is-link' : ''), role: 'row' });
            let link = null;
            let what = lineNone('No name');
            if (name && open) {
                link = el('button', { type: 'button', class: 'kit-line-table__link', text: name });
                link.addEventListener('click', (e) => open(r, e));
                what = link;
            } else if (name) {
                what = el('span', { class: 'kit-line-table__label', text: name });
            }
            if (open) {
                // A click anywhere on the row opens it too; the keyboard's way
                // in is the name, which is a real button.
                tr.addEventListener('click', (e) => {
                    if (link && link.contains(e.target)) return;
                    open(r, e);
                });
            }
            const p = typeof r.pct === 'number' && isFinite(r.pct) ? r.pct : null;
            const share = el('span', { class: 'kit-line-table__share', 'aria-hidden': 'true' });
            if (p !== null && p > 0) {
                const off = clamp(offset);
                const w = round(Math.min(clamp(p), 100 - off));
                const fill = el('span', { class: 'kit-line-table__fill' });
                // Geometry, as a column width is: where this row's share starts
                // (1px after the rows above it end) and how far it runs.
                fill.style.left = off > 0 ? 'calc(' + round(off) + '% + 1px)' : '0';
                fill.style.width = off > 0 ? 'calc(' + w + '% - 1px)' : w + '%';
                share.appendChild(fill);
                offset += p;
            }
            tr.appendChild(el('td', { class: 'kit-line-table__name', role: 'cell' }, [what]));
            tr.appendChild(
                el('td', { class: 'kit-line-table__pctcell', role: 'cell' }, [
                    p === null
                        ? lineNone('No share')
                        : el('span', {
                              class: 'kit-line-table__pct',
                              text: (Math.round(p * 10) / 10).toFixed(1) + '%'
                          }),
                    share
                ])
            );
            tr.appendChild(el('td', { class: 'kit-line-table__amt', role: 'cell' }, [lineMoney(r.cents)]));
            tbody.appendChild(tr);
        });
        if (opens && c.hint) {
            const id = 'kit-line-table-hint-' + ++lineUid;
            root.appendChild(el('p', { class: 'kit-line-table__hint', id, text: String(c.hint) }));
            table.setAttribute('aria-describedby', id);
        }
        return root;
    }

    /* ── The tiles family (owner picks, 2026-09-28) ──────────────────────
     * Three figure standards beside Kit.balance (the figure card with a
     * chart), each copied from the screen the owner picked it on, which is
     * unchanged. None of their names says card or tile (see the header): the
     * shell repaints those inside .portal-main. */

    const FIG_MINUS = '−';
    const FIG_NONE = '–';
    let figureUid = 0;

    /**
     * WCAG 1.4.13 for a tip (Kit.hoverTip, and a headline figure's label).
     * The CSS shows it while the pointer is on the trigger or on the tip
     * itself, and while the trigger has focus; this puts it away on Escape
     * without moving either, until both have left. The Escape listener is on
     * the window only while the pointer or the focus is here, so a page of
     * tips holds none at rest. It listens in the capture phase on the WINDOW,
     * which hears a key before the document does, and stops it there: the
     * kit's dialogs and pop-ups listen on the document, so Escape closes the
     * tip and not the dialog or the pop-up the tip sits in (the innermost
     * thing only).
     */
    function tipEscape(head, label, place) {
        let hovered = false;
        let focused = false;
        let armed = false;
        const onKey = (e) => {
            if (e.key !== 'Escape' && e.key !== 'Esc') return;
            if (!head.isConnected) return disarm();
            if (head.classList.contains('is-dismissed')) return;
            head.classList.add('is-dismissed');
            e.stopPropagation();
        };
        // `place` (Kit.hoverTip's): where the tip goes, measured each time it
        // shows and again, while it is up, whenever its trigger can have moved:
        // a scroll, a resize, and the end of an animation or a transition (a
        // window still rising when the tip opened). All four listeners live
        // only while the tip is shown.
        const MOVES = [
            ['scroll', true],
            ['resize', false],
            ['animationend', true],
            ['transitionend', true]
        ];
        const onMove = () => {
            if (place) place(true);
        };
        function disarm() {
            if (!armed) return;
            window.removeEventListener('keydown', onKey, true);
            if (place) MOVES.forEach(([type, capture]) => window.removeEventListener(type, onMove, capture));
            armed = false;
        }
        const settle = () => {
            if (hovered || focused) {
                if (!armed) {
                    window.addEventListener('keydown', onKey, true);
                    if (place) MOVES.forEach(([type, capture]) => window.addEventListener(type, onMove, capture));
                }
                armed = true;
                if (place) place(true);
                return;
            }
            disarm();
            head.classList.remove('is-dismissed');
            if (place) place(false);
        };
        head.addEventListener('pointerenter', () => {
            hovered = true;
            settle();
        });
        head.addEventListener('pointerleave', () => {
            hovered = false;
            settle();
        });
        label.addEventListener('focus', () => {
            focused = true;
            settle();
        });
        label.addEventListener('blur', () => {
            focused = false;
            settle();
        });
    }

    /**
     * A dash for a figure nobody has, named for a screen reader: the kit's
     * missing figure (Kit.missingFigure, the feedback family's), in the
     * figure's slot, at the slot's size. `cls` gives it the slot's type.
     */
    function figNone(cls, words) {
        const m = missingFigure({ label: words });
        if (cls) m.classList.add(cls);
        return m;
    }

    /**
     * Kit.figureRow({ label, figures: [{ label, value, sub, tip }], state, failedText })
     *
     * Financials Spending's headline figures (pick tiles__figure-row): flat, no
     * box, no chart. The first figure is the hero; up to two more sit beside
     * it on its baseline.
     *   value   the caller's formatted text. A hero value that starts with a
     *           minus hangs the minus in the margin. null is a figure nobody
     *           can give (an average with no full month): the dash, lighter.
     *   sub     the line under it ("vs. $11,020.00 previous period").
     *   tip     what the label means: a dotted underline, and the kit's own
     *           tip above it, never a browser tooltip. It opens under the
     *           pointer and on focus (a tap too), stays while the pointer is
     *           on it, and Escape puts it away (tipEscape).
     *   state   'loading' pulses a bar where every figure goes; 'failed' puts
     *           the dash and failedText ("Did not load") under every label.
     */
    function figureRow(o) {
        const c = o || {};
        const figs = listOf(c.figures, 'figureRow', 'figures').slice(0, 3);
        const state = c.state === 'loading' || c.state === 'failed' ? c.state : null;
        const root = el('div', {
            class: 'kit-figure-row',
            role: c.label ? 'group' : null,
            'aria-label': c.label || null,
            'aria-busy': state === 'loading' ? 'true' : null
        });
        const rest = el('div', { class: 'kit-figure-row__rest' });
        figs.forEach((f, i) => {
            const hero = i === 0;
            const fig = f || {};
            const item = el('div', { class: 'kit-figure-row__item' + (hero ? ' kit-figure-row__item--hero' : '') });
            const head = el('div', { class: 'kit-figure-row__head' });
            const label = el('span', {
                class: 'kit-figure-row__label',
                text: fig.label == null ? '' : String(fig.label)
            });
            head.appendChild(label);
            if (fig.tip) {
                const id = 'kit-figure-row-tip-' + ++figureUid;
                label.classList.add('is-tip');
                label.setAttribute('tabindex', '0');
                label.setAttribute('aria-describedby', id);
                // The kit's hover tip look (pick overlays__hover-tip), placed
                // where this row puts it.
                head.appendChild(
                    el('span', {
                        class: 'kit-figure-row__tip kit-hover-tip',
                        role: 'tooltip',
                        id,
                        text: String(fig.tip)
                    })
                );
                tipEscape(head, label);
            }
            item.appendChild(head);
            const value = el('div', { class: 'kit-figure-row__value' });
            const sub = el('div', { class: 'kit-figure-row__sub' });
            const text = fig.value == null ? '' : String(fig.value);
            if (state === 'loading') {
                value.appendChild(loadingPlaceholder({ size: hero ? 'hero' : 'figure' }));
            } else if (state === 'failed' || !text) {
                item.classList.add('is-unknown');
                value.appendChild(figNone(null, state === 'failed' ? 'Not loaded' : 'Not known'));
                sub.textContent = state === 'failed' ? c.failedText || 'Did not load' : fig.sub ? String(fig.sub) : '';
            } else {
                if (hero && (text.charAt(0) === FIG_MINUS || text.charAt(0) === '-')) {
                    value.appendChild(el('span', { class: 'kit-figure-row__sign', text: FIG_MINUS }));
                    value.appendChild(document.createTextNode(text.slice(1)));
                } else value.textContent = text;
                if (fig.sub) sub.textContent = String(fig.sub);
            }
            item.appendChild(value);
            item.appendChild(sub);
            (hero ? root : rest).appendChild(item);
        });
        if (rest.childNodes.length) root.appendChild(rest);
        return root;
    }

    /* ── The hover tip (owner pick overlays__hover-tip, 2026-09-29) ─────
     * The Dashboard's chart tips (.kw-kpi__tip, css/kpi-wall.css:1779-1825;
     * .kwt-tip, :806-835), read there and never edited, made the kit's tip
     * for labels, icon buttons and every other surface that is not a chart.
     * Charts keep their own hover cards (owner). css/kit-standards.css draws it. */

    let hoverTipUid = 0;
    /** Takes focus on its own: nothing to add for the keyboard or a tap. */
    const OWN_FOCUS = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
    const TIP_EDGE = 8;
    const TIP_GAP = 6;

    /** The box the nearest scrolling or clipping ancestor cuts its content to. */
    function clipOf(n) {
        for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
            let cs = null;
            try {
                cs = window.getComputedStyle(p);
            } catch (_e) {
                cs = null;
            }
            if (cs && /(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) {
                return p.getBoundingClientRect();
            }
        }
        return null;
    }

    /**
     * ⛔ A TIP IN A SCROLLING BOX IS CUT OFF BY IT. A pop-up window's body
     * scrolls, so the tip over its first row opened above the body's top edge
     * and lost its top half. So each time the tip shows it is measured where
     * the sheet put it; when it does not fit inside the box that clips it (or
     * the screen), it is lifted out: fixed to the screen beside its trigger,
     * above it or, with no room there, below it, and held inside the screen's
     * edges. Nothing moves when it fits, and jsdom, which lays nothing out,
     * never lifts one.
     *
     * ⛔ THE PLACE COMES FROM THE TRIGGER'S RECT NOW, AND IS CHECKED WHERE IT
     * LANDED. A window rising open is scaled, and a scaled ancestor is the
     * box `position: fixed` measures from: a tip lifted in its first frames
     * landed some 300px off, and one placed then stayed 5px over its trigger
     * once the rise ended. So the tip is measured after it is placed and
     * moved by what it missed by, and Kit.hoverTip places it again every
     * frame until the trigger stops moving and when an animation ends.
     */
    function placeTip(host, trigger, tip, on) {
        tip.classList.remove('is-lifted', 'is-lifted-below');
        tip.style.left = '';
        tip.style.top = '';
        if (!on) return;
        const r = tip.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const c = clipOf(host);
        const box = {
            top: Math.max(0, c ? c.top : 0),
            left: Math.max(0, c ? c.left : 0),
            right: Math.min(vw, c ? c.right : vw),
            bottom: Math.min(vh, c ? c.bottom : vh)
        };
        if (r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right) return;
        const h = trigger.getBoundingClientRect();
        const wantsBelow = host.classList.contains('kit-hover-tip-host--below');
        const above = h.top - TIP_GAP - r.height;
        const below = h.bottom + TIP_GAP;
        const under = wantsBelow ? below + r.height <= vh - TIP_EDGE || above < TIP_EDGE : above < TIP_EDGE;
        const top = under ? below : above;
        const left = Math.max(TIP_EDGE, Math.min(h.left + h.width / 2 - r.width / 2, vw - r.width - TIP_EDGE));
        tip.classList.add('is-lifted');
        if (under) tip.classList.add('is-lifted-below');
        tip.style.left = Math.round(left) + 'px';
        tip.style.top = Math.round(top) + 'px';
        // Where it actually landed: a transformed ancestor shifts `fixed`.
        const got = tip.getBoundingClientRect();
        const dx = got.left - left;
        const dy = got.top - top;
        if (Math.abs(dx) > 0.5) tip.style.left = Math.round(left - dx) + 'px';
        if (Math.abs(dy) > 0.5) tip.style.top = Math.round(top - dy) + 'px';
    }

    /**
     * Kit.hoverTip's placer: places the tip, then again each frame while its
     * trigger is still moving (a window rising open), up to a few frames, and
     * stops the moment it hides.
     */
    const TIP_FRAMES = 8;
    function tipPlacer(host, trigger, tip) {
        let raf = 0;
        const hasFrames = typeof window.requestAnimationFrame === 'function';
        function stop() {
            if (raf && hasFrames) window.cancelAnimationFrame(raf);
            raf = 0;
        }
        return function place(on) {
            stop();
            placeTip(host, trigger, tip, on);
            if (!on || !hasFrames) return;
            let frames = 0;
            let last = '';
            const step = () => {
                raf = 0;
                const r = trigger.getBoundingClientRect();
                const at = [r.left, r.top, r.width, r.height].join(',');
                if (at === last || ++frames > TIP_FRAMES) return;
                last = at;
                placeTip(host, trigger, tip, true);
                raf = window.requestAnimationFrame(step);
            };
            raf = window.requestAnimationFrame(step);
        };
    }

    /** The tip's words: a plain line, or the chart tip's three lines. */
    function fillTip(tip, c) {
        tip.replaceChildren();
        if (c.when == null && c.value == null && c.note == null) {
            tip.textContent = c.text == null ? '' : String(c.text);
            return;
        }
        if (c.when != null) tip.appendChild(el('span', { class: 'kit-hover-tip__when', text: String(c.when) }));
        if (c.value != null) tip.appendChild(el('span', { class: 'kit-hover-tip__val', text: String(c.value) }));
        if (c.note != null) tip.appendChild(el('span', { class: 'kit-hover-tip__note', text: String(c.note) }));
    }

    /**
     * Kit.hoverTip({ trigger, text | when, value, note, below })
     *
     * A small near-black card (white in light) above its trigger, the kit's
     * one hover tip, never the browser's `title` tooltip.
     *   trigger  the element the tip explains: a button, a word, an icon. A
     *            trigger that takes no focus of its own (a word in a <span>)
     *            is put in the tab order, with a dotted underline, so the
     *            keyboard and a tap reach it.
     *   text     the tip, one line of words; or
     *   when, value, note  the chart tip's lines: a date, a heavy figure,
     *            and a small line under it
     *   below    opens under the trigger instead of above it
     *
     * WCAG 1.4.13 (tipEscape): it opens under the pointer and on focus, so a
     * tap opens it too; it stays while the pointer moves onto it; Escape puts
     * it away without moving the pointer or the focus, and closes nothing
     * else. The tip describes the trigger (aria-describedby, role=tooltip).
     *
     * Returns the host, a <span> holding the trigger and its tip, standing
     * where the trigger stood (put it there yourself for a trigger not yet on
     * the page). host.kitSet({ text, when, value, note }) says
     * something else.
     */
    function hoverTip(o) {
        const c = o || {};
        const trigger = c.trigger && c.trigger.nodeType === 1 ? c.trigger : null;
        const host = el('span', { class: 'kit-hover-tip-host' + (c.below ? ' kit-hover-tip-host--below' : '') });
        if (!trigger) {
            warn('[Kit] hoverTip: `trigger` must be an element; a tip with nothing to explain draws nothing.');
            return host;
        }
        const id = 'kit-hover-tip-' + ++hoverTipUid;
        const tip = el('span', { class: 'kit-hover-tip', role: 'tooltip', id });
        fillTip(tip, c);
        if (!OWN_FOCUS.test(trigger.tagName) && !trigger.hasAttribute('tabindex')) {
            trigger.setAttribute('tabindex', '0');
            trigger.classList.add('kit-hover-tip__label');
        }
        const was = trigger.getAttribute('aria-describedby');
        trigger.setAttribute('aria-describedby', was ? was + ' ' + id : id);
        // A trigger already on the page keeps its place: the host takes it.
        if (trigger.parentNode) trigger.parentNode.replaceChild(host, trigger);
        host.appendChild(trigger);
        host.appendChild(tip);
        tipEscape(host, trigger, tipPlacer(host, trigger, tip));
        host.kitTip = tip;
        host.kitSet = function (v) {
            fillTip(tip, v || {});
        };
        return host;
    }

    /**
     * Kit.plainFigure({ label, value, sub })
     *
     * Enterprise All stores' figure card (pick tiles__plain-figure-card): a
     * box with a label, one figure and a small line under it; no chart. value
     * is the caller's formatted text; null is absent (nothing to add up): the
     * dash, lighter and lighter weight, on a dashed edge. It opens nothing.
     */
    function plainFigure(o) {
        const c = o || {};
        const text = c.value == null ? '' : String(c.value);
        return el('div', { class: 'kit-plain-figure' + (text ? '' : ' kit-plain-figure--absent') }, [
            el('div', { class: 'kit-plain-figure__label', text: c.label == null ? '' : String(c.label) }),
            text
                ? el('div', { class: 'kit-plain-figure__value', text })
                : el('div', { class: 'kit-plain-figure__value' }, [figNone(null, 'No figure')]),
            c.sub ? el('div', { class: 'kit-plain-figure__sub', text: String(c.sub) }) : null
        ]);
    }

    const STATUS_TONES = ['good', 'watch', 'bad'];

    /**
     * Kit.statusFigure({ name, score, unit, what, status, state, onOpen, openLabel })
     *
     * The Dashboard's health score (pick tiles__status-tile): no box, a
     * hairline on top with a short red rule at its start, the name, a big
     * score, two lines on what it measures and a status line.
     *   score   the figure's text ('96.4', '12' for a to-do count); null is
     *           no reading yet, a dash in the faint ink.
     *   unit    after the figure ('%'), in the lighter ink.
     *   status  { tone: 'good' | 'watch' | 'bad', text }: a mark and its words;
     *           { signals: [true, false, false] }: a thin meter, the arriving
     *           ones first, and "1 of 3 signals arriving"; { text }: words.
     *   state   'loading': a grey rule, a dash and "Checking".
     *   onOpen  makes it a button named for what it shows, which opens the
     *           details (openLabel, default "Open details"): the rule draws
     *           across and the arrow steps right under the pointer. Without it
     *           the figure opens nothing and shows no arrow and no hover.
     */
    function statusFigure(o) {
        const c = o || {};
        const loading = c.state === 'loading';
        const open = !loading && typeof c.onOpen === 'function' ? c.onOpen : null;
        const scored = !loading && c.score != null && c.score !== '';
        const name = c.name == null ? '' : String(c.name);
        const root = el(open ? 'button' : 'div', {
            class: 'kit-status-figure' + (open ? ' kit-status-figure--link' : '') + (scored ? ' is-live' : ''),
            type: open ? 'button' : null,
            'aria-busy': loading ? 'true' : null
        });
        const top = el('span', { class: 'kit-status-figure__top' }, [
            el('span', { class: 'kit-status-figure__name', text: name })
        ]);
        // The small arrow a score that opens something carries.
        if (open) top.appendChild(Kit.glyph('chevronRight', { cls: 'kit-status-figure__go' }));
        root.appendChild(top);
        const score = el('span', { class: 'kit-status-figure__score' + (scored ? '' : ' is-empty') });
        if (scored) {
            score.appendChild(el('span', { class: 'kit-status-figure__num', text: String(c.score) }));
            if (c.unit) score.appendChild(el('span', { class: 'kit-status-figure__unit', text: String(c.unit) }));
        } else score.appendChild(figNone('kit-status-figure__num', 'No score yet'));
        root.appendChild(score);
        root.appendChild(el('span', { class: 'kit-status-figure__what', text: c.what == null ? '' : String(c.what) }));

        const s = c.status || {};
        const status = el('span', { class: 'kit-status-figure__status' });
        const words = el('span', { class: 'kit-status-figure__words' });
        if (loading) words.textContent = 'Checking';
        else if (Array.isArray(s.signals) && s.signals.length) {
            const on = s.signals.filter((x) => x === true).length;
            const meter = el('span', { class: 'kit-status-figure__meter', 'aria-hidden': 'true' });
            s.signals.forEach((x, i) => {
                meter.appendChild(el('span', { class: 'kit-status-figure__seg' + (i < on ? ' is-on' : '') }));
            });
            status.appendChild(meter);
            words.textContent = on + ' of ' + s.signals.length + ' signals arriving';
        } else {
            const tone = STATUS_TONES.indexOf(s.tone) > -1 ? s.tone : null;
            if (tone) {
                status.classList.add('kit-status-figure__status--' + tone);
                status.appendChild(el('span', { class: 'kit-status-figure__mark', 'aria-hidden': 'true' }));
            }
            words.textContent = s.text == null ? '' : String(s.text);
        }
        status.appendChild(words);
        root.appendChild(status);

        if (open) {
            root.setAttribute(
                'aria-label',
                name +
                    ': ' +
                    (scored ? String(c.score) + (c.unit ? String(c.unit) : '') : 'no score yet') +
                    '. ' +
                    (words.textContent ? words.textContent + '. ' : '') +
                    (c.openLabel || 'Open details') +
                    '.'
            );
            root.addEventListener('click', (e) => open(e));
        }
        return root;
    }

    /* ---------------------------------------------------------------------
     * Banners, notices and empty states (owner picks, banners family).
     * ------------------------------------------------------------------- */

    // Settings Team's glyphs (js/settings/team.js:62-93), the good-news
    // line's tick and warning and the cross both lines' Dismiss button draws,
    // are Kit.glyph's check, alert and close. The ink is the CSS's.

    /**
     * Kit.couldNotLoad({ text, onRetry, retryLabel, announce, empty })
     *
     * Financials' failed chart as a kit part (pick banners__could-not-load;
     * js/financials/charts.js drawFailed and emptyNote): a flat plate in the
     * neutral fill with one centred sentence and, when the read can be asked
     * again, one Try again (the kit's everyday button, a named <button>).
     * The plate takes the height of what failed: put it in a box that has
     * that height, or let it fit its words.
     *   announce  true when it appears after the person did something (a Try
     *             again that failed again): it is an alert, read out at once.
     *             Drawn with the page it is not a live region.
     *   empty     the quiet-period note instead: no plate, the sentence on a
     *             raised note at 38% of the height of the chart it lies over,
     *             which keeps its zero. The chart's box is position: relative.
     * @returns the <div>
     */
    function couldNotLoad(o) {
        const c = o || {};
        const text = c.text == null || c.text === '' ? null : String(c.text);
        if (c.empty) {
            return el('div', { class: 'kit-could-not-load kit-could-not-load--empty' }, [
                el('p', { class: 'kit-could-not-load__text', text: text || 'Nothing to show yet.' })
            ]);
        }
        const root = el('div', { class: 'kit-could-not-load', role: c.announce ? 'alert' : null }, [
            el('p', { class: 'kit-could-not-load__text', text: text || 'Could not load these figures.' })
        ]);
        if (typeof c.onRetry === 'function') {
            const retry = el('button', {
                type: 'button',
                class: 'kit-everyday',
                text: c.retryLabel ? String(c.retryLabel) : 'Try again'
            });
            retry.addEventListener('click', () => c.onRetry());
            root.appendChild(retry);
        }
        return root;
    }

    /**
     * Where keyboard focus goes when a line is put away while focus was in
     * it (its Dismiss cross, its action): `returnFocus` when the caller names
     * a place, otherwise the element the line's region sits in, made
     * focusable for that one moment (tabindex -1, taken off again when focus
     * leaves it). Focus that was never in the line stays where it is.
     */
    function handBackFocus(had, region, returnFocus) {
        if (!had) return;
        const to = returnFocus && typeof returnFocus.focus === 'function' ? returnFocus : null;
        if (to && to.isConnected) {
            to.focus();
            if (document.activeElement === to) return;
        }
        const host = region.parentElement;
        if (!host) return;
        if (host.hasAttribute('tabindex')) {
            host.focus();
            return;
        }
        // Parked focus is a place to stand, not a control: data-kit-focus-park
        // keeps the app's red :focus-visible outline off it (kit-standards.css).
        host.setAttribute('tabindex', '-1');
        host.setAttribute('data-kit-focus-park', '');
        host.focus();
        const unpark = () => {
            host.removeAttribute('tabindex');
            host.removeAttribute('data-kit-focus-park');
        };
        if (document.activeElement !== host) {
            unpark();
            return;
        }
        host.addEventListener('blur', unpark, { once: true });
    }

    /** The round Dismiss cross both lines carry: a named button, its glyph hidden. */
    function dismissButton(cls, label) {
        return el('button', { type: 'button', class: cls, 'aria-label': label || 'Dismiss' }, [Kit.glyph('close')]);
    }

    /**
     * Kit.goodNews({ text, tone, onDismiss, dismissLabel, returnFocus })
     *   -> { el, show(text, { tone }), hide() }
     *
     * Settings Team's green 'done' line (pick banners__good-news;
     * js/settings/team.js notice()): the outcome of something the person just
     * did, said where no row is left to say it. A tick, the words and a
     * Dismiss cross on a green tint; tone 'bad' is the same line for an action
     * that failed, on the red tint with a warning glyph.
     *
     * ⛔ MOUNT `el` ONCE, BEFORE ANYTHING HAPPENS, AND CALL show() FOR EACH
     * OUTCOME. `el` is the live region: it stays in the page and is always
     * rendered (never display: none), and while there is nothing to say it
     * holds its line hidden and takes no room. show() writes the words into
     * it, so a screen reader hears them; a region inserted with its words
     * already in it often is not read at all. Good news is a polite status, a
     * failed action an alert. hide() and the cross put the line away; if focus
     * was on the cross it moves to `returnFocus`, or to the element the line
     * sits in. `text` draws the line at once, for a line already on screen
     * when the page draws (it is not announced).
     */
    function goodNews(o) {
        const c = o || {};
        const root = el('div', { class: 'kit-good-news', role: 'status' });
        const line = el('div', { class: 'kit-good-news__line' });
        const words = el('span', { class: 'kit-good-news__text' });
        const x = dismissButton('kit-good-news__x', c.dismissLabel);
        let glyph = null;
        line.hidden = true;
        line.appendChild(words);
        line.appendChild(x);
        root.appendChild(line);
        function show(text, opts) {
            const bad = !!(opts && opts.tone === 'bad');
            root.classList.toggle('kit-good-news--bad', bad);
            root.setAttribute('role', bad ? 'alert' : 'status');
            const g = Kit.glyph(bad ? 'alert' : 'check', { cls: 'kit-good-news__glyph' });
            if (glyph) line.replaceChild(g, glyph);
            else line.insertBefore(g, words);
            glyph = g;
            line.hidden = false;
            words.textContent = text == null ? '' : String(text);
        }
        function hide() {
            const had = line.contains(document.activeElement);
            line.hidden = true;
            words.textContent = '';
            handBackFocus(had, root, c.returnFocus);
        }
        x.addEventListener('click', () => {
            hide();
            if (typeof c.onDismiss === 'function') c.onDismiss();
        });
        if (c.text != null && c.text !== '') show(c.text, { tone: c.tone });
        return { el: root, show, hide };
    }

    /**
     * Kit.notice({ text, tone, action, onDismiss, dismissible, dismissLabel, returnFocus })
     *   -> { el, show(text, { tone, action }), hide() }
     *
     * Financials Transactions' notice line (pick banners__notice; .ftx-notice,
     * js/financials/view-transactions.js notice()): a sentence about the list
     * under it ("3 bills booked. They now count toward money out."). The words
     * in full ink on the neutral fill; tone 'warn' is the amber line for
     * something that needs a look ("Categories could not be loaded ...").
     *   action       { label, onClick }: one quiet text button after the words
     *                (the kit's quiet button, as the source's is).
     *   onDismiss    draws the round Dismiss cross (dismissible: true draws it
     *                with no handler); it puts the line away.
     *
     * ⛔ THE SAME LIVE REGION RULE AS Kit.goodNews: mount `el` once, before
     * anything happens, and call show(); `el` stays rendered and empty until
     * then. Both tones are a polite status. `text` draws the line at once, for
     * a notice that is part of the page as it draws (it is not announced).
     */
    function notice(o) {
        const c = o || {};
        const root = el('div', { class: 'kit-notice', role: 'status' });
        const line = el('div', { class: 'kit-notice__line' });
        const dismissible = c.dismissible === true || typeof c.onDismiss === 'function';
        line.hidden = true;
        root.appendChild(line);
        function show(text, opts) {
            const s = opts || {};
            root.classList.toggle('kit-notice--warn', s.tone === 'warn');
            const words = el('p', { class: 'kit-notice__text' });
            const kids = [words];
            const act = s.action;
            if (act && act.label && typeof act.onClick === 'function') {
                const b = el('button', { type: 'button', class: 'kit-quiet', text: String(act.label) });
                b.addEventListener('click', (e) => act.onClick(e));
                kids.push(b);
            }
            if (dismissible) {
                const x = dismissButton('kit-notice__x', c.dismissLabel);
                x.addEventListener('click', () => {
                    hide();
                    if (typeof c.onDismiss === 'function') c.onDismiss();
                });
                kids.push(x);
            }
            line.replaceChildren(...kids);
            line.hidden = false;
            words.textContent = text == null ? '' : String(text);
        }
        function hide() {
            const had = line.contains(document.activeElement);
            line.hidden = true;
            line.replaceChildren();
            handBackFocus(had, root, c.returnFocus);
        }
        if (c.text != null && c.text !== '') show(c.text, { tone: c.tone, action: c.action });
        return { el: root, show, hide };
    }

    /* ---------------------------------------------------------------------
     * Loading and feedback (owner picks, feedback family, 2026-09-29).
     * css/kit-standards.css draws all six; nothing here writes a colour.
     * ------------------------------------------------------------------- */

    const PLACEHOLDER_SIZES = ['hero', 'figure', 'stat', 'total', 'cell', 'amount', 'line'];

    /**
     * Kit.loadingPlaceholder({ size, short }) -> <span>
     *
     * Financials' flat breathing bar (pick feedback__loading-placeholder;
     * .fi-shim, css/financials-insights.css:820-880): what stands where a
     * figure or a line of words will go while its read is out, never a zero.
     *   size   'hero' (a headline figure), 'figure' (one beside it), 'stat'
     *          (a summary grid's figure), 'total' (a table's total), 'cell'
     *          (a table cell's words), 'amount' (a cell's money, at the right
     *          edge) or 'line' (a line of words, the default).
     *   short  a shorter one: the last line of a paragraph, a second column.
     * It is hidden from a screen reader: the region it stands in says
     * aria-busy="true" while the read is out (Kit.figureRow's does).
     */
    function loadingPlaceholder(o) {
        const c = o || {};
        const size = PLACEHOLDER_SIZES.indexOf(c.size) > -1 ? c.size : 'line';
        return el('span', {
            class:
                'kit-loading-placeholder kit-loading-placeholder--' +
                size +
                (c.short ? ' kit-loading-placeholder--short' : ''),
            'aria-hidden': 'true'
        });
    }

    /**
     * Kit.missingFigure({ label, reason, onRetry, retryLabel, inline }) -> <span>
     *
     * The Dashboard's muted dash (pick feedback__missing-figure;
     * js/kpi-wall.js:633-647): the figure's own place holds an en dash, never
     * a zero, at the size and weight of the slot it is put in, in the lighter
     * ink; and, when the page knows why, a small line that says so ("Not
     * reporting yet.", "Too few sales to rate.").
     *   label    what a screen reader hears for the dash: 'Not known', or
     *            'Not loaded' for a read that failed, unless the page names it.
     *   reason   the line; left out, the dash stands alone (a table cell).
     *   onRetry  a read that failed and can be asked again: the line says
     *            the reason or 'Did not load' and ends in Try again
     *            (retryLabel), a named button, as Financials draws it.
     *   inline   the line beside the dash instead of under it: a summary
     *            cell, a table.
     */
    function missingFigure(o) {
        const c = o || {};
        const retry = typeof c.onRetry === 'function' ? c.onRetry : null;
        const reason = c.reason != null && c.reason !== '' ? String(c.reason) : retry ? 'Did not load' : null;
        const root = el('span', { class: 'kit-missing-figure' + (c.inline ? ' kit-missing-figure--inline' : '') }, [
            el('span', {
                class: 'kit-missing-figure__dash',
                role: 'img',
                'aria-label': c.label ? String(c.label) : retry ? 'Not loaded' : 'Not known',
                text: FIG_NONE
            })
        ]);
        if (reason) {
            const why = el('span', { class: 'kit-missing-figure__why', text: reason });
            if (retry) {
                const b = el('button', {
                    type: 'button',
                    class: 'kit-missing-figure__retry',
                    text: c.retryLabel ? String(c.retryLabel) : 'Try again'
                });
                b.addEventListener('click', (e) => retry(e));
                why.appendChild(b);
            }
            root.appendChild(why);
        }
        return root;
    }

    /** A kit duration token read off a live node, in ms. jsdom loads no sheet: the fallback. */
    function motionMs(node, token, fallback) {
        let raw = '';
        try {
            raw = window.getComputedStyle(node).getPropertyValue(token);
        } catch (_e) {
            raw = '';
        }
        const m = /^\s*([\d.]+)\s*(m?s)\s*$/.exec(raw || '');
        const n = m ? parseFloat(m[1]) : NaN;
        if (!isFinite(n)) return fallback;
        return m[2] === 's' ? n * 1000 : n;
    }

    /** May this page move right now? Kit.motion's answer when it has loaded. */
    function mayMove() {
        if (Kit.motion && typeof Kit.motion.canMove === 'function') return Kit.motion.canMove();
        try {
            return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_e) {
            return false;
        }
    }

    const NOTIFY_TONES = ['info', 'success', 'warning', 'error'];
    // How long each tone stays when the page names no timeout
    // (js/main.js:11546-11548): long enough to read, longer for the ones
    // that ask for something.
    const NOTIFY_STAYS = { info: 3500, success: 3500, warning: 5000, error: 7000 };
    const NOTIFY_SAME_MS = 3000;
    const notifyRecent = new WeakMap();
    let notifyStack = null;

    // The source's glyphs (js/main.js:11527-11534 and the close cross at
    // :11614) are line glyphs, so they are in the kit's one set (Kit.glyph,
    // core.js) by the names below, drawn in its one line style.
    const NOTIFY_GLYPHS = { info: 'circleInfo', success: 'circleCheck', warning: 'triangleAlert', error: 'circleX' };

    /** The page's one stack, top-centre under the header; made on first use. */
    function notificationStack() {
        if (notifyStack && notifyStack.isConnected) return notifyStack;
        notifyStack = el('div', { class: 'kit kit-notification-stack' });
        document.body.appendChild(notifyStack);
        return notifyStack;
    }

    /**
     * Take a notification out and let the ones under it glide up into its
     * place instead of jumping (js/main.js:11667-11685), at the kit's panel
     * duration. Without the Web Animations API, or when the page may not
     * move, it is a plain remove.
     */
    function removeGliding(node) {
        const stack = node.parentElement;
        if (!stack || typeof node.animate !== 'function' || !mayMove()) {
            node.remove();
            return;
        }
        const others = Array.prototype.filter.call(stack.children, (t) => t !== node);
        const before = others.map((t) => t.getBoundingClientRect().top);
        node.remove();
        const ms = motionMs(stack, '--kit-dur-panel', 240);
        let ease = '';
        try {
            ease = window.getComputedStyle(stack).getPropertyValue('--kit-ease').trim();
        } catch (_e) {
            ease = '';
        }
        others.forEach((t, i) => {
            const dy = before[i] - t.getBoundingClientRect().top;
            if (Math.abs(dy) < 1 || typeof t.animate !== 'function') return;
            t.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], {
                duration: ms,
                easing: ease || 'ease-out'
            });
        });
    }

    /**
     * Kit.notify({ text, tone, title, action, timeout, into, returnFocus })
     *   -> { el, dismiss() }
     *
     * The app's top-centre notification (pick feedback__notification; the
     * .toast that js/main.js:11497-11680 showToast draws, which is unchanged:
     * a later step of the rollout makes showToast call this, so the app has
     * one notification). Something happened; say so, briefly, and go.
     *   tone     'info' (the default), 'success', 'warning' or 'error'.
     *   title    a heading, with text as its detail line.
     *   action   { label, onClick }: one quiet button ("Undo"); pressing it
     *            also puts the notification away.
     *   timeout  ms before it goes by itself; by default 3.5s, 5s for a
     *            warning, 7s for an error. 0 keeps it until it is dismissed.
     *            The count stops while the pointer is on it or focus is in it,
     *            and starts again when both have left.
     *   into     the element to put it in, instead of the page's one stack
     *            (a .kit element appended to <body>, top-centre under the
     *            header).
     * The same words in the same tone twice within 3s show once: the second
     * call returns the first one's handle. Once one is dismissed (by a press,
     * its action or its own time) the same words show again: a Retry that
     * failed a moment after the first is news, never a handle to one gone.
     *
     * ⛔ A SCREEN READER HEARS IT. Its message (the title and the words) is
     * its own live region: a polite status, an error an alert. The action and
     * the cross sit outside it, so they are not read with the message. It
     * goes in empty and its words are written a moment later, because a region
     * inserted with its words already in it is often not read at all. The Dismiss cross is a named button with the
     * kit's ring. If focus was in it when it goes, focus moves to returnFocus,
     * or to the stack it sat in, never to nowhere.
     */
    function notify(o) {
        const c = o || {};
        const tone = NOTIFY_TONES.indexOf(c.tone) > -1 ? c.tone : 'info';
        const text = c.text == null ? '' : String(c.text);
        const title = c.title == null || c.title === '' ? null : String(c.title);
        const box = c.into && c.into.nodeType === 1 ? c.into : notificationStack();
        const recent = notifyRecent.get(box) || new Map();
        notifyRecent.set(box, recent);
        const key = tone + '\n' + (title || '') + '\n' + text;
        if (recent.has(key)) return recent.get(key);

        const root = el('div', { class: 'kit-notification kit-notification--' + tone });
        const head = title ? el('span', { class: 'kit-notification__title' }) : null;
        const words = el('span', { class: 'kit-notification__text' });
        const x = el('button', { type: 'button', class: 'kit-notification__x', 'aria-label': 'Dismiss' }, [
            Kit.glyph('close')
        ]);
        root.appendChild(el('span', { class: 'kit-notification__glyph' }, [Kit.glyph(NOTIFY_GLYPHS[tone])]));
        // The message alone is the live region: the action and the Dismiss
        // cross sit outside it, so they are not read out with the words.
        root.appendChild(
            el(
                'div',
                {
                    class: 'kit-notification__body',
                    role: tone === 'error' ? 'alert' : 'status',
                    'aria-atomic': 'true'
                },
                [head, words]
            )
        );
        const act = c.action;
        if (act && act.label && typeof act.onClick === 'function') {
            const b = el('button', { type: 'button', class: 'kit-quiet', text: String(act.label) });
            // Put away first, then run: an action that fails at once and
            // says the same words again (a Retry) shows a new one, never the
            // handle of this one on its way out.
            b.addEventListener('click', (e) => {
                // A second press while it fades out must not run it twice.
                if (gone) return;
                dismiss();
                act.onClick(e);
            });
            root.appendChild(b);
        }
        root.appendChild(x);

        const stays =
            c.timeout === 0 ? 0 : typeof c.timeout === 'number' && c.timeout > 0 ? c.timeout : NOTIFY_STAYS[tone];
        let timer = null;
        let left = stays;
        let startedAt = 0;
        let pointerOn = false;
        let focusIn = false;
        let gone = false;

        function run() {
            if (!stays || gone || timer) return;
            startedAt = Date.now();
            timer = setTimeout(dismiss, left);
        }
        function hold() {
            if (!timer) return;
            clearTimeout(timer);
            timer = null;
            left = Math.max(0, left - (Date.now() - startedAt));
        }
        function settle() {
            if (pointerOn || focusIn) hold();
            else run();
        }
        function dismiss() {
            if (gone) return;
            gone = true;
            hold();
            // Off the repeat list: the same words after this are a new one.
            if (recent.get(key) === handle) recent.delete(key);
            const hadFocus = root.contains(document.activeElement);
            root.classList.add('is-leaving');
            handBackFocus(hadFocus, root, c.returnFocus);
            setTimeout(() => removeGliding(root), motionMs(root, '--kit-dur-exit', 180));
        }

        root.addEventListener('mouseenter', () => {
            pointerOn = true;
            settle();
        });
        root.addEventListener('mouseleave', () => {
            pointerOn = false;
            settle();
        });
        root.addEventListener('focusin', () => {
            focusIn = true;
            settle();
        });
        root.addEventListener('focusout', (e) => {
            if (e.relatedTarget && root.contains(e.relatedTarget)) return;
            focusIn = false;
            settle();
        });
        x.addEventListener('click', () => dismiss());

        const handle = { el: root, dismiss };
        recent.set(key, handle);
        setTimeout(() => {
            if (recent.get(key) === handle) recent.delete(key);
        }, NOTIFY_SAME_MS);
        box.appendChild(root);
        setTimeout(() => {
            if (head) head.textContent = title;
            words.textContent = text;
        }, 0);
        run();
        return handle;
    }

    /**
     * Kit.standaloneMark({ label, busy }) -> <span>
     *
     * The Argus mark on its own (pick icons__standalone-mark; the boot
     * screen's mark, #nexus-loading-screen .nexus-loading-mark, index.html:
     * 189 and :633-641, and its light swap, css/shell-theme.css:5949-5951,
     * which are unchanged: that first paint is inline and draws before the
     * kit loads). A 48px mark in a 64px box: the on-light art in light, the
     * source's on-dark art in dark; kit-standards.css shows one.
     *   label  its name when it stands alone ("ARGUS"): an image a screen
     *          reader hears once. Left out, it sits beside its own word and is
     *          hidden from a screen reader.
     *   busy   true while something loads: a soft red halo breathes behind
     *          it, as on the boot screen. Under reduced motion the halo holds
     *          still.
     */
    function standaloneMark(o) {
        const c = o || {};
        const label = c.label != null && c.label !== '' ? String(c.label) : null;
        const art = (side, src) =>
            el('img', {
                class: 'kit-standalone-mark__art kit-standalone-mark__art--' + side,
                src,
                alt: '',
                width: '48',
                height: '48'
            });
        return el(
            'span',
            {
                class: 'kit-standalone-mark' + (c.busy ? ' kit-standalone-mark--busy' : ''),
                role: label ? 'img' : null,
                'aria-label': label,
                'aria-hidden': label ? null : 'true'
            },
            [
                c.busy ? el('span', { class: 'kit-standalone-mark__halo' }) : null,
                art('on-light', 'assets/logo/argus-mark-onlight.png?v=1'),
                art('on-dark', 'assets/logo/argus-icon-light.png?v=1')
            ]
        );
    }

    /**
     * Kit.logoLockup({ href, label, onClick }) -> <a>
     *
     * The ARGUS logo in a page head (pick icons__logo-lockup; the top bar's
     * brand, js/system/topbar.js:295-336 and css/topbar.css:53-105, which are
     * unchanged): the 26px mark and the 14px wordmark, both artworks shipped
     * and kit-standards.css showing the one for the theme, so a theme change needs no
     * rebuild. A real link home: `href` (default "/"), named `label` (default
     * "ARGUS home"); the four images carry no words of their own. With onClick
     * a plain click is the page's own (the default is prevented), and a
     * modified one (a new tab) stays the browser's.
     */
    function logoLockup(o) {
        const c = o || {};
        const art = (part, side, src) =>
            el('img', {
                class: 'kit-logo-lockup__' + part + ' kit-logo-lockup__' + part + '--' + side,
                src,
                alt: ''
            });
        const a = el(
            'a',
            {
                class: 'kit-logo-lockup',
                href: c.href ? String(c.href) : '/',
                'aria-label': c.label != null && c.label !== '' ? String(c.label) : 'ARGUS home'
            },
            [
                art('mark', 'on-dark', 'assets/logo/argus-mark-ondark.png?v=2'),
                art('mark', 'on-light', 'assets/logo/argus-mark-onlight.png?v=2'),
                art('word', 'on-dark', 'assets/logo/argus-wordmark-ondark.png?v=1'),
                art('word', 'on-light', 'assets/logo/argus-wordmark-onlight.png?v=1')
            ]
        );
        if (typeof c.onClick === 'function') {
            a.addEventListener('click', (e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                c.onClick(e);
            });
        }
        return a;
    }

    const STATUS_DOT_TONES = ['ok', 'warn', 'bad', 'muted', 'accent', 'info'];
    // A dot's name when a page gave it no words: plain words, never the code.
    const STATUS_DOT_WORDS = {
        ok: 'Status: good',
        warn: 'Status: warning',
        bad: 'Status: problem',
        muted: 'Status: off',
        accent: 'Status: flagged',
        info: 'Status: open'
    };

    /**
     * Kit.statusDot({ tone, text, label, pulse }) -> <span>
     *
     * The flat status dot (pick icons__status-dot, "Flat dot (rebuilt
     * pages)"; .tp-dot, css/settings/settings-team.css:456-474, and .sd-dot,
     * css/settings/settings-devices.css:119-133, which are unchanged): a 7px
     * disc, no halo, in the kit grey or a tone.
     *   tone   'ok', 'warn', 'bad', 'muted', 'accent' or 'info' (blue: a
     *          matter still open, as Loss Prevention draws one under
     *          review); none for the grey
     *   text   the words it goes with ("Online"): a dot and its words on one
     *          line, the dot hidden from a screen reader, which reads the words
     *   label  with no words beside it, its name ("Online"): an image a screen
     *          reader hears. A dot is never the only thing that says what it
     *          means, so a dot with neither says so and is named in plain
     *          words for its tone ("Status: warning"). An unknown tone says so
     *          and draws the grey.
     *   pulse  true for work in progress ("Reading the invoice"): it breathes,
     *          as Documents' intake dot does; under reduced motion it holds
     *          still.
     */
    function statusDot(o) {
        const c = o || {};
        const tone = STATUS_DOT_TONES.indexOf(String(c.tone)) > -1 ? String(c.tone) : null;
        if (c.tone != null && c.tone !== '' && !tone) {
            warn(
                '[Kit] statusDot: `' +
                    String(c.tone) +
                    '` is not a tone (' +
                    STATUS_DOT_TONES.join(', ') +
                    '); drawing the grey.'
            );
        }
        const text = c.text != null && c.text !== '' ? String(c.text) : null;
        let label = c.label != null && c.label !== '' ? String(c.label) : null;
        if (!text && !label) {
            warn(
                '[Kit] statusDot: a dot needs its words (`text`) or a name (`label`); a colour alone says ' +
                    'nothing to someone who cannot see it. Naming it for its tone.'
            );
            label = tone ? STATUS_DOT_WORDS[tone] : 'Status';
        }
        const dot = el('span', {
            class:
                'kit-status-dot' + (tone ? ' kit-status-dot--' + tone : '') + (c.pulse ? ' kit-status-dot--pulse' : ''),
            role: text ? null : 'img',
            'aria-label': text ? null : label,
            'aria-hidden': text ? 'true' : null
        });
        if (!text) return dot;
        return el('span', { class: 'kit-status-dot-line' }, [
            dot,
            el('span', { class: 'kit-status-dot-line__text', text })
        ]);
    }

    /**
     * Kit.openingScreen({ caption }) -> { el, say(text), leave(done) }
     *
     * The boot screen's lockup (pick feedback__opening-screen;
     * #nexus-loading-screen, index.html:296-422 and :634-653, which is
     * unchanged: that first paint is inline and draws before the kit loads).
     * For any other screen that has to wait before it can draw: the Argus mark
     * (Kit.standaloneMark, busy: its red halo breathing behind it), the
     * wordmark, a thin sweeping bar and a caption that says what is
     * happening. The page places it.
     *   say(text)    the caption, as each step starts ("Signing you in"). The
     *                caption is a polite status, so a screen reader hears it.
     *   leave(done)  fades it out at the kit's exit duration, removes it and
     *                calls done.
     */
    function openingScreen(o) {
        const c = o || {};
        const caption = el('div', {
            class: 'kit-opening-screen__caption',
            role: 'status',
            text: c.caption ? String(c.caption) : 'Opening ARGUS'
        });
        const root = el('div', { class: 'kit-opening-screen' }, [
            standaloneMark({ busy: true }),
            el('div', { class: 'kit-opening-screen__word', 'aria-hidden': 'true', text: 'ARGUS' }),
            el('div', { class: 'kit-opening-screen__bar', 'aria-hidden': 'true' }),
            caption
        ]);
        let leaving = false;
        function say(text) {
            if (typeof text === 'string') caption.textContent = text;
        }
        function leave(done) {
            if (leaving) return;
            leaving = true;
            root.classList.add('is-leaving');
            setTimeout(
                () => {
                    root.remove();
                    if (typeof done === 'function') done();
                },
                motionMs(root, '--kit-dur-exit', 180)
            );
        }
        return { el: root, say, leave };
    }

    /**
     * Kit.progressBar({ label, value, state, text, actions }) -> { el, set(next) }
     *
     * The invoice scan's thin bar (pick feedback__progress-bar;
     * .invscan__bar, css/inventory-scan.css:442-490): progress on one piece
     * of work, and two claims that never look alike.
     *   value    0..1: a MEASURED bar (bytes read of a file) that fills from
     *            the left in the module's colour. Left out, the work reports
     *            nothing about itself (the scan inside the reader): no fill,
     *            only a segment travelling along the track. A percentage there
     *            would be invented.
     *   label    the bar's name for a screen reader ("Reading invoice-0412.pdf").
     *   text     the words under it ("Reading the file"), a polite status. A
     *            measured bar adds its amount ("Reading the file · 42%").
     *   state    'queued': no bar, only the words (default "Waiting its turn").
     *            'failed': no bar; the words say what went wrong (default
     *            "Could not be finished.") and `actions` offer the ways on.
     *   actions  [{ label, onClick }], at most two, the kit's small buttons.
     * set(next) merges next into what it shows, so a page moves one file from
     * queued to reading to scanning to failed without rebuilding it.
     *
     * A measured bar is role=progressbar with aria-valuenow, -min and -max;
     * an unmeasured one is a progressbar with no value, which is how a screen
     * reader is told the amount is unknown.
     */
    function progressBar(o) {
        const root = el('div', { class: 'kit-progress-bar' });
        const saidNode = document.createTextNode('');
        const amountNode = el('span', { class: 'kit-progress-bar__amount', 'aria-hidden': 'true' });
        const words = el('div', { class: 'kit-progress-bar__words', role: 'status' });
        words.appendChild(saidNode);
        words.appendChild(amountNode);
        let track = null;
        let acts = null;
        let now = {};

        function draw() {
            const c = now;
            const state = c.state === 'queued' || c.state === 'failed' ? c.state : null;
            const measured = !state && typeof c.value === 'number' && isFinite(c.value);
            root.classList.toggle('kit-progress-bar--queued', state === 'queued');
            root.classList.toggle('kit-progress-bar--failed', state === 'failed');
            let pct = null;
            if (state) {
                if (track) track.remove();
                track = null;
            } else {
                const want = measured ? 'kit-progress-bar__fill' : 'kit-progress-bar__sweep';
                if (!track || !track.firstChild || track.firstChild.className !== want) {
                    const next = el('div', { class: 'kit-progress-bar__track', role: 'progressbar' }, [
                        el('div', { class: want })
                    ]);
                    if (track) root.replaceChild(next, track);
                    else root.insertBefore(next, root.firstChild);
                    track = next;
                }
                track.setAttribute('aria-label', c.label ? String(c.label) : 'Progress');
                if (measured) {
                    pct = Math.round(Math.max(0, Math.min(1, c.value)) * 100);
                    track.setAttribute('aria-valuemin', '0');
                    track.setAttribute('aria-valuemax', '100');
                    track.setAttribute('aria-valuenow', String(pct));
                    track.firstChild.style.width = pct + '%';
                } else {
                    track.removeAttribute('aria-valuemin');
                    track.removeAttribute('aria-valuemax');
                    track.removeAttribute('aria-valuenow');
                }
            }
            const said =
                c.text != null && c.text !== ''
                    ? String(c.text)
                    : state === 'queued'
                      ? 'Waiting its turn'
                      : state === 'failed'
                        ? 'Could not be finished.'
                        : '';
            // A measured bar says its amount in words as well ("Reading the
            // file · 42%"). The amount is hidden from a screen reader, which
            // has it from aria-valuenow, so the live words are not read out
            // again at every step.
            const amount = pct === null ? '' : (said ? ' · ' : '') + pct + '%';
            if (saidNode.textContent !== said) saidNode.textContent = said;
            if (amountNode.textContent !== amount) amountNode.textContent = amount;
            if (!words.parentNode) root.appendChild(words);
            if (acts) acts.remove();
            acts = null;
            const list = state === 'failed' ? listOf(c.actions, 'progressBar', 'actions').slice(0, 2) : [];
            const buttons = list
                .filter((a) => a && a.label && typeof a.onClick === 'function')
                .map((a) => {
                    const b = el('button', {
                        type: 'button',
                        class: 'kit-btn kit-btn--small',
                        text: String(a.label)
                    });
                    b.addEventListener('click', (e) => a.onClick(e));
                    return b;
                });
            if (buttons.length) {
                acts = el('div', { class: 'kit-progress-bar__acts' }, buttons);
                root.appendChild(acts);
            }
        }
        function set(next) {
            now = Object.assign({}, now, next || {});
            draw();
        }
        set(o);
        return { el: root, set };
    }

    /**
     * Kit.workingSign({ text, detail, onVideo }) -> <div role="status">
     *
     * The quiet wine ring over a sentence (pick feedback__working-sign;
     * .empcert-reading__spin, css/employees.css:1413-1440, and .acw-spinner
     * over a clip, css/argus-clip-workspace.css:322-333): something is being
     * worked on and there is nothing to measure. The sentence says what
     * ("Reading the document..."), and a quieter detail line may say more. It
     * is a polite status, and the sentence is what a screen reader hears; the
     * ring is hidden from it. onVideo is the same sign over a clip, which
     * stays dark in both themes. Under reduced motion the ring turns more
     * slowly and never stops.
     */
    function workingSign(o) {
        const c = o || {};
        return el(
            'div',
            { class: 'kit-working-sign' + (c.onVideo ? ' kit-working-sign--on-video' : ''), role: 'status' },
            [
                el('div', { class: 'kit-working-sign__ring', 'aria-hidden': 'true' }),
                el('div', { class: 'kit-working-sign__text', text: c.text ? String(c.text) : 'Loading' }),
                c.detail ? el('div', { class: 'kit-working-sign__detail', text: String(c.detail) }) : null
            ]
        );
    }

    /* ── Navigation, back links and titles (picks navigation__*) ────────── */

    // The Settings menu's two glyphs (js/settings/rail.js ICONS.back and
    // ICONS.search) are the line style's back and search (Kit.glyph).

    /** A plain click is the page's; a modified one (a new tab, a new window) the browser's. */
    function plainClick(e) {
        return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button !== undefined && e.button !== 0));
    }

    /**
     * Kit.backLink({ label, href, onClick }) -> <a>
     *
     * "‹ Back to home" (pick navigation__back-link; .settings-nav__back,
     * js/settings/rail.js:363 and css/settings.css:118-196): a real link, a
     * chevron and its words. `href` is where it goes (default "#"); with
     * onClick a plain click is the page's own (the default is prevented), and
     * a modified one (a new tab, a new window) stays the browser's. Put in a
     * Kit.sectionMenu (its `back`), it leads the menu and, collapsed, shows the
     * chevron alone with its name in a banner.
     */
    function backLink(o) {
        const c = o || {};
        const label = String(c.label != null && c.label !== '' ? c.label : 'Back');
        const a = el('a', { class: 'kit-back-link', href: c.href ? String(c.href) : '#' }, [
            el('span', { class: 'kit-back-link__icon' }, [Kit.glyph('back', { cls: 'kit-back-link__glyph' })]),
            el('span', { class: 'kit-back-link__label', text: label })
        ]);
        if (typeof c.onClick === 'function') {
            a.addEventListener('click', (e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                c.onClick(e);
            });
        }
        return a;
    }

    /** A collapsed row's name banner: its own words again, so hidden from a screen reader. */
    function menuBanner(text) {
        return el('span', { class: 'kit-section-menu__banner', 'aria-hidden': 'true', text: text });
    }

    /**
     * A row's glyph: the caller's own path data, an array of `d` strings. A
     * plain string (a glyph name, or one path) is not path data this menu
     * can draw, so it says so and the row keeps its empty 36px box.
     */
    function menuGlyph(icon, id) {
        if (icon == null || icon === '') return null;
        if (!Array.isArray(icon)) {
            warn(
                '[Kit] sectionMenu: the icon of `' +
                    id +
                    '` must be an array of path strings; got ' +
                    shapeOf(icon) +
                    '. Drawing no glyph.'
            );
            return null;
        }
        return Kit.glyph(icon, { cls: 'kit-section-menu__glyph' });
    }

    let sectionMenus = 0;

    /**
     * Kit.sectionMenu({ label, title, back, search, groups, active, collapsed, onSelect })
     *   -> { el, setActive(id), setCollapsed(on), setQuery(text) }
     *
     * The menu inside a page (pick navigation__section-menu; the Settings menu
     * with search and groups, js/settings/rail.js:363-560 and css/settings.css:
     * 57-393). A <nav> named `label`: the back link (`back`, Kit.backLink's
     * options), the title (`title`, default the label; false for none), a
     * search box (`search`: true, or { label, noun }), then each group's
     * eyebrow over a list of links, the current one aria-current="page".
     *   groups    [{ label, items: [{ id, label, icon, href, keywords }] }];
     *             icon is the glyph's own path data: an ARRAY of path `d`
     *             strings on a 24 box, stroked by the stylesheet. A plain
     *             string is refused with a warning and the row draws no glyph
     *   active    the id of the current item
     *   collapsed true for the 52px column of glyphs, each name in a banner
     *             under the pointer and on keyboard focus
     *   onSelect  (id) on a plain click of an item (the default is then
     *             prevented); without it the link goes to its href
     * The search box is named for a screen reader (its label, default "Search"
     * and the menu's name) and filters the list as it is typed in: every word
     * must match a row's words, its keywords or its group's name. A polite
     * status line says how many match, or "No <noun> match “…”.", which is
     * also the one grey line shown in place of the list. Esc in the box clears
     * it (and goes no further while there is something to clear); Enter opens
     * the first match. Tab walks the links in order.
     */
    function sectionMenu(o) {
        const c = o || {};
        const name = String(c.label != null && c.label !== '' ? c.label : 'Sections');
        const id = 'kit-section-menu-' + ++sectionMenus;
        const search = c.search ? (c.search === true ? {} : c.search) : null;
        const noun = String((search && search.noun) || name.toLowerCase());
        const nav = el('nav', { class: 'kit-section-menu', 'aria-label': name });

        const top = el('div', { class: 'kit-section-menu__top' });
        if (c.back) {
            const back = backLink(c.back);
            back.appendChild(menuBanner(back.querySelector('.kit-back-link__label').textContent));
            top.appendChild(back);
        }
        if (c.title !== false) {
            const heading = c.title ? String(c.title) : name;
            top.appendChild(el('div', { class: 'kit-section-menu__title', text: heading }));
        }
        let input = null;
        if (search) {
            const label = String(search.label || 'Search ' + name.toLowerCase());
            input = el('input', {
                class: 'kit-section-menu__search-input',
                type: 'text',
                placeholder: label,
                autocomplete: 'off',
                spellcheck: 'false',
                'aria-label': label,
                'aria-controls': id + '-groups'
            });
            top.appendChild(
                el('label', { class: 'kit-section-menu__search' }, [
                    Kit.glyph('search', { cls: 'kit-section-menu__search-glyph' }),
                    input
                ])
            );
        }
        if (top.firstChild) nav.appendChild(top);

        const body = el('div', { class: 'kit-section-menu__groups', id: id + '-groups' });
        const rows = [];
        const blocks = [];
        listOf(c.groups, 'sectionMenu', 'groups').forEach((g, gi) => {
            const items = listOf(g.items, 'sectionMenu', 'items');
            if (!items.length) return;
            const head = id + '-g' + gi;
            const group = String(g.label != null ? g.label : '');
            const ul = el('ul', { class: 'kit-section-menu__list', 'aria-labelledby': head });
            items.forEach((it) => {
                const key = String(it.id);
                const words = String(it.label != null ? it.label : it.id);
                const a = el(
                    'a',
                    { class: 'kit-section-menu__item', href: it.href ? String(it.href) : '#', dataset: { id: key } },
                    [
                        el('span', { class: 'kit-section-menu__icon' }, [menuGlyph(it.icon, key)]),
                        el('span', { class: 'kit-section-menu__label', text: words }),
                        menuBanner(words)
                    ]
                );
                a.addEventListener('click', (e) => {
                    if (typeof c.onSelect !== 'function' || !plainClick(e)) return;
                    e.preventDefault();
                    c.onSelect(key);
                });
                const li = el('li', { class: 'kit-section-menu__li' }, [a]);
                ul.appendChild(li);
                rows.push({ key, a, li, hay: norm(words + ' ' + (it.keywords || '') + ' ' + group) });
            });
            const block = el('div', { class: 'kit-section-menu__group' }, [
                el('div', { class: 'kit-section-menu__heading', id: head, text: group }),
                ul
            ]);
            blocks.push(block);
            body.appendChild(block);
        });
        nav.appendChild(body);
        const empty = el('p', { class: 'kit-section-menu__empty', hidden: '' });
        nav.appendChild(empty);
        const status = el('div', { class: 'kit-section-menu__status', role: 'status', 'aria-live': 'polite' });
        nav.appendChild(status);

        function norm(s) {
            return String(s || '')
                .toLowerCase()
                .replace(/&/g, 'and')
                .trim();
        }

        function filter(text) {
            const q = String(text == null ? '' : text);
            const words = norm(q).split(/\s+/).filter(Boolean);
            let shown = 0;
            rows.forEach((r) => {
                const on = words.every((w) => r.hay.indexOf(w) > -1);
                r.li.hidden = !on;
                if (on) shown++;
            });
            blocks.forEach((b) => {
                b.hidden = !b.querySelector('.kit-section-menu__li:not([hidden])');
            });
            const none = words.length > 0 && shown === 0;
            const sentence = 'No ' + noun + ' match “' + q.trim() + '”.';
            empty.hidden = !none;
            empty.textContent = none ? sentence : '';
            status.textContent = !words.length ? '' : none ? sentence : shown + (shown === 1 ? ' match' : ' matches');
        }

        if (input) {
            input.addEventListener('input', () => filter(input.value));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && input.value) {
                    e.preventDefault();
                    e.stopPropagation();
                    input.value = '';
                    filter('');
                } else if (e.key === 'Enter') {
                    const first = rows.find((r) => !r.li.hidden);
                    if (first) {
                        e.preventDefault();
                        first.a.click();
                    }
                }
            });
        }

        function setActive(next) {
            const want = next == null ? null : String(next);
            rows.forEach((r) => {
                if (r.key === want) r.a.setAttribute('aria-current', 'page');
                else r.a.removeAttribute('aria-current');
            });
        }

        function setCollapsed(on) {
            nav.classList.toggle('kit-section-menu--collapsed', !!on);
        }

        setActive(c.active);
        setCollapsed(c.collapsed);
        return {
            el: nav,
            setActive,
            setCollapsed,
            setQuery(text) {
                if (input) input.value = String(text == null ? '' : text);
                filter(text);
            }
        };
    }

    /**
     * Kit.titleHead({ title, sub, actions }) -> <header>
     *
     * The page's title (pick navigation__page-title; .crm-pagehead with
     * brand-accent.css's bar, as Financials, Inventory and the other module
     * pages draw it): an <h1> with a short wine bar under it, which the
     * stylesheet draws (a screen reader hears only the title), and a quieter
     * sub line. `actions` (a node or a list) sit at the right. One per page.
     */
    function titleHead(o) {
        const c = o || {};
        const acts = many(c.actions);
        const words = String(c.title != null ? c.title : '');
        return el('header', { class: 'kit-title-head' }, [
            el('div', { class: 'kit-title-head__words' }, [
                el('h1', { class: 'kit-title-head__title', text: words }),
                c.sub ? el('p', { class: 'kit-title-head__sub', text: String(c.sub) }) : null
            ]),
            acts.length ? el('div', { class: 'kit-title-head__actions' }, acts) : null
        ]);
    }

    /**
     * Kit.sectionHeading({ title, lead, actions, level }) -> <div>
     *
     * A section's heading (pick navigation__section-heading; Financials' head
     * for each tab, js/financials/page.js tabHead() and css/financials.css:
     * 67-105): an <h2> in the full ink and one plain sentence under it in the
     * quieter grey. `actions` (a node or a list: the section's one action, as
     * Export on Spending) sit at the right. `level` (2 to 6) makes it an h3
     * and on, for a section inside a section; left out it is the h2 it has
     * always been.
     */
    function sectionHeading(o) {
        const c = o || {};
        const acts = many(c.actions);
        const words = String(c.title != null ? c.title : '');
        return el('div', { class: 'kit-section-heading' }, [
            el('div', { class: 'kit-section-heading__words' }, [
                el(headingTag(c.level), { class: 'kit-section-heading__title', text: words }),
                c.lead ? el('p', { class: 'kit-section-heading__lead', text: String(c.lead) }) : null
            ]),
            acts.length ? el('div', { class: 'kit-section-heading__actions' }, acts) : null
        ]);
    }

    /* ---------------------------------------------------------------------
     * Cards and sections (owner picks, surfaces family, 2026-09-29).
     * css/kit-standards.css draws all five; nothing here writes a colour. None of the
     * names says card or panel: the shell repaints those inside .portal-main
     * (see the header), so the report card becomes the click box, the
     * Insights box the number box.
     * ------------------------------------------------------------------- */

    let surfaceUid = 0;
    function surfaceId(prefix) {
        surfaceUid += 1;
        return 'kit-' + prefix + '-' + surfaceUid;
    }

    /** A heading at the level the caller chose: 2 to 6, 2 when left out. */
    function headingTag(level) {
        const n = Number(level);
        return 'h' + (n >= 2 && n <= 6 ? Math.floor(n) : 2);
    }

    /** Text that may be a figure: a string, or nothing (null) for the dash. */
    function hasText(v) {
        return v != null && v !== '';
    }

    /**
     * Kit.clickBox({ title, body, go, href, onClick, wide }) -> <button> or <a>
     *
     * A box you click to open (pick surfaces__click-card; Employees' report
     * card, js/employees/reports.js:499 and css/employees.css:6518-6590): the
     * whole box is ONE control, a button, or a link when `href` is given, and
     * its name is its title (the body is its description). Nothing inside it
     * is interactive: every slot is words.
     *   title    the report's name, in the full ink
     *   body     one line on what it holds, in the grey
     *   go       the red word at its foot (default "Open"); the look, not
     *            the name, so a screen reader hears the title
     *   href     makes it a real link; with onClick a plain click is the
     *            page's own, a modified one (a new tab) the browser's
     *   onClick  what a button does
     *   wide     the lead report: two columns of the page's grid, a bigger title
     */
    function clickBox(o) {
        const c = o || {};
        const id = surfaceId('click-box');
        const title = el('span', { class: 'kit-click-box__title', id: id + '-title', text: String(c.title || '') });
        const body = hasText(c.body)
            ? el('span', { class: 'kit-click-box__body', id: id + '-body', text: String(c.body) })
            : null;
        const go = el('span', {
            class: 'kit-click-box__go',
            'aria-hidden': 'true',
            text: hasText(c.go) ? String(c.go) : 'Open'
        });
        const link = hasText(c.href);
        const box = el(
            link ? 'a' : 'button',
            {
                class: 'kit-click-box' + (c.wide ? ' kit-click-box--wide' : ''),
                href: link ? String(c.href) : null,
                type: link ? null : 'button',
                'aria-labelledby': title.id,
                'aria-describedby': body ? body.id : null
            },
            [title, body, go]
        );
        if (typeof c.onClick === 'function') {
            box.addEventListener('click', (e) => {
                if (link) {
                    if (!plainClick(e)) return;
                    e.preventDefault();
                }
                c.onClick(e);
            });
        }
        return box;
    }

    /**
     * Kit.details({ items: [{ label, value, sub, muted }] }) -> <dl>
     *
     * The label above its value (pick surfaces__details; Employees' person
     * drawer, js/employees/person.js:249 and css/employees.css:5453-5493): a
     * bordered grid, two across, a hairline between the cells.
     *   label  a few words in the grey ("Started")
     *   value  the fact ("Mar 3, 2025"); nothing (null) is the kit's missing
     *          figure, never a blank or a zero
     *   sub    a line under it ("1 year, 6 months")
     *   muted  the value is a word standing in for one ("Not set"): lighter
     */
    function details(o) {
        const c = o || {};
        const root = el('dl', { class: 'kit-details' });
        listOf(c.items, 'details', 'items').forEach((x) => {
            const has = hasText(x.value);
            root.appendChild(
                el('div', { class: 'kit-details__item' }, [
                    el('dt', { class: 'kit-details__label', text: String(x.label || '') }),
                    el(
                        'dd',
                        {
                            class: 'kit-details__value' + (has && x.muted ? ' kit-details__value--muted' : ''),
                            text: has ? String(x.value) : null
                        },
                        has ? null : [figNone(null, 'Not known')]
                    ),
                    hasText(x.sub) ? el('dd', { class: 'kit-details__sub', text: String(x.sub) }) : null
                ])
            );
        });
        return root;
    }

    /** A list box's figure in its slot: the text, a dash for null, a bar while it loads. */
    function boxFigure(cls, v, loading, size) {
        const n = el('span', { class: cls });
        if (loading) n.appendChild(loadingPlaceholder({ size }));
        else if (hasText(v)) n.textContent = String(v);
        else n.appendChild(figNone(null, 'Not known'));
        return n;
    }

    /** A row's name: a real link when it goes somewhere, words when it does not. */
    function boxName(r) {
        const words = hasText(r.name) ? String(r.name) : 'Unnamed';
        if (!hasText(r.href)) return el('span', { class: 'kit-list-box__name', text: words });
        const a = el('a', { class: 'kit-list-box__name kit-list-box__link', href: String(r.href), text: words });
        if (typeof r.onClick === 'function') {
            a.addEventListener('click', (e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                r.onClick(e);
            });
        }
        return a;
    }

    /**
     * Kit.listBox({ title, sub, total, rows, rest, tone, state, emptyText, body, level }) -> <section>
     *
     * A titled box of rows (pick surfaces__list-box; Financials Overview's
     * top five, js/financials/view-home.js:658,879 and
     * css/financials-home.css:186-530): the section heading (Kit.sectionHeading)
     * on a tinted band with the total at its right, then the ranked rows, each
     * a name, a thin bar for its share and the amount.
     *   total     the figure at the right ('$12,319.95'); null is a total
     *             nobody knows (the missing figure); left out, no figure
     *   rows      [{ name, amount, share, href, onClick }]: share 0 to 100;
     *             with href the name is a real link (onClick as Kit.backLink);
     *             an amount of null is the missing figure
     *   rest      { label, amount }: the "Everything else" row, in the grey
     *   tone      'out' (the default, the spend red) or 'in' (the green)
     *   state     'loading': the kit's loading placeholder where the total and
     *             four rows go, the box aria-busy
     *   emptyText the sentence when there are no rows
     *   body      a node (or a list) in place of rows: the same box holding a
     *             chart or a sentence, as Forecast's day by day does
     *   level     its heading's level, 2 to 6 (default 2)
     */
    function listBox(o) {
        const c = o || {};
        const id = surfaceId('list-box');
        const loading = c.state === 'loading';
        const acts = c.total !== undefined ? [boxFigure('kit-list-box__total', c.total, loading, 'total')] : null;
        const head = sectionHeading({ title: c.title, lead: c.sub, actions: acts, level: c.level });
        head.classList.add('kit-list-box__head');
        const heading = head.querySelector('.kit-section-heading__title');
        heading.id = id + '-title';
        const body = el('div', { class: 'kit-list-box__body' });
        const root = el(
            'section',
            {
                class: 'kit-list-box' + (c.tone === 'in' ? ' kit-list-box--in' : ''),
                'aria-labelledby': heading.id,
                'aria-busy': loading ? 'true' : null
            },
            [head, body]
        );
        // What the box holds in place of rows stands at its own height: the
        // 180px floor is the top list's (Forecast's box has none).
        const own = many(c.body);
        if (own.length) {
            root.replaceChild(el('div', { class: 'kit-list-box__content' }, own), body);
            return root;
        }
        if (loading) {
            const wait = el('div', { class: 'kit-list-box__wait', 'aria-hidden': 'true' });
            for (let i = 0; i < 4; i++) {
                wait.appendChild(el('div', { class: 'kit-list-box__row' }, [loadingPlaceholder({ size: 'cell' })]));
            }
            body.appendChild(wait);
            return root;
        }
        const rows = listOf(c.rows, 'listBox', 'rows');
        const rest = c.rest && typeof c.rest === 'object' ? c.rest : null;
        if (!rows.length && !rest) {
            body.appendChild(
                el('div', { class: 'kit-list-box__empty' }, [
                    el('p', {
                        class: 'kit-list-box__msg',
                        text: hasText(c.emptyText) ? String(c.emptyText) : 'Nothing yet.'
                    })
                ])
            );
            return root;
        }
        const list = el('ol', { class: 'kit-list-box__list' });
        rows.forEach((r) => {
            const fill = el('span', { class: 'kit-list-box__fill' });
            const share = Number(r.share);
            if (isFinite(share) && share > 0) fill.style.width = Math.min(100, share) + '%';
            list.appendChild(
                el('li', { class: 'kit-list-box__row' }, [
                    boxName(r),
                    el('span', { class: 'kit-list-box__bar', 'aria-hidden': 'true' }, [fill]),
                    boxFigure('kit-list-box__amount', r.amount)
                ])
            );
        });
        if (rest) {
            list.appendChild(
                el('li', { class: 'kit-list-box__row kit-list-box__row--rest' }, [
                    el('span', {
                        class: 'kit-list-box__name',
                        text: hasText(rest.label) ? String(rest.label) : 'Everything else'
                    }),
                    el('span', { class: 'kit-list-box__bar', 'aria-hidden': 'true' }),
                    boxFigure('kit-list-box__amount', rest.amount)
                ])
            );
        }
        body.appendChild(list);
        return root;
    }

    /**
     * Kit.numberBox({ title, level, total, control, cells, note, body }) -> <section>
     *
     * A box that leads with a number (pick surfaces__number-card; Financials
     * Insights' box, js/financials/view-insights.js:2547,2672 and
     * css/financials-insights.css:548-620, :750-800): a big title with its
     * total under it, a control across the box, then what it holds.
     *   title    a real heading, at `level` (2 to 6, default 2)
     *   total    the figure under the title; null is a total the page does
     *            not know (the missing figure, in its lighter ink); left out,
     *            no line (the Summary box)
     *   control  a node across the box, under the head: the kit's in-page
     *            switch (Kit.inlineSwitch({ full: true }).el)
     *   cells    [{ label, value, sub }]: the Summary grid, label over value,
     *            two across, a hairline under the first row; a value of null
     *            is the missing figure
     *   note     one sentence in the body, in the grey (what the box shows,
     *            or why its total is not known)
     *   body     a node (or a list) under the note: a table, a chart
     */
    function numberBox(o) {
        const c = o || {};
        const id = surfaceId('number-box');
        const title = el(headingTag(c.level), {
            class: 'kit-number-box__title',
            id: id + '-title',
            text: String(c.title || '')
        });
        const head = el('header', { class: 'kit-number-box__head' }, [title]);
        if (c.total !== undefined && c.total !== '') {
            head.appendChild(
                el(
                    'p',
                    { class: 'kit-number-box__total', text: c.total === null ? null : String(c.total) },
                    c.total === null ? [figNone(null, 'Not known')] : null
                )
            );
        }
        const root = el('section', { class: 'kit-number-box', 'aria-labelledby': title.id }, [head]);
        const ctl = many(c.control);
        if (ctl.length) root.appendChild(el('div', { class: 'kit-number-box__control' }, ctl));
        const cells = listOf(c.cells, 'numberBox', 'cells');
        if (cells.length) {
            root.appendChild(
                el(
                    'dl',
                    { class: 'kit-number-box__cells' },
                    cells.map((x) =>
                        el('div', { class: 'kit-number-box__cell' }, [
                            el('dt', { class: 'kit-number-box__label', text: String(x.label || '') }),
                            el('dd', { class: 'kit-number-box__value' }, [
                                hasText(x.value)
                                    ? document.createTextNode(String(x.value))
                                    : figNone(null, 'Not known'),
                                hasText(x.sub)
                                    ? el('span', { class: 'kit-number-box__sub', text: String(x.sub) })
                                    : null
                            ])
                        ])
                    )
                )
            );
        }
        const kids = many(c.body);
        if (hasText(c.note) || kids.length) {
            root.appendChild(
                el(
                    'div',
                    { class: 'kit-number-box__body' },
                    [hasText(c.note) ? el('p', { class: 'kit-number-box__note', text: String(c.note) }) : null].concat(
                        kids
                    )
                )
            );
        }
        return root;
    }

    const SECTION_TONES = ['danger', 'quiet'];

    /**
     * Kit.sectionBox({ title, desc, actions, body, note, tone, level }) -> <section>
     *
     * A section of a settings page (pick surfaces__section-box;
     * SettingsUI.section, js/settings.js:1271-1291 and css/settings.css:
     * 685-735): the section heading (Kit.sectionHeading) at the box's own
     * 15px, one line of help and its actions at the right, then the rows
     * (Kit.settingRow(...).el, a hairline between them).
     *   body   a node or a list: the rows
     *   note   one quiet sentence in place of rows ("Nothing to set here yet.")
     *   tone   'danger': a red edge and a red title, never a red fill (the
     *          one red fill is the delete button inside it);
     *          'quiet': a dashed edge and no ground, a placeholder
     *   level  its heading's level, 2 to 6 (default 2)
     */
    function sectionBox(o) {
        const c = o || {};
        const tone = SECTION_TONES.indexOf(c.tone) > -1 ? c.tone : null;
        const root = el('section', { class: 'kit-section-box' + (tone ? ' kit-section-box--' + tone : '') });
        if (hasText(c.title)) {
            const head = sectionHeading({ title: c.title, lead: c.desc, actions: c.actions, level: c.level });
            head.classList.add('kit-section-box__head');
            const heading = head.querySelector('.kit-section-heading__title');
            heading.id = surfaceId('section-box') + '-title';
            root.setAttribute('aria-labelledby', heading.id);
            root.appendChild(head);
        }
        root.appendChild(
            el(
                'div',
                { class: 'kit-section-box__body' },
                [hasText(c.note) ? el('p', { class: 'kit-section-box__note', text: String(c.note) }) : null].concat(
                    many(c.body)
                )
            )
        );
        return root;
    }

    /* ---------------------------------------------------------------------
     * People and media (owner picks, people-media family, 2026-09-29,
     * docs/ui-library/standards.md).
     *
     * A person's picture (Kit.personPicture), the big profile photo
     * (Kit.profilePhoto), a logo square (Kit.logoItemSquare), a live camera
     * (Kit.cameraView), a clip's frame in a list (Kit.clipThumb) and a large
     * saved picture (Kit.largeStill). No colour is written here: a person's
     * pastel is one of twelve, named by a data attribute, and a camera's
     * state is a data attribute; css/kit-standards.css owns what they look like.
     * ------------------------------------------------------------------- */

    /**
     * Two letters for a name: the first and last words' first letters, or a
     * one-word name's first two (Employees' rule, js/employees/ui.js
     * avatar()). '' for no name, which each part draws as its glyph instead,
     * never a "?" that reads as a fault.
     */
    function initialsOf(name) {
        const parts = String(name == null ? '' : name)
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!parts.length) return '';
        const two = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
        return two.toUpperCase();
    }

    /**
     * A picture address the kit will load: https, an inline image, or a path
     * on this site. Anything else (http:, javascript:, a stray object) is not
     * drawn, and the part shows what it shows with no picture.
     */
    function pictureUrl(v) {
        const s = typeof v === 'string' ? v.trim() : '';
        return /^(?:https:\/\/|data:image\/|\/(?!\/))/i.test(s) ? s : null;
    }

    /**
     * The person's illustrated face: one of the 24 Employees ships
     * (assets/avatars/, DiceBear "Notionists" by Zoish, CC0 1.0), picked from
     * the key exactly as Employees picks it, so one person has one face on
     * every screen. ⛔ Shipped files, never fetched from DiceBear: its API
     * takes the seed in the URL, and the seed would be a person's id.
     */
    const FACE_COUNT = 24;
    function faceFor(key) {
        const s = String(key || '');
        if (!s) return null;
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        const n = (h % FACE_COUNT) + 1;
        return '/assets/avatars/face-' + (n < 10 ? '0' : '') + n + '.svg';
    }

    /**
     * Which of the twelve pastels a name's initials take. Employees' hue
     * (js/employees/ui.js hueFor: 35 to 325, never red), with its band cut
     * into twelve, so a person keeps one tint everywhere.
     */
    const PERSON_TINTS = 12;
    function tintFor(name) {
        const s = String(name || '');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        const hue = 35 + (h % 291);
        return Math.min(PERSON_TINTS, Math.floor(((hue - 35) * PERSON_TINTS) / 291) + 1);
    }

    /**
     * Does this drag carry files? A drag of words or a link does not light a
     * drop target up, and is not taken as a drop.
     */
    function carriesFiles(e) {
        const t = e && e.dataTransfer && e.dataTransfer.types;
        return !!t && Array.prototype.indexOf.call(t, 'Files') > -1;
    }

    /** Off in either spelling: `disabled`, or `aria-disabled="true"`. */
    function isOffNode(n) {
        return !!n && (n.disabled === true || n.getAttribute('aria-disabled') === 'true');
    }

    /**
     * ⛔ THE ONE DROP HELPER. Every place in the kit a file can be dropped
     * (the profile photo, the logo square and the file drop well) is made a
     * drop target here, so they all behave the same. While a file is held
     * over the node it carries `.is-drop` (its drag-over look), and a drop
     * hands every file to onFiles, as an array. Only a drag that carries
     * files lights it up or is taken: a drag of words or a link is not. The
     * drag's way in and out is counted, so crossing the picture or the words
     * inside it (each a dragleave of the node and a dragenter of the child)
     * does not flicker the look off and on. A node that is off (disabled, or
     * aria-disabled="true") takes nothing and never lights up.
     */
    function dropTarget(node, onFiles) {
        let inside = 0;
        node.addEventListener('dragenter', (e) => {
            if (!carriesFiles(e)) return;
            if (isOffNode(node)) {
                swallowDrop(e);
                return;
            }
            e.preventDefault();
            inside += 1;
            node.classList.add('is-drop');
        });
        // Without it the browser refuses the drop.
        node.addEventListener('dragover', (e) => {
            if (!carriesFiles(e)) return;
            if (isOffNode(node)) swallowDrop(e);
            else e.preventDefault();
        });
        node.addEventListener('dragleave', (e) => {
            if (!carriesFiles(e)) return;
            inside = Math.max(0, inside - 1);
            if (!inside) node.classList.remove('is-drop');
        });
        node.addEventListener('drop', (e) => {
            if (!carriesFiles(e)) return;
            inside = 0;
            node.classList.remove('is-drop');
            if (isOffNode(node)) {
                swallowDrop(e);
                return;
            }
            e.preventDefault();
            const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(Boolean);
            if (files.length) onFiles(files);
        });
    }

    /**
     * ⛔ A FILE LET FALL ON A TARGET THAT IS OFF MUST STILL BE CAUGHT. A drag
     * nobody cancels is the browser's: it opens the file in the tab, and the
     * page behind it (the Scan window's queue) is gone. So an off target
     * cancels the drag and says it takes nothing (dropEffect 'none'), draws
     * no drag-over look and hands nothing on.
     */
    function swallowDrop(e) {
        e.preventDefault();
        try {
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        } catch (_e) {
            /* a read-only dataTransfer: the cancel alone keeps the file */
        }
    }

    /**
     * The file picker behind a drop target's keyboard way in: a hidden file
     * input, out of the tab order, that a real button opens. What is picked
     * goes to onFiles as an array, as a drop does, and the input is emptied
     * so the same file can be picked again.
     */
    function fileInput(accept, multiple, onFiles) {
        const input = el('input', {
            type: 'file',
            accept: accept,
            multiple: multiple ? '' : null,
            tabindex: '-1',
            'aria-hidden': 'true'
        });
        input.hidden = true;
        input.addEventListener('change', () => {
            const files = Array.prototype.slice.call(input.files || []).filter(Boolean);
            input.value = '';
            if (files.length) onFiles(files);
        });
        return input;
    }

    const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

    /**
     * A drop target beside its keyboard way in: a real button (the page's
     * own `chooser`, or the kit's "Choose a file") that opens a file picker
     * behind it. The picker and the drop hand a file to the same onFile.
     */
    function filePick(picture, c) {
        const one = (files) => c.onFile(files[0]);
        const input = fileInput(hasText(c.accept) ? String(c.accept) : PICTURE_TYPES, false, one);
        const button =
            c.chooser && c.chooser.nodeType === 1
                ? c.chooser
                : el('button', {
                      class: 'kit-btn',
                      type: 'button',
                      text: hasText(c.chooseText) ? String(c.chooseText) : 'Choose a file'
                  });
        button.addEventListener('click', () => input.click());
        dropTarget(picture, one);
        return el('div', { class: 'kit-file-pick' }, [picture, button, input]);
    }

    const PERSON_SIZES = ['sm', 'md', 'lg', 'xl'];

    /**
     * Kit.personPicture({ name, id, photo, size, alone }) -> <span>
     *
     * A person in a list or the top bar (pick people-media__person-picture,
     * "Cartoon face, then initials"; .emp-av, css/employees.css:758-775 and
     * :2441-2477, js/employees/ui.js avatar(), which are unchanged).
     *   name   the person's name: the initials and the tint come from it
     *   id     what picks their illustrated face (default: the name), so a
     *          rename keeps the face
     *   photo  their own photo, https or a path on this site; it covers the
     *          circle, and one that fails to load falls back to the initials
     *   size   'sm' 26px, 'md' 36px (the default), 'lg' 48px, 'xl' 88px
     *   alone  true when no name sits beside it: it is then an image named
     *          for the person. Otherwise it is hidden from a screen reader,
     *          which reads the name beside it.
     * With no name it is the dashed circle with the person glyph (nobody
     * named yet). `data-shows` says which picture is up: face, photo,
     * initials or empty.
     */
    function personPicture(o) {
        const c = o || {};
        const name = c.name == null ? '' : String(c.name).trim();
        const size = PERSON_SIZES.indexOf(c.size) > -1 ? c.size : 'md';
        const root = el('span', {
            class: 'kit-person-picture kit-person-picture--' + size + (name ? '' : ' is-empty'),
            role: c.alone ? 'img' : null,
            'aria-label': c.alone ? name || 'Nobody named yet' : null,
            'aria-hidden': c.alone ? null : 'true'
        });
        if (!name) {
            root.dataset.shows = 'empty';
            root.appendChild(Kit.glyph('user', { cls: 'kit-person-picture__glyph' }));
            return root;
        }
        root.dataset.tint = String(tintFor(name));
        root.appendChild(document.createTextNode(initialsOf(name)));
        const photo = pictureUrl(c.photo);
        const img = el('img', { class: 'kit-person-picture__img', alt: '', loading: 'lazy', decoding: 'async' });
        root.dataset.shows = photo ? 'photo' : 'face';
        // A dead picture falls back to the initials under it, never a
        // broken-image icon. Listening before the source is set, so an error
        // that comes early is heard too.
        img.addEventListener('error', () => {
            img.remove();
            root.dataset.shows = 'initials';
        });
        img.setAttribute('src', photo || faceFor(hasText(c.id) ? c.id : name));
        root.appendChild(img);
        return root;
    }

    /**
     * The initials of a round or square picture, or its glyph with no name.
     * Standing alone, the picture is an image named for whoever or whatever
     * it is; beside a row label it is hidden and the label speaks.
     */
    function drawInitials(root, cls, name, glyphName, noName, alone) {
        const two = initialsOf(name);
        root.replaceChildren(
            two ? el('span', { class: cls + '__initials', text: two }) : Kit.glyph(glyphName, { size: 20 })
        );
        if (alone) {
            root.setAttribute('role', 'img');
            root.setAttribute('aria-label', name || noName);
        }
    }

    /** A photo or logo over a picture; one that fails to load puts the initials back. */
    function drawPicture(root, cls, src, name, glyphName, noName, alone) {
        const img = el('img', { class: cls + '__img', alt: alone ? name || noName : '' });
        img.addEventListener('error', () => drawInitials(root, cls, name, glyphName, noName, alone));
        img.setAttribute('src', src);
        root.replaceChildren(img);
        root.removeAttribute('role');
        root.removeAttribute('aria-label');
    }

    /** A profile photo or a logo square: its picture, and its drop target and chooser when it takes a file. */
    function pictureField(cls, src, glyphName, noName, c) {
        const name = c.name == null ? '' : String(c.name).trim();
        const alone = !!c.alone;
        const root = el('div', { class: cls, 'aria-hidden': alone ? null : 'true' });
        if (src) drawPicture(root, cls, src, name, glyphName, noName.photo, alone);
        else drawInitials(root, cls, name, glyphName, noName.none, alone);
        return typeof c.onFile === 'function' ? filePick(root, c) : root;
    }

    /**
     * Kit.profilePhoto({ name, photo, alone, onFile, chooser, chooseText, accept })
     *   -> <div> (the picture), or with onFile the picture beside its chooser
     *
     * The big profile photo (pick people-media__profile-photo, "Circle with
     * tinted initials"; .sy-avatar, css/settings/settings-you.css:27-53 and
     * js/settings/profile.js photoRow(), which are unchanged): a 56px circle,
     * the initials in the accent tint, or the photo.
     *   name        whose photo it is: the initials
     *   photo       the photo, https or a path on this site
     *   alone       true when no row label names it: it is then an image
     *               named for the person (the photo's alt text). Otherwise it
     *               is hidden from a screen reader, which reads the label.
     *   onFile      onFile(file): a picture chosen or dropped. The circle is a
     *               drop target (a 3px accent ring while a file is held over
     *               it), and beside it is a real button that opens a file
     *               picker, so the keyboard has a way in: the page's own
     *               `chooser` button, or the kit's ("Choose a file", or
     *               `chooseText`). `accept` narrows the picker (images).
     */
    function profilePhoto(o) {
        const c = o || {};
        return pictureField(
            'kit-profile-photo',
            pictureUrl(c.photo),
            'user',
            { photo: 'Your photo', none: 'No photo yet' },
            c
        );
    }

    /**
     * Kit.logoItemSquare({ name, src, alone, onFile, chooser, chooseText, accept })
     *   -> <div> (the square), or with onFile the square beside its chooser
     *
     * A logo, product or file square (pick people-media__logo-item-square,
     * "Initials square with a thin line"; .sst-logo,
     * css/settings/settings-store.css:193-216 and js/settings/store.js
     * logoRow(), which are unchanged): a 52px rounded square, the initials,
     * or the logo.
     *   name    the store's (or item's) name: the initials
     *   src     the logo, https or a path on this site
     *   alone, onFile, chooser, chooseText, accept  as Kit.profilePhoto's; a
     *           file held over it draws a dashed accent line on the accent tint
     */
    function logoItemSquare(o) {
        const c = o || {};
        return pictureField(
            'kit-logo-item-square',
            pictureUrl(c.src),
            'store',
            { photo: 'Logo', none: 'No logo yet' },
            c
        );
    }

    // What a camera can be doing: the dot's tone, the words that say it, and
    // the camera label's look for them (Live's green is a rule of the view's).
    const CAMERA_STATES = {
        connecting: [null, 'Connecting', 'connecting'],
        live: ['ok', 'Live', null],
        snapshot: ['warn', 'Snapshot', 'reconnecting'],
        lost: ['bad', 'Video loss', null]
    };
    const CAMERA_LOST = 'No frames reaching the cloud.';
    // What the line says once the picture itself fails to load: the stream
    // may be live, but nothing on the stage shows it.
    const CAMERA_NO_PICTURE = 'Picture did not load';
    // The Ops console's video glyph (js/argus-ops.js, _AO_ICONS.video), in
    // the kit's line style.
    const VIDEO_GLYPH = [
        'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
        'M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5'
    ];

    /**
     * Kit.cameraView({ name, state, label, src, picture, onOpen, large })
     *   -> { el, setState(state, label) }
     *
     * A live camera picture (pick people-media__camera-tile, "Tile with a
     * name-and-status line"; .ao-tv-tile, css/argus-ops.css:7433-7584, which
     * is unchanged): the picture, and along its foot the camera's name
     * (Kit.statusDot's words beside its dot) and what it is doing
     * (Kit.overlayLabel). Dark in both themes, as video is. `el` is a
     * <button> with onOpen, a <div> without.
     *   name     the camera's name ("Aisle 4")
     *   state    'connecting' (the default; busy), 'live' (green), 'snapshot'
     *            (only stills are coming through; amber) or 'lost' (video
     *            loss: red all through, VIDEO LOSS at the size of the
     *            picture)
     *   label    the words for the state: what the camera label says
     *            (default Connecting, Live or Snapshot), or for a lost camera
     *            the reason under VIDEO LOSS (default "No frames reaching the
     *            cloud.")
     *   src      the frame, https or a path on this site; or
     *   picture  the page's own <video>, <img> or <canvas>
     *   onOpen   onOpen(event): the view is a real button that opens the
     *            camera, named for it and its state ("Aisle 4: Live")
     *   large    true for the one camera shown large (a bigger name line)
     * setState(state, label) moves it on as the stream does (connecting,
     * live, snapshot, lost), keeping its picture. The state is always in
     * words as well as colour.
     * ⛔ A PICTURE THAT FAILS TO LOAD IS NEVER CALLED LIVE. Once it fails
     * (or was handed in already failed) the line says "Picture did not load"
     * in the camera label's amber, the dot turns amber, the view's name says
     * it too, and the view carries data-picture="failed", whatever state it
     * is moved to after: as Kit.clipThumb's empty frame says in words what
     * it is. Video loss keeps its own words.
     */
    function cameraView(o) {
        const c = o || {};
        const name = hasText(c.name) ? String(c.name) : 'Camera';
        const opens = typeof c.onOpen === 'function';
        const root = el(opens ? 'button' : 'div', {
            class: 'kit-camera-view' + (c.large ? ' kit-camera-view--large' : ''),
            type: opens ? 'button' : null,
            role: opens ? null : 'group'
        });
        // ⛔ A frame that fails to load shows no broken-image icon: it is
        // taken off the stage, the view's graphite ground shows, and the line
        // says the picture did not load. Its error is heard from before
        // its source is set; a picture the page hands in that had already
        // failed (complete, with no width) is caught when it is placed.
        let media = null;
        let failed = false;
        // What the view was last told, so a picture that fails later redraws
        // the line in words that say so.
        let told = null;
        const drop = () => {
            failed = true;
            if (media && media.parentNode) media.remove();
            if (told) setState(told.state, told.label);
        };
        const brokenAlready = (n) =>
            n.tagName === 'IMG' && !!n.getAttribute('src') && n.complete && n.naturalWidth === 0;
        if (c.picture && c.picture.nodeType === 1) {
            media = c.picture;
            media.classList.add('kit-camera-view__media');
            if (media.tagName === 'IMG') media.addEventListener('error', drop);
        } else if (pictureUrl(c.src)) {
            media = el('img', { class: 'kit-camera-view__media', alt: '' });
            media.addEventListener('error', drop);
            media.setAttribute('src', pictureUrl(c.src));
        }
        const stage = el('span', { class: 'kit-camera-view__stage' });
        const bar = el('span', { class: 'kit-camera-view__bar' });
        root.appendChild(stage);
        root.appendChild(bar);

        function setState(next, label) {
            let state = String(next == null ? 'connecting' : next);
            if (!Object.prototype.hasOwnProperty.call(CAMERA_STATES, state)) {
                warn(
                    '[Kit] cameraView: `' +
                        state +
                        '` is not a state (' +
                        Object.keys(CAMERA_STATES).join(', ') +
                        '); drawing connecting.'
                );
                state = 'connecting';
            }
            told = { state, label };
            const lost = state === 'lost';
            if (!lost && media && !failed && brokenAlready(media)) failed = true;
            // A stage with no picture on it is not a live one.
            const noPicture = !lost && failed;
            const [tone, words, look] = noPicture ? ['warn', CAMERA_NO_PICTURE, 'reconnecting'] : CAMERA_STATES[state];
            const says = noPicture ? CAMERA_NO_PICTURE : hasText(label) ? String(label) : lost ? CAMERA_LOST : words;
            root.dataset.state = state;
            if (noPicture) root.dataset.picture = 'failed';
            else delete root.dataset.picture;
            if (state === 'connecting') root.setAttribute('aria-busy', 'true');
            else root.removeAttribute('aria-busy');
            root.setAttribute('aria-label', name + ': ' + (lost ? words + '. ' + says : says));
            if (lost) {
                stage.replaceChildren(
                    el('span', { class: 'kit-camera-view__loss' }, [
                        Kit.glyph(VIDEO_GLYPH, { cls: 'kit-camera-view__loss-glyph' }),
                        el('span', { class: 'kit-camera-view__loss-head', text: words }),
                        el('span', { class: 'kit-camera-view__loss-why', text: says })
                    ])
                );
            } else {
                stage.replaceChildren(...(media && !failed ? [media] : []));
            }
            // The picture already says VIDEO LOSS at its own size; the label
            // would say it twice, so a lost camera's line is its name alone.
            bar.replaceChildren(
                ...[statusDot({ tone, text: name }), lost ? null : overlayLabel({ text: says, state: look })].filter(
                    Boolean
                )
            );
        }

        setState(c.state, c.label);
        if (opens) root.addEventListener('click', (e) => c.onOpen(e));
        return { el: root, setState };
    }

    /**
     * Kit.clipThumb({ src, label, onOpen, href, playable, emptyText })
     *   -> <button>, <a> or <span>
     *
     * A clip's frame in a list (pick people-media__clip-thumb, "Wider frame,
     * bare play arrow"; .ov-rc-thumb and .ov-rc-play, css/argus.css:
     * 10104-10190 and js/argus.js, which are unchanged): a 168px 16:9 frame
     * with the bare play mark.
     *   src        the frame, https or a path on this site; none (or one that
     *              fails to load) is the empty frame, which says so in words
     *   label      what opening it does, named after the clip ("Watch the
     *              clip from Aisle 4"): the button's (or link's) name
     *   onOpen     onOpen(event): the frame is a real button
     *   href       the frame is a real link (with onOpen too, a plain click
     *              is the page's own)
     *   playable   false for a frame with no clip to play: no play mark
     *   emptyText  the words on an empty frame (default "Clip no longer
     *              available", the retention schedule's pruned clip)
     * With neither onOpen nor href it opens nothing and is hidden from a
     * screen reader: the row button holding it names what it opens.
     */
    function clipThumb(o) {
        const c = o || {};
        const link = hasText(c.href);
        const opens = link || typeof c.onOpen === 'function';
        const label = hasText(c.label) ? String(c.label) : 'Open the clip';
        const words = hasText(c.emptyText) ? String(c.emptyText) : 'Clip no longer available';
        const root = el(link ? 'a' : opens ? 'button' : 'span', {
            class: 'kit-clip-thumb',
            href: link ? String(c.href) : null,
            type: link || !opens ? null : 'button',
            'aria-hidden': opens ? null : 'true'
        });
        const empty = () => {
            root.classList.add('is-empty');
            root.replaceChildren(el('span', { class: 'kit-clip-thumb__words', text: words }));
            if (opens) root.setAttribute('aria-label', label + '. ' + words);
        };
        const src = pictureUrl(c.src);
        if (!src) empty();
        else {
            const img = el('img', { class: 'kit-clip-thumb__img', alt: '', loading: 'lazy', decoding: 'async' });
            // A dead frame must not leave a broken-image glyph in the list;
            // listening before the source is set.
            img.addEventListener('error', empty);
            img.setAttribute('src', src);
            root.appendChild(img);
            if (c.playable !== false) root.appendChild(Kit.glyph(['M6 3v18l15-9z'], { cls: 'kit-clip-thumb__play' }));
            if (opens) root.setAttribute('aria-label', label);
        }
        if (typeof c.onOpen === 'function') {
            root.addEventListener('click', (e) => {
                if (link) {
                    if (!plainClick(e)) return;
                    e.preventDefault();
                }
                c.onOpen(e);
            });
        }
        return root;
    }

    const STILL_SIZES = ['entry', 'clip', 'evidence', 'upload'];
    // What an empty picture says, by where it sits.
    const STILL_GONE = {
        entry: 'Clip no longer available',
        clip: 'No frame saved',
        evidence: 'Picture no longer available',
        upload: 'No picture'
    };

    /**
     * Kit.largeStill({ src, alt, size, emptyText }) -> <span>
     *
     * A large saved picture (pick people-media__large-still, "Whole frame
     * with a thin line"; LP's dossier pictures, css/argus.css:10632-10877 and
     * :12983-13021, which are unchanged): the picture in its box.
     *   src        the picture, https or a path on this site
     *   alt        what it shows, for a screen reader ('' when the words
     *              beside it already say)
     *   size       'entry' (a log entry's 88px 16:9 photo, the default),
     *              'clip' (a clip picker's 16:9 frame, as wide as its card),
     *              'evidence' (the full width up to 420px tall, the whole
     *              picture shown) or 'upload' (the 62px upload preview)
     *   emptyText  the words when there is no picture (by size: "Clip no
     *              longer available", "No frame saved", "Picture no longer
     *              available", "No picture")
     * A picture that fails to load turns the box empty, whether or not it is
     * on the page yet: the box stays, only what is in it changes.
     */
    function largeStill(o) {
        const c = o || {};
        const size = STILL_SIZES.indexOf(c.size) > -1 ? c.size : 'entry';
        const root = el('span', { class: 'kit-large-still kit-large-still--' + size });
        const words = hasText(c.emptyText) ? String(c.emptyText) : STILL_GONE[size];
        const gone = () => {
            root.classList.add('is-empty');
            root.replaceChildren(el('span', { class: 'kit-large-still__words', text: words }));
        };
        const src = pictureUrl(c.src);
        if (!src) {
            gone();
            return root;
        }
        const img = el('img', {
            class: 'kit-large-still__img',
            alt: hasText(c.alt) ? String(c.alt) : '',
            decoding: 'async'
        });
        // Listening before the source is set, so an error that comes before
        // the picture is on the page is heard too.
        img.addEventListener('error', gone);
        img.setAttribute('src', src);
        root.appendChild(img);
        return root;
    }

    /* ---------------------------------------------------------------------
     * History, show more, key hints and copy (owner picks, history family,
     * 2026-09-29). Each copied from its picked source, which is read and
     * never edited: Settings' new API key box (css/settings/settings-system.
     * css:346-373, js/settings/api-keys.js:138-167), Financials' trend note
     * copy (css/financials-insights.css:395-442, js/financials/view-insights.
     * js:2278-2296), Financials' Show graphs chevron (css/financials-
     * transactions.css:666-675), Settings' Show every step (css/settings/
     * settings-apps.css:181-218), Loss Prevention's alert history (css/argus.
     * css:12314-12418) and the search window's key hints (css/dashboard.css:
     * 10713-10739).
     * ------------------------------------------------------------------- */

    // How long "Copied" (or "Could not copy") stays before the part goes back
    // to how it was: the two seconds the kit's "Saved" holds (Kit.settingRow).
    const COPY_HOLD_MS = 2000;
    // What a screen reader hears, in the part's own polite live region.
    const COPY_SAID = { done: 'Copied', failed: 'Could not copy', empty: 'Nothing to copy' };

    /**
     * The browser's own copy command, on a selection: `from` when it holds
     * exactly these words (the copy box's own text), else a scratch box that
     * is gone before this returns. The page's selection and focus are put
     * back. True only when the browser says the words were copied.
     */
    function copyBySelection(text, from) {
        if (typeof document.execCommand !== 'function') return false;
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        const kept = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const focused = document.activeElement;
        let scratch = null;
        let ok = false;
        try {
            if (from && from.isConnected && from.textContent === text && sel) {
                const r = document.createRange();
                r.selectNodeContents(from);
                sel.removeAllRanges();
                sel.addRange(r);
            } else {
                scratch = el('textarea', { readonly: '', tabindex: '-1', 'aria-hidden': 'true' });
                scratch.value = text;
                // Out of sight and out of the way for the moment it exists.
                scratch.style.position = 'fixed';
                scratch.style.top = '0';
                scratch.style.left = '0';
                scratch.style.opacity = '0';
                scratch.style.pointerEvents = 'none';
                document.body.appendChild(scratch);
                scratch.select();
            }
            ok = !!document.execCommand('copy');
        } catch (_e) {
            ok = false;
        }
        if (scratch) scratch.remove();
        if (sel) {
            try {
                sel.removeAllRanges();
                if (kept) sel.addRange(kept);
            } catch (_e) {
                /* a selection the page cannot take back is left as it is */
            }
        }
        if (focused && focused !== document.activeElement && typeof focused.focus === 'function') {
            focused.focus({ preventScroll: true });
        }
        return ok;
    }

    /**
     * Put `text` on the clipboard. Resolves true only when it got there:
     * navigator.clipboard first; where there is none (an insecure origin, an
     * older in-store browser) or it refuses, the selection fallback above.
     * Never throws and never resolves true on a guess.
     */
    function writeClipboard(text, from) {
        const fallback = () => copyBySelection(text, from);
        try {
            const clip = window.navigator && window.navigator.clipboard;
            if (clip && typeof clip.writeText === 'function') {
                return Promise.resolve(clip.writeText(text)).then(() => true, fallback);
            }
        } catch (_e) {
            /* no clipboard to ask: the fallback below */
        }
        return Promise.resolve().then(fallback);
    }

    /**
     * The ONE copy behaviour both copy parts share (Kit.copyBox, Kit.copyIcon).
     * A press copies, then the button carries data-state="done" or "failed"
     * and the part's own polite live region (made with the part, so it is on
     * the page before it has anything to say) says "Copied" or "Could not
     * copy", for COPY_HOLD_MS; then both go back. A second press restarts it.
     * ⛔ NO WORDS IS A FAILED COPY, NEVER "Copied": an empty or blank text
     * puts nothing worth having on the clipboard, so the clipboard is not
     * touched, the button is drawn failed and it is heard as "Nothing to
     * copy".
     *   c.btn, c.said  the button and the live region
     *   c.text         the words, or a function that returns them at the press
     *   c.from         the element that shows those words, for the fallback
     *   c.onState      (state, pressed, empty) for the part's own look;
     *                  `empty` is true when there were no words to copy
     * Returns show(state): draws 'done' or 'failed' and holds it (null goes
     * back), for a page that shows what a copy did; it says nothing aloud.
     */
    function copyAction(c) {
        let timer = null;
        function show(state, pressed, empty) {
            clearTimeout(timer);
            timer = null;
            const s = state === 'done' || state === 'failed' ? state : null;
            if (s) c.btn.dataset.state = s;
            else {
                delete c.btn.dataset.state;
                c.said.textContent = '';
            }
            if (typeof c.onState === 'function') c.onState(s, !!pressed, s === 'failed' && !!empty);
            if (s && pressed) {
                timer = setTimeout(() => {
                    timer = null;
                    // A part taken off the page is left as it was: nothing
                    // touches it once it is gone.
                    if (c.btn.isConnected) show(null);
                }, COPY_HOLD_MS);
            }
        }
        function say(words) {
            // The same words twice change nothing a screen reader hears: a
            // no-break space makes the second press news too.
            c.said.textContent = c.said.textContent === words ? words + '\u00a0' : words;
        }
        c.btn.addEventListener('click', () => {
            if (c.btn.getAttribute('aria-disabled') === 'true') return;
            const raw = typeof c.text === 'function' ? c.text() : c.text;
            const words = raw == null ? '' : String(raw);
            if (!words.trim()) {
                say(COPY_SAID.empty);
                show('failed', true, true);
                return;
            }
            writeClipboard(words, c.from).then((ok) => {
                const s = ok ? 'done' : 'failed';
                say(COPY_SAID[s]);
                show(s, true);
            });
        });
        return show;
    }

    /** Select what `node` shows, for the person to copy it themselves. */
    function selectAll(node) {
        try {
            const sel = window.getSelection();
            const r = document.createRange();
            r.selectNodeContents(node);
            sel.removeAllRanges();
            sel.addRange(r);
        } catch (_e) {
            /* nothing to select on a part that is not on the page */
        }
    }

    /**
     * Kit.copyBox({ text, textLabel, words, state }) -> <div>
     *
     * A code or an address with its Copy button (pick history__copy-box,
     * "Mono box and Copy that turns green"; Settings' new API key).
     *   text       the words, whole, in a raised mono box that selects as one
     *              piece. It is a read-only field that takes keyboard focus,
     *              and keyboard focus selects the words, so Cmd or Ctrl+C
     *              copies them without a pointer.
     *   textLabel  what the words are, for a screen reader ('The new API
     *              key'): the field's name, and the button's description
     *   words      the button's words ('Copy key'); 'Copy' when left out.
     *              They are its name, whatever it says ("Copied", "Select it
     *              and copy"), so what is read is what is shown.
     *   state      'done' or 'failed', drawn and held, for a page that shows
     *              what a copy did
     * A press copies: the button says "Copied" in green, or "Select it and
     * copy" with the words selected for the person to copy themselves, for
     * two seconds, and a screen reader hears "Copied" or "Could not copy".
     * A box with no words says "Nothing to copy", drawn failed.
     */
    function copyBox(o) {
        const c = o || {};
        const words = hasText(c.words) ? String(c.words) : 'Copy';
        const named = hasText(c.textLabel) ? String(c.textLabel) : null;
        // The button is described by what the words are, never by the words
        // themselves: a description pointing at the key would read it aloud.
        const what = named
            ? el('span', { class: 'kit-copy-box__what', id: surfaceId('copy-box') + '-what', text: named, hidden: '' })
            : null;
        const text = el('code', {
            class: 'kit-copy-box__text',
            tabindex: '0',
            role: 'textbox',
            'aria-readonly': 'true',
            'aria-label': named,
            text: hasText(c.text) ? String(c.text) : ''
        });
        // Keyboard focus selects the words, so Cmd or Ctrl+C copies them. A
        // turn later, once focusing has finished moving the selection itself,
        // and only while the words still have focus.
        text.addEventListener('focus', () => {
            setTimeout(() => {
                if (document.activeElement === text) selectAll(text);
            }, 0);
        });
        const says = el('span', { text: words });
        const btn = el(
            'button',
            { class: 'kit-btn kit-copy-box__btn', type: 'button', 'aria-describedby': what ? what.id : null },
            [Kit.glyph('copy', { cls: 'kit-copy-box__glyph' }), says]
        );
        const said = el('span', { class: 'kit-copy-box__said', role: 'status', 'aria-live': 'polite' });
        const root = el('div', { class: 'kit-copy-box' }, [text, btn, what, said]);
        const show = copyAction({
            btn,
            said,
            text: () => text.textContent,
            from: text,
            onState(s, pressed, empty) {
                says.textContent =
                    s === 'done' ? 'Copied' : empty ? 'Nothing to copy' : s === 'failed' ? 'Select it and copy' : words;
                if (s === 'failed' && pressed && !empty) selectAll(text);
            }
        });
        if (c.state === 'done' || c.state === 'failed') show(c.state, false);
        return root;
    }

    /**
     * Kit.copyIcon({ text, label, reveal, state }) -> <span>
     *
     * A small copy icon (pick history__copy-icon, "Copy icon that turns into
     * a check"; Financials' trend note copy): a 32px square with the copy
     * glyph, which turns into a check once the words are on the clipboard.
     *   text    the words, or a function that returns them at the press
     *   label   the button's name ('Copy section'); 'Copy' when left out
     *   reveal  true to wait for what holds it, as Financials' note does: out
     *           of sight until the element it sits in is under the pointer or
     *           holds keyboard focus. Always in sight on a touch screen, which
     *           has no pointer to wait for.
     *   state   'done' or 'failed', drawn and held
     * A press copies; for two seconds the icon is a check (done), and a
     * screen reader hears "Copied" or "Could not copy" ("Nothing to copy",
     * and never a check, when there are no words).
     */
    function copyIcon(o) {
        const c = o || {};
        const btn = el(
            'button',
            { class: 'kit-copy-icon__btn', type: 'button', 'aria-label': hasText(c.label) ? String(c.label) : 'Copy' },
            [
                Kit.glyph('copy', { cls: 'kit-copy-icon__glyph kit-copy-icon__glyph--copy' }),
                Kit.glyph('check', { cls: 'kit-copy-icon__glyph kit-copy-icon__glyph--check' })
            ]
        );
        const said = el('span', { class: 'kit-copy-icon__said', role: 'status', 'aria-live': 'polite' });
        const root = el('span', { class: 'kit-copy-icon' + (c.reveal ? ' kit-copy-icon--reveal' : '') }, [btn, said]);
        const show = copyAction({ btn, said, text: c.text });
        if (c.state === 'done' || c.state === 'failed') show(c.state, false);
        return root;
    }

    /**
     * What both disclosures share (Kit.foldOpen, Kit.showMore): aria-expanded
     * on the button, the panel's id in aria-controls (one is given if it has
     * none), the panel's `hidden` following the button, and onToggle(open)
     * after each press. `redraw(open)` is the part's own look.
     */
    function disclose(name, btn, c, redraw) {
        const panel = c.panel && c.panel.nodeType === 1 ? c.panel : null;
        if (panel) {
            if (!panel.id) panel.id = surfaceId(name + '-panel');
            btn.setAttribute('aria-controls', panel.id);
        } else {
            warn('[Kit] ' + name + ': no `panel` to open; the button says open or shut and shows nothing.');
        }
        if (c.disabled) btn.disabled = true;
        let open = !!c.open;
        function set(v) {
            open = v;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (panel) panel.hidden = !open;
            if (redraw) redraw(open);
        }
        set(open);
        btn.addEventListener('click', () => {
            if (btn.getAttribute('aria-disabled') === 'true') return;
            set(!open);
            if (typeof c.onToggle === 'function') c.onToggle(open);
        });
    }

    /**
     * Kit.foldOpen({ label, panel, open, onToggle, disabled }) -> <button>
     *
     * The bare chevron at the end of a row that folds a section open (pick
     * history__fold-open, "Bare chevron at the end of the row"; Financials'
     * Show graphs): a 32px square, no box at rest, the chip grey under the
     * pointer. The chevron turns to point up while the section is open.
     *   label     the section it opens ('Graphs'): the button's name, which
     *             stays; aria-expanded says whether it is open
     *   panel     the section: its `hidden` follows the button
     *   open      starts open
     *   onToggle  (open) after each press
     *   disabled  starts switched off
     */
    function foldOpen(o) {
        const c = o || {};
        const btn = el(
            'button',
            { class: 'kit-fold-open', type: 'button', 'aria-label': hasText(c.label) ? String(c.label) : 'Show more' },
            [Kit.glyph('chevronDown', { cls: 'kit-fold-open__glyph' })]
        );
        disclose('fold-open', btn, c);
        return btn;
    }

    /**
     * Kit.showMore({ words, openWords, panel, open, onToggle, disabled }) -> <button>
     *
     * Accent words with a chevron that open more below them (pick
     * history__show-more, "Accent words with a chevron"; Settings' Show every
     * step). The words underline under the pointer; open, the chevron turns to
     * point up and the words become `openWords`.
     *   words      the words while shut ('Show every step'); 'Show more'
     *   openWords  the words while open ('Hide the steps'); the same words
     *              when left out
     *   panel, open, onToggle, disabled   as Kit.foldOpen
     */
    function showMore(o) {
        const c = o || {};
        const shut = hasText(c.words) ? String(c.words) : 'Show more';
        const opened = hasText(c.openWords) ? String(c.openWords) : shut;
        const says = el('span', { text: shut });
        const btn = el('button', { class: 'kit-show-more', type: 'button' }, [
            says,
            Kit.glyph('chevronDown', { size: 14, cls: 'kit-show-more__glyph' })
        ]);
        disclose('show-more', btn, c, (open) => {
            says.textContent = open ? opened : shut;
        });
        return btn;
    }

    /**
     * Kit.historyList({ title, level, items, emptyText }) -> <div>
     *
     * A history, newest first (pick history__history-list, "Status timeline
     * with dots"; Loss Prevention's alert history): a mono label over an
     * ordered list, one step to an item, each with the kit's status dot
     * (Kit.statusDot's disc and tones) and a hairline down to the next.
     *   title      the label ('History'), a heading at `level` (2 to 6; 2)
     *   items      [{ what, who, at, when, note, tone }]
     *                what  what happened ('Confirmed theft')
     *                who   who did it, in the ink ('Sam Reviewer')
     *                at    when, as an ISO date or date-time
     *                      ('2026-06-20T13:42'): the <time>'s datetime.
     *                      Anything else ('yesterday') says so and is
     *                      shown as words, with no datetime
     *                when  when, in words ('2 hours ago'); `at` when left out
     *                note  what they wrote, under the line
     *                tone  the dot's, Kit.statusDot's: 'ok', 'warn',
     *                      'bad', 'muted', 'accent' or 'info' (LP's blue for
     *                      under review and opened); none for the grey
     *   emptyText  the line a history with nothing in it shows
     * The dot is hidden from a screen reader: the words say what happened.
     */
    // A date or a date-time a machine reads: 2026-06-20, 2026-06-20T13:42,
    // with seconds, a fraction and a zone if it has them.
    const ISO_WHEN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

    function historyList(o) {
        const c = o || {};
        const items = listOf(c.items, 'historyList', 'items');
        const root = el('div', { class: 'kit-history-list' });
        let head = null;
        if (hasText(c.title)) {
            head = el(headingTag(c.level), {
                class: 'kit-history-list__head',
                id: surfaceId('history-list') + '-title',
                text: String(c.title)
            });
            root.appendChild(head);
        }
        if (!items.length) {
            root.appendChild(
                el('p', {
                    class: 'kit-history-list__empty',
                    text: hasText(c.emptyText) ? String(c.emptyText) : 'Nothing has happened yet.'
                })
            );
            return root;
        }
        // role=list because list-style: none takes a list's meaning away in
        // Safari, and this is a list of steps in order.
        const list = el('ol', {
            class: 'kit-history-list__items',
            role: 'list',
            'aria-labelledby': head ? head.id : null
        });
        items.forEach((it) => {
            const r = it || {};
            const tone = STATUS_DOT_TONES.indexOf(String(r.tone)) > -1 ? String(r.tone) : null;
            if (r.tone != null && r.tone !== '' && !tone) {
                warn(
                    '[Kit] historyList: `' +
                        String(r.tone) +
                        '` is not a tone (' +
                        STATUS_DOT_TONES.join(', ') +
                        '); drawing the grey.'
                );
            }
            const line = el('p', { class: 'kit-history-list__line' });
            const bits = [];
            if (hasText(r.what)) bits.push(el('span', { text: String(r.what) }));
            if (hasText(r.who)) bits.push(el('span', { class: 'kit-history-list__who', text: String(r.who) }));
            const at = hasText(r.at) ? String(r.at) : null;
            const iso = at !== null && ISO_WHEN.test(at);
            if (at !== null && !iso) {
                warn(
                    '[Kit] historyList: `at` is "' +
                        at +
                        '", which is not an ISO date or date-time (2026-06-20T13:42); ' +
                        'showing it as words with no datetime.'
                );
            }
            if (at !== null || hasText(r.when)) {
                // A <time> only when a machine can read it; words otherwise.
                bits.push(
                    el(iso ? 'time' : 'span', {
                        class: 'kit-history-list__when',
                        datetime: iso ? at : null,
                        text: hasText(r.when) ? String(r.when) : at
                    })
                );
            }
            bits.forEach((b, i) => {
                if (i) line.appendChild(document.createTextNode(' · '));
                line.appendChild(b);
            });
            list.appendChild(
                el('li', { class: 'kit-history-list__item kit-enter' }, [
                    el('span', { class: 'kit-history-list__mark' }, [
                        el('span', {
                            class: 'kit-status-dot' + (tone ? ' kit-status-dot--' + tone : ''),
                            'aria-hidden': 'true'
                        })
                    ]),
                    el('div', { class: 'kit-history-list__body' }, [
                        line,
                        hasText(r.note) ? el('p', { class: 'kit-history-list__note', text: String(r.note) }) : null
                    ])
                ])
            );
        });
        root.appendChild(list);
        return root;
    }

    /**
     * Kit.keyHint({ keys, words }) -> <kbd> | <span>
     *
     * A keyboard key hint (pick history__key-hint, "Small filled keycaps with
     * words"; the search window's footer): a small filled mono keycap.
     *   keys   what to press ('esc', '↑↓', '⌘↵')
     *   words  what it does ('Close'): the keycap and its words on one line.
     *          Without words it is the keycap alone, as the pop-up search's
     *          esc is (Kit.popupSearch draws the same keycap).
     */
    function keyHint(o) {
        const c = o || {};
        const cap = el('kbd', { class: 'kit-key-hint', text: hasText(c.keys) ? String(c.keys) : '' });
        if (!hasText(c.words)) return cap;
        return el('span', { class: 'kit-key-hint-line' }, [
            cap,
            el('span', { class: 'kit-key-hint-line__text', text: String(c.words) })
        ]);
    }

    /**
     * Kit.keyHints([{ keys, words }]) -> <div>
     *
     * A row of key hints, as the search window's footer draws them:
     * "↑↓ Navigate", "↵ Open", "esc Close", 14px apart.
     */
    function keyHints(list) {
        return el(
            'div',
            { class: 'kit-key-hints' },
            listOf(list, 'keyHints', 'hints').map((h) => keyHint(h))
        );
    }

    /* ---------------------------------------------------------------------
     * Toolbars, drop zones and inline notes (owner picks, bars family,
     * 2026-09-29, docs/ui-library/standards.md).
     *
     * The file drop well (Kit.fileDrop), the photo picker (Kit.photoPicker),
     * the search and filter bar above a list (Kit.listToolbar), the bar that
     * appears while rows are ticked (Kit.selectionBar) and the sentence with
     * its Undo (Kit.undo). The save note is Kit.saveNote in forms.js, beside
     * the setting row that draws it. Each is built from parts the kit already
     * has wherever one exists: the drop helper above, Kit.personPicture, the
     * search field, the in-page switch, the filter chip, the dates and
     * filter buttons, and the everyday button.
     * ------------------------------------------------------------------- */

    /**
     * Kit.fileDrop({ title, hint, accept, multiple, disabled, onFiles })
     *   -> { el, refuse(message), clear() }
     *
     * A big well a file is dropped on (pick bars__file-drop, "Big drop
     * well"; Inventory's Scan an invoice window, .invscan__zone,
     * css/inventory-scan.css:251-349 and js/inventory/invoice-scan-modal.js:
     * 518, which are unchanged): a dashed, recessed well with a drawn box and
     * arrow, what to drop in bold and a caption under it. Under the pointer
     * and while a file is held over it (.is-drop) its line and mark take the
     * module's colour.
     *   title     what to drop ('Drop invoices here'); the well's name
     *   hint      the caption: what it takes ('PDF or a photo, up to 15MB')
     *   accept    what the file picker offers, as an input's accept
     *   multiple  false to take one file (default: any number)
     *   disabled  true to switch it off: dimmed, and it takes nothing
     *   onFiles   onFiles([File]): the files dropped or picked. Checking them
     *             is the page's; one it will not take is refuse()d.
     * The well is a real button: Enter, Space or a click opens the file
     * picker, so the keyboard has the same way in as the pointer, and the
     * picker and the drop hand files to the same onFiles. refuse(message)
     * prints why under the well, in red, read out at once, and ties it to the
     * well as its description; clear() takes it away, as the next files do.
     */
    function fileDrop(o) {
        const c = o || {};
        const id = surfaceId('file-drop');
        const main = el('span', {
            class: 'kit-file-drop__main',
            id: id + '-main',
            text: hasText(c.title) ? String(c.title) : 'Drop files here'
        });
        const hint = hasText(c.hint)
            ? el('span', { class: 'kit-file-drop__hint', id: id + '-hint', text: String(c.hint) })
            : null;
        const well = el(
            'button',
            {
                class: 'kit-file-drop__well',
                type: 'button',
                'aria-labelledby': main.id,
                'aria-describedby': hint ? hint.id : null
            },
            [
                el('span', { class: 'kit-file-drop__mark', 'aria-hidden': 'true' }, [
                    el('span', { class: 'kit-file-drop__arrow' })
                ]),
                main,
                hint
            ]
        );
        if (c.disabled) well.disabled = true;
        const error = el('p', { class: 'kit-file-drop__error', id: id + '-error', role: 'alert' });
        function clear() {
            error.textContent = '';
            if (hint) well.setAttribute('aria-describedby', hint.id);
            else well.removeAttribute('aria-describedby');
        }
        function take(files) {
            clear();
            if (typeof c.onFiles === 'function') c.onFiles(files);
        }
        const input = fileInput(hasText(c.accept) ? String(c.accept) : null, c.multiple !== false, take);
        well.addEventListener('click', () => {
            if (!isOffNode(well)) input.click();
        });
        dropTarget(well, take);
        const root = el('div', { class: 'kit-file-drop' }, [well, input, error]);
        // A <button disabled> may be sent no drag events at all, so the well's
        // own handlers never hear the file: the wrapper catches it for them.
        ['dragenter', 'dragover', 'drop'].forEach((type) => {
            root.addEventListener(type, (e) => {
                if (!e.defaultPrevented && carriesFiles(e) && isOffNode(well)) swallowDrop(e);
            });
        });
        return {
            el: root,
            refuse(message) {
                error.textContent = hasText(message) ? String(message) : 'That file cannot be used here.';
                well.setAttribute('aria-describedby', (hint ? hint.id + ' ' : '') + error.id);
            },
            clear: clear
        };
    }

    // The account page's camera (js/account.js ICONS.camera), in the kit's
    // line style: the body, and the lens as a path.
    const CAMERA_GLYPH = [
        'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',
        'M16 13a4 4 0 1 1-8 0a4 4 0 1 1 8 0z'
    ];

    /**
     * Kit.photoPicker({ name, id, photo, onFile, accept, label }) -> <div>
     *
     * A person's photo that changes when pressed (pick bars__photo-picker,
     * "Photo with hover veil"; the Account page's avatar, .account-avatar-
     * wrapper, css/account.css:40-93 and js/account.js:139, which are
     * unchanged): a 76px rounded square, and over it a dark veil with a
     * camera and CHANGE that shows under the pointer.
     *   name    whose photo it is: the initials, and the face's seed when
     *           there is no id
     *   id      what picks their illustrated face, as Kit.personPicture's
     *   photo   their own photo (https or a path on this site). ⛔ Pass one
     *           only when they uploaded one: without it the picture is their
     *           illustrated face (assets/avatars/face-NN.svg), owner's rule
     *   onFile  onFile(file): the picture chosen
     *   accept  what the file picker offers (default: pictures)
     *   label   the veil's name (default 'Change photo')
     * The picture is Kit.personPicture's, so one person has one face on
     * every screen. The veil is a real button, reachable by Tab, that opens
     * the file picker; it shows while it is under the pointer or has
     * keyboard focus, and wears the kit's shared focus ring.
     */
    function photoPicker(o) {
        const c = o || {};
        const picture = personPicture({ name: c.name, id: c.id, photo: c.photo, size: 'xl' });
        const veil = el(
            'button',
            {
                class: 'kit-photo-picker__veil',
                type: 'button',
                'aria-label': hasText(c.label) ? String(c.label) : 'Change photo'
            },
            [Kit.glyph(CAMERA_GLYPH, { size: 14 }), el('span', { text: 'Change' })]
        );
        const input = fileInput(hasText(c.accept) ? String(c.accept) : PICTURE_TYPES, false, (files) => {
            if (typeof c.onFile === 'function') c.onFile(files[0]);
        });
        veil.addEventListener('click', () => input.click());
        return el('div', { class: 'kit-photo-picker' }, [picture, veil, input]);
    }

    /**
     * Kit.listToolbar({ start, tags, tagsLabel, end, apart }) -> { el, setTags(nodes) }
     *
     * The search and filter bar above a list (pick bars__list-toolbar,
     * "Financials Transactions bar"; .ftx-bar, css/financials-transactions.
     * css:61-81 and js/financials/view-transactions.js:722, which are
     * unchanged). ⛔ IT IS THE LAYOUT AND NOTHING ELSE: the parts in it are
     * the kit's own, passed in as they are, and it draws none of their looks.
     *   start  the left: the search field (Kit.searchField) and the in-page
     *          switch (Kit.inlineSwitch(...).el), 8px apart
     *   tags   the filters in use, after them: set filter chips with their x
     *          (Kit.filterChip), in a group named by tagsLabel ('Filters in
     *          use'); none, and the group takes no room
     *   end    the right: the dates (Kit.rangeButton) and the filter buttons
     *          (Kit.filterButton: Filters, View), 8px apart
     *   apart  the one action that sits a little apart, last (Export, a
     *          Kit.filterButton with no pop-out)
     * The two sides wrap under each other when the row runs out of room.
     * setTags(nodes) puts the filters in use as they change.
     */
    function listToolbar(o) {
        const c = o || {};
        const tags = el('div', {
            class: 'kit-list-toolbar__tags',
            role: 'group',
            'aria-label': hasText(c.tagsLabel) ? String(c.tagsLabel) : 'Filters in use'
        });
        const end = many(c.end);
        if (c.apart && c.apart.nodeType === 1) end.push(el('span', { class: 'kit-list-toolbar__apart' }, [c.apart]));
        const root = el('div', { class: 'kit-list-toolbar' }, [
            el('div', { class: 'kit-list-toolbar__start' }, many(c.start).concat([tags])),
            el('div', { class: 'kit-list-toolbar__end' }, end)
        ]);
        function setTags(list) {
            const kids = many(list);
            tags.replaceChildren.apply(tags, kids);
            tags.hidden = !kids.length;
        }
        setTags(c.tags);
        return { el: root, setTags: setTags };
    }

    /**
     * Kit.selectionBar({ label, countText, returnFocus, announce })
     *   -> { el, show(count, actions), busy(text), hide() }
     *
     * The bar that appears while rows are ticked (pick bars__selection-bar,
     * "Financials floating bar"; .ftx-dock and .ftx-bulk, css/financials-
     * transactions.css:865-930 and js/financials/view-transactions.js:2773,
     * which are unchanged): a raised island centred at the foot of the list,
     * 52px tall, that rises into view. How many are ticked, then the
     * actions, each the kit's everyday button.
     *   label      the region's name ('Selected transactions')
     *   countText  (n) -> the words for n ticked (default '5 selected')
     *   returnFocus where focus goes when the bar goes while focus is in it
     *              (default: the element the bar sits in)
     *   announce   false to write the count at once, with no pause for a
     *              screen reader (a page drawn with rows already ticked,
     *              which is not news)
     * `el` is the dock: mount it once at the foot of the list's scroll area.
     * It is sticky and takes no height, so ticking a row never moves the
     * list. show(n, [{ key, label, onClick }]) puts the island up with n and
     * its actions (leave out one that cannot apply, as Categorize with no
     * bookable row); focus on an action stays on it when the actions are
     * drawn again. busy('Booking 2 of 5…') is the island shrunk to its words
     * while the work runs; hide() takes it away.
     * The island is a region with its name, and the count is a polite live
     * status, so a screen reader hears "3 selected" as it changes. Escape
     * does nothing here, as in the source.
     */
    function selectionBar(o) {
        const c = o || {};
        const count = el('span', { class: 'kit-selection-bar__count', role: 'status' });
        const acts = el('div', { class: 'kit-selection-bar__acts' });
        const box = el(
            'div',
            {
                class: 'kit-selection-bar__box',
                role: 'region',
                'aria-label': hasText(c.label) ? String(c.label) : 'Selected rows'
            },
            [count, acts]
        );
        box.hidden = true;
        const root = el('div', { class: 'kit-selection-bar' }, [box]);
        const words = (n) =>
            typeof c.countText === 'function'
                ? String(c.countText(n))
                : Number(n).toLocaleString('en-US') + ' selected';
        let pending = null;

        // A status that has just come into view is often not read, so the
        // words go in a moment after the island does (as Kit.notify's do);
        // a change while it is up is written at once, and so is every one
        // with announce: false.
        function say(text) {
            clearTimeout(pending);
            pending = null;
            if (box.hidden && c.announce !== false) {
                box.hidden = false;
                count.textContent = '';
                pending = setTimeout(() => {
                    pending = null;
                    count.textContent = text;
                }, 0);
            } else {
                box.hidden = false;
                count.textContent = text;
            }
        }

        function drawActions(list) {
            const had = document.activeElement;
            const wasIn = !!had && acts.contains(had);
            const key = wasIn ? had.getAttribute('data-key') : null;
            const buttons = listOf(list, 'selectionBar', 'actions').map((a) => {
                const b = el('button', {
                    class: 'kit-everyday',
                    type: 'button',
                    'data-key': a.key == null ? null : String(a.key),
                    text: String(a.label == null ? '' : a.label)
                });
                if (typeof a.onClick === 'function') b.addEventListener('click', (e) => a.onClick(e));
                return b;
            });
            acts.replaceChildren.apply(acts, buttons);
            acts.hidden = !buttons.length;
            // Focus that was on an action stays in the bar: on the same
            // action, or the first one when it is gone or had no key, and
            // with no actions left it goes to the page, never to nothing.
            if (!wasIn) return;
            const again = (key != null && buttons.filter((b) => b.getAttribute('data-key') === key)[0]) || buttons[0];
            if (again) again.focus();
            else handBackFocus(true, root, c.returnFocus);
        }

        return {
            el: root,
            show(n, list) {
                box.removeAttribute('aria-busy');
                drawActions(list);
                say(words(n));
            },
            busy(text) {
                const had = box.contains(document.activeElement);
                box.setAttribute('aria-busy', 'true');
                acts.replaceChildren();
                acts.hidden = true;
                say(hasText(text) ? String(text) : 'Working…');
                if (had) handBackFocus(true, root, c.returnFocus);
            },
            hide() {
                clearTimeout(pending);
                pending = null;
                const had = box.contains(document.activeElement);
                box.hidden = true;
                box.removeAttribute('aria-busy');
                count.textContent = '';
                acts.replaceChildren();
                handBackFocus(had, root, c.returnFocus);
            }
        };
    }

    /**
     * Kit.undo({ label, timeout, returnFocus }) -> { el, offer(text, onUndo), clear() }
     *
     * A sentence and its Undo, after something was removed or replaced
     * (pick bars__undo, "Sentence with a red Undo"; Settings > Quiet time,
     * .qt-undo and .qt-textbtn, js/settings/quiet-time.js:1359-1463 and
     * css/settings/settings-alerts.css:47-79, :725-739, which are unchanged):
     * 'Cleared your quiet hours.' in the grey, then Undo in the accent, a
     * word button that takes a faint accent tint under the pointer. It is
     * not Kit.notify's action: that one is the quiet grey button.
     *   label    the button's words (default 'Undo')
     *   timeout  ms the offer stays (default 8s, as the source); 0 keeps it.
     *            It waits while the pointer is on it or focus is on Undo.
     *   returnFocus where focus goes when Undo is pressed and goes away
     *            (default: the element the sentence sits in)
     * Mount `el` once, where the sentence goes (it takes no room while there
     * is nothing to undo), and call offer(text, onUndo) after each change
     * that can be undone; a new offer replaces the last. `el` is a polite
     * live region, so the sentence and its Undo are read out as they come.
     * Pressing Undo calls onUndo bare. When it hands back nothing, or a
     * promise that resolves, the offer goes.
     * ⛔ AN UNDO THAT FAILED IS NEVER CLEARED AS IF IT WORKED. While its
     * promise runs the sentence says "Undoing…" and the button waits
     * (aria-disabled); when onUndo throws or its promise rejects, the
     * sentence says "Could not undo that." and the button reads "Try again",
     * which calls onUndo once more. That stays until a new offer or clear().
     */
    function undo(o) {
        const c = o || {};
        const root = el('span', { class: 'kit-undo', role: 'status' });
        const text = el('span', { class: 'kit-undo__text' });
        const btn = el('button', {
            class: 'kit-undo__btn',
            type: 'button',
            text: hasText(c.label) ? String(c.label) : 'Undo'
        });
        const stays = typeof c.timeout === 'number' && c.timeout >= 0 ? c.timeout : 8000;
        const label = hasText(c.label) ? String(c.label) : 'Undo';
        let onUndo = null;
        let timer = null;
        let due = false;
        let pointerOn = false;
        // Bumped by every offer and clear, so an undo still running when a
        // new offer comes cannot write over it when it settles.
        let turn = 0;
        let working = false;

        function clear() {
            turn++;
            clearTimeout(timer);
            timer = null;
            due = false;
            onUndo = null;
            working = false;
            btn.removeAttribute('aria-disabled');
            btn.textContent = label;
            root.replaceChildren();
        }
        // Run out, unless someone is on it: then it goes once they leave.
        function expire() {
            timer = null;
            if (pointerOn || document.activeElement === btn) due = true;
            else clear();
        }
        function settle() {
            if (due && !pointerOn && document.activeElement !== btn) clear();
        }
        root.addEventListener('mouseenter', () => {
            pointerOn = true;
        });
        root.addEventListener('mouseleave', () => {
            pointerOn = false;
            settle();
        });
        btn.addEventListener('blur', () => setTimeout(settle, 0));
        // It worked: the offer goes, and focus on Undo goes where it should.
        function done(mine) {
            if (mine !== turn) return;
            const had = document.activeElement === btn;
            clear();
            handBackFocus(had, root, c.returnFocus);
        }
        // It did not: the words say so, and the button stays to try again.
        function failed(mine, err) {
            if (mine !== turn) return;
            working = false;
            btn.removeAttribute('aria-disabled');
            text.textContent = 'Could not undo that.';
            btn.textContent = 'Try again';
            if (err) warn('[Kit] undo: ' + ((err && err.message) || String(err)));
        }
        btn.addEventListener('click', () => {
            if (working) return;
            const f = onUndo;
            const mine = turn;
            if (typeof f !== 'function') {
                done(mine);
                return;
            }
            // The offer holds while the undo runs: no time runs out on it.
            clearTimeout(timer);
            timer = null;
            due = false;
            let out;
            try {
                out = f();
            } catch (err) {
                failed(mine, err);
                return;
            }
            if (!out || typeof out.then !== 'function') {
                done(mine);
                return;
            }
            working = true;
            btn.setAttribute('aria-disabled', 'true');
            text.textContent = 'Undoing…';
            Promise.resolve(out).then(
                () => done(mine),
                (err) => failed(mine, err || new Error('the undo did not finish'))
            );
        });

        return {
            el: root,
            offer(words, fn) {
                clear();
                text.textContent = hasText(words) ? String(words) : '';
                onUndo = typeof fn === 'function' ? fn : null;
                root.replaceChildren(text, btn);
                if (stays) timer = setTimeout(expire, stays);
            },
            clear: clear
        };
    }

    /* ---------------------------------------------------------------------
     * Sliders, video players and scrollbars (owner picks, sliders family,
     * 2026-09-29). Loss Prevention's dossier video (video.trk-media,
     * js/argus.js:6868 and css/argus.css:10632-10642) and the page tab row
     * that scrolls sideways with no bar (.crm-tabs, css/argus-crm.css:
     * 1826-1834), which are read and never edited. The seek bar is forms.js's
     * (Kit.slider); the quiet scrollbar is a class alone (kit-scrollbar).
     * ------------------------------------------------------------------- */

    // A video to play: https, a path on this site, or a blob the page made
    // (a clip it fetched or recorded itself); nothing else.
    function videoUrl(v) {
        const s = typeof v === 'string' ? v.trim() : '';
        return /^(?:https:\/\/|blob:|\/(?!\/))/i.test(s) ? s : null;
    }

    /**
     * Kit.videoPlayer({ src, poster, label, emptyText }) -> <div>
     *
     * A video the browser plays with its own controls, in the kit's frame
     * (pick sliders__video-player, "Chrome player (dossier)"): the full width
     * up to 420px tall, the whole picture shown on the sunken ground, with a
     * thin line and 12px corners, the frame the dossier's evidence still has.
     *   src        the video: https, a path on this site, or a blob: URL
     *   poster     a picture shown before it plays (https, a path on this
     *              site or an image data URL)
     *   label      what it is, for a screen reader ('Evidence video')
     *   emptyText  the words when it cannot play (default 'This video could
     *              not be played')
     * The controls, the time and the menu are the browser's own and look as
     * the browser draws them. A video that fails to load, or none at all, is
     * the same frame with the words in it: the box stays, only what is in it
     * changes, whether or not it is on the page yet.
     */
    function videoPlayer(o) {
        const c = o || {};
        const root = el('div', { class: 'kit-video-player' });
        const words = hasText(c.emptyText) ? String(c.emptyText) : 'This video could not be played';
        const gone = () => {
            root.classList.add('is-empty');
            root.replaceChildren(el('p', { class: 'kit-video-player__gone', text: words }));
        };
        const src = videoUrl(c.src);
        if (!src) {
            gone();
            return root;
        }
        const video = el('video', {
            class: 'kit-video-player__video',
            controls: '',
            preload: 'metadata',
            poster: pictureUrl(c.poster),
            'aria-label': hasText(c.label) ? String(c.label) : null
        });
        // Listening before the source is set, so an error that comes before
        // the video is on the page is heard too.
        video.addEventListener('error', gone);
        video.setAttribute('src', src);
        root.appendChild(video);
        return root;
    }

    // What the keyboard can land on inside a row.
    const REACHABLE =
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

    /**
     * Kit.sidewaysScroll({ label, items }) -> <div>
     *
     * A row that scrolls sideways under a trackpad, a wheel or a finger and
     * shows no bar (pick sliders__sideways-scroll, "Hidden bar"; the page tab
     * row and the Dashboard's app carousel, css/argus-crm.css:1826-1834 and
     * css/dashboard.css:353-367). Past the edge the row is simply cut off,
     * with no fade and no arrow, as the source's is.
     *   label  what the row holds ('Categories'): its name when it takes focus
     *   items  the row's contents, in order (nodes, or words)
     * A row that runs past its edge with nothing in it the keyboard can reach
     * takes focus itself, a region named by label, so the arrow keys scroll
     * it and the kit's ring shows where the keyboard is. A row that fits has
     * nothing to scroll and takes no Tab stop; nor does a row of buttons or
     * links, since Tab reaches each one and the browser scrolls the row to
     * show it. It decides again whenever its size changes (a ResizeObserver,
     * let go once the row leaves the page) and after el.kitSync(), which a
     * page calls after changing what is in it or putting it back on the page.
     */
    function sidewaysScroll(o) {
        const c = o || {};
        const root = el('div', { class: 'kit-sideways-scroll' });
        listOf(c.items, 'Kit.sidewaysScroll', 'items').forEach((n) => {
            root.appendChild(typeof n === 'string' ? el('span', { text: n }) : n);
        });
        const label = hasText(c.label) ? String(c.label) : 'Scrolling row';
        const Watch = typeof window.ResizeObserver === 'function' ? window.ResizeObserver : null;
        let watcher = null;
        let seen = false;
        function decide() {
            // Without a ResizeObserver there is no telling when it overflows,
            // so it stays reachable rather than risk a row nobody can scroll.
            const runsOver = Watch ? root.scrollWidth > root.clientWidth : true;
            if (runsOver && !root.querySelector(REACHABLE)) {
                root.setAttribute('tabindex', '0');
                root.setAttribute('role', 'region');
                root.setAttribute('aria-label', label);
            } else {
                ['tabindex', 'role', 'aria-label'].forEach((a) => root.removeAttribute(a));
            }
        }
        function watch() {
            if (!Watch || watcher) return;
            seen = root.isConnected;
            watcher = new Watch(() => {
                if (root.isConnected) {
                    seen = true;
                    decide();
                } else if (seen) {
                    // It left the page: stop watching it.
                    watcher.disconnect();
                    watcher = null;
                }
            });
            watcher.observe(root);
        }
        root.kitSync = function () {
            decide();
            watch();
        };
        root.kitSync();
        return root;
    }

    Kit.head = head;
    Kit.tabs = tabs;
    Kit.kpi = kpi;
    Kit.block = block;
    Kit.toolbar = toolbar;
    Kit.searchBox = searchBox;
    Kit.segs = segs;
    Kit.table = table;
    Kit.unknownCell = unknownCell;
    Kit.list = list;
    Kit.pill = pill;
    Kit.count = count;
    Kit.roleChip = roleChip;
    Kit.prio = prio;
    Kit.period = period;
    Kit.pager = pager;
    Kit.loadMore = loadMore;
    Kit.sparkline = sparkline;
    Kit.inlineSwitch = inlineSwitch;
    Kit.mainTabs = mainTabs;
    Kit.sideTabs = sideTabs;
    Kit.subTabs = subTabs;
    Kit.numberBadge = numberBadge;
    Kit.overlayLabel = overlayLabel;
    Kit.plainTag = plainTag;
    Kit.lineTable = lineTable;
    Kit.figureRow = figureRow;
    Kit.hoverTip = hoverTip;
    Kit.plainFigure = plainFigure;
    Kit.statusFigure = statusFigure;
    Kit.couldNotLoad = couldNotLoad;
    Kit.goodNews = goodNews;
    Kit.notice = notice;
    Kit.loadingPlaceholder = loadingPlaceholder;
    Kit.missingFigure = missingFigure;
    Kit.notify = notify;
    Kit.openingScreen = openingScreen;
    Kit.standaloneMark = standaloneMark;
    Kit.logoLockup = logoLockup;
    Kit.statusDot = statusDot;
    Kit.progressBar = progressBar;
    Kit.workingSign = workingSign;
    Kit.backLink = backLink;
    Kit.sectionMenu = sectionMenu;
    Kit.titleHead = titleHead;
    Kit.sectionHeading = sectionHeading;
    Kit.clickBox = clickBox;
    Kit.details = details;
    Kit.listBox = listBox;
    Kit.numberBox = numberBox;
    Kit.sectionBox = sectionBox;
    Kit.personPicture = personPicture;
    Kit.profilePhoto = profilePhoto;
    Kit.logoItemSquare = logoItemSquare;
    Kit.cameraView = cameraView;
    Kit.clipThumb = clipThumb;
    Kit.largeStill = largeStill;
    Kit.copyBox = copyBox;
    Kit.copyIcon = copyIcon;
    Kit.foldOpen = foldOpen;
    Kit.showMore = showMore;
    Kit.historyList = historyList;
    Kit.keyHint = keyHint;
    Kit.keyHints = keyHints;
    Kit.fileDrop = fileDrop;
    Kit.photoPicker = photoPicker;
    Kit.listToolbar = listToolbar;
    Kit.selectionBar = selectionBar;
    Kit.undo = undo;
    Kit.videoPlayer = videoPlayer;
    Kit.sidewaysScroll = sidewaysScroll;
    // ⛭ EXPORTED SO forms.js DOES NOT WRITE A SECOND ONE. `options` on a select
    // and `actions` on a modal are data slots exactly as `rows` is, and the
    // three have to agree about what an accidental API envelope does: warn,
    // name the factory and the shape, and render empty. Before this they threw
    // a TypeError from inside `.map`.
    Kit.listOf = listOf;
    // Last, so a run that threw above leaves the guard open for a retry.
    Kit.__components = true;
})();

/* ===========================================================================
 * The portal kit: figures in a sentence, and what they point at.  Kit.ref
 *
 * Owner, 2026-09-27: "when talking in text about ranges or numbers, link them
 * ... like a highlight bold red, to show its the actual range or a variable
 * number, if they click on it maybe it just redirects to where it is and
 * highlights or boxes it quickly".
 *
 *   Kit.ref.text(parts) -> <span class="num-refs">
 *     parts   a string (plain words), or an array of strings and figures:
 *             { text, target?, label? }
 *       text    the figure as it reads ("Aug 29 to Sep 27", "$7,434")
 *       target  what the figure IS on this page: an Element, a CSS selector
 *               or () => Element (the range control for a date range, the
 *               card a number comes from). With one, the figure is a button
 *               that scrolls there and boxes it for 1.2 seconds. Without one
 *               it is bold red and nothing else: a link to nowhere is worse
 *               than no link.
 *       label   the button's name for a screen reader. Default
 *               "Show where <text> comes from".
 *   Kit.ref.fig(text, target?, label?) -> a figure part, for short call sites.
 *   Kit.ref.flash(el)  the box alone.
 *
 * One delegated listener on the document serves every button, so a sentence
 * redrawn a hundred times holds no handlers. The styles are in
 * css/components.css (eager on every page), NOT kit.css: a sentence can sit
 * anywhere, and kit.css may only style inside a `.kit` root.
 *
 * ⛔ MOTION. The scroll is smooth and the box fades out, unless the viewer
 *    asked for less motion (Kit.motion's rule when motion.js is loaded, the
 *    media query otherwise): then the jump is instant and the box stands
 *    still for the same 1.2 seconds.
 * =========================================================================== */
(function () {
    'use strict';

    const Kit = window.Kit;
    if (!Kit || Kit.__ref) return;

    const FLASH_MS = 1200;
    const targets = new WeakMap();
    const flashing = new WeakMap();

    function reduced() {
        if (Kit.motion && typeof Kit.motion.canMove === 'function') return !Kit.motion.canMove();
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
            return false;
        }
    }

    function fig(text, target, label) {
        return { text: text, target: target, label: label };
    }

    function resolve(target) {
        let node = null;
        try {
            if (typeof target === 'function') node = target();
            else if (typeof target === 'string') node = document.querySelector(target);
            else node = target;
        } catch (e) {
            node = null;
        }
        return node && node.nodeType === 1 && node.isConnected ? node : null;
    }

    function flash(node) {
        if (!node || node.nodeType !== 1) return;
        const still = reduced();
        clearTimeout(flashing.get(node));
        node.classList.remove('num-ref-flash', 'num-ref-flash--still');
        // Read layout so the animation starts again on a second click.
        node.getBoundingClientRect();
        node.classList.add('num-ref-flash');
        if (still) node.classList.add('num-ref-flash--still');
        flashing.set(
            node,
            setTimeout(() => {
                node.classList.remove('num-ref-flash', 'num-ref-flash--still');
                flashing.delete(node);
            }, FLASH_MS)
        );
    }

    function go(btn) {
        const node = resolve(targets.get(btn));
        if (!node) return;
        if (typeof node.scrollIntoView === 'function') {
            node.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
        }
        flash(node);
    }

    let listening = false;
    function listen() {
        if (listening) return;
        listening = true;
        document.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('button.num-ref') : null;
            if (!btn || !targets.has(btn)) return;
            e.preventDefault();
            go(btn);
        });
    }

    function part(p) {
        if (p === null || p === undefined || p === false) return null;
        if (typeof p === 'string' || typeof p === 'number') return document.createTextNode(String(p));
        if (p.nodeType) return p;
        const text = String(p.text === undefined || p.text === null ? '' : p.text);
        if (p.target) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'num-ref';
            btn.textContent = text;
            btn.setAttribute('aria-label', p.label || 'Show where ' + text + ' comes from');
            targets.set(btn, p.target);
            listen();
            return btn;
        }
        const b = document.createElement('b');
        b.className = 'num-ref num-ref--plain';
        b.textContent = text;
        return b;
    }

    function text(parts) {
        const span = document.createElement('span');
        span.className = 'num-refs';
        (Array.isArray(parts) ? parts : [parts]).forEach((p) => {
            const n = part(p);
            if (n) span.appendChild(n);
        });
        return span;
    }

    /** Plain words for a parts list: what a title attribute or a CSV gets. */
    function plain(parts) {
        return (Array.isArray(parts) ? parts : [parts])
            .map((p) =>
                p === null || p === undefined || p === false
                    ? ''
                    : typeof p === 'string' || typeof p === 'number'
                      ? String(p)
                      : p.nodeType
                        ? p.textContent
                        : String(p.text || '')
            )
            .join('');
    }

    Kit.ref = { text: text, fig: fig, flash: flash, plain: plain, FLASH_MS: FLASH_MS };
    Kit.__ref = true;
})();
