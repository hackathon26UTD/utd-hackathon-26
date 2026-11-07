/* ===========================================================================
 * The portal kit: motion.
 *
 * Owner, 2026-09-22: "animations, for all pages, when pages load ... even when
 * kpis load up like bar graphs and line charts and count ups."
 *
 *   Kit.motion.canMove()                  may this browser animate right now?
 *                                         (honours <html data-motion>: "reduce"
 *                                         never moves, "full" moves even when
 *                                         the computer asks for reduced motion)
 *   Kit.motion.preference()               'system' | 'reduce' | 'full'
 *   Kit.motion.plan(key, value)           what showing `value` under `key`
 *                                         should do, or null for nothing
 *   Kit.motion.firstLook(key)             true once per visit to the page
 *   Kit.motion.whenSeen(el, onSeen, onGiveUp)
 *   Kit.motion.tween(plan, draw)          count a plan's number; returns stop()
 *   Kit.motion.at(plan, t)                the number a plan shows at time t
 *   Kit.motion.delayFor(el, selector)     a cascade step for el among siblings
 *   Kit.motion.reveal(el, key)            play a chart's entrance once per visit,
 *                                         when it comes into view (see below)
 *   Kit.motion.countText(el, key, value, format)
 *                                         count a plain number into el's text
 *   Kit.motion.changed(key, value)        has this status changed since it was
 *                                         last drawn? (a camera going down)
 *
 * A plan is { from, to, startAt, first }. The FIRST time a key is shown on a
 * visit to a page it counts up from zero (and `first` lets the caller draw and
 * raise the card in); when a repaint brings a NEW value it counts from wherever
 * the old one had got to; the same value again does nothing at all.
 *
 * ⛔ THE FINAL TEXT IS WRITTEN FIRST, ALWAYS. Callers render the finished card
 *    and only then ask for a plan, so a browser that cannot move (no
 *    matchMedia, no IntersectionObserver, reduced motion, a test) keeps exactly
 *    what it would have shown without this file. Nothing here ever waits on
 *    `animationend`.
 *
 * ⛔ A REPAINT IS NOT A NEW LOOK. Employees repaints Today as each of its reads
 *    lands, up to five times in the first second, and Loss Prevention redraws
 *    its overview on a timer. Plans are keyed and shared, and time-based: a
 *    card rebuilt mid-count picks up the same count at the same moment instead
 *    of starting again, and a card rebuilt with an unchanged value stays still.
 *    Plans are forgotten when a page becomes active, so every visit to a page
 *    plays it once.
 *
 * ⛔ NOTHING WAITS FOREVER. A card that never comes into view is either
 *    scrolled away (nobody is looking; it keeps waiting) or not rendered at all
 *    (a hidden pane, or thrown away by a repaint); the second gives up and
 *    shows the final state, so a pane opened later never shows a half-drawn
 *    card.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__motion) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        if (window.console && console.warn) {
            console.warn('[Kit] motion: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const DURATION = 900; // a count, and the line drawing in beside it
    const STEP = 70; // the cascade between siblings
    const GIVE_UP = 1500;
    const REVEAL_WINDOW = 1400; // the longest chart entrance, cascade included

    const plans = new Map();
    const looks = new Set();
    const reveals = new Map();
    const states = new Map(); // kept for the session, not cleared per visit

    function now() {
        const p = window.performance;
        return p && typeof p.now === 'function' ? p.now() : Date.now();
    }

    /**
     * The person's own Motion choice (Settings > Preferences), published as
     * <html data-motion="reduce|full">; absent means "follow the computer".
     * index.html puts it back at boot, before the first paint.
     */
    function preference() {
        const v = document.documentElement.getAttribute('data-motion');
        return v === 'reduce' || v === 'full' ? v : 'system';
    }

    function canMove() {
        const w = window;
        const pref = preference();
        if (pref === 'reduce') return false;
        if (
            typeof w.matchMedia !== 'function' ||
            typeof w.requestAnimationFrame !== 'function' ||
            typeof w.IntersectionObserver !== 'function'
        ) {
            return false;
        }
        // "Full" is the person overriding the computer's reduce setting for
        // this app, so the OS query is only asked when they have not chosen.
        if (pref !== 'full') {
            try {
                if (w.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
            } catch (e) {
                return false;
            }
        }
        return document.visibilityState !== 'hidden';
    }

    // Ease-out cubic: quick to leave zero, gentle onto the real number.
    function ease(k) {
        return 1 - Math.pow(1 - k, 3);
    }

    function at(p, t) {
        if (!p || p.startAt === null) return p ? p.from : 0;
        const k = Math.max(0, Math.min(1, (t - p.startAt) / DURATION));
        return p.from + (p.to - p.from) * ease(k);
    }

    function plan(key, value) {
        if (!canMove() || typeof value !== 'number' || !isFinite(value)) return null;
        const t = now();
        const p = plans.get(key);
        if (p && p.to === value) {
            // Waiting to be seen, or mid-count: the rebuilt card carries on.
            if (p.startAt === null || t - p.startAt < DURATION) return p;
            return null;
        }
        const next = { from: p ? at(p, t) : 0, to: value, startAt: null, first: !p };
        plans.set(key, next);
        if (next.from === value && !next.first) return null;
        return next;
    }

    function firstLook(key) {
        if (!canMove() || looks.has(key)) return false;
        looks.add(key);
        return true;
    }

    // Every visit to a page plays once: forget the plans when a page becomes
    // active. main.js's showPage toggles `.active` on `section.page`.
    function watchPages() {
        if (typeof window.MutationObserver !== 'function') return;
        const pages = document.querySelectorAll('section.page');
        if (!pages.length) return;
        const mo = new window.MutationObserver((records) => {
            for (const r of records) {
                const was = String(r.oldValue || '').split(/\s+/);
                if (r.target.classList.contains('active') && was.indexOf('active') === -1) {
                    plans.clear();
                    looks.clear();
                    reveals.clear();
                    return;
                }
            }
        });
        pages.forEach((page) =>
            mo.observe(page, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
        );
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPages);
    else watchPages();

    function whenSeen(node, onSeen, onGiveUp) {
        let settled = false;
        let io = null;
        let timer = 0;
        const settle = (fn) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (io) io.disconnect();
            try {
                if (typeof fn === 'function') fn();
            } catch (e) {
                // A throw here must never leave a card waiting at 1% opacity.
                if (fn !== onGiveUp && typeof onGiveUp === 'function') onGiveUp();
            }
        };
        const check = () => {
            if (!node.isConnected || !node.getClientRects().length) return settle(onGiveUp);
            // ⛔ The observer can miss an element that is plainly on screen:
            // Chrome clips a target by its OWN clip-path, so a chart hidden that
            // way is never "intersecting" and would wait forever. Hide children,
            // never the observed element; and if it is in the viewport anyway,
            // it has been seen.
            const r = node.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            if (r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw) return settle(onSeen);
            timer = setTimeout(check, GIVE_UP);
        };
        timer = setTimeout(check, GIVE_UP);
        try {
            io = new window.IntersectionObserver(
                (entries) => {
                    if (entries.some((e) => e.isIntersecting)) settle(onSeen);
                },
                { threshold: 0.15 }
            );
            io.observe(node);
        } catch (e) {
            settle(onGiveUp);
        }
    }

    function tween(p, draw) {
        let live = true;
        let id = 0;
        const frame = () => {
            if (!live) return;
            const t = now();
            if (p.startAt !== null && t - p.startAt >= DURATION) {
                live = false;
                draw(p.to, true);
                return;
            }
            draw(at(p, t), false);
            id = window.requestAnimationFrame(frame);
        };
        frame();
        return function stop() {
            live = false;
            if (id && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
        };
    }

    /** This element's step in a left-to-right cascade of its matching siblings. */
    function delayFor(node, selector) {
        const parent = node && node.parentElement;
        if (!parent) return 0;
        const peers = Array.prototype.filter.call(parent.children, (c) => !selector || c.matches(selector));
        return Math.max(0, peers.indexOf(node)) * STEP;
    }

    /**
     * A chart's entrance, once per visit, when it comes into view. The element
     * gets `is-motion-waiting` now (its own CSS hides whatever will move) and
     * `is-motion-playing` once seen (its CSS plays it: bars rising, a band
     * filling). If it is never rendered the waiting class simply goes and the
     * chart is there, finished. Returns whether it will play.
     *
     * ⛔ Keyed and shared, like plan(): Employees rebuilds its timeline as each
     * read lands, and a rebuilt chart joins the entrance instead of being the
     * one that never plays. `--motion-lag` (zero or negative) is set on the
     * element so its CSS can start a joined entrance part-way through:
     * `animation-delay: calc(var(--motion-lag, 0ms) + var(--motion-i, 0) * 22ms)`.
     */
    function reveal(node, key) {
        if (!node || !canMove()) return false;
        let r = reveals.get(key);
        if (r && r.startAt !== null && now() - r.startAt >= REVEAL_WINDOW) return false;
        if (!r) {
            r = { startAt: null };
            reveals.set(key, r);
        }
        node.classList.add('is-motion-waiting');
        whenSeen(
            node,
            () => {
                node.classList.remove('is-motion-waiting');
                if (r.startAt === null) r.startAt = now();
                const lag = r.startAt - now();
                if (lag <= -REVEAL_WINDOW) return;
                node.style.setProperty('--motion-lag', Math.round(lag) + 'ms');
                node.classList.add('is-motion-playing');
            },
            () => node.classList.remove('is-motion-waiting')
        );
        return true;
    }

    /**
     * Count a plain number into `node`'s text, `format(v)` each frame (whole
     * numbers by default). The final text is written first and is what stays
     * when nothing may move.
     */
    function countText(node, key, value, format) {
        const fmt = typeof format === 'function' ? format : (v) => Math.round(v).toLocaleString('en-US');
        node.textContent = fmt(value);
        const p = plan(key, value);
        if (!p) return false;
        node.textContent = fmt(p.startAt === null ? p.from : at(p, now()));
        whenSeen(
            node,
            () => {
                if (p.startAt === null) p.startAt = now();
                tween(p, (v, done) => {
                    node.textContent = fmt(done ? value : v);
                });
            },
            () => {
                node.textContent = fmt(value);
            }
        );
        return true;
    }

    /**
     * Has the status under `key` changed since it was last drawn? False the
     * first time (there is nothing to compare with) and whenever motion is off.
     * Remembered for the whole session, across page visits: a camera that went
     * down while you were on another page still pulses when you come back.
     */
    function changed(key, value) {
        const had = states.has(key);
        const prev = states.get(key);
        states.set(key, value);
        return had && prev !== value && canMove();
    }

    Kit.motion = {
        canMove,
        preference,
        reveal,
        countText,
        changed,
        plan,
        firstLook,
        whenSeen,
        tween,
        at,
        delayFor,
        now,
        DURATION,
        STEP
    };
    Kit.__motion = true;
})();
