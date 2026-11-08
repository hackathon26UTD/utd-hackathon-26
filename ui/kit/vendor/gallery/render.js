// apps/portal-frontend/js/ui-library/render.js
/* One renderer per registry key: function (state, variant) -> HTMLElement.
 * Build the REAL part with the kit (Kit.* factories or kit classes). Mark the
 * interactive element with data-uil-target when it is not the root. Never set
 * data-kit-force here: frame.js does that for hover, focus and pressed. A
 * part that draws its focus ring on a child marks that child data-uil-ring in
 * every cell, so the local check measures the ring where it is drawn and
 * holds it against the same child at rest.
 * Build selected / open / disabled / busy / error / empty for real (class or ARIA).
 * Synthetic words only; no tenant data. DOM calls only, no HTML strings. */
(function () {
    'use strict';
    var NS = (window.ArgusUILibrary = window.ArgusUILibrary || {});
    NS.renderers = NS.renderers || {};
    NS.el = function (tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    // Family tasks add blocks below, e.g.
    // NS.renderers['buttons__main-action'] = function (state) { ... };

    var R = NS.renderers;
    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }
    function iso(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    // ONE FIXED DAY for everything the range renderers draw, so a screenshot
    // taken today matches one taken next month. The kit reads the clock
    // itself (the today ring, the preset windows, the default ceiling), so
    // onFixedDay makes the page's clock read this day, at noon, for exactly
    // the length of one renderer call, and puts the real clock back after.
    var FIXED = [2026, 5, 20]; // 2026-06-20; the month is zero-based
    function today() {
        return new Date(FIXED[0], FIXED[1], FIXED[2]);
    }
    function onFixedDay(draw) {
        return function (state, variant) {
            var Real = window.Date;
            var at = new Real(FIXED[0], FIXED[1], FIXED[2], 12).getTime();
            var Fixed = class extends Real {
                constructor() {
                    if (arguments.length) super(...arguments);
                    else super(at);
                }
                static now() {
                    return at;
                }
            };
            window.Date = Fixed;
            try {
                return draw(state, variant);
            } finally {
                window.Date = Real;
            }
        };
    }
    function addDays(d, n) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    }
    function target(node) {
        if (node) node.setAttribute('data-uil-target', '');
        return node;
    }

    /* ── Date ranges and pickers ─────────────────────────────────────── */

    // A popover or dialog opens on <body> with document listeners, a focus
    // trap and a scroll lock, none of which belongs in a matrix of twelve.
    // So the real factory opens it, the cell keeps a copy of exactly what it
    // drew, and the live one is closed straight away. The copy is placed in
    // the flow by .uil-inline (css/ui-library.css); its look is the kit's alone.
    var copies = 0;
    function inlineCopy(node) {
        var copy = node.cloneNode(true);
        copy.removeAttribute('style');
        // One page holds many copies: none of them may tell assistive
        // technology to ignore everything outside it.
        copy.removeAttribute('aria-modal');
        copy.classList.add('uil-inline');
        uniqueIds(copy, '-uil' + ++copies);
        return copy;
    }

    // A copy carries the live node's ids, and the live one is still on the
    // page while it plays its closing fade. Every id in the copy gets the
    // copy's own suffix, and every reference inside the copy follows it.
    var REFS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant', 'for'];
    function uniqueIds(root, suffix) {
        var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
        var renamed = {};
        nodes.forEach(function (n) {
            if (!n.id) return;
            renamed[n.id] = n.id + suffix;
            n.id += suffix;
        });
        nodes.forEach(function (n) {
            REFS.forEach(function (a) {
                var v = n.getAttribute(a);
                if (!v) return;
                n.setAttribute(
                    a,
                    v
                        .split(/\s+/)
                        .map(function (id) {
                            return renamed[id] || id;
                        })
                        .join(' ')
                );
            });
        });
    }

    // Kit.datePicker. Open and disabled show the month it opens on; disabled
    // is that month with min/max set, so the days outside them are off.
    R['range__date-time-field'] = onFixedDay(function (state) {
        var t = today();
        var o = { placeholder: 'Pick a date' };
        if (state === 'selected' || state === 'open' || state === 'disabled') o.value = iso(t);
        if (state === 'disabled') {
            o.min = iso(addDays(t, -6));
            o.max = iso(t);
        }
        var field = window.Kit.datePicker(o);
        var btn = target(field.querySelector('.kit-select__btn'));
        var wrap = NS.el('div', 'uil-stack');
        wrap.appendChild(field);
        if (state === 'open' || state === 'disabled') {
            btn.click();
            var pops = document.querySelectorAll('.kit.kit-pop.kit-cal');
            var pop = pops[pops.length - 1];
            var copy = pop ? inlineCopy(pop) : null;
            btn.click(); // the factory's own toggle: a second click closes it
            if (!copy) throw new Error('Kit.datePicker opened no calendar');
            btn.setAttribute('aria-expanded', 'true');
            wrap.appendChild(copy);
        }
        return wrap;
    });

    // Kit.rangePicker: the modal it opens, scrim and all. Default is a fresh
    // open; selected opens on a preset's window (the rail shows it chosen);
    // open is mid-pick, a start and no end yet; disabled has a ceiling in the
    // past, so the presets that cannot answer and the days after it are off.
    // Hover and focus land on a rail preset, which is where the ring shows.
    R['range__range-calendar'] = onFixedDay(function (state) {
        var t = today();
        var o = {};
        if (state === 'selected') {
            o.from = iso(addDays(t, -29));
            o.to = iso(t);
        } else if (state === 'hover' || state === 'focus') {
            o.from = iso(addDays(t, -26));
            o.to = iso(addDays(t, -7));
        } else if (state === 'open') {
            o.from = iso(addDays(t, -9));
        } else if (state === 'disabled') {
            o.maxDate = iso(addDays(t, -40));
        }
        var before = document.querySelectorAll('.kit.kit-modal').length;
        window.Kit.rangePicker(o);
        var all = document.querySelectorAll('.kit.kit-modal');
        var live = all.length > before ? all[all.length - 1] : null;
        if (!live) throw new Error('Kit.rangePicker opened no dialog');
        var copy = inlineCopy(live);
        var x = live.querySelector('.kit-modal__x');
        if (x) x.click(); // closes: releases the trap, the scroll lock and its listeners
        var presets = copy.querySelectorAll('.kit-range__preset');
        if (state === 'hover' || state === 'focus') target(presets[2]);
        else if (state === 'disabled') target(presets[1]);
        else if (state === 'selected') target(copy.querySelector('.kit-range__preset[aria-selected="true"]'));
        return copy;
    });

    // The dates button. Open is the button while its dialog is up. The words
    // are what the picked Financials button prints for the same window
    // (js/financials/controls.js dateLabel): en dash, no spaces.
    R['range__range-button'] = onFixedDay(function (state) {
        var t = today();
        var b = window.Kit.rangeButton({ from: iso(addDays(t, -6)), to: iso(t), label: 'Jun 14\u2013Today' });
        if (state === 'open') b.setAttribute('aria-expanded', 'true');
        return b;
    });

    // Settings' period switch, in the small size its three screens use.
    // Selected targets the chosen option; disabled targets a disabled one.
    R['range__range-presets'] = function (state) {
        var p = window.Kit.rangePresets({
            label: 'When',
            size: 'sm',
            value: '30',
            options: [
                { id: '7', label: '7 days' },
                { id: '30', label: '30 days' },
                { id: '90', label: '90 days', disabled: state === 'disabled' },
                { id: 'all', label: 'All' }
            ]
        });
        var opts = p.querySelectorAll('.kit-range-presets__opt');
        if (state === 'hover' || state === 'focus') target(opts[0]);
        else if (state === 'selected') target(opts[1]);
        else if (state === 'disabled') target(opts[2]);
        return p;
    };

    // Inventory > Money > Day's strip: the synthetic week that ends on the
    // fixed day, the last day chosen as the product opens it. The plain
    // variant is the same strip with no status marks, the shape a plain day
    // or week picker takes.
    R['range__day-strip'] = function (state, variant) {
        var marks = ['ok', 'ok', 'todo', 'ok', 'warn', 'ok', 'todo'];
        var words = { ok: 'closed', warn: 'reopened', todo: 'not closed' };
        var t = today();
        var days = marks.map(function (m, i) {
            var d = iso(addDays(t, i - 6));
            return variant === 'plain' ? { date: d } : { date: d, mark: m, status: words[m] };
        });
        var s = window.Kit.dayStrip({ days: days, value: iso(t), label: 'Pick a day' });
        var cells = s.querySelectorAll('.kit-day-strip__day');
        if (state === 'hover' || state === 'focus') target(cells[3]);
        else if (state === 'selected') target(cells[6]);
        return s;
    };

    /* ── Buttons ─────────────────────────────────────────────────────── */

    // Each button is its kit class on a plain <button>, with the words the
    // picked source shows. Disabled is the real attribute; open is the real
    // aria-expanded a menu opener carries.
    function kitButton(cls, words, state) {
        var b = NS.el('button', cls, words);
        b.type = 'button';
        if (state === 'disabled') b.disabled = true;
        return b;
    }

    R['buttons__main-action'] = function (state) {
        return kitButton('kit-main-action', 'Save', state);
    };

    R['buttons__danger-warning'] = function (state) {
        return kitButton('kit-danger-warning', 'Delete', state);
    };

    R['buttons__everyday'] = function (state) {
        return kitButton('kit-everyday', 'Try again', state);
    };

    R['buttons__quiet'] = function (state) {
        return kitButton('kit-quiet', 'Reset', state);
    };

    R['buttons__small-row'] = function (state) {
        return kitButton('kit-btn kit-btn--small', 'Rename', state);
    };

    // The Financials close glyph (js/financials/controls.js, icon 'x'), in
    // the kit's line style (Kit.glyph). The button's name is its aria-label.
    R['buttons__icon'] = function (state) {
        var b = kitButton('kit-icon', null, state);
        b.setAttribute('aria-label', 'Close');
        if (state === 'open') {
            b.setAttribute('aria-haspopup', 'menu');
            b.setAttribute('aria-expanded', 'true');
        }
        b.appendChild(window.Kit.glyph('close', { cls: 'kit-icon__glyph' }));
        return b;
    };

    /* ── Text boxes ──────────────────────────────────────────────────── */

    // Default is the box with a value in it, empty shows the placeholder.
    // Hover and focus land on the empty box, as the picker drew them; error
    // and disabled carry a value. Error, valid and disabled are the real
    // aria-invalid / class / disabled; the frame forces hover and focus.
    // Each box gets its own id, so a label in one cell names only its own.
    var boxes = 0;
    function boxId() {
        return 'uil-box-' + ++boxes;
    }
    function filled(state) {
        return state === 'default' || state === 'error' || state === 'disabled' || state === 'selected';
    }
    // The cell width the part's screen gives it: text boxes fill their
    // container, so a bare one in a flex cell would have no width to fill.
    function sized(node, wide) {
        var w = NS.el('div', 'uil-box' + (wide ? ' uil-box--wide' : ''));
        w.appendChild(node);
        return w;
    }

    // Financials' date pop-up field (From), and the 32px view-name box as
    // the small variant. The words are fixed; the date is the library's day.
    R['inputs__text-box'] = function (state, variant) {
        var small = variant === 'small';
        var input = NS.el('input', 'kit-text-box' + (small ? ' kit-text-box--sm' : ''));
        input.type = 'text';
        input.id = boxId();
        input.setAttribute('autocomplete', 'off');
        input.placeholder = small ? 'Name this view' : 'Jun 20, 2026';
        if (filled(state)) input.value = small ? 'Fuel only' : 'Jun 20, 2026';
        if (state === 'error') input.setAttribute('aria-invalid', 'true');
        if (state === 'disabled') input.disabled = true;
        target(input);
        if (small) {
            input.setAttribute('aria-label', 'View name');
            return sized(input);
        }
        var field = NS.el('div', 'kit-text-box__field');
        var label = NS.el('label', 'kit-text-box__label', 'From');
        label.htmlFor = input.id;
        field.appendChild(label);
        field.appendChild(input);
        return sized(field);
    };

    // Transactions' amount filter, "At least" with its operator glyph.
    R['inputs__money-number'] = function (state) {
        var f = window.Kit.moneyNumber({
            label: 'At least...',
            op: 'gte',
            value: filled(state) ? 25000 : null,
            disabled: state === 'disabled'
        });
        if (state === 'error') f.kitSetInvalid(true);
        target(f.querySelector('.kit-money-number'));
        return sized(f);
    };

    // Transactions' toolbar search.
    R['inputs__search'] = function (state) {
        var s = window.Kit.searchField({
            placeholder: 'Search by name',
            label: 'Search transactions by name',
            value: filled(state) ? 'Coca-Cola' : '',
            disabled: state === 'disabled'
        });
        target(s.querySelector('.kit-search-field__input'));
        return sized(s, true);
    };

    // The sign-in page's email field; selected is the valid tick, error the
    // cross and its message. The code variant is the verification code box.
    R['inputs__sign-in'] = function (state, variant) {
        var code = variant === 'code';
        var f = window.Kit.signInField(
            code
                ? { label: 'Verification code', code: true, placeholder: '000000', value: '482913' }
                : {
                      label: 'Email address',
                      type: 'email',
                      placeholder: 'you@company.com',
                      value: filled(state) ? 'owner@example.com' : '',
                      disabled: state === 'disabled'
                  }
        );
        if (state === 'selected') f.kitSetStatus('valid');
        if (state === 'error') f.kitSetStatus('invalid', 'Enter a valid email.');
        target(f.querySelector('.kit-sign-in__input'));
        return sized(f, true);
    };

    // Inventory > Order's received quantity (right-aligned) and, as the
    // start variant, Money > Profit's fuel cost edit (left-aligned).
    R['inputs__table-cell'] = function (state, variant) {
        var start = variant === 'start';
        var n = NS.el('input', 'kit-table-cell' + (start ? ' kit-table-cell--start' : ''));
        n.type = 'text';
        n.setAttribute('inputmode', 'decimal');
        n.setAttribute('aria-label', start ? 'Cost per gallon' : 'Received quantity');
        if (start) n.placeholder = 'Cost / gal';
        if (filled(state)) n.value = start ? '3.129' : '12';
        if (state === 'disabled') n.disabled = true;
        return n;
    };

    // The Search ARGUS pop-up's box, on a pop-up surface: the box itself
    // draws no edge, so on the bare canvas it would read as floating text.
    R['inputs__popup-search'] = function (state) {
        var p = window.Kit.popupSearch({
            placeholder: 'Search ARGUS',
            hint: 'esc',
            value: filled(state) ? 'shrink' : '',
            disabled: state === 'disabled'
        });
        var panel = NS.el('div', 'uil-popup');
        panel.appendChild(target(p));
        return panel;
    };

    /* ── Dropdowns and menus ─────────────────────────────────────────── */

    // A trigger with the list or menu it opens under it. Flex, not the
    // .uil-stack grid: a grid item stretches, and a toolbar trigger is as
    // wide as its words. `fill` stretches both, for a form's full-width box.
    function dropStack(trigger, copy, fill) {
        var w = NS.el('div', 'uil-drop' + (fill ? ' uil-drop--fill' : ''));
        w.appendChild(trigger);
        if (copy) w.appendChild(copy);
        return w;
    }
    function lastOf(sel) {
        return function () {
            var all = document.querySelectorAll(sel);
            return all.length ? all[all.length - 1] : null;
        };
    }
    // Closing a list hands focus back to its trigger. Let it go, so no cell
    // shows a keyboard ring the matrix did not ask for.
    function letGo() {
        var a = document.activeElement;
        if (a && a !== document.body && typeof a.blur === 'function') a.blur();
    }
    // Open the real part, rest the pointer on one row with a real mousemove
    // (the factory marks the row itself), keep a copy of what it drew, and
    // close it again: the same trade the range renderers make above.
    function openAndCopy(open, find, point, close) {
        open();
        var live = find();
        if (!live) throw new Error('nothing opened');
        if (point) {
            var row = live.querySelectorAll(point.sel)[point.at];
            if (row) row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        }
        var copy = inlineCopy(live);
        close();
        letGo();
        return copy;
    }

    // Kit.select as Settings and Employees use it. Default is nothing
    // chosen, as the picker drew it first; selected carries a value; error is
    // the field refusing an empty pick. Open rests the pointer on the third
    // row, the chosen row stays bold.
    var SHIFTS = [
        { value: 'am', label: 'Morning shift' },
        { value: 'pm', label: 'Afternoon shift' },
        { value: 'night', label: 'Night shift' },
        { value: 'wknd', label: 'Weekend cover' },
        { value: 'call', label: 'On call' }
    ];
    R['selects__form-dropdown'] = function (state) {
        var none = state === 'default' || state === 'error';
        var s = window.Kit.select({ options: SHIFTS, value: none ? null : 'am', placeholder: 'Pick a shift' });
        var btn = target(s.querySelector('.kit-select__btn'));
        if (state === 'error') {
            return sized(window.Kit.field({ label: 'Shift', control: s, error: 'Choose a shift first.' }));
        }
        if (state !== 'open') return sized(s);
        var copy = openAndCopy(
            function () {
                btn.click();
            },
            lastOf('.kit.kit-pop.kit-pop--list'),
            { sel: '.kit-pop__opt', at: 2 },
            function () {
                btn.click();
            }
        );
        btn.setAttribute('aria-expanded', 'true');
        return sized(dropStack(s, copy, true));
    };

    // Financials Insights' Interval select. Empty is the category select
    // with nothing chosen; open rests the pointer on the second row, selected
    // on the chosen one. The variants are the 40px date preset, the Compare
    // to select with its glyph, and Transactions' quiet "by" switch at rest,
    // hovered (the frame forces it) and open.
    var INTERVALS = [
        { value: 'month', label: 'Month' },
        { value: 'quarter', label: 'Quarter' },
        { value: 'year', label: 'Year' }
    ];
    var CATS = [
        { value: 'fuel', label: 'Fuel purchases' },
        { value: 'groc', label: 'Grocery purchases' },
        { value: 'util', label: 'Utilities' },
        { value: 'pay', label: 'Payroll' }
    ];
    R['selects__toolbar-dropdown'] = function (state, variant) {
        var K = window.Kit;
        var d;
        if (variant === 'large') {
            d = K.toolbarDropdown({
                size: 'lg',
                value: 'last30',
                ariaLabel: 'Dates',
                options: [
                    { value: 'last30', label: 'Last 30 days' },
                    { value: 'mtd', label: 'Month to date' }
                ]
            });
        } else if (variant === 'icon') {
            d = K.toolbarDropdown({
                icon: 'calendars',
                label: 'Compare to',
                ariaLabel: 'Compare to',
                value: 'none',
                options: [
                    { value: 'none', label: 'No comparison' },
                    { value: 'previous', label: 'Previous period' },
                    { value: 'year', label: 'Same period last year' }
                ]
            });
        } else if (variant === 'quiet' || variant === 'quiet-hover' || variant === 'quiet-open') {
            d = K.toolbarDropdown({
                quiet: true,
                value: 'counterparty',
                ariaLabel: 'Chart by',
                options: [
                    { value: 'counterparty', label: 'To/From' },
                    { value: 'category', label: 'Category' },
                    { value: 'store', label: 'Store' }
                ]
            });
        } else if (state === 'empty') {
            d = K.toolbarDropdown({ placeholder: 'Choose a category', options: CATS, ariaLabel: 'Category' });
        } else {
            d = K.toolbarDropdown({
                value: 'month',
                options: INTERVALS,
                ariaLabel: 'Interval',
                disabled: state === 'disabled'
            });
        }
        target(d);
        var opens = variant ? variant === 'quiet-open' : state === 'open' || state === 'selected';
        if (!opens) return d;
        var copy = openAndCopy(
            function () {
                d.click();
            },
            lastOf('.kit.kit-toolbar-dropdown__pop'),
            // The quiet list opens on its chosen row, as the picker drew it.
            { sel: '.kit-toolbar-dropdown__opt', at: state === 'open' && !variant ? 1 : 0 },
            function () {
                d.click();
            }
        );
        d.setAttribute('aria-expanded', 'true');
        return dropStack(d, copy);
    };

    // Financials Insights' View settings menu. Selected is the Saved views
    // menu from its own button (the chosen view's name and a caret): a
    // chosen row, row actions on the row under the pointer, a row that is
    // off, a divider and "Create view". Disabled is the button off. The bare
    // variants are the borderless icon button, at rest and hovered.
    var SETTINGS_ITEMS = [
        { key: 'chart', label: 'Chart settings', icon: 'chartColumn' },
        { key: 'cols', label: 'Columns', icon: 'grid' },
        { key: 'cats', label: 'Manage categories', icon: 'tag' }
    ];
    var ROW_ACTIONS = [
        { key: 'rename', label: 'Rename', icon: 'pen', tone: 'accent' },
        { key: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' }
    ];
    var SAVED_ITEMS = [
        { key: 'v1', label: 'Monthly cashflow', selected: true, actions: ROW_ACTIONS },
        { key: 'v2', label: 'Quarterly spend', actions: ROW_ACTIONS },
        { key: 'v3', label: 'Share view', disabled: true },
        { divider: true },
        { key: 'new', label: 'Create view', icon: 'plus' }
    ];
    R['selects__button-menu'] = function (state, variant) {
        var saved = state === 'selected';
        var m = window.Kit.buttonMenu({
            label: saved ? 'Saved views' : 'View settings',
            icon: saved ? 'bookmark' : 'sliders',
            text: saved ? 'Monthly cashflow' : null,
            items: saved ? SAVED_ITEMS : SETTINGS_ITEMS,
            bare: variant === 'bare' || variant === 'bare-hover',
            disabled: state === 'disabled'
        });
        target(m);
        if (variant || (state !== 'open' && state !== 'selected')) return m;
        var copy = openAndCopy(
            function () {
                m.kitOpen();
            },
            lastOf('.kit.kit-button-menu__pop'),
            { sel: '.kit-button-menu__row', at: 1 },
            function () {
                m.kitClose();
            }
        );
        m.setAttribute('aria-expanded', 'true');
        return dropStack(m, copy);
    };

    // Transactions' Filters button; selected is "Filters · 2" with filters
    // in use. Open is View with its pop-out: the column switches, the part of
    // the View pane the kit has a switch for (the Sort by and Group by radios
    // are the pick-one standard's, not this one's).
    function viewPane() {
        var pane = NS.el('div');
        pane.appendChild(NS.el('div', 'kit-filter-button__caption', 'Columns'));
        [
            ['Store', true],
            ['Method', false],
            ['Category', true]
        ].forEach(function (c) {
            var row = NS.el('div', 'kit-filter-button__row');
            row.appendChild(NS.el('span', null, c[0]));
            var t = window.Kit.toggle({ checked: c[1] });
            t.setAttribute('aria-label', 'Show ' + c[0]);
            row.appendChild(t);
            pane.appendChild(row);
        });
        return pane;
    }
    R['selects__filter-button'] = function (state) {
        var K = window.Kit;
        if (state === 'open') {
            var v = target(
                K.filterButton({ label: 'View', icon: 'sliders', popLabel: 'How the list looks', content: viewPane })
            );
            var copy = openAndCopy(
                function () {
                    v.kitOpen();
                },
                lastOf('.kit.kit-filter-button__pop'),
                null,
                function () {
                    v.kitClose();
                }
            );
            v.setAttribute('aria-expanded', 'true');
            return dropStack(v, copy);
        }
        var on = state === 'selected';
        return K.filterButton({
            label: on ? 'Filters · 2' : 'Filters',
            icon: 'filter',
            on: on,
            content: function () {
                return NS.el('div');
            }
        });
    };

    // Financials Transactions' Category cell, in a one-row ArgusTable.
    // Default is "Needs category"; selected holds a value and its clear x;
    // open lists ten categories, so the search box shows. Busy and error are
    // the real save paths: a pick whose save never settles, and one whose
    // save throws. Off is ArgusTable's own rule: a cell nobody can change is
    // plain words, not a greyed box.
    var CAT_OPTS = [
        'Fuel purchases',
        'Grocery purchases',
        'Utilities',
        'Payroll',
        'Rent',
        'Insurance',
        'Repairs',
        'Card fees',
        'Lottery',
        'Tobacco'
    ].map(function (l, i) {
        return { value: 'c' + i, label: l };
    });
    function catTable(value, o) {
        var host = NS.el('div', 'uil-table');
        window.ArgusTable.mount(host, {
            columns: [
                { key: 'name', label: 'To/From', type: 'text', width: 120 },
                {
                    key: 'cat',
                    label: 'Category',
                    type: 'select',
                    width: 'minmax(0, 1fr)',
                    options: function () {
                        return CAT_OPTS;
                    },
                    placeholder: 'Needs category',
                    disabled: function () {
                        return !!o.off;
                    },
                    onChange:
                        o.onChange ||
                        function () {
                            return undefined;
                        }
                }
            ],
            rows: [{ id: 1, name: 'Fuel supplier', cat: value }],
            now: today(),
            label: 'Transactions'
        });
        return host;
    }
    R['selects__search-pick'] = function (state) {
        var host;
        var copy = null;
        if (state === 'busy' || state === 'error') {
            host = catTable(null, {
                onChange:
                    state === 'busy'
                        ? function () {
                              return new Promise(function () {});
                          }
                        : function () {
                              throw new Error('Not saved');
                          }
            });
            host.querySelector('.atbl-combo__trigger').click();
            var opt = lastOf('.atbl-pop.atbl-lb')();
            if (!opt) throw new Error('ArgusTable opened no list');
            opt.querySelector('.atbl-opt').click();
            letGo();
        } else {
            var set = state === 'selected' || state === 'open' || state === 'disabled';
            host = catTable(set ? 'c0' : null, { off: state === 'disabled' });
        }
        var trigger = host.querySelector('.atbl-combo__trigger');
        if (state === 'open') {
            copy = openAndCopy(
                function () {
                    trigger.click();
                },
                lastOf('.atbl-pop.atbl-lb'),
                null,
                function () {
                    trigger.click();
                }
            );
            copy.classList.add('uil-table-pop');
            trigger.setAttribute('aria-expanded', 'true');
            host.querySelector('.atbl-row').classList.add('is-open');
        }
        target(host.querySelector('.atbl-combo') || host.querySelector('.atbl-text') || host);
        return copy ? dropStack(host, copy) : host;
    };

    /* ── Tabs and switches ───────────────────────────────────────────── */

    // Each part as its picked screen draws it. Default has the first
    // choice selected; hover and focus land on the second; selected has the
    // second chosen and targets it, as the picker drew them.
    function second(root, sel, state) {
        if (state !== 'default') target(root.querySelectorAll(sel)[1]);
        return root;
    }

    // The underline rows put focus on the FIRST tab instead: it sits flush
    // against the row's left edge, where the row's own scroll clip is the
    // thing most likely to eat the ring, so that is the tab to show.
    function firstFocused(root, sel, state) {
        if (state === 'focus') {
            target(root.querySelector(sel));
            return root;
        }
        return second(root, sel, state);
    }

    // Financials Money out's "group by", full width in the 300px its box
    // gives it. The icons variant is the chart type switch beside a chart.
    var GROUP_BY = [
        { value: 'vendor', label: 'Vendor' },
        { value: 'category', label: 'Category' },
        { value: 'type', label: 'Type' }
    ];
    var CHART_MODES = [
        { value: 'overview', label: 'Show overview chart', icon: 'chartMixed' },
        { value: 'line', label: 'Show line chart', icon: 'chartLine' },
        { value: 'stacked', label: 'Show stacked bar chart', icon: 'chartColumn' },
        { value: 'sankey', label: 'Show sankey chart', icon: 'sankey' }
    ];
    R['tabs__in-page-switch'] = function (state, variant) {
        var picked = state === 'selected';
        if (variant === 'icons') {
            return window.Kit.inlineSwitch({
                label: 'Chart mode',
                icons: true,
                options: CHART_MODES,
                value: 'overview'
            }).el;
        }
        var s = window.Kit.inlineSwitch({
            label: 'Group Money out by',
            full: true,
            options: GROUP_BY,
            value: picked ? 'category' : 'vendor'
        });
        return sized(second(s.el, '.kit-inline-switch__opt', state), true);
    };

    // Financials' own tab row, its first three sections.
    R['tabs__main-tabs'] = function (state) {
        var t = window.Kit.mainTabs({
            label: 'Financials',
            active: state === 'selected' ? 'spending' : 'overview',
            tabs: [
                { id: 'overview', label: 'Overview' },
                { id: 'spending', label: 'Spending' },
                { id: 'money-in', label: 'Money in' }
            ]
        });
        return firstFocused(t.el, '.kit-main-tabs__tab', state);
    };

    // The Financials Filters menu's rail, in the 236px its menu gives it.
    // The applied variant is a filter in use on Category.
    R['tabs__side-tabs'] = function (state, variant) {
        var t = window.Kit.sideTabs({
            label: 'Filters',
            active: state === 'selected' ? 'amount' : 'date',
            applied: variant === 'applied' ? ['category'] : [],
            tabs: [
                { id: 'date', label: 'Date', icon: 'calendar' },
                { id: 'amount', label: 'Amount', icon: 'gte' },
                { id: 'category', label: 'Category', icon: 'tag' },
                { id: 'store', label: 'Store', icon: 'store' }
            ]
        });
        return sized(second(t.el, '.kit-side-tabs__tab', state));
    };

    // Inventory > Stock's views.
    R['tabs__sub-tabs'] = function (state) {
        var t = window.Kit.subTabs({
            label: 'Stock views',
            active: state === 'selected' ? 'items' : 'worklist',
            tabs: [
                { id: 'worklist', label: 'Worklist' },
                { id: 'items', label: 'All items' },
                { id: 'classify', label: 'Classify' }
            ]
        });
        return firstFocused(t.el, '.kit-sub-tabs__tab', state);
    };

    /* ── Switches, tick boxes and choices ────────────────────────────── */

    // The Financials store picker. Default has the first choice made; hover
    // and focus land on the second, unchosen; selected has the second chosen
    // and targets it; disabled targets a third that cannot be chosen. The
    // help variant is a choice with a line under each option.
    R['toggles__pick-one'] = function (state, variant) {
        if (variant === 'help') {
            return sized(
                window.Kit.pickOne({
                    label: 'Sort by',
                    value: 'newest',
                    options: [
                        { value: 'newest', label: 'Newest first', help: 'The latest money in or out on top.' },
                        { value: 'largest', label: 'Largest first', help: 'The biggest amounts on top.' }
                    ]
                })
            );
        }
        var g = window.Kit.pickOne({
            label: 'Store',
            value: state === 'selected' ? 'main' : 'all',
            options: [
                { value: 'all', label: 'All stores' },
                { value: 'main', label: 'Main Street' },
                { value: 'airport', label: 'Airport Road', disabled: state === 'disabled' }
            ]
        });
        var opts = g.querySelectorAll('.kit-pick-one__opt');
        if (state === 'disabled') target(opts[2]);
        else if (state !== 'default') target(opts[1]);
        return sized(g);
    };

    // The Financials Settings window's sales tax switch. It paints no words;
    // its name is its aria-label.
    R['toggles__switch'] = function (state) {
        return window.Kit.switch({
            label: 'Include sales tax',
            checked: state === 'selected',
            disabled: state === 'disabled'
        });
    };

    // Settings > Quiet time's "Always let through" tick box.
    R['toggles__tick-box'] = function (state) {
        return window.Kit.tickBox({
            label: 'Confirmed theft',
            help: 'Always sent, even in quiet time',
            checked: state === 'selected',
            disabled: state === 'disabled'
        });
    };

    // The saved words fade after two seconds. The library shows them held:
    // the page's timer is a no-op for exactly the length of this one call,
    // so the fade the factory schedules in it never runs.
    function held(draw) {
        var real = window.setTimeout;
        window.setTimeout = function () {
            return 0;
        };
        try {
            draw();
        } finally {
            window.setTimeout = real;
        }
    }

    // An Inventory alert setting, holding the picked switch. The hairline is
    // BETWEEN rows, so each cell draws the row in its state with a plain row
    // under it; the state row is the one measured. Busy is mid-save, error a
    // failed save with Retry, disabled a switch that cannot be flipped.
    R['toggles__setting-row'] = function (state, variant) {
        var on = state === 'busy' || state === 'error' || variant === 'saved';
        var row = window.Kit.settingRow({
            label: 'Low-stock alerts',
            help: 'Tell me when an item drops below its reorder point.',
            control: window.Kit.switch({ checked: on, disabled: state === 'disabled' })
        });
        if (state === 'busy') row.saving();
        else if (state === 'error') row.error(null, function () {});
        else if (variant === 'saved') {
            held(function () {
                row.saved();
            });
        }
        var next = window.Kit.settingRow({
            label: 'Out-of-stock alerts',
            help: 'When an item runs out.',
            control: window.Kit.switch({ checked: true })
        });
        var box = NS.el('div', 'uil-rows');
        box.appendChild(target(row.el));
        box.appendChild(next.el);
        return box;
    };

    /* ── Chips and tags ──────────────────────────────────────────────── */

    // Financials Insights' toolbar chips, with the words the picker drew.
    // Selected is a chip whose filter is set (the tint); open is the dates
    // chip with the pop-out it opens under it; disabled is the store chip
    // off. The variants: the Filters chip with its icon, a set chip under
    // the pointer, a set chip with its x, and that x under the pointer (the
    // chip under the same pointer, so both are marked) and focused.
    var WINDOWS = [
        { value: 'last7', label: 'Last 7 days' },
        { value: 'last30', label: 'Last 30 days' },
        { value: 'last90', label: 'Last 90 days' }
    ];
    R['chips__filter-chip'] = function (state, variant) {
        var K = window.Kit;
        var hold = NS.el('div');
        if (variant === 'icon') {
            hold.appendChild(
                target(K.filterChip({ label: 'Filters', icon: 'filter', chevron: false, onClick: function () {} }))
            );
            return hold;
        }
        var clears = variant === 'clear' || variant === 'clear-hover' || variant === 'clear-focus';
        var set = state === 'selected' || variant === 'set-hover' || clears;
        var words = clears ? 'Main St' : set ? 'Money out' : state === 'open' ? 'Last 30 days' : 'All stores';
        var chip = K.filterChip({
            label: words,
            active: set,
            disabled: state === 'disabled',
            popLabel: words,
            content: function () {
                return K.pickOne({ label: 'Dates', value: 'last30', options: WINDOWS });
            },
            onClear: clears ? function () {} : null
        });
        var x = chip.querySelector('.kit-filter-chip__clear');
        if (variant === 'clear-focus') target(x);
        else if (state === 'focus') target(chip.kitButton);
        else {
            target(chip);
            if (variant === 'clear-hover') target(x);
        }
        if (state !== 'open') {
            hold.appendChild(chip);
            return hold;
        }
        var copy = openAndCopy(
            function () {
                chip.kitOpen();
            },
            lastOf('.kit.kit-filter-chip__pop'),
            null,
            function () {
                chip.kitClose();
            }
        );
        // The copy was taken while it was open; the live chip has closed
        // since, so it takes back the look it had.
        chip.classList.add('is-open');
        chip.kitButton.setAttribute('aria-expanded', 'true');
        return dropStack(chip, copy);
    };

    // A count beside a tab's words, as Employees' tabs carry one (People
    // 12). Selected is the count on the selected tab; the variants are its
    // three tones.
    var BADGE_WORDS = { warn: ['Review', 3], ok: ['Setup', 0], bad: ['Alerts', 2] };
    R['chips__number-badge'] = function (state, variant) {
        var w = BADGE_WORDS[variant] || ['People', 12];
        var on = state === 'selected';
        var row = NS.el('span', 'uil-with' + (on ? ' is-on' : ''));
        row.appendChild(NS.el('span', null, w[0]));
        row.appendChild(target(window.Kit.numberBadge(w[1], { tone: variant || null, selected: on })));
        return row;
    };

    // A camera's label on a black box standing in for its video, the way the
    // wall draws it. Default is the camera's name; each variant is a state,
    // and demo is a camera on sample footage, which says so in its own words.
    R['chips__overlay-label'] = function (state, variant) {
        var pic = NS.el('div', 'uil-video');
        var words = variant === 'auth_expired' ? 'Session expired. Sign in again.' : 'Front door';
        if (variant === 'demo') words = null;
        pic.appendChild(target(window.Kit.overlayLabel({ text: words, state: variant || null })));
        return pic;
    };

    // Settings > Notifications: one alert's ways to reach you. Default has
    // none on; hover and focus land on Email; selected has Email on; off has
    // Email off. The variants: Quiet time's days with the weekdays on, the
    // row with the locked In the app chip, and a pick of just one.
    var DAYS = [
        ['mon', 'M', 'Monday'],
        ['tue', 'T', 'Tuesday'],
        ['wed', 'W', 'Wednesday'],
        ['thu', 'T', 'Thursday'],
        ['fri', 'F', 'Friday'],
        ['sat', 'S', 'Saturday'],
        ['sun', 'S', 'Sunday']
    ].map(function (d) {
        return { value: d[0], label: d[1], ariaLabel: d[2] };
    });
    R['chips__pick-chip'] = function (state, variant) {
        var K = window.Kit;
        var g;
        if (variant === 'day') {
            g = K.pickChips({
                label: 'Days of the week',
                size: 'day',
                value: ['mon', 'tue', 'wed', 'thu', 'fri'],
                options: DAYS
            });
        } else if (variant === 'one') {
            g = K.pickChips({
                label: 'Billing',
                one: true,
                value: 'monthly',
                options: [
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'annual', label: 'Annual' }
                ]
            });
        } else {
            g = K.pickChips({
                label: 'Low stock: how it reaches you',
                value: state === 'selected' || variant === 'locked' ? ['email'] : [],
                options: [
                    { value: 'email', label: 'Email', disabled: state === 'disabled' },
                    { value: 'sms', label: 'Text' }
                ].concat(
                    variant === 'locked'
                        ? [{ value: 'in_app', label: 'In the app', ariaLabel: 'In the app, always on', locked: true }]
                        : []
                )
            });
        }
        target(variant === 'locked' ? g.querySelector('.kit-pick-chip--locked') : g.querySelector('.kit-pick-chip'));
        return g;
    };

    // Financials Transactions' category tag. The variants are the outline's
    // tones, from Loss prevention's shrink badge, and the narrow table's size
    // in the width a narrow party cell gives it.
    var TAG_WORDS = { muted: 'Pending', ok: 'Not rung', warn: 'Rung', bad: 'Failed' };
    R['chips__plain-tag'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'small') {
            var box = NS.el('div', 'uil-narrow');
            box.appendChild(target(K.plainTag('Groceries and household', { small: true })));
            return box;
        }
        return K.plainTag(TAG_WORDS[variant] || 'Groceries', { tone: variant || null });
    };

    // Settings > Profile's and Inventory > Order's status tags. Default is
    // the neutral tone, what Kit.pill gives with none named.
    var PILL_WORDS = { ok: 'Paid', warn: 'Due soon', bad: 'Overdue' };
    R['chips__status-tag'] = function (state, variant) {
        return window.Kit.pill(PILL_WORDS[variant] || 'Not set', variant || 'mut');
    };

    /* ── Tables ──────────────────────────────────────────────────────── */

    // The list table, its loading rows, its pager and its sort header are
    // ArgusTable's own parts (js/kit/table.js, css/kit-table.css), mounted
    // for real on a synthetic ledger: five made-up rows in the week that ends
    // on the library's fixed day, with fixed amounts in cents. Nothing here
    // is read from any store or any account.
    var LEDGER_CATS = [
        { value: 'groc', label: 'Grocery purchases' },
        { value: 'fuel', label: 'Fuel purchases' },
        { value: 'util', label: 'Utilities' },
        { value: 'rent', label: 'Rent' },
        { value: 'sales', label: 'Sales' }
    ];
    function ledgerRows() {
        var t = today();
        var day = function (n) {
            return iso(addDays(t, -n));
        };
        return [
            {
                id: 1,
                date: day(0),
                party: 'Northside Distributors',
                amount: -64218,
                store: 'Store A',
                method: 'Invoice',
                icon: 'invoice',
                cat: 'groc'
            },
            {
                id: 2,
                date: day(1),
                party: 'Register sales',
                amount: 421055,
                store: 'Store A',
                method: 'Register',
                icon: 'register',
                cat: 'sales',
                locked: true
            },
            {
                id: 3,
                date: day(2),
                party: { name: 'Metro Fuel Supply', badge: { text: 'Needs category', tone: 'neutral' } },
                amount: null,
                store: null,
                method: 'Invoice',
                icon: 'invoice',
                cat: null
            },
            {
                id: 4,
                date: day(3),
                party: 'City Water and Power',
                amount: -31840,
                store: 'Store A',
                method: 'Bill',
                icon: 'bill',
                cat: 'util'
            },
            {
                id: 5,
                date: day(4),
                party: { name: 'Sunrise Bakery', badge: { text: 'Voided', tone: 'muted' } },
                amount: -8600,
                struck: true,
                store: 'Store B',
                method: 'Manual',
                icon: 'manual',
                cat: 'groc'
            }
        ];
    }
    // Transactions' columns, at the widths and options Financials gives them
    // (js/financials/view-transactions.js:2321-2382). `narrow` is the four
    // the sort, pager and loading cells show; `locked` makes every category
    // a cell nobody can change, which ArgusTable draws as plain words.
    function ledgerColumns(o) {
        var c = o || {};
        var cols = [
            { key: 'date', label: 'Date', type: 'date', width: 96, sortable: true },
            { key: 'party', label: 'To/From', type: 'party', sortable: true },
            {
                key: 'amount',
                label: 'Amount',
                type: 'money',
                width: 136,
                sortable: true,
                nullReason: 'Amount not known yet'
            }
        ];
        if (!c.narrow) {
            cols.push({
                key: 'store',
                label: 'Store',
                type: 'text',
                width: 'minmax(0, 0.8fr)',
                nullReason: 'No store'
            });
            cols.push({
                key: 'method',
                label: 'Method',
                type: 'text',
                width: 'minmax(0, 0.9fr)',
                icon: function (r) {
                    return r.icon;
                }
            });
        }
        cols.push({
            key: 'cat',
            label: 'Category',
            type: 'select',
            width: 200,
            placeholder: '',
            clearable: false,
            options: function () {
                return LEDGER_CATS;
            },
            disabled: function (r) {
                return !!(r.locked || c.locked);
            },
            onChange: function () {
                return undefined;
            }
        });
        return cols;
    }
    function noop() {}
    // One ArgusTable, mounted on its own host. `opts` goes to the table as
    // it is; the rest picks the columns, how many rows and the host's width.
    function ledger(o) {
        var c = o || {};
        var host = NS.el('div', 'uil-table ' + (c.narrow ? 'uil-table--mid' : 'uil-table--list'));
        var opts = {
            columns: ledgerColumns(c),
            rows: ledgerRows().slice(0, c.rows || 5),
            selectable: true,
            sort: { key: 'date', dir: 'desc' },
            onRowClick: noop,
            emptyText: 'No transactions in this period.',
            emptyAction: { label: 'Clear filters', onClick: noop },
            failedText: 'Could not load transactions.',
            onRetry: noop,
            now: today(),
            label: 'Transactions'
        };
        if (c.footer) {
            opts.footer = {
                total: 1170,
                page: c.footer,
                pageSize: 100,
                onPage: noop,
                noun: ['Transaction', 'Transactions']
            };
        }
        Object.keys(c.opts || {}).forEach(function (k) {
            opts[k] = c.opts[k];
        });
        window.ArgusTable.mount(host, opts);
        return host;
    }
    function bodyRows(host) {
        return host.querySelectorAll('.atbl-body .atbl-row');
    }
    // A table with the copy of a pop-up it opened, placed over it where
    // ArgusTable puts the live one (css/ui-library.css, .uil-pop-host).
    function withPop(host, copy, at) {
        var box = NS.el('div', 'uil-pop-host');
        copy.classList.add(at);
        box.appendChild(host);
        box.appendChild(copy);
        return box;
    }

    // Financials Transactions, as the picker drew it: page one of 1,170,
    // newest first, rows that open and can be ticked. Hover and focus land
    // on the second row, selected ticks the first two, open is the first
    // row's Category list. Off is ArgusTable's own rule: a cell nobody can
    // change is plain words, not a greyed box; the first page's Previous
    // arrow is off too.
    R['tables__list-table'] = function (state) {
        var o = { footer: 1, opts: {} };
        if (state === 'selected') o.opts.selected = [1, 2];
        if (state === 'disabled') o.locked = true;
        if (state === 'busy') o.opts.state = 'loading';
        if (state === 'error') o.opts.state = 'failed';
        if (state === 'empty') o.opts.rows = [];
        var host = ledger(o);
        var rows = bodyRows(host);
        if (state === 'hover' || state === 'focus') target(rows[1]);
        else if (state === 'selected' || state === 'open') target(rows[0]);
        else target(host.querySelector('.atbl'));
        if (state !== 'open') return host;
        var trigger = rows[0].querySelector('.atbl-combo__trigger');
        var copy = openAndCopy(
            function () {
                trigger.click();
            },
            lastOf('.atbl-pop.atbl-lb'),
            null,
            function () {
                trigger.click();
            }
        );
        trigger.setAttribute('aria-expanded', 'true');
        rows[0].classList.add('is-open');
        return withPop(host, copy, 'uil-at-cat');
    };

    // ArgusTable's loading rows, set against the same table with its rows,
    // so the bars can be read against the columns they stand in for. Empty
    // keeps the bars still under its sentence and quiet action; a failed
    // read is the sentence and Try again, and no rows at all.
    R['tables__loading'] = function (state) {
        var o = { narrow: true, opts: {} };
        if (state === 'busy') o.opts = { state: 'loading', ghostRows: 5 };
        if (state === 'error') o.opts = { state: 'failed' };
        if (state === 'empty') o.opts = { rows: [] };
        var host = ledger(o);
        target(host.querySelector('.atbl'));
        return host;
    };

    // The footer's count and page arrows. Default is page two of twelve,
    // both arrows on; hover and focus land on Next; off is page one, whose
    // Previous arrow cannot go back.
    R['tables__pager'] = function (state) {
        var host = ledger({ narrow: true, rows: 2, footer: state === 'disabled' ? 1 : 2 });
        var navs = host.querySelectorAll('.atbl-foot__nav');
        target(state === 'disabled' ? navs[0] : navs[1]);
        return host;
    };

    // The header's sort control, on To/From. Default is the table newest
    // first (Date's down arrow); hover, focus and open land on To/From; open
    // is its menu (A to Z, Z to A, Clear sort), selected the table sorted by
    // it, A to Z. The focus ring is drawn on the label's pill inside the
    // button that takes focus, so the pill is what the check measures.
    R['tables__sort-header'] = function (state) {
        var host = ledger({
            narrow: true,
            rows: 3,
            opts: state === 'selected' ? { sort: { key: 'party', dir: 'asc' } } : {}
        });
        var btn = host.querySelector('.atbl-th[data-col="party"] .atbl-sort');
        target(btn);
        // Marked in every cell, so the check can hold the focus cell's ring
        // against the same pill at rest.
        btn.querySelector('.atbl-sort__pill').setAttribute('data-uil-ring', '');
        if (state !== 'open') return host;
        var copy = openAndCopy(
            function () {
                btn.click();
            },
            lastOf('.atbl-pop.atbl-menu'),
            null,
            function () {
                btn.click();
            }
        );
        btn.setAttribute('aria-expanded', 'true');
        return withPop(host, copy, 'uil-at-sort');
    };

    // Kit.table as the Inventory report tables use it: rows that open, a
    // right-aligned figure, a mono code and a value nobody knows. Hover and
    // focus land on the second row; empty keeps the header and says so.
    var REPORT = [
        { name: 'Whole milk, gallon', sku: 'DAI-0114', qty: 18, counted: 'Jun 19' },
        { name: 'Spring water, 24 pack', sku: 'BEV-2208', qty: 42, counted: 'Jun 18' },
        { name: 'Paper towels, 6 roll', sku: 'HOU-0931', qty: 7, counted: null }
    ];
    R['tables__simple-table'] = function (state) {
        var t = window.Kit.table({
            columns: [
                { key: 'name', label: 'Item' },
                { key: 'sku', label: 'Code', mono: true },
                { key: 'qty', label: 'On hand', align: 'right' },
                { key: 'counted', label: 'Last counted' }
            ],
            rows: state === 'empty' ? [] : REPORT,
            onRow: noop,
            emptyText: 'Nothing to show'
        });
        var rows = t.querySelectorAll('tbody .kit-row');
        target(state === 'hover' || state === 'focus' ? rows[1] : t);
        var box = NS.el('div', 'uil-table uil-table--report');
        box.appendChild(t);
        return box;
    };

    // Financials Insights' Top money out, in the card it sits in. Hover
    // lands on the second row, focus on its name (the button that opens it);
    // Remaining opens nothing. Busy is the rows as pulsing bars, empty the
    // still bars under its sentence, a failed read its sentence and Try
    // again on a plate.
    var LINES = [
        { name: 'Northside Distributors', pct: 38.2, cents: -542900 },
        { name: 'Metro Fuel Supply', pct: 29, cents: -412000 },
        { name: 'City Water and Power', pct: 9.4, cents: -133500 },
        { name: 'Remaining', pct: 23.4, cents: -332840, rest: true }
    ];
    R['tables__line-table'] = function (state) {
        var o = {
            label: 'Top money out',
            head: ['Vendor', '% of total', 'Amount'],
            tone: 'out',
            rows: LINES.map(function (l) {
                return { name: l.name, pct: l.pct, cents: l.cents, onOpen: l.rest ? null : noop };
            }),
            emptyText: 'No money went out in this period.',
            failedText: 'Could not load Money out by vendor.',
            onRetry: noop,
            hint: 'Each named row opens Transactions filtered to it.'
        };
        if (state === 'busy') o.state = 'loading';
        else if (state === 'empty') o.rows = [];
        else if (state === 'error') o.state = 'failed';
        var t = window.Kit.lineTable(o);
        var rows = t.querySelectorAll('tbody .kit-line-table__row');
        if (state === 'hover') target(rows[1]);
        else if (state === 'focus') target(rows[1].querySelector('.kit-line-table__link'));
        else target(t);
        var card = NS.el('div', 'uil-card');
        card.appendChild(t);
        return card;
    };

    /* ── Tiles: figure cards and key figures ─────────────────────────── */

    // Kit.balance, the Financials figure card, unchanged. Thirty made-up
    // days of money in that end on the library's fixed day; nothing is read
    // from any store or account. The card plays its first-look motion (it
    // rises in, the line draws, the figure counts up) on a page; here it is
    // drawn at rest, so Kit.motion is set aside for the length of the call.
    function atRest(draw) {
        var K = window.Kit;
        var M = K.motion;
        K.motion = null;
        try {
            return draw();
        } finally {
            K.motion = M;
        }
    }
    function moneyIn() {
        var t = today();
        var out = [];
        var y = 0;
        for (var i = 0; i < 30; i++) {
            // Money in so far this month: every day adds its takings, a
            // slow day less than a busy one, as Financials Overview draws it.
            y += i % 7 === 4 ? 1840.5 : 3620 + ((i * 37) % 13) * 131.17;
            out.push({ x: iso(addDays(t, i - 29)), y: Math.round(y * 100) / 100 });
        }
        return out;
    }
    var BAL_BADGE = { icon: 'register', title: 'What your registers took in, before sales tax, refunds taken off' };
    function balanceCard(o) {
        return atRest(function () {
            return window.Kit.balance(o);
        });
    }
    function chartCard() {
        return balanceCard({ label: 'Money in', badge: BAL_BADGE, series: moneyIn(), format: 'money', good: 'up' });
    }
    // A card with no chart stands in a row beside a chart card on its page,
    // and the row gives it the chart card's height, which puts its action on
    // the floor. The chart card behind it here only gives that height: it is
    // hidden and inert, and not part of what the cell shows.
    function inRow(card) {
        var row = NS.el('div', 'uil-bal uil-bal-row');
        var twin = chartCard();
        twin.classList.add('uil-bal-row__twin');
        twin.setAttribute('aria-hidden', 'true');
        twin.setAttribute('inert', '');
        row.appendChild(twin);
        row.appendChild(target(card));
        return row;
    }
    // Hover is the chart scrub: the rule, the ring dot and that day in the
    // header. The card draws it from its own keyboard path, the one a
    // pointer drives too (balance.js, the plot's keydown), stepped back
    // eleven days from the latest; nothing in the card is changed to do it.
    // The badge variant is the source badge's tip, the other half of the
    // card's hover. Focus is the chart; selected is the table view, its
    // Table switch pressed.
    function scrub(card, days) {
        var plot = card.querySelector('.kit-bal__plot');
        for (var i = 0; i < days; i++) {
            plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        }
        return plot;
    }
    R['tiles__figure-chart-card'] = onFixedDay(function (state, variant) {
        if (variant === 'bare') {
            return inRow(
                balanceCard({
                    label: 'Sort bills',
                    badge: { icon: 'clock', title: 'Scanned bills that still need a category' },
                    value: 6,
                    format: 'number',
                    emptyText: 'Scanned bills waiting for a category.',
                    action: { label: 'Sort them', onClick: noop }
                })
            );
        }
        if (state === 'empty' || state === 'error') {
            return inRow(
                balanceCard({
                    label: 'Money in',
                    badge: BAL_BADGE,
                    state: state === 'empty' ? 'notSetUp' : 'notLoaded',
                    emptyText:
                        state === 'empty'
                            ? 'Money in appears once a register is sending sales.'
                            : 'Did not load. This is a failed read, not a zero.'
                })
            );
        }
        var card =
            state === 'selected'
                ? balanceCard({
                      label: 'Money in',
                      badge: BAL_BADGE,
                      series: moneyIn(),
                      format: 'money',
                      good: 'up',
                      view: 'table'
                  })
                : chartCard();
        if (variant === 'badge') target(card.querySelector('.kit-bal__badge'));
        else if (state === 'hover') target(scrub(card, 11));
        else if (state === 'focus') target(card.querySelector('.kit-bal__plot'));
        else if (state === 'selected') target(card.querySelector('.kit-bal__sw[data-view="table"]'));
        else target(card);
        var box = NS.el('div', 'uil-bal');
        box.appendChild(card);
        return box;
    });

    // Financials Spending's headline figures: Money out and its monthly
    // average, as the picker drew them. Hover and focus land on Money out's
    // label, which explains itself. Busy is the read still out; error is a
    // read that failed; empty is an average nobody can take yet. The variant
    // is the All view's three figures.
    var FIG_TIP = {
        out: 'Booked expenses. Scanned invoices that still need a category are not counted.',
        net: 'Revenue minus expenses.',
        in: 'Register sales before sales tax, refunds taken off.'
    };
    R['tiles__figure-row'] = function (state, variant) {
        var figures =
            variant === 'three'
                ? [
                      {
                          label: 'Net cashflow',
                          value: '$3,210.00',
                          sub: 'vs. $2,980.00 previous period',
                          tip: FIG_TIP.net
                      },
                      {
                          label: 'Money in',
                          value: '$15,690.00',
                          sub: 'vs. $14,000.00 previous period',
                          tip: FIG_TIP.in
                      },
                      {
                          label: 'Money out',
                          value: '−$12,480.00',
                          sub: 'vs. −$11,020.00 previous period',
                          tip: FIG_TIP.out
                      }
                  ]
                : [
                      {
                          label: 'Money out',
                          value: '−$12,480.00',
                          sub: 'vs. −$11,020.00 previous period',
                          tip: FIG_TIP.out
                      },
                      {
                          label: 'Monthly average',
                          value: state === 'empty' ? null : '−$11,860.00',
                          sub: state === 'empty' ? 'No full month in this range yet' : 'vs. −$10,940.00 previous period'
                      }
                  ];
        var o = { label: 'Money out figures', figures: figures };
        if (state === 'busy') o.state = 'loading';
        else if (state === 'error') o.state = 'failed';
        var row = window.Kit.figureRow(o);
        var label = row.querySelector('.kit-figure-row__label.is-tip');
        // The pointer is over the label's head (the tip opens from there and
        // stays while the pointer moves onto it); focus is on the label.
        if (state === 'hover') target(label.parentNode);
        else if (state === 'focus') target(label);
        else target(row);
        // The tip opens above the label, so its cells leave it the room the
        // page does.
        var box = NS.el('div', 'uil-figures' + (state === 'hover' || state === 'focus' ? ' uil-figures--tip' : ''));
        box.appendChild(row);
        return box;
    };

    // Enterprise All stores' figure card, at the width its grid gives it.
    // Empty is a figure no store has set up. It opens nothing.
    R['tiles__plain-figure-card'] = function (state) {
        var card =
            state === 'empty'
                ? window.Kit.plainFigure({ label: 'Labor hours', value: null, sub: 'not set up in 5 of 5' })
                : window.Kit.plainFigure({ label: 'Revenue', value: '$48,120', sub: '4 of 5 stores · 1 not set up' });
        var box = NS.el('div', 'uil-plain');
        box.appendChild(target(card));
        return box;
    };

    // The Dashboard's health scores, at the width its four-across grid
    // gives one. Default is a healthy score that opens its details; busy is
    // the score still loading; empty a score with no reading yet. The
    // variants are the other two tones, a score waiting for its signals, and
    // the same figure where it opens nothing (no arrow, no hover).
    var SCORES = {
        good: {
            name: 'Revenue Integrity',
            score: '96.4',
            unit: '%',
            what: 'How much of what left your shelves was rung up at the register.',
            status: { tone: 'good', text: 'Healthy' }
        },
        watch: {
            name: 'Cash Anomaly Index',
            score: '82.0',
            unit: '%',
            what: 'How closely your cash drawers match your cash sales.',
            status: { tone: 'watch', text: 'Worth a look' }
        },
        bad: {
            name: 'Shelf Velocity',
            score: '71.5',
            unit: '%',
            what: 'How fast products are selling compared with normal.',
            status: { tone: 'bad', text: 'Needs attention' }
        },
        waiting: {
            name: 'Workforce Honesty',
            score: null,
            what: 'How often time cards and cameras agree about who was working.',
            status: { signals: [true, false, false] }
        }
    };
    R['tiles__status-tile'] = function (state, variant) {
        var base = SCORES[variant] || SCORES.good;
        var o = {};
        Object.keys(base).forEach(function (k) {
            o[k] = base[k];
        });
        if (variant !== 'plain') o.onOpen = noop;
        if (state === 'busy') o.state = 'loading';
        if (state === 'empty') {
            o.score = null;
            o.status = { text: 'Not reporting yet' };
        }
        var box = NS.el('div', 'uil-score');
        box.appendChild(target(window.Kit.statusFigure(o)));
        return box;
    };

    /* ── Banners, notices and empty states ───────────────────────────── */

    // Kit.guide, "Argus suggests", unchanged, with the three made-up steps
    // the picker drew (a real step is only ever built from a real read).
    // Hover, focus and pressed land on the first step's button. Empty is all
    // caught up, error a failed read, busy the reads still out. The compact
    // variant is its size for a narrow rail. On a page the steps slide in
    // and the tick pops the first time the panel is seen; the cells are drawn
    // at rest, and the entrance variant plays it once as the frame loads.
    var GUIDE_STEPS = [
        {
            tone: 'now',
            title: 'Order 2 items before they run out',
            why: 'Frozen Pizza runs out in about 2 days at the current pace.',
            action: { label: 'Order now', onClick: noop }
        },
        {
            tone: 'soon',
            title: 'Book 3 scanned invoices',
            why: 'They are read and waiting. Booking them counts them toward money out.',
            action: { label: 'Book them', onClick: noop }
        },
        {
            tone: 'tip',
            title: 'Set a reorder point on 14 items',
            why: 'Argus can only warn you about items that carry one.',
            action: { label: 'Set them', onClick: noop }
        }
    ];
    R['banners__argus-suggests'] = function (state, variant) {
        var o = {
            items: state === 'empty' ? [] : GUIDE_STEPS,
            done: {
                title: 'Nothing needs you',
                body: 'Nothing runs out soon and every bill is booked. A step appears here when something changes.'
            },
            failed: state === 'error',
            loading: state === 'busy',
            compact: variant === 'compact'
        };
        var g = atRest(function () {
            return window.Kit.guide(o);
        });
        if (variant === 'entrance') g.classList.add('is-motion-playing');
        if (state === 'hover' || state === 'focus' || state === 'pressed') target(g.querySelector('.kit-guide__go'));
        else target(g);
        var box = NS.el('div', 'uil-guide' + (variant === 'compact' ? ' uil-guide--rail' : ''));
        box.appendChild(g);
        return box;
    };

    // Kit.couldNotLoad, Financials' failed chart as a kit plate, at the
    // height a boxed chart gives it. Default is the plate drawn with the
    // page; error is the same plate after Try again failed again, which is
    // an alert. Hover and focus land on Try again. Empty is the quiet-period
    // note over a chart that drew its zero: the chart is a stand-in drawn by
    // the library, not a chart (charts stay each their own). Bare is a read
    // that cannot be asked again.
    R['banners__could-not-load'] = function (state, variant) {
        var K = window.Kit;
        if (state === 'empty') {
            var chart = NS.el('div', 'uil-chart');
            chart.appendChild(NS.el('div', 'uil-chart__zero'));
            var note = K.couldNotLoad({ empty: true, text: 'Nothing came in or went out in this period.' });
            chart.appendChild(note);
            target(note.querySelector('.kit-could-not-load__text'));
            return chart;
        }
        var plate = K.couldNotLoad({
            text: 'Could not load these figures, so no chart is drawn.',
            onRetry: variant === 'bare' ? null : noop,
            announce: state === 'error'
        });
        if (state === 'hover' || state === 'focus') target(plate.querySelector('.kit-everyday'));
        else target(plate);
        var box = NS.el('div', 'uil-plate');
        box.appendChild(plate);
        return box;
    };

    // ArgusTable's own empty, failed and loading messages, unchanged, on the
    // same made-up ledger the tables family draws, without its tick column:
    // the header keeps its columns and the sentence sits over five still
    // rows fading out. Hover and focus land on a failed read's Try again.
    // The action variant is empty with a quiet way on.
    R['banners__empty-state'] = function (state, variant) {
        var failed = state === 'error' || state === 'hover' || state === 'focus';
        var opts = { selectable: false };
        if (state === 'busy') {
            opts.state = 'loading';
            opts.ghostRows = 5;
        } else if (failed) {
            opts.state = 'failed';
            opts.failedText = 'Could not load these rows. Nothing was changed.';
        } else {
            opts.rows = [];
            opts.emptyText = 'Nothing came in or went out in this period.';
            opts.emptyAction = variant === 'action' ? { label: 'Show all dates', onClick: noop } : null;
        }
        var host = ledger({ narrow: true, opts: opts });
        if (state === 'hover' || state === 'focus') target(host.querySelector('.atbl-msg__action'));
        else target(host.querySelector('.atbl'));
        return host;
    };

    // Kit.goodNews, Settings Team's 'done' line. Hover, focus and pressed
    // land on the Dismiss cross; the bad variant is the same line for an
    // action that failed. Hidden is the line put away: its live region is
    // still mounted, rendered and empty, in the slot the page keeps for it.
    function slot(region) {
        var box = NS.el('div', 'uil-line uil-slot');
        box.appendChild(target(region));
        return box;
    }
    R['banners__good-news'] = function (state, variant) {
        var bad = variant === 'bad';
        var news = window.Kit.goodNews({
            text: bad ? 'The invite could not be sent.' : 'Invite sent to a new teammate.',
            tone: bad ? 'bad' : 'ok'
        });
        if (variant === 'hidden') {
            news.hide();
            return slot(news.el);
        }
        if (state === 'hover' || state === 'focus' || state === 'pressed') {
            target(news.el.querySelector('.kit-good-news__x'));
        } else target(news.el);
        var box = NS.el('div', 'uil-line');
        box.appendChild(news.el);
        return box;
    };

    // Kit.notice, Financials Transactions' notice line, as the picker drew
    // it: a booking's result with its Show them button and Dismiss cross.
    // Hover, focus and pressed land on Show them; the x variants on the
    // cross. Warn is the amber line with Try again. Info is the words alone,
    // and the other two carry just the button or just the cross. Hidden is
    // the line put away, its live region still mounted and empty.
    var NOTICE_BOOKED = '3 bills booked. They now count toward money out.';
    R['banners__notice'] = function (state, variant) {
        var warn = variant === 'warn';
        var o = {
            text: warn ? 'Categories could not be loaded, so bills cannot be sorted right now.' : NOTICE_BOOKED,
            tone: warn ? 'warn' : 'info'
        };
        if (variant !== 'info' && variant !== 'dismissible') {
            o.action = { label: warn ? 'Try again' : 'Show them', onClick: noop };
        }
        if (variant !== 'info' && variant !== 'action') o.onDismiss = noop;
        var n = window.Kit.notice(o);
        if (variant === 'hidden') {
            n.hide();
            return slot(n.el);
        }
        if (variant === 'x-hover' || variant === 'x-focus') target(n.el.querySelector('.kit-notice__x'));
        else if (state === 'hover' || state === 'focus' || state === 'pressed') {
            target(n.el.querySelector('.kit-quiet'));
        } else target(n.el);
        var box = NS.el('div', 'uil-line');
        box.appendChild(n.el);
        return box;
    };

    // Kit.helpBanner, placed the way Financials places it today: under the
    // tab's own head row, through Kit.helpBanner.into, the kit's slot that
    // holds one banner per place. Its doors are the other tabs. The head row
    // is Financials' own (.fin-tabhead, css/financials.css), for context.
    // Hover and focus land on the first door. The switched variant is the
    // Spending tab switched to Revenue with nothing torn down at all: the
    // slot puts the new banner in place of the old, so there is still one.
    var TAB_HELP = {
        spending: {
            label: 'Spending',
            lead: 'Where your money went, by vendor, category or type.',
            title: 'Where the money went',
            body: 'Every bill and cost you booked, grouped by supplier, category or type. Change the range or filters above the chart.'
        },
        moneyin: {
            label: 'Revenue',
            lead: 'What your registers took in, by source, department or store.',
            title: 'What the register took',
            body: 'Sales by source, department or store, from what your register sends. Days it sent nothing count as no sales.'
        }
    };
    var TAB_DOORS = [
        { key: 'overview', icon: 'chart', label: 'Overview', title: 'What came in, what went out' },
        { key: 'spending', icon: 'dollar', label: 'Spending', title: 'Where your money went' },
        { key: 'moneyin', icon: 'chart', label: 'Revenue', title: 'What the register took' },
        { key: 'transactions', icon: 'list', label: 'History', title: 'Every sale day and every bill' },
        { key: 'expenses', icon: 'file', label: 'Expenses', title: 'Every bill you booked' }
    ];
    function tabHeadRow(key) {
        var t = TAB_HELP[key];
        var row = NS.el('div', 'fin-tabhead');
        var words = NS.el('div', 'fin-tabhead__words');
        words.appendChild(NS.el('h2', 'fin-tabhead__title', t.label));
        words.appendChild(NS.el('p', 'fin-tabhead__lead', t.lead));
        row.appendChild(words);
        return row;
    }
    function tabHelp(view, key) {
        var t = TAB_HELP[key];
        var doors = TAB_DOORS.filter(function (d) {
            return d.key !== key;
        })
            .slice(0, 4)
            .map(function (d) {
                return { icon: d.icon, label: d.label, title: d.title, onClick: noop };
            });
        return atRest(function () {
            return window.Kit.helpBanner.into(
                view,
                { title: t.title, body: t.body, doors: doors },
                { wrap: { class: 'kit fin-help' } }
            );
        });
    }
    R['banners__page-explainer'] = function (state, variant) {
        var view = NS.el('div', 'uil-tabview');
        var head = tabHeadRow('spending');
        view.appendChild(head);
        var banner = tabHelp(view, 'spending');
        if (variant === 'switched') {
            view.replaceChild(tabHeadRow('moneyin'), head);
            banner = tabHelp(view, 'moneyin');
        }
        target(state === 'hover' || state === 'focus' ? banner.querySelector('.kit-help__door.is-go') : banner);
        return view;
    };

    /* ── Pop-ups, panels and tips ────────────────────────────────────── */

    // A pop-up opened on <body> is the real one: the factory opens it, the
    // cell keeps a still copy of what it drew (inlineCopy), and the live one
    // closes at once, taking its focus trap, its scroll lock, the inert page
    // and its listeners with it. So a window or a full screen is drawn INSIDE
    // its cell, contained, and never covers or traps the frame.
    function marked(nodes) {
        Array.prototype.forEach.call(nodes, function (n) {
            if (n) target(n);
        });
    }
    function pressable(state) {
        return state === 'hover' || state === 'focus' || state === 'pressed';
    }

    // The menu and pop-out is the kit's one pop-out shell (.kit-pop-out),
    // what Kit.buttonMenu, Kit.filterButton and Kit.filterChip open. Every
    // cell is Financials' Saved views menu under its button, as the picker
    // drew it: a caption, the chosen row with its wine tick, rows with
    // rename and delete, a divider and a row that is off. Hover rests the
    // pointer on a row (its actions come out); focus is the keyboard on a row
    // (a plain row with the ring round all of it); selected is the chosen
    // row; disabled is the row that is off. The variants are the same shell
    // holding controls, from the filter button and from a filter chip.
    var OV_VIEWS = [
        { note: 'Saved views' },
        { key: 'all', label: 'All transactions', icon: 'grid', selected: true },
        { key: 'out', label: 'Money out this month', icon: 'bookmark', actions: ROW_ACTIONS },
        { key: 'cat', label: 'Needs a category', icon: 'tag', actions: ROW_ACTIONS },
        { divider: true },
        { key: 'new', label: 'Create view', icon: 'plus' },
        { key: 'share', label: 'Share view (soon)', icon: 'download', disabled: true }
    ];
    R['overlays__menu-and-pop-out'] = function (state, variant) {
        var K = window.Kit;
        var opener;
        var copy;
        if (variant === 'filter') {
            opener = K.filterButton({
                label: 'View',
                icon: 'sliders',
                popLabel: 'How the list looks',
                content: viewPane
            });
            copy = openAndCopy(
                function () {
                    opener.kitOpen();
                },
                lastOf('.kit.kit-pop-out'),
                null,
                function () {
                    opener.kitClose();
                }
            );
            opener.setAttribute('aria-expanded', 'true');
            target(copy);
            return dropStack(opener, copy);
        }
        if (variant === 'chip') {
            opener = K.filterChip({
                label: 'Last 30 days',
                popLabel: 'Dates',
                content: function () {
                    return K.pickOne({ label: 'Dates', value: 'last30', options: WINDOWS });
                }
            });
            copy = openAndCopy(
                function () {
                    opener.kitOpen();
                },
                lastOf('.kit.kit-pop-out'),
                null,
                function () {
                    opener.kitClose();
                }
            );
            opener.classList.add('is-open');
            opener.kitButton.setAttribute('aria-expanded', 'true');
            target(copy);
            return dropStack(opener, copy);
        }
        opener = K.buttonMenu({ label: 'Saved views', icon: 'bookmark', text: 'All transactions', items: OV_VIEWS });
        copy = openAndCopy(
            function () {
                opener.kitOpen();
            },
            lastOf('.kit.kit-pop-out'),
            null,
            function () {
                opener.kitClose();
            }
        );
        opener.setAttribute('aria-expanded', 'true');
        var rows = copy.querySelectorAll('.kit-button-menu__row');
        // Focus is the keyboard on a row: a plain row, the ring round all
        // of it (Kit.buttonMenu marks such a row .is-focused).
        if (state === 'hover' || state === 'focus') target(rows[state === 'hover' ? 1 : 2]);
        else if (state === 'selected') target(rows[0]);
        else if (state === 'disabled') target(rows[4].querySelector('.kit-button-menu__item'));
        else target(copy);
        return dropStack(opener, copy);
    };

    // Kit.hoverTip, the Dashboard's tip made the kit's tip for labels and
    // everything that is not a chart. Default is a word that explains itself
    // at rest (its dotted underline, the tip not shown); hover and focus open
    // it. The frame forces the state on the host (which shows the tip) and on
    // the word (which draws the ring), so the word is marked as where the
    // ring is. The variants are an icon button's name, the chart tip's three
    // lines, and a tip that opens below its trigger.
    function tipped(o) {
        var word = o.icon ? null : NS.el('span', null, o.word);
        var trigger = word;
        if (o.icon) {
            trigger = NS.el('button', 'kit-icon');
            trigger.type = 'button';
            trigger.setAttribute('aria-label', o.icon);
            trigger.appendChild(window.Kit.glyph('download', { cls: 'kit-icon__glyph' }));
        }
        var host = window.Kit.hoverTip(Object.assign({ trigger: trigger }, o.tip, o.below ? { below: true } : {}));
        target(host);
        target(trigger);
        trigger.setAttribute('data-uil-ring', '');
        var box = NS.el('div', 'uil-tipbox' + (o.below ? ' uil-tipbox--below' : ''));
        box.appendChild(host);
        return box;
    }
    R['overlays__hover-tip'] = function (state, variant) {
        if (variant === 'icon')
            return tipped({ icon: 'Download', tip: { text: 'Download the list as a spreadsheet' } });
        if (variant === 'chart') {
            return tipped({
                word: 'Transactions',
                tip: { when: 'Sat, Jun 20', value: '390', note: '12 more than the day before' }
            });
        }
        if (variant === 'below') {
            return tipped({ word: 'Net sales', below: true, tip: { text: 'What the register took, less refunds.' } });
        }
        return tipped({ word: 'Net sales', tip: { text: 'What the register took, less refunds.' } });
    };

    // Kit.confirm, the Settings yes/no question, unchanged. Hover, focus and
    // pressed land on both buttons, as the picker drew them. Cancel holds
    // the focus as it opens (the safe answer first); opened by the pointer
    // it shows no ring. The danger variant is red words on white.
    function questionCopy(o) {
        var before = document.querySelectorAll('.kit.kit-modal').length;
        window.Kit.confirm(o);
        var all = document.querySelectorAll('.kit.kit-modal');
        var live = all.length > before ? all[all.length - 1] : null;
        if (!live) throw new Error('Kit.confirm opened no question');
        var copy = inlineCopy(live);
        // Cancel: answers no, and closes it with its trap and its lock.
        live.querySelector('.kit-modal__foot .kit-btn').click();
        letGo();
        return copy;
    }
    R['overlays__yes-no-question'] = function (state, variant) {
        var danger = variant === 'danger';
        var copy = questionCopy(
            danger
                ? {
                      title: 'Remove this key?',
                      message: 'Apps using it stop working straight away. This cannot be undone.',
                      confirmText: 'Remove',
                      danger: true
                  }
                : {
                      title: 'Turn off quiet time?',
                      message: 'Alerts start arriving again at every hour of the day.',
                      confirmText: 'Turn off'
                  }
        );
        if (pressable(state)) marked(copy.querySelectorAll('.kit-modal__foot .kit-btn'));
        return copy;
    };

    // Kit.popUpWindow, Inventory's form window: New vendor, a two-column
    // form of kit text boxes, Cancel and the wine confirm on the hairline.
    // Hover, focus and pressed land on both buttons; disabled is the window
    // busy (both off); error is a save the store refused, the red line at
    // the top and the field it names. The variants are the purchase order's
    // wider window with its close x, and Adjust stock on one page.
    function windowField(label, hint, o) {
        var c = o || {};
        var input = NS.el('input', 'kit-text-box');
        input.type = 'text';
        input.id = boxId();
        input.setAttribute('autocomplete', 'off');
        if (hint) input.placeholder = hint;
        if (c.required) input.setAttribute('aria-required', 'true');
        var field = NS.el('div', 'kit-pop-up-window__field' + (c.half ? ' kit-pop-up-window__half' : ''));
        var l = NS.el('label', 'kit-pop-up-window__label', label + (c.required ? ' *' : ''));
        l.htmlFor = input.id;
        field.appendChild(l);
        field.appendChild(input);
        return field;
    }
    function windowGrid(fields) {
        var g = NS.el('div', 'kit-pop-up-window__grid');
        fields.forEach(function (f) {
            g.appendChild(f);
        });
        return g;
    }
    function windowCopy(o, before) {
        var h = window.Kit.popUpWindow(o);
        if (typeof before === 'function') before(h);
        var copy = inlineCopy(h.el);
        h.close();
        letGo();
        return copy;
    }
    R['overlays__pop-up-window'] = function (state, variant) {
        var copy;
        if (variant === 'with-x') {
            copy = windowCopy({
                title: 'New purchase order',
                subtitle: 'Order stock from a supplier.',
                size: 'xl',
                close: true,
                body: windowGrid([
                    windowField('Vendor', 'Pick a supplier', { required: true }),
                    windowField('Expected delivery', 'Jun 27, 2026', { half: true }),
                    windowField('Reference', 'Optional', { half: true })
                ]),
                actions: [{ label: 'Cancel' }, { label: 'Create order', primary: true }]
            });
            target(copy.querySelector('.kit-icon'));
            return copy;
        }
        if (variant === 'adjust') {
            return windowCopy({
                title: 'Adjust stock',
                subtitle: 'Sample cola 12oz. Enter a positive number to add, negative to subtract.',
                body: windowGrid([
                    windowField('Quantity change', 'e.g. -3 or 12', { required: true }),
                    windowField('Reason', 'Optional note for the audit trail')
                ]),
                actions: [{ label: 'Cancel' }, { label: 'Apply adjustment', primary: true }]
            });
        }
        var bad = state === 'error';
        copy = windowCopy(
            {
                title: 'New vendor',
                subtitle: 'Add a supplier you order from.',
                body: windowGrid([
                    windowField('Vendor name', 'e.g. Sample Foodservice', { required: true }),
                    windowField('Contact name', '', { half: true }),
                    windowField('Contact phone', '', { half: true }),
                    windowField('Contact email', 'rep@vendor.com')
                ]),
                actions: [{ label: 'Cancel' }, { label: 'Add vendor', primary: true }]
            },
            function (h) {
                if (state === 'disabled') h.setBusy(true);
                if (bad) {
                    h.setError('Step 1: fix the highlighted field.');
                    h.setFieldError(h.el.querySelector('.kit-text-box'), 'Vendor name is required');
                }
            }
        );
        if (pressable(state) || state === 'disabled') {
            marked(copy.querySelectorAll('.kit-pop-up-window__foot button'));
        } else if (bad) target(copy.querySelector('.kit-pop-up-window__error'));
        return copy;
    };

    // Kit.sideSheet, Financials' transaction sheet, over a stand-in page (no
    // scrim: the page stays in use). Hover, focus and pressed land on its
    // close x and its link. Words are made up.
    R['overlays__side-panel'] = function (state) {
        var K = window.Kit;
        var h = K.sideSheet({
            kicker: 'Transaction',
            title: 'Sample Vendor A',
            figure: '−$482.50',
            body: K.plainTag('Needs category', { small: true }),
            fields: [
                { term: 'Date', def: 'Sat, Jun 20, 2026' },
                { term: 'Amount', def: '−$482.50' },
                { term: 'Store', def: 'Sample Store' },
                { term: 'Method', def: 'Check' },
                { term: 'Category', def: 'Needs category' },
                { term: 'Status', def: 'Unbooked invoice' }
            ],
            links: [{ label: 'Go to Expenses', onClick: noop }]
        });
        var copy = inlineCopy(h.el);
        h.close();
        letGo();
        if (pressable(state)) marked([copy.querySelector('.kit-icon'), copy.querySelector('.kit-side-sheet__link')]);
        else target(copy);
        var scene = NS.el('div', 'uil-scene');
        scene.appendChild(NS.el('div', 'uil-scene__page'));
        scene.appendChild(copy);
        return scene;
    };

    // Kit.fullScreen, the Documents viewer: a stand-in page on the stage (a
    // blank sheet, not a document) and a panel beside it with a status tag
    // and two kit buttons. Hover, focus and pressed land on the close and
    // both arrows. The single variant is one document opened from another
    // page: no list to walk, so no arrows and no panel.
    R['overlays__full-screen'] = function (state, variant) {
        var K = window.Kit;
        var single = variant === 'single';
        var side = null;
        if (!single) {
            side = NS.el('div', 'uil-doc-side');
            side.appendChild(K.plainTag('Needs review', { small: true }));
            var acts = NS.el('div', 'uil-doc-side__acts');
            var dl = NS.el('button', 'kit-everyday', 'Download');
            dl.type = 'button';
            var ok = NS.el('button', 'kit-btn kit-btn--primary kit-btn--hero', 'Mark reviewed');
            ok.type = 'button';
            acts.appendChild(dl);
            acts.appendChild(ok);
            side.appendChild(acts);
        }
        var h = K.fullScreen({
            title: 'sample-vendor-invoice.pdf',
            meta: 'PDF · Jun 20, 2026 · $482.50',
            body: NS.el('div', 'uil-paper'),
            side: side,
            nav: single ? null : { at: '3 of 18', onPrev: noop, onNext: noop }
        });
        var copy = inlineCopy(h.el);
        h.close();
        letGo();
        if (pressable(state)) {
            marked(
                [copy.querySelector('.kit-full-screen__close')].concat(
                    [].slice.call(copy.querySelectorAll('.kit-full-screen__arrow'))
                )
            );
        } else target(copy);
        var screen = NS.el('div', 'uil-screen');
        screen.appendChild(copy);
        return screen;
    };

    /* ── Loading and feedback ─────────────────────────────────────────── */

    // Kit.loadingPlaceholder, Financials' flat breathing bars. Default is
    // where it is used most: Financials' headline figures still loading,
    // drawn by Kit.figureRow, whose bars are this placeholder (the hero's
    // at the headline size, the others at the size beside it). Rows is a
    // money-in breakdown still loading: the header kept over seven rows of
    // bars, words in the first two columns and amounts at the right edge.
    // Lines is a paragraph still loading. The bars breathe on a page and
    // hold still under reduced motion.
    R['feedback__loading-placeholder'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'rows') {
            var card = NS.el('div', 'uil-card');
            card.appendChild(NS.el('h3', 'uil-card__title', 'Money in'));
            var table = NS.el('table', 'uil-ghost-rows');
            table.setAttribute('aria-busy', 'true');
            table.setAttribute('aria-label', 'Money in by category');
            var head = NS.el('tr');
            ['Category', '% of total', 'Amount'].forEach(function (w, i) {
                var th = NS.el('th', i === 2 ? 'uil-ghost-rows__amt' : null, w);
                th.scope = 'col';
                head.appendChild(th);
            });
            var thead = NS.el('thead');
            thead.appendChild(head);
            table.appendChild(thead);
            var body = NS.el('tbody');
            for (var i = 0; i < 7; i++) {
                var tr = NS.el('tr');
                tr.setAttribute('aria-hidden', 'true');
                [{ size: 'cell' }, { size: 'cell', short: true }, { size: 'amount' }].forEach(function (o) {
                    var td = NS.el('td');
                    td.appendChild(
                        i === 0 && o.size === 'cell' && !o.short
                            ? target(K.loadingPlaceholder(o))
                            : K.loadingPlaceholder(o)
                    );
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            }
            table.appendChild(body);
            card.appendChild(table);
            return card;
        }
        if (variant === 'lines') {
            var para = NS.el('div', 'uil-card uil-card--narrow');
            para.setAttribute('aria-busy', 'true');
            para.appendChild(target(K.loadingPlaceholder({ size: 'line' })));
            para.appendChild(K.loadingPlaceholder({ size: 'line' }));
            para.appendChild(K.loadingPlaceholder({ size: 'line', short: true }));
            return para;
        }
        var row = K.figureRow({
            label: 'Headline figures',
            figures: [{ label: 'Net change' }, { label: 'Money in' }, { label: 'Money out' }],
            state: 'loading'
        });
        target(row.querySelector('.kit-loading-placeholder'));
        var box = NS.el('div', 'uil-figures');
        box.appendChild(row);
        return box;
    };

    // Kit.missingFigure, the Dashboard's muted dash, in a figure's place at
    // the Dashboard KPI's size (the scaffold's 34px, 700). Default is a
    // figure no register reports yet; error is a read that failed, with
    // Try again, where hover, focus and pressed land. Inline is the same
    // failed read in a Financials summary cell, the words beside the dash;
    // cell is a table cell nobody measured, the dash alone. The label over
    // each figure is the library's.
    function figureSlot(label, part, big) {
        var fig = NS.el('div', 'uil-fig' + (big ? '' : ' uil-fig--small'));
        fig.appendChild(NS.el('div', 'uil-fig__label', label));
        var value = NS.el('div', 'uil-fig__value');
        value.appendChild(part);
        fig.appendChild(value);
        return fig;
    }
    R['feedback__missing-figure'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'cell') {
            var t = NS.el('table', 'uil-mini-table');
            var hr = NS.el('tr');
            ['Store', 'Sales', 'Shrink'].forEach(function (w) {
                var th = NS.el('th', null, w);
                th.scope = 'col';
                hr.appendChild(th);
            });
            var th0 = NS.el('thead');
            th0.appendChild(hr);
            t.appendChild(th0);
            var tr = NS.el('tr');
            tr.appendChild(NS.el('td', null, 'Main Street'));
            tr.appendChild(NS.el('td', null, '$12,480'));
            var td = NS.el('td');
            td.appendChild(target(K.missingFigure({ label: 'Not measured' })));
            tr.appendChild(td);
            var tb = NS.el('tbody');
            tb.appendChild(tr);
            t.appendChild(tb);
            return t;
        }
        var failed = state === 'error' || pressable(state) || variant === 'inline';
        var m = K.missingFigure(
            failed ? { onRetry: noop, inline: variant === 'inline' } : { reason: 'Not reporting yet.' }
        );
        if (pressable(state)) target(m.querySelector('.kit-missing-figure__retry'));
        else target(m);
        return figureSlot(variant === 'inline' ? 'Register sales' : 'Gross profit', m, variant !== 'inline');
    };

    // Kit.notify, the app's top-centre notification, put into the cell
    // rather than the page's stack (into), and kept until it is dismissed
    // (timeout 0), so it stays to be looked at. Default is information,
    // error an error (an alert). Hover, focus and pressed land on the Dismiss
    // cross. Open is its drop-in, which plays once as the frame loads (a still
    // frame shows it landed); leaving is its lift-out, halfway. The other
    // variants are the other two tones, one with a title, one with an
    // action, and a long error that wraps at the 640px cap. The words are
    // made up.
    var NOTES = {
        default: { text: 'Your export is on its way.', tone: 'info' },
        error: { text: 'Could not save. Try again.', tone: 'error' },
        success: { text: 'Bill added', tone: 'success' },
        warning: { text: 'Two lines have no cost yet.', tone: 'warning' },
        title: { title: 'Invoice read', text: '12 lines, $482.50 from a sample vendor.', tone: 'success' },
        action: { text: 'Bill deleted.', tone: 'info', action: { label: 'Undo', onClick: noop } },
        long: {
            text: 'Could not reach the register. Nothing was changed. We will try again in a minute.',
            tone: 'error'
        }
    };
    R['feedback__notification'] = function (state, variant) {
        var o =
            NOTES[variant] ||
            (state === 'error'
                ? NOTES.error
                : pressable(state) || state === 'open' || variant === 'leaving'
                  ? NOTES.success
                  : NOTES.default);
        var box = NS.el('div', 'uil-notes' + (variant === 'long' ? ' uil-notes--wide' : ''));
        var h = window.Kit.notify({
            text: o.text,
            title: o.title,
            tone: o.tone,
            action: o.action,
            timeout: 0,
            into: box
        });
        // Leaving is the lift-out the cross or the count starts, frozen
        // halfway by the frame (the variant's 'leaving' look): the real class,
        // without the removal that follows it on a page.
        if (variant === 'leaving') h.el.classList.add('is-leaving');
        if (pressable(state)) target(h.el.querySelector('.kit-notification__x'));
        else target(h.el);
        return box;
    };

    // Kit.openingScreen, the boot screen's lockup, over the page ground in a
    // box the size of a small window. Default is its first caption; the
    // caption variant is the next step, which a screen reader hears. The
    // still variant is how reduced motion draws it: the halo and the bar
    // hold still, the segment parked. It fades out when the page is ready,
    // to nothing, so that is not drawn.
    R['feedback__opening-screen'] = function (state, variant) {
        var h = window.Kit.openingScreen();
        if (variant === 'caption') h.say('Signing you in');
        target(h.el);
        var box = NS.el('div', 'uil-boot');
        box.appendChild(h.el);
        return box;
    };

    // Kit.progressBar, the invoice scan's file bar, in a scan window's file
    // row (the name and size are the library's), in Inventory's colour: the
    // frame opens Inventory (the registry's module). Default is a file being
    // read, measured (42%); busy is the scan itself, which reports nothing,
    // so the segment travels; error is a file that could not be read, with
    // the ways on. Queued is a file waiting its turn, words only. Still is
    // how reduced motion draws the scan: a still tint of the whole track.
    function fileRow(name, part) {
        var row = NS.el('div', 'uil-file');
        var top = NS.el('div', 'uil-file__top');
        top.appendChild(NS.el('span', 'uil-file__name', name));
        top.appendChild(NS.el('span', 'uil-file__size', '1.2 MB'));
        row.appendChild(top);
        row.appendChild(part);
        return row;
    }
    R['feedback__progress-bar'] = function (state, variant) {
        var K = window.Kit;
        var o;
        if (variant === 'queued') o = { state: 'queued' };
        else if (state === 'error') {
            o = {
                state: 'failed',
                text: 'The page was too blurry to read.',
                actions: [
                    { label: 'Try this one again', onClick: noop },
                    { label: 'Enter it in Receive', onClick: noop }
                ]
            };
        } else if (state === 'busy' || variant === 'still') {
            o = { label: 'Scanning invoice-0412.pdf', text: 'Reading the lines' };
        } else o = { label: 'Reading invoice-0412.pdf', value: 0.42, text: 'Reading the file' };
        var bar = K.progressBar(o);
        target(bar.el);
        return fileRow(
            variant === 'queued' ? 'invoice-0413.pdf' : state === 'error' ? 'invoice-0414.pdf' : 'invoice-0412.pdf',
            bar.el
        );
    };

    // Kit.workingSign, the quiet wine ring over a sentence, in an Employees
    // certificate's reading box. Detail adds the quieter line under the
    // sentence; video is the same sign over a clip, which stays dark in both
    // themes. On a page the ring turns once every 0.8s, and every 1.6s under
    // reduced motion, never still; a still frame cannot show a turn.
    R['feedback__working-sign'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'video') {
            var clip = NS.el('div', 'uil-video uil-video--clip');
            clip.appendChild(target(K.workingSign({ text: 'Loading clip...', onVideo: true })));
            return clip;
        }
        var s = K.workingSign({
            text: 'Reading the document...',
            detail:
                variant === 'detail'
                    ? 'A PDF that carries a text layer is read from the text; a photograph is read from the image.'
                    : null
        });
        var box = NS.el('div', 'uil-reading');
        box.appendChild(target(s));
        return box;
    };

    /* ── Navigation, back links and titles ───────────────────────────── */

    // The Settings menu's rows, as Settings lists them (js/settings/rail.js
    // ICONS), five of its groups. Its circles and boxes are written as
    // paths, which is what the kit's glyph takes. The words are Settings'.
    function circlePath(cx, cy, r) {
        return (
            'M' +
            (cx - r) +
            ' ' +
            cy +
            'a' +
            r +
            ' ' +
            r +
            ' 0 1 0 ' +
            2 * r +
            ' 0a' +
            r +
            ' ' +
            r +
            ' 0 1 0 ' +
            -2 * r +
            ' 0'
        );
    }
    function rectPath(x, y, w, h, rx) {
        var a = 'a' + rx + ' ' + rx + ' 0 0 1 ';
        return (
            'M' +
            (x + rx) +
            ' ' +
            y +
            'h' +
            (w - 2 * rx) +
            a +
            rx +
            ' ' +
            rx +
            'v' +
            (h - 2 * rx) +
            a +
            -rx +
            ' ' +
            rx +
            'h' +
            -(w - 2 * rx) +
            a +
            -rx +
            ' ' +
            -rx +
            'v' +
            -(h - 2 * rx) +
            a +
            rx +
            ' ' +
            -rx +
            'z'
        );
    }
    var SETTINGS_GROUPS = [
        {
            label: 'Your store',
            items: [
                {
                    id: 'store',
                    label: 'Store details',
                    icon: ['M3 10l2-6h14l2 6', 'M3 10h18', 'M5 10v10h14V10', 'M10 20v-5h4v5']
                },
                { id: 'billing', label: 'Plan & billing', icon: [rectPath(2, 5, 20, 14, 2), 'M2 10h20', 'M6 15h4'] },
                {
                    id: 'integrations',
                    label: 'Connections',
                    icon: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v5']
                },
                { id: 'exports', label: 'Your data', icon: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'] }
            ]
        },
        {
            label: 'Team',
            items: [
                {
                    id: 'team',
                    label: 'People',
                    icon: [
                        'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
                        circlePath(9, 7, 4),
                        'M22 21v-2a4 4 0 0 0-3-3.87',
                        'M16 3.13a4 4 0 0 1 0 7.75'
                    ]
                },
                { id: 'roles', label: 'Roles', icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'] }
            ]
        },
        {
            label: 'Alerts',
            items: [
                {
                    id: 'notifications',
                    label: 'Notifications',
                    icon: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0']
                },
                { id: 'quiet-time', label: 'Quiet time', icon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'] }
            ]
        },
        {
            label: 'Security',
            items: [
                { id: 'security', label: 'Sign-in', icon: [rectPath(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'] },
                {
                    id: 'privacy',
                    label: 'Privacy',
                    icon: [
                        'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94',
                        'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19',
                        'M14.12 14.12a3 3 0 1 1-4.24-4.24',
                        'M1 1l22 22'
                    ]
                }
            ]
        },
        {
            label: 'Devices',
            items: [{ id: 'cameras', label: 'Cameras', icon: ['M23 7l-7 5 7 5V7z', rectPath(1, 5, 15, 14, 2)] }]
        }
    ];
    function settingsMenu(o) {
        return window.Kit.sectionMenu({
            label: 'Settings',
            back: { label: 'Back to home', href: '#home', onClick: noop },
            search: { label: 'Search settings' },
            groups: SETTINGS_GROUPS,
            active: o.active,
            collapsed: o.collapsed,
            onSelect: noop
        });
    }

    // Kit.backLink, Settings' "Back to home", on the Settings menu's ground
    // at the menu's width. Hover, focus and pressed land on it. Collapsed is
    // the chevron alone at the top of a collapsed menu, where it collapses;
    // under the pointer its name comes up in the banner.
    R['navigation__back-link'] = function (state, variant) {
        var K = window.Kit;
        if (variant) {
            var m = K.sectionMenu({
                label: 'Settings',
                back: { label: 'Back to home', href: '#home', onClick: noop },
                title: false,
                collapsed: true
            });
            target(m.el.querySelector('.kit-back-link'));
            var col = NS.el('div', 'uil-menu-col uil-menu-col--collapsed');
            col.appendChild(m.el);
            return col;
        }
        var ground = NS.el('div', 'uil-menu-ground');
        ground.appendChild(target(K.backLink({ label: 'Back to home', href: '#home', onClick: noop })));
        return ground;
    };

    // Kit.sectionMenu, the Settings menu at the rail's width, Store details
    // chosen. Hover, focus and pressed land on People; selected is People
    // chosen; empty is a search for "zebra", which matches nothing. Search
    // is the search box with keyboard focus. Collapsed is the 52px column of
    // glyphs, and its hover and focus bring up People's name banner; there
    // the ring goes on People's glyph box (data-uil-ring, beside its twin in
    // the default cell, which draws none).
    R['navigation__section-menu'] = function (state, variant) {
        var collapsed = /^collapsed/.test(variant || '');
        var m = settingsMenu({ active: state === 'selected' ? 'team' : 'store', collapsed: collapsed });
        var people = m.el.querySelector('.kit-section-menu__item[data-id="team"]');
        if (state === 'empty') m.setQuery('zebra');
        if (variant === 'search') target(m.el.querySelector('.kit-section-menu__search'));
        else if (pressable(state) || state === 'selected') target(people);
        else target(m.el);
        if (collapsed || (state === 'default' && !variant)) {
            people.querySelector('.kit-section-menu__icon').setAttribute('data-uil-ring', '');
        }
        var col = NS.el('div', 'uil-menu-col' + (collapsed ? ' uil-menu-col--collapsed' : ''));
        col.appendChild(m.el);
        return col;
    };

    // The main side menu is the shell's own rail, drawn by its own code
    // (AxRail.build, js/system/rail.js) with the library's current page: a
    // reference, never a copy, as there is only ever one. Default is its
    // open look with Review current (the landing); hover, focus and pressed
    // land on Financials; selected is Financials current. Collapsed is the
    // rail's own collapse (AxRail.setCollapsed), which writes the person's
    // choice to this browser: the library puts back whatever was there, so
    // drawing it changes nothing for the portal. Its hover shows the rail's
    // name banner beside Financials, placed where the rail places it (8px
    // right of the row, centred on it) once the cell is on the page.
    function railFor(current, collapsed) {
        var A = window.AxRail;
        var el = A.build({ current: current, features: {} });
        // build() starts collapsed if this browser collapsed the real rail.
        el.classList.remove('axr--collapsed');
        if (!collapsed) return el;
        var key = A.COLLAPSE_KEY;
        var had = null;
        var read = true;
        try {
            had = window.localStorage.getItem(key);
        } catch (e) {
            read = false;
        }
        // ⛔ PUT BACK IN A finally. setCollapsed writes the choice before it
        // does anything else, so a throw after that (a rail that moved on)
        // must not leave the real portal's menu collapsed on this origin.
        try {
            A.setCollapsed(el, true);
        } finally {
            if (read) {
                try {
                    if (had === null) window.localStorage.removeItem(key);
                    else window.localStorage.setItem(key, had);
                } catch (e) {
                    /* private browsing: nothing was written */
                }
            }
        }
        return el;
    }
    function placeRailTip(stage, row, tip) {
        function place() {
            if (!stage.isConnected) return;
            var s = stage.getBoundingClientRect();
            var r = row.getBoundingClientRect();
            tip.style.left = Math.round(r.right - s.left + 8) + 'px';
            tip.style.top = Math.round(r.top - s.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(place);
        else setTimeout(place, 0);
    }
    R['navigation__main-menu'] = function (state, variant) {
        var collapsed = !!variant;
        var rail = railFor(state === 'selected' ? 'cash' : 'home', collapsed);
        var fin = rail.querySelector('.axr__scroll .axr__row[data-page="cash"]');
        if (pressable(state) || state === 'selected' || variant === 'collapsed-hover') target(fin);
        else target(rail);
        var stage = NS.el('div', 'uil-rail' + (collapsed ? ' uil-rail--collapsed' : ''));
        stage.appendChild(rail);
        if (variant === 'collapsed-hover') {
            var tip = NS.el('div', 'axr-tip axr-tip--on uil-rail__tip', fin.getAttribute('aria-label'));
            tip.setAttribute('role', 'presentation');
            stage.appendChild(tip);
            placeRailTip(stage, fin, tip);
        }
        return stage;
    };

    // Kit.titleHead, Financials' title and its sentence, at a page's width.
    R['navigation__page-title'] = function () {
        var page = NS.el('div', 'uil-heads');
        page.appendChild(
            target(window.Kit.titleHead({ title: 'Financials', sub: 'Revenue, expenses, and what the store kept.' }))
        );
        return page;
    };

    // Kit.sectionHeading, Financials' Spending head. With its action is the
    // same head with the section's one action at the right (Export, the
    // kit's wine button), as Spending draws it.
    R['navigation__section-heading'] = function (state, variant) {
        var o = { title: 'Spending', lead: 'Where your money went, by vendor, category or type.' };
        if (variant === 'action') {
            var b = NS.el('button', 'kit-btn kit-btn--primary kit-btn--hero', 'Export');
            b.type = 'button';
            o.actions = b;
        }
        var page = NS.el('div', 'uil-heads');
        page.appendChild(target(window.Kit.sectionHeading(o)));
        return page;
    };

    // The skip link, first in the corner of a stand-in page, pointing at its
    // main content. The corner holds it as the window would (it is fixed to
    // the window's top left), so at rest the cell shows the page alone. Focus
    // is the first Tab; the variant is that link with the pointer over it,
    // whose words stay (the source's vanish in light).
    var skipLinks = 0;
    R['navigation__skip-link'] = function () {
        var n = ++skipLinks;
        var corner = NS.el('div', 'uil-corner');
        var a = NS.el('a', 'kit-skip-link', 'Skip to main content');
        a.href = '#uilSkipMain' + n;
        corner.appendChild(target(a));
        var page = NS.el('div', 'uil-corner__page');
        page.id = 'uilSkipMain' + n;
        page.appendChild(NS.el('span', 'uil-corner__line'));
        page.appendChild(NS.el('span', 'uil-corner__line uil-corner__line--short'));
        corner.appendChild(page);
        return corner;
    };

    /* ── Cards and sections ──────────────────────────────────────────── */

    // Kit.clickBox, two of Employees' reports in the page's grid, at the
    // width the picker drew them; the state is drawn on the first. Wide is
    // the lead report across both columns. Each opens nothing here.
    var REPORTS = [
        { title: 'Hours by person', body: 'Who worked what, from the time clock.' },
        { title: 'Late arrivals', body: 'Punches after the shift started.' }
    ];
    R['surfaces__click-card'] = function (state, variant) {
        var grid = NS.el('div', 'uil-boxes');
        if (variant === 'wide') {
            grid.appendChild(
                target(
                    window.Kit.clickBox({ title: REPORTS[0].title, body: REPORTS[0].body, wide: true, onClick: noop })
                )
            );
            return grid;
        }
        REPORTS.forEach(function (r, i) {
            var box = window.Kit.clickBox({ title: r.title, body: r.body, onClick: noop });
            grid.appendChild(i === 0 ? target(box) : box);
        });
        return grid;
    };

    // Kit.details, the Employees drawer's four facts, on the drawer's
    // ground. The variant is the same grid with a value not set yet.
    R['surfaces__details'] = function (state, variant) {
        var muted = variant === 'muted';
        var sheet = NS.el('div', 'uil-sheet');
        sheet.appendChild(
            target(
                window.Kit.details({
                    items: [
                        { label: 'Started', value: 'Mar 3, 2025', sub: '1 year, 6 months' },
                        muted
                            ? { label: 'Pay', value: 'Not set', sub: 'Part time', muted: true }
                            : { label: 'Pay', value: '$18.50/hr', sub: 'Part time' },
                        { label: 'This week', value: '24 h scheduled', sub: '11.5 h worked' },
                        { label: 'Store', value: 'Test Store 1' }
                    ]
                })
            )
        );
        return sheet;
    };

    // Kit.listBox, Financials Overview's top payees at the width its band
    // gives one. Hover and focus land on the second payee's name. Busy is
    // the read still out; empty a range with nothing in it. The variants
    // are money in (the green bars) and Forecast's box, the same box holding
    // a sentence. Names open nothing here.
    var PAYEES = [
        { name: 'Northside Distributors', amount: '$6,421.80', share: 52 },
        { name: 'Metro Fuel Supply', amount: '$3,812.00', share: 31 },
        { name: 'City Water and Power', amount: '$1,184.00', share: 10 }
    ];
    var SOURCES = [
        { name: 'Register sales', amount: '$13,940.00', share: 89 },
        { name: 'Lottery', amount: '$1,210.00', share: 8 }
    ];
    function linked(rows) {
        return rows.map(function (r, i) {
            return { name: r.name, amount: r.amount, share: r.share, href: '#uilPayee' + i, onClick: noop };
        });
    }
    R['surfaces__list-box'] = function (state, variant) {
        var o = {
            title: 'Where money went',
            sub: 'Top payees, last 30 days',
            total: '$12,319.95',
            rows: linked(PAYEES),
            rest: { amount: '$902.15' }
        };
        if (variant === 'in') {
            o = {
                title: 'Where money came from',
                sub: 'By source, last 30 days',
                total: '$15,690.00',
                tone: 'in',
                rows: linked(SOURCES),
                rest: { amount: '$540.00' }
            };
        } else if (variant === 'content') {
            o = {
                title: 'Day by day',
                sub: 'What each coming day should bring.',
                body: NS.el('p', 'kit-list-box__msg', 'Monday: $4,120 expected.')
            };
        }
        if (state === 'busy') o.state = 'loading';
        if (state === 'empty') {
            o.total = '$0.00';
            o.rows = [];
            o.rest = null;
            o.emptyText = 'No money went out in these days.';
        }
        var box = window.Kit.listBox(o);
        if (state === 'hover' || state === 'focus') target(box.querySelectorAll('.kit-list-box__link')[1]);
        else target(box);
        var wrap = NS.el('div', 'uil-list-box');
        wrap.appendChild(box);
        return wrap;
    };

    // Kit.numberBox, Financials Insights' Money out box and its Summary, at
    // the width the picker drew them. Its control is the kit's in-page
    // switch. The unknown variant is a total the page does not know.
    var PAY_BY = [
        { value: 'payee', label: 'Payee' },
        { value: 'category', label: 'Category' },
        { value: 'store', label: 'Store' }
    ];
    R['surfaces__number-card'] = function (state, variant) {
        var K = window.Kit;
        var box;
        if (variant === 'summary') {
            box = K.numberBox({
                title: 'Summary',
                cells: [
                    { label: 'Transactions', value: '214' },
                    { label: 'Vendors paid', value: '18' },
                    { label: 'Needs category', value: '7' }
                ]
            });
        } else {
            var unknown = variant === 'unknown';
            box = K.numberBox({
                title: 'Money out',
                total: unknown ? null : '$12,319.95',
                control: K.inlineSwitch({ label: 'Group Money out by', full: true, options: PAY_BY, value: 'payee' })
                    .el,
                note: unknown ? 'Money out is not known for these days.' : 'Payees are ranked by what they were paid.'
            });
        }
        var wrap = NS.el('div', 'uil-number-box');
        wrap.appendChild(target(box));
        return wrap;
    };

    // Kit.sectionBox, a Settings section of setting rows (Kit.settingRow
    // with the picked switch), its action the small row button. Danger holds
    // the one red fill, the delete button; quiet is the placeholder.
    R['surfaces__section-box'] = function (state, variant) {
        var K = window.Kit;
        var box;
        if (variant === 'quiet') {
            box = K.sectionBox({ tone: 'quiet', note: 'Nothing to set here yet.' });
        } else if (variant === 'danger') {
            var del = NS.el('button', 'kit-danger-warning', 'Delete store');
            del.type = 'button';
            box = K.sectionBox({
                tone: 'danger',
                title: 'Delete this store',
                desc: 'Removes cameras, history and every saved clip. This cannot be undone.',
                body: K.settingRow({ label: 'Delete store', control: del }).el
            });
        } else {
            var test = NS.el('button', 'kit-btn kit-btn--small', 'Send a test');
            test.type = 'button';
            box = K.sectionBox({
                title: 'Alerts on this phone',
                desc: 'Who hears about a new incident, and how fast.',
                actions: test,
                body: [
                    K.settingRow({
                        label: 'Push alerts',
                        help: 'Sent the moment a clip is flagged.',
                        control: K.switch({ checked: true })
                    }).el,
                    K.settingRow({
                        label: 'Daily summary',
                        help: 'One email at 7 am.',
                        control: K.switch({ checked: false })
                    }).el
                ]
            });
        }
        var wrap = NS.el('div', 'uil-section-box');
        wrap.appendChild(target(box));
        return wrap;
    };

    /* ── Icons ───────────────────────────────────────────────────────── */

    // The bare icon (pick icons__icon-backing, Settings' glyphs): a glyph
    // with no tile behind it, in the kit's icon button, named by its
    // aria-label. Default to disabled are the button's own states. Word is
    // the same bare glyph inside a word button, as Settings Team's Invite
    // draws it (a plus in the kit's primary button).
    R['icons__icon-backing'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'word') {
            var w = kitButton('kit-btn kit-btn--primary', null, state);
            w.appendChild(K.glyph('plus', { size: 14 }));
            w.appendChild(document.createTextNode('Invite'));
            return w;
        }
        var b = kitButton('kit-icon', null, state);
        b.setAttribute('aria-label', 'Edit');
        b.appendChild(K.glyph('pen', { cls: 'kit-icon__glyph' }));
        return b;
    };

    // Kit.glyph (pick icons__line-style): the glyphs the kit's parts draw
    // most, at 16px in the ink. Sizes is one glyph at the three steps, set is
    // every name with its name under it, and filled is the one filled glyph,
    // the wine disc with its tick knocked out.
    var LINE_ROW = [
        'close',
        'back',
        'search',
        'chevronDown',
        'check',
        'plus',
        'calendar',
        'filter',
        'sliders',
        'alert',
        'info'
    ];
    function named(svg, words) {
        var item = NS.el('span', 'uil-glyph');
        item.appendChild(svg);
        item.appendChild(NS.el('span', 'uil-glyph__name', words));
        return item;
    }
    R['icons__line-style'] = function (state, variant) {
        var K = window.Kit;
        var box = NS.el('div', 'uil-glyphs');
        if (variant === 'sizes') {
            [14, 16, 20].forEach(function (size) {
                box.appendChild(named(K.glyph('sliders', { size: size }), size + 'px'));
            });
        } else if (variant === 'set') {
            box.classList.add('uil-glyphs--sheet');
            K.glyph.names.forEach(function (n) {
                box.appendChild(named(K.glyph(n), n));
            });
        } else if (variant === 'filled') {
            box.appendChild(named(K.glyph('checkCircle'), 'checkCircle'));
        } else {
            LINE_ROW.forEach(function (n) {
                box.appendChild(K.glyph(n));
            });
        }
        return box;
    };

    // Kit.logoLockup (pick icons__logo-lockup): the top bar's logo, a link
    // home. Nothing moves under the pointer or when pressed, as the source;
    // focus is the kit's shared ring.
    R['icons__logo-lockup'] = function () {
        return window.Kit.logoLockup({ href: '#' });
    };

    // Kit.standaloneMark (pick icons__standalone-mark): the boot screen's
    // mark on its own, named ARGUS. Loading is the busy mark, its red halo
    // breathing on a page; the library draws it still, as reduced motion
    // does, so the frame freezes it.
    R['icons__standalone-mark'] = function (state, variant) {
        var K = window.Kit;
        var mark = variant === 'loading' ? K.standaloneMark({ busy: true }) : K.standaloneMark({ label: 'ARGUS' });
        var box = NS.el('div', 'uil-mark');
        box.appendChild(target(mark));
        return box;
    };

    // Kit.statusDot (pick icons__status-dot): the flat dot beside its words,
    // with Settings' own words for each tone. Alone is a dot with no words,
    // named for a screen reader. Pulse is work in progress; its still twin is
    // how reduced motion draws it.
    var DOT_WORDS = {
        ok: 'Active',
        warn: 'Expired',
        bad: 'Offline',
        accent: 'Invited',
        muted: 'Removing',
        info: 'Under review'
    };
    R['icons__status-dot'] = function (state, variant) {
        var K = window.Kit;
        if (variant === 'alone') return K.statusDot({ tone: 'ok', label: 'Online' });
        if (variant === 'pulse' || variant === 'pulse-still') {
            return target(K.statusDot({ text: 'Reading the invoice', pulse: true }));
        }
        if (DOT_WORDS[variant]) return K.statusDot({ tone: variant, text: DOT_WORDS[variant] });
        return K.statusDot({ text: 'Not checked yet' });
    };

    /* ── People and media ────────────────────────────────────────────── */

    // ⛔ NO REAL PERSON AND NO REAL CAMERA. Every picture below is one of the
    // library's own stand-ins in assets/ui-library/: an empty aisle drawn
    // from flat shapes (a camera or clip frame), soft shapes on a gradient
    // (a photo) and a made-up mark (a logo). The one other picture is the
    // illustrated face the person picture draws by default, from the CC0 set
    // Employees ships (assets/avatars/), picked from a made-up id. Nothing
    // here points at evidence, at a tenant's storage or at a real photo.
    var PM = {
        scene: '/assets/ui-library/scene.svg',
        photo: '/assets/ui-library/photo.svg',
        logo: '/assets/ui-library/logo.svg'
    };

    // A file held over a drop target: the part's own dragenter handler sets
    // its drag-over look, as a real drag of a file does (a drag of words
    // would not light it up).
    function dragOver(node) {
        var e = new Event('dragenter', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files: [] } });
        node.dispatchEvent(e);
        return node;
    }

    // An illustrated face that did not load: the part's own error handler
    // takes it away and the initials under it show, as in the app.
    function faceFails(node) {
        var img = node.querySelector('img');
        if (img) img.dispatchEvent(new Event('error'));
        return node;
    }

    // Kit.cameraView (pick people-media__camera-tile, the Ops wall's
    // tile), one camera that opens when pressed. Default is live, busy is
    // still connecting; hover and focus land on a live one. The variants are
    // the other two things a camera can be doing, and one camera shown large.
    R['people-media__camera-tile'] = function (state, variant) {
        var o = { name: 'Aisle 4', state: 'live', src: PM.scene, onOpen: noop };
        if (state === 'busy') {
            o.state = 'connecting';
            o.src = null;
        }
        if (variant === 'snapshot') o.state = 'snapshot';
        if (variant === 'lost') {
            o.state = 'lost';
            o.src = null;
        }
        if (variant === 'large') o.large = true;
        var wrap = NS.el('div', 'uil-camera' + (variant === 'large' ? ' uil-camera--large' : ''));
        wrap.appendChild(target(window.Kit.cameraView(o).el));
        return wrap;
    };

    // Kit.clipThumb (pick people-media__clip-thumb, LP overview's recent
    // incidents): the frame is the button that plays the clip, beside the
    // row's words. Empty is a clip the retention schedule has pruned; still
    // is a frame with no clip to play.
    R['people-media__clip-thumb'] = function (state, variant) {
        var o = { src: PM.scene, label: 'Watch the clip from Aisle 4', onOpen: noop };
        if (state === 'empty') {
            o.src = null;
            o.label = 'Open the alert from Aisle 4';
        }
        if (variant === 'still') {
            o.playable = false;
            o.label = 'Open the alert from Aisle 4';
        }
        var row = NS.el('div', 'uil-clip-row');
        row.appendChild(target(window.Kit.clipThumb(o)));
        var words = NS.el('div', 'uil-clip-row__words');
        words.appendChild(NS.el('span', 'uil-clip-row__name', 'Aisle 4'));
        words.appendChild(NS.el('span', 'uil-clip-row__why', 'Someone put an item in a bag near the door.'));
        words.appendChild(NS.el('span', 'uil-clip-row__meta', 'Aisle · 12m ago'));
        row.appendChild(words);
        return row;
    };

    // Kit.largeStill (pick people-media__large-still, LP's dossier): default
    // is a log entry's photo and empty the same entry once its clip was
    // pruned. The variants are the dossier's other three: a clip picker's
    // frame (and one with no frame saved), the evidence still and the
    // upload preview.
    var STILL_SIZE = {
        clip: 'clip',
        'clip-empty': 'clip',
        evidence: 'evidence',
        upload: 'upload'
    };
    R['people-media__large-still'] = function (state, variant) {
        var K = window.Kit;
        var size = STILL_SIZE[variant] || 'entry';
        var o = { size: size, src: PM.scene, alt: 'Frame from the clip' };
        if (size === 'entry') {
            o.src = PM.photo;
            o.alt = 'Photo on this log entry';
        }
        if (size === 'evidence') o.alt = 'Evidence still from Aisle 4';
        if (size === 'upload') {
            o.src = PM.photo;
            o.alt = '';
        }
        if (state === 'empty') o.src = null;
        var still = target(K.largeStill(o));
        var wrap = NS.el('div', 'uil-still uil-still--' + size);
        wrap.appendChild(still);
        if (size === 'entry') {
            var words = NS.el('div', 'uil-still__words');
            words.appendChild(NS.el('span', 'uil-still__line', 'Took two energy drinks, left without paying.'));
            words.appendChild(NS.el('span', 'uil-still__meta', '6/20/2026 3:14 PM'));
            wrap.appendChild(words);
        } else if (size === 'clip') {
            wrap.appendChild(NS.el('span', 'uil-still__line', '6/20/2026 3:14 PM'));
            wrap.appendChild(NS.el('span', 'uil-still__meta', 'High · Sample Store'));
        } else if (size === 'upload') {
            wrap.appendChild(NS.el('span', 'uil-still__line', 'front-door.jpg'));
        }
        return wrap;
    };

    // Kit.logoItemSquare (pick people-media__logo-item-square, Settings >
    // Store): the store's initials, its logo, and a file held over it, each
    // beside the real button that opens a file picker.
    R['people-media__logo-item-square'] = function (state, variant) {
        var o = { name: 'Sample Store', onFile: noop };
        if (variant === 'logo') o.src = PM.logo;
        var field = window.Kit.logoItemSquare(o);
        var square = target(field.querySelector('.kit-logo-item-square'));
        if (variant === 'drop') dragOver(square);
        return field;
    };

    // Kit.personPicture (pick people-media__person-picture, Employees'
    // picture): default is the illustrated face, empty nobody named yet.
    // Initials is the face failing to load; sizes is the face at all four;
    // tints is the twelve pastels initials can take, one name on each.
    var TINT_NAMES = [
        'Sam Lin',
        'Ana Novak',
        'Sam Okafor',
        'Sam Patel',
        'Sam Silva',
        'Ana Silva',
        'Cara Patel',
        'Ana Diaz',
        'Sam Moreau',
        'Sam Hale',
        'Sam Kaur',
        'Ana Berg'
    ];
    R['people-media__person-picture'] = function (state, variant) {
        var K = window.Kit;
        if (state === 'empty') return K.personPicture({ name: '', size: 'lg' });
        if (variant === 'sizes' || variant === 'tints') {
            var row = NS.el('div', 'uil-pictures');
            if (variant === 'sizes') {
                ['sm', 'md', 'lg', 'xl'].forEach(function (size) {
                    row.appendChild(K.personPicture({ name: 'Sam Patel', id: 'emp-0042', size: size }));
                });
            } else {
                TINT_NAMES.forEach(function (name) {
                    row.appendChild(faceFails(K.personPicture({ name: name, id: name, size: 'lg' })));
                });
            }
            target(row.firstElementChild);
            return row;
        }
        var o = { name: 'Sam Patel', id: 'emp-0042', size: 'lg' };
        if (variant === 'photo') o.photo = PM.photo;
        var pic = K.personPicture(o);
        return variant === 'initials' ? faceFails(pic) : pic;
    };

    // Kit.profilePhoto (pick people-media__profile-photo, Settings > You):
    // the initials in the accent tint, a photo, and a file held over it,
    // each beside the real button that opens a file picker.
    R['people-media__profile-photo'] = function (state, variant) {
        var o = { name: 'Sam Patel', onFile: noop };
        if (variant === 'photo') o.photo = PM.photo;
        var field = window.Kit.profilePhoto(o);
        var photo = target(field.querySelector('.kit-profile-photo'));
        if (variant === 'drop') dragOver(photo);
        return field;
    };

    /* ── History, show more, key hints and copy ──────────────────────── */

    // Kit.copyBox (pick history__copy-box, Settings' new API key): a made-up
    // key in the mono box beside its Copy button, at the width the key's
    // dialog gives them. Hover, focus and pressed are the button's; key
    // focus is keyboard focus on the key itself. Copied and blocked are
    // drawn held, as a press leaves them for two seconds.
    var SAMPLE_KEY = 'ak_live_sample_0000_not_a_real_key_0000';
    R['history__copy-box'] = function (state, variant) {
        var o = { text: SAMPLE_KEY, textLabel: 'The new API key', words: 'Copy key' };
        if (variant === 'done' || variant === 'failed') o.state = variant;
        var box = window.Kit.copyBox(o);
        target(box.querySelector(variant === 'key-focus' ? '.kit-copy-box__text' : '.kit-copy-box__btn'));
        var wrap = NS.el('div', 'uil-copy');
        wrap.appendChild(box);
        return wrap;
    };

    // Kit.copyIcon (pick history__copy-icon, Financials' trend note): the
    // icon waiting in its note, over the note's top right corner. At rest it
    // is out of sight; the note under the pointer shows it. Hover, focus and
    // pressed are the icon's own, with the note under the pointer too, as it
    // is whenever a pointer is on the icon; the ring is read off the icon.
    // Copied is the check. Always in sight is the icon with no note to wait
    // for (reveal off).
    var NOTE_WORDS =
        'Spending was $9,850 this month, 6% less than last month. Inventory purchases were the biggest share.';
    R['history__copy-icon'] = function (state, variant) {
        var K = window.Kit;
        var alone = variant === 'alone';
        var icon = K.copyIcon({
            text: 'Money out. ' + NOTE_WORDS,
            label: 'Copy section',
            reveal: !alone,
            state: variant === 'done' ? 'done' : null
        });
        var btn = icon.querySelector('.kit-copy-icon__btn');
        btn.setAttribute('data-uil-ring', '');
        if (alone) {
            target(btn);
            return icon;
        }
        var note = NS.el('section', 'uil-note');
        note.appendChild(K.glyph('down', { size: 14, cls: 'uil-note__glyph' }));
        var main = NS.el('div', 'uil-note__main');
        main.appendChild(NS.el('h3', 'uil-note__title', 'Money out'));
        main.appendChild(NS.el('p', 'uil-note__body', NOTE_WORDS));
        note.appendChild(main);
        note.appendChild(icon);
        // The note is under the pointer in every cell but the resting one;
        // the icon's own states land on the icon as well. At rest the icon
        // is the part, so its ring is held against the icon itself.
        if (state !== 'default' || variant) target(note);
        if (!variant) target(btn);
        // The frame looks for targets inside what a renderer returns, so the
        // note sits in a plain holder rather than being the root itself.
        var holder = NS.el('div', 'uil-note-host');
        holder.appendChild(note);
        return holder;
    };

    // Kit.foldOpen (pick history__fold-open, Financials Transactions' month
    // strip): the chevron at the end of the strip, the graphs it opens under
    // it. Open shows the section; the button stays bare.
    R['history__fold-open'] = function (state) {
        var panel = NS.el('div', 'uil-fold__panel');
        panel.appendChild(NS.el('p', 'uil-fold__words', 'Top spending in June'));
        var btn = window.Kit.foldOpen({
            label: 'Graphs',
            panel: panel,
            open: state === 'open',
            disabled: state === 'disabled'
        });
        var strip = NS.el('div', 'uil-fold__strip');
        strip.appendChild(NS.el('span', 'uil-fold__fig', 'Money in $12,400'));
        strip.appendChild(NS.el('span', 'uil-fold__fig', 'Money out $9,850'));
        strip.appendChild(target(btn));
        var box = NS.el('div', 'uil-fold');
        box.appendChild(strip);
        box.appendChild(panel);
        return box;
    };

    // Kit.showMore (pick history__show-more, Settings > Loss Prevention >
    // Staff recognition): the words under the section's lead, and open, the
    // steps they show, as the source's panel draws them (a Kit.table).
    var RECOGNITION_STEPS = [
        { label: 'Recognition turned on for the store', status: ['On', 'warn'] },
        { label: 'Employee releases recorded', status: ['3 of 14', 'mut'] },
        { label: 'Employee photos added', status: ['Done', 'ok'] }
    ];
    R['history__show-more'] = function (state) {
        var K = window.Kit;
        var panel = NS.el('div', 'uil-more__panel');
        panel.appendChild(
            K.table({
                columns: [
                    { key: 'label', label: 'Step' },
                    {
                        key: 'status',
                        label: 'Status',
                        align: 'right',
                        render: function (r) {
                            return K.pill(r.status[0], r.status[1]);
                        }
                    }
                ],
                rows: RECOGNITION_STEPS
            })
        );
        var btn = K.showMore({
            words: 'Show every step',
            openWords: 'Hide the steps',
            panel: panel,
            open: state === 'open',
            disabled: state === 'disabled'
        });
        var box = NS.el('div', 'uil-more');
        box.appendChild(NS.el('h3', 'uil-more__title', 'Staff recognition'));
        box.appendChild(NS.el('p', 'uil-more__lead', 'Tell staff apart from shoppers so they never trigger alerts.'));
        var row = NS.el('div', 'uil-more__row');
        row.appendChild(target(btn));
        box.appendChild(row);
        box.appendChild(panel);
        return box;
    };

    // Kit.historyList (pick history__history-list, an LP alert's history):
    // five made-up steps on the fixed day, newest first, each at a fixed
    // time, each dot in LP's colour for it: under review and opened are the
    // history's blue. Empty is an alert nobody has touched yet.
    var HISTORY = [
        {
            what: 'Confirmed theft',
            who: 'Sam Reviewer',
            at: '2026-06-20T13:42',
            when: '2 hours ago',
            tone: 'bad',
            note: 'Matched the register log: no sale at 3:42 pm.'
        },
        { what: 'Escalated', who: 'Alex Manager', at: '2026-06-20T12:40', when: '3 hours ago', tone: 'warn' },
        { what: 'Under review', who: 'Sam Reviewer', at: '2026-06-20T11:38', when: '4 hours ago', tone: 'info' },
        {
            what: 'Not theft',
            who: 'Jo Lead',
            at: '2026-06-20T09:05',
            when: '6 hours ago',
            note: 'Customer paid at the other till.'
        },
        { what: 'Opened', who: 'system', at: '2026-06-20T08:51', when: '7 hours ago', tone: 'info' }
    ];
    R['history__history-list'] = function (state) {
        var list = window.Kit.historyList({
            title: 'History',
            level: 3,
            items: state === 'empty' ? [] : HISTORY,
            emptyText: 'Nothing has happened to this alert yet.'
        });
        var sheet = NS.el('div', 'uil-history');
        sheet.appendChild(target(list));
        return sheet;
    };

    // Kit.keyHints (pick history__key-hint, the search window's footer), on
    // the footer's own ground. AI on adds the Ask AI hint; alone is one
    // keycap with no words, as the pop-up search's esc draws it.
    var KEYS = [
        { keys: '↑↓', words: 'Navigate' },
        { keys: '↵', words: 'Open' },
        { keys: '⌘↵', words: 'Ask AI', ai: true },
        { keys: 'esc', words: 'Close' }
    ];
    R['history__key-hint'] = function (state, variant) {
        var K = window.Kit;
        var foot = NS.el('div', 'uil-keys');
        if (variant === 'alone') {
            foot.appendChild(target(K.keyHint({ keys: 'esc' })));
            return foot;
        }
        var hints = KEYS.filter(function (k) {
            return variant === 'ai' || !k.ai;
        });
        foot.appendChild(target(K.keyHints(hints)));
        return foot;
    };

    /* ── Toolbars, drop zones and inline notes ───────────────────────── */

    // Kit.fileDrop (pick bars__file-drop, Inventory's Scan an invoice
    // window), drawn in Inventory's colour. Hover and focus land on the
    // well; drop is a file held over it, through its own handler; error is
    // a file it refused, said under it; disabled is the well switched off.
    R['bars__file-drop'] = function (state, variant) {
        var d = window.Kit.fileDrop({
            title: 'Drop invoices here',
            hint: 'One file or a whole stack · PDF, photo (PNG/JPG/WEBP) · up to 15MB each',
            accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp',
            disabled: state === 'disabled',
            onFiles: noop
        });
        var well = target(d.el.querySelector('.kit-file-drop__well'));
        if (variant === 'drop') dragOver(well);
        if (state === 'error') d.refuse('That file type cannot be scanned. Use a PDF or a photo (PNG, JPG, WEBP).');
        var box = NS.el('div', 'uil-file-drop');
        box.appendChild(d.el);
        return box;
    };

    // Kit.listToolbar (pick bars__list-toolbar, Financials Transactions'
    // bar), holding the kit's own parts: the search field, the in-page
    // switch, the dates button and three filter buttons (Export is one with
    // no pop-out). Hover lands on Filters, focus on the search box; selected
    // is Money in chosen (the switch's own chosen look); open is View while
    // its pop-out is up. In use: Money out, a filter chip with its x,
    // Filters (1) and Export filtered.
    var DIRECTIONS = [
        { value: 'all', label: 'All' },
        { value: 'in', label: 'Money in' },
        { value: 'out', label: 'Money out' }
    ];
    R['bars__list-toolbar'] = onFixedDay(function (state, variant) {
        var K = window.Kit;
        var t = today();
        var inUse = variant === 'in-use';
        var empty = function () {
            return NS.el('div');
        };
        var search = K.searchField({ placeholder: 'Search by name', label: 'Search transactions by name' });
        var dir = K.inlineSwitch({
            label: 'Show',
            options: DIRECTIONS,
            value: inUse ? 'out' : state === 'selected' ? 'in' : 'all'
        });
        var dates = K.rangeButton({ from: iso(addDays(t, -19)), to: iso(t), label: 'Jun 1–Today' });
        var filters = K.filterButton({
            label: inUse ? 'Filters (1)' : 'Filters',
            icon: 'filter',
            on: inUse,
            content: empty
        });
        var view = K.filterButton({ label: 'View', icon: 'sliders', popLabel: 'How the list looks', content: empty });
        var exp = K.filterButton({ label: inUse ? 'Export filtered' : 'Export', icon: 'download', onClick: noop });
        var tags = inUse
            ? [
                  K.filterChip({
                      label: 'Needs a category',
                      chevron: false,
                      active: true,
                      onClear: noop,
                      clearLabel: 'Remove Needs a category'
                  })
              ]
            : [];
        var bar = K.listToolbar({ start: [search, dir.el], tags: tags, end: [dates, filters, view], apart: exp });
        if (state === 'hover') target(filters);
        else if (state === 'focus') target(search.querySelector('.kit-search-field__input'));
        else if (state === 'selected') target(dir.el.querySelector('[aria-checked="true"]'));
        else if (state === 'open') {
            target(view);
            view.setAttribute('aria-expanded', 'true');
        }
        var wide = NS.el('div', 'uil-toolbar');
        wide.appendChild(bar.el);
        return wide;
    });

    // Kit.photoPicker (pick bars__photo-picker, the Account page's photo):
    // the person's illustrated face, beside their name and email. Hover and
    // focus are the veil, a real button; the variants are a photo of their
    // own and the initials a face that did not load leaves.
    R['bars__photo-picker'] = function (state, variant) {
        var o = { name: 'Sam Rivera', id: 'emp-0042', onFile: noop };
        if (variant === 'photo') o.photo = PM.photo;
        var picker = window.Kit.photoPicker(o);
        if (variant === 'initials') faceFails(picker);
        target(picker.querySelector('.kit-photo-picker__veil'));
        var row = NS.el('div', 'uil-identity');
        row.appendChild(picker);
        var words = NS.el('div', 'uil-identity__words');
        words.appendChild(NS.el('span', 'uil-identity__name', 'Sam Rivera'));
        words.appendChild(NS.el('span', 'uil-identity__mail', 'sam@example.com'));
        row.appendChild(words);
        return row;
    };

    // Kit.saveNote (pick bars__save-note, Settings' save note), in the
    // setting row that draws it. Default is idle (nothing); busy is saving;
    // error is a failed save with Retry, which hover and focus land on. The
    // variants: saved (held, as the library holds every timed look), the
    // fade's end, and a refusal with no Retry.
    R['bars__save-note'] = function (state, variant) {
        var row = window.Kit.settingRow({
            label: 'Email me about new alerts',
            help: 'One email per alert, sent to the address on your profile.',
            control: window.Kit.switch({ checked: true })
        });
        var note = row.note.el;
        if (state === 'busy') row.saving();
        else if (state === 'error' || state === 'hover' || state === 'focus') row.error(null, noop);
        else if (variant === 'saved' || variant === 'fading') {
            held(function () {
                row.saved();
            });
            if (variant === 'fading') note.dataset.state = 'fading';
        } else if (variant === 'refused') row.refused('Only an admin can change this.');
        if (state === 'hover' || state === 'focus') target(note.querySelector('.kit-save-note__retry'));
        else if (state !== 'default' || variant) target(note);
        var box = NS.el('div', 'uil-rows');
        box.appendChild(row.el);
        return box;
    };

    // Kit.selectionBar (pick bars__selection-bar, Financials' bulk bar),
    // five rows ticked, on a stage the island rises over. Hover lands on
    // Categorize, focus on Export selected, pressed on Clear. Busy is the
    // bar while it books; the variant is a selection with no row to book.
    var SELECTION_ACTS = [
        { key: 'categorize', label: 'Categorize', onClick: noop },
        { key: 'export', label: 'Export selected', onClick: noop },
        { key: 'clear', label: 'Clear', onClick: noop }
    ];
    R['bars__selection-bar'] = function (state, variant) {
        // announce: false, the bar's own way to write its count at once: in
        // the app the words go in a moment after the bar comes up, so a
        // screen reader hears them; a cell is a picture, not news.
        var b = window.Kit.selectionBar({ label: 'Selected transactions', announce: false });
        b.show(5, variant === 'no-book' ? SELECTION_ACTS.slice(1) : SELECTION_ACTS);
        if (state === 'busy') b.busy('Booking 2 of 5…');
        var acts = b.el.querySelectorAll('.kit-everyday');
        if (state === 'hover') target(acts[0]);
        else if (state === 'focus') target(acts[1]);
        else if (state === 'pressed') target(acts[2]);
        var stage = NS.el('div', 'uil-dock');
        stage.appendChild(b.el);
        return stage;
    };

    // Kit.undo (pick bars__undo, Settings > Quiet time), in the card's
    // footer beside the schedule's summary. The offer is held (it goes after
    // eight seconds in the app); none is nothing to undo.
    R['bars__undo'] = function (state, variant) {
        var u = window.Kit.undo({ timeout: 0 });
        if (variant !== 'none') {
            u.offer('Cleared your quiet hours.', noop);
            target(u.el.querySelector('.kit-undo__btn'));
        }
        var foot = NS.el('div', 'uil-foot');
        foot.appendChild(NS.el('span', 'uil-foot__summary', 'Quiet every night from 11 PM to 6 AM.'));
        foot.appendChild(u.el);
        return foot;
    };

    /* ── Sliders, video players and scrollbars ───────────────────────── */

    // ⛔ NO REAL FOOTAGE. The video is the library's own stand-in beside the
    // pictures above: twelve seconds of the empty aisle (scene.svg), drawn
    // from flat shapes and encoded here, nothing recorded. Nothing below
    // points at evidence, at a tenant's storage or at a real clip.
    var SV = { video: '/assets/ui-library/scene.webm' };

    // A look that needs the part laid out (how far a row is scrolled) is
    // set once the cell is on the page: the frame appends every cell before
    // this runs.
    function onPage(fn) {
        Promise.resolve().then(fn);
    }

    // kit-scrollbar (pick sliders__scrollbar, the View options scroll area):
    // the list of layouts in a box too short for it, so the quiet pill
    // shows. A scrollbar cannot be forced into hover or a drag, and the
    // source draws neither, so default is its one state.
    var LAYOUTS = [
        ['Auto', 'Fits your camera count'],
        ['2 × 2', 'Four cameras'],
        ['3 × 3', 'Nine cameras'],
        ['4 × 4', 'Sixteen cameras'],
        ['Spotlight', 'One big, rest below'],
        ['Sidebar', 'One big, rest at right'],
        ['Single', 'One camera at a time']
    ];
    R['sliders__scrollbar'] = function () {
        var box = NS.el('div', 'uil-scroll-box');
        box.appendChild(NS.el('div', 'uil-scroll-box__head', 'View options'));
        var scroll = target(NS.el('div', 'kit-scrollbar uil-scroll-box__list'));
        LAYOUTS.forEach(function (l) {
            var row = NS.el('div', 'uil-scroll-box__row');
            row.appendChild(NS.el('span', 'uil-scroll-box__name', l[0]));
            row.appendChild(NS.el('span', 'uil-scroll-box__sub', l[1]));
            scroll.appendChild(row);
        });
        box.appendChild(scroll);
        return box;
    };

    // Kit.sidewaysScroll (pick sliders__sideways-scroll, the page tab row's
    // hidden bar): a row of tags too long for its cell, which takes focus
    // itself because nothing in it can. Scrolled is the same row part way
    // along; buttons is a row of buttons, which Tab reaches one by one, so
    // the row takes no focus of its own.
    var AISLES = ['Groceries', 'Snacks', 'Drinks', 'Frozen', 'Household', 'Tobacco', 'Lottery', 'Deli', 'Bakery'];
    var TEAM = ['Everyone', 'Admins', 'Managers', 'Staff', 'Invited', 'Removed'];
    R['sliders__sideways-scroll'] = function (state, variant) {
        var K = window.Kit;
        var row;
        if (variant === 'buttons') {
            row = K.sidewaysScroll({
                label: 'Who to show',
                items: TEAM.map(function (w) {
                    var b = NS.el('button', 'kit-btn kit-btn--small', w);
                    b.type = 'button';
                    return b;
                })
            });
        } else {
            row = K.sidewaysScroll({
                label: 'Aisles',
                items: AISLES.map(function (w) {
                    return K.plainTag(w);
                })
            });
        }
        target(row);
        if (variant === 'scrolled') {
            onPage(function () {
                row.scrollLeft = Math.max(0, (row.scrollWidth - row.clientWidth) / 2);
            });
        }
        var wrap = NS.el('div', 'uil-sideways');
        wrap.appendChild(row);
        return wrap;
    };

    // Kit.slider (pick sliders__slider, the clip review's seek bar), on its
    // own dark strip: 0:12 of a 0:30 clip, all of it loaded. Hover,
    // focus and pressed land on the bar (pressed is a drag, further along);
    // empty is a clip that did not load. Loading is part of the clip still
    // to come in, the lighter part.
    R['sliders__slider'] = function (state, variant) {
        var s = window.Kit.slider({
            label: 'Seek',
            max: 30,
            value: state === 'pressed' ? 16.5 : 12,
            buffer: variant === 'loading' ? 20 : 30,
            onInput: noop
        });
        target(s.el.querySelector('.kit-slider__bar'));
        if (state === 'empty') s.fail();
        var wide = NS.el('div', 'uil-seek');
        wide.appendChild(s.el);
        return wide;
    };

    // Kit.videoPlayer (pick sliders__video-player, LP's dossier video): the
    // stand-in clip in the kit's frame, paused at the start. Focus is the
    // frame's; the browser's own controls cannot be forced, so they show as
    // they are at rest in every cell. Error is a video that did not
    // load, through its own handler. Mid is the clip paused at 0:04, which
    // the browser's controls show once it has loaded.
    R['sliders__video-player'] = function (state, variant) {
        var p = window.Kit.videoPlayer({ src: SV.video, poster: PM.scene, label: 'Evidence video' });
        var video = p.querySelector('video');
        if (video) target(video);
        if (state === 'error' && video) video.dispatchEvent(new Event('error'));
        else if (variant === 'mid' && video) {
            video.preload = 'auto';
            var park = function () {
                var s = video.seekable;
                if (video.currentTime >= 4 || !s || !s.length || s.end(s.length - 1) < 4) return;
                video.currentTime = 4;
            };
            ['loadedmetadata', 'canplaythrough', 'progress', 'suspend'].forEach(function (ev) {
                video.addEventListener(ev, park);
            });
        }
        var box = NS.el('div', 'uil-video-player');
        box.appendChild(p);
        return box;
    };

    /* ── Charts ──────────────────────────────────────────────────────── */

    // Every chart is drawn by its home module, never by a copy: Financials'
    // four are window.FinCharts (js/financials/charts.js, painted by
    // css/financials-charts.css), the card's is Kit.balance, and the stock
    // health bar is Inventory's own healthBand. The figures are made up: six
    // months of a store's money up to the library's fixed day (2026-06-20),
    // with vendors and sources nobody owns. Nothing is read from any store,
    // account or API.
    var cents = function (d) {
        return Math.round(d * 100);
    };
    var CH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    function chBuckets() {
        return CH_MONTHS.map(function (m, i) {
            return { label: m, from: '2026-0' + (i + 1) + '-01' };
        });
    }
    // Money out by vendor, in dollars, a month to each column.
    var CH_OUT = [
        { key: 'grocer', label: 'Wholesale grocer', v: [47634.68, 57210.12, 66402.9, 59867.48, 54120.33, 51288.07] },
        { key: 'payroll', label: 'Payroll', v: [30822.44, 33410.0, 43118.52, 35596.88, 33902.1, 29870.64] },
        { key: 'rent', label: 'Rent', v: [19614.28, 20100.0, 22652.56, 22652.56, 22652.56, 16200.0] },
        { key: 'snacks', label: 'Snack distributor', v: [16812.24, 14990.37, 12780.66, 19416.48, 14003.91, 9870.25] },
        { key: 'other', label: 'Everything else', v: [25218.36, 27845.19, 51230.4, 24270.6, 33470.85, 25904.13] }
    ];
    // Money in by source, the same months.
    var CH_IN = [
        { key: 'fuel', label: 'Fuel', v: [85380.2, 93497.11, 94973.27, 100894.04, 98496.12, 89091.75] },
        { key: 'inside', label: 'Inside sales', v: [54189.48, 59334.7, 60271.5, 64028.91, 62507.15, 56539.0] },
        { key: 'untagged', label: 'Not itemized', v: [14778.95, 16182.19, 16437.68, 17462.43, 17047.41, 15419.72] },
        { key: 'tax', label: 'Sales tax', v: [9861.92, 10788.13, 10958.45, 11641.62, 11364.94, 10279.81] }
    ];
    function chMonthTotal(rows, i) {
        return rows.reduce(function (a, r) {
            return a + r.v[i];
        }, 0);
    }
    function chSum(r) {
        return r.v.reduce(function (a, v) {
            return a + v;
        }, 0);
    }

    // FinCharts hands each chart's hover tip to <body>, fixed to the window
    // (charts.js makeTip). The library's page of charts is taller than its
    // window and scrolls, so a fixed tip would stay put while its chart moved
    // away. The library keeps the tips in one layer laid over the whole page
    // (.uil-tips, css/ui-library.css, which a fixed tip is placed against)
    // and moves the place the module works out in the window onto the page,
    // each time the module sets it. The tip itself is the module's.
    function chTipLayer() {
        var layer = document.querySelector('body > .uil-tips');
        if (!layer) {
            layer = NS.el('div', 'uil-tips');
            document.body.appendChild(layer);
        }
        return layer;
    }
    function chOwnTip(tip) {
        chTipLayer().appendChild(tip);
        var mine = null;
        function toPage() {
            var l = tip.style.left;
            var t = tip.style.top;
            if (!l || !t || (mine && mine[0] === l && mine[1] === t)) return;
            var x = window.scrollX || window.pageXOffset || 0;
            var y = window.scrollY || window.pageYOffset || 0;
            mine = [Math.round(parseFloat(l) + x) + 'px', Math.round(parseFloat(t) + y) + 'px'];
            tip.style.left = mine[0];
            tip.style.top = mine[1];
        }
        if (typeof window.MutationObserver === 'function') {
            new window.MutationObserver(toPage).observe(tip, { attributes: true, attributeFilter: ['style'] });
        }
        return toPage;
    }
    // The module keeps a tip inside the window: it pulls its top up to the
    // window's floor (charts.js makeTip). A cell further down the library's
    // page than one window would have its tip pulled away from its column,
    // so while the library puts the pointer or the keyboard on a chart the
    // window reads as tall as the page, as a screenshot of the page sees it.
    function chTallWindow(fn) {
        var had = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        var tall = (document.documentElement.scrollHeight || 0) + (window.innerHeight || 0);
        var set = false;
        try {
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                get: function () {
                    return tall;
                }
            });
            set = true;
        } catch (err) {
            /* a window that will not take it draws the tip where the module puts it */
        }
        try {
            return fn();
        } finally {
            if (set) {
                if (had) Object.defineProperty(window, 'innerHeight', had);
                else delete window.innerHeight;
            }
        }
    }
    // A real pointer move over one mark, through the module's own handler.
    function chPoint(node) {
        var r = node.getBoundingClientRect();
        var E = typeof window.PointerEvent === 'function' ? window.PointerEvent : window.MouseEvent;
        node.dispatchEvent(
            new E('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })
        );
        return node;
    }
    function chKey(node, key) {
        node.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
    }

    // A Financials chart in its skin (the page's .mod-skin > .fin-frame),
    // mounted once it is on the page, because the module measures the width
    // it is given. `drive(host)` then puts the pointer or the keyboard on it
    // and hands back the element that takes the state.
    function finChart(kind, data, drive) {
        var skin = NS.el('div', 'mod-skin uil-fin');
        var frame = NS.el('div', 'fin-frame');
        var host = NS.el('div', 'uil-fin__host');
        frame.appendChild(host);
        skin.appendChild(frame);
        NS.onDrawn(function () {
            var before = Array.prototype.slice.call(document.querySelectorAll('body > .fin-tip'));
            window.FinCharts[kind](host, data);
            var tip = Array.prototype.filter.call(document.querySelectorAll('body > .fin-tip'), function (t) {
                return before.indexOf(t) < 0;
            })[0];
            var toPage = tip ? chOwnTip(tip) : null;
            var at = drive
                ? chTallWindow(function () {
                      return drive(host);
                  })
                : null;
            target(at || host.querySelector('.fin-chart'));
            if (toPage) toPage();
        });
        return skin;
    }
    function chHit(host, i) {
        chPoint(host.querySelector('.fin-chart__svg [data-hit="' + i + '"]'));
        return null;
    }
    // Keyboard focus: the chart takes the real focus, which is what draws
    // the module's own ring (:focus-visible) and opens its first column.
    // Only one element on a page can hold focus, and a frame inside the
    // library page must not take it on load: that would pull the page's own
    // focus into a frame (a keyboard in the list would land there) and make
    // the two frames fight for it. So a frame takes real focus only when it
    // stands alone (as the local check opens it). Inside the library page the
    // chart gets the module's own focus handler, which opens its first
    // column and its tip, and takes the real focus, and with it the ring,
    // once the pointer comes into its frame (NS.refocus, called by shell.js).
    NS.standalone = function () {
        return window.top === window;
    };
    var focusCharts = [];
    function chFocus(host, steps) {
        var svg = host.querySelector('.fin-chart__svg');
        if (NS.standalone()) svg.focus({ preventScroll: true });
        else svg.dispatchEvent(new FocusEvent('focus'));
        for (var i = 0; i < (steps || 0); i++) chKey(svg, 'ArrowRight');
        focusCharts.push(svg);
        return svg;
    }
    // The pointer came into this frame: its focus cell takes the real focus.
    // The column the keyboard opened stays open (the module opens its first
    // column on focus only when none is open).
    NS.refocus = function () {
        focusCharts = focusCharts.filter(function (svg) {
            return svg.isConnected;
        });
        var svg = focusCharts[focusCharts.length - 1];
        if (!svg || document.activeElement === svg) return false;
        svg.focus({ preventScroll: true });
        return document.activeElement === svg;
    };
    function chToggle(host, key) {
        host.querySelector('.fin-legend__item[data-key="' + key + '"]').click();
        return null;
    }

    // FinCharts.stacked, money out by vendor: Wholesale grocer, Payroll, Rent
    // and Snack distributor take the four named colours and Everything else
    // the fifth. Hover is April under the pointer, its grey band and the
    // tip with every vendor and the total; focus is the chart with the
    // keyboard on it, January open. All cashflow stacks money in up and
    // money out down. A vendor toggled off is the legend's own button,
    // clicked. Unavailable is money in not known. The grammar cell is the
    // library's: what every chart shares, from the kit's chart tokens.
    function stackedData(dir) {
        var groups = dir === 'all' ? CH_IN : CH_OUT;
        var buckets = chBuckets().map(function (b, i) {
            var values = {};
            groups.forEach(function (g) {
                values[g.key] = cents(g.v[i]);
            });
            if (dir === 'all') values.other = -cents(chMonthTotal(CH_OUT, i));
            return Object.assign(b, { values: values });
        });
        var list = groups.map(function (g) {
            return { key: g.key, label: g.label };
        });
        if (dir === 'all') list.push({ key: 'other', label: 'Money out' });
        return { buckets: buckets, groups: list, direction: dir };
    }
    R['charts__bar-chart'] = function (state, variant) {
        if (variant === 'grammar') return chartGrammar();
        if (variant === 'all') return finChart('stacked', stackedData('all'));
        if (variant === 'unknown') {
            return finChart('stacked', {
                buckets: chBuckets().map(function (b) {
                    return Object.assign(b, { values: { fuel: null, inside: null, untagged: null, tax: null } });
                }),
                groups: CH_IN.map(function (g) {
                    return { key: g.key, label: g.label };
                }),
                direction: 'in',
                reason: 'Register sales are not connected, so money in is not known.'
            });
        }
        var data = stackedData('out');
        if (variant === 'off') {
            return finChart('stacked', data, function (host) {
                return chToggle(host, 'grocer');
            });
        }
        if (state === 'hover') {
            return finChart('stacked', data, function (host) {
                return chHit(host, 3);
            });
        }
        if (state === 'focus') {
            return finChart('stacked', data, function (host) {
                return chFocus(host, 0);
            });
        }
        return finChart('stacked', data);
    };

    // The chart grammar, the one thing the charts share (owner: charts stay
    // different; the font, the text and the axis are the same): the axis and
    // grid hairlines, the 13px labels in the chart font and the hover tip,
    // each drawn from its kit token (--kit-chart-*) and nothing else. No
    // chart uses these tokens yet; moving them onto them is later work.
    function chartGrammar() {
        var box = NS.el('div', 'uil-grammar');
        var plot = NS.el('div', 'uil-grammar__plot');
        ['$150K', '$100K', '$50K', '0'].forEach(function (t, i) {
            var line = NS.el('div', 'uil-grammar__line' + (i === 3 ? ' uil-grammar__line--axis' : ''));
            line.style.top = i * 64 + 'px';
            line.appendChild(NS.el('span', 'uil-grammar__y', t));
            plot.appendChild(line);
        });
        var cross = NS.el('div', 'uil-grammar__cross');
        plot.appendChild(cross);
        var tip = NS.el('div', 'uil-grammar__tip');
        tip.appendChild(NS.el('div', 'uil-grammar__tip-head', 'Apr'));
        [
            ['Money in', '$194,027.00'],
            ['Money out', '−$161,804.00']
        ].forEach(function (r) {
            var row = NS.el('div', 'uil-grammar__tip-row');
            row.appendChild(NS.el('span', null, r[0]));
            row.appendChild(NS.el('span', 'uil-grammar__tip-v', r[1]));
            tip.appendChild(row);
        });
        plot.appendChild(tip);
        box.appendChild(plot);
        var xs = NS.el('div', 'uil-grammar__xs');
        CH_MONTHS.forEach(function (m) {
            xs.appendChild(NS.el('span', 'uil-grammar__x', m));
        });
        box.appendChild(xs);
        var key = NS.el('dl', 'uil-grammar__key');
        [
            ['Labels', '--kit-chart-font, --kit-chart-label-size'],
            ['Axis and hover line', '--kit-chart-axis'],
            ['Grid', '--kit-chart-grid'],
            ['Tip', '--kit-chart-tip-ground, --kit-chart-tip-ink, --kit-chart-tip-line']
        ].forEach(function (r) {
            key.appendChild(NS.el('dt', null, r[0]));
            key.appendChild(NS.el('dd', null, r[1]));
        });
        box.appendChild(key);
        return target(box);
    }

    // FinCharts.line, cashflow: money in above zero, money out mirrored
    // below it, a dot on every month. Hover is April; focus is the keyboard
    // on the chart and one step right, February. Busy is the dotted field
    // alone; empty is a measured zero with its sentence over it. One
    // direction is money in alone; a series toggled off is Money out's own
    // legend button, clicked.
    function lineData(mode) {
        var series = [
            {
                key: 'in',
                label: 'Money In',
                tone: 'revenue',
                values: CH_MONTHS.map(function (m, i) {
                    return mode === 'zero' ? 0 : cents(chMonthTotal(CH_IN, i));
                })
            }
        ];
        if (mode !== 'in') {
            series.push({
                key: 'out',
                label: 'Money Out',
                tone: 'spend',
                negate: true,
                values: CH_MONTHS.map(function (m, i) {
                    return mode === 'zero' ? 0 : cents(chMonthTotal(CH_OUT, i));
                })
            });
        }
        return {
            buckets: chBuckets(),
            series: series,
            direction: mode === 'in' ? 'in' : 'all',
            emptyText: 'Nothing came in or went out in this period.'
        };
    }
    R['charts__trend-chart'] = function (state, variant) {
        if (variant === 'in') return finChart('line', lineData('in'));
        if (variant === 'off') {
            return finChart('line', lineData('all'), function (host) {
                return chToggle(host, 'out');
            });
        }
        if (state === 'busy') return finChart('line', Object.assign(lineData('all'), { state: 'loading' }));
        if (state === 'empty') return finChart('line', lineData('zero'));
        if (state === 'hover') {
            return finChart('line', lineData('all'), function (host) {
                return chHit(host, 3);
            });
        }
        if (state === 'focus') {
            return finChart('line', lineData('all'), function (host) {
                return chFocus(host, 1);
            });
        }
        return finChart('line', lineData('all'));
    };

    // FinCharts.sankey, all cashflow: four sources flow into Money in, the
    // money out leaves it for Expenses and fans out to the vendors. Hover is
    // Inside sales under the pointer, lit, the rest dimmed, with its tip.
    // Error is a read that failed, the plate and Try again. The variants are
    // money out alone, money in alone, a half-year that lost money (a
    // Shortfall source makes up the rest) and money in not known (money out
    // alone and why).
    function flowData(mode) {
        var sources = CH_IN.map(function (s) {
            return { label: s.label, cents: cents(chSum(s)) };
        });
        var sinks = CH_OUT.map(function (s) {
            return { label: s.label, cents: cents(chSum(s)) };
        });
        var inTotal = sources.reduce(function (a, s) {
            return a + s.cents;
        }, 0);
        var outTotal = sinks.reduce(function (a, s) {
            return a + s.cents;
        }, 0);
        if (mode === 'out') return { sinks: sinks, total: outTotal, direction: 'out' };
        if (mode === 'in') return { sources: sources, total: inTotal, direction: 'in' };
        if (mode === 'unknown') {
            return {
                sources: [],
                sinks: sinks,
                total: null,
                outTotal: outTotal,
                direction: 'all',
                reason: 'Register sales are not connected, so only money out is shown.'
            };
        }
        if (mode === 'short') {
            var few = [
                { label: 'Fuel', cents: cents(300120) },
                { label: 'Inside sales', cents: cents(120480) }
            ];
            var t = few[0].cents + few[1].cents;
            return { sources: few, total: t, sinks: sinks, outTotal: outTotal, net: t - outTotal, direction: 'all' };
        }
        return {
            sources: sources,
            total: inTotal,
            sinks: sinks,
            outTotal: outTotal,
            net: inTotal - outTotal,
            direction: 'all'
        };
    }
    R['charts__pattern-charts'] = function (state, variant) {
        if (variant) return finChart('sankey', flowData(variant));
        if (state === 'error') {
            return finChart('sankey', Object.assign(flowData('all'), { state: 'failed', onRetry: noop }));
        }
        if (state === 'hover') {
            return finChart('sankey', flowData('all'), function (host) {
                return chHit(host, 1);
            });
        }
        return finChart('sankey', flowData('all'));
    };

    // FinCharts.shareBar in the table it lives in, Financials' breakdown
    // (.fi-bd, css/financials-insights.css): each row's slice starts where
    // the row above it ended, so the column reads as a staircase to 100%.
    // Money out is the dark red, money in the green; tiny and zero is a
    // share that takes the 2px floor and one that draws no fill. The row's
    // tint under the pointer is the table's, not the bar's.
    var SHARE_ROWS = {
        out: [
            ['Wholesale grocer', 268986.75],
            ['Payroll', 119000],
            ['Rent', 90800],
            ['Electric utility', 89100],
            ['Snack distributor', 73000],
            ['Remaining vendors', 271000]
        ],
        in: [
            ['Fuel', 551026],
            ['Inside sales', 352104],
            ['Not itemized', 96603],
            ['Sales tax', 64121]
        ],
        tiny: [
            ['Wholesale grocer', 969000],
            ['Bank fees', 3000],
            ['Refunds (none)', 0]
        ]
    };
    R['charts__row-bars'] = function (state, variant) {
        var F = window.FinFormat;
        var d = variant || 'out';
        var rows = SHARE_ROWS[d];
        var tone = d === 'in' ? 'revenue' : 'spend';
        var total = rows.reduce(function (a, r) {
            return a + r[1];
        }, 0);
        var table = NS.el('table', 'fi-bd');
        var thead = NS.el('thead');
        var head = NS.el('tr', 'fi-bd__row fi-bd__row--head');
        [
            ['fi-bd__name', d === 'in' ? 'Source' : 'Vendor'],
            ['fi-bd__pctcell', '% of total'],
            ['fi-bd__amt', 'Amount']
        ].forEach(function (c) {
            var th = NS.el('th', c[0], c[1]);
            th.scope = 'col';
            head.appendChild(th);
        });
        thead.appendChild(head);
        table.appendChild(thead);
        var tbody = NS.el('tbody');
        var offset = 0;
        var first = null;
        rows.forEach(function (r) {
            var pct = total ? (r[1] / total) * 100 : 0;
            var tr = NS.el('tr', 'fi-bd__row');
            var name = NS.el('td', 'fi-bd__name');
            name.appendChild(NS.el('span', 'fi-bd__label', r[0]));
            tr.appendChild(name);
            var cell = NS.el('td', 'fi-bd__pctcell');
            cell.appendChild(NS.el('span', 'fi-bd__pct', F.pct(pct)));
            var bar = NS.el('span', 'fi-bd__share');
            window.FinCharts.shareBar(bar, { pct: pct, offsetPct: offset, tone: tone });
            if (!first) first = bar.firstElementChild;
            if (pct > 0) offset += pct;
            cell.appendChild(bar);
            tr.appendChild(cell);
            var amt = NS.el('td', 'fi-bd__amt');
            amt.appendChild(F.moneyNode(d === 'in' ? cents(r[1]) : -cents(r[1])));
            tr.appendChild(amt);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        target(first);
        var card = NS.el('div', 'uil-card');
        card.appendChild(NS.el('h3', 'uil-card__title', d === 'in' ? 'Money in' : 'Money out'));
        // The box's total under its title, the period's figure in whole dollars.
        card.appendChild(NS.el('p', 'uil-card__total', F.money(d === 'in' ? cents(total) : -cents(total))));
        card.appendChild(table);
        var skin = NS.el('div', 'mod-skin');
        var frame = NS.el('div', 'fin-frame');
        frame.appendChild(card);
        skin.appendChild(frame);
        return skin;
    };

    // Kit.balance's chart, the area under a figure card (Financials
    // Overview's What you kept): thirty made-up days up to the library's
    // fixed day. Hover is the pointer at a point on the plot, through the
    // card's own pointer handler: the rule, the ring and that day in the
    // header. Focus is the plot with the keyboard on it, walked five days
    // back with the arrow keys. The card picks its size from its width:
    // compact here, standard and large in the variants.
    function kept(fall) {
        var t = today();
        var out = [];
        var y = fall ? 52480.4 : 21860.35;
        for (var i = 0; i < 30; i++) {
            // No two days alike: a scrubbed day must read differently from
            // the latest, its change included.
            y += fall ? -1680.72 + ((i * 29) % 11) * 61.3 - i * 17.41 : 760.25 + ((i * 37) % 13) * 88.61 + i * 23.17;
            out.push({ x: iso(addDays(t, i - 29)), y: Math.round(y * 100) / 100 });
        }
        return out;
    }
    function keptCard(o) {
        return balanceCard(Object.assign({ label: 'What you kept', format: 'money', good: 'up' }, o));
    }
    R['charts__mini-trend'] = onFixedDay(function (state, variant) {
        var box = NS.el(
            'div',
            'uil-bal' + (variant === 'standard' || variant === 'large' ? ' uil-bal--' + variant : '')
        );
        var card;
        if (variant === 'one') card = keptCard({ series: kept(false).slice(-1) });
        else if (variant === 'unloaded') {
            card = keptCard({
                state: 'notLoaded',
                emptyText: 'These figures did not load. This is not a statement that nothing came in.'
            });
        } else card = keptCard({ series: kept(variant === 'falling') });
        box.appendChild(card);
        var plot = card.querySelector('.kit-bal__plot');
        if (state === 'hover') {
            target(plot);
            NS.onDrawn(function () {
                var r = plot.getBoundingClientRect();
                var E = typeof window.PointerEvent === 'function' ? window.PointerEvent : window.MouseEvent;
                plot.dispatchEvent(
                    new E('pointermove', {
                        bubbles: true,
                        clientX: r.left + r.width * 0.55,
                        clientY: r.top + r.height / 2
                    })
                );
            });
        } else if (state === 'focus') {
            target(plot);
            for (var i = 0; i < 5; i++) chKey(plot, 'ArrowLeft');
        } else target(plot || card);
        return box;
    });

    // Inventory's stock health (healthBand in js/inventory/analytics.js,
    // its own pure half): the count that needs attention, one bar split into
    // critical, low and healthy, and the key. It draws in once on a page;
    // here it is at rest. Empty is a catalogue with no stocked items and its
    // one way on; the variants are many needing attention, all healthy (one
    // segment) and stock health not in the answer.
    var HEALTH = {
        default: { total: 2202, critical: 14, low: 131, healthy: 2057 },
        many: { total: 412, critical: 88, low: 142, healthy: 182 },
        healthy: { total: 380, critical: 0, low: 0, healthy: 380 },
        empty: { total: 0, critical: 0, low: 0, healthy: 0 }
    };
    R['charts__split-bar'] = function (state, variant) {
        var band = window.InventoryAnalyticsReports._internal.healthBand;
        var health = variant === 'absent' ? null : HEALTH[variant || (state === 'empty' ? 'empty' : 'default')];
        var part = atRest(function () {
            return band(window.Kit, health, noop);
        });
        target(part);
        var page = NS.el('div', 'kit inv-sub inv-analytics uil-health');
        page.appendChild(part);
        var skin = NS.el('div', 'mod-skin');
        skin.appendChild(page);
        return skin;
    };
})();
