/* ===========================================================================
 * ArgusTable: the shared Mercury-density table.
 *
 * Owner, 2026-09-22, holding up a Mercury screenshot: "make those transactions
 * look like this, and expand this type of spreadsheet to other areas with the
 * same zoom, so it's not too large nor small". This file is that spreadsheet.
 * Geometry: docs/financials/mercury-reference/transactions.md section 6, and
 * the "shared table" section of
 * docs/superpowers/specs/2026-09-22-financials-insights-design.md.
 * Styles: css/kit-table.css (load it with css/argus-crm.css and css/main.css).
 *
 * Density, pinned by css/kit-table.css:
 *   body row 48px, header row 40px, 15px names and amounts, 14px dates and
 *   secondary text, 13px muted header, 32px round initials avatar, hairlines
 *   between rows (never after the last), a rounded hover block that reaches
 *   8px past the first and last column.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   const t = ArgusTable.mount(el, {
 *     columns,                 // see "Column" below
 *     rows,                    // array of plain objects
 *     rowKey,                  // 'id' (default) | property name | fn(row, i) -> key
 *     selectable,              // true adds the checkbox column + select all
 *     selected,                // initial array of keys
 *     sort,                    // { key, dir: 'asc' | 'desc' } | null
 *     onSort(key, dir),        // dir is 'asc' | 'desc' | null (Clear sort).
 *                              //   When omitted the table sorts the rows it holds.
 *     onRowClick(row, event),  // makes rows clickable and focusable (Enter)
 *     onSelect(keys),          // after every selection change
 *     groupBy(row),            // -> label | null; a label row opens each run
 *     state,                   // 'loading' | 'ready' | 'empty' | 'failed'
 *     emptyText, failedText,   // the sentences for those two states
 *     emptyAction,             // { label, onClick } quiet button under emptyText
 *     onRetry,                 // draws a quiet "Try again" under failedText
 *     footer,                  // { total, page, pageSize, onPage(page), noun: ['Transaction','Transactions'] }
 *     ghostRows,               // how many ghost rows loading draws (default 8)
 *     now,                     // Date used to decide whether a date shows its year
 *     label                    // accessible name of the table
 *   });
 *   t.update(partial)          // shallow-merges options and re-renders
 *   t.selection()              // -> array of selected keys, in row order
 *   t.destroy()
 *
 *   ArgusTable.moneyParts(cents)  -> { sign, whole, cents, text, direction } | null
 *   ArgusTable.formatDate(value, now) -> 'Sep 22' | 'Dec 5, 2025' | null
 *   ArgusTable.initials(name)     -> 'LE'
 *   ArgusTable.ICON_NAMES         -> the glyph names column.icon(row) may return
 *
 * Column:
 *   { key, label, type, align: 'left' | 'right', width, sortable,
 *     sortLabels: { asc, desc }, sortValue(row), value(row), render(row),
 *     hideBelow }
 *
 *   width      number (px) or any grid track ('minmax(0, 1fr)'); each type has
 *              a default.
 *   value(row) where the cell reads from; default row[key].
 *   render(row) replaces the type renderer; returns a Node or a string (a
 *              string is set as TEXT, never parsed as markup).
 *   hideBelow  drop the column when the table is narrower than this (px).
 *
 *   type 'date'   value 'YYYY-MM-DD' (or a Date). "Sep 22"; the year is added
 *                 only when it is not the current year.
 *   type 'party'  value 'Name' or { name, initials, badge }. 32px initials
 *                 avatar, the name, then an optional badge. column.badge(row)
 *                 -> { text, tone } also works. Tones: 'neutral' (grey),
 *                 'warn' (amber: a human has to look), 'muted' (voided),
 *                 'danger' (red: failed).
 *   type 'money'  value integer cents (a bigint string is accepted). Cents
 *                 are a raised superscript, the minus is U+2212. With
 *                 column.flow (default true) a positive amount is money IN and
 *                 wears --crm-revenue; a negative one stays ink, like Mercury
 *                 (column.outTone: 'spend' paints it --crm-spend instead).
 *                 Set flow: false for amounts that are not a cash flow, so
 *                 green is never spent on anything but money in.
 *                 A struck row (row.struck, or column.struck(row)) is drawn
 *                 with a line through it. null renders the en dash with a
 *                 reason (column.nullReason, string or fn(row)), never $0.00.
 *   type 'text'   plain text. column.icon(row) -> one of ICON_NAMES draws a
 *                 14px glyph first. column.tone: 'strong' for ink.
 *   type 'badge'  value 'Text' or { text, tone }.
 *   type 'select' an inline combobox. column.options (array or fn(row)) of
 *                 { value, label }, column.placeholder, column.clearable,
 *                 column.disabled(row), column.display(row) for a value that
 *                 is not in the options, column.onChange(row, value). If
 *                 onChange returns a promise the cell holds the new value
 *                 while it settles and reverts if it rejects.
 *   type 'custom' column.render(row) only.
 *
 * States (a read settles three ways, and they must not look alike):
 *   loading  ghost rows only. No figure, no footer.
 *   empty    faint ghost rows behind emptyText. 'ready' with zero rows is
 *            treated as empty.
 *   failed   failedText and nothing else: no rows (not even stale ones), no
 *            ghost rows, no count, never a $0. rows: null (the kit's failed
 *            read) is failed too, unless state says loading or empty.
 *
 * Page hooks (CSS custom properties, set on any ancestor):
 *   --atbl-bg          the ground under the table, painted by the stuck header
 *                      so rows do not show through it. Default: the module
 *                      sheet (--ground-page light, --sheet-surface dark).
 *   --atbl-sticky-top  where the header sticks (default 0, the top of the
 *                      scrolling .portal-main). Set it under a sticky toolbar.
 *   The table reaches 8px past its container on both sides (the hover block),
 *   so do not put it inside overflow: hidden without 8px of padding.
 *
 * Rules this file keeps: no innerHTML anywhere, every string is text; no
 * colour set from JavaScript (tone is a class, css/kit-table.css owns the
 * value); popups are children of <body>; Intl is always 'en-US'.
 *
 * Load order: after js/kit/core.js (it uses Kit.el).
 * =========================================================================== */
(function () {
    'use strict';

    if (window.Kit && window.Kit.__table) return;
    const Kit = window.Kit;
    if (!Kit || !Kit.__core) {
        if (window.console) window.console.warn('[ArgusTable] js/kit/core.js must load before js/kit/table.js');
        return;
    }
    const el = Kit.el;

    const MINUS = '\u2212';
    const EN_DASH = '\u2013';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

    const MONEY = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const COUNT = new Intl.NumberFormat('en-US');
    const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
    const COLLATOR = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

    /* ---------------------------------------------------------------------
     * Glyphs. Path-only on a 24 viewBox, stroked with currentColor by the
     * sheet. Static strings: nothing here ever carries tenant data.
     * ------------------------------------------------------------------- */
    const ICONS = {
        'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
        'arrow-down': ['M12 5v14', 'M6 13l6 6 6-6'],
        sort: ['M8 4v16', 'M4 8l4-4 4 4', 'M16 20V4', 'M12 16l4 4 4-4'],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        x: ['M6 6l12 12', 'M18 6L6 18'],
        'chevron-down': ['M6 9l6 6 6-6'],
        'chevron-left': ['M15 6l-6 6 6 6'],
        'chevron-right': ['M9 6l6 6-6 6'],
        card: ['M3 6.5h18v11H3z', 'M3 10h18', 'M7 14.5h3'],
        in: ['M4 12h15', 'M13 6l6 6-6 6'],
        out: ['M20 12H5', 'M11 6l-6 6 6 6'],
        send: ['M21 3L10 14', 'M21 3l-7 18-4-7-7-4z'],
        register: ['M4 10h16v10H4z', 'M7 10V4h10v6', 'M8 14h2', 'M12 14h2', 'M8 17h8'],
        invoice: ['M6 3h9l3 3v15H6z', 'M9 9h6', 'M9 13h6', 'M9 17h4'],
        bill: ['M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z', 'M9 8h6', 'M9 12h6'],
        manual: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
        import: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v4h16v-4'],
        payout: ['M3 7h18v10H3z', 'M12 10v4', 'M7 12h.01', 'M17 12h.01'],
        store: ['M4 9l1.5-5h13L20 9', 'M4 9h16v11H4z', 'M9 20v-6h6v6']
    };

    function icon(name, cls) {
        const paths = ICONS[name];
        if (!paths) return null;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('class', 'atbl-ic' + (cls ? ' ' + cls : ''));
        svg.setAttribute('data-icon', name);
        paths.forEach((d) => {
            const p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            svg.appendChild(p);
        });
        return svg;
    }

    /* ---------------------------------------------------------------------
     * Formatting. Exposed for tests and for callers that print the same
     * figure outside the table.
     * ------------------------------------------------------------------- */
    // A figure is a number, or a decimal string (node-postgres hands bigint
    // back as one). Nothing else counts: Number(' ') and Number([]) are both
    // 0, and a blank cell painted as "$0.00" is exactly the lie this table
    // exists not to tell.
    const DECIMAL = /^\s*[-+]?\d+(\.\d+)?\s*$/;

    function toCents(v) {
        let n;
        if (typeof v === 'number') n = v;
        else if (typeof v === 'string' && DECIMAL.test(v)) n = Number(v);
        else return null;
        if (!Number.isFinite(n)) return null;
        const r = Math.round(n);
        return r === 0 ? 0 : r; // -0 is a zero, and a zero carries no sign
    }

    function moneyParts(v) {
        const c = toCents(v);
        if (c === null) return null;
        const s = MONEY.format(Math.abs(c) / 100);
        const dot = s.lastIndexOf('.');
        const sign = c < 0 ? MINUS : '';
        return {
            sign,
            whole: sign + s.slice(0, dot),
            cents: s.slice(dot),
            text: sign + s,
            direction: c > 0 ? 'in' : c < 0 ? 'out' : 'zero'
        };
    }

    function dateParts(v) {
        if (v == null || v === '') return null;
        if (v instanceof Date) {
            if (isNaN(v.getTime())) return null;
            return { y: v.getFullYear(), m: v.getMonth(), d: v.getDate() };
        }
        const m = String(v).match(ISO_DAY);
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
        // '2026-02-31' is not March 3rd; a day the month does not have is no date.
        if (new Date(Date.UTC(y, mo, d)).getUTCDate() !== d) return null;
        return { y, m: mo, d };
    }

    function formatDate(v, now) {
        const p = dateParts(v);
        if (!p) return null;
        const at = new Date(Date.UTC(p.y, p.m, p.d));
        const ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
        return p.y === ref.getFullYear() ? MONTH_DAY.format(at) : MONTH_DAY_YEAR.format(at);
    }

    function initials(name) {
        // An apostrophe joins ("Lily's" is one word, not "Lily s"); every
        // other mark separates ("Orange, Inc." -> "OI").
        const words = String(name == null ? '' : name)
            .replace(/['\u2019]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(Boolean);
        const useful = words.length > 1 && /^the$/i.test(words[0]) ? words.slice(1) : words;
        const out = useful
            .slice(0, 2)
            .map((w) => w.charAt(0))
            .join('');
        return out.toUpperCase() || '?';
    }

    /** One of four pale tints, stable per name, so a vendor keeps its colour. */
    function toneOf(name) {
        const s = String(name == null ? '' : name);
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return (h % 4) + 1;
    }

    /* ---------------------------------------------------------------------
     * Columns
     * ------------------------------------------------------------------- */
    const DEFAULT_WIDTH = {
        date: '80px',
        party: 'minmax(0, 2fr)',
        money: '120px',
        text: 'minmax(0, 1fr)',
        badge: '132px',
        select: '200px',
        custom: 'minmax(0, 1fr)'
    };
    const SORT_LABELS = {
        date: { asc: 'Old to new', desc: 'New to old' },
        money: { asc: 'Low to high', desc: 'High to low' },
        other: { asc: 'A to Z', desc: 'Z to A' }
    };
    const TYPES = ['date', 'party', 'money', 'text', 'badge', 'select', 'custom'];
    const TONES = ['neutral', 'warn', 'muted', 'danger'];

    function track(w, type) {
        if (typeof w === 'number' && isFinite(w)) return w + 'px';
        if (typeof w === 'string' && w.trim()) return w.trim();
        return DEFAULT_WIDTH[type] || DEFAULT_WIDTH.text;
    }

    function normColumn(c, i) {
        const type = TYPES.indexOf(c.type) >= 0 ? c.type : c.render ? 'custom' : 'text';
        const key = c.key != null ? String(c.key) : 'col' + i;
        return Object.assign({}, c, {
            key,
            type,
            label: c.label == null ? '' : String(c.label),
            align: c.align === 'right' || (c.align == null && type === 'money') ? 'right' : 'left',
            track: track(c.width, type),
            sortable: !!c.sortable,
            sortLabels: Object.assign({}, SORT_LABELS[type] || SORT_LABELS.other, c.sortLabels || {}),
            flow: c.flow !== false
        });
    }

    function valueOf(col, row) {
        if (typeof col.value === 'function') return col.value(row);
        return row == null ? undefined : row[col.key];
    }

    function call(fn, row, fallback) {
        return typeof fn === 'function' ? fn(row) : fn === undefined ? fallback : fn;
    }

    function badgeOf(v) {
        if (v == null || v === '' || v === false) return null;
        if (typeof v === 'string') return { text: v, tone: 'neutral' };
        if (typeof v === 'object' && v.text) {
            return { text: String(v.text), tone: TONES.indexOf(v.tone) >= 0 ? v.tone : 'neutral' };
        }
        return null;
    }

    function badgeNode(b) {
        return el('span', { class: 'atbl-badge atbl-badge--' + b.tone, text: b.text });
    }

    function dash(reason, cls) {
        // role="img" so the reason IS the accessible name: aria-label on a
        // plain span is ignored by most screen readers, which would read the
        // dash as "en dash" and drop the why.
        return el('span', {
            class: 'atbl-none' + (cls ? ' ' + cls : ''),
            role: 'img',
            'aria-label': reason || 'No value',
            text: EN_DASH
        });
    }

    /* ---------------------------------------------------------------------
     * Cell renderers. Each returns ONE node to put inside the cell.
     * ------------------------------------------------------------------- */
    function renderDate(col, row, now) {
        const v = valueOf(col, row);
        const text = formatDate(v, now);
        if (text == null) return dash(call(col.nullReason, row, 'No date'));
        const p = dateParts(v);
        const iso = p.y + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
        return el('time', { class: 'atbl-date', datetime: iso, text });
    }

    function renderParty(col, row) {
        const v = valueOf(col, row);
        const obj = v != null && typeof v === 'object' ? v : { name: v };
        const name = obj.name == null || obj.name === '' ? null : String(obj.name);
        const badge = badgeOf(obj.badge) || badgeOf(call(col.badge, row, null));
        if (name == null) {
            return el('span', { class: 'atbl-party' }, [
                dash(call(col.nullReason, row, 'No name')),
                badge ? badgeNode(badge) : null
            ]);
        }
        const ini = obj.initials ? String(obj.initials).slice(0, 2).toUpperCase() : initials(name);
        return el('span', { class: 'atbl-party' }, [
            el('span', { class: 'atbl-av atbl-av--' + toneOf(name), 'aria-hidden': 'true', text: ini }),
            el('span', { class: 'atbl-name', text: name }),
            badge ? badgeNode(badge) : null
        ]);
    }

    function renderMoney(col, row) {
        const v = valueOf(col, row);
        const parts = moneyParts(v);
        const struck = !!(call(col.struck, row, null) || (row && row.struck));
        if (!parts) {
            return dash(call(col.nullReason, row, 'Amount not available'), 'atbl-money');
        }
        let cls = 'atbl-money';
        if (col.flow && parts.direction === 'in') cls += ' atbl-money--in';
        if (col.flow && parts.direction === 'out' && col.outTone === 'spend') cls += ' atbl-money--spend';
        if (struck) cls += ' atbl-money--struck';
        // The figure is read from its own text ("minus $25.00"). It used to hide
        // both halves and name the span with aria-label, but a plain span (and
        // <del>) cannot be named, so NVDA and JAWS read nothing at all.
        const fig = el(struck ? 'del' : 'span', { class: cls }, [
            el('span', { class: 'atbl-whole', text: parts.whole }),
            el('span', { class: 'atbl-cents', text: parts.cents })
        ]);
        if (!struck) return fig;
        // The strike is only seen; say it too.
        return el('span', { class: 'atbl-money-wrap' }, [fig, el('span', { class: 'atbl-sr', text: ', not counted' })]);
    }

    function renderText(col, row) {
        const v = valueOf(col, row);
        if (v == null || v === '') {
            const reason = call(col.nullReason, row, null);
            return reason ? dash(reason) : el('span', { class: 'atbl-text atbl-text--blank' });
        }
        const text = String(v);
        const glyph = typeof col.icon === 'function' ? col.icon(row) : col.icon;
        const tone = col.tone === 'strong' ? ' atbl-text--strong' : '';
        // No `title`: a browser tooltip is native UI (settings-no-native-controls).
        return el('span', { class: 'atbl-text' + tone }, [
            glyph ? icon(String(glyph)) : null,
            el('span', { class: 'atbl-text__label', text })
        ]);
    }

    function renderBadge(col, row) {
        const b = badgeOf(valueOf(col, row));
        return b ? badgeNode(b) : el('span', { class: 'atbl-text atbl-text--blank' });
    }

    function renderCustom(col, row) {
        if (typeof col.render !== 'function') return renderText(col, row);
        const out = col.render(row);
        if (out == null) return el('span', { class: 'atbl-text atbl-text--blank' });
        if (typeof out === 'string' || typeof out === 'number') {
            return el('span', { class: 'atbl-text', text: String(out) });
        }
        return out;
    }

    /* ---------------------------------------------------------------------
     * Popups: the sort menu and the select listbox. One open at a time,
     * children of <body>, position: fixed, closed by Escape, an outside
     * press, a scroll outside it, or a resize.
     * ------------------------------------------------------------------- */
    let openPop = null;

    function closePopup(refocus) {
        if (!openPop) return;
        const p = openPop;
        openPop = null;
        document.removeEventListener('mousedown', p.onDown, true);
        document.removeEventListener('keydown', p.onKey, true);
        window.removeEventListener('scroll', p.onScroll, true);
        window.removeEventListener('resize', p.onResize);
        if (p.node.parentNode) p.node.parentNode.removeChild(p.node);
        if (p.anchor) p.anchor.setAttribute('aria-expanded', 'false');
        if (typeof p.onClose === 'function') p.onClose();
        if (refocus && p.anchor && typeof p.anchor.focus === 'function') p.anchor.focus();
    }

    function place(node, anchor, alignRight) {
        const r = anchor.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const w = node.offsetWidth;
        const h = node.offsetHeight;
        let left = alignRight ? r.right - w : r.left;
        if (vw) left = Math.max(8, Math.min(left, vw - w - 8));
        let top = r.bottom + 4;
        if (vh && top + h > vh - 8 && r.top - 4 - h >= 8) top = r.top - 4 - h;
        node.style.left = Math.round(left) + 'px';
        node.style.top = Math.round(top) + 'px';
    }

    function openPopup(anchor, node, opts) {
        closePopup(false);
        document.body.appendChild(node);
        const p = {
            node,
            anchor,
            onClose: opts.onClose,
            onDown(e) {
                if (node.contains(e.target) || anchor.contains(e.target)) return;
                closePopup(false);
            },
            onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    closePopup(true);
                } else if (e.key === 'Tab') {
                    // Hand focus back to the control that opened the popup
                    // BEFORE the browser moves it: the popup is the last child
                    // of <body>, so closing it with focus inside dropped focus
                    // to the top of the page (measured: Tab from the sort menu
                    // landed on the first link on the page). Tab then carries
                    // on from the header or the cell, where the user was.
                    closePopup(true);
                } else if (typeof opts.onKey === 'function') {
                    opts.onKey(e);
                }
            },
            onScroll(e) {
                if (e && e.target && e.target.nodeType === 1 && node.contains(e.target)) return;
                closePopup(false);
            },
            onResize() {
                closePopup(false);
            }
        };
        openPop = p;
        anchor.setAttribute('aria-expanded', 'true');
        place(node, opts.at || anchor, !!opts.alignRight);
        document.addEventListener('mousedown', p.onDown, true);
        document.addEventListener('keydown', p.onKey, true);
        window.addEventListener('scroll', p.onScroll, true);
        window.addEventListener('resize', p.onResize);
        return p;
    }

    /** Arrow-key travel over a list of focusable items. */
    function roveKeys(items, e) {
        // Home and End belong to the caret while the search field has focus.
        const inField = e.target && e.target.tagName === 'INPUT';
        if (inField && (e.key === 'Home' || e.key === 'End')) return false;
        const list = items().filter((n) => !n.disabled && n.getAttribute('aria-disabled') !== 'true');
        if (!list.length) return false;
        const at = list.indexOf(document.activeElement);
        let next = null;
        if (e.key === 'ArrowDown') next = list[at < 0 ? 0 : Math.min(list.length - 1, at + 1)];
        else if (e.key === 'ArrowUp') next = list[at < 0 ? list.length - 1 : Math.max(0, at - 1)];
        else if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
        if (!next) return false;
        e.preventDefault();
        next.focus();
        return true;
    }

    let uid = 0;

    function normSort(s) {
        return s && s.key != null ? { key: String(s.key), dir: s.dir === 'asc' ? 'asc' : 'desc' } : null;
    }

    /* ---------------------------------------------------------------------
     * mount
     * ------------------------------------------------------------------- */
    function mount(host, options) {
        if (!host || host.nodeType !== 1) throw new Error('ArgusTable.mount needs an element');
        const id = 'atbl' + ++uid;
        let opts = Object.assign({}, options || {});
        let sort = normSort(opts.sort);
        const selected = new Map(); // String(key) -> the caller's key
        const pending = new Map(); // rowKey + NUL + colKey -> value while an onChange settles
        const failed = new Set(); // the same key, when that onChange rejected
        const saved = new Map(); // the same key -> the value a settled onChange wrote
        let lastClicked = -1;
        let width = 0;
        let ro = null;
        let destroyed = false;

        const root = el('div', { class: 'atbl', id, role: 'table' });
        host.replaceChildren(root);

        function keyOf(row, i) {
            const rk = opts.rowKey;
            if (typeof rk === 'function') return rk(row, i);
            const k = row == null ? undefined : row[rk || 'id'];
            return k == null ? 'row' + i : k;
        }

        function rowsIn() {
            return Array.isArray(opts.rows) ? opts.rows : [];
        }

        function allColumns() {
            return (Array.isArray(opts.columns) ? opts.columns : []).map(normColumn);
        }

        function visibleColumns() {
            return allColumns().filter((c) => !(c.hideBelow && width && width < c.hideBelow));
        }

        function stateOf() {
            const s = opts.state;
            if (s === 'loading' || s === 'failed' || s === 'empty') return s;
            // rows: null is the kit's "the read failed" (Kit.isAnswer), not an
            // empty list. Painting it as the honest empty would tell the owner
            // there is nothing here when we simply could not look.
            if (opts.rows === null) return 'failed';
            return rowsIn().length ? 'ready' : 'empty';
        }

        /** Rows in display order: the caller's order, or ours when we own sorting. */
        function orderedRows(cols) {
            const rows = rowsIn().map((row, i) => ({ row, i, key: keyOf(row, i) }));
            if (!sort || typeof opts.onSort === 'function') return rows;
            const col = cols.find((c) => c.key === sort.key);
            if (!col) return rows;
            const sv = (row) => {
                if (typeof col.sortValue === 'function') return col.sortValue(row);
                const v = valueOf(col, row);
                if (col.type === 'money') return toCents(v);
                if (col.type === 'date') {
                    // A Date would otherwise compare as "Tue Sep 22 ...",
                    // which sorts by weekday name.
                    const p = dateParts(v);
                    return p ? p.y * 10000 + p.m * 100 + p.d : null;
                }
                if (col.type === 'select') {
                    // Sort by what the cell shows, not the stored id.
                    if (v == null || v === '') return null;
                    const o = (call(col.options, row, []) || []).find((x) => x && String(x.value) === String(v));
                    return o ? String(o.label) : String(call(col.display, row, v));
                }
                if (col.type === 'party' || col.type === 'badge') {
                    return v != null && typeof v === 'object' ? v.name || v.text : v;
                }
                return v;
            };
            const dir = sort.dir === 'asc' ? 1 : -1;
            return rows.slice().sort((a, b) => {
                const x = sv(a.row);
                const y = sv(b.row);
                // Blanks sink to the bottom in both directions: an unknown is
                // not the smallest value, and must not lead "Low to high".
                const xn = x == null || x === '';
                const yn = y == null || y === '';
                if (xn || yn) return xn === yn ? a.i - b.i : xn ? 1 : -1;
                const c =
                    typeof x === 'number' && typeof y === 'number' ? x - y : COLLATOR.compare(String(x), String(y));
                return c === 0 ? a.i - b.i : c * dir;
            });
        }

        function template(cols) {
            const parts = cols.map((c) => c.track);
            if (opts.selectable) parts.unshift('20px');
            return parts.join(' ');
        }

        /* ---- header ---- */
        function headCell(col) {
            const active = sort && sort.key === col.key ? sort.dir : null;
            const cell = el('div', {
                class:
                    'atbl-th atbl-th--' +
                    col.type +
                    ' atbl-th--' +
                    col.align +
                    (col.sortable ? ' atbl-th--sortable' : ''),
                role: 'columnheader',
                'aria-sort': col.sortable
                    ? active === 'asc'
                        ? 'ascending'
                        : active === 'desc'
                          ? 'descending'
                          : 'none'
                    : null,
                dataset: { col: col.key }
            });
            if (!col.sortable) {
                cell.appendChild(el('span', { class: 'atbl-th__label', text: col.label }));
                return cell;
            }
            const arrow = active
                ? icon(active === 'asc' ? 'arrow-up' : 'arrow-down', 'atbl-sort__arrow')
                : icon('sort', 'atbl-sort__hint');
            const label = el('span', { class: 'atbl-th__label', text: col.label });
            const pill = el(
                'span',
                { class: 'atbl-sort__pill' },
                col.align === 'right' ? [arrow, label] : [label, arrow]
            );
            const btn = el(
                'button',
                {
                    type: 'button',
                    class: 'atbl-sort' + (active ? ' is-active' : ''),
                    'aria-haspopup': 'menu',
                    'aria-expanded': 'false',
                    'aria-label': col.label + ', sort options',
                    dataset: { atblFocus: 'sort:' + col.key }
                },
                [pill]
            );
            btn.addEventListener('click', () => openSortMenu(btn, col));
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    openSortMenu(btn, col);
                }
            });
            cell.appendChild(btn);
            return cell;
        }

        function openSortMenu(btn, col) {
            if (openPop && openPop.anchor === btn) {
                closePopup(false);
                return;
            }
            const active = sort && sort.key === col.key ? sort.dir : null;
            const menu = el('div', { class: 'atbl-pop atbl-menu', role: 'menu', 'aria-label': 'Sort by ' + col.label });
            const item = (dir, text, glyph, disabled) => {
                const checked = !!dir && active === dir;
                const b = el(
                    'button',
                    {
                        type: 'button',
                        class: 'atbl-menu__item' + (checked ? ' is-checked' : '') + (disabled ? ' is-disabled' : ''),
                        role: dir ? 'menuitemradio' : 'menuitem',
                        'aria-checked': dir ? String(checked) : null,
                        'aria-disabled': disabled ? 'true' : null,
                        tabindex: '-1',
                        dataset: { dir: dir || 'clear' }
                    },
                    [icon(checked ? 'check' : glyph, 'atbl-menu__glyph'), el('span', { text })]
                );
                b.addEventListener('click', () => {
                    if (disabled) return;
                    closePopup(true);
                    applySort(col.key, dir);
                });
                return b;
            };
            menu.appendChild(item('asc', col.sortLabels.asc, 'arrow-up', false));
            menu.appendChild(item('desc', col.sortLabels.desc, 'arrow-down', false));
            menu.appendChild(item(null, 'Clear sort', 'x', !active));
            const items = () => Array.prototype.slice.call(menu.querySelectorAll('.atbl-menu__item'));
            openPopup(btn, menu, { alignRight: col.align === 'right', onKey: (e) => roveKeys(items, e) });
            const first = menu.querySelector('.is-checked') || items()[0];
            if (first) first.focus();
        }

        function applySort(key, dir) {
            sort = dir ? { key, dir } : null;
            lastClicked = -1; // a shift-click anchor is an index into the OLD order
            if (typeof opts.onSort === 'function') opts.onSort(key, dir || null);
            render();
        }

        function checkbox(label, checked, focusId, onToggle) {
            const input = el('input', {
                type: 'checkbox',
                class: 'atbl-check__box',
                'aria-label': label,
                dataset: { atblFocus: focusId }
            });
            input.checked = !!checked;
            input.addEventListener('click', (e) => {
                e.stopPropagation();
                onToggle(input.checked, e);
            });
            return el('label', { class: 'atbl-check' }, [input]);
        }

        function renderHead(cols, ordered, live) {
            const head = el('div', { class: 'atbl-head', role: 'row' });
            if (opts.selectable) {
                const keys = ordered.map((r) => String(r.key));
                const n = keys.filter((k) => selected.has(k)).length;
                const box = checkbox('Select all rows', live && n > 0 && n === keys.length, 'all', (on) => {
                    if (on) ordered.forEach((r) => selected.set(String(r.key), r.key));
                    else keys.forEach((k) => selected.delete(k));
                    emitSelect();
                    render();
                });
                const input = box.firstChild;
                input.indeterminate = live && n > 0 && n < keys.length;
                input.disabled = !live;
                head.appendChild(el('div', { class: 'atbl-th atbl-th--check', role: 'columnheader' }, [box]));
            }
            cols.forEach((c) => head.appendChild(headCell(c)));
            return head;
        }

        /* ---- body ---- */
        function selectCell(col, row, rk) {
            const pk = String(rk) + '\u0000' + col.key;
            const has = pending.has(pk);
            const value = has ? pending.get(pk) : valueOf(col, row);
            const list = call(col.options, row, []) || [];
            const found = list.find((o) => o && String(o.value) === String(value));
            const isSet = value != null && value !== '';
            const text = found ? String(found.label) : isSet ? String(call(col.display, row, value)) : '';
            // A cell nobody can change is TEXT, not a greyed-out control: a
            // box that looks editable and refuses is worse than no box.
            if (call(col.disabled, row, false) || typeof col.onChange !== 'function') {
                return isSet
                    ? el('span', { class: 'atbl-text atbl-text--readonly' }, [
                          el('span', { class: 'atbl-text__label', text })
                      ])
                    : el('span', { class: 'atbl-text atbl-text--blank' });
            }
            const clearable = col.clearable !== false && isSet && !has;
            const box = el('div', {
                class:
                    'atbl-combo' +
                    (isSet ? ' is-set' : '') +
                    (has ? ' is-busy' : '') +
                    (failed.has(pk) ? ' is-failed' : '')
            });
            const trigger = el(
                'button',
                {
                    type: 'button',
                    class: 'atbl-combo__trigger',
                    'aria-haspopup': 'listbox',
                    'aria-expanded': 'false',
                    // The failure is said in the name, not a browser tooltip.
                    'aria-label':
                        (col.label || 'Value') +
                        ': ' +
                        (text || col.placeholder || 'none') +
                        (failed.has(pk) ? '. Not saved. Try again.' : ''),
                    dataset: { atblFocus: 'combo:' + pk }
                },
                [
                    el('span', {
                        class: 'atbl-combo__label' + (isSet ? '' : ' is-placeholder'),
                        text: isSet ? text : col.placeholder || ''
                    }),
                    clearable ? null : icon('chevron-down', 'atbl-combo__chev')
                ]
            );
            if (has) trigger.disabled = true;
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                openListbox(trigger, col, row, rk, value);
            });
            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    e.stopPropagation();
                    openListbox(trigger, col, row, rk, value);
                }
            });
            box.appendChild(trigger);
            if (clearable) {
                const clear = el(
                    'button',
                    {
                        type: 'button',
                        class: 'atbl-combo__clear',
                        'aria-label': 'Clear ' + (col.label || 'value').toLowerCase(),
                        dataset: { atblFocus: 'clear:' + pk }
                    },
                    [icon('x')]
                );
                clear.addEventListener('click', (e) => {
                    e.stopPropagation();
                    commitSelect(col, row, rk, null);
                });
                box.appendChild(clear);
            }
            return box;
        }

        function openListbox(trigger, col, row, rk, current) {
            if (openPop && openPop.anchor === trigger) {
                closePopup(false);
                return;
            }
            const all = (call(col.options, row, []) || []).filter((o) => o && o.value != null);
            const lb = el('div', { class: 'atbl-pop atbl-lb' });
            const list = el('div', { class: 'atbl-lb__list', role: 'listbox', 'aria-label': col.label || 'Options' });
            let search = null;
            const draw = (q) => {
                const needle = (q || '').trim().toLowerCase();
                const shown = needle ? all.filter((o) => String(o.label).toLowerCase().indexOf(needle) >= 0) : all;
                list.replaceChildren();
                if (!shown.length) {
                    list.appendChild(el('div', { class: 'atbl-lb__none', text: needle ? 'No match' : 'No options' }));
                    return;
                }
                shown.forEach((o) => {
                    const on = current != null && String(o.value) === String(current);
                    const opt = el(
                        'button',
                        {
                            type: 'button',
                            class: 'atbl-opt' + (on ? ' is-selected' : ''),
                            role: 'option',
                            'aria-selected': String(on),
                            tabindex: '-1',
                            dataset: { value: String(o.value) }
                        },
                        [
                            el('span', { class: 'atbl-opt__label', text: String(o.label) }),
                            on ? icon('check', 'atbl-opt__check') : null
                        ]
                    );
                    opt.addEventListener('click', () => {
                        closePopup(true);
                        // Picking what is already chosen is not a change. On a
                        // "Needs category" row onChange BOOKS an expense, so a
                        // second click on the ticked option must not book it twice.
                        if (on) return;
                        commitSelect(col, row, rk, o.value);
                    });
                    list.appendChild(opt);
                });
            };
            if (all.length > 8) {
                search = el('input', {
                    type: 'text',
                    class: 'atbl-lb__search',
                    placeholder: 'Search',
                    'aria-label': 'Search ' + (col.label || 'options').toLowerCase(),
                    autocomplete: 'off'
                });
                search.addEventListener('input', () => draw(search.value));
                lb.appendChild(search);
            }
            draw('');
            lb.appendChild(list);
            const rowEl = trigger.closest('.atbl-row');
            if (rowEl) rowEl.classList.add('is-open');
            const items = () => Array.prototype.slice.call(list.querySelectorAll('.atbl-opt'));
            const boxW = trigger.parentNode ? Math.round(trigger.parentNode.getBoundingClientRect().width) : 0;
            if (boxW) lb.style.minWidth = boxW + 'px';
            // Placed against the visible box so the list lines up with it; the
            // control that owns the list (and gets focus back) is the trigger.
            openPopup(trigger, lb, {
                at: trigger.parentNode || trigger,
                onClose: () => {
                    if (rowEl) rowEl.classList.remove('is-open');
                },
                onKey: (e) => {
                    if (roveKeys(items, e)) return;
                    if (e.key === 'Enter' && search && document.activeElement === search) {
                        const first = items()[0];
                        if (first) {
                            e.preventDefault();
                            first.click();
                        }
                    }
                }
            });
            const focusFirst = search || list.querySelector('.is-selected') || items()[0];
            if (focusFirst) focusFirst.focus();
        }

        function commitSelect(col, row, rk, value) {
            const pk = String(rk) + '\u0000' + col.key;
            failed.delete(pk);
            if (typeof col.onChange !== 'function') return;
            let out;
            try {
                out = col.onChange(row, value);
            } catch (_e) {
                failed.add(pk);
                render();
                return;
            }
            pending.set(pk, value);
            if (out && typeof out.then === 'function') {
                const settle = (ok) => {
                    if (destroyed || !pending.has(pk) || pending.get(pk) !== value) return;
                    if (!ok) {
                        pending.delete(pk);
                        failed.add(pk);
                    } else {
                        // Keep showing the saved value, unlocked, until the
                        // caller hands back fresh rows (update({ rows }) clears it).
                        pending.delete(pk);
                        saved.set(pk, value);
                    }
                    render();
                };
                out.then(
                    () => settle(true),
                    () => settle(false)
                );
                render();
            } else {
                pending.delete(pk);
                saved.set(pk, value);
                render();
            }
        }

        function cellFor(col, row, rk) {
            if (typeof col.render === 'function' && col.type !== 'custom') return renderCustom(col, row);
            switch (col.type) {
                case 'date':
                    return renderDate(col, row, opts.now);
                case 'party':
                    return renderParty(col, row);
                case 'money':
                    return renderMoney(col, row);
                case 'badge':
                    return renderBadge(col, row);
                case 'select': {
                    const pk = String(rk) + '\u0000' + col.key;
                    if (saved.has(pk) && !pending.has(pk)) {
                        const v = saved.get(pk);
                        const shadow = Object.assign({}, col, { value: () => v });
                        return selectCell(shadow, row, rk);
                    }
                    return selectCell(col, row, rk);
                }
                case 'custom':
                    return renderCustom(col, row);
                default:
                    return renderText(col, row);
            }
        }

        function rowLabel(cols, row) {
            for (const c of cols) {
                if (c.type === 'party' || c.type === 'text') {
                    const v = valueOf(c, row);
                    const s = v != null && typeof v === 'object' ? v.name : v;
                    if (s != null && s !== '') return String(s);
                }
            }
            return 'row';
        }

        function bodyRow(cols, item, index, ordered) {
            const k = String(item.key);
            const isSel = selected.has(k);
            const clickable = typeof opts.onRowClick === 'function';
            const row = el('div', {
                class: 'atbl-row' + (isSel ? ' is-selected' : '') + (clickable ? ' is-clickable' : ''),
                role: 'row',
                tabindex: clickable ? '0' : null,
                'aria-selected': opts.selectable ? String(isSel) : null,
                dataset: { key: k, atblFocus: 'row:' + k }
            });
            if (opts.selectable) {
                const box = checkbox('Select ' + rowLabel(cols, item.row), isSel, 'check:' + k, (on, e) => {
                    const from = e && e.shiftKey && lastClicked >= 0 ? Math.min(lastClicked, index) : index;
                    const to = e && e.shiftKey && lastClicked >= 0 ? Math.max(lastClicked, index) : index;
                    for (let i = from; i <= to; i++) {
                        const it = ordered[i];
                        if (on) selected.set(String(it.key), it.key);
                        else selected.delete(String(it.key));
                    }
                    lastClicked = index;
                    emitSelect();
                    render();
                });
                row.appendChild(el('div', { class: 'atbl-cell atbl-cell--check', role: 'cell' }, [box]));
            }
            cols.forEach((c) => {
                row.appendChild(
                    el(
                        'div',
                        {
                            class: 'atbl-cell atbl-cell--' + c.type + ' atbl-cell--' + c.align,
                            role: 'cell',
                            dataset: { col: c.key }
                        },
                        [cellFor(c, item.row, item.key)]
                    )
                );
            });
            return row;
        }

        function ghost(cols, i, still) {
            const row = el('div', { class: 'atbl-row atbl-ghost' + (still ? ' is-still' : ''), 'aria-hidden': 'true' });
            if (opts.selectable) {
                row.appendChild(
                    el('div', { class: 'atbl-cell atbl-cell--check' }, [
                        el('span', { class: 'atbl-bar atbl-bar--box' })
                    ])
                );
            }
            const widths = ['62', '44', '78', '52', '70', '38', '58', '66'];
            cols.forEach((c, j) => {
                const kids = [];
                if (c.type === 'party') kids.push(el('span', { class: 'atbl-bar atbl-bar--dot' }));
                kids.push(el('span', { class: 'atbl-bar', dataset: { w: widths[(i + j) % widths.length] } }));
                row.appendChild(
                    el('div', { class: 'atbl-cell atbl-cell--' + c.type + ' atbl-cell--' + c.align }, kids)
                );
            });
            return row;
        }

        function message(kind, text, action) {
            const box = el('div', {
                class: 'atbl-msg atbl-msg--' + kind,
                role: kind === 'failed' ? 'alert' : 'status'
            });
            box.appendChild(el('p', { class: 'atbl-msg__text', text }));
            if (action && action.label && typeof action.onClick === 'function') {
                const b = el('button', {
                    type: 'button',
                    class: 'atbl-msg__action',
                    text: String(action.label),
                    dataset: { atblFocus: 'msg-action' }
                });
                b.addEventListener('click', () => action.onClick());
                box.appendChild(b);
            }
            return box;
        }

        function renderFoot(state) {
            const f = opts.footer;
            if (!f || state !== 'ready') return null;
            const total = toCents(f.total);
            if (total == null || total < 0) return null;
            const noun = Array.isArray(f.noun) && f.noun.length === 2 ? f.noun : ['Row', 'Rows'];
            const page = Math.max(1, Math.floor(Number(f.page) || 1));
            const size = Math.max(1, Math.floor(Number(f.pageSize) || rowsIn().length || 1));
            const foot = el('div', { class: 'atbl-foot' }, [
                el('span', {
                    class: 'atbl-foot__count',
                    text: COUNT.format(total) + ' ' + (total === 1 ? noun[0] : noun[1])
                })
            ]);
            if (typeof f.onPage === 'function') {
                const prev = el(
                    'button',
                    {
                        type: 'button',
                        class: 'atbl-foot__nav',
                        'aria-label': 'Previous page',
                        dataset: { atblFocus: 'prev' }
                    },
                    [icon('chevron-left')]
                );
                const next = el(
                    'button',
                    {
                        type: 'button',
                        class: 'atbl-foot__nav',
                        'aria-label': 'Next page',
                        dataset: { atblFocus: 'next' }
                    },
                    [icon('chevron-right')]
                );
                prev.disabled = page <= 1;
                next.disabled = page * size >= total;
                prev.addEventListener('click', () => {
                    if (!prev.disabled) f.onPage(page - 1);
                });
                next.addEventListener('click', () => {
                    if (!next.disabled) f.onPage(page + 1);
                });
                foot.appendChild(el('span', { class: 'atbl-foot__navs' }, [prev, next]));
            }
            return foot;
        }

        function selectionKeys() {
            const order = rowsIn().map((r, i) => String(keyOf(r, i)));
            return order.filter((k) => selected.has(k)).map((k) => selected.get(k));
        }

        function emitSelect() {
            if (typeof opts.onSelect === 'function') opts.onSelect(selectionKeys());
        }

        /* A stuck header sits at the scroll container's CONTENT edge, not its
           border: Chromium and Firefox deflate the sticky rectangle by the
           container's padding. .portal-main carries 16px, so a header stuck at
           top: 0 left a 16px band where rows scrolled past ABOVE it (seen in
           the harness). Pull it up by exactly that padding. Layout only; a
           page that sets --atbl-sticky-top itself wins over this. */
        function stickyOffset() {
            let n = root.parentElement;
            while (n && n !== document.body && n !== document.documentElement) {
                const cs = window.getComputedStyle(n);
                if (/(auto|scroll|hidden)/.test(cs.overflowY || '')) {
                    const pad = parseFloat(cs.paddingTop) || 0;
                    root.style.setProperty('--atbl-auto-top', pad ? -pad + 'px' : '0px');
                    return;
                }
                n = n.parentElement;
            }
            root.style.setProperty('--atbl-auto-top', '0px');
        }

        function render() {
            if (destroyed) return;
            if (openPop && root.contains(openPop.anchor)) closePopup(false);
            const active = document.activeElement;
            const focusId = active && root.contains(active) ? active.getAttribute('data-atbl-focus') : null;
            const cols = visibleColumns();
            const state = stateOf();
            const live = state === 'ready';
            const ordered = live ? orderedRows(cols) : [];

            root.className =
                'atbl atbl--' +
                state +
                (opts.selectable ? ' atbl--selectable' : '') +
                (typeof opts.onRowClick === 'function' ? ' atbl--clickable' : '');
            root.style.setProperty('--atbl-cols', template(cols));
            root.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
            if (opts.label) root.setAttribute('aria-label', String(opts.label));

            // A rowgroup may only own rows, so the empty and failed sentences
            // (a status, an alert) sit in a plain box instead.
            const body = el('div', { class: 'atbl-body', role: live || state === 'loading' ? 'rowgroup' : null });
            if (state === 'loading') {
                const n = Math.max(1, Math.min(20, Number(opts.ghostRows) || 8));
                for (let i = 0; i < n; i++) body.appendChild(ghost(cols, i, false));
            } else if (state === 'empty') {
                const behind = el('div', { class: 'atbl-behind', 'aria-hidden': 'true' });
                for (let i = 0; i < 5; i++) behind.appendChild(ghost(cols, i, true));
                body.appendChild(behind);
                body.appendChild(message('empty', opts.emptyText || 'Nothing to show yet.', opts.emptyAction));
            } else if (state === 'failed') {
                body.appendChild(
                    message(
                        'failed',
                        opts.failedText || 'Could not load these rows. Nothing was changed.',
                        typeof opts.onRetry === 'function' ? { label: 'Try again', onClick: opts.onRetry } : null
                    )
                );
            } else {
                let group;
                ordered.forEach((item, i) => {
                    if (typeof opts.groupBy === 'function') {
                        const g = opts.groupBy(item.row);
                        const label = g == null || g === '' ? null : String(g);
                        if (label !== null && label !== group) {
                            body.appendChild(
                                el('div', { class: 'atbl-group', role: 'row' }, [
                                    el('div', { class: 'atbl-group__label', role: 'rowheader', text: label })
                                ])
                            );
                        }
                        group = label;
                    }
                    body.appendChild(bodyRow(cols, item, i, ordered));
                });
            }

            const head = renderHead(cols, ordered, live);
            const foot = renderFoot(state);
            root.replaceChildren(head, body);
            if (foot) root.appendChild(foot);

            if (root.isConnected) stickyOffset();

            if (focusId) {
                const again = Array.prototype.find.call(
                    root.querySelectorAll('[data-atbl-focus]'),
                    (n) => n.getAttribute('data-atbl-focus') === focusId
                );
                if (again && typeof again.focus === 'function') again.focus();
            }
        }

        /* Delegated row activation: a click anywhere on a row that is not on
           one of its own controls, or Enter while the row itself has focus. */
        function isControl(target) {
            return !!(
                target &&
                target.closest &&
                target.closest('button, a, input, label, textarea, [role="button"], .atbl-combo')
            );
        }

        function rowFromEvent(e) {
            const r = e.target && e.target.closest ? e.target.closest('.atbl-row') : null;
            if (!r || !root.contains(r) || r.classList.contains('atbl-ghost')) return null;
            const k = r.getAttribute('data-key');
            const rows = rowsIn();
            for (let i = 0; i < rows.length; i++) {
                if (String(keyOf(rows[i], i)) === k) return { node: r, row: rows[i] };
            }
            return null;
        }

        function onClick(e) {
            if (typeof opts.onRowClick !== 'function' || isControl(e.target)) return;
            const hit = rowFromEvent(e);
            if (hit) opts.onRowClick(hit.row, e);
        }

        function onKeydown(e) {
            const hit = rowFromEvent(e);
            if (!hit || e.target !== hit.node) return;
            if (e.key === 'Enter' && typeof opts.onRowClick === 'function') {
                e.preventDefault();
                opts.onRowClick(hit.row, e);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const rows = Array.prototype.slice.call(root.querySelectorAll('.atbl-row[tabindex="0"]'));
                const at = rows.indexOf(hit.node);
                const next = rows[e.key === 'ArrowDown' ? at + 1 : at - 1];
                if (next) {
                    e.preventDefault();
                    next.focus();
                }
            } else if (e.key === ' ' && opts.selectable) {
                e.preventDefault();
                const box = hit.node.querySelector('.atbl-check__box');
                if (box) box.click();
            }
        }

        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeydown);

        if (Array.isArray(opts.selected)) opts.selected.forEach((k) => selected.set(String(k), k));

        if (typeof window.ResizeObserver === 'function') {
            ro = new window.ResizeObserver((entries) => {
                const w = Math.round(entries[0].contentRect.width);
                if (!w || w === width) return;
                stickyOffset();
                const before = visibleColumns().length;
                width = w;
                if (visibleColumns().length !== before) render();
            });
            ro.observe(root);
        }

        render();

        return {
            update(partial) {
                if (destroyed || !partial) return;
                const p = Object.assign({}, partial);
                if ('sort' in p) sort = normSort(p.sort);
                opts = Object.assign({}, opts, p);
                if ('rows' in p) {
                    pending.clear();
                    saved.clear();
                    failed.clear();
                    lastClicked = -1;
                    const present = new Set(rowsIn().map((r, i) => String(keyOf(r, i))));
                    let dropped = false;
                    Array.from(selected.keys()).forEach((k) => {
                        if (!present.has(k)) {
                            selected.delete(k);
                            dropped = true;
                        }
                    });
                    if (dropped && !('selected' in p)) emitSelect();
                }
                if ('selected' in p) {
                    selected.clear();
                    (Array.isArray(p.selected) ? p.selected : []).forEach((k) => selected.set(String(k), k));
                }
                render();
            },
            selection() {
                return selectionKeys();
            },
            destroy() {
                if (destroyed) return;
                if (openPop && root.contains(openPop.anchor)) closePopup(false);
                destroyed = true;
                if (ro) ro.disconnect();
                root.removeEventListener('click', onClick);
                root.removeEventListener('keydown', onKeydown);
                if (root.parentNode) root.parentNode.removeChild(root);
            }
        };
    }

    window.ArgusTable = {
        mount,
        moneyParts,
        formatDate,
        initials,
        ICON_NAMES: Object.keys(ICONS)
    };
    Kit.__table = true;
})();
