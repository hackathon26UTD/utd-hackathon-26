// apps/portal-frontend/js/ui-library/frame.js
/* ui-library-frame.html?std=<key>&theme=dark|light: one standard, one theme. */
(function () {
    'use strict';
    var NS = (window.ArgusUILibrary = window.ArgusUILibrary || {});
    var FORCED = { hover: 'hover', focus: 'focus', pressed: 'pressed' };
    // A look a variant can force that is not an interaction state: 'still'
    // is how reduced motion draws a part that moves (kit-standards.css reads it with
    // [data-kit-force~='still'] beside its reduced-motion blocks), and
    // 'leaving' is a notification frozen halfway through its lift-out. A
    // variant may also force focus beside the state it is drawn in: a skip
    // link only shows while it has focus, so its hover is drawn on a link
    // that has focus and the pointer.
    var VARIANT_FORCE = { still: 'still', leaving: 'leaving', focus: 'focus' };
    var LABEL = {
        default: 'Default',
        hover: 'Hover',
        focus: 'Keyboard focus',
        pressed: 'Pressed',
        selected: 'Selected',
        open: 'Open',
        disabled: 'Disabled',
        busy: 'Busy',
        error: 'Error',
        empty: 'Empty'
    };
    function el(t, c, x) {
        var n = document.createElement(t);
        if (c) n.className = c;
        if (x != null) n.textContent = x;
        return n;
    }

    NS.applyTheme = function (theme) {
        document.body.classList.toggle('light-mode', theme !== 'dark');
    };

    // A standard drawn in a module's colour (the progress bar's Inventory
    // teal) opens that module, as the app does: css/argus-crm.css keys
    // --crm-mod on body[data-active-module]. A standard with none opens none.
    NS.applyModule = function (entry) {
        if (entry && entry.module) document.body.setAttribute('data-active-module', String(entry.module));
        else document.body.removeAttribute('data-active-module');
    };

    // A standard the shell draws only once it has mounted (the main side
    // menu: css/chrome-v7.css keys on body.chrome-v7-mounted) opens that
    // class on <body>, as the app does. A standard with none opens none.
    var bodyClass = null;
    NS.applyBody = function (entry) {
        if (bodyClass) document.body.classList.remove(bodyClass);
        bodyClass = entry && entry.bodyClass ? String(entry.bodyClass) : null;
        if (bodyClass) document.body.classList.add(bodyClass);
    };

    // A part that can only finish once it is on the page (a chart measures
    // its own width; a pointer is put at a point on it) hands the frame a
    // step for then: NS.onDrawn(fn). The steps run as soon as the whole
    // matrix is in the document, before the frame says it is ready, so the
    // local check never reads a half-drawn cell. A step that throws marks
    // only its own cell. A step may hand back a promise: the frame waits for
    // it (NS.settled) up to NS.stepTimeout, and one that fails or never
    // settles marks its cell too. Called outside a matrix, the step runs at
    // once.
    var drawnSteps = null;
    var drawingCell = null;
    NS.stepTimeout = 4000;
    NS.settled = null;
    NS.onDrawn = function (fn) {
        if (typeof fn !== 'function') return;
        if (drawnSteps) drawnSteps.push({ cell: drawingCell, fn: fn });
        else fn();
    };
    function failCell(c, key, state, err) {
        var msg = (err && err.message) || String(err);
        console.error('[ui-library] ' + key + ' (' + state + '):', err);
        c.setAttribute('data-uil-error', msg);
        var stage = c.querySelector('.uil-cell__stage');
        if (stage) stage.replaceChildren(el('p', 'uil-missing', 'Could not draw ' + state + ': ' + msg));
    }

    // Wait for one step's promise, but never longer than NS.stepTimeout: a
    // step that never settles must not keep the frame from saying it is done.
    function settle(p, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () {
                reject(new Error('did not finish in ' + ms + 'ms'));
            }, ms);
            p.then(
                function (v) {
                    clearTimeout(t);
                    resolve(v);
                },
                function (err) {
                    clearTimeout(t);
                    reject(err);
                }
            );
        });
    }
    // The steps still finishing, each with its cell, so a wait that goes
    // wrong as a whole can still say which cells never finished.
    NS.pending = [];
    function runSteps(steps, key) {
        var waits = [];
        NS.pending = [];
        steps.forEach(function (s) {
            // A cell that already failed to draw has nothing left to finish.
            if (s.cell && s.cell.hasAttribute('data-uil-error')) return;
            var fail = function (err) {
                if (s.cell) failCell(s.cell, key, s.cell.getAttribute('data-uil-state'), err);
                else console.error('[ui-library] ' + key + ':', err);
            };
            try {
                var out = s.fn();
                if (out && typeof out.then === 'function') {
                    var mark = { cell: s.cell, done: false };
                    NS.pending.push(mark);
                    var end = function () {
                        mark.done = true;
                    };
                    waits.push(
                        settle(Promise.resolve(out), NS.stepTimeout)
                            .catch(fail)
                            .then(end, function (err) {
                                end();
                                throw err;
                            })
                    );
                }
            } catch (err) {
                fail(err);
            }
        });
        return waits.length ? Promise.all(waits).then(function () {}) : null;
    }
    // The wait itself went wrong: every cell still finishing says so, and
    // the frame says it failed rather than never saying it is done.
    NS.failPending = function (key, err) {
        (NS.pending || []).forEach(function (m) {
            if (m.done || !m.cell || m.cell.hasAttribute('data-uil-error')) return;
            failCell(m.cell, key, m.cell.getAttribute('data-uil-state'), err || new Error('did not finish'));
        });
    };

    // The step queue lives only while one matrix draws: whatever happens in
    // the middle, it is put back, so a later call never lands in a dead queue.
    NS.drawMatrix = function (root, entry, theme) {
        var steps = [];
        drawnSteps = steps;
        NS.settled = null;
        try {
            drawInto(root, entry, theme);
        } finally {
            drawnSteps = null;
            drawingCell = null;
        }
        NS.settled = runSteps(steps, entry.key);
        return root;
    };

    function drawInto(root, entry, theme) {
        root.replaceChildren();
        var render = NS.renderers && NS.renderers[entry.key];
        if (typeof render !== 'function') {
            root.appendChild(el('p', 'uil-missing', 'Not built yet: ' + entry.key));
            return;
        }
        var row = el('div', 'uil-matrix');
        // One bad state must not wipe the matrix: a renderer that throws, or
        // hands back something that is not a DOM node, gets an error cell in
        // its place while every other cell still draws.
        function cell(state, variant, label, look) {
            var c = el('section', 'uil-cell');
            c.setAttribute('data-uil-state', state);
            if (variant) c.setAttribute('data-uil-variant', variant);
            c.appendChild(el('h2', 'uil-cell__label', label));
            var stage = el('div', 'uil-cell__stage');
            drawingCell = c;
            try {
                var part = render(state, variant || null);
                if (!part || typeof part.nodeType !== 'number') {
                    throw new Error('renderer did not return a DOM node');
                }
                // Every marked target takes the forced state: a pointer over a
                // chip's x is over the chip too, so a renderer can mark both.
                var targets = part.querySelectorAll ? part.querySelectorAll('[data-uil-target]') : [];
                if (!targets.length) targets = [part];
                var force = [FORCED[state], VARIANT_FORCE[look]].filter(Boolean).join(' ');
                if (force) {
                    Array.prototype.forEach.call(targets, function (t) {
                        t.setAttribute('data-kit-force', force);
                    });
                }
                stage.appendChild(part);
            } catch (err) {
                var msg = (err && err.message) || String(err);
                console.error('[ui-library] ' + entry.key + ' (' + state + '):', err);
                c.setAttribute('data-uil-error', msg);
                stage.appendChild(el('p', 'uil-missing', 'Could not draw ' + state + ': ' + msg));
            }
            drawingCell = null;
            c.appendChild(stage);
            row.appendChild(c);
        }
        entry.states.forEach(function (state) {
            cell(state, null, LABEL[state] || state);
        });
        // A variant is drawn at rest, or in the state it names (`state`), so a
        // look that is not an interaction state can still be shown hovered or
        // open: the frame forces hover, focus and pressed on it as on any cell.
        // A variant may also force a look (`force`, e.g. 'still').
        (entry.variants || []).forEach(function (v) {
            cell(v.state || 'default', v.id, v.label || v.id, v.force);
        });
        drawnSteps = null;
        root.appendChild(row);
        root.setAttribute('data-uil-theme', theme);
    }

    // Route sheets carry their cache-bust stamp (from cache-bust.manifest.json,
    // served no-cache): /css/* is immutable for a year, so an unstamped href
    // would show a year-old sheet.
    // A route sheet's manifest entry is either { v } or { under: 'js/main.js' },
    // meaning it carries main.js's stamp (manifest.stamps). loadScripts uses
    // the same lookup.
    NS.stampFor = function (manifest, href) {
        var a = manifest && manifest.assets && manifest.assets[href];
        return a ? a.v || (a.under && manifest.stamps && manifest.stamps[a.under]) || null : null;
    };

    // A sheet the page already carries (a global one, copied into the head
    // from index.html) is not loaded a second time: a second copy would sit
    // later in the cascade than the app puts it.
    function linked(href) {
        return Array.prototype.some.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
            var h = l.getAttribute('href') || '';
            return h === href || h.indexOf(href + '?') === 0;
        });
    }

    // done(failed): `failed` is every sheet that did not load, by the path
    // the registry gives it (empty when all did).
    function loadSheets(all, manifest, done) {
        var list = all.filter(function (href) {
            return !linked(href);
        });
        var left = list.length;
        var failed = [];
        if (!left) return done(failed);
        var before = document.querySelector('link[href*="css/ui-library.css"]');
        list.forEach(function (href) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            var v = NS.stampFor(manifest, href);
            l.href = v ? href + '?v=' + v : href;
            var end = function () {
                if (--left === 0) done(failed);
            };
            l.onload = end;
            l.onerror = function () {
                failed.push(href);
                end();
            };
            document.head.insertBefore(l, before);
        });
    }

    // The home module's own scripts, for a standard the library draws with
    // the real part (a reference: the main side menu is js/system/rail.js),
    // one after another in the registry's order, each with its stamp.
    // done(failed): `failed` is every script that did not load. A failed one
    // does not stop the rest, so the frame can name every file missing, and
    // it never leaves the frame waiting.
    NS.loadScripts = function (list, manifest, done) {
        // A script the page already carries is not run a second time, as a
        // sheet is not loaded twice (loadSheets).
        var queue = (list || []).filter(function (src) {
            return !Array.prototype.some.call(document.querySelectorAll('script[src]'), function (n) {
                var h = n.getAttribute('src') || '';
                return h === src || h.indexOf(src + '?') === 0;
            });
        });
        var failed = [];
        (function next() {
            var src = queue.shift();
            if (!src) return done(failed);
            var s = document.createElement('script');
            var v = NS.stampFor(manifest, src);
            s.src = v ? src + '?v=' + v : src;
            s.onload = next;
            s.onerror = function () {
                failed.push(src);
                next();
            };
            document.head.appendChild(s);
        })();
    };

    // Inside the library page the shell sizes each frame to what it holds:
    // the frame tells it how tall its matrix is, when it is ready and each
    // time that changes (pictures loading, a narrower shell). The height is
    // the matrix's own, not the page's, which never reads less than the
    // frame's own window. The shell caps it; the rest scrolls in the frame.
    NS.contentHeight = function (root) {
        var last = root && root.lastElementChild;
        // A frame that could only say why it drew nothing holds one sentence.
        if (!last) return 120;
        var pad = parseFloat(window.getComputedStyle(root).paddingBottom) || 0;
        var y = window.scrollY || window.pageYOffset || 0;
        return Math.ceil(last.getBoundingClientRect().bottom + y + pad);
    };
    var sizing = null;
    NS.reportSize = function (root) {
        if (window.parent === window || !root) return false;
        var send = function () {
            try {
                window.parent.postMessage({ type: 'uil-frame-size', height: NS.contentHeight(root) }, location.origin);
            } catch (err) {
                /* a shell elsewhere is told nothing */
            }
        };
        send();
        if (!sizing) {
            sizing = true;
            if (typeof window.ResizeObserver === 'function') new window.ResizeObserver(send).observe(root);
            window.addEventListener('load', send);
        }
        return true;
    };
    function ready(root, value) {
        document.body.setAttribute('data-uil-ready', value);
        NS.reportSize(root);
    }

    NS.bootFrame = function () {
        if (!NS.enforce(location.hostname)) return;
        var q = new URLSearchParams(location.search);
        var key = q.get('std');
        var theme = q.get('theme') === 'dark' ? 'dark' : 'light';
        NS.applyTheme(theme);
        var root = document.getElementById('uilFrame');
        Promise.all([
            fetch('js/ui-library/registry.json', { cache: 'no-cache' }).then(function (r) {
                if (r && r.ok === false) throw new Error('registry.json answered ' + r.status);
                return r.json();
            }),
            fetch('cache-bust.manifest.json', { cache: 'no-cache' })
                .then(function (r) {
                    return r.json();
                })
                .catch(function () {
                    return {};
                })
        ])
            .then(function (both) {
                var reg = both[0];
                var manifest = both[1] || {};
                if (!key) {
                    root.textContent = 'No standard given';
                    ready(root, 'error');
                    return;
                }
                var entry = reg.filter(function (e) {
                    return e.key === key;
                })[0];
                if (!entry) {
                    root.textContent = 'Unknown standard: ' + key;
                    ready(root, 'error');
                    return;
                }
                // Drawing happens inside this callback, outside the promise chain
                // loadSheets runs it from a <link> onload/onerror handler, so a
                // throw here would otherwise become an uncaught page error rather
                // than a reported one.
                NS.applyModule(entry);
                NS.applyBody(entry);
                loadSheets(entry.sheets || [], manifest, function (badSheets) {
                    NS.loadScripts(entry.scripts || [], manifest, function (badScripts) {
                        // ⛔ A FILE THAT DID NOT LOAD IS A FAILURE, NOT A
                        // DRAWING. Without its sheet a part draws in the
                        // wrong colours, without its script not at all, and
                        // either can still look finished: the frame says
                        // which file, and that it failed.
                        var bad = (badSheets || []).concat(badScripts || []);
                        if (bad.length) {
                            console.error('[ui-library] ' + entry.key + ' could not load:', bad);
                            root.textContent = 'Could not load ' + bad.join(', ') + '.';
                            ready(root, 'error');
                            return;
                        }
                        try {
                            NS.drawMatrix(root, entry, theme);
                            // A step still finishing (NS.settled) holds the
                            // ready flag back until it has, or has timed out.
                            if (NS.settled) {
                                NS.settled.then(
                                    function () {
                                        ready(root, '1');
                                    },
                                    function (err) {
                                        console.error('[ui-library] ' + entry.key + ' did not finish:', err);
                                        try {
                                            NS.failPending(entry.key, err);
                                        } catch (markErr) {
                                            console.error('[ui-library] could not mark ' + entry.key + ':', markErr);
                                        }
                                        ready(root, 'error');
                                    }
                                );
                            } else ready(root, '1');
                        } catch (err) {
                            var msg = (err && err.message) || String(err);
                            console.error('[ui-library] failed to draw ' + entry.key + ':', err);
                            root.textContent = 'Could not draw ' + entry.key + ': ' + msg;
                            ready(root, 'error');
                        }
                    });
                });
            }, fail('The registry did not load'))
            // Anything else that goes wrong before the drawing starts (an
            // entry the frame cannot open) says so with its own message.
            .catch(fail('Could not open ' + key));

        // The frame says what went wrong, in the words of the error itself.
        function fail(what) {
            return function (err) {
                var msg = (err && err.message) || String(err);
                console.error('[ui-library] ' + what + ':', err);
                root.textContent = what + ': ' + msg;
                ready(root, 'error');
            };
        }
    };

    if (/ui-library-frame/.test(location.pathname)) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', NS.bootFrame);
        else NS.bootFrame();
    }
})();
