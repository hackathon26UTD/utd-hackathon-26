// apps/portal-frontend/js/system/rail.js — the navigation rail, rebuilt
//
// ⛔⛔ THIS REPLACES `.nav-sidebar`. IT DOES NOT RESTYLE IT.
//
// Restyling was tried first and lost. shell-theme.css aims ~900 `!important`
// declarations at `.nav-sidebar` / `.nav-item` / `.nav-item-bubble` across five
// rewrites of the same chrome; forcing `display:flex` onto the grid item
// collapsed the rail to 30px because its width came from a rule three sections
// away. New markup means none of those selectors match, so none of them have to
// be understood or unpicked.
//
// ⛔⛔ THE COST OF REPLACEMENT, AND IT HAS BITTEN HERE BEFORE: a feature gate
// written as a CSS selector against the OLD classes ALSO stops applying.
// `css/shell-theme.css` hides the Apps row with
//   body:not(.feature-apps-tab) .nav-item[data-feature='apps-tab']
// which names `.nav-item`. This file emits `.axr__row`, so that gate is carried
// in JS below — see `feature` in DESTINATIONS. Dropping it ships an unreleased
// module to every tenant.
//
// ⛔ IIFE-WRAPPED. The portal loads classic <script> tags, so a top-level
// function becomes a global, and portal-global-collisions.contract does not
// scan js/system/.
(function () {
    'use strict';

    /**
     * ⛔ IDS ARE THE `data-page` VALUES THE ROUTER ALREADY USES. They are the
     * routing unit; labels drift, ids do not. Read off the live DOM on
     * 2026-09-02 rather than from index.html, because the order and the set had
     * both moved since — `documents` is newer than the spec that preceded this.
     *
     * ⛔ THE ORDER IS THE SHIPPED ORDER. The groups were chosen to fit it, not
     * the other way round: reordering what a customer already knows is a
     * product decision, and this change is a restyle.
     */
    const GROUPS = [
        {
            label: null, // the two cross-cutting rows carry no heading
            rows: [
                // Review is the landing (owner 2026-09-26): the page id stays
                // `home`. The Dashboard is the KPI wall, second.
                { id: 'home', label: 'Review', icon: 'review' },
                { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }
            ]
        },
        {
            label: 'Stores',
            rows: [
                { id: 'argus', label: 'Operations', icon: 'argus' },
                { id: 'liveview', label: 'Live View', icon: 'liveview' }
                // "All stores" (2026-09-18) lived here for one day. HQ mode
                // (2026-09-19, spec §1a) is its own shell with its own rail;
                // the head-office org is the mode, reached from the store
                // switcher, so the store rail carries no enterprise row.
            ]
        },
        {
            label: 'Run the business',
            rows: [
                { id: 'hermes', label: 'Inventory', icon: 'hermes' },
                { id: 'lyra', label: 'Calls', icon: 'lyra' },
                { id: 'cash', label: 'Financials', icon: 'cash' },
                { id: 'documents', label: 'Documents', icon: 'documents' },
                { id: 'labor', label: 'Employees', icon: 'labor' }
            ]
        },
        {
            label: 'Plan',
            rows: [
                { id: 'forecast', label: 'Forecast', icon: 'forecast' },
                // ⛔⛔ GATED — see the header. The legacy CSS gate names
                // `.nav-item`, which this file does not emit.
                { id: 'apps', label: 'Apps', icon: 'apps', feature: 'apps-tab' }
            ]
        }
    ];

    /** Actions, not destinations: no data-page, never "current". */
    const ACTIONS = [
        { id: 'feedback', label: 'Feedback', icon: 'feedback' },
        // ⛔ TWO STRINGS ON PURPOSE. `label` is what the user READS and it is
        // what SIZES THE RAIL — rail.css derives --axr-w from the widest
        // label, and this row used to be that label at 103.31px against 70.88
        // for the widest destination, so 32px of the rail existed for this one
        // control. `ariaLabel` keeps the explicit phrase for screen readers AND
        // for the hover banner (showTip reads aria-label), which is the one
        // place a first-time user on a collapsed rail needs the long form.
        { id: 'collapse', label: 'Collapse', ariaLabel: 'Close navigation', icon: 'collapse' },
        { id: 'signout', label: 'Sign out', icon: 'signout' }
    ];

    /**
     * ⛔ EVERY GLYPH DECLARES `xmlns`. Without it, DOMParser(…, 'image/svg+xml')
     * produces elements NAMED "svg" and "path" whose namespaceURI is null —
     * unknown HTML elements that carry every attribute and DRAW NOTHING. That
     * shipped once: measured in Chrome at 0px wide with computed stroke `none`,
     * while `querySelector('svg')` happily matched and every test stayed green.
     */
    function glyph(body) {
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" class="axr__glyph" viewBox="0 0 24 24" ' +
            'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            body +
            '</svg>'
        );
    }

    // ⛭ Lifted from the shipped nav, not redrawn. A familiar icon that changes
    // shape costs recognition for nothing; only the stroke weight moved (2 →
    // 1.6) because this panel is lighter than the rail it replaces.
    const ICONS = {
        enterprise: glyph(
            '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
        ),
        home: glyph(
            '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'
        ),
        review: glyph(
            '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'
        ),
        dashboard: glyph(
            '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'
        ),
        argus: glyph('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
        liveview: glyph(
            '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="3"/>'
        ),
        hermes: glyph(
            '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
        ),
        lyra: glyph(
            '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
        ),
        cash: glyph(
            '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
        ),
        documents: glyph('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        labor: glyph(
            '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
        ),
        forecast: glyph('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
        apps: glyph(
            '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
        ),
        feedback: glyph(
            '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'
        ),
        collapse: glyph('<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>'),
        // The mirror of `collapse`. Both exist because on a collapsed rail the
        // label is hidden and the chevron is the whole affordance.
        expand: glyph('<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>'),
        signout: glyph(
            '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
        )
    };

    /** Parsed, never assigned as markup, and only ever from the map above. */
    function iconNode(name) {
        const src = ICONS[name];
        if (!src) return null;
        const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
        const svg = doc.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
        return document.importNode(svg, true);
    }

    const COLLAPSE_KEY = 'axr_collapsed';

    /**
     * ⛔ THE DEFAULT IS EXPANDED, and `!== 'true'` is what makes that true for
     * someone who has never chosen. Only an explicit collapse persists.
     */
    function isCollapsed() {
        try {
            return localStorage.getItem(COLLAPSE_KEY) === 'true';
        } catch (_e) {
            return false; // private browsing — same as never having chosen
        }
    }

    /* ── The collapsed rail's name banner ───────────────────────────────────
     *
     * ⛔ THIS CANNOT BE A PSEUDO-ELEMENT, which is how the shipped rail did it
     * (`.nav-sidebar:not(.expanded) .nav-item::after`). `.axr` is `overflow:
     * hidden` and `.axr__scroll` is `overflow-y: auto`, so anything drawn past
     * the panel's right edge is CLIPPED — and `overflow-x: visible` alongside
     * `overflow-y: auto` computes to `auto`, so there is no way to open just the
     * one axis. The banner has to leave the panel entirely.
     *
     * ⛔ AND `title` IS NOT THE FEATURE. The rows already set one, which is why
     * this looked handled: the OS tooltip waits about a second, renders in the
     * platform's own style, and appears at the CURSOR rather than beside the
     * icon. Owner 2026-09-03: "a banner should pop up next to it that says what
     * the icon is, this is in the existing UI already" — the existing UI is the
     * styled one, and the v7 rail dropped it.
     *
     * One node, reused: a per-row node would be 15 elements in the body that
     * exist only to be hidden. */
    let _tip = null;

    function tipNode() {
        if (_tip && _tip.isConnected) return _tip;
        _tip = document.createElement('div');
        _tip.className = 'axr-tip';
        _tip.setAttribute('role', 'presentation');
        document.body.appendChild(_tip);
        return _tip;
    }

    function hideTip() {
        if (_tip) _tip.classList.remove('axr-tip--on');
    }

    // Registered once for the module, not per row: a resize moves every anchor
    // at the same time, and 15 listeners would all do the same one thing.
    window.addEventListener('resize', hideTip, { passive: true });

    function showTip(rowEl) {
        // Expanded rows carry their own words; a banner would just repeat them.
        if (!rowEl.closest('.axr--collapsed')) return hideTip();
        const tip = tipNode();
        // ⛔ READ THE LIVE NAME, do not close over the one build() saw. The
        // collapse row rewrites its own aria-label on every toggle ("Open
        // navigation" ↔ "Close navigation"), and a captured copy would keep
        // announcing the state you just left.
        tip.textContent = rowEl.getAttribute('aria-label') || '';
        const r = rowEl.getBoundingClientRect();
        // Measure before placing: the banner is nowrap, so its width is only
        // known once the text is in it.
        tip.classList.add('axr-tip--on');
        const h = tip.getBoundingClientRect().height;
        tip.style.left = `${Math.round(r.right + 8)}px`;
        // Clamp so a row at the very bottom of a tall rail cannot push the
        // banner off-screen.
        const top = Math.min(
            Math.max(4, Math.round(r.top + r.height / 2 - h / 2)),
            Math.max(4, window.innerHeight - h - 4)
        );
        tip.style.top = `${top}px`;
    }

    function row(item, opts) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'axr__row';
        if (item.id) el.dataset.page = item.id;
        // ⛔ The row keeps its NAME when the label is hidden. `display:none`
        // removes the label from the accessibility tree, and every row would
        // become an unnamed button while the rail still looked correct.
        el.setAttribute('aria-label', item.ariaLabel || item.label);
        // ⛔ NO `title`. It would double up with the banner below — the OS one
        // arrives a second later, in a second place, saying the same word. The
        // accessible name is carried by aria-label either way.
        if (opts && opts.current) el.setAttribute('aria-current', 'page');

        // Focus as well as hover, so the banner is reachable from the keyboard —
        // on a collapsed rail it is the only visible name a row has.
        el.addEventListener('pointerenter', () => showTip(el));
        el.addEventListener('focus', () => showTip(el));
        el.addEventListener('pointerleave', hideTip);
        el.addEventListener('blur', hideTip);
        el.addEventListener('click', hideTip);

        const slot = document.createElement('span');
        slot.className = 'axr__icon';
        const g = iconNode(item.icon);
        if (g) slot.appendChild(g);
        el.appendChild(slot);

        const t = document.createElement('span');
        t.className = 'axr__label';
        t.textContent = item.label;
        el.appendChild(t);

        if (opts && opts.onClick) el.addEventListener('click', opts.onClick);
        return el;
    }

    /**
     * The branches (owner, 2026-09-18, on the reference dashboard: "loved the
     * sidebar branches look it has where the sub tabs are connected to lines").
     *
     * ⛔ THIS REVERSES 2026-08-12 ("we are getting rid of the sub tabs on the
     * sidebar"), and the two reasons that ruling gave are still real, so both
     * are designed out rather than ignored:
     *   1. Collapsed, the old sub-nav rendered as a stack of unlabelled dots.
     *      The branch is hidden entirely when the rail is collapsed — there is
     *      no dot state.
     *   2. It duplicated the in-page tab row and the two drifted. The branch
     *      is not a list this file owns: `state.branches(pageId)` hands back
     *      the module's OWN section list (InventoryShell.sections() and its
     *      siblings), so there is one list, read twice.
     *
     * Only the CURRENT page grows a branch. Eight Inventory rows plus ten
     * Employees rows permanently open would turn a 157px rail into a wall; the
     * reference expands exactly the section you are in.
     *
     * Twigs carry `aria-current="true"`, never "page" — the page is the row.
     * rail.contract.test.js counts `[aria-current="page"]` and expects one.
     */
    function branch(pageId, s) {
        const items = (s.branches && s.branches(pageId)) || [];
        if (!items.length) return null;
        const ul = document.createElement('ul');
        ul.className = 'axr__branch';
        ul.setAttribute('role', 'list');
        ul.dataset.for = pageId;
        for (const it of items) {
            if (!it || !it.id) continue;
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'axr__twig';
            b.dataset.section = it.id;
            b.textContent = it.label || it.id;
            if (s.section === it.id) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', () => s.onSection && s.onSection(pageId, it.id));
            li.appendChild(b);
            ul.appendChild(li);
        }
        return ul;
    }
    /**
     * Re-hang the branch under whichever row is current now. Called by the
     * chrome on every route change and on every `<module>:section-changed`,
     * instead of rebuilding the rail — a rebuild would restart the three-beat
     * width animation mid-flight.
     */
    function syncBranch(el, state) {
        if (!el) return;
        const s = state || {};
        el.querySelectorAll('.axr__branch').forEach((n) => n.remove());
        if (!s.current) return;
        const row = el.querySelector('.axr__scroll .axr__row[data-page="' + s.current + '"]');
        if (!row) return;
        const ul = branch(s.current, s);
        if (ul) row.insertAdjacentElement('afterend', ul);
    }
    /**
     * `features` decides which gated rows appear. The caller supplies it, so
     * this file does not care where the truth comes from — today that is the
     * body class applyFeatureFlags() sets from localStorage.
     */
    function build(state) {
        const s = state || {};
        const features = s.features || {};
        const el = document.createElement('nav');
        el.className = 'axr' + (isCollapsed() ? ' axr--collapsed' : '');
        el.setAttribute('aria-label', 'Main navigation');

        // ⛔ NO BRAND HEAD HERE. The Argus lockup lives in the TOP BAR
        // (js/system/topbar.js), which is where the approved design put it.
        // The rail carried one briefly and it read as two logos on one screen;
        // a test asserts the rail emits no <img> so it cannot come back.

        const scroll = document.createElement('div');
        scroll.className = 'axr__scroll';
        for (const g of GROUPS) {
            const rows = g.rows.filter((r) => !r.feature || features[r.feature]);
            if (!rows.length) continue;
            const box = document.createElement('div');
            box.className = 'axr__group';
            if (g.label) {
                const h = document.createElement('div');
                h.className = 'axr__grouplabel';
                h.textContent = g.label;
                box.appendChild(h);
            }
            for (const r of rows) {
                const isCurrent = s.current === r.id;
                box.appendChild(
                    row(r, {
                        current: isCurrent,
                        onClick: () => s.onNavigate && s.onNavigate(r.id)
                    })
                );
                if (isCurrent) {
                    const ul = branch(r.id, s);
                    if (ul) box.appendChild(ul);
                }
            }
            scroll.appendChild(box);
        }
        // A banner is positioned against a rect that scrolling and resizing both
        // invalidate. Cheaper and steadier to drop it than to chase the row.
        scroll.addEventListener('scroll', hideTip, { passive: true });
        el.appendChild(scroll);

        const foot = document.createElement('div');
        foot.className = 'axr__foot';
        for (const a of ACTIONS) {
            foot.appendChild(row(a, { onClick: () => s.onAction && s.onAction(a.id) }));
        }
        el.appendChild(foot);

        return el;
    }

    function setCollapsed(el, next) {
        try {
            localStorage.setItem(COLLAPSE_KEY, String(next));
        } catch (_e) {
            /* private browsing — session-only */
        }
        el.classList.toggle('axr--collapsed', next);
        const btn = el.querySelector('.axr__foot .axr__row[data-page="collapse"]');
        if (!btn) return;

        // ⛔ THE WORD AND THE NAME ARE NOT THE SAME STRING ANY MORE. The visible
        // word is short because it sizes the panel; the accessible name stays the
        // explicit phrase. Setting one from the other — which is what this did —
        // silently puts 103px of copy back into a 157px rail.
        const label = next ? 'Expand' : 'Collapse';
        const aria = next ? 'Open navigation' : 'Close navigation';
        btn.setAttribute('aria-label', aria);
        btn.querySelector('.axr__label').textContent = label;
        // The banner reads aria-label live, so it needs no update here — but it
        // is pointing at a row that just changed meaning, so take it down.
        hideTip();

        // ⛔ THE ARROW HAS TO TURN ROUND TOO. Updating only the words left a
        // chevron pointing LEFT on a collapsed rail — the one state where the
        // label is hidden, so the glyph is the entire affordance and it was
        // pointing at "close" while meaning "open". Caught in a browser; no test
        // that reads the markup would have noticed, because both spellings are
        // valid markup.
        const slot = btn.querySelector('.axr__icon');
        const g = iconNode(next ? 'expand' : 'collapse');
        if (slot && g) slot.replaceChildren(g);
    }

    window.AxRail = { build, syncBranch, ICONS, GROUPS, ACTIONS, isCollapsed, setCollapsed, COLLAPSE_KEY };
})();
