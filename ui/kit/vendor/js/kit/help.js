/* ===========================================================================
 * The portal kit: the help banner.
 *
 * Kit.helpBanner({ title, chip, body, action, doors })     builds one, puts it nowhere
 * Kit.helpBanner.into(host, opts, where?)                  puts one IN host, replacing
 *                                                          the one there (never two)
 * Kit.helpBanner.slot(scope)                               the same, with claims for a
 *                                                          slow load (see "One banner
 *                                                          per place" below)
 *
 * The Documents page's explainer, made reusable (owner, 2026-09-22: "love the
 * type of help section documents has and the items it has on the right, seems
 * professional and helps"):
 *
 *   ✦ Title  [chip]                         ┌──────┐ ┌──────┐ ┌──────┐
 *   One or two sentences on what this       │  ▣   │ │  ▣   │ │  ▣   │
 *   page does for the store.                │ DOOR │ │ DOOR │ │ DOOR │
 *   [ action ]                              └──────┘ └──────┘ └──────┘
 *
 *   title   what the page does, in the owner's words ("Most of this files itself")
 *   chip    a short true qualifier ("no setup"). Optional.
 *   body    one or two sentences. Plain words; no em dashes.
 *   action  { label, icon, onClick }: one button under the words, a quiet
 *           pill like Documents' "Upload a document". Optional. It is never
 *           the filled one: a page's single filled (wine) action lives in its
 *           header, as Documents' "Upload" does.
 *   doors   [{ icon, label, title, onClick }], up to four: the quick ways in,
 *           drawn as white squares on a light plate. A door with no onClick is
 *           a label, not a button (Documents' EMAIL). A door whose handler is
 *           missing is simply left out by the caller: a button that does
 *           nothing is worse than no button.
 *
 * ⛔ THE PLATE IS LIGHT IN BOTH THEMES, as Documents' is: on a dark page the
 *    white plate and its white doors are what make the banner read as a
 *    designed object rather than another grey box. So the plate, the door and
 *    the door's ink are their own tokens, fixed in both token blocks.
 *
 * Styling is css/kit.css under `.kit .kit-help`. No class here contains card,
 * panel, widget, tile, -page or spin (see components.js header): the squares
 * are "doors", not tiles.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__help) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        if (window.console && console.warn) {
            console.warn('[Kit] help: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const el = Kit.el;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const MAX_DOORS = 4;

    // Each icon is a list of [tag, attributes], built with createElementNS and
    // never parsed from a string.
    const ICONS = {
        sparkle: [
            ['path', { d: 'M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z', class: 'is-solid' }]
        ],
        file: [
            ['path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }],
            ['path', { d: 'M14 3v5h5' }]
        ],
        scan: [
            [
                'path',
                {
                    d: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10'
                }
            ]
        ],
        mail: [
            ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
            ['path', { d: 'M3.5 6.5L12 13l8.5-6.5' }]
        ],
        camera: [
            ['rect', { x: '3', y: '7', width: '13', height: '10', rx: '2' }],
            ['path', { d: 'M16 11l5-3v8l-5-3' }]
        ],
        play: [
            ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
            ['path', { d: 'M10 9l5 3-5 3z' }]
        ],
        bell: [['path', { d: 'M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0' }]],
        people: [
            ['circle', { cx: '9', cy: '8', r: '3.2' }],
            [
                'path',
                { d: 'M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M16 5.2a3 3 0 010 5.6M17.5 14.6c1.8.6 2.8 2 3.2 4.4' }
            ]
        ],
        plus: [['path', { d: 'M12 5v14M5 12h14' }]],
        tag: [
            ['path', { d: 'M3.5 12.5V4.5a1 1 0 011-1h8l8 8-9 9z' }],
            ['circle', { cx: '8', cy: '8', r: '1.4' }]
        ],
        dollar: [
            [
                'path',
                {
                    d: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3'
                }
            ]
        ],
        chart: [['path', { d: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6' }]],
        box: [
            ['path', { d: 'M4 8l8-4 8 4v8l-8 4-8-4z' }],
            ['path', { d: 'M4 8l8 4 8-4M12 12v8' }]
        ],
        list: [['path', { d: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01' }]],
        upload: [['path', { d: 'M12 16V4M7 9l5-5 5 5M4 20h16' }]],
        calendar: [
            ['rect', { x: '3.5', y: '5', width: '17', height: '15', rx: '2' }],
            ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }]
        ],
        clock: [
            ['circle', { cx: '12', cy: '12', r: '8' }],
            ['path', { d: 'M12 8v4l3 2' }]
        ],
        badge: [
            ['circle', { cx: '12', cy: '9', r: '5' }],
            ['path', { d: 'M9 13.5L8 21l4-2 4 2-1-7.5' }]
        ],
        phone: [
            ['path', { d: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z' }]
        ],
        gear: [
            ['circle', { cx: '12', cy: '12', r: '3' }],
            [
                'path',
                {
                    d: 'M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4.4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'
                }
            ]
        ]
    };

    function icon(name) {
        const spec = ICONS[name] || ICONS.list;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        spec.forEach((part) => {
            const node = document.createElementNS(SVG_NS, part[0]);
            Object.keys(part[1]).forEach((k) => node.setAttribute(k, part[1][k]));
            svg.appendChild(node);
        });
        return svg;
    }

    function helpBanner(opts) {
        const o = opts || {};
        const root = el('section', { class: 'kit-help' });
        if (o.title) root.setAttribute('aria-label', o.title);

        const body = el('div', { class: 'kit-help__body' });
        const title = el('div', { class: 'kit-help__title' });
        title.appendChild(icon('sparkle'));
        title.appendChild(el('span', { text: o.title || '' }));
        if (o.chip) title.appendChild(el('span', { class: 'kit-help__chip', text: o.chip }));
        body.appendChild(title);
        if (o.body) body.appendChild(el('p', { class: 'kit-help__lead', text: o.body }));

        if (o.action && o.action.label) {
            const acts = el('div', { class: 'kit-help__acts' });
            const btn = el('button', { class: 'kit-btn kit-help__act', type: 'button' });
            if (o.action.icon) btn.appendChild(icon(o.action.icon));
            btn.appendChild(el('span', { text: o.action.label }));
            if (typeof o.action.onClick === 'function') btn.addEventListener('click', o.action.onClick);
            acts.appendChild(btn);
            body.appendChild(acts);
        }
        root.appendChild(body);

        const doors = (Array.isArray(o.doors) ? o.doors : []).filter((d) => d && d.label).slice(0, MAX_DOORS);
        if (doors.length) {
            const plate = el('div', { class: 'kit-help__plate' });
            doors.forEach((d, i) => {
                const go = typeof d.onClick === 'function';
                const door = go
                    ? el('button', {
                          class: 'kit-help__door is-go',
                          type: 'button',
                          // Named, not tooltipped: a browser tooltip is native UI.
                          'aria-label': d.title || d.label
                      })
                    : el('div', { class: 'kit-help__door' });
                door.appendChild(icon(d.icon));
                door.appendChild(el('span', { class: 'kit-help__door-label', text: d.label }));
                if (go) door.addEventListener('click', d.onClick);
                // Its step when the doors pop in (see the motion note below).
                door.style.animationDelay = 320 + i * 70 + 'ms';
                plate.appendChild(door);
            });
            root.appendChild(plate);
        }
        // Motion (Kit.motion.reveal): the first time the banner is seen on a
        // visit it rises in just after the KPI row above it, and its doors pop
        // in one after another. Rebuilt with its page, it does not play again.
        if (Kit.motion && typeof Kit.motion.reveal === 'function') {
            root.style.animationDelay = '200ms';
            Kit.motion.reveal(root, 'help:' + (o.title || ''));
        }
        return root;
    }

    // ── One banner per place ────────────────────────────────────────────────
    //
    // ⛔ A PAGE MUST NOT BE ABLE TO SHOW TWO. The Financials tab shell once
    // appended a banner on every tab switch and trusted its own teardown to
    // take the last one away; a missed removal stacked one more banner per
    // door click (owner, 2026-09-27: "fix that permanently"). So the slot, not
    // each caller, owns the banner:
    //   - show() REPLACES: the old banner goes first, wherever it sits, and
    //     the new one takes its place unless told where;
    //   - a banner some other code left under the scope goes too;
    //   - a claim taken before a slow load is dead once a newer claim or a
    //     clear() happened, and a dead claim's show() puts nothing anywhere.
    //
    // Kit.helpBanner.slot(scope) -> the ONE slot for that element (asking again
    //   returns the same slot):
    //     claim() -> { show(opts, where) -> banner | null, live() -> bool }
    //     show(opts, where)   a fresh claim's show(): the last caller wins
    //     clear()             take the banner away and kill every claim
    //     node()              what is in the page now (the wrapper), or null
    //   where: { parent (default: the scope), before (default: where the old
    //            one stood, else the end), wrap (attributes for a wrapper div
    //            that carries the banner and goes with it) }
    // Kit.helpBanner.into(host, opts, where) = slot(host).show(opts, where)
    const MARK = 'data-kit-help-slot';
    const slots = new WeakMap();

    /** The node to take away for a stray banner: its own wrapper when the
        wrapper holds nothing else, so no empty gap is left behind. */
    function strayShell(banner, scope) {
        let n = banner;
        const up = n.closest ? n.closest('[' + MARK + ']') : null;
        if (up && scope.contains(up) && up !== scope) return up;
        while (
            n.parentElement &&
            n.parentElement !== scope &&
            n.parentElement.childElementCount === 1 &&
            n.parentElement.classList.contains('kit')
        ) {
            n = n.parentElement;
        }
        return n;
    }

    function slot(scope) {
        if (!scope || typeof scope.insertBefore !== 'function') return null;
        const had = slots.get(scope);
        if (had) return had;

        let gen = 0;
        let node = null;

        function drop() {
            if (node && node.parentNode) node.parentNode.removeChild(node);
            node = null;
        }

        function sweep(root, keep) {
            if (!root || typeof root.querySelectorAll !== 'function') return;
            Array.from(root.querySelectorAll('.kit-help')).forEach((b) => {
                if (keep.contains(b)) return;
                const n = strayShell(b, root);
                if (n.parentNode) n.parentNode.removeChild(n);
            });
        }

        function place(opts, where) {
            const w = where || {};
            const parent = w.parent && typeof w.parent.insertBefore === 'function' ? w.parent : scope;
            let before = w.before;
            if (before === undefined) before = node && node.parentNode === parent ? node.nextSibling : null;
            const banner = helpBanner(opts);
            const next = w.wrap ? el('div', w.wrap, [banner]) : banner;
            next.setAttribute(MARK, '');
            drop();
            if (!before || before.parentNode !== parent) before = null;
            parent.insertBefore(next, before);
            node = next;
            sweep(scope, next);
            if (parent !== scope) sweep(parent, next);
            return banner;
        }

        const s = {
            claim() {
                gen += 1;
                const mine = gen;
                return {
                    live: () => mine === gen,
                    show: (opts, where) => (mine === gen ? place(opts, where) : null)
                };
            },
            show: (opts, where) => s.claim().show(opts, where),
            clear() {
                gen += 1;
                drop();
            },
            node: () => node
        };
        slots.set(scope, s);
        return s;
    }

    Kit.helpBanner = helpBanner;
    Kit.helpBanner.slot = slot;
    Kit.helpBanner.into = (host, opts, where) => {
        const s = slot(host);
        return s ? s.show(opts, where) : null;
    };
    Kit.helpBanner._internal = { ICONS: ICONS, MAX_DOORS: MAX_DOORS };
    Kit.__help = true;
})();
