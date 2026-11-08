/* ============================================================================
 * INVENTORY · ANALYTICS › REPORTS (rebuilt 2026-09-24)
 *
 * What sold, what sat still and what was lost over a period, plus what the
 * stock is worth right now. docs/ARGUS_PORTAL_REBUILD_2026_09_24.md: a toolbar
 * (the range as a segmented control, the read's source on the right), a strip
 * of Kit.balance KPI cards, then framed tables. Mounted by analytics-group.js
 * inside its `.kit.inv-sub` root, which draws the page title; this view draws
 * no heading of its own.
 *
 * ⛔⛔ EVERY NUMBER IS A FIELD OF `InventoryAPI.fetchAnalytics`, AND THE READ
 * IS THE ADAPTER. It resolves `{ok:false, reason}` for a failure rather than
 * an empty payload, because an empty chart and a failed request are different
 * sentences. A hand-rolled fetch once resolved the demo guard's `data: []` to
 * a bare array and painted LIVE over four zeros.
 *
 * ⛔⛔ A FAILURE IS NEVER A ZERO. Each KPI settles three ways: an answer, an
 * absence that says which absence it is (`notSetUp` + the plain reason), or a
 * failed read (`notLoaded`). Each table settles the same three ways: rows, a
 * guided empty state, or Kit.unread with a retry.
 *
 * ⛔ A MISSING ARRAY AND AN EMPTY ONE ARE DIFFERENT ANSWERS (arrayOr below).
 *
 * ⛔ ONE RANGE FOR THE WHOLE VIEW. The register-exceptions table is handed the
 * same `{days}`, so no two blocks on this screen can show different periods
 * under one label. A stale answer never paints over a newer pick (`seq`).
 *
 * ⛔ THE VALUATION AND STOCK HEALTH ARE NOT RANGED. They sit below a labelled
 * "Right now" seam; between a "30 days" toolbar and a 30-day table an
 * unlabelled balance-sheet figure reads as a 30-day number.
 *
 * ⛔ NO CHARTING LIBRARY. Charts here are Kit.balance and CSS bars, so a CDN
 * hiccup cannot take the KPI row, the tables or the range control down with it.
 * __tests__/pages-render-without-their-dependencies.contract.test.js keeps
 * this file off the charting global; do not name it in code here.
 * ========================================================================== */

(function () {
    'use strict';

    /* The only three GET /analytics accepts (api.js validates the same list). */
    const PERIODS = [
        { id: '7d', label: '7 days', days: 7 },
        { id: '30d', label: '30 days', days: 30 },
        { id: '90d', label: '90 days', days: 90 }
    ];
    const DEFAULT_PERIOD = '30d';

    /* ⛔ EXPLICIT LOCALE. A store laptop set to de-DE renders `1.234` for one
       thousand two hundred, and a count that reads "1.2" is a wrong number. */
    const NUM = new Intl.NumberFormat('en-US');

    /* The KPI card is a period total, so it rounds to whole dollars. */
    const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const money0 = (v) => MONEY.format(v);

    /* A figure inside a TABLE takes the one table look (ArgusTable.moneyParts):
       dollars and cents, en-US, U+2212 for a negative. The owner asked for one
       money format across every table. Amounts here arrive in dollars. The
       fallback prints the same thing when the kit table did not load. */
    const CENTS = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    function tableMoney(v) {
        const cents = Math.round(Number(v) * 100);
        const AT = window.ArgusTable;
        const parts = AT && typeof AT.moneyParts === 'function' ? AT.moneyParts(cents) : null;
        if (parts) return parts.text;
        return (cents < 0 ? '\u2212' : '') + CENTS.format(Math.abs(cents) / 100);
    }

    const KPIS = [
        { key: 'spend', label: 'Purchase spend' },
        { key: 'sold', label: 'Units sold' },
        { key: 'loss', label: 'Stock lost' },
        { key: 'critical', label: 'Critical / out' }
    ];
    const LABEL = {};
    KPIS.forEach((k) => {
        LABEL[k.key] = k.label;
    });

    const isNum = (v) => typeof v === 'number' && isFinite(v);

    /* ⛔ A MISSING ARRAY AND AN EMPTY ONE ARE DIFFERENT ANSWERS. `|| []`
       collapses them, which is how "the field was not in the payload" became
       a measured zero. Returns null when no candidate is an array. */
    function arrayOr(...candidates) {
        for (const c of candidates) if (Array.isArray(c)) return c;
        return null;
    }

    function periodMeta(id) {
        return PERIODS.find((p) => p.id === id) || PERIODS[1];
    }

    /* The source badge has four states and a failed read must reach the
       fourth: an answer is LIVE, the demo guard is DEMO DATA, anything else is
       COULD NOT READ. */
    function sourceFor(res) {
        if (res && res.ok) return 'live';
        if (res && res.reason === 'demo-guard') return 'demo';
        return 'unavailable';
    }

    /* ── Count coverage: is "Critical / out" a count or an estimate? ──────
       An item nobody has counted has no known on-hand: its quantity is
       register sales run down from zero, so it reads "out" by construction.
       `fetchCountCoverage` resolves {ok:false} for a failure, and the
       conservative reading of "we could not check" keeps the caveat. */
    function criticalIsCounted(counts) {
        return !!(counts && Number(counts.items) > 0 && Number(counts.neverCounted) === 0);
    }

    async function fetchCounts() {
        try {
            const api = window.InventoryAPI;
            if (!api || typeof api.fetchCountCoverage !== 'function') return null;
            const r = await api.fetchCountCoverage();
            return r && r.ok && r.data ? r.data : null;
        } catch (_e) {
            return null;
        }
    }

    /* ── KPI views: pure, a read in and Kit.balance options out ───────────
       ⛔ The two halves of the window, said in words. "+15%" with no period
       named is not a fact, and a series too short to halve gets no comparison. */
    function halfOverHalf(series, label) {
        const n = (series || []).map(Number).filter((v) => isFinite(v));
        if (n.length < 4) return 'Over the last ' + label + '.';
        const mid = Math.floor(n.length / 2);
        const a = n.slice(0, mid).reduce((s, v) => s + v, 0);
        const b = n.slice(mid).reduce((s, v) => s + v, 0);
        if (a === 0) return 'No earlier figure to compare.';
        const pct = Math.round(((b - a) / Math.abs(a)) * 100);
        if (pct === 0) return 'Level across the last ' + label + '.';
        return (pct > 0 ? 'Up ' : 'Down ') + Math.abs(pct) + '% on the first half of the last ' + label + '.';
    }

    const BADGE = {
        spend: { icon: 'tag', title: 'Added up from scanned supplier invoices' },
        sold: { icon: 'register', title: 'From register sales' },
        loss: { icon: 'box', title: 'Confirmed theft, write-offs and counts lowered by hand' },
        critical: { icon: 'box', title: 'Stock on hand right now' }
    };

    function absent(key, state, why) {
        return { label: LABEL[key], badge: BADGE[key], state: state, emptyText: why };
    }

    /**
     * Purchase spend: invoices, not purchase orders (nobody creates a PO in
     * this product). Drawn as a running total a day at a time, so the last
     * point, which is the headline, is the period's total.
     *
     * ⛔⛔ NO INVOICES IS NOT $0. "Nothing has been recorded" and "we added the
     * invoices up and they came to nothing" are different claims.
     */
    function spendView(d, ctx) {
        ctx = ctx || { label: '30 days' };
        const rows = arrayOr(d && d.spendTrend);
        if (!rows) return absent('spend', 'notSetUp', 'The spend series was not in this answer.');
        if (!rows.length) {
            const opts = absent('spend', 'notSetUp', 'No supplier invoices recorded in this period.');
            if (ctx && typeof ctx.nav === 'function') {
                opts.action = { label: 'Scan an invoice', onClick: () => ctx.nav('receive') };
            }
            return opts;
        }
        const daily = rows.map((p) => Number(p && p.spend) || 0);
        let run = 0;
        const series = rows.map((p, i) => {
            run += daily[i];
            return { x: p && p.date, y: run };
        });
        return {
            label: LABEL.spend,
            badge: BADGE.spend,
            series: series,
            value: run,
            format: money0,
            emptyText: 'Over the last ' + ctx.label + '.',
            note: halfOverHalf(daily, ctx.label)
        };
    }

    function soldView(d, ctx) {
        ctx = ctx || { label: '30 days' };
        const rows = arrayOr(d && d.topPerformers);
        if (!rows) return absent('sold', 'notSetUp', 'The sales ranking was not in this answer.');
        if (!rows.length) return absent('sold', 'notSetUp', 'No register sales in this window.');
        const total = rows.reduce((s, r) => s + (Number(r && r.units) || 0), 0);
        return {
            label: LABEL.sold,
            badge: BADGE.sold,
            value: total,
            format: 'number',
            emptyText: 'Across the top ' + rows.length + ' items, last ' + ctx.label + '.'
        };
    }

    /* ⛔ NEW KEY FIRST, OLD KEY AS FALLBACK. `wastageByCategory` was renamed
       because the number changed meaning, and the server caches five minutes,
       so right after a deploy this can still be handed a pre-rename object. */
    function lossRowsOf(d) {
        return arrayOr(d && d.stockLossByCategory, d && d.wastageByCategory);
    }

    function lossView(d, ctx) {
        ctx = ctx || { label: '30 days' };
        const rows = lossRowsOf(d);
        if (!rows) return absent('loss', 'notSetUp', 'The loss breakdown was not in this answer.');
        if (!rows.length) {
            return absent('loss', 'notSetUp', 'Nothing recorded yet. Confirmed shrink and write-downs appear here.');
        }
        const total = rows.reduce((s, r) => s + (Number(r && r.qty) || 0), 0);
        return {
            label: LABEL.loss,
            badge: BADGE.loss,
            value: total,
            format: 'number',
            emptyText: 'Units, across ' + rows.length + ' categories, last ' + ctx.label + '.'
        };
    }

    /* ⛔ THE CAVEAT RIDES THE LABEL. A figure nobody can stand behind carries
       the word where the eye lands first, and the reason in the card's note. */
    function criticalView(d, counts) {
        const health = d && d.stockHealth && typeof d.stockHealth === 'object' ? d.stockHealth : null;
        const critical = health ? Number(health.critical) : NaN;
        if (!health || !isFinite(critical)) {
            return absent('critical', 'notSetUp', 'Stock health was not in this answer.');
        }
        const counted = criticalIsCounted(counts);
        return {
            label: counted ? LABEL.critical : LABEL.critical + ' (estimated)',
            badge: BADGE.critical,
            value: critical,
            format: 'number',
            emptyText: counted ? 'At or below zero on hand, right now.' : 'Right now. Never-counted items read as out.',
            note: counted
                ? null
                : 'Items nobody has counted have no known stock, so they count as out here. A count sets the real figure.',
            estimated: !counted
        };
    }

    /* ── Table cells ──────────────────────────────────────────────────────── */

    function subline(r) {
        return [r.sku, r.category].filter(Boolean).join(' · ') || 'No SKU';
    }

    function itemCell(Kit, r) {
        return Kit.el('div', {}, [
            Kit.el('div', { class: 'inv-sub__cell-main', text: r.name || 'Unnamed item' }),
            Kit.el('div', { class: 'inv-sub__cell-sub', text: subline(r) })
        ]);
    }

    /**
     * A figure with a slim bar under it.
     *
     * ⛔⛔ THE BAR AND THE RANKING MEASURE THE SAME FIELD, OR THE ROW GETS NO
     * BAR. A list once scaled by retail value where it existed and by units
     * where it did not, into one shared maximum, so a dollar row and a unit row
     * were drawn against the same axis. A null magnitude now gets an empty
     * track and `data-nobar`: there is nothing to compare it on.
     */
    function metric(Kit, text, mag, max, i) {
        const none = mag === null;
        const track = Kit.el('span', {
            class: 'inv-an__track' + (none ? ' inv-an__track--none' : ''),
            'data-nobar': none ? '1' : null,
            'aria-hidden': 'true'
        });
        if (!none) {
            const fill = Kit.el('span', { class: 'inv-an__fill' });
            // Geometry only: the width is the row's share of the largest.
            fill.style.width = (max > 0 ? Math.max(2, (Math.max(0, mag) / max) * 100) : 2) + '%';
            fill.style.setProperty('--motion-i', String(i));
            track.appendChild(fill);
        }
        return Kit.el('div', { class: 'inv-an__metric' }, [Kit.el('span', { class: 'inv-an__metric-n', text }), track]);
    }

    function magnitudes(rows, pick) {
        const mags = rows.map((r) => {
            const v = pick(r);
            return isNum(v) ? v : null;
        });
        const max = mags.reduce((m, v) => (v !== null && v > m ? v : m), 0);
        return { mags, max };
    }

    /**
     * Tied-up capital, with the basis it was priced on.
     *
     * ⛔ `getInventoryAnalytics` prices `tied_value` at COST and falls back to
     * RETAIL for an item with no cost on file, emitting `costBasis` for exactly
     * this. And the fallback is the normal case: a price-book import has no
     * cost column, so every row of such a store is a retail figure that
     * overstates tied capital by the whole margin. Worded the same way as
     * `_argusShrinkValueText` in argus.js on purpose.
     */
    function tiedValueText(v, basis) {
        if (v === null || v === undefined || !isFinite(Number(v))) return 'no cost or price on file';
        const m = tableMoney(v);
        if (basis === 'retail_fallback') return m + ' at retail';
        // 'cost' reads bare; an unrecorded basis says nothing rather than
        // implying a cost it cannot vouch for.
        return m;
    }

    function guided(Kit, title, body, action) {
        return Kit.el('div', { class: 'inv-sub__empty' }, [
            Kit.el('div', { class: 'inv-sub__empty-title', text: title }),
            Kit.el('p', { class: 'inv-sub__empty-body', text: body }),
            action && typeof action.onClick === 'function'
                ? Kit.el('div', { class: 'inv-sub__empty-acts' }, [
                      (function () {
                          const b = Kit.el('button', {
                              class: 'kit-btn kit-btn--primary',
                              type: 'button',
                              text: action.label
                          });
                          b.addEventListener('click', action.onClick);
                          return b;
                      })()
                  ])
                : null
        ]);
    }

    /* Each ranked table is `{ node, meta, tip, foot }`: the section shell
       places them, so the words that qualify a table sit where the rebuild
       spec puts them (the count in the meta, the basis in the "?" tip, a caveat
       that changes the number in the one-line foot). */
    function bestTable(Kit, rows) {
        const tip = 'Ranked by retail value sold over the period above. Units come from the register.';
        if (!rows.length) {
            return {
                node: guided(
                    Kit,
                    'No sales recorded in this period',
                    'Sales come from the register. Until it reports, there is nothing to rank.'
                ),
                tip
            };
        }
        const { mags, max } = magnitudes(rows, (r) => r.retailValue);
        const unpriced = mags.filter((m) => m === null).length;
        return {
            node: Kit.table({
                columns: [
                    { key: 'item', label: 'Item', render: (r) => itemCell(Kit, r) },
                    { key: 'units', label: 'Sold', align: 'right', render: (r) => NUM.format(Number(r.units) || 0) },
                    {
                        key: 'value',
                        label: 'Retail value',
                        align: 'right',
                        width: '36%',
                        render: (r, i) =>
                            metric(
                                Kit,
                                isNum(r.retailValue) ? tableMoney(r.retailValue) : 'no price set',
                                mags[i],
                                max,
                                i
                            )
                    }
                ],
                rows: rows,
                rowKey: (r, i) => r.sku || String(i)
            }),
            meta: rows.length === 1 ? '1 item' : rows.length + ' items',
            tip,
            foot: unpriced ? unpriced + ' of ' + rows.length + ' have no price set, so they have no bar.' : null
        };
    }

    function worstTable(Kit, rows, health) {
        if (!rows.length) {
            /* An empty list means "nothing is sitting idle" only when there IS
               stock to sit idle; with no active items it would claim every
               item sold, which is not true of any of them. */
            const hasStock = !!(health && Number(health.total) > 0);
            return {
                node: hasStock
                    ? guided(Kit, 'Nothing idle', 'Every stocked item sold at least once this period.')
                    : guided(Kit, 'No stocked items yet', 'This fills in once the catalogue carries stock.'),
                tip: 'Items on the shelf that did not sell in the period above.'
            };
        }
        const { mags, max } = magnitudes(rows, (r) => r.tiedValue);
        /* ⛔ THE WORDS CHANGE WITH THE NUMBERS. "The money standing still in
           it" is a claim about capital: true of a cost-priced row, false of a
           retail one, and on a price-book catalogue every row is the latter. */
        const fellBack = rows.filter((r) => r.costBasis === 'retail_fallback').length;
        const foot =
            fellBack === 0
                ? null
                : fellBack === rows.length
                  ? 'No cost is on file for these, so they are valued at retail. The capital tied up is lower by your margin.'
                  : fellBack +
                    ' of ' +
                    rows.length +
                    ' have no cost on file and are valued at retail, which overstates the capital tied up in them.';
        return {
            node: Kit.table({
                columns: [
                    { key: 'item', label: 'Item', render: (r) => itemCell(Kit, r) },
                    {
                        key: 'onHand',
                        label: 'On hand',
                        align: 'right',
                        render: (r) => NUM.format(Number(r.onHand) || 0) + ' on hand'
                    },
                    {
                        key: 'tied',
                        label: 'Tied up',
                        align: 'right',
                        width: '36%',
                        render: (r, i) => metric(Kit, tiedValueText(r.tiedValue, r.costBasis), mags[i], max, i)
                    }
                ],
                rows: rows,
                rowKey: (r, i) => r.sku || String(i)
            }),
            meta: rows.length === 1 ? '1 item' : rows.length + ' items',
            tip:
                fellBack === 0
                    ? 'On the shelf, nothing sold this period. Ranked by the money standing still in it, at cost.'
                    : 'On the shelf, nothing sold this period. Ranked by value: at cost where a cost is on file, at retail where it is not.',
            foot
        };
    }

    function lossTable(Kit, rows) {
        const tip =
            'Stock that left without being sold in the period above: confirmed theft, write-offs and counts ' +
            'lowered by hand. A lowered count can be a recount rather than a loss.';
        if (!rows.length) {
            /* ⛔ NOT "nice". Zero recorded loss on a store that has never written
               a shrink event or a write-down is an absence of records, not a
               clean result. */
            return {
                node: guided(Kit, 'Nothing recorded yet', 'Confirmed shrink and manual write-downs appear here.'),
                tip
            };
        }
        const { mags, max } = magnitudes(rows, (r) => r.qty);
        return {
            node: Kit.table({
                columns: [
                    {
                        key: 'category',
                        label: 'Category',
                        render: (r) =>
                            Kit.el('div', { class: 'inv-sub__cell-main', text: r.category || 'Uncategorized' })
                    },
                    {
                        key: 'qty',
                        label: 'Units lost',
                        align: 'right',
                        width: '44%',
                        render: (r, i) =>
                            metric(Kit, isNum(r.qty) ? NUM.format(r.qty) + ' units' : 'not recorded', mags[i], max, i)
                    }
                ],
                rows: rows,
                rowKey: (r, i) => r.category || String(i)
            }),
            meta: rows.length === 1 ? '1 category' : rows.length + ' categories',
            tip
        };
    }

    /* ── Stock health: a compact band that draws in once ────────────────────
       Point in time, so it lives below the seam. The exceptions lead: 14
       critical out of 2,202 is 0.6% of a bar's width, a sliver that reads as
       "all fine" while fourteen shelves are empty. */
    function healthBand(Kit, health, addItem) {
        if (!health) {
            return guided(Kit, 'Stock health not available yet', 'Stock health was not in this answer.');
        }
        const total = Number(health.total);
        if (!isFinite(total) || total <= 0) {
            return guided(
                Kit,
                'No stocked items yet',
                'Stock health fills in once the catalogue carries items.',
                typeof addItem === 'function' ? { label: 'Add an item', onClick: addItem } : null
            );
        }
        const rows = [
            { label: 'Critical', tone: 'critical', n: Number(health.critical) || 0 },
            { label: 'Low', tone: 'low', n: Number(health.low) || 0 },
            { label: 'Healthy', tone: 'healthy', n: Number(health.healthy) || 0 }
        ];
        const needing = rows[0].n + rows[1].n;
        const figure = Kit.el('span', { class: 'inv-an__health-figure', text: NUM.format(needing) });
        const bar = Kit.el(
            'div',
            {
                class: 'inv-an__health-bar',
                role: 'img',
                'aria-label': rows.map((r) => r.label + ' ' + r.n).join(', ')
            },
            rows
                .filter((r) => r.n > 0)
                .map((r) => {
                    const seg = Kit.el('span', { class: 'inv-an__health-seg inv-an__health-seg--' + r.tone });
                    seg.style.flexGrow = String(r.n);
                    return seg;
                })
        );
        const band = Kit.el('div', { class: 'inv-an__health' }, [
            Kit.el('div', { class: 'inv-an__health-lead' }, [
                figure,
                Kit.el('span', {
                    class: 'inv-an__health-caption',
                    text: (needing === 1 ? 'item needs' : 'items need') + ' attention, of ' + NUM.format(total)
                })
            ]),
            bar,
            Kit.el(
                'div',
                { class: 'inv-an__health-legend' },
                rows.map((r) =>
                    Kit.el('span', { class: 'inv-an__health-key' }, [
                        Kit.el('span', { class: 'inv-an__health-dot inv-an__health-dot--' + r.tone }),
                        Kit.el('span', { text: r.label + ' ' + NUM.format(r.n) })
                    ])
                )
            )
        ]);
        const M = Kit.motion;
        if (M) {
            // The band watches its wrapper: the bar is what waits clipped, and
            // a clipped element is never seen.
            if (typeof M.countText === 'function') {
                M.countText(figure, 'inv-an-health', needing, (v) => NUM.format(Math.round(v)));
            }
            if (typeof M.reveal === 'function') M.reveal(band, 'inv-an-health');
        }
        return band;
    }

    /* ── The section shell ──────────────────────────────────────────────── */
    let tipSeq = 0;

    function section(Kit, key, title) {
        tipSeq += 1;
        const tipId = 'inv-an-tip-' + tipSeq;
        const meta = Kit.el('span', { class: 'inv-sub__sec-meta' });
        const tip = Kit.el('p', { class: 'inv-sub__tip', id: tipId, hidden: 'hidden' });
        const help = Kit.el('button', {
            class: 'inv-sub__help',
            type: 'button',
            text: '?',
            'aria-label': 'About ' + title.toLowerCase(),
            'aria-expanded': 'false',
            'aria-controls': tipId
        });
        // Shown once there is a basis to explain.
        help.hidden = true;
        help.addEventListener('click', () => {
            const open = tip.hidden;
            tip.hidden = !open;
            help.setAttribute('aria-expanded', String(open));
        });
        const body = Kit.el('div', { ['data-an-' + key]: '1' });
        const foot = Kit.el('div', { class: 'inv-sub__foot', hidden: 'hidden' });
        const sec = Kit.el('section', { class: 'inv-sub__sec', 'data-an-sec': key }, [
            Kit.el('div', { class: 'inv-sub__sec-head' }, [
                Kit.el('h3', { class: 'inv-sub__sec-title', text: title }),
                meta,
                Kit.el('span', { class: 'inv-sub__sec-spacer' }),
                help
            ]),
            tip,
            body,
            foot
        ]);
        return {
            sec,
            body,
            fill(part, revealKey) {
                meta.textContent = (part && part.meta) || '';
                tip.textContent = (part && part.tip) || '';
                help.hidden = !(part && part.tip);
                foot.textContent = (part && part.foot) || '';
                foot.hidden = !(part && part.foot);
                body.replaceChildren(part.node);
                /* The bars draw in once per visit. The reveal watches the NEW
                   table, never the section that outlives it: a class left on
                   the section would replay the bars on every range change. */
                if (revealKey && part.node.classList && part.node.classList.contains('kit-table')) {
                    const M = Kit.motion;
                    if (M && typeof M.reveal === 'function') M.reveal(part.node, revealKey);
                }
            },
            state(node) {
                meta.textContent = '';
                foot.textContent = '';
                foot.hidden = true;
                body.replaceChildren(node);
            }
        };
    }

    /* ── KPI slots ──────────────────────────────────────────────────────── */
    function waiting(Kit, label) {
        return Kit.el('div', { class: 'inv-sub__kpi-wait', 'aria-busy': 'true' }, [
            Kit.el('span', { class: 'inv-sub__kpi-wait-label', text: label }),
            Kit.el('span', { class: 'inv-sub__kpi-wait-bar', 'aria-hidden': 'true' })
        ]);
    }

    function paintKpi(Kit, root, key, opts) {
        const slot = root.querySelector('[data-kpi="' + key + '"]');
        if (!slot) return;
        slot.removeAttribute('data-pending');
        const card = Kit.balance(opts);
        if (opts.estimated) {
            slot.setAttribute('data-estimated', '1');
            const note = card.querySelector('.kit-bal__note');
            if (note) note.setAttribute('data-role', 'critical-estimated');
        } else {
            slot.removeAttribute('data-estimated');
        }
        slot.replaceChildren(card);
    }

    function cannotDraw(container) {
        const p = document.createElement('p');
        p.className = 'inv-analytics__nokit';
        p.textContent = 'Reports could not be drawn. Reload the page to try again.';
        container.replaceChildren(p);
    }

    function nav() {
        const s = window.InventoryShell;
        if (!s || typeof s.renderSection !== 'function') return null;
        return (section, tab) => s.renderSection(section, tab);
    }

    function addItemAction() {
        const m = window.InventoryModals;
        return m && typeof m.openAddItem === 'function' ? () => m.openAddItem() : null;
    }

    // ── Render ───────────────────────────────────────────────────────────
    function render(container) {
        if (!container) return null;
        const Kit = window.Kit;
        if (!Kit || typeof Kit.balance !== 'function' || typeof Kit.table !== 'function') {
            cannotDraw(container);
            return null;
        }
        const el = Kit.el;
        let period = DEFAULT_PERIOD;
        /* A stale answer must never paint over a newer one: a 90d reply that
           lands after a 7d pick would put a 90-day total under "7 days". */
        let seq = 0;

        const range = Kit.segs({
            label: 'Reporting period',
            value: period,
            options: PERIODS.map((p) => ({ id: p.id, label: p.label })),
            onChange: (id) => {
                if (id === period) return;
                period = id;
                load();
            }
        });
        const source = el('span', { class: 'inv-an__source', 'data-an-source': '1' });

        const kpis = el(
            'section',
            { class: 'inv-sub__kpis', 'aria-label': 'Key figures' },
            KPIS.map((k) =>
                el('div', { class: 'inv-sub__kpi', 'data-kpi': k.key, 'data-pending': '1' }, [waiting(Kit, k.label)])
            )
        );

        // Ranked by retail value (the server's order), so it is named for that.
        const best = section(Kit, 'best', 'Top sellers');
        const worst = section(Kit, 'worst', 'Not selling');
        const loss = section(Kit, 'loss', 'Stock lost by category');
        const health = section(Kit, 'health', 'Stock health');

        /* The till report is RANGED, so it takes the page window. Mounted,
           never reimplemented: one implementation keeps its "a rate under the
           noise gate is withheld" rule true. */
        const rexHost = el('div', { 'data-an-rex': '1' });

        const seamText = el('span', { class: 'inv-an__seam-label' });
        const seam = el('div', { class: 'inv-an__seam', role: 'separator' }, [seamText]);
        const valHost = el('div', { 'data-an-val': '1' });
        const hasValuation = !!(window.InventoryValuation && typeof window.InventoryValuation.render === 'function');

        const root = el('div', { class: 'inv-an-reports' }, [
            Kit.toolbar({ segs: range, primary: source }),
            kpis,
            el('div', { class: 'inv-an__ranks' }, [best.sec, worst.sec, loss.sec]),
            rexHost,
            seam,
            health.sec,
            hasValuation ? valHost : null
        ]);
        container.replaceChildren(root);
        if (hasValuation) window.InventoryValuation.render(valHost);

        function markPending() {
            KPIS.forEach((k) => {
                const slot = root.querySelector('[data-kpi="' + k.key + '"]');
                if (!slot) return;
                slot.setAttribute('data-pending', '1');
                slot.removeAttribute('data-estimated');
                slot.replaceChildren(waiting(Kit, k.label));
            });
            [best, worst, loss, health].forEach((s) => s.state(Kit.skeleton('table', 4)));
            source.replaceChildren();
        }

        function paintFailure(why, demo) {
            KPIS.forEach((k) => paintKpi(Kit, root, k.key, absent(k.key, demo ? 'notSetUp' : 'notLoaded', why)));
            if (demo) {
                const sample = () =>
                    guided(
                        Kit,
                        'Sample account',
                        'This is a demo account, so there is no register behind these reports.'
                    );
                [best, worst, loss, health].forEach((s) => s.state(sample()));
                return;
            }
            best.state(Kit.unread({ what: 'the sales ranking', onRetry: load }));
            worst.state(Kit.unread({ what: 'the items not selling', onRetry: load }));
            loss.state(Kit.unread({ what: 'the stock lost', onRetry: load }));
            health.state(Kit.unread({ what: 'stock health', onRetry: load }));
        }

        function paintAnswer(d, meta, counts) {
            const ctx = { label: meta.label, nav: nav() };
            paintKpi(Kit, root, 'spend', spendView(d, ctx));
            paintKpi(Kit, root, 'sold', soldView(d, ctx));
            paintKpi(Kit, root, 'loss', lossView(d, ctx));
            paintKpi(Kit, root, 'critical', criticalView(d, counts));

            const healthObj = d.stockHealth && typeof d.stockHealth === 'object' ? d.stockHealth : null;
            /* ⛔ A list missing from the answer is a third state, not an empty
               list: "no sales" would be a claim the server never made. */
            const notInAnswer = () =>
                guided(
                    Kit,
                    'Not in this answer',
                    'The report came back without this list, so there is nothing to show. It is not the same as none.'
                );
            const bestRows = arrayOr(d.topPerformers);
            const worstRows = arrayOr(d.underperformers);
            const lossRows = lossRowsOf(d);
            if (bestRows) best.fill(bestTable(Kit, bestRows), 'inv-an-best');
            else best.state(notInAnswer());
            if (worstRows) worst.fill(worstTable(Kit, worstRows, healthObj), 'inv-an-worst');
            else worst.state(notInAnswer());
            if (lossRows) loss.fill(lossTable(Kit, lossRows), 'inv-an-loss');
            else loss.state(notInAnswer());
            health.fill({
                node: healthBand(Kit, healthObj, addItemAction()),
                meta: 'right now',
                tip:
                    'Critical: none on the shelf, or under half its reorder point. Low: under its reorder point. ' +
                    'Healthy: in stock and at or above it.'
            });
        }

        function load() {
            const run = ++seq;
            const meta = periodMeta(period);
            const api = window.InventoryAPI;

            markPending();
            seamText.textContent = 'Right now, not the last ' + meta.label;

            if (window.InventoryRegisterExceptions && typeof window.InventoryRegisterExceptions.render === 'function') {
                window.InventoryRegisterExceptions.render(rexHost, { days: meta.days });
            }

            const countsP = fetchCounts();

            if (!api || typeof api.fetchAnalytics !== 'function') {
                source.replaceChildren(sourceBadge('unavailable'));
                paintFailure('The reports API is not loaded. Reload the page.');
                return;
            }

            api.fetchAnalytics({ period })
                .then(async (res) => {
                    if (run !== seq) return;
                    const src = sourceFor(res);
                    source.replaceChildren(sourceBadge(src));
                    /* ⛔ fetchAnalytics RESOLVES {ok:false} FOR A FAILURE rather
                       than rejecting, so a .catch() alone would leave every
                       card waiting for ever. */
                    if (!res || !res.ok || !res.data) {
                        paintFailure(
                            src === 'demo'
                                ? 'This is a demo account, so there is no register behind it.'
                                : 'Did not load. This is a failed read, not a zero.',
                            src === 'demo'
                        );
                        return;
                    }
                    const counts = await countsP;
                    if (run !== seq) return;
                    paintAnswer(res.data, meta, counts);
                })
                .catch(() => {
                    if (run !== seq) return;
                    source.replaceChildren(sourceBadge('unavailable'));
                    paintFailure('Did not load. This is a failed read, not a zero.');
                });
        }

        load();
        return root;
    }

    function sourceBadge(source) {
        const api = window.InventoryAPI;
        if (api && typeof api.renderSourcePill === 'function') {
            // POS-derived: movement, sell-through and the till report all come
            // off the register, so a stopped register freezes every one of them.
            return api.renderSourcePill(source, { posDerived: true });
        }
        const s = document.createElement('span');
        s.textContent = source === 'live' ? 'LIVE' : source === 'demo' ? 'DEMO DATA' : 'COULD NOT READ';
        return s;
    }

    /* ⚠️ THIS IS NOT THE `analytics` SECTION. analytics-group.js owns that id
       and renders this view as "Reports" beside Forecast and Shrink. */
    window.InventoryAnalyticsReports = {
        render: render,
        // seams for tests: the pure halves
        _internal: {
            spendView,
            soldView,
            lossView,
            criticalView,
            bestTable,
            worstTable,
            lossTable,
            healthBand,
            tiedValueText,
            halfOverHalf,
            criticalIsCounted,
            sourceFor,
            arrayOr,
            MONEY,
            tableMoney,
            NUM,
            PERIODS
        }
    };
})();
