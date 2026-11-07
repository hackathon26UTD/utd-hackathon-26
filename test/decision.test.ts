import test from "node:test";
import assert from "node:assert/strict";
import { demoPortfolio, defaultScenario, presets } from "../lib/demo";
import { addDays, forecast } from "../lib/forecast";
import {
  lowPointBreakdown,
  repairOptions,
  stressedForecast,
} from "../lib/decision";
import { decisionBrief } from "../lib/decision-brief";

test("rent ceiling is maximal and stipend is minimal at whole-dollar precision", () => {
  const options = repairOptions(demoPortfolio, defaultScenario);
  const housing = options.find((o) => o.id === "housing")!;
  assert.ok(housing.forecast.minimumCents >= 50000);
  const higher = {
    ...housing.scenario,
    rentCents: housing.scenario.rentCents + 100,
    depositCents: housing.scenario.depositCents + 100,
  };
  assert.ok(forecast(demoPortfolio, higher).minimumCents < 50000);
  const support = options.find((o) => o.id === "stipend")!;
  assert.equal(support.scenario.stipendCents, 125000);
  assert.ok(support.forecast.minimumCents >= 50000);
  assert.ok(
    forecast(demoPortfolio, {
      ...support.scenario,
      stipendCents: support.scenario.stipendCents - 100,
    }).minimumCents < 50000,
  );
  assert.ok(support.scenario.stipendDate < defaultScenario.startDate);
});
test("bad-week repair options actually preserve the cushion under both shocks", () => {
  const options = repairOptions(demoPortfolio, defaultScenario, "both");
  assert.ok(options.length > 0);
  for (const o of options)
    assert.ok(
      stressedForecast(demoPortfolio, o.scenario, "both").minimumCents >=
        defaultScenario.cushionCents,
    );
  assert.ok(!options.some((o) => o.id === "roommate"));
});
test("stress expense adds to a planned purchase and conserves the ledger", () => {
  const s = {
    ...defaultScenario,
    purchaseCents: 25000,
    purchaseDate: "2027-06-05",
  };
  const base = forecast(demoPortfolio, s),
    shock = stressedForecast(demoPortfolio, s, "expense");
  assert.equal(shock.endingCents, base.endingCents - 50000);
  assert.equal(
    shock.endingCents,
    shock.openingCents + shock.incomeCents - shock.expenseCents,
  );
  assert.equal(
    shock.events.find((e) => e.category === "Purchase")?.amountCents,
    -25000,
  );
  assert.equal(
    shock.events.find((e) => e.category === "Stress test")?.amountCents,
    -50000,
  );
});
test("a payroll delay moves every paycheck and leaves the source scenario untouched", () => {
  const before = JSON.stringify(defaultScenario);
  const base = forecast(demoPortfolio, defaultScenario),
    late = stressedForecast(demoPortfolio, defaultScenario, "delay");
  const dates = base.events
    .filter((e) => e.name === "Internship paycheck (net)")
    .map((e) => addDays(e.date, 7))
    .filter((d) => d <= late.days.at(-1)!.date);
  assert.deepEqual(
    late.events
      .filter((e) => e.name === "Internship paycheck (net)")
      .map((e) => e.date),
    dates,
  );
  assert.equal(JSON.stringify(defaultScenario), before);
});
test("the roommate plan survives $500 but does not pretend to survive every stress", () => {
  assert.equal(
    stressedForecast(demoPortfolio, presets[1].scenario, "expense")
      .minimumCents,
    60000,
  );
  assert.ok(
    stressedForecast(demoPortfolio, presets[1].scenario, "both").minimumCents <
      50000,
  );
});
test("no fabricated repair when the opening cash already violates the cushion", () => {
  const p = { ...demoPortfolio, accounts: [] };
  assert.deepEqual(repairOptions(p, defaultScenario), []);
  assert.deepEqual(
    repairOptions(demoPortfolio, { ...defaultScenario, kind: "stay" }),
    [],
  );
});
test("low-point audit reconciles including an opening-balance minimum", () => {
  const f = forecast(demoPortfolio, defaultScenario);
  assert.equal(
    f.openingCents +
      lowPointBreakdown(f).reduce((sum, r) => sum + r.amountCents, 0),
    f.minimumCents,
  );
  const p = {
    ...demoPortfolio,
    asOf: "2027-05-20",
    accounts: [],
    commitments: [],
    campusRentCents: 0,
    weeklyEssentialsCents: 0,
  };
  const f2 = forecast(p, { ...defaultScenario, kind: "stay", cushionCents: 0 });
  assert.equal(f2.minimumCents, 0);
  assert.deepEqual(lowPointBreakdown(f2), []);
});
test("offline decision brief escapes profile and plan text and includes stress outcomes", () => {
  const html = decisionBrief(
    { ...demoPortfolio, name: "<img src=x onerror=alert(1)>" },
    { ...presets[1].scenario, name: "<script>evil()</script>" },
  );
  assert.ok(!html.includes("<script>evil()"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;evil()"));
  assert.ok(html.includes("$600"));
  assert.ok(html.includes("Both at once"));
  assert.ok(!html.includes('src="https://'));
});
test("old pay schedule fast-forwards without losing its fortnightly alignment", () => {
  const f = forecast(demoPortfolio, {
    ...defaultScenario,
    startDate: "2010-01-01",
    firstPayDate: "2010-01-15",
  });
  const pay = f.events.filter((e) => e.name === "Internship paycheck (net)");
  assert.ok(pay.length >= 6 && pay.length <= 7);
  assert.ok(pay.every((e) => e.date >= demoPortfolio.asOf));
  for (let i = 1; i < pay.length; i++)
    assert.equal(addDays(pay[i - 1].date, 14), pay[i].date);
});

test("an existing late stipend does not inflate the minimum support calculation", () => {
  const late = {
    ...defaultScenario,
    stipendCents: 200000,
    stipendDate: "2027-07-20",
  };
  const support = repairOptions(demoPortfolio, late).find(
    (o) => o.id === "stipend",
  )!;
  assert.equal(support.scenario.stipendCents, 125000);
  assert.equal(support.scenario.stipendDate, "2027-05-29");
  assert.equal(support.forecast.minimumCents, 50000);
});
