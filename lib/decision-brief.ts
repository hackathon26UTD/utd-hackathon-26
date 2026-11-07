import { forecast, money, shortDate, explainForecast } from "./forecast";
import { stressCases, stressedForecast } from "./decision";
import type { Portfolio, Scenario } from "./model";
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function decisionBrief(
  portfolio: Portfolio,
  scenario: Scenario,
): string {
  const f = forecast(portfolio, scenario);
  const cases =
    scenario.kind === "internship"
      ? stressCases
      : stressCases.filter((c) => c.id === "expense");
  const rows = [
    [
      "Monthly rent",
      money(
        scenario.kind === "internship"
          ? scenario.rentCents
          : portfolio.campusRentCents,
      ),
    ],
    [
      "Take-home income",
      scenario.kind === "internship"
        ? `${money(scenario.paycheckCents)} every 14 days`
        : `${money(portfolio.campusPayCents)} monthly`,
    ],
    [
      "First internship paycheck",
      scenario.kind === "internship" ? scenario.firstPayDate : "Not applicable",
    ],
    [
      "Moving costs",
      scenario.kind === "internship" ? money(scenario.movingCents) : "$0",
    ],
    [
      "Housing deposit",
      scenario.kind === "internship" ? money(scenario.depositCents) : "$0",
    ],
    [
      "Relocation stipend",
      scenario.kind === "internship"
        ? `${money(scenario.stipendCents)} on ${scenario.stipendDate}`
        : "Not applicable",
    ],
    ["Savings included", scenario.includeSavings ? "Yes" : "No"],
    ["Protected cushion", money(scenario.cushionCents)],
  ];
  const values = f.days.map((d) => d.balanceCents),
    lo = Math.min(0, ...values),
    hi = Math.max(scenario.cushionCents, ...values) + 10000;
  const y = (n: number) => 190 - ((n - lo) / (hi - lo)) * 165;
  const points = values
    .map((v, i) => `${45 + (i / (values.length - 1)) * 650},${y(v)}`)
    .join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FutureYou — ${escape(scenario.name)}</title><style>*{box-sizing:border-box}body{font:15px/1.6 system-ui,sans-serif;color:#292339;background:#f7f6fc;margin:0;padding:36px}main{max-width:900px;margin:auto;background:white;padding:40px;border-radius:18px}h1{font-size:34px;line-height:1.15;margin:8px 0}h2{font-size:19px;margin:26px 0 10px}.brand{color:#6752c8;font-weight:800}.muted{color:#665e75}.metrics{display:flex;gap:14px;margin:24px 0}.metric{flex:1;padding:14px;background:#f5f2fc;border-radius:10px}.metric strong{display:block;font-size:27px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #e7e2ef}svg{width:100%;height:auto}footer{font-size:12px;border-top:1px solid #e7e2ef;margin-top:28px;padding-top:14px}@media(max-width:550px){body{padding:12px}main{padding:22px}.metrics{flex-direction:column}}@media print{body{background:white;padding:0}main{padding:0}h2,table,.metrics,svg{break-inside:avoid}}</style></head><body><main><div class="brand">futureyou.</div><h1>${escape(scenario.name)}</h1><p class="muted">Decision brief · ${escape(portfolio.name)} · fictional planning example<br>${portfolio.asOf} to ${f.days.at(-1)!.date} · USD · ${portfolio.source === "nessie" ? "Imported Nessie sandbox balances and recurring bills" : "Built-in synthetic profile"}</p><div class="metrics"><div class="metric">Lowest cash<strong>${money(f.minimumCents)}</strong>${shortDate(f.minimumDate)}</div><div class="metric">Below cushion<strong>${f.daysBelowCushion} days</strong>${money(scenario.cushionCents)} target</div><div class="metric">Ending cash<strong>${money(f.endingCents)}</strong>${shortDate(f.days.at(-1)!.date)}</div></div><p>${escape(explainForecast(f, scenario))}</p><svg viewBox="0 0 740 220" role="img" aria-label="Daily available cash forecast"><line x1="45" x2="695" y1="${y(0)}" y2="${y(0)}" stroke="#bbb"/><line x1="45" x2="695" y1="${y(scenario.cushionCents)}" y2="${y(scenario.cushionCents)}" stroke="#c28a38" stroke-dasharray="5 5"/><polyline points="${points}" fill="none" stroke="#7560df" stroke-width="3"/><text x="45" y="215" font-size="12">${shortDate(portfolio.asOf)}</text><text x="695" y="215" text-anchor="end" font-size="12">${shortDate(f.days.at(-1)!.date)}</text></svg><h2>Assumptions to confirm</h2><table><tbody>${rows.map(([a, b]) => `<tr><td>${escape(a)}</td><td>${escape(b)}</td></tr>`).join("")}</tbody></table><h2>Stress checks</h2><table><thead><tr><th>What if</th><th>Lowest cash</th><th>Cushion</th></tr></thead><tbody>${cases
    .map((c) => {
      const r = stressedForecast(portfolio, scenario, c.id);
      return `<tr><td>${c.title}</td><td>${money(r.minimumCents)}</td><td>${r.minimumCents >= scenario.cushionCents ? "Preserved" : `${money(r.cushionGapCents)} short`}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table><h2>Before saying yes</h2><ul><li>Confirm the actual first payday and whether relocation support arrives before costs are due.</li><li>Confirm housing availability, the deposit, and moving costs.</li><li>Keep the chosen cash cushion available and revisit the plan if any assumption changes.</li></ul><footer>Deterministic integer-cent simulation, not real bank activity or a financial recommendation. Credit-card debt is excluded from available cash. End-of-day balances; no taxes, interest, overdraft fees, rent proration, or deposit refunds are modeled. This standalone brief works without an internet connection; use your browser’s Print command to save a PDF.</footer></main></body></html>`;
}
export function downloadDecisionBrief(
  portfolio: Portfolio,
  scenario: Scenario,
) {
  const url = URL.createObjectURL(
    new Blob([decisionBrief(portfolio, scenario)], {
      type: "text/html;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "futureyou-decision-brief.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
