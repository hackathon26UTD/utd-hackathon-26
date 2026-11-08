/* ===========================================================================
 * Safe Home shims for the vendored ARGUS UI kit. This is the ONLY place a
 * missing portal dependency is papered over; the vendored files stay as they
 * were in the source repo. See ui/kit/PROVENANCE.md for the audit.
 *
 * What the kit reads from the portal, and what we do about each:
 *   window.Logger            optional. core.js falls back to console.warn.   -> no shim
 *   window.ArgusRangePicker  optional. components.js/forms.js carry local
 *                            fallbacks for labels and windows.                -> no shim
 *   window.lockBodyScroll    optional. forms.js keeps a counted fallback.     -> no shim
 *   window.ArgusTable        defined by vendor/js/kit/table.js itself.        -> no shim
 *   body.light-mode          THE theme switch. Light = class present, dark =
 *                            absent. No other path in the kit.                -> THIS FILE
 *   window.confirm/alert     banned by the kit; never called.                 -> no shim
 *
 * So the one real shim is the theme switch, plus a tiny stub used by the
 * gallery's reference renderers (see ui/kit/gallery/reference-stubs.js).
 *
 * API:  HomeBeaconKit.theme()                 -> 'dark' | 'light'
 *       HomeBeaconKit.setTheme('dark'|'light')
 *       HomeBeaconKit.toggleTheme()
 *       document 'hbkit:theme' event, detail { theme }
 * =========================================================================== */
(function () {
    'use strict';
    if (window.HomeBeaconKit) return;
    var KEY = 'hbkit-theme';
    var current = 'light';

    function read() {
        try {
            var v = window.localStorage.getItem(KEY);
            if (v === 'light' || v === 'dark') return v;
        } catch (e) {
            /* storage blocked: fall through to the system setting */
        }
        return 'light';
    }
    function write(theme) {
        try {
            window.localStorage.setItem(KEY, theme);
        } catch (e) {
            /* storage blocked: the choice lasts for this page only */
        }
    }
    function paint(theme) {
        var de = document.documentElement;
        de.setAttribute('data-hbkit-theme', theme);
        de.style.colorScheme = theme;
        if (document.body) document.body.classList.toggle('light-mode', theme === 'light');
    }

    var api = {
        theme: function () {
            return current;
        },
        setTheme: function (theme, opts) {
            theme = theme === 'light' ? 'light' : 'dark';
            current = theme;
            paint(theme);
            if (!opts || opts.persist !== false) write(theme);
            document.dispatchEvent(new CustomEvent('hbkit:theme', { detail: { theme: theme } }));
            return theme;
        },
        toggleTheme: function () {
            return api.setTheme(current === 'dark' ? 'light' : 'dark');
        }
    };
    window.HomeBeaconKit = api;

    current = read();
    paint(current);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            paint(current);
        });
    }
})();

/* ---------------------------------------------------------------------------
 * Brand art. Kit.standaloneMark and Kit.logoLockup (vendor/js/kit/components.js
 * 2786-2823) hard-code the ARGUS artwork as relative URLs under assets/logo/.
 * Those files are not ours. Image sources that name them are pointed at the
 * Safe Home marks instead, before the request is made. Only <img> src
 * attributes matching that exact pattern are touched.
 * Art: ui/kit/brand/*.svg, copied to public/assets/logo/ by scripts/build-ui.mjs.
 * ------------------------------------------------------------------------- */
(function () {
    'use strict';
    var proto = window.HTMLImageElement && window.HTMLImageElement.prototype;
    if (!proto || proto.__hbkitBrand) return;
    var MAP = {
        'argus-mark-onlight': 'homebeacon-mark-onlight',
        'argus-mark-ondark': 'homebeacon-mark-ondark',
        'argus-icon-light': 'homebeacon-mark-ondark',
        'argus-wordmark-onlight': 'homebeacon-wordmark-onlight',
        'argus-wordmark-ondark': 'homebeacon-wordmark-ondark'
    };
    var original = proto.setAttribute;
    proto.setAttribute = function (name, value) {
        if (name === 'src' && typeof value === 'string') {
            var m = value.match(/^\/?assets\/logo\/(argus-[a-z-]+)\.png(\?.*)?$/);
            if (m && MAP[m[1]]) value = '/assets/logo/' + MAP[m[1]] + '.svg';
        }
        return original.call(this, name, value);
    };
    proto.__hbkitBrand = true;
})();
