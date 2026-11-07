import type {
  Forecast,
  ForecastDay,
  LedgerEvent,
  Portfolio,
  Scenario,
} from "./model";
export function addDays(date: string, count: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}
export function money(cents: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(cents / 100);
}
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
export function forecast(
  portfolio: Portfolio,
  scenario: Scenario,
  additionalEvents: ReadonlyArray<Omit<LedgerEvent, "id">> = [],
): Forecast {
  const openingCents = portfolio.accounts
    .filter(
      (a) =>
        a.type === "Checking" ||
        (a.type === "Savings" && scenario.includeSavings),
    )
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const start = portfolio.asOf;
  const end = addDays(start, scenario.horizonDays - 1);
  const events: LedgerEvent[] = [];
  const add = (
    date: string,
    name: string,
    amountCents: number,
    category: string,
  ) => {
    if (date >= start && date <= end && amountCents !== 0)
      events.push({
        id: `${date}-${events.length}`,
        date,
        name,
        amountCents,
        category,
      });
  };
  for (let i = 0; i < scenario.horizonDays; i++) {
    const date = addDays(start, i);
    const d = new Date(`${date}T00:00:00Z`);
    const day = d.getUTCDate();
    const monthDays = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const moved = scenario.kind === "internship" && date >= scenario.startDate;
    if (day === 1 && !moved)
      add(date, "Campus rent", -portfolio.campusRentCents, "Housing");
    if (
      scenario.kind === "internship" &&
      (date === scenario.startDate || (day === 1 && date > scenario.startDate))
    )
      add(date, "Austin rent", -scenario.rentCents, "Housing");
    if (day === portfolio.campusPayDay && !moved)
      add(date, "Campus job paycheck", portfolio.campusPayCents, "Income");
    for (const bill of portfolio.commitments)
      if (day === Math.min(bill.day, monthDays))
        add(date, bill.name, -bill.amountCents, bill.category);
    if (d.getUTCDay() === 1)
      add(
        date,
        "Groceries & weekly essentials",
        -(moved
          ? scenario.weeklyEssentialsCents
          : portfolio.weeklyEssentialsCents),
        "Everyday",
      );
    if (moved && day === 8)
      add(
        date,
        "Additional city expenses",
        -scenario.extraMonthlyCents,
        "Everyday",
      );
  }
  if (scenario.kind === "internship") {
    add(
      addDays(scenario.startDate, -2),
      "Moving & travel",
      -scenario.movingCents,
      "Moving",
    );
    add(
      addDays(scenario.startDate, -2),
      "Housing deposit",
      -scenario.depositCents,
      "Deposit",
    );
    add(
      scenario.stipendDate,
      "Relocation stipend (net)",
      scenario.stipendCents,
      "Income",
    );
    for (
      let payday =
        scenario.firstPayDate < start
          ? addDays(
              scenario.firstPayDate,
              Math.ceil(daysBetween(scenario.firstPayDate, start) / 14) * 14,
            )
          : scenario.firstPayDate;
      payday <= end;
      payday = addDays(payday, 14)
    )
      add(
        payday,
        "Internship paycheck (net)",
        scenario.paycheckCents,
        "Income",
      );
  }
  add(
    scenario.purchaseDate,
    "Planned purchase",
    -scenario.purchaseCents,
    "Purchase",
  );
  for (const event of additionalEvents)
    add(event.date, event.name, event.amountCents, event.category);
  events.sort(
    (a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents,
  );
  let balance = openingCents;
  const days: ForecastDay[] = [];
  for (let i = 0; i < scenario.horizonDays; i++) {
    const date = addDays(start, i);
    const dayEvents = events.filter((e) => e.date === date);
    balance += dayEvents.reduce((sum, e) => sum + e.amountCents, 0);
    days.push({ date, balanceCents: balance, events: dayEvents });
  }
  const minimum = days.reduce(
    (min, day) => (day.balanceCents < min.balanceCents ? day : min),
    { date: start, balanceCents: openingCents },
  );
  const incomeCents = events
    .filter((e) => e.amountCents > 0)
    .reduce((sum, e) => sum + e.amountCents, 0);
  const expenseCents = -events
    .filter((e) => e.amountCents < 0)
    .reduce((sum, e) => sum + e.amountCents, 0);
  const fixed = -events
    .filter((e) =>
      ["Housing", "Essentials", "Transport", "Debt payment"].includes(
        e.category,
      ),
    )
    .reduce((sum, e) => sum + e.amountCents, 0);
  return {
    days,
    events,
    openingCents,
    endingCents: balance,
    minimumCents: minimum.balanceCents,
    minimumDate: minimum.date,
    firstNegativeDate: days.find((d) => d.balanceCents < 0)?.date ?? null,
    daysBelowZero: days.filter((d) => d.balanceCents < 0).length,
    daysBelowCushion: days.filter((d) => d.balanceCents < scenario.cushionCents)
      .length,
    fundingGapCents: Math.max(0, -minimum.balanceCents),
    cushionGapCents: Math.max(0, scenario.cushionCents - minimum.balanceCents),
    incomeCents,
    expenseCents,
    fixedCostShare: incomeCents > 0 ? fixed / incomeCents : 0,
  };
}
export function baselineFor(scenario: Scenario): Scenario {
  return {
    ...scenario,
    kind: "stay",
    name: "Stay in Dallas",
    purchaseCents: 0,
  };
}
export function explainForecast(result: Forecast, scenario: Scenario): string {
  if (result.firstNegativeDate)
    return `Your cash first falls below zero on ${shortDate(result.firstNegativeDate)} and reaches ${money(result.minimumCents)} on ${shortDate(result.minimumDate)}. Starting with ${money(result.fundingGapCents)} more would avoid a negative balance throughout this window; ${money(result.cushionGapCents)} more would preserve your ${money(scenario.cushionCents)} cushion. The timing of income matters as much as the total.`;
  if (result.cushionGapCents > 0)
    return `The plan stays above zero, but your lowest balance of ${money(result.minimumCents)} leaves less than your ${money(scenario.cushionCents)} cushion. Starting with an additional ${money(result.cushionGapCents)} would preserve that buffer throughout the window under these assumptions.`;
  return `Your projected balance stays above your ${money(scenario.cushionCents)} cushion throughout the ${scenario.horizonDays}-day window. The lowest point is ${money(result.minimumCents)} on ${shortDate(result.minimumDate)}. Keep checking the timing of actual bills and income before making commitments.`;
}
