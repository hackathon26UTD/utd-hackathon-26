/* ===========================================================================
 * Financials: money, date and percent formatting.  window.FinFormat
 *
 * Every figure on the Financials page is printed by one of these, so the
 * whole page agrees on how a number looks. Money arrives as INTEGER CENTS
 * (the wire contract, docs/superpowers/specs/2026-09-22-financials-insights-
 * design.md "Data contract"); nothing here ever receives dollars.
 *
 * TWO MONEY FORMATTERS, NEVER ONE (docs/ARGUS_INVENTORY_UI_CONTRACT.md 4):
 *   money(c)       a PERIOD TOTAL: whole dollars, 0 decimals   "-$911,605"
 *   moneyCents(c)  a UNIT AMOUNT:  exactly 2 decimals           "$1,726,276.31"
 * One formatter serving both printed $4.10 as $4 on the live page.
 *
 * The minus sign is U+2212 (Mercury's money formatter, overview.md
 * conventions), never a hyphen. A value that is not known (null, undefined,
 * NaN, an empty string) prints the EN DASH U+2013, never "$0": a failed or
 * unavailable read must not look like a quiet period.
 *
 * Intl is always called with an explicit 'en-US': a store laptop set to de-DE
 * would otherwise print 1.234 for one thousand two hundred.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.FinFormat) return;

    const MINUS = '−';
    const NONE = '–';
    const EN_DASH = '–';

    const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

    /**
     * A money input, read as cents. Finite numbers pass; a numeric string
     * passes too, because node-postgres hands bigint back as a string and a
     * forgotten Number() at the boundary should print the figure, not a dash.
     * Everything else is "not known" and returns null.
     */
    function num(v) {
        if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /** "$1,234" from a non-negative whole number of dollars. */
    function dollars(whole) {
        return '$' + INT.format(whole);
    }

    function signed(neg, body) {
        return (neg ? MINUS : '') + body;
    }

    /**
     * A period total: whole dollars, thousands separators, U+2212 for a loss.
     * Rounds half away from zero on the cent integer, so -$0.40 prints "$0"
     * (a sign on a zero is noise) and -$0.50 prints "-$1".
     */
    function money(v) {
        const c = num(v);
        if (c === null) return NONE;
        const whole = Math.round(Math.abs(c) / 100);
        return signed(c < 0 && whole > 0, dollars(whole));
    }

    /** Split cents into [negative, "1,234", "05"] with integer arithmetic only. */
    function parts(c) {
        const abs = Math.round(Math.abs(c));
        const whole = Math.floor(abs / 100);
        const frac = abs % 100;
        return [c < 0 && abs > 0, INT.format(whole), (frac < 10 ? '0' : '') + frac];
    }

    /** A unit amount: exactly two decimals, inline. Tooltips use this. */
    function moneyCents(v) {
        const c = num(v);
        if (c === null) return NONE;
        const p = parts(c);
        return signed(p[0], '$' + p[1] + '.' + p[2]);
    }

    /**
     * The compact figure: up to 3 significant digits and at most ONE decimal,
     * trailing zeros stripped, suffix K / M / B. Mercury's KPI and sankey
     * agree on this: $1.9M, $415K, $84.7K, $73K, $1M, -$912K, $2.7M.
     * Below $1,000 it is whole dollars ("$999", "$0").
     * A value that ROUNDS to 1000 of a unit rolls to the next unit, so
     * $999,999 is "$1M", never "$1000K".
     */
    const UNITS = [
        { at: 1e3, suffix: 'K' },
        { at: 1e6, suffix: 'M' },
        { at: 1e9, suffix: 'B' }
    ];

    function oneDecimal(n) {
        const s = (Math.round(n * 10) / 10).toFixed(1);
        return s.slice(-2) === '.0' ? s.slice(0, -2) : s;
    }

    function roundSig(scaled) {
        // 3 significant digits, capped at one decimal place.
        const decimals = scaled >= 100 ? 0 : 1;
        const f = decimals ? 10 : 1;
        return Math.round(scaled * f) / f;
    }

    function compactBody(absDollars) {
        if (Math.round(absDollars) < 1000) {
            const w = Math.round(absDollars);
            return { text: dollars(w), zero: w === 0 };
        }
        let i = 0;
        while (i < UNITS.length - 1 && absDollars >= UNITS[i + 1].at) i++;
        let r = roundSig(absDollars / UNITS[i].at);
        if (r >= 1000 && i < UNITS.length - 1) {
            i += 1;
            r = roundSig(absDollars / UNITS[i].at);
        }
        return { text: '$' + oneDecimal(r) + UNITS[i].suffix, zero: false };
    }

    function compact(v) {
        const c = num(v);
        if (c === null) return NONE;
        const b = compactBody(Math.abs(c) / 100);
        return signed(c < 0 && !b.zero, b.text);
    }

    /** An axis tick: compact, and zero is a bare "0" with no "$". */
    function axis(v) {
        const c = num(v);
        if (c === null) return '';
        if (Math.abs(c) < 50) return '0';
        return compact(c);
    }

    /**
     * An amount with SUPERSCRIPT cents, as an HTML string: "-$25" + raised
     * ".00". Only digits, "$", "," and the sign ever reach it, so it is safe
     * to set as innerHTML. moneyNode() below is the same thing as DOM.
     */
    function moneyHtml(v) {
        const c = num(v);
        if (c === null) return '<span class="fin-amt fin-amt--none">' + NONE + '</span>';
        const p = parts(c);
        return (
            '<span class="fin-amt' +
            (p[0] ? ' fin-amt--neg' : '') +
            '"><span class="fin-amt__int">' +
            signed(p[0], '$' + p[1]) +
            '</span><span class="fin-amt__cents">.' +
            p[2] +
            '</span></span>'
        );
    }

    function moneyNode(v) {
        const c = num(v);
        const root = document.createElement('span');
        if (c === null) {
            root.className = 'fin-amt fin-amt--none';
            root.textContent = NONE;
            return root;
        }
        const p = parts(c);
        root.className = 'fin-amt' + (p[0] ? ' fin-amt--neg' : '');
        const i = document.createElement('span');
        i.className = 'fin-amt__int';
        i.textContent = signed(p[0], '$' + p[1]);
        const f = document.createElement('span');
        f.className = 'fin-amt__cents';
        f.textContent = '.' + p[2];
        root.appendChild(i);
        root.appendChild(f);
        return root;
    }

    /* ── dates ──────────────────────────────────────────────────────────────
     * The wire carries calendar dates as "YYYY-MM-DD". They are business
     * days, not instants, so they are read as UTC and printed in UTC: a
     * browser in Honolulu must not print Sep 21 for Sep 22.            */
    const MON_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const MON_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
    const MON = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
    const MON_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const DAY_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?/;

    function parseDay(v) {
        if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
        if (typeof v !== 'string') return null;
        const m = v.match(DAY_RE);
        if (!m) return null;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1));
        return Number.isFinite(d.getTime()) ? d : null;
    }

    function isoDay(d) {
        return d.toISOString().slice(0, 10);
    }

    /** "Sep 22" */
    function date(v) {
        const d = parseDay(v);
        return d ? MON_DAY.format(d) : NONE;
    }

    /** "Sep 22, 2026" */
    function dateLong(v) {
        const d = parseDay(v);
        return d ? MON_DAY_YEAR.format(d) : NONE;
    }

    /** "Jun" */
    function month(v) {
        const d = parseDay(v);
        return d ? MON.format(d) : NONE;
    }

    /** "Jun 2026" */
    function monthYear(v) {
        const d = parseDay(v);
        return d ? MON_YEAR.format(d) : NONE;
    }

    /** "Q3" (the UTC quarter of the date). */
    function quarter(v) {
        const d = parseDay(v);
        return d ? 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) : NONE;
    }

    function localToday() {
        const n = new Date();
        const pad = (x) => (x < 10 ? '0' : '') + x;
        return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    }

    /**
     * A date range.
     *   style 'chip' (default)  "Jun 14" + EN DASH + "Today", no spaces; the end
     *                           reads "Today" when it IS today
     *   style 'pill'            "Jun 14 - Sep 22", the timeline label: a spaced
     *                           hyphen, never "Today" (Mercury prints both forms)
     * A range that crosses a year, or sits outside the current one, carries
     * the year on both ends so "Dec 1 to Jan 5" can never be read backwards.
     */
    function range(from, to, opts) {
        const o = opts || {};
        const a = parseDay(from);
        const b = parseDay(to);
        if (!a || !b) return NONE;
        const today = typeof o.today === 'string' ? o.today : localToday();
        const thisYear = Number(today.slice(0, 4));
        const years = a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCFullYear() !== thisYear;
        const fmt = (d) => (years ? MON_DAY_YEAR.format(d) : MON_DAY.format(d));
        if (o.style === 'pill') return fmt(a) + ' - ' + fmt(b);
        if (isoDay(a) === isoDay(b)) return isoDay(b) === today ? 'Today' : fmt(a);
        const end = isoDay(b) === today ? 'Today' : fmt(b);
        return fmt(a) + EN_DASH + end;
    }

    /** "29.5%": one decimal, always. The input is already a percentage. */
    function pct(v) {
        const n = num(v);
        if (n === null) return NONE;
        const r = Math.round(n * 10) / 10;
        return (r < 0 ? MINUS : '') + Math.abs(r).toFixed(1) + '%';
    }

    /** "1,234" for a count. */
    function count(v) {
        const n = num(v);
        if (n === null) return NONE;
        const r = Math.round(n);
        return (r < 0 ? MINUS : '') + INT.format(Math.abs(r));
    }

    window.FinFormat = Object.freeze({
        MINUS: MINUS,
        NONE: NONE,
        money: money,
        moneyCents: moneyCents,
        compact: compact,
        axis: axis,
        moneyHtml: moneyHtml,
        moneyNode: moneyNode,
        date: date,
        dateLong: dateLong,
        month: month,
        monthYear: monthYear,
        quarter: quarter,
        range: range,
        pct: pct,
        count: count,
        parseDay: parseDay,
        isKnown: function isKnown(v) {
            return num(v) !== null;
        }
    });
})();
