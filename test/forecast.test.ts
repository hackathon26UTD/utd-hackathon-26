import test from "node:test";
import assert from "node:assert/strict";
import { demoPortfolio, defaultScenario } from "../lib/demo";
import { addDays, baselineFor, daysBetween, forecast } from "../lib/forecast";
import { scenarioSchema } from "../lib/model";
import { forecastCsv } from "../lib/export";
import { normalizeNessie } from "../lib/nessie";

test("ledger conserves money in integer cents", () => {
  const f = forecast(demoPortfolio, defaultScenario);
  assert.equal(f.endingCents, f.openingCents + f.incomeCents - f.expenseCents);
  assert.equal(f.days.length, 90);
  assert.equal(f.openingCents, 350000);
  assert.ok(f.days.every((d) => Number.isInteger(d.balanceCents)));
});
test("internship exposes an early shortfall despite a positive ending balance", () => {
  const f = forecast(demoPortfolio, defaultScenario);
  assert.ok(f.minimumCents < 0);
  assert.ok(f.endingCents > 0);
  assert.ok(f.firstNegativeDate! < defaultScenario.firstPayDate);
  assert.equal(f.fundingGapCents, -f.minimumCents);
});
test("credit card debt never increases spendable cash", () => {
  const f = forecast(
    {
      ...demoPortfolio,
      accounts: demoPortfolio.accounts.map((a) =>
        a.type === "Credit Card" ? { ...a, balanceCents: 10000000 } : a,
      ),
    },
    defaultScenario,
  );
  assert.equal(f.openingCents, 350000);
});
test("excluding savings shifts every projected balance by the savings amount", () => {
  const withSavings = forecast(demoPortfolio, defaultScenario);
  const without = forecast(demoPortfolio, {
    ...defaultScenario,
    includeSavings: false,
  });
  for (let i = 0; i < 90; i++)
    assert.equal(
      withSavings.days[i].balanceCents - without.days[i].balanceCents,
      90000,
    );
});
test("cushion is a target and does not subtract cash", () => {
  const a = forecast(demoPortfolio, defaultScenario);
  const b = forecast(demoPortfolio, {
    ...defaultScenario,
    cushionCents: 200000,
  });
  assert.equal(a.endingCents, b.endingCents);
  assert.ok(b.daysBelowCushion >= a.daysBelowCushion);
});
test("delaying pay cannot improve the pre-payday low point", () => {
  const early = forecast(demoPortfolio, {
    ...defaultScenario,
    firstPayDate: "2027-06-15",
  });
  const late = forecast(demoPortfolio, {
    ...defaultScenario,
    firstPayDate: "2027-07-15",
  });
  assert.ok(late.minimumCents <= early.minimumCents);
});
test("relocation and deposit are charged once and no deposit refund is invented", () => {
  const f = forecast(demoPortfolio, defaultScenario);
  assert.equal(f.events.filter((e) => e.category === "Deposit").length, 1);
  assert.equal(
    f.events.find((e) => e.category === "Deposit")?.date,
    "2027-05-30",
  );
  assert.equal(
    f.events.find((e) => e.category === "Deposit")?.amountCents,
    -165000,
  );
});
test("campus income stops when internship starts and new income repeats every fourteen days", () => {
  const f = forecast(demoPortfolio, defaultScenario);
  assert.deepEqual(
    f.events.filter((e) => e.name === "Campus job paycheck").map((e) => e.date),
    ["2027-05-20"],
  );
  const dates = f.events
    .filter((e) => e.name === "Internship paycheck (net)")
    .map((e) => e.date);
  assert.deepEqual(dates, [
    "2027-07-01",
    "2027-07-15",
    "2027-07-29",
    "2027-08-12",
  ]);
});
test("stay scenario excludes internship costs and income", () => {
  const f = forecast(demoPortfolio, baselineFor(defaultScenario));
  assert.ok(f.minimumCents > 0);
  assert.equal(
    f.events.filter((e) => ["Deposit", "Moving"].includes(e.category)).length,
    0,
  );
  assert.equal(
    f.events.filter((e) => e.name.startsWith("Internship")).length,
    0,
  );
});
test("a stipend after the shortfall cannot retroactively fix it", () => {
  const original = forecast(demoPortfolio, defaultScenario);
  const later = forecast(demoPortfolio, {
    ...defaultScenario,
    stipendCents: 150000,
    stipendDate: "2027-07-20",
  });
  assert.equal(original.minimumCents, later.minimumCents);
  assert.equal(later.endingCents - original.endingCents, 150000);
});
test("calendar math crosses daylight saving changes without shifting dates", () => {
  assert.equal(addDays("2027-03-13", 2), "2027-03-15");
  assert.equal(daysBetween("2027-03-13", "2027-03-15"), 2);
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});
test("monthly bill on day 31 clamps to February month end", () => {
  const p = {
    ...demoPortfolio,
    asOf: "2027-02-01",
    commitments: [
      {
        id: "month-end",
        name: "Monthly bill",
        amountCents: 100,
        day: 31,
        category: "Essentials",
      },
    ],
  };
  const f = forecast(p, { ...baselineFor(defaultScenario), horizonDays: 30 });
  assert.equal(
    f.events.find((e) => e.name === "Monthly bill")?.date,
    "2027-02-28",
  );
});
test("invalid calendar dates, negative amounts and pre-start paydays are rejected", () => {
  assert.equal(
    scenarioSchema.safeParse({ ...defaultScenario, firstPayDate: "2027-02-30" })
      .success,
    false,
  );
  assert.equal(
    scenarioSchema.safeParse({ ...defaultScenario, rentCents: -1 }).success,
    false,
  );
  assert.equal(
    scenarioSchema.safeParse({ ...defaultScenario, firstPayDate: "2027-05-10" })
      .success,
    false,
  );
});
test("Nessie cash and recurring bills normalize without double-counting rent or credit balances", () => {
  const p = normalizeNessie(
    [
      { _id: "a", type: "Checking", balance: 1000.12 },
      { _id: "b", type: "Credit Card", balance: 400 },
    ],
    [
      {
        _id: "r",
        payee: "Campus rent",
        payment_amount: 750,
        recurring_date: 1,
        status: "recurring",
      },
      {
        _id: "p",
        payee: "Phone",
        payment_amount: 45,
        recurring_date: 10,
        status: "recurring",
      },
    ],
    "Test Student",
    "test",
  );
  assert.equal(p.accounts[0].balanceCents, 100012);
  assert.equal(p.commitments.length, 1);
  assert.equal(p.campusRentCents, 75000);
  assert.equal(forecast(p, defaultScenario).openingCents, 100012);
});
test("CSV export includes the complete ledger and neutralizes spreadsheet formulas", () => {
  const f = forecast(
    {
      ...demoPortfolio,
      commitments: [
        {
          id: "formula",
          name: '=HYPERLINK("bad")',
          amountCents: 100,
          day: 20,
          category: "Bill",
        },
      ],
    },
    defaultScenario,
  );
  const csv = forecastCsv(f);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("2027-08-12"));
  assert.ok(csv.includes("End-of-day cash USD"));
});
