import { addDays, forecast, money, shortDate } from "./forecast";
import type { Forecast, Portfolio, Scenario } from "./model";

export type StressKey = "none" | "expense" | "delay" | "both";
export const stressCases = [
  {
    id: "expense" as const,
    title: "$500 surprise",
    detail: "One extra expense at move-in.",
  },
  {
    id: "delay" as const,
    title: "Payroll 7 days late",
    detail: "The internship pay schedule shifts by a week.",
  },
  {
    id: "both" as const,
    title: "Both at once",
    detail: "A late pay schedule and the extra $500 expense.",
  },
];
export function stressedForecast(
  portfolio: Portfolio,
  scenario: Scenario,
  stress: StressKey,
): Forecast {
  const delayed =
    (stress === "delay" || stress === "both") && scenario.kind === "internship";
  const expense = stress === "expense" || stress === "both";
  const date =
    scenario.startDate > portfolio.asOf ? scenario.startDate : portfolio.asOf;
  return forecast(
    portfolio,
    delayed
      ? { ...scenario, firstPayDate: addDays(scenario.firstPayDate, 7) }
      : scenario,
    expense
      ? [
          {
            date,
            name: "Unexpected expense (stress test)",
            amountCents: -50000,
            category: "Stress test",
          },
        ]
      : [],
  );
}
export type RepairOption = {
  id: "housing" | "stipend" | "roommate";
  title: string;
  headline: string;
  details: string;
  tradeoff: string;
  scenario: Scenario;
  forecast: Forecast;
  changes: Array<{ label: string; before: string; after: string }>;
};
export function repairOptions(
  portfolio: Portfolio,
  scenario: Scenario,
  stress: StressKey = "none",
): RepairOption[] {
  const evaluate = (s: Scenario) => stressedForecast(portfolio, s, stress);
  const target = scenario.cushionCents;
  if (
    scenario.kind !== "internship" ||
    evaluate(scenario).minimumCents >= target
  )
    return [];
  const options: RepairOption[] = [];
  const append = (option: Omit<RepairOption, "forecast">) => {
    const result = evaluate(option.scenario);
    if (result.minimumCents >= target && option.changes.length)
      options.push({ ...option, forecast: result });
  };
  const housing = (rentDollars: number): Scenario => ({
    ...scenario,
    name: "Housing budget that fits",
    rentCents: rentDollars * 100,
    depositCents: Math.min(scenario.depositCents, rentDollars * 100),
  });
  let low = Math.min(500, Math.floor(scenario.rentCents / 100)),
    high = Math.floor(scenario.rentCents / 100);
  if (evaluate(housing(low)).minimumCents >= target) {
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (evaluate(housing(mid)).minimumCents >= target) low = mid;
      else high = mid - 1;
    }
    const plan = housing(low);
    append({
      id: "housing",
      title: "Set a housing ceiling",
      headline: `${money(plan.rentCents)}/month`,
      details:
        "Highest whole-dollar rent in the searched range that preserves your cushion, with the deposit capped at one month of rent.",
      tradeoff:
        "Find an available place at this price and confirm its deposit. Pay and moving costs stay unchanged.",
      scenario: plan,
      changes: [
        ...(plan.rentCents !== scenario.rentCents
          ? [
              {
                label: "Monthly rent",
                before: money(scenario.rentCents),
                after: money(plan.rentCents),
              },
            ]
          : []),
        ...(plan.depositCents !== scenario.depositCents
          ? [
              {
                label: "Deposit",
                before: money(scenario.depositCents),
                after: money(plan.depositCents),
              },
            ]
          : []),
      ],
    });
  }
  const arrival =
    addDays(scenario.startDate, -3) < portfolio.asOf
      ? portfolio.asOf
      : addDays(scenario.startDate, -3);
  const stipend = (amount: number): Scenario => ({
    ...scenario,
    name: "Upfront relocation support",
    stipendCents: amount * 100,
    stipendDate: arrival,
  });
  low = 0;
  high = 100000;
  if (evaluate(stipend(high)).minimumCents >= target) {
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (evaluate(stipend(mid)).minimumCents >= target) high = mid;
      else low = mid + 1;
    }
    const plan = stipend(low);
    append({
      id: "stipend",
      title: "Ask about upfront support",
      headline: `${money(plan.stipendCents)} by ${shortDate(arrival)}`,
      details:
        "Smallest whole-dollar total stipend at this arrival date that preserves your cushion. This is a scenario to discuss, not an available offer.",
      tradeoff:
        "Confirm the net amount and payment date with the employer. Support arriving after the gap cannot fix the earlier shortfall.",
      scenario: plan,
      changes: [
        ...(plan.stipendCents !== scenario.stipendCents
          ? [
              {
                label: "Total net stipend",
                before: money(scenario.stipendCents),
                after: money(plan.stipendCents),
              },
            ]
          : []),
        ...(plan.stipendDate !== scenario.stipendDate
          ? [
              {
                label: "Stipend arrives",
                before: shortDate(scenario.stipendDate),
                after: shortDate(plan.stipendDate),
              },
            ]
          : []),
      ],
    });
  }
  const shared: Scenario = {
    ...scenario,
    name: "Austin with a roommate",
    rentCents: Math.min(scenario.rentCents, 95000),
    depositCents: Math.min(scenario.depositCents, 95000),
    movingCents: Math.min(scenario.movingCents, 65000),
  };
  const sharedChanges = (
    [
      ["Monthly rent", "rentCents"],
      ["Deposit", "depositCents"],
      ["Moving costs", "movingCents"],
    ] as const
  )
    .filter(([, key]) => shared[key] !== scenario[key])
    .map(([label, key]) => ({
      label,
      before: money(scenario[key]),
      after: money(shared[key]),
    }));
  append({
    id: "roommate",
    title: "Share the move",
    headline: `${money(shared.rentCents)}/month`,
    details:
      "An illustrative shared-housing option with a smaller deposit and shared moving costs.",
    tradeoff:
      "Requires a roommate, housing at this price, and the assumed moving-cost savings.",
    scenario: shared,
    changes: sharedChanges,
  });
  return options;
}
export function lowPointBreakdown(result: Forecast) {
  if (
    result.minimumCents === result.openingCents &&
    result.minimumDate === result.days[0]?.date
  )
    return [];
  const groups = new Map<string, number>();
  for (const event of result.events.filter((e) => e.date <= result.minimumDate))
    groups.set(
      event.category,
      (groups.get(event.category) || 0) + event.amountCents,
    );
  return [...groups]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
