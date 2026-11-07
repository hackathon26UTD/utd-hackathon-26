/* ===========================================================================
 * The portal kit: the guide ("Argus suggests").
 *
 * Kit.guide({ title, lead, items, done, failed, loading, compact })
 *
 * Owner, 2026-09-24: "argus is in the business of making run a store simple,
 * not just making tools and letting them figure it out, we guide them, pretty
 * much idiot proof it."
 *
 * A short ordered list of the next things to do, each with the one button that
 * does it:
 *
 *   ✦ Argus suggests                                        3 to do
 *   ① Order 2 items before they run out                 [ Order now ]
 *     Frozen Pizza multipack runs out in about 2 days.
 *   ② 1 supplier raised a cost                        [ Check prices ]
 *     Your shelf price may no longer cover it.
 *
 *   title  defaults to "Argus suggests".
 *   lead   one line under the title. Optional.
 *   items  [{ tone, title, why, action: { label, onClick } }], most urgent
 *          first. tone: 'now' (do it today), 'soon', or 'tip'. Items without a
 *          title are dropped.
 *   done   { title, body }: what shows when there is nothing to do. It must
 *          say something true: "all caught up" only means the reads that built
 *          the list came back with nothing, so callers pass `failed: true`
 *          instead of an empty list when a read did not come back.
 *   failed a read the list depends on failed: say so, never "all caught up".
 *   loading the reads that build the list are still out: a quiet "Checking
 *          what needs you", no count, and never "all caught up" (nothing has
 *          been checked yet). `failed` wins over it; items passed while
 *          loading are not drawn, so the list does not grow step by step.
 *   compact for a narrow rail (Employees' 312px "Argus suggests" column):
 *          class is-compact, the button drops under the words and the
 *          padding tightens. Same content, same order.
 *
 * ⛔ EVERY STEP IS BUILT FROM A REAL READ. A guide that invents a to-do is
 *    worse than no guide: the operator does the chore and finds nothing there.
 *    Callers derive items from data they already loaded, and leave a step out
 *    when its read failed rather than guessing.
 *
 * Styling is css/kit.css under `.kit .kit-guide`. No class contains card,
 * panel, widget, tile, -page or spin.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__guide) return;

    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        if (window.console && console.warn) {
            console.warn('[Kit] guide: js/kit/core.js must load first; nothing registered.');
        }
        return;
    }

    const el = Kit.el;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const TONES = { now: 'Do today', soon: 'This week', tip: 'Good idea' };

    function glyph(kind) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(SVG_NS, 'path');
        if (kind === 'sparkle') {
            p.setAttribute('d', 'M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z');
            p.setAttribute('class', 'is-solid');
        } else if (kind === 'check') {
            p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
        } else if (kind === 'wait') {
            p.setAttribute('d', 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM12 7.5V12l3 2');
        } else {
            p.setAttribute(
                'd',
                'M12 8v5M12 16.5h.01M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z'
            );
        }
        svg.appendChild(p);
        return svg;
    }

    function guide(opts) {
        const o = opts || {};
        const items = (Array.isArray(o.items) ? o.items : []).filter((it) => it && it.title);
        const root = el('section', {
            class: 'kit-guide' + (o.compact ? ' is-compact' : ''),
            'aria-label': o.title || 'Argus suggests'
        });

        const head = el('div', { class: 'kit-guide__head' });
        const title = el('div', { class: 'kit-guide__title' });
        title.appendChild(glyph('sparkle'));
        title.appendChild(el('span', { text: o.title || 'Argus suggests' }));
        head.appendChild(title);
        if (!o.failed && !o.loading && items.length) {
            head.appendChild(el('span', { class: 'kit-guide__count', text: items.length + ' to do' }));
        }
        root.appendChild(head);
        if (o.lead) root.appendChild(el('p', { class: 'kit-guide__lead', text: o.lead }));

        if (o.failed) {
            const f = el('div', { class: 'kit-guide__rest is-failed' });
            f.appendChild(glyph('alert'));
            f.appendChild(
                el('div', {}, [
                    el('div', { class: 'kit-guide__rest-title', text: 'Suggestions did not load' }),
                    el('div', {
                        class: 'kit-guide__rest-body',
                        text: 'That is a failed read, not a quiet store. Reload to try again.'
                    })
                ])
            );
            root.appendChild(f);
            return finish(root);
        }

        // ⛔ NOTHING HAS BEEN CHECKED YET, SO NOTHING IS CLAIMED. Not a count,
        // not a step, and above all not "all caught up": that sentence is a
        // statement about reads that have not come back.
        if (o.loading) {
            const w = el('div', { class: 'kit-guide__rest is-loading', role: 'status' });
            w.appendChild(el('span', { class: 'kit-guide__wait' }, [glyph('wait')]));
            w.appendChild(
                el('div', {}, [
                    el('div', { class: 'kit-guide__rest-title', text: 'Checking what needs you' }),
                    el('div', {
                        class: 'kit-guide__rest-body',
                        text: 'Steps appear here as soon as your data has loaded.'
                    })
                ])
            );
            root.appendChild(w);
            return finish(root);
        }

        if (!items.length) {
            const d = o.done || {};
            const rest = el('div', { class: 'kit-guide__rest' });
            const mark = el('span', { class: 'kit-guide__mark' });
            mark.appendChild(glyph('check'));
            rest.appendChild(mark);
            rest.appendChild(
                el('div', {}, [
                    el('div', { class: 'kit-guide__rest-title', text: d.title || 'All caught up' }),
                    el('div', {
                        class: 'kit-guide__rest-body',
                        text: d.body || 'Nothing needs you right now. A step appears here the moment something does.'
                    })
                ])
            );
            root.appendChild(rest);
            return finish(root);
        }

        const list = el('ol', { class: 'kit-guide__list' });
        items.forEach((it, i) => {
            const tone = TONES[it.tone] ? it.tone : 'soon';
            const step = el('li', { class: 'kit-guide__step is-' + tone });
            step.style.animationDelay = 120 + i * 70 + 'ms';
            step.appendChild(el('span', { class: 'kit-guide__num', 'aria-hidden': 'true', text: String(i + 1) }));
            const words = el('div', { class: 'kit-guide__words' });
            const top = el('div', { class: 'kit-guide__step-title' });
            top.appendChild(el('span', { text: it.title }));
            top.appendChild(el('span', { class: 'kit-guide__tone', text: TONES[tone] }));
            words.appendChild(top);
            if (it.why) words.appendChild(el('div', { class: 'kit-guide__why', text: it.why }));
            step.appendChild(words);
            if (it.action && it.action.label && typeof it.action.onClick === 'function') {
                const btn = el('button', { class: 'kit-btn kit-guide__go', type: 'button', text: it.action.label });
                btn.addEventListener('click', it.action.onClick);
                step.appendChild(btn);
            }
            list.appendChild(step);
        });
        root.appendChild(list);
        return finish(root);
    }

    // The steps slide in one after another the first time the list is seen on
    // a visit (Kit.motion.reveal); rebuilt with its page, it stays still.
    function finish(root) {
        if (Kit.motion && typeof Kit.motion.reveal === 'function') {
            Kit.motion.reveal(root, 'guide:' + (root.getAttribute('aria-label') || ''));
        }
        return root;
    }

    Kit.guide = guide;
    Kit.guide._internal = { TONES: TONES };
    Kit.__guide = true;
})();
