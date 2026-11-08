/* ===========================================================================
 * The portal kit: overlays and form controls.
 *
 * Everything the portal opens over the page or types into. All hand-rolled,
 * because the standing rule is that no native browser control ships:
 *
 *   CLAUDE.md:359-360   (the REPO ROOT one; apps/portal-frontend has no
 *                        CLAUDE.md of its own)
 *     - **No native browser controls.** Use `NexusUI.dropdown/confirm/prompt/alert`
 *       (`js/nexus-ui.js`) — never `<select>`, `confirm()`, `prompt()`, `alert()`.
 *
 * __tests__/kit/native-controls.contract.test.js scans this file (and every
 * module a later PR converts) for all of them, plus `type="date"`,
 * `type="time"`, `type="color"` and `<datalist>`. Quoting the rule verbatim is
 * safe: every scanner over js/kit strips comments before it matches, and the
 * teeth check on that strip is what turns it from an assumption into a fact.
 *
 * Depends on js/kit/core.js for el() and fmt. In the browser the four kit
 * files are plain deferred <script> tags in a fixed order, so the guard at the
 * top is a load-order assertion and not a fallback: if core has not run, this
 * file registers nothing rather than half-registering a broken surface.
 *
 * Styling lives in css/kit.css. Every overlay and popover this file appends to
 * document.body carries `class="kit"` on its root, because it inherits nothing
 * from the module that opened it and the tokens are scoped to `.kit`.
 *
 * Spec: docs/superpowers/specs/2026-09-02-portal-ui-refresh-design.md, 3.3.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__forms) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        // Registering half a namespace is worse than registering none: the
        // caller gets `Kit.modal is not a function` from somewhere deep in a
        // panel instead of one line naming the load order.
        // ⛔ console.warn HERE AND NOWHERE ELSE IN THIS FILE. Kit.warn is core's,
        // and core is exactly what is missing on this branch.
        if (window.console && console.warn) {
            console.warn('[Kit] forms: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const el = Kit.el;

    /**
     * ⛔ ONE SINK, NOT TWO, and it is READ THROUGH A WRAPPER rather than
     * captured once. core.js routes through window.Logger when the portal has
     * one and console.warn otherwise, and exports that as Kit.warn; a caller
     * or a test that swaps Kit.warn for its own function is invisible to a
     * reference captured at load.
     */
    function warn() {
        // ⛭ `arguments`, not one named parameter: core's sink is variadic
        // (core.js:582 forwards to Logger.warn) and every other warning in the
        // kit passes a sentence plus the thing that caused it. A wrapper that
        // took one argument would drop the second half of the first call that
        // needed it, silently.
        const sink = typeof Kit.warn === 'function' ? Kit.warn : null;
        if (sink) sink.apply(null, arguments);
        else if (window.console && console.warn) console.warn.apply(console, arguments);
    }

    /**
     * A data slot: a list, or nothing, said out loud.
     *
     * ⛔ components.js's own listOf, reached through Kit rather than copied, so
     * that `options` on a select, `actions` on a modal and `rows` on a table
     * cannot drift apart about what an accidental API envelope does. Both
     * threw a bare `TypeError: (o.options || []).map is not a function` before
     * this — measured — and feeding a select straight off a house envelope is
     * the first thing a module conversion will do.
     *
     * The local fallback covers a page that somehow loaded an older
     * components.js, the same shape and for the same reason as the warn helper
     * above: forms.js does not otherwise need components, so requiring it would
     * be a load-order claim this file does not have to make.
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

    let uid = 0;
    /** A DOM id nothing else will collide with, for aria-labelledby and label[for]. */
    function nextId(prefix) {
        uid += 1;
        return 'kit-' + prefix + '-' + uid;
    }

    /* -----------------------------------------------------------------------
     * Focus.
     *
     * ⛔ NOT a verbatim port of NexusUI's trap. That one filters candidates on
     * `!el.disabled && el.offsetParent !== null` (js/nexus-ui.js:36), and jsdom
     * returns null from offsetParent for EVERY element, so a trap built that
     * way finds nothing to trap and passes every test about it by doing nothing
     * at all. Disabled, [hidden] and aria-hidden are what that filter was
     * reaching for, and all three are readable without layout.
     * --------------------------------------------------------------------- */
    const FOCUSABLE =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function focusablesIn(root) {
        // The legacy drop-down stays in the query on purpose: the kit never
        // makes one, but a module being converted will put legacy markup inside
        // a kit modal, and a trap that skips it strands a keyboard user.
        return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
            (n) => !n.hasAttribute('hidden') && n.getAttribute('aria-hidden') !== 'true'
        );
    }

    function trapFocus(box) {
        function onKey(e) {
            if (e.key !== 'Tab') return;
            const items = focusablesIn(box);
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        box.addEventListener('keydown', onKey);
        return function () {
            box.removeEventListener('keydown', onKey);
        };
    }

    /* -----------------------------------------------------------------------
     * Body scroll lock.
     *
     * main.js owns a REFERENCE-COUNTED lock (js/main.js:123-135) because two
     * overlays open at once must not let the first one to close restore the
     * page scroll under the second. Use it when it is there. The kit harness
     * and the render tests run without main.js, so keep a counted fallback of
     * our own rather than writing document.body.style.overflow directly and
     * reproducing the bug that counter exists to prevent.
     * --------------------------------------------------------------------- */
    let fallbackLocks = 0;
    let priorOverflow = '';

    function lockScroll() {
        if (typeof window.lockBodyScroll === 'function') {
            window.lockBodyScroll();
            return function () {
                if (typeof window.unlockBodyScroll === 'function') window.unlockBodyScroll();
            };
        }
        if (fallbackLocks === 0) priorOverflow = document.body.style.overflow;
        fallbackLocks += 1;
        document.body.style.overflow = 'hidden';
        return function () {
            fallbackLocks = Math.max(0, fallbackLocks - 1);
            if (fallbackLocks === 0) document.body.style.overflow = priorOverflow;
        };
    }

    /* -----------------------------------------------------------------------
     * Motion.
     * --------------------------------------------------------------------- */
    const EXIT_FALLBACK_MS = 180;
    const DURATION_SHAPE = /^\s*([\d.]+)\s*(m?s)\s*$/;

    /**
     * How long the exit animation lasts, read from the live element so that the
     * reduced-motion block in css/kit.css (which collapses --kit-dur-exit to
     * 1ms) is honoured without this file knowing the media query exists. jsdom
     * loads no stylesheet, so the read comes back empty there and the literal
     * wins.
     */
    function exitMs(node) {
        let raw = '';
        try {
            raw = window.getComputedStyle(node).getPropertyValue('--kit-dur-exit');
        } catch (_e) {
            raw = '';
        }
        const m = DURATION_SHAPE.exec(raw || '');
        if (!m) return EXIT_FALLBACK_MS;
        const n = parseFloat(m[1]);
        if (!isFinite(n)) return EXIT_FALLBACK_MS;
        return m[2] === 's' ? n * 1000 : n;
    }

    /* -----------------------------------------------------------------------
     * Modal and drawer.
     *
     * One builder, two skins: the drawer is right-anchored and full-height and
     * differs from the modal in css/kit.css alone. Both trap focus, close on
     * Escape, hand focus back to whatever opened them, lock the page behind
     * them, and animate out over --kit-dur-exit before the node is removed.
     * --------------------------------------------------------------------- */
    const stack = [];

    /*
     * ⛔ A POP-UP OPENED FROM INSIDE ANOTHER IS PART OF IT. A dropdown or a
     * date picker in a filter pop-out, or the range dialog that pop-out opens,
     * records the pop-up or dialog it opened from as its `parent`. A click, a
     * scroll or a move of focus inside any of those children is inside the
     * parent too, so the parent stays open; closing a child leaves the parent
     * open, and closing a parent (a pop-up or a dialog) closes the POPOVERS
     * opened from it first, which would otherwise float over nothing. A
     * dialog is never closed by its parent: a dialog opened over a dialog
     * stays its own, as it always was. Escape still closes only the topmost
     * one, and Kit.closeAll still closes everything.
     */

    /** Is `d` opened from inside `h`, directly or through others? */
    function descends(d, h) {
        for (let x = d && d.parent; x; x = x.parent) if (x === h) return true;
        return false;
    }

    /** Does `node` sit inside the open `h`, or inside anything opened from it? */
    function holds(h, node) {
        if (!h || !node || typeof node.nodeType !== 'number') return false;
        if (h.el && h.el.contains(node)) return true;
        return stack.some((d) => d !== h && descends(d, h) && d.el && d.el.contains(node));
    }

    /** The innermost open pop-up or dialog `node` sits in, or null. */
    function ownerOf(node) {
        if (!node || typeof node.nodeType !== 'number') return null;
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].el && stack[i].el.contains(node)) return stack[i];
        }
        return null;
    }

    /**
     * Close the popovers opened from inside `h`, innermost first. Every one
     * closes, even when one of them throws (a caller's onClose), and the
     * first throw is handed back for `h` to raise once it has closed itself.
     * ⛔ NEVER SWALLOWED: a close that runs twice returns early by itself, so
     * a catch here could only ever hide a caller's own error.
     */
    function closeChildren(h) {
        let failed = null;
        stack
            .slice()
            .reverse()
            .forEach((d) => {
                if (!d.isPop || !descends(d, h)) return;
                try {
                    d.close(undefined);
                } catch (err) {
                    if (!failed) failed = err;
                }
            });
        return failed;
    }

    function panel(kind, opts) {
        const o = opts || {};
        const base = 'kit-' + kind;
        const opener = document.activeElement;
        // Opened from inside an open pop-up (the range button in a filter
        // pop-out): part of it, so a click in this dialog keeps it open.
        const parent = ownerOf(opener);
        const titleId = nextId(kind + '-title');
        const msgId = nextId(kind + '-msg');

        if (!o.title) {
            // aria-labelledby points at an empty <h2>, so the dialog announces
            // as "dialog" and nothing else. Required, and said so once.
            warn('[Kit] ' + kind + ': `title` is required; without it the dialog has no accessible name.');
        }
        const scrim = el('div', { class: base + '__scrim' });
        const head = el('div', { class: base + '__head' }, [
            el('h2', { class: base + '__title', id: titleId, text: o.title || '' })
        ]);

        let closeBtn = null;
        if (o.dismiss !== false) {
            closeBtn = el('button', { class: base + '__x', type: 'button', 'aria-label': 'Close' }, [
                el('span', { 'aria-hidden': 'true', text: '×' })
            ]);
            head.appendChild(closeBtn);
        }

        const bodyWrap = el('div', { class: base + '__body' });
        let describedBy = null;
        if (typeof o.body === 'string' && o.body) {
            bodyWrap.appendChild(el('p', { class: base + '__msg', id: msgId, text: o.body }));
            describedBy = msgId;
        } else if (o.body) {
            bodyWrap.appendChild(o.body);
        }

        const actions = listOf(o.actions, kind, 'actions').map((a) => {
            const cls =
                'kit-btn' +
                (a.danger ? ' kit-btn--danger' : '') +
                ((a.primary || a.hero) && !a.danger ? ' kit-btn--primary' : '') +
                // `hero`: the screen's one filled (wine) action, owner 2026-09-22
                // ("change them to dark red, like wine red"). Still a primary,
                // so every `.kit-btn--primary` lookup (Enter-to-submit, busy
                // state, Kit.form) keeps finding it.
                (a.hero && !a.danger ? ' kit-btn--hero' : '');
            const b = el('button', { class: cls, type: 'button', text: a.label });
            if (a.autofocus) b.dataset.kitAutofocus = '1';
            b.addEventListener('click', () => {
                if (typeof a.onClick === 'function') a.onClick(handle);
            });
            return b;
        });
        const foot = actions.length ? el('div', { class: base + '__foot' }, actions) : null;

        const box = el('div', { class: base + '__box', tabindex: '-1' }, [head, bodyWrap, foot]);
        const root = el(
            'div',
            {
                class: 'kit ' + base + ' ' + base + '--' + (o.size || 'md'),
                role: o.role || 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': titleId,
                'aria-describedby': describedBy
            },
            [scrim, box]
        );

        let closed = false;
        let releaseScroll = null;
        let releaseTrap = null;

        function setBusy(on) {
            root.classList.toggle('is-busy', !!on);
            box.setAttribute('aria-busy', on ? 'true' : 'false');
            actions.forEach((b) => {
                b.disabled = !!on;
                if (b.classList.contains('kit-btn--primary') || b.classList.contains('kit-btn--danger')) {
                    b.classList.toggle('kit-btn--busy', !!on);
                }
            });
        }

        function close(result) {
            if (closed) return;
            closed = true;
            const childFailed = closeChildren(handle);
            const i = stack.indexOf(handle);
            if (i > -1) stack.splice(i, 1);
            document.removeEventListener('keydown', onKey, true);
            if (releaseTrap) releaseTrap();
            if (releaseScroll) releaseScroll();
            // Hand the answer back, and the focus, NOW. Only the node removal
            // waits for the animation; js/nexus-ui.js:411-421 measured what
            // waiting for it before resolving costs at every call site.
            if (opener && typeof opener.focus === 'function') opener.focus();
            if (typeof o.onClose === 'function') o.onClose(result);
            root.classList.add('is-closing');
            window.setTimeout(() => {
                if (root.parentNode) root.parentNode.removeChild(root);
            }, exitMs(root));
            if (childFailed) throw childFailed;
        }

        function onKey(e) {
            // A module that re-renders its host out from under an open overlay
            // would otherwise leave this handler on document forever, eating
            // Escape for a dialog nobody can see.
            if (!document.body.contains(root)) {
                // ⛔ close(), NOT JUST AN UNBIND. Unbinding left the scroll lock
                // held forever: a module that re-renders its host out from under
                // an open overlay took the node away without ever releasing it,
                // and the page stayed unscrollable for the rest of the session
                // with no dialog on screen to explain why. close() releases the
                // lock, drops the stack entry and settles the promise, and it is
                // idempotent, so the ordinary path is unaffected.
                // ⚠️ It still needs A keystroke to notice. A dialog removed from
                // under the user and never typed at again keeps the lock; only a
                // MutationObserver would close that, which is a standing cost on
                // every page for a case that is already a caller bug.
                close(undefined);
                return;
            }
            if (e.key !== 'Escape') return;
            if (stack[stack.length - 1] !== handle) return;
            e.stopPropagation();
            close(undefined);
        }

        const handle = { el: root, close: close, setBusy: setBusy, parent: parent };

        if (closeBtn) closeBtn.addEventListener('click', () => close(undefined));
        if (o.scrimClose !== false) scrim.addEventListener('click', () => close(undefined));

        document.body.appendChild(root);
        releaseScroll = lockScroll();
        releaseTrap = trapFocus(box);
        document.addEventListener('keydown', onKey, true);
        stack.push(handle);

        // Synchronous, not inside a requestAnimationFrame: the node is already
        // in the document, so there is nothing to wait for, and a deferred
        // focus is invisible to a test that does not know to await a frame.
        const wanted = actions.filter((b) => b.dataset.kitAutofocus === '1')[0] || focusablesIn(box)[0] || box;
        wanted.focus();

        return handle;
    }

    function modal(opts) {
        return panel('modal', opts);
    }

    function drawer(opts) {
        return panel('drawer', opts);
    }

    /**
     * Ask a yes or no question. Resolves true only for the confirm button.
     *
     * ⛭ Named kitConfirm, not the bare word, so that
     * __tests__/kit/native-controls.contract.test.js can ban the native call
     * with no exemption for the file that most needs checking.
     */
    function kitConfirm(opts) {
        const o = opts || {};
        return new Promise((resolve) => {
            let settled = false;
            const answer = (v) => {
                if (settled) return;
                settled = true;
                resolve(v);
            };
            panel('modal', {
                title: o.title || 'Are you sure?',
                body: o.message || '',
                size: 'sm',
                role: 'alertdialog',
                // No close X: Cancel already says it, in words.
                dismiss: false,
                actions: [
                    { label: o.cancelText || 'Cancel', autofocus: true, onClick: (h) => h.close(false) },
                    {
                        label: o.confirmText || 'Confirm',
                        primary: !o.danger,
                        danger: !!o.danger,
                        onClick: (h) => h.close(true)
                    }
                ],
                // Escape, the scrim and the X all arrive here as undefined, and
                // every one of them means no.
                onClose: (r) => answer(r === true)
            });
        });
    }

    /* -----------------------------------------------------------------------
     * The owner's picked overlays (2026-09-29, docs/ui-library/standards.md):
     * the pop-up window (Inventory's form window), the side sheet (Financials'
     * floating transaction sheet) and the full screen (Documents' viewer).
     * Each is copied from its source, read there and never edited;
     * css/kit-standards.css draws them. The yes/no question is Kit.confirm, above, unchanged, and
     * Kit.modal and Kit.drawer keep their own builder.
     *
     * All three sit on the one overlay stack, so Escape closes the one on top
     * only, Kit.closeAll closes them, and a pop-up opened from inside one (a
     * select in a window) is part of it and keeps it open. A dialog opened over
     * one of them stays its own, as a dialog over a dialog always has.
     *
     * The window and the full screen are modal: focus moves in and is held
     * there, the page scroll is locked, and the page behind is inert, all
     * three undone on close. The side sheet is not modal, as its source is
     * not: the table beside it stays in use, so it traps nothing, locks
     * nothing and leaves the page live; focus still moves into it and goes
     * back to what opened it.
     * --------------------------------------------------------------------- */

    /**
     * The page behind the top modal overlay is inert.
     *
     * Worked out from the stack every time it changes, never counted up and
     * down: the topmost open overlay that holds the page is found, it and
     * everything opened above it stay live, and the rest of the page is made
     * inert. Only nodes this file made inert are ever released, so an `inert`
     * the page set itself is left as it was. Kit.modal and Kit.drawer do not
     * hold the page (their contract is aria-modal alone), but one opened over
     * a window stays live, because it is above it.
     *
     * ⛔ THE PAGE'S LIVE REGIONS STAY LIVE. An inert subtree is taken out of
     * the accessibility tree, so the portal's announcer (#nexus-live-region,
     * index.html) and the toasts (#toastContainer) would go silent under
     * every window: a save the window made would be announced to nobody. So
     * the walk goes DOWN through any node that holds a live region, making
     * its other children inert, and leaves the region itself alone.
     */
    const madeInert = new Set();
    const LIVE_REGION = '[aria-live], #toastContainer';
    const NOT_CONTENT = /^(SCRIPT|STYLE|LINK|TEMPLATE)$/;

    function syncInert() {
        let top = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].holdsPage) {
                top = i;
                break;
            }
        }
        const live = new Set();
        if (top > -1) for (let i = top; i < stack.length; i++) if (stack[i].el) live.add(stack[i].el);
        const want = new Set();
        if (top > -1) {
            // Every node between <body> and a live region is walked through,
            // never made inert itself.
            const onPath = new Set();
            Array.from(document.querySelectorAll(LIVE_REGION)).forEach((r) => {
                for (let n = r.parentElement; n && n !== document.body; n = n.parentElement) onPath.add(n);
            });
            const walk = (parent) => {
                Array.from(parent.children).forEach((n) => {
                    if (live.has(n) || NOT_CONTENT.test(n.tagName)) return;
                    if (n.matches(LIVE_REGION)) return;
                    if (onPath.has(n)) walk(n);
                    else want.add(n);
                });
            };
            walk(document.body);
        }
        madeInert.forEach((n) => {
            if (want.has(n)) return;
            n.removeAttribute('inert');
            madeInert.delete(n);
        });
        want.forEach((n) => {
            if (madeInert.has(n) || n.hasAttribute('inert')) return;
            n.setAttribute('inert', '');
            madeInert.add(n);
        });
    }

    /**
     * Put an overlay on the page and on the stack, and take it off again.
     *
     *   root     the node appended to <body>
     *   kind     'pop-up-window' | 'side-sheet' | 'full-screen'
     *   modal    trap focus in `trap`, lock the page scroll, make the page inert
     *   host     where a pop-up opened from inside it mounts (modal only)
     *   focus    () => the node that takes focus on open
     *   opener   what focus goes back to on close
     *   returnFocus  the caller's own place for focus on close: an element,
     *            or () => an element
     *   onKey    (event) => true when a key belongs to the overlay (the full
     *            screen's arrows)
     *   onClose  (result), once
     *
     * Focus goes back to returnFocus, else the opener, else, when the opener
     * has left the page (a menu row that opened a window is gone with its
     * menu), to what opened the pop-up it was in: the menu's own button.
     *
     * The handle's close(result, quiet): quiet leaves the focus where it is,
     * for a side sheet giving way to the next one.
     */
    function focusBack(cfg, handle) {
        const want = typeof cfg.returnFocus === 'function' ? cfg.returnFocus() : cfg.returnFocus;
        const usable = (n) => n && n !== document.body && n.isConnected && typeof n.focus === 'function';
        if (usable(want)) return want;
        if (usable(cfg.opener)) return cfg.opener;
        for (let p = handle.parent; p; p = p.parent) {
            if (usable(p.anchor)) return p.anchor;
            if (usable(p.opener)) return p.opener;
        }
        return null;
    }

    /** A key the page itself is using: a field's own Escape wins. */
    function ownEscape(t) {
        if (!t || t.nodeType !== 1) return false;
        if (t.isContentEditable) return true;
        if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return false;
        return String(t.value || '') !== '';
    }

    /** An open list or pop-up the portal draws outside the kit's stack. */
    const FOREIGN_POP = '.fc-pop, .atbl-pop, .nexus-dropdown.open';

    function openOverlay(cfg) {
        const root = cfg.root;
        const opener = cfg.opener;
        let closed = false;
        let releaseScroll = null;
        let releaseTrap = null;
        const handle = {
            el: root,
            kind: cfg.kind,
            opener: opener,
            // Opened from inside an open pop-up (a menu row that opens a
            // window): part of it, so a click in the window keeps it open.
            parent: ownerOf(opener),
            host: cfg.modal ? cfg.host || null : null,
            holdsPage: !!cfg.modal
        };

        function close(result, quiet) {
            if (closed) return;
            closed = true;
            const childFailed = closeChildren(handle);
            const at = stack.indexOf(handle);
            if (at > -1) stack.splice(at, 1);
            document.removeEventListener('keydown', onKey, capture);
            if (releaseTrap) releaseTrap();
            if (releaseScroll) releaseScroll();
            syncInert();
            // Focus and the answer go back NOW; only the node's removal waits
            // for the fade, as in panel().
            const back = quiet ? null : focusBack(cfg, handle);
            if (back) back.focus();
            if (typeof cfg.onClose === 'function') cfg.onClose(result);
            root.classList.add('is-closing');
            window.setTimeout(() => {
                if (root.parentNode) root.parentNode.removeChild(root);
            }, exitMs(root));
            if (childFailed) throw childFailed;
        }

        // ⛔ A MODAL OVERLAY TAKES ESCAPE FIRST, A SHEET BESIDE THE PAGE
        // LAST. The window and the full screen hold the page, so they listen
        // in the capture phase, as panel() does, and the one on top closes.
        // The side sheet does not: the page beside it keeps working, so it
        // listens in the BUBBLE phase, as its source does
        // (js/financials/view-transactions.js:2976-2983), and closes only on an
        // Escape nothing else wanted: not one a list or a field already
        // handled (defaultPrevented), not while a list or pop-up is open,
        // inside the sheet or out, and not a field's own (a box with words in
        // it keeps Escape for itself).
        const capture = !!cfg.modal;

        function onKey(e) {
            // Taken away from under us by a re-render: close, so the lock and
            // the inert page go with it (the reason is in panel()).
            if (!document.body.contains(root)) {
                close(undefined);
                return;
            }
            if (e.key !== 'Escape' && e.key !== 'Esc') {
                if (typeof cfg.onKey === 'function' && stack[stack.length - 1] === handle) cfg.onKey(e);
                return;
            }
            if (stack[stack.length - 1] !== handle) return;
            if (!capture) {
                if (e.defaultPrevented) return;
                if (stack.some((h) => h.isPop) || document.querySelector(FOREIGN_POP)) return;
                if (ownEscape(e.target)) return;
                e.preventDefault();
                close(undefined);
                return;
            }
            e.stopPropagation();
            close(undefined);
        }

        handle.close = close;
        document.body.appendChild(root);
        if (cfg.modal) {
            releaseScroll = lockScroll();
            releaseTrap = trapFocus(cfg.trap || root);
        }
        document.addEventListener('keydown', onKey, capture);
        stack.push(handle);
        syncInert();
        const wanted = typeof cfg.focus === 'function' ? cfg.focus() : null;
        (wanted || root).focus();
        return handle;
    }

    /** A bare icon button that closes: the kit's icon button (buttons__icon), named. */
    function closeButton(label) {
        return el('button', { class: 'kit-icon', type: 'button', 'aria-label': label || 'Close' }, [
            Kit.glyph('close', { cls: 'kit-icon__glyph' })
        ]);
    }

    /** Text, a node, or nothing: what a slot holds. */
    function slot(v) {
        if (v == null || v === false) return null;
        if (typeof v === 'object' && typeof v.nodeType === 'number') return v;
        return document.createTextNode(String(v));
    }

    const WINDOW_SIZES = ['md', 'lg', 'xl'];

    /**
     * The pop-up window (pick overlays__pop-up-window, "Inventory form
     * window"): a form or a short job in a 12px box over a dark scrim, 640px
     * wide (720 `lg`, 760 `xl`), left aligned, its actions on a hairline at
     * the foot. Copied from the house dialog frame (.nexus-dialog-overlay,
     * .nexus-dialog, css/dashboard.css:13788, :13854) as Inventory widens and
     * trims it (.inv-modal-dialog, css/inventory.css:3347-3470, :3814-3845).
     *
     * @param o.title     the window's name (required; it is aria-labelledby)
     * @param o.subtitle  the line under the title; it describes the window
     * @param o.body      a node (a form; `.kit-pop-up-window__grid` is the
     *                    source's two-column field grid) or a sentence
     * @param o.actions   [{ label, primary, danger, disabled, autofocus,
     *                    onClick(handle) }]: Cancel is a plain one, the
     *                    confirm `primary` (the wine fill), a destructive one
     *                    `danger` (the solid red delete button)
     * @param o.size      'md' (640px, the default), 'lg' (720px), 'xl' (760px)
     * @param o.close     true for an × in the head (the purchase order's)
     * @param o.scrimClose false to keep a click on the scrim from closing it
     * @param o.returnFocus where focus goes on close (an element, or a
     *                    function that returns one), when not the opener
     * @param o.onClose   (result) once, however it closed
     *
     * A field in the body is `.kit-pop-up-window__field` holding a
     * `.kit-pop-up-window__label` and its control (a kit text box), as the
     * source's are; a half-width one adds `.kit-pop-up-window__half`.
     *
     * Focus goes to an `autofocus` action, else the first control in the
     * body, else the first action. Returns { el, close(result), setBusy(on),
     * setError(words), setFieldError(control, words) }: setError('') clears
     * the red line at the top, and setFieldError marks one control refused
     * (aria-invalid, its field's red edge, the words under it, tied to it by
     * aria-describedby); setFieldError(control, '') clears it.
     */
    function popUpWindow(opts) {
        const o = opts || {};
        const opener = document.activeElement;
        const titleId = nextId('pop-up-window-title');
        const subId = nextId('pop-up-window-sub');
        if (!o.title) {
            warn('[Kit] popUpWindow: `title` is required; without it the window has no accessible name.');
        }
        const size = WINDOW_SIZES.indexOf(o.size) > -1 ? o.size : 'md';
        const head = el('div', { class: 'kit-pop-up-window__head' }, [
            el('h2', { class: 'kit-pop-up-window__title', id: titleId, text: o.title || '' })
        ]);
        const x = o.close === true ? closeButton('Close') : null;
        if (x) head.appendChild(x);
        const sub = o.subtitle
            ? el('p', { class: 'kit-pop-up-window__sub', id: subId, text: String(o.subtitle) })
            : null;
        // In the page from the start and empty, so a screen reader hears it
        // when setError writes into it (a live region made at that moment is
        // announced unreliably).
        const error = el('p', { class: 'kit-pop-up-window__error', role: 'alert' });
        const body = el('div', { class: 'kit-pop-up-window__body' });
        const msgId = nextId('pop-up-window-msg');
        let described = sub ? subId : null;
        if (typeof o.body === 'string' && o.body) {
            // A sentence is what the window says: it describes it too.
            body.appendChild(el('p', { class: 'kit-pop-up-window__msg', id: msgId, text: o.body }));
            described = described ? described + ' ' + msgId : msgId;
        } else if (o.body && o.body.nodeType === 1) {
            body.appendChild(o.body);
        }
        let handle = null;
        const actions = listOf(o.actions, 'popUpWindow', 'actions').map((a) => {
            const b = el('button', {
                class: a.danger
                    ? 'kit-danger-warning'
                    : 'kit-pop-up-window__btn' + (a.primary ? ' kit-pop-up-window__btn--go' : ''),
                type: 'button',
                text: a.label
            });
            if (a.disabled) b.disabled = true;
            if (a.autofocus) b.dataset.kitAutofocus = '1';
            b.addEventListener('click', () => {
                if (typeof a.onClick === 'function') a.onClick(handle);
            });
            return b;
        });
        const foot = actions.length ? el('div', { class: 'kit-pop-up-window__foot' }, actions) : null;
        const scrim = el('div', { class: 'kit-pop-up-window__scrim' });
        const box = el('div', { class: 'kit-pop-up-window__box', tabindex: '-1' }, [head, sub, error, body, foot]);
        const root = el(
            'div',
            {
                class: 'kit kit-pop-up-window kit-pop-up-window--' + size,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': titleId,
                'aria-describedby': described
            },
            [scrim, box]
        );

        function setBusy(on) {
            root.classList.toggle('is-busy', !!on);
            box.setAttribute('aria-busy', on ? 'true' : 'false');
            actions.forEach((b) => {
                b.disabled = !!on;
            });
        }

        function setError(words) {
            error.textContent = words ? String(words) : '';
        }

        function setFieldError(control, words) {
            if (!control || control.nodeType !== 1) return;
            const field = control.closest('.kit-pop-up-window__field');
            if (!control.id) control.id = nextId('pop-up-window-field');
            const lineId = control.id + '-error';
            let line = field ? field.querySelector('.kit-pop-up-window__field-error') : null;
            const was = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== lineId);
            if (words) {
                if (!line) {
                    line = el('p', { class: 'kit-pop-up-window__field-error', id: lineId });
                    (field || control.parentNode).appendChild(line);
                }
                line.textContent = String(words);
                control.setAttribute('aria-invalid', 'true');
                control.setAttribute('aria-describedby', was.concat(lineId).join(' '));
            } else {
                if (line) line.remove();
                control.removeAttribute('aria-invalid');
                if (was.length) control.setAttribute('aria-describedby', was.join(' '));
                else control.removeAttribute('aria-describedby');
            }
            if (field) field.classList.toggle('is-error', !!words);
        }

        handle = openOverlay({
            root: root,
            kind: 'pop-up-window',
            modal: true,
            trap: box,
            host: box,
            opener: opener,
            returnFocus: o.returnFocus,
            onClose: o.onClose,
            focus: () =>
                actions.filter((b) => b.dataset.kitAutofocus === '1')[0] ||
                focusablesIn(body)[0] ||
                actions.filter((b) => !b.disabled)[0] ||
                box
        });
        handle.setBusy = setBusy;
        handle.setError = setError;
        handle.setFieldError = setFieldError;
        if (x) x.addEventListener('click', () => handle.close(undefined));
        if (o.scrimClose !== false) scrim.addEventListener('click', () => handle.close(undefined));
        return handle;
    }

    /**
     * The side sheet (pick overlays__side-panel, "Financials floating side
     * sheet"): a 400px sheet floating 12px in from the top, right and bottom,
     * with no scrim, so the page beside it stays in use. Copied from the
     * Transactions detail sheet (.ftx-detail, css/financials-transactions.css:
     * 953-1100; js/financials/view-transactions.js:3375). One at a time: a
     * second takes the first one's place, and focus still goes back to what
     * opened the first.
     *
     * @param o.kicker  the small line above the title ("Transaction")
     * @param o.title   the sheet's name (required; it is aria-labelledby)
     * @param o.figure  the big figure under the title: words or a node
     * @param o.body    a node after the figure (a status tag, say)
     * @param o.fields  [{ term, def }]: the definition list, def words or a node
     * @param o.links   [{ label, onClick(handle, event) }]: the bordered
     *                  buttons at the foot
     * @param o.returnFocus where focus goes on close (an element, or a
     *                  function that returns one), when not the opener
     * @param o.onClose (result) once, however it closed
     *
     * A money figure in words ("−$482.50") raises its cents, as Financials
     * prints an amount (FF.moneyNode). Closed by its × or Escape: an Escape
     * nothing else wanted (openOverlay). Returns { el, close(result) }.
     */
    function sideSheet(opts) {
        const o = opts || {};
        let opener = document.activeElement;
        let returnFocus = o.returnFocus;
        stack
            .slice()
            .reverse()
            .forEach((h) => {
                if (h.kind !== 'side-sheet') return;
                opener = h.opener;
                if (returnFocus == null) returnFocus = h.returnFocus;
                h.close(undefined, true);
            });
        const titleId = nextId('side-sheet-title');
        if (!o.title) {
            warn('[Kit] sideSheet: `title` is required; without it the sheet has no accessible name.');
        }
        const x = closeButton('Close');
        const fields = listOf(o.fields, 'sideSheet', 'fields');
        const links = listOf(o.links, 'sideSheet', 'links');
        let handle = null;
        const root = el(
            'aside',
            {
                class: 'kit kit-side-sheet',
                role: 'dialog',
                'aria-modal': 'false',
                'aria-labelledby': titleId,
                tabindex: '-1'
            },
            [
                el('div', { class: 'kit-side-sheet__head' }, [
                    el('div', { class: 'kit-side-sheet__kicker', text: o.kicker ? String(o.kicker) : '' }),
                    x
                ]),
                el('h2', { class: 'kit-side-sheet__title', id: titleId, text: o.title || '' }),
                o.figure != null ? el('div', { class: 'kit-side-sheet__figure' }, figureParts(o.figure)) : null,
                // The body keeps its own width (a status tag stays a tag), as
                // the source's badge does.
                o.body && o.body.nodeType === 1 ? el('div', { class: 'kit-side-sheet__body' }, [o.body]) : null,
                fields.length
                    ? el(
                          'dl',
                          { class: 'kit-side-sheet__list' },
                          fields.map((f) =>
                              el('div', { class: 'kit-side-sheet__field' }, [
                                  el('dt', { class: 'kit-side-sheet__term', text: String(f.term || '') }),
                                  el('dd', { class: 'kit-side-sheet__def' }, [slot(f.def)])
                              ])
                          )
                      )
                    : null,
                links.length
                    ? el(
                          'div',
                          { class: 'kit-side-sheet__links' },
                          links.map((l) => {
                              const b = el('button', {
                                  class: 'kit-side-sheet__link',
                                  type: 'button',
                                  text: String(l.label || '')
                              });
                              b.addEventListener('click', (e) => {
                                  if (typeof l.onClick === 'function') l.onClick(handle, e);
                              });
                              return b;
                          })
                      )
                    : null
            ]
        );
        handle = openOverlay({
            root: root,
            kind: 'side-sheet',
            modal: false,
            opener: opener,
            returnFocus: returnFocus,
            onClose: o.onClose
        });
        handle.returnFocus = returnFocus;
        x.addEventListener('click', () => handle.close(undefined));
        return handle;
    }

    /** "−$482.50" as the whole part and its raised ".50"; a node or other words as they are. */
    const MONEY_WORDS = /^(.*\d)(\.\d{2})$/;
    function figureParts(v) {
        if (typeof v !== 'string') return [slot(v)];
        const m = MONEY_WORDS.exec(v);
        if (!m) return [slot(v)];
        return [document.createTextNode(m[1]), el('span', { class: 'kit-side-sheet__cents', text: m[2] })];
    }

    /**
     * The full screen (pick overlays__full-screen, "Document viewer"): the
     * whole window on the page ground, no scrim, a head with a large close
     * on the left, the name and a line under it, and the previous and next
     * arrows on the right; the document on a recessed stage, and a panel
     * beside it. Copied from the Documents viewer (.doc-viewer,
     * css/documents.css:1415-1600; js/documents/library.js:2567).
     *
     * @param o.title  the name (required; it is aria-labelledby)
     * @param o.meta   the line under the name ("PDF · Sep 24, 2026 · $482.50")
     * @param o.body   the node on the stage
     * @param o.side   the node in the panel beside it, optional
     * @param o.nav    { at: '3 of 18', onPrev(handle), onNext(handle),
     *                 canPrev, canNext }: the arrows, each off when its
     *                 handler is missing or its can* is false. The left and
     *                 right arrow keys step too, as in Documents
     *                 (js/documents/library.js:2799), except in a field, a
     *                 control that uses those keys itself, or a list open
     *                 over it.
     * @param o.returnFocus where focus goes on close (an element, or a
     *                 function that returns one), when not the opener
     * @param o.onClose (result) once, however it closed
     *
     * Focus goes to the close. Returns { el, close(result), set({ title,
     * meta, at, canPrev, canNext }) } for stepping through a list without
     * closing: at the first or the last one, set({ canPrev: false }) or
     * set({ canNext: false }) turns that arrow off (disabled, and its key
     * with it), and focus on it moves to the other arrow or the close.
     */
    function fullScreen(opts) {
        const o = opts || {};
        const opener = document.activeElement;
        const titleId = nextId('full-screen-title');
        if (!o.title) {
            warn('[Kit] fullScreen: `title` is required; without it the view has no accessible name.');
        }
        const x = el('button', { class: 'kit-full-screen__close', type: 'button', 'aria-label': 'Close' }, [
            Kit.glyph('close', { cls: 'kit-full-screen__glyph' })
        ]);
        const name = el('h2', { class: 'kit-full-screen__name', id: titleId, text: o.title || '' });
        const meta = el('div', { class: 'kit-full-screen__meta', text: o.meta ? String(o.meta) : '' });
        let handle = null;
        let pos = null;
        let nav = null;
        let prevBtn = null;
        let nextBtn = null;
        const n = Object.assign({}, o.nav || {});
        const can = { prev: typeof n.onPrev === 'function', next: typeof n.onNext === 'function' };
        if (o.nav) {
            const arrow = (label, icon, fn) => {
                const b = el('button', { class: 'kit-full-screen__arrow', type: 'button', 'aria-label': label }, [
                    Kit.glyph(icon, { cls: 'kit-full-screen__glyph kit-full-screen__glyph--arrow' })
                ]);
                b.addEventListener('click', () => {
                    if (!b.disabled && typeof fn === 'function') fn(handle);
                });
                return b;
            };
            pos = el('span', { class: 'kit-full-screen__pos', text: n.at ? String(n.at) : '' });
            prevBtn = arrow('Previous', 'chevronLeft', n.onPrev);
            nextBtn = arrow('Next', 'chevronRight', n.onNext);
            nav = el('div', { class: 'kit-full-screen__nav' }, [prevBtn, pos, nextBtn]);
        }

        /** An arrow on or off; the one that had focus hands it on. */
        function paintArrows() {
            const had = document.activeElement;
            if (prevBtn) prevBtn.disabled = !(can.prev && n.canPrev !== false);
            if (nextBtn) nextBtn.disabled = !(can.next && n.canNext !== false);
            if (!had || (had !== prevBtn && had !== nextBtn) || !had.disabled) return;
            const other = had === prevBtn ? nextBtn : prevBtn;
            (other && !other.disabled ? other : x).focus();
        }
        paintArrows();

        /** The left and right keys step, as the arrows do. */
        const OWN_ARROWS = '[role="radiogroup"], [role="tablist"], [role="slider"], [role="listbox"], [role="menu"]';
        function onArrow(e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            const t = e.target;
            if (t && t.nodeType === 1) {
                if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
                if (t.closest(OWN_ARROWS)) return;
            }
            const b = e.key === 'ArrowLeft' ? prevBtn : nextBtn;
            if (!b || b.disabled) return;
            e.preventDefault();
            b.click();
        }
        const side = o.side && o.side.nodeType === 1 ? el('div', { class: 'kit-full-screen__side' }, [o.side]) : null;
        const root = el(
            'div',
            {
                class: 'kit kit-full-screen',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': titleId
            },
            [
                el('div', { class: 'kit-full-screen__head' }, [
                    x,
                    el('div', { class: 'kit-full-screen__id' }, [name, meta]),
                    nav
                ]),
                el('div', { class: 'kit-full-screen__body' + (side ? ' has-side' : '') }, [
                    el('div', { class: 'kit-full-screen__stage' }, [o.body && o.body.nodeType === 1 ? o.body : null]),
                    side
                ])
            ]
        );
        handle = openOverlay({
            root: root,
            kind: 'full-screen',
            modal: true,
            trap: root,
            host: root,
            opener: opener,
            returnFocus: o.returnFocus,
            onKey: onArrow,
            onClose: o.onClose,
            focus: () => x
        });
        handle.set = function (v) {
            const s = v || {};
            if (s.title != null) name.textContent = String(s.title);
            if (s.meta != null) meta.textContent = String(s.meta);
            if (s.at != null && pos) pos.textContent = String(s.at);
            if (s.canPrev != null) n.canPrev = !!s.canPrev;
            if (s.canNext != null) n.canNext = !!s.canNext;
            paintArrows();
        };
        x.addEventListener('click', () => handle.close(undefined));
        return handle;
    }

    /* -----------------------------------------------------------------------
     * Fields.
     * --------------------------------------------------------------------- */

    /** The shapes a field can label: every kit control that takes focus. */
    const CONTROL_SEL = '.kit-input, .kit-select__btn, [role="switch"]';
    const SEARCH_SEL = 'input[type="search"]';

    /**
     * The labelable control inside whatever node the caller handed over.
     *
     * ⛔ A COMPOSITE FACTORY RETURNS ITS WRAPPER, NOT ITS CONTROL. Kit.select
     * gives back `div.kit-select`; the thing a label names is the button
     * inside it. `label[for]` pointing at a div names nothing at all — a div
     * is not a labelable element — and `aria-describedby` on a wrapper is not
     * read out with the control it wraps. css/kit.css already expects this
     * composition (`.kit .kit-field.is-error .kit-select__btn`), so resolving
     * the inner control is what makes the sheet's own case work.
     *
     * It also keeps ONE description on ONE node: setFieldError resolves the
     * control the same way, and a field that wrote to the outer node would
     * leave the help id on the wrapper where no clearFieldError would ever
     * find it again.
     */
    function fieldControl(node) {
        if (!node || node.nodeType !== 1) return null;
        if (typeof node.matches === 'function' && node.matches(CONTROL_SEL)) return node;
        return typeof node.querySelector === 'function' ? node.querySelector(CONTROL_SEL) : null;
    }

    /**
     * Is this the toolbar search box, wrapper or bare input?
     *
     * Both spellings are checked because Kit.searchBox returns the wrapper and
     * a caller who dug the input out of it has the same problem.
     */
    function isSearchControl(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.classList && node.classList.contains('kit-search')) return true;
        if (typeof node.matches === 'function' && node.matches(SEARCH_SEL)) return true;
        return typeof node.querySelector === 'function' ? !!node.querySelector(SEARCH_SEL) : false;
    }

    /**
     * A labelled control with room for help text and an error.
     *
     * The error node is always present and starts empty, because a live region
     * created at the moment it has something to say is announced unreliably. It
     * carries role="alert" so a server-side rejection reaches a screen reader
     * without the caller doing anything.
     *
     * ⛔ IT REFUSES A SEARCH BOX, and the reason is worth the paragraph because
     * the failure is silent in all three directions:
     *
     *   1. THE ERROR WOULD NOT PAINT, AND !important WOULD NOT FIX IT.
     *      `.kit .kit-search input[type='search']` sets `border` with
     *      !important at (0,3,1); `.kit .kit-field.is-error .kit-input` sets
     *      border-color WITHOUT it at (0,4,0), and an important declaration
     *      beats a normal one whatever the specificity. Adding !important to
     *      the error rule wins THAT comparison and still loses the next one:
     *      the search field's own `:focus` rule is (0,4,1) and already
     *      important, so the red edge would survive until the reader focused
     *      the field to fix the error and then vanish. Making it stick would
     *      take two more rules in the sheet, for a composition nothing builds.
     *   2. THE LABEL WOULD BE IGNORED. The search input's accessible name is
     *      its own aria-label (components.js sets it from the placeholder), so
     *      a field label is a second name, and the one on screen is the one
     *      assistive technology drops.
     *   3. IT IS A FILTER. A filter has no submit to be rejected by, which is
     *      what a field's error line exists to report.
     *
     * So it says so, once, naming the factory and the option, and renders the
     * field without it — the same answer core's data slots give a shape they
     * cannot honour, rather than a half-wired control that looks fine.
     */
    function field(opts) {
        const o = opts || {};
        let node = o.control || null;
        if (isSearchControl(node)) {
            warn(
                '[Kit] field: `control` was a search box. Kit.searchBox is a toolbar filter, not a form ' +
                    'control: it carries its own accessible name, so the field label is ignored, and the ' +
                    'search rule in css/kit.css sets its border with !important, so `.kit-field.is-error` ' +
                    'can never repaint it. Put it in a Kit.toolbar instead. Rendering the field without it.'
            );
            node = null;
        }
        const control = fieldControl(node);
        const id = control && control.id ? control.id : nextId('field');
        if (control && !control.id) control.id = id;

        const label = el('label', { class: 'kit-field__label', for: id, id: id + '-label', text: o.label || '' });
        if (o.required) {
            label.appendChild(el('span', { class: 'kit-field__req', text: 'Required' }));
            if (control) control.setAttribute('aria-required', 'true');
        }

        const help = el('p', { class: 'kit-field__help', id: id + '-help', text: o.help || '' });
        help.hidden = !o.help;
        const err = el('p', { class: 'kit-field__error', id: id + '-error', role: 'alert' });
        err.hidden = true;

        // ⛔ A LABEL ON A CHOOSER REPLACES ITS CONTENTS, IT DOES NOT ADD TO
        // THEM. `label[for]` pointing at the select's button gives the button
        // the label as its whole accessible name, so Chrome's accessibility
        // tree read "Department, button, collapsed" where a native select says
        // "Department, combo box, Back of house" — the field announced and the
        // answer lost. aria-labelledby naming BOTH nodes puts the value back.
        const valueSpan = control && control.querySelector ? control.querySelector('.kit-select__lbl') : null;
        if (valueSpan) {
            if (!valueSpan.id) valueSpan.id = control.id + '-value';
            control.setAttribute('aria-labelledby', label.id + ' ' + valueSpan.id);
        }

        const root = el('div', { class: 'kit-field' }, [label, node, help, err]);
        if (control && o.help) control.setAttribute('aria-describedby', help.id);
        if (o.error) setFieldError(root, o.error);
        return root;
    }

    function setFieldError(fieldEl, msg) {
        if (!fieldEl) return;
        const err = fieldEl.querySelector('.kit-field__error');
        if (!err) return;
        const help = fieldEl.querySelector('.kit-field__help');
        const control = fieldControl(fieldEl);

        // ⛔ UNHIDE FIRST, THEN WRITE. `.kit [hidden]` is display:none, and an
        // element with display:none is not in the accessibility tree at all —
        // so writing the text while it was still hidden made the mutation
        // happen OUTSIDE the tree, which is the exact condition the
        // always-present live region exists to avoid. The node existing is only
        // half of it; it has to be observable when it changes.
        const text = msg == null ? '' : String(msg);
        if (text) err.hidden = false;
        err.textContent = text;
        if (!text) err.hidden = true;
        fieldEl.classList.toggle('is-error', !!err.textContent);

        if (!control) return;
        const ids = [];
        if (err.textContent) ids.push(err.id);
        if (help && !help.hidden) ids.push(help.id);
        if (err.textContent) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
        if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
        else control.removeAttribute('aria-describedby');
    }

    function clearFieldError(fieldEl) {
        setFieldError(fieldEl, '');
    }

    /**
     * Cents from whatever the user typed, or null.
     *
     * ⛔ Math.round at the CENT, not at the float. 12.34 * 100 is
     * 1233.9999999999998 in binary floating point, and truncating instead of
     * rounding turns a $12.34 rate into $12.33 for as long as it is stored.
     */
    function parseCents(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return null;
        // ⛔ STRIP THE CURRENCY MARK BEFORE READING THE SIGN. The sign used to be
        // taken off the raw first character, so "$-8.05" — which is what a paste
        // out of a spreadsheet looks like — read as POSITIVE 805: a refund
        // stored as a charge. Anything that is not a digit, a point or a minus
        // goes first, and the sign is whatever leads what is left.
        const cleaned = s.replace(/[^0-9.-]/g, '');
        const neg = cleaned.charAt(0) === '-';
        const digits = cleaned.replace(/[^0-9.]/g, '');
        if (!digits || digits === '.') return null;
        const n = Number(digits);
        if (!isFinite(n)) return null;
        const cents = Math.round(n * 100);
        return neg ? -cents : cents;
    }

    /** The DOM types the kit is willing to hand to the browser. */
    const NATIVE_TYPE = { text: 'text', email: 'email', tel: 'tel' };

    /**
     * A text-shaped control. `type` names the kind of VALUE, not the DOM type.
     *
     * ⛔ `number` and `money` are NOT rendered as `type="number"`. A native
     * number field spins on a mouse wheel that happens to be over it, refuses a
     * pasted "1,234.56", and draws browser chrome the kit cannot style.
     * inputmode="decimal" gets the right phone keyboard without any of that.
     *
     * ⛭ MONEY IS CENTS, IN AND OUT, matching Kit.fmt.money(cents). The display
     * string is dollars; el.dataset.cents and el.kitValue() are the integer.
     */
    function input(opts) {
        const o = opts || {};
        const kind = o.type || 'text';
        const id = o.id || nextId('input');
        let n;

        if (kind === 'textarea') {
            n = el('textarea', { class: 'kit-input kit-input--area', id: id, rows: String(o.rows || 3) });
        } else {
            n = el('input', {
                class: 'kit-input' + (kind === 'money' ? ' kit-input--money' : ''),
                id: id
            });
            n.type = NATIVE_TYPE[kind] || 'text';
            if (kind === 'number' || kind === 'money') n.setAttribute('inputmode', 'decimal');
        }
        if (o.placeholder) n.setAttribute('placeholder', o.placeholder);
        if (o.name) n.setAttribute('name', o.name);

        if (kind === 'money') {
            const sync = () => {
                const c = parseCents(n.value);
                n.dataset.cents = c == null ? '' : String(c);
            };
            n.dataset.cents = '';
            n.kitValue = function () {
                const c = n.dataset.cents;
                return c === '' || c == null ? null : Number(c);
            };
            // Registered BEFORE the caller's onInput, so a caller reading
            // kitValue() from its own handler sees the fresh number.
            n.addEventListener('input', sync);
            n.addEventListener('blur', () => {
                sync();
                const c = n.kitValue();
                n.value = c == null ? '' : Kit.fmt.money(c) || '';
            });
            if (o.value != null && o.value !== '') {
                const seeded = Math.round(Number(o.value));
                n.dataset.cents = isFinite(seeded) ? String(seeded) : '';
                n.value = isFinite(seeded) ? Kit.fmt.money(seeded) || '' : '';
            }
        } else if (kind === 'number') {
            n.kitValue = function () {
                const s = String(n.value).trim();
                if (!s) return null;
                const v = Number(s.replace(/,/g, ''));
                return isFinite(v) ? v : null;
            };
            if (o.value != null) n.value = String(o.value);
        } else {
            n.kitValue = function () {
                return n.value;
            };
            if (o.value != null) n.value = String(o.value);
        }

        // ⛔ EVERY OTHER CONTROL HAS kitSet AND THIS DID NOT, so repopulating an
        // edit form had no supported API — and the unsupported one is worse than
        // absent on money: setting `.value` to "99.00" left kitValue() at
        // whatever cents were last parsed, because nothing re-derives the
        // dataset until an input event fires. Measured: 1234.
        n.kitSet = function (v) {
            if (kind === 'money') {
                const c = v == null || v === '' ? null : Math.round(Number(v));
                const ok = c != null && isFinite(c);
                n.dataset.cents = ok ? String(c) : '';
                n.value = ok ? Kit.fmt.money(c) || '' : '';
            } else {
                n.value = v == null ? '' : String(v);
            }
        };

        if (typeof o.onInput === 'function') {
            n.addEventListener('input', () => o.onInput(n.kitValue(), n));
        }
        return n;
    }

    /** An on/off control that says "switch", because it takes effect at once. */
    function toggle(opts) {
        const o = opts || {};
        let on = !!o.checked;
        const kids = [el('span', { class: 'kit-toggle__track' }, [el('span', { class: 'kit-toggle__knob' })])];
        if (o.label) kids.push(el('span', { class: 'kit-toggle__lbl', text: o.label }));

        const n = el(
            'button',
            {
                class: 'kit-toggle',
                type: 'button',
                role: 'switch',
                id: o.id || nextId('toggle'),
                name: o.name
            },
            kids
        );

        n.kitValue = function () {
            return on;
        };
        // ⛔ THE ATTRIBUTE ALONE, NO COMPANION `.is-on`. css/kit.css:1912-1918
        // paints the switch from `.kit-toggle[aria-checked='true']` and
        // __tests__/kit/buttons.contract.test.js forbids a rule keying the same
        // state off a class, so a class written here would be a second source
        // of truth that nothing draws and that a screen reader cannot see. The
        // segmented control makes the same argument in components.js; this used
        // to contradict it.
        n.kitSet = function (v) {
            on = !!v;
            n.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        n.kitSet(on);
        n.addEventListener('click', () => {
            n.kitSet(!on);
            if (typeof o.onChange === 'function') o.onChange(on);
        });
        return n;
    }

    /* -----------------------------------------------------------------------
     * The owner's picked switches, tick boxes and choices (2026-09-28,
     * docs/ui-library/standards.md). Four new names beside Kit.toggle, which
     * is unchanged. Every one is a <button> the kit draws, never a native
     * checkbox or radio (the rule at the top of this file), and each keeps
     * its state in the ARIA attribute a screen reader hears, never a class.
     * --------------------------------------------------------------------- */

    /**
     * Enter does nothing on a tick box or a choice, as on the platform's own
     * (and per the WAI-ARIA checkbox and radio patterns, which give them Space
     * alone). A <button> fires a click on Enter, so the key is swallowed.
     */
    function spaceOnly(n) {
        n.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') e.preventDefault();
        });
    }

    /** Off in either spelling: `disabled`, or `aria-disabled="true"`. */
    function isOff(n) {
        return !!n && (n.disabled || n.getAttribute('aria-disabled') === 'true');
    }

    /**
     * ⛔ aria-disabled IS A PROMISE THE BUTTON DOES NOT KEEP ON ITS OWN. A
     * <button disabled> sends no click; a <button aria-disabled="true"> still
     * clicks on the pointer, Space and Enter. So the keys are swallowed here and
     * each factory's click handler refuses while `isOff`.
     */
    function refuseWhenOff(n) {
        n.addEventListener('keydown', (e) => {
            if ((e.key === ' ' || e.key === 'Enter') && isOff(n)) e.preventDefault();
        });
    }

    /**
     * A control with no name is read out as "switch" or "tick box" and nothing
     * else. The setting row it may be put in names it after it is built, so
     * the check waits a frame, and runs only if it is on the page by then.
     */
    function warnIfUnnamed(n, factory) {
        const later =
            typeof window.requestAnimationFrame === 'function'
                ? (f) => window.requestAnimationFrame(f)
                : (f) => setTimeout(f, 16);
        later(() => {
            if (!n.isConnected) return;
            const named =
                (n.getAttribute('aria-label') || '').trim() ||
                (n.getAttribute('aria-labelledby') || '').trim() ||
                (n.labels && n.labels.length > 0);
            if (!named) {
                warn(
                    '[Kit] ' +
                        factory +
                        ': this control has no name, so a screen reader announces only its role. Pass `' +
                        (factory === 'tickBox' ? 'label` or `ariaLabel' : 'label') +
                        '`, or put it in a Kit.settingRow that has a label.',
                    n
                );
            }
        });
    }

    /**
     * The on/off switch (pick toggles__switch, "Financials switch"): a 36x20
     * track, a white knob that slides across, wine when on. Copied from
     * FinControls.toggle (js/financials/controls.js:1216). role="switch",
     * because it takes effect at once. It paints no words: its name is
     * `label` (aria-label), or the setting row it sits in names it. Space and
     * Enter both flip it, as the source's button does.
     *
     * @param o.checked  true to start on
     * @param o.label    its accessible name (or put it in a setting row with
     *                   a label; a switch left with no name warns once shown)
     * @param o.disabled true to switch it off (aria-disabled="true" is off too)
     * @param o.id, o.name
     * @param o.onChange (on) when a person flips it
     * @returns the <button>, with kitValue() and kitSet(on); kitSet fires no onChange
     */
    function onOffSwitch(opts) {
        const o = opts || {};
        let on = !!o.checked;
        const n = el(
            'button',
            {
                class: 'kit-switch',
                type: 'button',
                role: 'switch',
                id: o.id || nextId('switch'),
                name: o.name,
                'aria-label': o.label || null
            },
            [el('span', { class: 'kit-switch__track' }, [el('span', { class: 'kit-switch__knob' })])]
        );
        if (o.disabled) n.disabled = true;
        n.kitValue = function () {
            return on;
        };
        n.kitSet = function (v) {
            on = !!v;
            n.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        n.kitSet(on);
        n.addEventListener('click', () => {
            if (isOff(n)) return;
            n.kitSet(!on);
            if (typeof o.onChange === 'function') o.onChange(on);
        });
        refuseWhenOff(n);
        warnIfUnnamed(n, 'switch');
        return n;
    }

    /**
     * The tick box (pick toggles__tick-box, "Settings tick box"): a drawn
     * 16px box, filled with the accent and ticked when on, and its words
     * beside it, all of it one target. Copied from SettingsControls.checkbox
     * (js/settings/controls.js:238). The EMPTY box is white in light and grey
     * in dark (owner), --kit-tick-empty. A switch says "this takes effect
     * now"; a tick box says "include this".
     *
     * @param o.checked   true to start ticked
     * @param o.label     the words beside the box, its name
     * @param o.help      one line under them, its description
     * @param o.ariaLabel its name when it paints no words (a table row's box);
     *                  with neither, it warns once shown, unless a setting
     *                  row names it
     * @param o.disabled  true to switch it off (aria-disabled="true" is off too)
     * @param o.id, o.name
     * @param o.onChange  (on) when a person ticks or unticks it
     * @returns the <button>, with kitValue() and kitSet(on); kitSet fires no onChange
     */
    function tickBox(opts) {
        const o = opts || {};
        let on = !!o.checked;
        const id = o.id || nextId('tick-box');
        const label = o.label ? el('span', { class: 'kit-tick-box__label', id: id + '-label', text: o.label }) : null;
        const help = o.help ? el('span', { class: 'kit-tick-box__help', id: id + '-help', text: o.help }) : null;
        const n = el(
            'button',
            {
                class: 'kit-tick-box',
                type: 'button',
                role: 'checkbox',
                id: id,
                name: o.name,
                'aria-label': label ? null : o.ariaLabel || null,
                // The words name it and the help describes it, rather than
                // the whole of both being read as one long name.
                'aria-labelledby': label ? label.id : null,
                'aria-describedby': help ? help.id : null
            },
            [
                el('span', { class: 'kit-tick-box__box' }, [Kit.glyph('check', { cls: 'kit-tick-box__tick' })]),
                label || help ? el('span', { class: 'kit-tick-box__text' }, [label, help]) : null
            ]
        );
        if (o.disabled) n.disabled = true;
        n.kitValue = function () {
            return on;
        };
        n.kitSet = function (v) {
            on = !!v;
            n.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        n.kitSet(on);
        n.addEventListener('click', () => {
            if (isOff(n)) return;
            n.kitSet(!on);
            if (typeof o.onChange === 'function') o.onChange(on);
        });
        spaceOnly(n);
        refuseWhenOff(n);
        warnIfUnnamed(n, 'tickBox');
        return n;
    }

    /**
     * Pick one of a few (pick toggles__pick-one, "Financials radio list"): a
     * flat list, each choice a 16px circle and its words, the chosen circle
     * wine with a white centre. Copied from FinControls.radioGroup
     * (js/financials/controls.js:919), drawn as buttons rather than the
     * source's restyled native radios. A radio group with one tab stop: the
     * arrows (all four, wrapping) and Home and End move the choice and the
     * focus together and skip a disabled choice; Space chooses the focused
     * one when nothing is chosen yet.
     *
     * @param o.options  [{ value, label, help, disabled }]
     * @param o.value    the value that starts chosen (none when absent)
     * @param o.label    the group's accessible name; without one, a setting
     *                   row that holds it names it after the row's label,
     *                   and "Options" is the fallback
     * @param o.name
     * @param o.onChange (value) when a person chooses a different one
     * @returns the radiogroup, with kitValue() and kitSet(v); kitSet fires no onChange
     */
    function pickOne(opts) {
        const o = opts || {};
        const options = listOf(o.options, 'pickOne', 'options');
        const values = options.map((x) => String(x.value));
        let value = o.value != null && values.indexOf(String(o.value)) > -1 ? String(o.value) : null;
        const root = el('div', {
            class: 'kit-pick-one',
            role: 'radiogroup',
            name: o.name,
            'aria-label': o.label || 'Options'
        });
        // "Options" is a fallback, not a name of its own: a setting row that
        // holds the group replaces it with the row's label.
        if (!o.label) root.kitFallbackName = true;
        const buttons = options.map((opt, i) => {
            const id = nextId('pick-one');
            const words = String(opt.label != null ? opt.label : opt.value);
            const help = opt.help
                ? el('span', { class: 'kit-pick-one__help', id: id + '-help', text: opt.help })
                : null;
            const b = el(
                'button',
                {
                    class: 'kit-pick-one__opt',
                    type: 'button',
                    role: 'radio',
                    id: id,
                    'aria-labelledby': id + '-label',
                    'aria-describedby': help ? help.id : null,
                    dataset: { value: values[i] }
                },
                [
                    el('span', { class: 'kit-pick-one__mark' }),
                    el('span', { class: 'kit-pick-one__text' }, [
                        el('span', { class: 'kit-pick-one__label', id: id + '-label', text: words }),
                        help
                    ])
                ]
            );
            if (opt.disabled) b.disabled = true;
            b.addEventListener('click', () => pick(values[i], false));
            spaceOnly(b);
            root.appendChild(b);
            return b;
        });
        const usable = (b) => !!b && !isOff(b);

        function paint() {
            let chosen = null;
            buttons.forEach((b, i) => {
                const on = values[i] === value;
                b.setAttribute('aria-checked', on ? 'true' : 'false');
                b.tabIndex = -1;
                if (on) chosen = b;
            });
            // The chosen choice is the way in only when it can be used;
            // nothing chosen, or a chosen one that is off, and the first
            // usable choice is, so the group never drops out of the tab order.
            const stop = usable(chosen) ? chosen : buttons.filter(usable)[0] || buttons[0];
            if (stop) stop.tabIndex = 0;
        }

        function pick(v, focus) {
            const at = values.indexOf(v);
            if (at < 0 || !usable(buttons[at])) return;
            const changed = v !== value;
            value = v;
            paint();
            if (focus) buttons[at].focus();
            if (changed && typeof o.onChange === 'function') o.onChange(v);
        }

        root.addEventListener('keydown', (e) => {
            const i = buttons.indexOf(document.activeElement);
            if (i < 0) return;
            const n = buttons.length;
            const seek = (start, dir) => {
                for (let s = 1; s <= n; s++) {
                    const j = (((start + dir * s) % n) + n) % n;
                    if (usable(buttons[j])) return j;
                }
                return -1;
            };
            let j = -1;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = seek(i, 1);
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = seek(i, -1);
            else if (e.key === 'Home') j = seek(-1, 1);
            else if (e.key === 'End') j = seek(n, -1);
            else return;
            e.preventDefault();
            if (j > -1) pick(values[j], true);
        });

        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            value = v != null && values.indexOf(String(v)) > -1 ? String(v) : null;
            paint();
        };
        paint();
        return root;
    }

    /**
     * Kit.saveNote({ busy }) -> { el, saving(), saved(), error(message, retry), refused(message), clear() }
     *
     * The save note (pick bars__save-note, "Settings save note"): the words
     * beside a control that say what happened to a change. Nothing while
     * idle (the note is empty and takes no room); "Saving…" in the grey;
     * "Saved" in green with a small tick, which fades after two seconds;
     * "Couldn't save. Try again." in red with Retry, which stays until it is
     * fixed; a refusal ("Only an admin can do this.") in red with no Retry.
     * Copied from SettingsUI.status (js/settings.js:1335) and .sf-status
     * (css/settings.css:784-832), which are unchanged. The kit has ONE save
     * note: Kit.settingRow draws this one.
     *
     * The note is a live region: a polite status, an alert while it says a
     * save failed or was refused. Retry is a real button with the kit's
     * shared focus ring; it calls `retry` bare, never handed the click.
     *
     * @param o.busy an element that carries aria-busy="true" while it saves
     *               (a setting row passes itself)
     */
    function saveNote(opts) {
        const o = opts || {};
        const root = el('span', { class: 'kit-save-note', role: 'status' });
        const busyOn = o.busy && o.busy.nodeType === 1 ? o.busy : null;
        let timer = null;
        function set(state, kids) {
            clearTimeout(timer);
            timer = null;
            root.dataset.state = state;
            root.replaceChildren.apply(root, kids);
            root.setAttribute('role', state === 'error' ? 'alert' : 'status');
            if (busyOn) {
                if (state === 'saving') busyOn.setAttribute('aria-busy', 'true');
                else busyOn.removeAttribute('aria-busy');
            }
        }
        const words = (text) => el('span', { class: 'kit-save-note__text', text: text });
        return {
            el: root,
            saving() {
                set('saving', [words('Saving…')]);
            },
            saved() {
                set('saved', [Kit.glyph('check', { cls: 'kit-save-note__check' }), words('Saved')]);
                // A note taken off the page is left as it was: nothing
                // touches it once it is gone.
                timer = setTimeout(() => {
                    timer = null;
                    if (!root.isConnected) return;
                    root.dataset.state = 'fading';
                    // Gone once the fade has run: --kit-dur-exit, read off
                    // the live element, so reduced motion shortens it too.
                    timer = setTimeout(() => {
                        timer = null;
                        if (root.isConnected) set('idle', []);
                    }, exitMs(root));
                }, 2000);
            },
            error(message, retry) {
                const kids = [words(message || 'Couldn’t save. Try again.')];
                if (typeof retry === 'function') {
                    const b = el('button', { class: 'kit-save-note__retry', type: 'button', text: 'Retry' });
                    // The caller's retry, called bare: never handed the click.
                    b.addEventListener('click', () => retry());
                    kids.push(b);
                }
                set('error', kids);
            },
            refused(message) {
                set('error', [words(message || 'Only an admin can do this.')]);
            },
            clear() {
                set('idle', []);
            }
        };
    }

    /**
     * A setting and its control (pick toggles__setting-row, "Settings row"):
     * the words on the left, the control on the right, a hairline between
     * rows, and the save note beside the control (Kit.saveNote: "Saving…",
     * then "Saved" fading after two seconds, or "Couldn't save. Try again."
     * with Retry, which stays until it is fixed). Copied from SettingsUI.row
     * (js/settings.js:1299). The row names its control after its label when
     * the control has no name of its own.
     *
     * @param o.label   the setting, in a few words
     * @param o.help    one line on what it does
     * @param o.control the Element (or [Element]) it sets: Kit.switch, Kit.tickBox, …
     * @param o.stacked true to put the control under the words (a wide control)
     * @returns { el, control, note, saving(), saved(), error(message, retry), refused(message), clear() };
     *          note is the row's Kit.saveNote
     */
    function settingRow(opts) {
        const o = opts || {};
        const id = nextId('setting-row');
        const lbl = el('div', { class: 'kit-setting-row__label', id: id + '-label', text: o.label || '' });
        const text = el('div', { class: 'kit-setting-row__text' }, [
            lbl,
            o.help ? el('div', { class: 'kit-setting-row__help', text: o.help }) : null
        ]);
        const root = el('div', { class: 'kit-setting-row' + (o.stacked ? ' kit-setting-row--stacked' : '') }, [text]);
        const note = saveNote({ busy: root });
        const ctl = el(
            'div',
            { class: 'kit-setting-row__control' },
            (Array.isArray(o.control) ? o.control : [o.control]).concat([note.el])
        );
        root.appendChild(ctl);
        // A group of pick chips is found before its first chip, as a radio
        // group is: the row names the group, and each chip keeps its own name.
        const focusable = ctl.querySelector(
            'button, [role="switch"], [role="radiogroup"], .kit-pick-chips, input, [tabindex]'
        );
        // ⛔ Not when it already has a name: aria-labelledby wins over a
        // <label for> and an aria-label, and would rename it. A fallback
        // (Kit.pickOne's "Options") is not a name of its own and gives way.
        const fallback = !!(focusable && focusable.kitFallbackName);
        const named =
            focusable &&
            !fallback &&
            ((focusable.labels && focusable.labels.length > 0) ||
                focusable.getAttribute('aria-label') ||
                focusable.getAttribute('aria-labelledby'));
        if (focusable && !named && o.label) {
            if (fallback) {
                focusable.removeAttribute('aria-label');
                focusable.kitFallbackName = false;
            }
            focusable.setAttribute('aria-labelledby', lbl.id);
        }

        return {
            el: root,
            control: ctl,
            note: note,
            saving: note.saving,
            saved: note.saved,
            error: note.error,
            refused: note.refused,
            clear: note.clear
        };
    }

    /* -----------------------------------------------------------------------
     * Popovers.
     *
     * One at a time, appended to document.body, positioned against their
     * anchor. Body-appended because an in-flow menu is clipped by the first
     * ancestor with overflow:hidden, which is what NexusUI's dropdown is
     * (position:absolute inside its own wrapper) and why it disappears inside a
     * scrolling panel.
     *
     * They close instantly. Only modal and drawer animate out; 180ms of fade on
     * a listbox is 180ms of nothing.
     *
     * One open at a time, except along a chain: a popover whose anchor sits
     * inside an open pop-up or dialog is that one's child (see `holds` above)
     * and leaves it open; every other open popover closes.
     * --------------------------------------------------------------------- */

    /** How close to a viewport edge a popover is allowed to sit. */
    const EDGE = 8;

    /**
     * Put a popover against its anchor, inside the viewport on both axes.
     *
     * ⛭ getBoundingClientRect FOR BOTH READS, WITH offsetHeight ONLY AS A
     * FALLBACK, AND THAT MIX IS CORRECT — do not collapse it to one or the
     * other. css/main.css sets `--page-zoom: 0.9` on `.portal-main`, where the
     * two disagree: a rect comes back in real viewport pixels and offsetHeight
     * in unscaled CSS pixels. Everything here is compared against
     * window.innerWidth and window.innerHeight, which are viewport pixels, so
     * the rect is the right unit on both sides. The anchor is usually INSIDE
     * .portal-main and therefore scaled, and its rect already accounts for
     * that, which is the reason to read it rather than offsetTop. The popover
     * is appended to the body or to a dialog box, both OUTSIDE .portal-main, so
     * it is unscaled and its rect height and its offsetHeight are the same
     * number — which is what makes the fallback safe rather than a unit
     * mismatch waiting for someone to trip over it.
     */
    function place(pop, anchor) {
        const r = anchor.getBoundingClientRect();
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        pop.style.position = 'fixed';
        if (r.width) pop.style.minWidth = Math.round(r.width) + 'px';

        const box = pop.getBoundingClientRect();
        const h = box.height || pop.offsetHeight || 0;
        const w = box.width || pop.offsetWidth || 0;

        // ⛔ THE HORIZONTAL AXIS IS MEASURED TOO. It used to copy the anchor's
        // left straight across, so a wide list on a right-hand control ran off
        // the screen with nothing to scroll it back — measured 133px past the
        // edge on a long option label. Clamped only when there is a real
        // measurement, so jsdom's all-zero rects leave the value alone; when
        // the popover is wider than the viewport the max pins it to the left
        // edge, which is the right way to lose.
        let left = r.left;
        if (vw > 0 && w > 0) left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
        pop.style.left = Math.round(left) + 'px';

        const below = vh - r.bottom;
        // jsdom lays nothing out, so h is 0 there and this never flips. That is
        // correct rather than lucky: with no measurement there is no reason to.
        const flip = h > 0 && below < h + EDGE && r.top > below;
        pop.classList.toggle('kit-pop--up', flip);
        if (flip) {
            pop.style.top = '';
            pop.style.bottom = Math.round(vh - r.top + 6) + 'px';
        } else {
            pop.style.bottom = '';
            pop.style.top = Math.round(r.bottom + 6) + 'px';
        }
    }

    /**
     * Where a popover mounts.
     *
     * ⛔ THE BODY, UNLESS A DIALOG IS OVER IT. Body-appending is what keeps a
     * menu from being clipped by the first ancestor with overflow:hidden, and
     * that reason does not go away. But a dialog carries aria-modal="true",
     * which tells assistive technology to ignore everything OUTSIDE it, so a
     * body-appended listbox opened from inside one is unreachable — and the
     * focus trap binds to the box, so Tab from that listbox is never handled
     * either. Mounting into the top overlay's box fixes both at once.
     *
     * 🪤 Measured safe for position:fixed: nothing in css/kit.css puts a
     * transform, filter or will-change on .kit-modal, .kit-drawer or either
     * __box, so no containing block is created and `fixed` still resolves
     * against the viewport. The one transform in reach is the `kit-enter`
     * keyframe on the box, which ends at `transform: none` and is over long
     * before a user can click anything. If a transform is ever added there,
     * this returns a clipped popover and the fix is a containing-block-aware
     * position, not a move back to the body.
     *
     * ⚠️ THE TRADE, STATED PLAINLY, BECAUSE THE DIALOG IS EXACTLY WHERE SOMEONE
     * WILL ADD ONE: re-parenting bought immunity from ancestor `overflow` and
     * sold sensitivity to ancestor `transform`, `filter`, `perspective`,
     * `backdrop-filter`, `contain: paint` and `will-change` naming any of them.
     * Any of those on .kit-modal, .kit-drawer or either __box makes it the
     * containing block for `position: fixed`, and every popover opened inside
     * the dialog is then positioned against the BOX and clipped by it — with no
     * error and nothing in the gate to catch it, because jsdom lays out
     * nothing. A slide-in drawer animation is the obvious way in. Nothing has
     * one today; check here before adding one.
     */
    function popHost() {
        for (let i = stack.length - 1; i >= 0; i--) {
            // The picked overlays (the pop-up window, the full screen) name
            // their own host; a side sheet names none, because it is not
            // modal and <body> is reachable beside it.
            if (stack[i].host) return stack[i].host;
            const box = stack[i].el && stack[i].el.querySelector('.kit-modal__box, .kit-drawer__box');
            if (box) return box;
        }
        return document.body;
    }

    function openPopover(anchor, pop, opts) {
        const o = opts || {};
        const parent = ownerOf(anchor);
        stack
            .slice()
            .reverse()
            .forEach((h) => {
                if (h.isPop && h !== parent && !descends(parent, h)) h.close();
            });
        popHost().appendChild(pop);
        place(pop, anchor);

        let done = false;

        function close() {
            if (done) return;
            done = true;
            const childFailed = closeChildren(handle);
            const at = stack.indexOf(handle);
            if (at > -1) stack.splice(at, 1);
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('click', onDown, true);
            document.removeEventListener('keydown', onEsc, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
            if (pop.parentNode) pop.parentNode.removeChild(pop);
            if (typeof o.onClose === 'function') o.onClose();
            if (o.restoreFocus !== false && anchor && typeof anchor.focus === 'function') anchor.focus();
            // A child's throw surfaces once this one has closed all the way.
            if (childFailed) throw childFailed;
        }

        function onDown(e) {
            if (!document.body.contains(pop)) {
                close();
                return;
            }
            const host = o.root || anchor;
            if (!holds(handle, e.target) && !host.contains(e.target)) close();
        }

        function onEsc(e) {
            if (e.key !== 'Escape') return;
            // ⛔ TOPMOST ONLY, off the SAME stack the panels use. Both handlers
            // sit on document in the capture phase, and listeners on one node
            // fire in registration order — stopPropagation does not stop a
            // sibling. The panel registered first, so it runs first; it bails
            // because this popover is above it, and then this one closes. When
            // popovers were not on the stack the panel saw itself on top and
            // closed the whole dialog out from under an open listbox.
            if (stack[stack.length - 1] !== handle) return;
            e.stopPropagation();
            close();
        }

        function onScroll(e) {
            // A scroll inside the list, or inside a list opened from it, is not
            // a scroll away from it.
            if (holds(handle, e.target)) return;
            close();
        }

        function onResize() {
            close();
        }

        // `anchor`: what opened it, where focus goes when something opened
        // from one of its rows outlives the row (focusBack, below).
        const handle = { el: pop, close: close, parent: parent, isPop: true, anchor: anchor };
        stack.push(handle);

        // ⛭ CAPTURE PHASE ONLY. The click that opened this popover is already
        // past document's capture phase by the time we get here, so a capture
        // listener cannot see its own opening click. A bubble listener would,
        // and the popover would close the instant it opened.
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('click', onDown, true);
        document.addEventListener('keydown', onEsc, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return handle;
    }

    function chevron() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'kit-select__chev');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        p.setAttribute('points', '6 9 12 15 18 9');
        svg.appendChild(p);
        return svg;
    }

    /**
     * A chooser: a button that opens a popover. The button, its label and its
     * expanded state are shared by select, the date picker and the time picker.
     */
    function chooserButton(id, extraClass) {
        const lbl = el('span', { class: 'kit-select__lbl' });
        const btn = el(
            'button',
            {
                class: 'kit-select__btn' + (extraClass ? ' ' + extraClass : ''),
                type: 'button',
                id: id,
                'aria-expanded': 'false'
            },
            [lbl, chevron()]
        );
        return { btn: btn, lbl: lbl };
    }

    /* -----------------------------------------------------------------------
     * Select.
     * --------------------------------------------------------------------- */
    function select(opts) {
        const o = opts || {};
        const options = listOf(o.options, 'select', 'options').map((x) =>
            typeof x === 'string' ? { value: x, label: x } : x
        );
        const placeholder = o.placeholder || 'Select an option';
        const btnId = o.id || nextId('select');
        const parts = chooserButton(btnId, null);
        const btn = parts.btn;
        const lbl = parts.lbl;
        let value = o.value == null ? null : String(o.value);
        let pop = null;

        btn.setAttribute('aria-haspopup', 'listbox');
        // ⛔ THE NAME GOES ON THE ROOT, BECAUSE THE ROOT IS WHAT HOLDS THE
        // VALUE. It used to sit on the button, and Kit.form's collector walks
        // `[name]`: it found the button, the button has no kitValue(), and it
        // fell through to `.value` — which for a <button> is the empty string.
        // Three of six controls in a form submitted nothing the user chose,
        // with no throw and no warning. `name` on a <button> is also the wrong
        // attribute for what we mean: on a real button it names the SUBMITTER's
        // entry, not the control's field.
        const root = el('div', { class: 'kit-select', name: o.name }, [btn]);

        function labelOf(v) {
            const hit = options.filter((x) => String(x.value) === String(v))[0];
            return hit ? hit.label : null;
        }

        function paint() {
            const t = value == null ? null : labelOf(value);
            // ⛔ The unselected state SAYS it is unselected. NexusUI.dropdown
            // falls back to normalizedOptions[0] when nothing matches
            // (js/nexus-ui.js:119), so an untouched filter silently claims a
            // value nobody chose and the request goes out narrowed.
            lbl.textContent = t == null ? placeholder : t;
            lbl.classList.toggle('is-placeholder', t == null);
        }

        function open() {
            if (pop) {
                pop.close();
                return;
            }
            const list = el('div', {
                class: 'kit kit-pop kit-pop--list',
                role: 'listbox',
                tabindex: '-1',
                'aria-labelledby': btnId
            });

            let active = options.map((x) => String(x.value)).indexOf(String(value));
            let buf = '';
            let bufAt = 0;

            const cells = options.map((opt, i) => {
                const c = el(
                    'div',
                    {
                        class: 'kit-pop__opt',
                        role: 'option',
                        id: btnId + '-opt-' + i,
                        'aria-selected': 'false',
                        dataset: { value: String(opt.value) }
                    },
                    [el('span', { class: 'kit-pop__opt-lbl', text: opt.label })]
                );
                c.addEventListener('click', () => commit(i));
                c.addEventListener('mousemove', () => mark(i));
                list.appendChild(c);
                return c;
            });
            if (!cells.length) list.appendChild(el('div', { class: 'kit-pop__none', text: 'Nothing to choose from' }));

            /**
             * What has actually been CHOSEN. `aria-selected` and nothing else.
             *
             * ⛔ NOT THE CURSOR. It used to be painted from the arrow-key
             * position, and moving the cursor commits nothing here — no
             * onChange, no change to `value` — so after two Downs a screen
             * reader announced "Charlie, selected" while the value was still
             * Alpha and the real selection had lost its marker entirely.
             * Measured: value `a`, aria-selected `false,false,true`.
             */
            function paintChosen() {
                cells.forEach((c, k) => {
                    c.setAttribute('aria-selected', String(options[k].value) === String(value) ? 'true' : 'false');
                });
            }

            /** Where the keyboard IS: `.is-active` and aria-activedescendant. */
            function mark(i) {
                active = i;
                cells.forEach((c, k) => c.classList.toggle('is-active', k === i));
                if (i > -1 && cells[i]) {
                    list.setAttribute('aria-activedescendant', cells[i].id);
                    // jsdom has no scrollIntoView at all, so this is guarded
                    // rather than assumed.
                    if (typeof cells[i].scrollIntoView === 'function') cells[i].scrollIntoView({ block: 'nearest' });
                } else {
                    list.removeAttribute('aria-activedescendant');
                }
            }

            function move(d) {
                if (!cells.length) return;
                const from = active < 0 ? (d > 0 ? -1 : 0) : active;
                mark((((from + d) % cells.length) + cells.length) % cells.length);
            }

            function commit(i) {
                if (i < 0 || i >= options.length) return;
                value = String(options[i].value);
                paint();
                const h = pop;
                pop = null;
                if (h) h.close();
                if (typeof o.onChange === 'function') o.onChange(value, options[i].label);
            }

            function typeAhead(ch) {
                const now = Date.now();
                buf = now - bufAt > 700 ? ch : buf + ch;
                bufAt = now;
                const needle = buf.toLowerCase();
                const from = active < 0 ? -1 : active;
                for (let k = 1; k <= cells.length; k++) {
                    const i = (((from + k) % cells.length) + cells.length) % cells.length;
                    if (String(options[i].label).toLowerCase().indexOf(needle) === 0) {
                        mark(i);
                        return;
                    }
                }
            }

            list.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(-1);
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    mark(0);
                } else if (e.key === 'End') {
                    e.preventDefault();
                    mark(cells.length - 1);
                } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    commit(active);
                } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    // ⛭ All three modifiers, Meta included. Type-ahead is for
                    // bare letters; Cmd-S over an open list is the browser's
                    // save, not a jump to an option starting with "s".
                    // __tests__/kit/iife.contract.test.js bans `metaKey` only
                    // where it sits beside the letter k, which is the command
                    // palette's binding and js/main.js already owns it. Reading
                    // the flag to IGNORE a keystroke is not a binding.
                    typeAhead(e.key);
                }
            });

            btn.setAttribute('aria-expanded', 'true');
            pop = openPopover(btn, list, {
                root: root,
                onClose: () => {
                    btn.setAttribute('aria-expanded', 'false');
                    pop = null;
                }
            });
            paintChosen();
            if (active > -1) mark(active);
            list.focus();
        }

        btn.addEventListener('click', open);
        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            value = v == null ? null : String(v);
            paint();
        };
        paint();
        return root;
    }

    /* -----------------------------------------------------------------------
     * Dates.
     *
     * ⛔⛔ EVERY DATE HERE IS CONSTRUCTED FROM COMPONENTS, NEVER PARSED FROM A
     * STRING. `new Date('2026-03-14')` is UTC midnight, and every render of it
     * west of UTC is the previous day: a picker that opens on the 13th when you
     * gave it the 14th, forever, on a control that otherwise looks perfect.
     * js/employees/ui.js tells the same story from production, in the
     * asLocalDate docblock.
     * --------------------------------------------------------------------- */
    const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function isoOf(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function fromIso(s) {
        if (typeof s !== 'string' || !ISO_SHAPE.test(s.trim())) return null;
        const p = s.trim().split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }

    function todayLocal() {
        const n = new Date();
        return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }

    function startOfMonth(d) {
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    function addMonths(d, n) {
        return new Date(d.getFullYear(), d.getMonth() + n, 1);
    }

    /**
     * The same day of an adjacent month, clamped to that month's length.
     *
     * ⛭ NOT addMonths, which returns the FIRST of the month because that is
     * what a calendar cursor needs. PageDown off the 14th should land on the
     * 14th; addMonths landed it on the 1st, silently, in both pickers.
     */
    function shiftMonth(d, n) {
        const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
        return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), daysInMonth(target)));
    }

    function addDays(d, n) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    }

    function daysInMonth(d) {
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    }

    /**
     * Hold a cursor date inside the span the calendar will actually let you
     * focus.
     *
     * ⛔⛔ A DISABLED BUTTON CANNOT TAKE FOCUS, AND focus() FAILS SILENTLY. An
     * out-of-range day gets the `disabled` property, so moving the cursor onto
     * one made the focus() call a no-op: focus fell to <body>, and because the
     * arrow handler is bound to the CALENDAR, every subsequent key went
     * nowhere. The range picker reached it in ONE keystroke — maxDate defaults
     * to today and the cursor starts on today, so a single ArrowRight froze the
     * whole dialog with Tab or Escape the only way out. The date picker reached
     * it on OPEN whenever its value or today fell outside min/max.
     *
     * 🪤 THE GATE STRUCTURALLY CANNOT SEE THIS, and not for the reason it first
     * looks like. jsdom refuses focus on a bare disabled <button> — measured —
     * but these cells carry an explicit tabindex, and with one present jsdom
     * focuses them regardless of `disabled`. So in jsdom the cursor lands on the
     * dead cell, the handler keeps receiving keys, and the identical sequence
     * walks cleanly. Measured both ways. The assertion that survives the
     * difference is the one the tests make: the cursor cell is never disabled.
     */
    function clampDate(d, min, max) {
        if (min && d < min) return min;
        if (max && d > max) return max;
        return d;
    }

    function sameDay(a, b) {
        if (!a || !b) return false;
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function monthTitle(d) {
        return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    function dayLabel(d) {
        const s = Kit.fmt && typeof Kit.fmt.date === 'function' ? Kit.fmt.date(isoOf(d)) : null;
        return s || isoOf(d);
    }

    function dowRow() {
        return el(
            'div',
            { class: 'kit-cal__dow', 'aria-hidden': 'true' },
            DOW.map((d) => el('span', { class: 'kit-cal__dow-cell', text: d }))
        );
    }

    /**
     * The cells of one month. `cfg.state(date)` returns the extra classes a
     * caller wants on a day, which is how the range picker paints a span
     * without this function knowing what a range is.
     */
    function monthCells(month, cfg) {
        const first = startOfMonth(month);
        const total = daysInMonth(month);
        const today = todayLocal();
        const out = [];

        // Sunday-start, matching the grid in js/argus-range-picker.js so the two
        // calendars in this portal do not disagree about where a week begins.
        for (let i = 0; i < first.getDay(); i++) {
            out.push(el('span', { class: 'kit-cal__cell kit-cal__cell--blank', 'aria-hidden': 'true' }));
        }
        for (let d = 1; d <= total; d++) {
            const date = new Date(first.getFullYear(), first.getMonth(), d);
            const iso = isoOf(date);
            const off = (cfg.min && date < cfg.min) || (cfg.max && date > cfg.max);
            const cell = el(
                'button',
                {
                    class: 'kit-cal__cell',
                    type: 'button',
                    tabindex: '-1',
                    'aria-label': dayLabel(date),
                    dataset: { date: iso }
                },
                [el('span', { class: 'kit-cal__num', text: String(d) })]
            );
            if (off) {
                cell.disabled = true;
                cell.classList.add('is-off');
            }
            if (sameDay(date, today)) cell.classList.add('is-today');
            (cfg.state ? cfg.state(date) : []).forEach((c) => cell.classList.add(c));
            cell.addEventListener('click', () => {
                if (!off) cfg.onPick(iso, date);
            });
            out.push(cell);
        }
        return out;
    }

    /**
     * Roving tabindex over a set of peers: the one `wanted` picks is the tab
     * stop and the rest are reachable only by arrow key. Falls back to the
     * first enabled peer, so a set with nothing chosen is still reachable at
     * all — which is the state a range picker opens in.
     */
    function rove(items, wanted) {
        if (!items.length) return;
        const at = items.filter(wanted)[0] || items.filter((n) => !n.disabled)[0] || items[0];
        items.forEach((n) => n.setAttribute('tabindex', n === at ? '0' : '-1'));
    }

    /** One month pane: head with optional nav, weekday row, grid. */
    function monthPane(month, cfg) {
        const head = el('div', { class: 'kit-cal__head' });
        if (cfg.onPrev) {
            const prev = el('button', { class: 'kit-cal__nav', type: 'button', 'aria-label': 'Previous month' }, [
                el('span', { 'aria-hidden': 'true', text: '‹' })
            ]);
            prev.addEventListener('click', cfg.onPrev);
            head.appendChild(prev);
        } else {
            head.appendChild(el('span', { class: 'kit-cal__nav kit-cal__nav--gap', 'aria-hidden': 'true' }));
        }
        head.appendChild(el('span', { class: 'kit-cal__title', text: monthTitle(month) }));
        if (cfg.onNext) {
            const next = el('button', { class: 'kit-cal__nav', type: 'button', 'aria-label': 'Next month' }, [
                el('span', { 'aria-hidden': 'true', text: '›' })
            ]);
            next.addEventListener('click', cfg.onNext);
            head.appendChild(next);
        } else {
            head.appendChild(el('span', { class: 'kit-cal__nav kit-cal__nav--gap', 'aria-hidden': 'true' }));
        }

        // ⛔ NO role="grid". A grid promises rows and gridcells, and this is
        // forty-two bare buttons in a wrapper: a role that describes a
        // structure which is not there is a worse contract than no role, because
        // assistive technology navigates by the promise. The buttons speak for
        // themselves — each one's aria-label is already a full date.
        const grid = el('div', { class: 'kit-cal__grid' }, monthCells(month, cfg));
        return el('div', { class: 'kit-cal__month' }, [head, dowRow(), grid]);
    }

    function datePicker(opts) {
        const o = opts || {};
        const min = fromIso(o.min);
        const max = fromIso(o.max);
        const btnId = o.id || nextId('date');
        const parts = chooserButton(btnId, 'kit-select__btn--date');
        const btn = parts.btn;
        const lbl = parts.lbl;
        let value = ISO_SHAPE.test(String(o.value || '')) ? o.value : null;
        let pop = null;

        btn.setAttribute('aria-haspopup', 'dialog');
        // On the root, for the reason spelled out in `select` above.
        const root = el('div', { class: 'kit-select kit-select--date', name: o.name }, [btn]);

        function paint() {
            const d = fromIso(value);
            lbl.textContent = d ? dayLabel(d) : o.placeholder || 'Select a date';
            lbl.classList.toggle('is-placeholder', !d);
        }

        function open() {
            if (pop) {
                pop.close();
                return;
            }
            let cue = clampDate(fromIso(value) || todayLocal(), min, max);
            let cursor = startOfMonth(cue);

            const cal = el('div', {
                class: 'kit kit-pop kit-cal',
                role: 'dialog',
                'aria-label': 'Choose a date',
                tabindex: '-1'
            });

            function pick(iso) {
                value = iso;
                paint();
                const h = pop;
                pop = null;
                if (h) h.close();
                if (typeof o.onChange === 'function') o.onChange(iso);
            }

            function draw() {
                cal.replaceChildren(
                    monthPane(cursor, {
                        min: min,
                        max: max,
                        onPick: pick,
                        onPrev: () => {
                            cursor = addMonths(cursor, -1);
                            draw();
                        },
                        onNext: () => {
                            cursor = addMonths(cursor, 1);
                            draw();
                        },
                        state: (d) => {
                            const out = [];
                            if (value && isoOf(d) === value) out.push('is-on');
                            if (sameDay(d, cue)) out.push('is-cue');
                            return out;
                        }
                    })
                );
                focusCue();
            }

            /**
             * Put focus on the roving cursor. Separate from draw() because the
             * first draw happens while the calendar is still DETACHED, and
             * focusing a node that is not in the document is a silent no-op
             * that would leave the keyboard on the button.
             */
            function focusCue() {
                const at = cal.querySelector('[data-date="' + isoOf(cue) + '"]');
                if (at && cal.isConnected) at.focus();
            }

            /** One way in, so the clamp cannot be forgotten on a new key. */
            function moveCue(next) {
                cue = clampDate(next, min, max);
                cursor = startOfMonth(cue);
                draw();
            }

            cal.addEventListener('keydown', (e) => {
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                if (step) {
                    e.preventDefault();
                    moveCue(addDays(cue, step));
                } else if (e.key === 'PageUp' || e.key === 'PageDown') {
                    e.preventDefault();
                    moveCue(shiftMonth(cue, e.key === 'PageUp' ? -1 : 1));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    // The clamp already holds the cursor inside min..max, so this
                    // is now only reachable when a caller passes min AFTER max —
                    // a span with no valid day in it, where refusing is right.
                    if (!(min && cue < min) && !(max && cue > max)) pick(isoOf(cue));
                }
            });

            btn.setAttribute('aria-expanded', 'true');
            // ⛔ DRAW BEFORE OPEN. openPopover measures the popover to decide
            // whether it has room below its anchor, and this used to run after
            // it: place() sized an EMPTY calendar at about 10px against a real
            // 346, so `below < h + 8` was a comparison against nothing and the
            // flip never fired. A date picker in the lower third of any viewport
            // rendered a third of itself off the bottom of the screen, on every
            // viewport, forever. The select never showed it because select
            // builds its options before it opens.
            draw();
            pop = openPopover(btn, cal, {
                root: root,
                onClose: () => {
                    btn.setAttribute('aria-expanded', 'false');
                    pop = null;
                }
            });
            focusCue();
        }

        btn.addEventListener('click', open);
        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            value = ISO_SHAPE.test(String(v || '')) ? v : null;
            paint();
        };
        paint();
        return root;
    }

    /**
     * A time of day, in `step`-minute slots. The VALUE is 24-hour `HH:MM`; the
     * label goes through core's clock so a slot here reads like every other time
     * in the portal. Kit.fmt.time takes an instant, so the label is built from a
     * throwaway date at that hour and minute.
     */
    function timePicker(opts) {
        const o = opts || {};
        const step = Number(o.step) || 15;
        const slots = [];
        for (let mins = 0; mins < 24 * 60; mins += step) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            const stamp = new Date(2000, 0, 1, h, m, 0, 0);
            const shown = Kit.fmt && typeof Kit.fmt.time === 'function' ? Kit.fmt.time(stamp) : null;
            slots.push({ value: pad2(h) + ':' + pad2(m), label: shown || pad2(h) + ':' + pad2(m) });
        }
        const root = select({
            options: slots,
            value: o.value,
            id: o.id,
            name: o.name,
            placeholder: o.placeholder || 'Select a time',
            onChange: o.onChange
        });
        root.classList.add('kit-select--time');
        return root;
    }

    /* -----------------------------------------------------------------------
     * Range picker.
     *
     * The rail is js/argus-range-picker.js's own RAIL_KEYS, resolved through
     * its WINDOWS and WINDOW_RANGE tables, READ AT CALL TIME. That file is a
     * wave-2 lazy script (js/main.js:341) and the four kit files are deferred
     * tags that run before it, so a table captured at load would be the
     * fallback for the life of the page. argus-period-bar has to be ordered
     * behind the picker for exactly this reason (js/argus-period-bar.js:119-125);
     * reading late means the kit does not care about the order at all.
     *
     * The literal fallback is not a second vocabulary. It says what the shipped
     * table says, and __tests__/kit/forms.render.test.js compares them, because
     * a key that means one span before the picker loads and another after is
     * worse than having no fallback at all.
     * --------------------------------------------------------------------- */
    const RAIL_KEYS = ['today', '7d', '30d', '90d', 'mtd', 'qtd', 'all'];

    const FALLBACK_WINDOWS = [
        { key: 'today', label: 'Today' },
        { key: '7d', label: 'Last 7 days' },
        { key: '30d', label: 'Last 30 days' },
        { key: '90d', label: 'Last 90 days' },
        { key: 'mtd', label: 'Month to date' },
        { key: 'qtd', label: 'Quarter to date' },
        { key: 'all', label: 'All time' }
    ];

    const FALLBACK_RANGE = {
        today: (t) => [t, t],
        '7d': (t) => [addDays(t, -6), t],
        '30d': (t) => [addDays(t, -29), t],
        '90d': (t) => [addDays(t, -89), t],
        mtd: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), t],
        qtd: (t) => [new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1), t],
        // No epoch to anchor to on the client, so this matches the picker's own
        // choice of an early date over a null.
        all: (t) => [new Date(2020, 0, 1), t]
    };

    function railWindows() {
        const rp = window.ArgusRangePicker;
        const table = rp && Array.isArray(rp.WINDOWS) ? rp.WINDOWS : null;
        return RAIL_KEYS.map((key) => {
            const shipped = table ? table.filter((x) => x.key === key)[0] : null;
            if (shipped) return { key: key, label: shipped.label };
            return FALLBACK_WINDOWS.filter((x) => x.key === key)[0];
        }).filter(Boolean);
    }

    function resolveWindow(key) {
        const rp = window.ArgusRangePicker;
        const shipped =
            rp && rp.WINDOW_RANGE && typeof rp.WINDOW_RANGE[key] === 'function' ? rp.WINDOW_RANGE[key] : null;
        const fn = shipped || FALLBACK_RANGE[key];
        if (typeof fn !== 'function') return null;
        const pair = fn(todayLocal());
        if (!pair || pair.length !== 2 || !pair[0] || !pair[1]) return null;
        // Normalised to midnight local, because the picker's `all` hands back a
        // `new Date()` with a time on it and a range comparison would then
        // depend on when in the day it was opened.
        return [
            new Date(pair[0].getFullYear(), pair[0].getMonth(), pair[0].getDate()),
            new Date(pair[1].getFullYear(), pair[1].getMonth(), pair[1].getDate())
        ];
    }

    function rangePicker(opts) {
        const o = opts || {};
        return new Promise((resolve) => {
            let settled = false;
            const answer = (v) => {
                if (settled) return;
                settled = true;
                resolve(v);
            };

            const max = fromIso(o.maxDate) || todayLocal();
            let from = fromIso(o.from);
            let to = fromIso(o.to);
            let cursor = startOfMonth(from || max);
            let apply = null;
            // ⛔ THE CALENDAR HAD NO KEYBOARD AT ALL. Sixty-one day cells, every
            // one tabindex="-1" from monthCells and no handler anywhere: nothing
            // in the grid was reachable or operable. Paired with a preset that
            // goes inert when its window has no reachable day, a keyboard user
            // could be left with no way to pick a range by any route. The date
            // picker had this roving cursor from the start; the range picker
            // never got one.
            let cue = clampDate(from || to || max, null, max);

            const rail = el('div', { class: 'kit-range__rail', role: 'listbox', 'aria-label': 'Preset ranges' });
            const months = el('div', { class: 'kit-range__months' });
            const hint = el('p', { class: 'kit-range__hint' });

            /**
             * A window with no reachable day in it.
             *
             * ⛔ ONE TEST, TWO CONSUMERS, AND THAT IS THE POINT. The click
             * handler refuses this window and `draw` paints it unavailable; if
             * each carried its own copy of the arithmetic they would drift and
             * the picker would show a live-looking option that does nothing --
             * which is exactly the state this replaces.
             */
            const unreachable = (pair) => !pair || pair[0] > max;

            railWindows().forEach((w) => {
                const b = el('button', {
                    class: 'kit-range__preset',
                    type: 'button',
                    role: 'option',
                    'aria-selected': 'false',
                    text: w.label,
                    dataset: { preset: w.key }
                });
                b.addEventListener('click', () => {
                    const pair = resolveWindow(w.key);
                    // ⛔ THE FAR END IS CLAMPED AND THE NEAR END IS CHECKED, and
                    // both halves are needed. Every caller today passes
                    // maxDate: today (js/kit/components.js:581), where a window
                    // counted back from today always starts before the ceiling
                    // and clamping `to` alone is indistinguishable from doing it
                    // properly. Pass a ceiling in the PAST and the two come
                    // apart: "last 7 days" then begins after it, so `from` lands
                    // AFTER `to`. Nothing in the calendar paints a backwards
                    // range — `is-in-range` needs `d > from && d < to` — so it
                    // reads as an empty selection while Apply stays enabled and
                    // hands the caller a pair no query can satisfy. A window
                    // with no reachable day in it does nothing instead.
                    // ⛭ AND IT NO LONGER DOES IT SILENTLY. Measured in
                    // Chromium 2026-09-03 with a ceiling in the past: SIX of the
                    // seven presets refused here and only "All time" answered,
                    // while all seven kept an identical paint, a pointer cursor
                    // and a tab stop. `draw` now marks this same condition
                    // aria-disabled and css/kit.css paints it, so the refusal is
                    // visible before the click rather than inferred after it.
                    if (unreachable(pair)) return;
                    from = pair[0];
                    to = pair[1] > max ? max : pair[1];
                    cursor = startOfMonth(from);
                    draw();
                });
                rail.appendChild(b);
            });

            /** The two months on screen right now. */
            function inView(d) {
                return d >= startOfMonth(cursor) && d < addMonths(cursor, 2);
            }

            /**
             * Move the roving cursor, scrolling the pair of months if it left
             * them, and take focus with it.
             *
             * ⛭ Enter and Space are deliberately NOT handled. A day cell is a
             * <button>, so the browser activates it on both, and a handler here
             * would either double-fire with that native click or need a
             * preventDefault to suppress it. The date picker's cal handler does
             * preventDefault for exactly that reason; here there is nothing to
             * suppress.
             */
            function moveCue(next) {
                cue = clampDate(next, null, max);
                if (!inView(cue)) cursor = startOfMonth(cue);
                draw();
                const at = months.querySelector('[data-date="' + isoOf(cue) + '"]');
                if (at) at.focus();
            }

            months.addEventListener('keydown', (e) => {
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                if (step) {
                    e.preventDefault();
                    moveCue(addDays(cue, step));
                } else if (e.key === 'PageUp' || e.key === 'PageDown') {
                    e.preventDefault();
                    moveCue(shiftMonth(cue, e.key === 'PageUp' ? -1 : 1));
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    moveCue(startOfMonth(cue));
                } else if (e.key === 'End') {
                    e.preventDefault();
                    moveCue(new Date(cue.getFullYear(), cue.getMonth(), daysInMonth(cue)));
                }
            });

            /**
             * The rail is a listbox, so it is ONE tab stop with arrow keys
             * inside it, not seven stops in a row. That is also what earns the
             * role: `role="option"` replaces the button role a screen reader
             * would otherwise announce, and it is only an honest trade if the
             * listbox keyboard model comes with it.
             */
            rail.addEventListener('keydown', (e) => {
                const presets = Array.from(rail.children);
                if (!presets.length) return;
                const at = presets.indexOf(document.activeElement);
                let next = -1;
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = at < 0 ? 0 : (at + 1) % presets.length;
                else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
                    next = at < 0 ? presets.length - 1 : (at - 1 + presets.length) % presets.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = presets.length - 1;
                if (next < 0) return;
                e.preventDefault();
                presets.forEach((b, k) => b.setAttribute('tabindex', k === next ? '0' : '-1'));
                presets[next].focus();
            });

            function pick(iso, date) {
                // Click, click: the first click starts a new range and the
                // second ends it. A second click BEFORE the first is a range
                // read backwards, not an error message.
                if (!from || to) {
                    from = date;
                    to = null;
                } else if (date < from) {
                    to = from;
                    from = date;
                } else {
                    to = date;
                }
                // ⛔ THROUGH moveCue, NOT draw(). Picking rebuilds the grid, so
                // the cell that was just activated is gone and focus went with
                // it: measured, activeElement was <body> after the first pick.
                // A keyboard user could choose a START and then had no way to
                // choose an END, which is the one thing this dialog is for.
                moveCue(date);
            }

            function stateOf(d) {
                const out = [];
                if (sameDay(d, cue)) out.push('is-cue');
                if (from && sameDay(d, from)) out.push('is-start');
                if (to && sameDay(d, to)) out.push('is-end');
                if (from && to && d > from && d < to) out.push('is-in-range');
                return out;
            }

            function draw() {
                const cfg = { max: max, onPick: pick, state: stateOf };
                months.replaceChildren(
                    monthPane(
                        cursor,
                        Object.assign({}, cfg, {
                            onPrev: () => {
                                cursor = addMonths(cursor, -1);
                                draw();
                            }
                        })
                    ),
                    monthPane(
                        addMonths(cursor, 1),
                        Object.assign({}, cfg, {
                            onNext: () => {
                                cursor = addMonths(cursor, 1);
                                draw();
                            }
                        })
                    )
                );
                hint.textContent = !from
                    ? 'Pick a start date'
                    : !to
                      ? 'Pick an end date'
                      : dayLabel(from) + ' to ' + dayLabel(to);
                Array.from(rail.children).forEach((b) => {
                    const pair = resolveWindow(b.dataset.preset);
                    const end = pair ? (pair[1] > max ? max : pair[1]) : null;
                    // ⛭ aria-disabled, NOT the `disabled` property, and the
                    // reason is measured rather than stylistic. This rail is a
                    // roving-tabindex listbox: `rove` below hands exactly one
                    // child a tabindex of 0 and the arrow keys read
                    // `presets.indexOf(document.activeElement)` to move, so an
                    // option that drops out of the tab order breaks the
                    // arithmetic around it. A `disabled` button also still
                    // ACCEPTS focus once it carries an explicit tabindex, which
                    // would park the cursor on a dead option and keep sending it
                    // keys. aria-disabled keeps the option in the rail, says it
                    // is unavailable, and leaves refusing the click to the
                    // handler that already does it.
                    b.setAttribute('aria-disabled', unreachable(pair) ? 'true' : 'false');
                    // ⛭ SELECTED, NOT PRESSED. The rail is a listbox and each
                    // preset is an option; `aria-pressed` is a button state,
                    // assistive technology drops it on role="option", and the
                    // rule in css/kit.css:2287 that paints the chosen preset is
                    // keyed off `aria-selected` and nothing else. The precedent
                    // is `.kit-pop__opt`, also an option in a listbox — NOT
                    // `.kit-seg`, which is a role-less toggle button and
                    // genuinely takes pressed.
                    // The unclamped start is compared on purpose: it is what
                    // keeps two presets whose ends both land on `max` from
                    // reading as selected at the same time.
                    const on = !!(pair && from && to && sameDay(pair[0], from) && sameDay(end, to));
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                // Exactly one tab stop in each of the two groups, so the dialog
                // is a handful of stops rather than sixty-eight.
                rove(Array.from(rail.children), (b) => b.getAttribute('aria-selected') === 'true');
                rove(
                    Array.from(months.querySelectorAll('.kit-cal__cell[data-date]')),
                    (c) => c.dataset.date === isoOf(cue)
                );
                if (apply) apply.disabled = !(from && to);
            }

            const handle = panel('modal', {
                title: 'Select date range',
                size: 'lg',
                body: el('div', { class: 'kit-range' }, [
                    rail,
                    el('div', { class: 'kit-range__body' }, [months, hint])
                ]),
                actions: [
                    { label: 'Cancel', onClick: (h) => h.close(null) },
                    {
                        label: 'Apply',
                        primary: true,
                        onClick: (h) => {
                            if (from && to) h.close({ from: isoOf(from), to: isoOf(to) });
                        }
                    }
                ],
                // Escape, the scrim and Cancel all arrive as something without a
                // `from`, and every one of them means the caller keeps what it
                // already had.
                onClose: (r) => answer(r && r.from ? { from: r.from, to: r.to } : null)
            });
            apply = handle.el.querySelector('.kit-modal__foot .kit-btn--primary');
            draw();
            // panel() focuses the first focusable in the box, which is the close
            // X. The first preset is what the dialog is actually for, and it
            // announces as "Preset ranges, listbox" on the way in.
            const firstPreset = rail.querySelector('.kit-range__preset');
            if (firstPreset) firstPreset.focus();
        });
    }

    /* -----------------------------------------------------------------------
     * The rest of the date-range family (owner picks, 2026-09-28): the button
     * that says which dates a view shows, the quick range choice beside it,
     * and a strip of days. Copied from the picked sources into the kit, never
     * edited there: Financials > Transactions' Dates button
     * (js/financials/view-transactions.js:806), Settings' period switch
     * (js/settings/controls.js:180) and Inventory > Money > Day's strip
     * (js/inventory/day-close.js:210).
     * --------------------------------------------------------------------- */

    /**
     * The dates button: an icon and the words for the dates a view shows.
     * A click opens Kit.rangePicker, the one custom-range dialog, and it reads
     * as open (aria-expanded) until that dialog answers.
     *
     * @param o.label   the words to show; default "A to B" from `from`/`to`, else "Dates"
     * @param o.format  ({ from, to }) -> words, used after a pick
     * @param o.from, o.to, o.maxDate  ISO days handed to Kit.rangePicker
     * @param o.onChange  ({ from, to }) after Apply; Cancel changes nothing
     */
    function rangeButton(opts) {
        const o = opts || {};
        const iso = (v) => (ISO_SHAPE.test(String(v || '')) ? String(v) : null);
        let from = iso(o.from);
        let to = iso(o.to);
        let words = o.label || null;
        const lbl = el('span', { class: 'kit-range-button__lbl' });
        const btn = el(
            'button',
            {
                class: 'kit-range-button',
                type: 'button',
                id: o.id,
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false'
            },
            [Kit.glyph('calendar', { cls: 'kit-range-button__icon' }), lbl]
        );

        function paint() {
            lbl.textContent =
                words || (from && to ? dayLabel(fromIso(from)) + ' to ' + dayLabel(fromIso(to)) : 'Dates');
        }

        btn.addEventListener('click', () => {
            if (btn.getAttribute('aria-expanded') === 'true') return;
            btn.setAttribute('aria-expanded', 'true');
            rangePicker({ from: from, to: to, maxDate: o.maxDate }).then((r) => {
                btn.setAttribute('aria-expanded', 'false');
                if (!r) return;
                from = r.from;
                to = r.to;
                words = typeof o.format === 'function' ? o.format({ from: from, to: to }) || null : null;
                paint();
                if (typeof o.onChange === 'function') o.onChange({ from: from, to: to });
            });
        });
        btn.kitValue = function () {
            return from && to ? { from: from, to: to } : null;
        };
        btn.kitSet = function (v) {
            const x = v || {};
            from = iso(x.from);
            to = iso(x.to);
            words = x.label || null;
            paint();
        };
        paint();
        return btn;
    }

    /**
     * The quick range choice: a few windows side by side in a tray, one chosen.
     * Radio semantics with a roving tab stop; the arrows move AND choose, the
     * platform radio behaviour, and skip a disabled option.
     *
     * @param o.options [{ id, label, disabled }]
     * @param o.value   the id that starts chosen
     * @param o.label   the group's accessible name
     * @param o.size    'sm' for the compact row
     */
    function rangePresets(opts) {
        const o = opts || {};
        const options = listOf(o.options, 'rangePresets', 'options');
        const root = el('div', {
            class: 'kit-range-presets' + (o.size === 'sm' ? ' kit-range-presets--sm' : ''),
            role: 'radiogroup',
            'aria-label': o.label || 'Dates'
        });
        let value = o.value == null ? null : String(o.value);
        const buttons = options.map((opt) => {
            const b = el('button', {
                class: 'kit-range-presets__opt',
                type: 'button',
                role: 'radio',
                'aria-checked': 'false',
                dataset: { value: String(opt.id) },
                text: opt.label || String(opt.id)
            });
            if (opt.disabled) b.disabled = true;
            root.appendChild(b);
            return b;
        });
        const usable = (b) => !!b && !b.disabled;

        function paint() {
            let chosen = null;
            buttons.forEach((b) => {
                const on = b.dataset.value === value;
                b.setAttribute('aria-checked', on ? 'true' : 'false');
                b.tabIndex = -1;
                if (on) chosen = b;
            });
            // The chosen option is the way in only when it can take focus;
            // nothing chosen, or a chosen one that is off, and the first
            // usable option is, so the group never drops out of the tab order.
            const stop = usable(chosen) ? chosen : buttons.filter(usable)[0] || buttons[0];
            if (stop) stop.tabIndex = 0;
        }

        function pick(v) {
            if (v === value) return;
            value = v;
            paint();
            if (typeof o.onChange === 'function') o.onChange(value);
        }

        buttons.forEach((b, i) => {
            b.addEventListener('click', () => pick(b.dataset.value));
            b.addEventListener('keydown', (e) => {
                const n = buttons.length;
                const seek = (start, dir) => {
                    for (let s = 1; s <= n; s++) {
                        const j = (((start + dir * s) % n) + n) % n;
                        if (usable(buttons[j])) return j;
                    }
                    return null;
                };
                let j = null;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = seek(i, 1);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = seek(i, -1);
                else if (e.key === 'Home') j = seek(-1, 1);
                else if (e.key === 'End') j = seek(n, -1);
                else return;
                e.preventDefault();
                if (j === null || j === i) return;
                buttons[j].focus();
                pick(buttons[j].dataset.value);
            });
        });
        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            value = v == null ? null : String(v);
            paint();
        };
        paint();
        return root;
    }

    const STRIP_DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const STRIP_MARKS = ['ok', 'warn', 'todo'];

    /**
     * A strip of days, oldest on the left so it reads like a calendar: the
     * narrow weekday, the date, and an optional status mark (`ok` a filled
     * green dot, `warn` a filled amber one, `todo` an amber ring). One day is
     * chosen, carried in aria-pressed.
     *
     * @param o.days   [{ date: 'YYYY-MM-DD', mark, status }] in display order;
     *                 `status` is the words the mark stands for, read aloud
     * @param o.value  the chosen day
     * @param o.label  the group's accessible name
     * @param o.onPick (date) when a day is chosen
     */
    function dayStrip(opts) {
        const o = opts || {};
        const days = listOf(o.days, 'dayStrip', 'days');
        let value = o.value == null ? null : String(o.value);
        const root = el('div', { class: 'kit-day-strip', role: 'group', 'aria-label': o.label || 'Pick a day' });
        const buttons = days.map((d) => {
            const date = fromIso(d.date);
            const mark = STRIP_MARKS.indexOf(d.mark) > -1 ? d.mark : null;
            const spoken = (date ? dayLabel(date) : String(d.date)) + (d.status ? ', ' + d.status : '');
            const b = el(
                'button',
                {
                    class: 'kit-day-strip__day',
                    type: 'button',
                    'aria-pressed': 'false',
                    'aria-label': spoken,
                    dataset: { date: String(d.date) }
                },
                [
                    el('span', { class: 'kit-day-strip__w', text: date ? STRIP_DOW[date.getDay()] : '' }),
                    el('span', { class: 'kit-day-strip__n', text: date ? String(date.getDate()) : '' }),
                    mark
                        ? el('span', {
                              class: 'kit-day-strip__mark kit-day-strip__mark--' + mark,
                              'aria-hidden': 'true'
                          })
                        : null
                ]
            );
            b.addEventListener('click', () => {
                value = b.dataset.date;
                paint();
                if (typeof o.onPick === 'function') o.onPick(value);
            });
            root.appendChild(b);
            return b;
        });

        function paint() {
            buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.date === value ? 'true' : 'false'));
        }

        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            value = v == null ? null : String(v);
            paint();
        };
        paint();
        return root;
    }

    /* -----------------------------------------------------------------------
     * The text boxes family (owner picks, 2026-09-28): the money and number
     * box, the search box, the search inside a pop-up and the sign-in field.
     * Copied from the picked sources into the kit, never edited there:
     * Financials > Transactions' amount filter (js/financials/controls.js:3054)
     * and toolbar search (js/financials/view-transactions.js:748), the Search
     * ARGUS pop-up (index.html:3512) and the sign-in page (index.html:834).
     * The plain text box and the box inside a table row are one class on an
     * <input> each (css/kit-standards.css) and need no factory.
     * --------------------------------------------------------------------- */

    /**
     * A figure as the money box reads it, after the currency mark is gone: an
     * optional minus, a whole part that is plain digits or comma-grouped in
     * threes, and an optional fraction. Groups: sign, whole, fraction.
     */
    const MONEY_FIGURE = /^(-)?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

    /** Financials' operator glyphs (js/financials/controls.js:277-279), by the line style's names. */
    const MONEY_OPS = { eq: 'equals', gte: 'gte', lte: 'lte' };

    /**
     * The money and number box: an optional label, then one box holding an
     * operator glyph, a currency mark and the figure.
     *
     * ⛭ MONEY IS CENTS, IN AND OUT, as Kit.input's money field is. With
     * `currency: ''` it is a plain number instead. The box shows the figure
     * ("250.00"), never the cents.
     *
     * Reading follows the Financials box it is copied from: text it cannot
     * read marks the box invalid and keeps the last good value, and a figure
     * is taken on `change` or Enter, not on every keystroke. What it reads is
     * wider, as Kit.input's money field's is: a minus may lead, before or
     * after the currency mark ("-$8.05" and "$-8.05" are the same refund), the
     * whole part may be left out (".50" is 50 cents), and a comma is read only
     * where a thousands comma sits, so "1,234.50" reads and "1,2,3" is refused
     * rather than quietly read as 123.
     *
     * @param o.label       the words above the box, and its accessible name
     * @param o.op          'eq' | 'gte' | 'lte': the glyph before the figure
     * @param o.currency    the mark before the figure, '$' by default
     * @param o.value       cents, or the plain number
     * @param o.placeholder '0.00' by default
     * @param o.disabled    starts switched off
     * @param o.id, o.name  on the field itself
     * @param o.onChange    (value) when a new, readable figure is taken
     *
     * Returns the field. kitValue(), kitSet(v), kitSetInvalid(on) and
     * kitSetDisabled(on) are on it; the last two mark the box AND the field,
     * because the box's edge cannot see the field's own attributes.
     */
    function moneyNumber(opts) {
        const o = opts || {};
        const cur = o.currency == null ? '$' : String(o.currency);
        const money = cur !== '';
        const id = o.id || nextId('money');
        const input = el('input', {
            class: 'kit-money-number__input',
            id: id,
            name: o.name,
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
            placeholder: o.placeholder == null ? '0.00' : String(o.placeholder)
        });
        if (!o.label) input.setAttribute('aria-label', money ? 'Amount' : 'Number');
        const box = el('div', { class: 'kit-money-number' }, [
            MONEY_OPS[o.op] ? Kit.glyph(MONEY_OPS[o.op], { cls: 'kit-money-number__op' }) : null,
            money ? el('span', { class: 'kit-money-number__cur', text: cur }) : null,
            input
        ]);
        const root = el('div', { class: 'kit-money-number__field' }, [
            o.label ? el('label', { class: 'kit-money-number__label', for: id, text: o.label }) : null,
            box
        ]);
        let value = null;

        // null for an empty box, NaN for text that is not a figure. The
        // figure is read as digits, never through parseFloat, so 1234.56 is
        // 123456 cents exactly.
        function read(text) {
            let t = String(text == null ? '' : text).replace(/\s/g, '');
            if (money) {
                // One currency mark, first or straight after a leading minus.
                const at = t.indexOf(cur);
                if (at === 0 || (at === 1 && t.charAt(0) === '-')) t = t.slice(0, at) + t.slice(at + cur.length);
            }
            if (!t) return null;
            const m = MONEY_FIGURE.exec(t);
            if (!m || (!m[2] && !m[3])) return NaN;
            const whole = m[2].replace(/,/g, '') || '0';
            const frac = m[3] || '';
            if (money) {
                if (frac.length > 2) return NaN;
                const c = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
                // Past the safe integers a figure is no longer exact.
                if (!Number.isSafeInteger(c)) return NaN;
                return m[1] && c ? -c : c;
            }
            const n = Number(whole + (frac ? '.' + frac : ''));
            if (!isFinite(n)) return NaN;
            return m[1] && n ? -n : n;
        }

        function setInvalid(on) {
            box.classList.toggle('is-error', !!on);
            if (on) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }

        function setDisabled(on) {
            input.disabled = !!on;
            box.classList.toggle('is-disabled', !!on);
        }

        function commit() {
            const v = read(input.value);
            if (v !== null && isNaN(v)) {
                setInvalid(true);
                return;
            }
            setInvalid(false);
            if (v === value) return;
            value = v;
            if (typeof o.onChange === 'function') o.onChange(value);
        }

        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
        });

        root.kitValue = function () {
            return value;
        };
        root.kitSet = function (v) {
            const n = v == null || v === '' ? null : Number(v);
            value = n != null && isFinite(n) ? (money ? Math.round(n) : n) : null;
            input.value = value == null ? '' : money ? (value / 100).toFixed(2) : String(value);
            setInvalid(false);
        };
        root.kitSetInvalid = setInvalid;
        root.kitSetDisabled = setDisabled;
        root.kitSet(o.value);
        if (o.disabled) setDisabled(true);
        return root;
    }

    /**
     * The search box: a magnifier inside a 32px field that filters as it is
     * typed in.
     *
     * ⛔ type="text" WITH role="searchbox", NOT type="search", as the picked
     * source does: css/shell-theme.css repaints every light-mode
     * input[type='search'] with !important. The glyph follows the field in
     * the markup (it is placed absolutely, so it still draws at the left), so
     * a disabled field can dim it.
     *
     * @param o.placeholder the words in the empty box
     * @param o.label       the accessible name; the placeholder by default
     * @param o.value       ⛔ pass it whenever the query outlives a render, or
     *                      the box paints blank while the list stays filtered
     * @param o.onInput     (value) on every keystroke
     * @param o.disabled    starts switched off
     * @param o.id, o.name  on the field itself
     *
     * Returns the <label> around the field; kitValue() and kitSet(v) are on it.
     */
    function searchField(opts) {
        const o = opts || {};
        const words = o.placeholder || 'Search';
        const input = el('input', {
            class: 'kit-search-field__input',
            id: o.id,
            name: o.name,
            type: 'text',
            role: 'searchbox',
            enterkeyhint: 'search',
            autocomplete: 'off',
            placeholder: words,
            'aria-label': o.label || words
        });
        if (o.value != null) input.value = String(o.value);
        if (o.disabled) input.disabled = true;
        if (typeof o.onInput === 'function') input.addEventListener('input', () => o.onInput(input.value));
        const root = el('label', { class: 'kit-search-field' }, [
            input,
            Kit.glyph('search', { cls: 'kit-search-field__icon' })
        ]);
        root.kitValue = function () {
            return input.value;
        };
        root.kitSet = function (v) {
            input.value = v == null ? '' : String(v);
        };
        return root;
    }

    /**
     * The search inside a pop-up: a magnifier, a borderless 16.5px field and
     * an optional key hint, for the head of a pop-up that opens to be typed
     * in. It draws no edge and no ring: the pop-up draws the edges, and focus
     * sits here the whole time the pop-up is open (css/kit-standards.css says why).
     *
     * @param o.placeholder the words in the empty box
     * @param o.label       the accessible name; the placeholder by default
     * @param o.value       the words to start with
     * @param o.hint        a key to show at the right end, e.g. 'esc'
     * @param o.onInput     (value) on every keystroke
     * @param o.disabled    starts switched off (while the pop-up has
     *                      nothing it could search yet)
     * @param o.id, o.name  on the field itself
     *
     * Returns the head; kitValue() and kitSet(v) are on it. The pop-up that
     * opens it focuses the field inside.
     */
    function popupSearch(opts) {
        const o = opts || {};
        const words = o.placeholder || 'Search';
        const input = el('input', {
            class: 'kit-popup-search__input',
            id: o.id,
            name: o.name,
            type: 'text',
            role: 'searchbox',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: words,
            'aria-label': o.label || words
        });
        if (o.value != null) input.value = String(o.value);
        if (o.disabled) input.disabled = true;
        if (typeof o.onInput === 'function') input.addEventListener('input', () => o.onInput(input.value));
        // The glyph follows the field and css/kit-standards.css orders it back to the
        // front, so a disabled field can dim it.
        const root = el('div', { class: 'kit-popup-search' }, [
            input,
            Kit.glyph('search', { cls: 'kit-popup-search__icon' }),
            // The kit's one keycap (Kit.keyHint's, pick history__key-hint).
            o.hint ? el('kbd', { class: 'kit-key-hint kit-popup-search__key', text: String(o.hint) }) : null
        ]);
        root.kitValue = function () {
            return input.value;
        };
        root.kitSet = function (v) {
            input.value = v == null ? '' : String(v);
        };
        return root;
    }

    /** The DOM types the sign-in field hands to the browser. */
    const SIGN_IN_TYPE = { email: 'email', password: 'password', text: 'text' };

    /**
     * The sign-in page's field: a label over an underlined box, a tick or a
     * cross at its right end, and a short line under it when refused.
     *
     * Both marks are always in the markup and swap by opacity, so the text
     * never reflows as it is judged. The line is always present and starts
     * empty with role="alert", because a live region created at the moment
     * it has something to say is announced unreliably.
     *
     * @param o.label        the words above the box. Without one no label
     *                       is drawn, and the field is named by its
     *                       placeholder, else its name
     * @param o.type         'email' | 'password' | 'text' (the default)
     * @param o.code         a one-time code: letter-spaced figures on the
     *                       number keyboard
     * @param o.disabled     starts switched off
     * @param o.placeholder, o.value, o.id, o.name, o.autocomplete
     *
     * Returns the field. kitValue(), kitSet(v) and kitSetStatus(state, words)
     * are on it: 'valid' draws the tick, 'invalid' the cross and the words,
     * anything else neither.
     */
    function signInField(opts) {
        const o = opts || {};
        const id = o.id || nextId('sign-in');
        const input = el('input', {
            class: 'kit-sign-in__input' + (o.code ? ' kit-sign-in__input--code' : ''),
            id: id,
            name: o.name,
            placeholder: o.placeholder,
            autocomplete: o.autocomplete || (o.code ? 'one-time-code' : null)
        });
        input.type = o.code ? 'text' : SIGN_IN_TYPE[o.type] || 'text';
        if (o.code) input.setAttribute('inputmode', 'numeric');
        if (o.value != null) input.value = String(o.value);
        if (o.disabled) input.disabled = true;
        // An empty <label> names nothing and still takes a line of space.
        if (!o.label && (o.placeholder || o.name)) input.setAttribute('aria-label', String(o.placeholder || o.name));
        const msg = el('span', { class: 'kit-sign-in__msg', id: id + '-msg', role: 'alert' });
        const root = el('div', { class: 'kit-sign-in' }, [
            o.label ? el('label', { class: 'kit-sign-in__label', for: id, text: o.label }) : null,
            el('div', { class: 'kit-sign-in__control' }, [
                input,
                el('span', { class: 'kit-sign-in__status', 'aria-hidden': 'true' }, [
                    Kit.glyph('check', { cls: 'kit-sign-in__ico kit-sign-in__ico--check' }),
                    Kit.glyph('close', { cls: 'kit-sign-in__ico kit-sign-in__ico--x' })
                ])
            ]),
            msg
        ]);
        root.kitValue = function () {
            return input.value;
        };
        root.kitSet = function (v) {
            input.value = v == null ? '' : String(v);
        };
        root.kitSetStatus = function (state, words) {
            const invalid = state === 'invalid';
            root.classList.toggle('is-valid', state === 'valid');
            root.classList.toggle('is-invalid', invalid);
            msg.textContent = invalid && words ? String(words) : '';
            if (invalid) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
            if (msg.textContent) input.setAttribute('aria-describedby', msg.id);
            else input.removeAttribute('aria-describedby');
        };
        return root;
    }

    /* -----------------------------------------------------------------------
     * Dropdowns and menus (owner picks, 2026-09-28, docs/ui-library/standards.md).
     *
     * Three new factories beside Kit.select, which is unchanged: the menu from
     * a button (Kit.buttonMenu), the dropdown in a toolbar
     * (Kit.toolbarDropdown) and the filter button (Kit.filterButton). Each is
     * copied from the Financials control the owner picked
     * (js/financials/controls.js, js/financials/view-transactions.js, read
     * there, never edited). All three open through openPopover above, so they
     * share its one-open-at-a-time rule, Escape, the outside click and the
     * placement that keeps a list on screen; css/kit-standards.css draws them.
     * --------------------------------------------------------------------- */

    // Every glyph below is Kit.glyph (core.js), the kit's one line style, by
    // the name Financials gives it (js/financials/controls.js:198-281).

    /**
     * Line a pop-out's right edge up with its anchor's, inside the viewport.
     * openPopover lines the left edges up; Financials opens its toolbar menus
     * and the Compare select from the right. Only with a real measurement, so
     * jsdom's all-zero rects leave the placement alone.
     */
    function alignEnd(pop, anchor) {
        const r = anchor.getBoundingClientRect();
        const w = pop.getBoundingClientRect().width || pop.offsetWidth || 0;
        const vw = window.innerWidth || 0;
        if (!w || !vw || !r.width) return;
        pop.style.left = Math.round(Math.max(EDGE, Math.min(r.right - w, vw - w - EDGE))) + 'px';
    }

    /**
     * openPopover for a pop-out whose rows take focus themselves (the menu,
     * the filter pop-out). The rows sit out of the tab order and the arrow keys
     * walk them (walkRows, below).
     *
     * Tab follows the WAI-ARIA menu button pattern, as the toolbar dropdown
     * does: one press closes the pop-out AND moves on. The handler closes it
     * and puts focus on the button synchronously, with NO preventDefault, so
     * the browser's own Tab then moves on from the button: to what follows
     * it, or with Shift to what comes before it. Escape and a pick hand focus
     * back to the button too. Focus moved out some other way (a script, a
     * click on a field outside) closes it and stays where it went; focus
     * moved into a pop-up opened from inside it is still inside it.
     *
     * `opts.rows`: the pop-out holds the caller's own controls (the filter
     * pop-outs), and the arrow keys walk them as rows (popOutRows, below).
     * The handle then answers `firstRow()`, where keyboard focus lands.
     */
    function openPopOut(anchor, node, onClosed, opts) {
        let leaving = false;
        let handle = null;
        // The one pop-out shell (pick overlays__menu-and-pop-out): whatever
        // opens here wears it, so a new pop-out cannot drift from the others.
        node.classList.add('kit-pop-out');
        const rows = opts && opts.rows ? popOutRows(node) : null;
        // Capture, so a group inside cannot keep Up, Down, Home or End.
        if (rows) node.addEventListener('keydown', (e) => walkPopOut(rows, e), true);
        node.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || !handle) return;
            handle.close();
        });
        node.addEventListener('focusout', (e) => {
            const to = e.relatedTarget;
            if (!handle || !to || holds(handle, to) || anchor.contains(to)) return;
            leaving = true;
            handle.close();
        });
        handle = openPopover(anchor, node, {
            root: anchor,
            restoreFocus: false,
            onClose: () => {
                if (typeof onClosed === 'function') onClosed();
                const at = document.activeElement;
                if (!leaving && (!at || at === document.body || node.contains(at))) anchor.focus();
            }
        });
        handle.firstRow = () => (rows && rows.length ? rowEntry(rows[0]) : null);
        return handle;
    }

    /**
     * ⛭ THE ROWS OF A POP-OUT THAT HOLDS THE CALLER'S CONTROLS, AND THE ONE
     * PATTERN THEY FOLLOW. Every control is a row, EXCEPT a group that walks
     * its own arrow keys (a radio group: Kit.pickOne, Kit.inlineSwitch; or
     * Kit.pickChips), which is ONE row. Up and Down (wrapping), Home and End
     * move between rows; Left and Right belong to the row that has focus, so
     * inside a group they are the group's own (a radio group moves its
     * choice, pick chips move along the chips). The pop-out takes Up, Down,
     * Home and End in the capture phase, before the group hears them, which
     * is what stops a group trapping them (a Kit.pickOne followed by an Apply
     * button used to keep all four and leave Tab, which closes, as the only
     * way out). A trigger in a pop-out (a Kit.select) opens with Enter or
     * Space; Up and Down there are the pop-out's. A text field keeps Home and
     * End for its caret. Landing on a group puts focus on its way in: the
     * control it keeps in the tab order (a radio group's roving stop), or its
     * first control. The rows leave the tab order; a group's own roving
     * tab stop is left as the group set it.
     */
    const OWN_KEYS = '[role="radiogroup"], .kit-pick-chips';

    function popOutRows(panel) {
        const rows = [];
        focusablesIn(panel).forEach((n) => {
            if (n === panel) return;
            const group = n.parentElement && n.parentElement.closest(OWN_KEYS);
            if (group && panel.contains(group)) {
                if (rows.indexOf(group) < 0) rows.push(group);
                return;
            }
            n.setAttribute('tabindex', '-1');
            rows.push(n);
        });
        return rows;
    }

    function rowEntry(row) {
        if (!row.matches(OWN_KEYS)) return row;
        return row.querySelector('[tabindex="0"]') || focusablesIn(row)[0] || row;
    }

    function walkPopOut(rows, e) {
        if (!rows.length) return false;
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return false;
        const t = e.target;
        const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
        if (inField && (e.key === 'Home' || e.key === 'End')) return false;
        const a = document.activeElement;
        const at = rows.findIndex((r) => r === a || r.contains(a));
        let next = 0;
        if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % rows.length;
        else if (e.key === 'ArrowUp') next = at <= 0 ? rows.length - 1 : at - 1;
        else if (e.key === 'End') next = rows.length - 1;
        e.preventDefault();
        e.stopPropagation();
        rowEntry(rows[next]).focus();
        return true;
    }

    /**
     * Roving focus over a pop-out's rows: Down and Up step and wrap, Home and
     * End jump to the ends. Home and End stay with the caret in a text field.
     * Returns true when it moved focus.
     */
    function walkRows(list, e) {
        if (!list.length) return false;
        const t = e.target;
        const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
        if (inField && (e.key === 'Home' || e.key === 'End')) return false;
        const at = list.indexOf(document.activeElement);
        let next = null;
        if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
        else if (e.key === 'ArrowUp') next = at <= 0 ? list.length - 1 : at - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = list.length - 1;
        if (next === null) return false;
        e.preventDefault();
        list[next].focus();
        return true;
    }

    /**
     * The dropdown in a toolbar (pick selects__toolbar-dropdown, "Financials
     * dropdown"): a compact trigger that says what is chosen, and a list with a
     * tick column on the left. Copied from FinControls.select
     * (js/financials/controls.js:1058) and its list.
     *
     * ⛔ TWO FACTS, TWO MECHANISMS, as in Kit.select: `.is-active` is where the
     * pointer or the arrow keys ARE, `aria-selected` and the tick are what is
     * CHOSEN. Moving the cursor changes nothing until Enter or a click.
     *
     * @param o.options     [{ value, label, icon }]
     * @param o.value       the value that starts chosen, or null
     * @param o.placeholder the words while nothing is chosen
     * @param o.label       fixed words in place of the value (the "Compare
     *                      to" trigger), in placeholder ink; kitSetLabel(null)
     *                      puts the value back
     * @param o.ariaLabel   the control's name; the words shown follow it
     * @param o.icon        a glyph before the words: a name or path data
     * @param o.size        'lg' for the 40px trigger (default 32px)
     * @param o.quiet       words alone, no box, a chip under the pointer
     * @param o.align       'end' opens the list from the trigger's right edge
     * @param o.disabled    starts switched off
     * @param o.onChange    (value, label) when a different option is chosen
     *
     * Returns the trigger. kitValue(), kitSet(v), kitSetLabel(words) and
     * kitSetDisabled(on) are on it.
     */
    function toolbarDropdown(opts) {
        const o = opts || {};
        const options = listOf(o.options, 'toolbarDropdown', 'options');
        const btnId = o.id || nextId('toolbar-dropdown');
        let value = o.value == null ? null : String(o.value);
        let fixed = o.label || null;
        let pop = null;
        const words = el('span', { class: 'kit-toolbar-dropdown__value' });
        const btn = el(
            'button',
            {
                class:
                    'kit-toolbar-dropdown' +
                    (o.size === 'lg' ? ' kit-toolbar-dropdown--lg' : '') +
                    (o.quiet ? ' kit-toolbar-dropdown--quiet' : ''),
                type: 'button',
                id: btnId,
                'aria-haspopup': 'listbox',
                'aria-expanded': 'false'
            },
            [
                o.icon ? Kit.glyph(o.icon, { cls: 'kit-toolbar-dropdown__icon' }) : null,
                words,
                Kit.glyph('chevronDown', { cls: 'kit-toolbar-dropdown__chev' })
            ]
        );
        if (o.disabled) btn.disabled = true;

        function labelOf(v) {
            const hit = options.filter((x) => String(x.value) === String(v))[0];
            return hit ? String(hit.label) : null;
        }

        function paint() {
            const chosen = value == null ? null : labelOf(value);
            const text = fixed || chosen || o.placeholder || '';
            words.textContent = text;
            // ⛔ The unselected state SAYS it is unselected: placeholder ink,
            // never the first option standing in for a choice nobody made.
            words.classList.toggle('is-placeholder', !!fixed || chosen == null);
            // aria-label replaces the button's words, so it carries them too
            // ("Interval: Month"), or a screen reader never hears the value.
            if (o.ariaLabel)
                btn.setAttribute('aria-label', o.ariaLabel + (text && text !== o.ariaLabel ? ': ' + text : ''));
        }

        function open() {
            if (btn.disabled) return;
            if (pop) {
                pop.close();
                return;
            }
            const list = el('div', {
                class: 'kit kit-pop-out kit-toolbar-dropdown__pop',
                role: 'listbox',
                tabindex: '-1',
                'aria-labelledby': btnId
            });
            let active = options.map((x) => String(x.value)).indexOf(String(value));
            const rows = options.map((opt, i) => {
                const on = value != null && String(opt.value) === value;
                const r = el(
                    'div',
                    {
                        class: 'kit-toolbar-dropdown__opt',
                        role: 'option',
                        id: btnId + '-opt-' + i,
                        'aria-selected': on ? 'true' : 'false',
                        dataset: { value: String(opt.value) }
                    },
                    [
                        el('span', { class: 'kit-toolbar-dropdown__check' }, [
                            on ? Kit.glyph('check', { cls: 'kit-toolbar-dropdown__tick' }) : null
                        ]),
                        opt.icon ? Kit.glyph(opt.icon, { cls: 'kit-toolbar-dropdown__opt-icon' }) : null,
                        el('span', { class: 'kit-toolbar-dropdown__lbl', text: String(opt.label) })
                    ]
                );
                r.addEventListener('click', () => choose(i));
                r.addEventListener('mousemove', () => mark(i));
                list.appendChild(r);
                return r;
            });
            if (!rows.length)
                list.appendChild(el('div', { class: 'kit-toolbar-dropdown__none', text: 'Nothing to choose from' }));

            function mark(i) {
                active = i;
                rows.forEach((r, k) => r.classList.toggle('is-active', k === i));
                if (i > -1 && rows[i]) {
                    list.setAttribute('aria-activedescendant', rows[i].id);
                    if (typeof rows[i].scrollIntoView === 'function') rows[i].scrollIntoView({ block: 'nearest' });
                } else {
                    list.removeAttribute('aria-activedescendant');
                }
            }

            function choose(i) {
                const opt = options[i];
                if (!opt) return;
                const changed = String(opt.value) !== value;
                value = String(opt.value);
                paint();
                const h = pop;
                pop = null;
                if (h) h.close();
                if (changed && typeof o.onChange === 'function') o.onChange(value, String(opt.label));
            }

            list.addEventListener('keydown', (e) => {
                if (!rows.length) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    mark(Math.min(rows.length - 1, active + 1));
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    mark(Math.max(0, active - 1));
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    mark(0);
                } else if (e.key === 'End') {
                    e.preventDefault();
                    mark(rows.length - 1);
                } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    choose(active);
                } else if (e.key === 'Tab' && pop) {
                    // The WAI-ARIA menu button pattern: close the list and put
                    // focus on the trigger now (openPopover hands it back),
                    // with no preventDefault, so the browser's own Tab moves
                    // on from the trigger, forward or with Shift back.
                    pop.close();
                }
            });

            btn.setAttribute('aria-expanded', 'true');
            pop = openPopover(btn, list, {
                root: btn,
                onClose: () => {
                    btn.setAttribute('aria-expanded', 'false');
                    pop = null;
                }
            });
            if (o.align === 'end') alignEnd(list, btn);
            if (active > -1) mark(active);
            list.focus();
        }

        btn.addEventListener('click', open);
        btn.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pop) {
                e.preventDefault();
                open();
            }
        });
        btn.kitValue = function () {
            return value;
        };
        btn.kitSet = function (v) {
            value = v == null ? null : String(v);
            paint();
        };
        btn.kitSetLabel = function (w) {
            fixed = w || null;
            paint();
        };
        btn.kitSetDisabled = function (on) {
            btn.disabled = !!on;
            if (on && pop) pop.close();
        };
        paint();
        return btn;
    }

    /**
     * The menu from a button (pick selects__button-menu, "Financials menu"):
     * a 32px icon button that opens a short list of actions. Copied from
     * FinControls.menu, openMenu and settingsMenu (js/financials/controls.js:
     * 819, 905, 2332). With `text` the button is the Saved views one instead
     * (FinControls.chip with `fc-saved`, :716): an icon, the words and a
     * caret on the same outlined box.
     *
     * The button and a row's actions are named by aria-label and carry no
     * browser tooltip (`title`), which the kit never draws.
     *
     * A row can be the chosen one (a tick on the right, the words heavier),
     * off, or carry its own row actions (rename, delete), which stay out of
     * sight until the row is under the pointer or holds focus. Opened from the
     * keyboard, focus lands on the first row; opened by the pointer it lands
     * on the menu itself, so no row lights up before the pointer reaches one.
     *
     * ⛔ THE ARIA PATTERN IS ONE FLAT MENU. Every row, and every row action,
     * is its own role="menuitem" (an action is named for its row, "Delete
     * Quarterly spend"), in reading order, and the arrow keys reach each one;
     * the row wrapper, the actions box and a note are role="none", so nothing
     * but menuitems and separators sits inside role="menu". No menuitem is in
     * the tab order (tabindex -1): Down, Up, Home and End walk them, and Tab or
     * Shift+Tab closes the menu onto its button (openPopOut).
     *
     * @param o.label    the menu's name, and the button's ("View settings")
     * @param o.icon     the button's glyph: a name or path data ('sliders')
     * @param o.text     words on the button (the chosen saved view); the
     *                   button then reads "label: text"
     * @param o.bare     the borderless button (.kit-icon) instead of the
     *                   outlined one
     * @param o.items    [{ key, label, icon, selected, disabled, keepOpen,
     *                   onSelect(item), actions: [{ key, label, icon,
     *                   tone: 'accent' | 'danger', onClick(item) }] }],
     *                   { divider: true } and { note: 'words' }
     * @param o.onSelect (item) for a row that has no onSelect of its own
     * @param o.align    'end' opens the menu from the button's right edge
     * @param o.disabled starts switched off
     *
     * Returns the button. kitOpen(fromKeyboard), kitClose(), kitSetItems(items),
     * kitSetText(words) and kitSetDisabled(on) are on it.
     */
    function buttonMenu(opts) {
        const o = opts || {};
        let items = listOf(o.items, 'buttonMenu', 'items');
        const name = o.label || 'Menu';
        const textual = o.text != null && !o.bare;
        let pop = null;
        const words = textual ? el('span', { class: 'kit-button-menu__text' }) : null;
        const btn = el(
            'button',
            {
                class: o.bare ? 'kit-icon' : 'kit-button-menu' + (textual ? ' kit-button-menu--text' : ''),
                type: 'button',
                id: o.id,
                'aria-label': name,
                'aria-haspopup': 'menu',
                'aria-expanded': 'false'
            },
            [
                Kit.glyph(o.icon || 'sliders', { cls: o.bare ? 'kit-icon__glyph' : 'kit-button-menu__glyph' }),
                words,
                textual ? Kit.glyph('chevronDown', { cls: 'kit-button-menu__caret' }) : null
            ]
        );
        if (o.disabled) btn.disabled = true;

        function paintText(t) {
            if (!words) return;
            words.textContent = t == null ? '' : String(t);
            btn.setAttribute('aria-label', words.textContent ? name + ': ' + words.textContent : name);
        }

        function open(fromKeyboard) {
            if (btn.disabled) return;
            if (pop) {
                pop.close();
                return;
            }
            const list = el('div', { class: 'kit-button-menu__list', role: 'menu', 'aria-label': name });
            const shell = el('div', { class: 'kit kit-button-menu__pop', tabindex: '-1' }, [list]);
            const rows = [];
            // Did focus reach a row from the keyboard? Only then does the row
            // wear the ring: a keyboard open or a key in the menu says yes, a
            // press of the pointer no.
            let viaKeys = !!fromKeyboard;
            shell.addEventListener(
                'keydown',
                () => {
                    viaKeys = true;
                },
                true
            );
            shell.addEventListener(
                'pointerdown',
                () => {
                    viaKeys = false;
                },
                true
            );
            const firsts = [];
            const live = [];

            function mark(row) {
                rows.forEach((r) => r.classList.toggle('is-active', r === row));
            }

            items.forEach((it) => {
                if (!it) return;
                if (it.divider) {
                    list.appendChild(el('div', { class: 'kit-button-menu__divider', role: 'separator' }));
                    return;
                }
                if (it.note) {
                    list.appendChild(
                        el('div', { class: 'kit-button-menu__note', role: 'none', text: String(it.note) })
                    );
                    return;
                }
                const acts = Array.isArray(it.actions) ? it.actions.filter(Boolean) : [];
                const row = el('div', {
                    class:
                        'kit-button-menu__row' +
                        (it.selected ? ' is-selected' : '') +
                        (it.disabled ? ' is-disabled' : '') +
                        (acts.length ? ' has-actions' : ''),
                    role: 'none'
                });
                const b = el(
                    'button',
                    {
                        class: 'kit-button-menu__item',
                        type: 'button',
                        role: 'menuitem',
                        tabindex: '-1',
                        'data-key': it.key != null ? String(it.key) : null,
                        'aria-current': it.selected ? 'true' : null
                    },
                    [
                        it.icon ? Kit.glyph(it.icon, { cls: 'kit-button-menu__icon' }) : null,
                        el('span', { class: 'kit-button-menu__label', text: String(it.label || '') }),
                        it.selected ? Kit.glyph('check', { cls: 'kit-button-menu__check' }) : null
                    ]
                );
                if (it.disabled) b.disabled = true;
                b.addEventListener('click', () => {
                    if (b.disabled) return;
                    const fn = typeof it.onSelect === 'function' ? it.onSelect : o.onSelect;
                    if (typeof fn === 'function') fn(it);
                    if (it.keepOpen !== true && pop) pop.close();
                });
                // The keyboard on a row: a plain row with the ring round it
                // (.is-focused), never the pointer's wash as well.
                b.addEventListener('focus', () => {
                    mark(null);
                    row.classList.toggle('is-focused', viaKeys);
                });
                b.addEventListener('blur', () => row.classList.remove('is-focused'));
                row.appendChild(b);
                if (!it.disabled) {
                    live.push(b);
                    firsts.push(b);
                }
                if (acts.length) {
                    const box = el('span', { class: 'kit-button-menu__actions', role: 'none' });
                    acts.forEach((a) => {
                        const ab = el(
                            'button',
                            {
                                class: 'kit-button-menu__act' + (a.tone ? ' kit-button-menu__act--' + a.tone : ''),
                                type: 'button',
                                role: 'menuitem',
                                tabindex: '-1',
                                'aria-label': String(a.label || '') + (it.label ? ' ' + it.label : ''),
                                'data-act': a.key || (typeof a.icon === 'string' ? a.icon : null)
                            },
                            [Kit.glyph(a.icon, { cls: 'kit-button-menu__act-glyph' })]
                        );
                        ab.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (typeof a.onClick === 'function') a.onClick(it, e);
                        });
                        ab.addEventListener('focus', () => mark(null));
                        box.appendChild(ab);
                        live.push(ab);
                    });
                    row.appendChild(box);
                }
                if (!it.disabled) row.addEventListener('mousemove', () => mark(row));
                rows.push(row);
                list.appendChild(row);
            });
            shell.addEventListener('mouseleave', () => mark(null));
            shell.addEventListener('keydown', (e) => walkRows(live, e));

            btn.setAttribute('aria-expanded', 'true');
            pop = openPopOut(btn, shell, () => {
                btn.setAttribute('aria-expanded', 'false');
                pop = null;
            });
            if (o.align === 'end') alignEnd(shell, btn);
            if (fromKeyboard && firsts.length) firsts[0].focus();
            else shell.focus();
        }

        // A click the keyboard made (Enter, Space) has no pointer detail.
        btn.addEventListener('click', (e) => open(!!e && e.detail === 0));
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && !pop) {
                e.preventDefault();
                open(true);
            }
        });
        btn.kitOpen = function (fromKeyboard) {
            if (!pop) open(!!fromKeyboard);
        };
        btn.kitClose = function () {
            if (pop) pop.close();
        };
        btn.kitSetItems = function (next) {
            items = listOf(next, 'buttonMenu', 'items');
            if (pop) pop.close();
        };
        btn.kitSetText = paintText;
        btn.kitSetDisabled = function (on) {
            btn.disabled = !!on;
            if (on && pop) pop.close();
        };
        paintText(o.text);
        return btn;
    }

    /**
     * The filter button (pick selects__filter-button, "Transactions toolbar
     * buttons"): an icon and a word on a quiet 8px box that opens a pop-out,
     * and says so in its ink and edge when what it opens is in use ("Filters
     * · 2"). Copied from barBtn() (js/financials/view-transactions.js:807) and
     * .ftx-bar__btn (css/financials-transactions.css:258-320).
     *
     * The pop-out holds whatever `content` builds; `.kit-filter-button__caption`
     * and `.kit-filter-button__row` are its section heading and its
     * label-and-control row, as the Transactions View pane lays them out.
     * Every control the content holds is taken out of the tab order and
     * walked with the arrow keys instead, and Tab or Shift+Tab closes the
     * pop-out onto the button (openPopOut), as the menu does.
     *
     * @param o.label    the word ("Filters", "View")
     * @param o.icon     a glyph name or path data ('filter')
     * @param o.on       what it opens is in use
     * @param o.content  (close) -> Node, built fresh on every open; without it
     *                   the button is a plain action and o.onClick runs
     * @param o.popLabel the pop-out's accessible name (default: the label)
     * @param o.align    'end' opens the pop-out from the button's right edge
     * @param o.onClick  (event), for a button with no pop-out
     *
     * Returns the button. kitSet({ label, on }), kitOpen(fromKeyboard) and
     * kitClose() are on it.
     */
    function filterButton(opts) {
        const o = opts || {};
        let words = o.label || '';
        let pop = null;
        const lbl = el('span', { class: 'kit-filter-button__lbl' });
        const hasPop = typeof o.content === 'function';
        const btn = el(
            'button',
            {
                class: 'kit-filter-button',
                type: 'button',
                id: o.id,
                'aria-haspopup': hasPop ? 'dialog' : null,
                'aria-expanded': hasPop ? 'false' : null
            },
            [Kit.glyph(o.icon || 'filter', { cls: 'kit-filter-button__icon' }), lbl]
        );

        function paint(on) {
            lbl.textContent = words;
            btn.classList.toggle('is-on', !!on);
        }

        function close() {
            if (pop) pop.close();
        }

        function open(fromKeyboard) {
            if (pop) {
                close();
                return;
            }
            const panel = el('div', {
                class: 'kit kit-filter-button__pop',
                role: 'dialog',
                tabindex: '-1',
                'aria-label': o.popLabel || words || null
            });
            const body = o.content(close);
            if (body && body.nodeType === 1) panel.appendChild(body);
            btn.setAttribute('aria-expanded', 'true');
            pop = openPopOut(
                btn,
                panel,
                () => {
                    btn.setAttribute('aria-expanded', 'false');
                    pop = null;
                },
                { rows: true }
            );
            if (o.align === 'end') alignEnd(panel, btn);
            const first = pop.firstRow();
            if (fromKeyboard && first) first.focus();
            else panel.focus();
        }

        // A click the keyboard made (Enter, Space) has no pointer detail.
        btn.addEventListener('click', (e) => {
            if (hasPop) open(!!e && e.detail === 0);
            else if (typeof o.onClick === 'function') o.onClick(e);
        });
        btn.kitSet = function (v) {
            const x = v || {};
            if (x.label != null) words = String(x.label);
            paint(x.on != null ? x.on : btn.classList.contains('is-on'));
        };
        btn.kitOpen = function (fromKeyboard) {
            if (hasPop && !pop) open(!!fromKeyboard);
        };
        btn.kitClose = close;
        paint(o.on);
        return btn;
    }

    /* -----------------------------------------------------------------------
     * Chips (owner picks, 2026-09-28, docs/ui-library/standards.md): the
     * filter chip (Kit.filterChip) and the pick chips (Kit.pickChips). The
     * status tag, the number badge, the label on a picture and the plain tag
     * take no pointer and live in components.js. css/kit-standards.css draws
     * all of them.
     * --------------------------------------------------------------------- */

    /**
     * The filter chip (pick chips__filter-chip, "Financials filter chip"): what
     * a filter is set to, in words, with a chevron that opens the choice. It
     * takes the wine tint while its filter is set, and then an x that clears
     * it, which gives way to the up chevron while the choice is open. Copied
     * from FinControls.chip (js/financials/controls.js:716), read there, never
     * edited.
     *
     * It opens what it is given through openPopOut, as Kit.filterButton does,
     * so it shares one pop-up open at a time, Escape, the outside click, one
     * Tab that closes and moves on, and a pop-up opened from inside it keeping
     * it open. The rows in the pop-out leave the tab order and the arrow keys
     * walk them, unless a control inside (a Kit.pickOne) already took the key.
     *
     * @param o.label      the words: what the filter is set to ("All stores")
     * @param o.icon       a leading glyph by name (the filter button's set), optional
     * @param o.chevron    false for a chip that opens nothing and shows no chevron
     * @param o.active     true while its filter is set: the tint
     * @param o.content    (close) => Element: what it opens, in a pop-out
     * @param o.popLabel   the pop-out's name (default the words)
     * @param o.align      'end' to line the pop-out up with the chip's right edge
     * @param o.onClick    (event) when it has no content
     * @param o.onClear    (chip, event) clears the filter; while set, the x
     *                     shows. The chip is this one, as FinControls hands
     *                     its api, so the handler can kitSet it back
     * @param o.clearLabel the x's name (default "Remove filter")
     * @param o.ariaLabel  the button's name when the words alone do not say
     *                     what it filters ("Store: All stores")
     * @param o.disabled   true to switch it off
     * @param o.id
     * @returns the chip, a <span>, with kitSet({ label, active, disabled }),
     *          kitOpen(fromKeyboard) and kitClose(); `.kitButton` is its button
     */
    function filterChip(opts) {
        const o = opts || {};
        const s = { label: String(o.label || ''), active: !!o.active, disabled: !!o.disabled };
        const hasPop = typeof o.content === 'function';
        const canClear = typeof o.onClear === 'function';
        let pop = null;
        const lbl = el('span', { class: 'kit-filter-chip__label' });
        const btn = el(
            'button',
            {
                class: 'kit-filter-chip__btn',
                type: 'button',
                id: o.id,
                'aria-label': o.ariaLabel || null,
                'aria-haspopup': hasPop ? 'dialog' : null,
                'aria-expanded': hasPop ? 'false' : null
            },
            [
                o.icon
                    ? el('span', { class: 'kit-filter-chip__iconbox' }, [
                          Kit.glyph(o.icon, { cls: 'kit-filter-chip__icon' })
                      ])
                    : null,
                lbl,
                // With an x the chevron stays in the document, so the up
                // arrow can take the x's place while the choice is open.
                o.chevron !== false || canClear
                    ? el('span', { class: 'kit-filter-chip__chevbox' }, [
                          Kit.glyph('chevronDown', { cls: 'kit-filter-chip__chev' })
                      ])
                    : null
            ]
        );
        const clear = canClear
            ? el(
                  'button',
                  { class: 'kit-filter-chip__clear', type: 'button', 'aria-label': o.clearLabel || 'Remove filter' },
                  [Kit.glyph('close', { cls: 'kit-filter-chip__x' })]
              )
            : null;
        const root = el('span', { class: 'kit-filter-chip' }, [btn, clear]);

        /** Off in either spelling on its button: the box says so, dimmed. */
        function markOff() {
            root.classList.toggle('is-off', isOff(btn));
        }

        // Toggled one by one, so a class the caller put on the box stays.
        function paint() {
            const showClear = s.active && canClear;
            root.classList.toggle('is-active', s.active);
            root.classList.toggle('has-icon', !!o.icon);
            root.classList.toggle('has-chevron', o.chevron !== false || showClear);
            root.classList.toggle('has-clear', showClear);
            root.classList.toggle('is-open', !!pop);
            // Long words end in an ellipsis at 240px. No native title to give
            // them back (Settings and the kit draw no browser tooltip); a
            // screen reader still reads them whole.
            lbl.textContent = s.label;
            btn.disabled = s.disabled;
            if (clear) {
                clear.hidden = !showClear;
                clear.disabled = s.disabled;
            }
            markOff();
        }

        // ⛔ aria-disabled set on the button by hand is as off as `disabled`:
        // the box has to hear it to dim and to stop answering the pointer,
        // and css/kit-standards.css cannot look down from the box (no :has()).
        if (typeof MutationObserver === 'function') {
            new MutationObserver(markOff).observe(btn, {
                attributes: true,
                attributeFilter: ['disabled', 'aria-disabled']
            });
        }

        function close() {
            if (pop) pop.close();
        }

        function open(fromKeyboard) {
            if (pop) {
                close();
                return;
            }
            if (isOff(btn)) return;
            const panel = el('div', {
                class: 'kit kit-filter-chip__pop',
                role: 'dialog',
                tabindex: '-1',
                'aria-label': o.popLabel || s.label || null
            });
            const body = o.content(close);
            if (body && body.nodeType === 1) panel.appendChild(body);
            btn.setAttribute('aria-expanded', 'true');
            pop = openPopOut(
                btn,
                panel,
                () => {
                    btn.setAttribute('aria-expanded', 'false');
                    pop = null;
                    paint();
                },
                { rows: true }
            );
            paint();
            if (o.align === 'end') alignEnd(panel, root);
            const first = pop.firstRow();
            if (fromKeyboard && first) first.focus();
            else panel.focus();
        }

        // A click the keyboard made (Enter, Space) has no pointer detail.
        btn.addEventListener('click', (e) => {
            if (isOff(btn)) return;
            if (hasPop) open(!!e && e.detail === 0);
            else if (typeof o.onClick === 'function') o.onClick(e);
        });
        refuseWhenOff(btn);
        if (clear) {
            clear.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isOff(clear) || isOff(btn)) return;
                // The x goes with the filter: focus stays on the chip, not on
                // a button that is about to be hidden.
                btn.focus();
                o.onClear(root, e);
            });
            refuseWhenOff(clear);
        }

        root.kitButton = btn;
        root.kitSet = function (v) {
            const x = v || {};
            if (x.label != null) s.label = String(x.label);
            if (x.active != null) s.active = !!x.active;
            if (x.disabled != null) {
                s.disabled = !!x.disabled;
                if (s.disabled) close();
            }
            paint();
        };
        root.kitOpen = function (fromKeyboard) {
            if (hasPop && !pop) open(!!fromKeyboard);
        };
        root.kitClose = close;
        paint();
        return root;
    }

    /**
     * The pick chips (pick chips__pick-chip, "Settings tick chips"): a row of
     * 8px chips you tap to choose options; a chip that is on takes the accent
     * edge, tint and ink and a small tick. Copied from Settings' alert
     * channels (js/settings/notifications.js:581) and days of the week
     * (SettingsControls.days, js/settings/controls.js:290), read there, never
     * edited. The day size is the days: a square letter, named in full.
     *
     * Any number (the default) is a group of toggle buttons with aria-pressed,
     * as both sources are. Each chip is its own tab stop, as in both sources;
     * the arrow keys, Home and End also move along the row, past a chip that
     * cannot take focus; Space and Enter flip the focused chip.
     *
     * Just one (`one: true`) is the radio pattern, as Kit.pickOne: a
     * radiogroup with ONE tab stop, where the arrow keys (all four, wrapping)
     * and Home and End move the choice and the focus together past a chip that
     * is off, Space chooses the focused chip and Enter does nothing.
     *
     * A chip that is off (disabled, or aria-disabled="true") does nothing
     * when pressed. A locked chip is always on and is not a choice (Settings'
     * "In the app" channel): dashed, aria-disabled, named "<label>, always
     * on" unless it has an ariaLabel, and left out of the value. Locked is
     * for choosing any number only; with `one` it warns and is ignored.
     *
     * @param o.options  [{ value, label, ariaLabel, disabled, locked }];
     *                   ariaLabel names a chip whose words do not (a day's letter)
     * @param o.value    the values that start on, or with `one` the one value
     * @param o.one      true when just one can be chosen
     * @param o.size     'day' for the square letter chips
     * @param o.label    the group's accessible name; without one, a setting
     *                   row that holds the group names it after the row, and
     *                   "Options" is the fallback
     * @param o.onChange (value) when a person changes it: the values that are
     *                   on, in the options' order, or with `one` the chosen one
     * @returns the group, with kitValue() and kitSet(v); kitSet fires no onChange
     */
    function pickChips(opts) {
        const o = opts || {};
        const one = !!o.one;
        const day = o.size === 'day';
        const options = listOf(o.options, 'pickChips', 'options');
        const values = options.map((x) => String(x.value));
        const known = (v) => v != null && values.indexOf(String(v)) > -1;
        let chosen = null;
        let on = new Set();
        const root = el('div', {
            class: 'kit-pick-chips',
            role: one ? 'radiogroup' : 'group',
            'aria-label': o.label || 'Options'
        });
        if (!o.label) root.kitFallbackName = true;
        // ⛔ Locked means always on, which one-of-several cannot say: a locked
        // choice would be chosen for good and every other one dead. Refused,
        // out loud, and drawn as an ordinary choice.
        if (one && options.some((x) => x && x.locked)) {
            warn(
                '[Kit] pickChips: `locked` is for choosing any number (a way that is always on); ' +
                    'with `one` it is ignored. Use `disabled` for a choice that cannot be picked.'
            );
        }
        const chips = options.map((raw, i) => {
            const opt = one && raw.locked ? Object.assign({}, raw, { locked: false }) : raw;
            const words = String(opt.label != null ? opt.label : opt.value);
            const b = el(
                'button',
                {
                    class:
                        'kit-pick-chip' +
                        (day ? ' kit-pick-chip--day' : '') +
                        (opt.locked ? ' kit-pick-chip--locked' : ''),
                    type: 'button',
                    role: one ? 'radio' : null,
                    // Named by its own words, as Settings names each channel,
                    // so a setting row that holds the group does not name the
                    // first chip after the whole row; a locked one says it
                    // cannot change, as Settings' "In the app, always on".
                    'aria-label': opt.ariaLabel || (opt.locked ? words + ', always on' : words),
                    dataset: { value: values[i] }
                },
                [day ? null : Kit.glyph('check', { cls: 'kit-pick-chip__tick' }), document.createTextNode(words)]
            );
            if (opt.disabled) b.disabled = true;
            if (opt.locked) b.setAttribute('aria-disabled', 'true');
            b.addEventListener('click', () => choose(i, false));
            refuseWhenOff(b);
            if (one) spaceOnly(b);
            root.appendChild(b);
            return b;
        });
        const usable = (b) => !!b && !isOff(b);

        function isOn(i) {
            if (options[i].locked && !one) return true;
            return one ? values[i] === chosen : on.has(values[i]);
        }

        function value() {
            if (one) return chosen;
            return values.filter((v, i) => !options[i].locked && on.has(v));
        }

        function paint() {
            chips.forEach((b, i) => b.setAttribute(one ? 'aria-checked' : 'aria-pressed', isOn(i) ? 'true' : 'false'));
            if (!one) return;
            // The chosen chip is the way in when it can be used; otherwise
            // the first usable one is, so the group never leaves the tab order.
            let at = null;
            chips.forEach((b, i) => {
                b.tabIndex = -1;
                if (values[i] === chosen) at = b;
            });
            const stop = usable(at) ? at : chips.filter(usable)[0] || chips[0];
            if (stop) stop.tabIndex = 0;
        }

        function choose(i, focus) {
            const b = chips[i];
            if (!usable(b)) return;
            if (one) {
                const changed = values[i] !== chosen;
                chosen = values[i];
                paint();
                if (focus) b.focus();
                if (changed && typeof o.onChange === 'function') o.onChange(value());
                return;
            }
            if (on.has(values[i])) on.delete(values[i]);
            else on.add(values[i]);
            paint();
            if (typeof o.onChange === 'function') o.onChange(value());
        }

        root.addEventListener('keydown', (e) => {
            const i = chips.indexOf(document.activeElement);
            if (i < 0) return;
            const n = chips.length;
            // One: past every chip that is off. Any number: past only the
            // ones that cannot take focus; an aria-disabled chip is still
            // there to be found and read out.
            const stops = one ? usable : (b) => !b.disabled;
            const seek = (start, dir) => {
                for (let k = 1; k <= n; k++) {
                    const j = (((start + dir * k) % n) + n) % n;
                    if (stops(chips[j])) return j;
                }
                return -1;
            };
            let j = -1;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = seek(i, 1);
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = seek(i, -1);
            else if (e.key === 'Home') j = seek(-1, 1);
            else if (e.key === 'End') j = seek(n, -1);
            else return;
            e.preventDefault();
            if (j < 0) return;
            if (one) choose(j, true);
            else chips[j].focus();
        });

        root.kitValue = value;
        root.kitSet = function (v) {
            if (one) chosen = known(v) ? String(v) : null;
            else on = new Set((Array.isArray(v) ? v : []).filter(known).map(String));
            paint();
        };
        root.kitSet(o.value);
        return root;
    }

    /* -----------------------------------------------------------------------
     * The slider (owner pick sliders__slider, "Clip seek bar"; the clip
     * review's seek bar, .acw-scrub, js/argus-clip-workspace.js:1629-1665 and
     * css/argus-clip-workspace.css:421-468 and :1882-1895, which are read and
     * never edited). A kit control, not <input type=range>: the part of the
     * clip that has loaded is drawn behind the part that has played, so a
     * stall reads as "still loading" rather than "frozen".
     * --------------------------------------------------------------------- */

    // The clip review's m:ss (its fmtTime).
    function clipTime(s) {
        const t = isFinite(s) && s > 0 ? Math.floor(s) : 0;
        const sec = t % 60;
        return Math.floor(t / 60) + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // The keys that step it, and which way.
    const SLIDER_STEP = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

    /**
     * Kit.slider({ label, max, value, buffer, step, bigStep, format, onInput, emptyText })
     *   -> { el, set(value), setMax(max), setBuffer(value), fail(words) }
     *
     * A place along a bar, dragged or stepped: a 5px bar, the part that has
     * played in the wine and a white knob, on its own dark strip (the clip
     * review's transport ground). The strip comes with it, so it reads the
     * same on any page in either theme; `el` is the strip.
     *   label     its name (default 'Seek')
     *   max       the end, a clip's length in seconds; 0 until it is known
     *   value     where it is, 0 to max
     *   buffer    how far has loaded, 0 to max, drawn behind the played part
     *   step      how far Left and Right (and Down and Up) move it (1)
     *   bigStep   how far Page Down and Page Up move it (10)
     *   format    how a value reads (m:ss): a screen reader hears
     *             '0:12 of 0:48'
     *   onInput   onInput(value) each time the pointer or a key moves it
     *   emptyText what fail() says under the bar (default 'The clip did not
     *             load')
     * Home and End go to the two ends. The pointer drags it with the pointer
     * held (captured), so a drag that leaves the bar still ends where it is
     * let go. set, setMax and setBuffer are the page's (the video's time,
     * length and what it has loaded) and call no onInput. fail() is the clip
     * that did not load: the bar empties, the knob goes back to the start,
     * it is dimmed and off (aria-disabled; keys and the pointer move nothing)
     * but stays in the tab order, as an off pick chip does, and its value
     * reads the reason, which the words under it show. A known length
     * (setMax) brings it back for the next clip.
     */
    function slider(opts) {
        const o = opts || {};
        const words = (v, dflt) => (typeof v === 'string' && v.trim() ? v : dflt);
        const label = words(o.label, 'Seek');
        const format = typeof o.format === 'function' ? o.format : clipTime;
        const step = Number(o.step) > 0 ? Number(o.step) : 1;
        const bigStep = Number(o.bigStep) > 0 ? Number(o.bigStep) : 10;
        const onInput = typeof o.onInput === 'function' ? o.onInput : null;
        const buffer = el('div', { class: 'kit-slider__buffer' });
        const fill = el('div', { class: 'kit-slider__fill' });
        const knob = el('div', { class: 'kit-slider__knob' });
        const bar = el(
            'div',
            {
                class: 'kit-slider__bar',
                role: 'slider',
                tabindex: '0',
                'aria-label': label,
                'aria-valuemin': '0'
            },
            [buffer, fill, knob]
        );
        const root = el('div', { class: 'kit-slider' }, [bar]);
        const count = (v) => (isFinite(v) && v > 0 ? Number(v) : 0);
        let max = count(o.max);
        const within = (v) => Math.min(max, count(v));
        let value = within(o.value);
        let loaded = within(o.buffer);
        // The reason it is off (fail()), or false while it works.
        let failed = false;
        let dragging = null;

        const share = (v) => (max > 0 ? (v / max) * 100 : 0) + '%';
        function paint() {
            fill.style.width = share(value);
            knob.style.left = share(value);
            buffer.style.width = share(loaded);
            bar.setAttribute('aria-valuemax', String(max));
            bar.setAttribute('aria-valuenow', String(Math.round(value * 100) / 100));
            bar.setAttribute('aria-valuetext', failed || format(value) + ' of ' + format(max));
        }
        // A person moved it: the page hears where to.
        function move(to) {
            if (failed || max <= 0) return;
            value = within(to);
            paint();
            if (onInput) onInput(value);
        }
        function letGo(e) {
            if (dragging === null || (e && e.pointerId !== dragging)) return;
            const id = dragging;
            dragging = null;
            bar.classList.remove('is-dragging');
            try {
                if (bar.hasPointerCapture && bar.hasPointerCapture(id)) bar.releasePointerCapture(id);
            } catch (_err) {
                // Already let go by the browser: nothing is held.
            }
        }

        bar.addEventListener('keydown', (e) => {
            let to = null;
            if (Object.prototype.hasOwnProperty.call(SLIDER_STEP, e.key)) to = value + SLIDER_STEP[e.key] * step;
            else if (e.key === 'PageUp') to = value + bigStep;
            else if (e.key === 'PageDown') to = value - bigStep;
            else if (e.key === 'Home') to = 0;
            else if (e.key === 'End') to = max;
            if (to === null || failed) return;
            e.preventDefault();
            move(to);
        });
        const at = (e) => {
            const r = bar.getBoundingClientRect();
            return r.width > 0 ? ((e.clientX - r.left) / r.width) * max : value;
        };
        bar.addEventListener('pointerdown', (e) => {
            // The main button only; a right click keeps its menu.
            if (failed || max <= 0 || e.button) return;
            dragging = e.pointerId;
            try {
                if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
            } catch (_err) {
                // A pointer the browser no longer knows: the drag still works over the bar.
            }
            bar.classList.add('is-dragging');
            move(at(e));
        });
        bar.addEventListener('pointermove', (e) => {
            if (dragging !== null && e.pointerId === dragging) move(at(e));
        });
        bar.addEventListener('pointerup', letGo);
        bar.addEventListener('pointercancel', letGo);
        bar.addEventListener('lostpointercapture', letGo);

        paint();
        return {
            el: root,
            set(v) {
                if (failed || dragging !== null) return;
                value = within(v);
                paint();
            },
            // A known length brings a failed bar back: the next clip loaded.
            setMax(v) {
                if (failed && count(v) > 0) {
                    failed = false;
                    const note = root.querySelector('.kit-slider__words');
                    if (note) note.remove();
                    bar.removeAttribute('aria-disabled');
                }
                if (failed) return;
                max = count(v);
                value = within(value);
                loaded = within(loaded);
                paint();
            },
            setBuffer(v) {
                if (failed) return;
                loaded = within(v);
                paint();
            },
            fail(why) {
                failed = words(why, words(o.emptyText, 'The clip did not load'));
                // Mid-drag: the drag ends here and the pointer is let go.
                letGo(dragging === null ? null : { pointerId: dragging });
                max = 0;
                value = 0;
                loaded = 0;
                // The bar's value already says it; the words are for the eye.
                const note = el('p', { class: 'kit-slider__words', 'aria-hidden': 'true', text: failed });
                const old = root.querySelector('.kit-slider__words');
                if (old) old.remove();
                root.appendChild(note);
                bar.setAttribute('aria-disabled', 'true');
                paint();
            }
        };
    }

    /* -----------------------------------------------------------------------
     * The form submit lifecycle.
     * --------------------------------------------------------------------- */

    /**
     * The one place a submit error is shown. Always present, starting empty,
     * because a live region created at the moment it has something to say is
     * announced unreliably.
     */
    function ensureFormError(f) {
        let n = f.querySelector('.kit-form__error');
        if (!n) {
            n = el('p', { class: 'kit-form__error', role: 'alert' });
            n.hidden = true;
            const foot = f.querySelector('.kit-form__foot');
            if (foot) f.insertBefore(n, foot);
            else f.appendChild(n);
        }
        return n;
    }

    /**
     * Own a form's submit: disable the primary, await, show what the server said
     * if it refused, re-enable either way.
     *
     * @param {HTMLElement} node the form element, or anything containing one
     * @param {{onSubmit: function}} opts
     */
    function form(node, opts) {
        const o = opts || {};
        const f =
            node && node.tagName === 'FORM' ? node : node && node.querySelector ? node.querySelector('form') : null;
        if (!f) {
            // core's `region` warns for the same case rather than returning
            // quietly, and a caller that gets null back here has usually passed
            // the wrapper of a form it forgot to create.
            warn('[Kit] form: no <form> found in the node given, so nothing was wired. Submit will not be handled.');
            return null;
        }

        const err = ensureFormError(f);
        let busy = false;

        /**
         * ⛔ THE CANONICAL DIALOG SHAPE PUTS SAVE OUTSIDE THE FORM.
         * `Kit.modal({ body: theForm, actions: [{ label: 'Save', primary: true }] })`
         * renders Save into `.kit-modal__foot`, which is a SIBLING of the form:
         * it does not submit it, and setBusy could not find it to disable it.
         * Five tasks of callers would each have solved that differently. Pass
         * the footer button as `primary` and it drives the same one submit path:
         *
         *   const m = Kit.modal({ body: f, actions: [{ label: 'Save', primary: true }] });
         *   Kit.form(f, { primary: m.el.querySelector('.kit-modal__foot .kit-btn--primary'), onSubmit });
         */
        const external = o.primary || null;
        if (external) {
            external.addEventListener('click', () => {
                f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            });
        }

        function primaryBtn() {
            return external || f.querySelector('.kit-btn--primary') || f.querySelector('[type="submit"]');
        }

        function setBusy(on) {
            busy = !!on;
            const p = primaryBtn();
            if (p) {
                p.disabled = !!on;
                p.classList.toggle('kit-btn--busy', !!on);
            }
            f.classList.toggle('is-busy', !!on);
        }

        function showError(msg) {
            // Unhide before writing, for the reason spelled out in
            // setFieldError: a display:none node is not in the accessibility
            // tree, so a mutation while hidden is a mutation nobody hears.
            const text = msg == null ? '' : String(msg);
            if (text) err.hidden = false;
            err.textContent = text;
            if (!text) err.hidden = true;
        }

        /**
         * The node that actually holds a value, starting from the one that
         * carries the name.
         *
         * ⛔ A COMPOSITE PUTS THE TWO ON DIFFERENT NODES, and the kit's own
         * factories are not the only ones that will: a module converting a
         * screen will leave a name on some inner input inside a wrapper it
         * built. So this walks up to the form rather than trusting that the
         * named node is the value node. Bounded by `f`, so it cannot climb out
         * of the form it was given.
         */
        function valueHost(n) {
            if (typeof n.kitValue === 'function') return n;
            // Inside before outside: a name on a wrapper refers to what it
            // wraps, which is what a module gets when it puts a kit control in
            // a layout div and copies the name off the markup it is replacing.
            const inner = n.querySelectorAll ? n.querySelectorAll('*') : [];
            for (let i = 0; i < inner.length; i++) {
                if (typeof inner[i].kitValue === 'function') return inner[i];
            }
            let cur = n.parentElement;
            while (cur && cur !== f) {
                if (typeof cur.kitValue === 'function') return cur;
                cur = cur.parentElement;
            }
            return null;
        }

        /** The elements whose `.value` is a real answer rather than an artefact. */
        const NATIVE_VALUE = /^(INPUT|TEXTAREA|SELECT)$/;

        function values() {
            const out = {};
            Array.from(f.querySelectorAll('[name]')).forEach((n) => {
                const key = n.getAttribute('name');
                if (!key) return;
                // First in document order wins, so a composite whose name is on
                // both the root and something inside is read once.
                if (Object.prototype.hasOwnProperty.call(out, key)) return;
                // kitValue() first: the money field's answer is cents, not the
                // dollars-with-a-comma string sitting in the box.
                const host = valueHost(n);
                if (host) out[key] = host.kitValue();
                else if (n.type === 'checkbox') out[key] = !!n.checked;
                else if (NATIVE_VALUE.test(n.tagName)) out[key] = n.value;
                else {
                    // ⛔ NOT `out[key] = n.value`. On anything that is not a
                    // form control that reads back `undefined`, and JSON.stringify
                    // drops an undefined, so the field would leave the page
                    // without appearing anywhere — the quietest way this
                    // collector can lose an answer. Say so and omit it.
                    warn(
                        '[Kit] form: `' +
                            key +
                            '` is on a <' +
                            String(n.tagName).toLowerCase() +
                            '> that holds no value and contains nothing that does. Omitting it rather than ' +
                            'submitting undefined.'
                    );
                }
            });
            return out;
        }

        f.addEventListener('submit', (e) => {
            e.preventDefault();
            // A second Enter while the first is in flight is a second write.
            if (busy) return;
            showError('');
            setBusy(true);
            Promise.resolve()
                .then(() => (typeof o.onSubmit === 'function' ? o.onSubmit(values(), handle) : null))
                .then(
                    () => setBusy(false),
                    (reason) => {
                        setBusy(false);
                        // ⛭ THE SERVER'S OWN SENTENCE, when it sent one. A
                        // generic "Something went wrong" written over the top of
                        // "Payroll is locked for this period" is the portal
                        // telling the user less than it already knows.
                        showError((reason && reason.message) || 'Could not save. Try again.');
                    }
                );
        });

        const handle = { el: f, setBusy: setBusy, error: showError, values: values };
        return handle;
    }

    /* ---- exports ---- */
    Kit.modal = modal;
    Kit.drawer = drawer;
    Kit.popUpWindow = popUpWindow;
    Kit.sideSheet = sideSheet;
    Kit.fullScreen = fullScreen;
    /**
     * Close every open modal and drawer, top first (and every pop-up window,
     * side sheet, full screen and pop-up, which share the stack). Settings calls it when a
     * tab is left: a drawer a tab opened used to stay on screen over the next
     * tab and swallow its clicks (walked on staging 2026-09-25: a camera's
     * drawer sat over Recognition).
     */
    Kit.closeAll = function closeAll() {
        stack
            .slice()
            .reverse()
            .forEach((h) => {
                try {
                    h.close(undefined);
                } catch (e) {
                    // Every other one still closes; a caller's onClose that
                    // threw is said out loud rather than swallowed.
                    warn('[Kit] closeAll: an onClose threw while closing', e);
                }
            });
    };
    Kit.confirm = kitConfirm;
    Kit.field = field;
    Kit.setFieldError = setFieldError;
    Kit.clearFieldError = clearFieldError;
    Kit.input = input;
    Kit.toggle = toggle;
    Kit.switch = onOffSwitch;
    Kit.tickBox = tickBox;
    Kit.pickOne = pickOne;
    Kit.saveNote = saveNote;
    Kit.settingRow = settingRow;
    Kit.select = select;
    Kit.datePicker = datePicker;
    Kit.timePicker = timePicker;
    Kit.rangePicker = rangePicker;
    Kit.rangeButton = rangeButton;
    Kit.rangePresets = rangePresets;
    Kit.dayStrip = dayStrip;
    Kit.moneyNumber = moneyNumber;
    Kit.searchField = searchField;
    Kit.popupSearch = popupSearch;
    Kit.signInField = signInField;
    Kit.toolbarDropdown = toolbarDropdown;
    Kit.buttonMenu = buttonMenu;
    Kit.filterButton = filterButton;
    Kit.filterChip = filterChip;
    Kit.pickChips = pickChips;
    Kit.slider = slider;
    Kit.form = form;
    Kit.__forms = true;
})();
