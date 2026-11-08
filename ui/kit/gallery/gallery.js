/* Safe Home kit gallery: renders every standard in the vendored ARGUS UI
 * library registry, in every documented state, with the real kit parts.
 * Standalone: needs only kit.js, kit.css, kit-gallery.js, kit-gallery.css.
 *
 * Draws with the library's own NS.drawMatrix (vendor/gallery/frame.js) and
 * NS.renderers (vendor/gallery/render.js). The only thing this file adds is
 * the page around them: family nav, a theme toggle, lazy drawing.
 *
 * ?all=1       draw every standard now (used by the console check)
 * ?family=tabs only that family
 * #std-<key>   jump to a standard
 */
import registry from '../vendor/gallery/registry.json';

(function () {
    'use strict';
    var NS = window.ArgusUILibrary;
    var Kit = window.Kit;
    var HB = window.HomeBeaconKit;
    var q = new URLSearchParams(location.search);
    var drawAll = q.get('all') === '1';
    var onlyFamily = q.get('family');

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    // Families in registry order.
    var families = [];
    var byFamily = {};
    registry.forEach(function (e) {
        if (!byFamily[e.family]) {
            byFamily[e.family] = { id: e.family, title: e.familyTitle, items: [] };
            families.push(byFamily[e.family]);
        }
        byFamily[e.family].items.push(e);
    });
    var visible = onlyFamily ? families.filter(function (f) { return f.id === onlyFamily; }) : families;

    var root = document.getElementById('hbg');
    root.classList.add('kit', 'hbg');

    /* header */
    var head = el('header', 'hbg-head');
    var brand = el('div', 'hbg-brand');
    brand.appendChild(el('span', 'hbg-lamp'));
    var bt = el('div', 'hbg-brand__text');
    bt.appendChild(el('p', 'hbg-eyebrow', 'Safe Home UI kit'));
    bt.appendChild(el('h1', 'hbg-title', 'Every part, every state'));
    brand.appendChild(bt);
    head.appendChild(brand);

    var tools = el('div', 'hbg-tools');
    var count = el('p', 'hbg-count', families.length + ' families, ' + registry.length + ' standards');
    tools.appendChild(count);
    var toggle = el('button', 'kit-main-action hbg-toggle');
    toggle.type = 'button';
    function paintToggle() {
        var t = HB.theme();
        toggle.textContent = t === 'dark' ? 'Dusk (dark)' : 'Paper (light)';
        toggle.setAttribute('aria-label', 'Theme: ' + (t === 'dark' ? 'dark' : 'light') + '. Switch to ' + (t === 'dark' ? 'light' : 'dark'));
    }
    toggle.addEventListener('click', function () {
        HB.toggleTheme();
    });
    document.addEventListener('hbkit:theme', paintToggle);
    paintToggle();
    tools.appendChild(toggle);
    head.appendChild(tools);

    /* nav */
    var nav = el('nav', 'hbg-nav');
    nav.setAttribute('aria-label', 'Families');
    var navList = el('ul', 'hbg-nav__list');
    families.forEach(function (f) {
        var li = el('li');
        var a = el('a', 'hbg-nav__link');
        a.href = '#family-' + f.id;
        a.appendChild(el('span', 'hbg-nav__name', f.title.split(',')[0]));
        a.appendChild(el('span', 'hbg-nav__n', String(f.items.length)));
        li.appendChild(a);
        navList.appendChild(li);
    });
    nav.appendChild(navList);

    /* main */
    var main = el('main', 'hbg-main');
    main.id = 'hbgMain';
    var skip = el('a', 'kit-skip-link', 'Skip to the parts');
    skip.href = '#hbgMain';

    var pending = [];
    var drawn = 0;
    var errors = [];

    function drawStandard(art) {
        if (art.__drawn) return;
        art.__drawn = true;
        var entry = art.__entry;
        var host = art.querySelector('.hbg-matrix');
        try {
            NS.drawMatrix(host, entry, HB.theme());
        } catch (err) {
            console.error('[hbkit-gallery] ' + entry.key, err);
            host.textContent = 'Could not draw ' + entry.key + ': ' + (err && err.message);
        }
        drawn++;
        host.querySelectorAll('[data-uil-error]').forEach(function (c) {
            errors.push(entry.key + ' ' + c.getAttribute('data-uil-state') + ': ' + c.getAttribute('data-uil-error'));
        });
        art.setAttribute('data-hbg-drawn', '1');
    }

    var io = null;
    if (!drawAll && typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver(
            function (list) {
                list.forEach(function (it) {
                    if (it.isIntersecting) {
                        io.unobserve(it.target);
                        drawStandard(it.target);
                    }
                });
            },
            { rootMargin: '900px 0px' }
        );
    }

    visible.forEach(function (f) {
        var sec = el('section', 'hbg-family');
        sec.id = 'family-' + f.id;
        var h = el('h2', 'hbg-family__title', f.title);
        sec.appendChild(h);
        sec.appendChild(el('p', 'hbg-family__meta', f.items.length + ' standards'));
        f.items.forEach(function (e) {
            var art = el('article', 'hbg-std');
            art.id = 'std-' + e.key;
            art.__entry = e;
            var top = el('header', 'hbg-std__head');
            var left = el('div', 'hbg-std__id');
            left.appendChild(el('h3', 'hbg-std__role', e.role));
            left.appendChild(el('p', 'hbg-std__variant', e.variantName));
            top.appendChild(left);
            var right = el('div', 'hbg-std__meta');
            var code = el('code', 'hbg-std__kit', e.kit);
            right.appendChild(code);
            right.appendChild(el('span', 'hbg-std__kind hbg-std__kind--' + e.kind, e.kind === 'kit' ? 'kit part' : 'reference'));
            top.appendChild(right);
            art.appendChild(top);
            art.appendChild(el('p', 'hbg-std__usage', e.usage));
            var states = el('p', 'hbg-std__states');
            states.textContent = 'States: ' + e.states.join(', ') + (e.variants && e.variants.length ? '. Variants: ' + e.variants.map(function (v) { return v.label || v.id; }).join(', ') : '');
            art.appendChild(states);
            var matrix = el('div', 'hbg-matrix');
            matrix.appendChild(el('p', 'hbg-matrix__wait', 'Drawing...'));
            art.appendChild(matrix);
            sec.appendChild(art);
            if (io) io.observe(art);
            else pending.push(art);
        });
        main.appendChild(sec);
    });

    var shell = el('div', 'hbg-shell');
    shell.appendChild(nav);
    shell.appendChild(main);
    root.appendChild(skip);
    root.appendChild(head);
    root.appendChild(shell);

    /* drawing everything at once, in slices so the page stays responsive */
    function finish() {
        window.__hbgReport = { families: visible.length, standards: pending.length || drawn, drawn: drawn, errors: errors, done: true };
        document.body.setAttribute('data-hbg-ready', errors.length ? 'error' : '1');
    }
    if (!io) {
        (function slice() {
            var t = Date.now();
            while (pending.length && Date.now() - t < 40) drawStandard(pending.shift());
            if (pending.length) setTimeout(slice, 0);
            else setTimeout(finish, 600);
        })();
    }

    /* the matrices do not depend on the theme, but the date renderers and the
       library read the page theme once; redraw the visible ones so nothing is stale */
    document.addEventListener('hbkit:theme', function (ev) {
        document.querySelectorAll('.hbg-matrix[data-uil-theme]').forEach(function (m) {
            m.setAttribute('data-uil-theme', ev.detail.theme);
        });
    });

    if (location.hash && location.hash.indexOf('#std-') === 0) {
        var target = document.getElementById(location.hash.slice(1));
        if (target) {
            drawStandard(target);
            target.scrollIntoView();
        }
    }
})();
