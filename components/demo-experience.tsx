"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Database,
  Home,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { demoPortfolio, defaultScenario, presets } from "@/lib/demo";
import { forecast, money, shortDate, explainForecast } from "@/lib/forecast";
import {
  lowPointBreakdown,
  repairOptions,
  stressedForecast,
  type StressKey,
} from "@/lib/decision";
import { portfolioSchema, type Portfolio, type Scenario } from "@/lib/model";
import CashChart from "./cash-chart";
import { BriefButton, RepairPanel, StressPanel } from "./decision-tools";
const steps = [
  "The opportunity",
  "The hidden gap",
  "Make it work",
  "Test a bad week",
  "Your next move",
];
type Insight = { text: string; source: string; note?: string };
export default function DemoExperience() {
  const [step, setStep] = useState(0);
  const [portfolio, setPortfolio] = useState<Portfolio>(demoPortfolio);
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [stress, setStress] = useState<StressKey>("expense");
  const [loading, setLoading] = useState(true);
  const [connectionNote, setConnectionNote] = useState(
    "Loading the fictional Nessie profile…",
  );
  const [retry, setRetry] = useState(0);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiGeneration = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  const original = useMemo(
    () => forecast(portfolio, defaultScenario),
    [portfolio],
  );
  const current = useMemo(
    () => forecast(portfolio, scenario),
    [portfolio, scenario],
  );
  const stressed = useMemo(
    () => stressedForecast(portfolio, scenario, stress),
    [portfolio, scenario, stress],
  );
  const badWeek = useMemo(
    () => stressedForecast(portfolio, scenario, "both"),
    [portfolio, scenario],
  );
  const fixes = useMemo(
    () => repairOptions(portfolio, defaultScenario),
    [portfolio],
  );
  const roommate = fixes.find((o) => o.id === "roommate");
  useEffect(() => {
    if (step !== 0) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    fetch("/api/nessie", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!active) return;
        setPortfolio(portfolioSchema.parse(data.portfolio));
        setConnectionNote(
          "Nessie sandbox accounts and recurring bills imported. All people and money are fictional.",
        );
      })
      .catch(() => {
        if (active)
          setConnectionNote(
            portfolio.source === "nessie"
              ? "Using the previously imported Nessie snapshot. Refresh is unavailable; all calculations still work."
              : "Using the built-in fictional profile. Nessie is unavailable; all calculations still work.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timeout = setTimeout(() => controller.abort(), 12000);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [retry, step === 0]);
  useEffect(() => {
    setInsight(null);
    aiGeneration.current += 1;
    setAiBusy(false);
  }, [portfolio, scenario]);
  function move(next: number) {
    setStep(Math.max(0, Math.min(4, next)));
    window.scrollTo({ top: 0, behavior: "instant" });
    mainRef.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button,input,select,textarea,a,[role="img"]') ||
        e.altKey ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(step + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(step - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step]);
  function apply(s: Scenario) {
    setScenario(s);
    setStress("expense");
  }
  function reset() {
    apply(defaultScenario);
    setInsight(null);
    move(0);
  }
  async function explain() {
    const generation = ++aiGeneration.current;
    setAiBusy(true);
    try {
      const r = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio, scenario }),
        signal: AbortSignal.timeout(22000),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (generation === aiGeneration.current) setInsight(data);
    } catch {
      if (generation === aiGeneration.current)
        setInsight({
          text: explainForecast(current, scenario),
          source: "calculation",
          note: "AI is unavailable. This is the calculation-based summary.",
        });
    } finally {
      if (generation === aiGeneration.current) setAiBusy(false);
    }
  }
  const changed = scenario !== defaultScenario;
  return (
    <div className="demo-shell">
      <header className="demo-header">
        <a href="/" className="demo-brand">
          future<span>you</span>
          <b>.</b>
        </a>
        <div className="demo-header-actions">
          <span
            className={`demo-source ${portfolio.source === "nessie" ? "connected" : ""}`}
          >
            <Database size={14} />
            {portfolio.source === "nessie"
              ? "Live Nessie sandbox"
              : "Synthetic profile"}
          </span>
          <button className="text-button" onClick={reset}>
            <RotateCcw size={14} />
            Restart
          </button>
          <a href="/" className="text-button">
            Open planner
            <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <nav className="demo-progress" aria-label="Demo chapters">
        {steps.map((name, i) => (
          <button
            key={name}
            className={step === i ? "active" : step > i ? "complete" : ""}
            onClick={() => move(i)}
            aria-current={step === i ? "step" : undefined}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            {name}
          </button>
        ))}
      </nav>
      <main className="demo-main" tabIndex={-1} ref={mainRef}>
        {step === 0 && (
          <section className="demo-opportunity">
            <div className="demo-story">
              <div className="decision-eyebrow">
                A BIG OPPORTUNITY. ONE IMPORTANT QUESTION.
              </div>
              <h1>
                Can Maya afford
                <br />
                to say <em>yes?</em>
              </h1>
              <p className="demo-lede">
                A summer internship in Austin. A first paycheck a month away. A
                decision that deserves more than a monthly budget.
              </p>
              <div className="demo-person">
                <span className="demo-avatar">MC</span>
                <div>
                  <strong>Maya Chen</strong>
                  <span>Fictional UT Dallas student · summer 2027</span>
                </div>
              </div>
              <button
                className="button primary demo-cta"
                onClick={() => move(1)}
              >
                See the whole picture
                <ArrowRight size={18} />
              </button>
              <div className="demo-import">
                <span>
                  {loading ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Check size={15} />
                  )}{" "}
                  {connectionNote}
                </span>
                {!loading && portfolio.source !== "nessie" && (
                  <button
                    className="text-button"
                    onClick={() => setRetry((v) => v + 1)}
                  >
                    Retry import
                  </button>
                )}
              </div>
            </div>
            <div className="opportunity-card">
              <div className="opportunity-label">
                <Sparkles size={18} /> THE OFFER
              </div>
              <h2>
                Your next chapter:
                <br />
                Austin, Texas.
              </h2>
              <div className="offer-amount">
                {money(defaultScenario.paycheckCents)}
                <span>take-home pay / every 2 weeks</span>
              </div>
              <div className="offer-details">
                <div>
                  <span>Start date</span>
                  <strong>{shortDate(defaultScenario.startDate)}</strong>
                </div>
                <div>
                  <span>First payday</span>
                  <strong>{shortDate(defaultScenario.firstPayDate)}</strong>
                </div>
                <div>
                  <span>Available cash now</span>
                  <strong>{money(original.openingCents)}</strong>
                </div>
                <div>
                  <span>Projected cash after 90 days</span>
                  <strong className="income-text">
                    {money(original.endingCents)}
                  </strong>
                </div>
              </div>
              <div className="offer-question">
                Looks possible. But what happens <strong>before payday?</strong>
              </div>
            </div>
          </section>
        )}
        {step === 1 && (
          <section>
            <div className="demo-section-head">
              <div>
                <div className="decision-eyebrow">
                  THE ENDING BALANCE DOESN’T TELL THE WHOLE STORY
                </div>
                <h1>
                  The opportunity has
                  <br />a <em>timing problem.</em>
                </h1>
              </div>
              <div className="demo-stat warning">
                <span>Lowest available cash</span>
                <strong>{money(original.minimumCents)}</strong>
                <small>
                  {shortDate(original.minimumDate)} · before the first paycheck
                </small>
              </div>
            </div>
            <div className="demo-chart-card">
              <CashChart
                result={original}
                baseline={original}
                compare={false}
                cushion={defaultScenario.cushionCents}
              />
            </div>
            <div className="gap-explainer">
              <div>
                <span>FIRST DAY BELOW $0</span>
                <strong>
                  {original.firstNegativeDate
                    ? shortDate(original.firstNegativeDate)
                    : "No negative days"}
                </strong>
                <p>
                  Moving, the deposit, rent and regular bills arrive before
                  internship income.
                </p>
              </div>
              <div>
                <span>
                  CASH NEEDED TO PRESERVE A{" "}
                  {money(defaultScenario.cushionCents)} CUSHION
                </span>
                <strong>{money(original.cushionGapCents)}</strong>
                <p>
                  Timing matters. Support must arrive before the shortfall, not
                  just by the end of summer.
                </p>
              </div>
              <details>
                <summary>
                  Show the calculation
                  <ChevronRight size={14} />
                </summary>
                <div className="audit-lines">
                  <div>
                    <span>Opening cash</span>
                    <strong>{money(original.openingCents)}</strong>
                  </div>
                  {lowPointBreakdown(original).map((r) => (
                    <div key={r.category}>
                      <span>
                        {r.category} through {shortDate(original.minimumDate)}
                      </span>
                      <strong>{money(r.amountCents)}</strong>
                    </div>
                  ))}
                  <div className="audit-total">
                    <span>Lowest cash</span>
                    <strong>{money(original.minimumCents)}</strong>
                  </div>
                </div>
              </details>
            </div>
          </section>
        )}
        {step === 2 && (
          <section>
            <div className="demo-section-head">
              <div>
                <div className="decision-eyebrow">
                  DON’T JUST FIND THE GAP. FIND THE CONDITIONS FOR YES.
                </div>
                <h1>
                  Keep the opportunity.
                  <br />
                  <em>Change the plan.</em>
                </h1>
              </div>
              <div
                className={`demo-stat ${current.minimumCents < scenario.cushionCents ? "warning" : "positive"}`}
              >
                <span>
                  {changed ? "Revised lowest cash" : "Original lowest cash"}
                </span>
                <strong>{money(current.minimumCents)}</strong>
                <small>{scenario.name}</small>
              </div>
            </div>
            {!changed ? (
              <RepairPanel
                portfolio={portfolio}
                scenario={scenario}
                onApply={apply}
                compact
              />
            ) : (
              <div className="demo-selected-plan">
                <div className="selected-plan-top">
                  <ShieldCheck size={26} />
                  <div>
                    <h2>{scenario.name}</h2>
                    <p>
                      {current.minimumCents >= scenario.cushionCents
                        ? "The modeled cash cushion is preserved. Now test what could change."
                        : "This plan still needs work to preserve the cushion."}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => apply(defaultScenario)}
                  >
                    Compare other fixes
                  </button>
                </div>
                <div className="plan-changes">
                  {(
                    [
                      ["Monthly rent", "rentCents"],
                      ["Deposit", "depositCents"],
                      ["Moving costs", "movingCents"],
                      ["Upfront support", "stipendCents"],
                    ] as const
                  ).map(([label, key]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <s>{money(defaultScenario[key])}</s>
                      <strong>{money(scenario[key])}</strong>
                    </div>
                  ))}
                </div>
                <CashChart
                  result={current}
                  baseline={original}
                  compare
                  cushion={scenario.cushionCents}
                  scenarioLabel="Revised plan"
                  baselineLabel="Original internship"
                />
              </div>
            )}
            <p className="demo-note">
              Every option uses the same day-by-day calculation. Housing prices
              and employer support are possibilities to verify, not available
              offers.
            </p>
          </section>
        )}
        {step === 3 && (
          <section>
            <div className="demo-section-head">
              <div>
                <div className="decision-eyebrow">
                  A GOOD PLAN SHOULD SHOW ITS LIMITS
                </div>
                <h1>
                  What if life
                  <br />
                  <em>doesn’t go to plan?</em>
                </h1>
              </div>
              <div
                className={`demo-stat ${stressed.minimumCents < scenario.cushionCents ? "warning" : "positive"}`}
              >
                <span>Lowest cash · selected stress test</span>
                <strong>{money(stressed.minimumCents)}</strong>
                <small>
                  {stressed.minimumCents >= scenario.cushionCents
                    ? `Your ${money(scenario.cushionCents)} cushion is preserved.`
                    : `${money(stressed.cushionGapCents)} below your chosen cushion.`}
                </small>
              </div>
            </div>
            {!changed && (
              <div className="demo-nudge">
                <span>You’re testing the original internship plan.</span>
                <button
                  className="text-button"
                  onClick={() =>
                    apply(roommate?.scenario || presets[1].scenario)
                  }
                >
                  Try the roommate plan
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            <StressPanel
              portfolio={portfolio}
              scenario={scenario}
              selected={stress}
              onSelect={setStress}
            />
            <div className="demo-chart-card">
              <CashChart
                result={stressed}
                baseline={current}
                compare={stress !== "none"}
                cushion={scenario.cushionCents}
                scenarioLabel={
                  stress === "none" ? "Your plan" : "Selected stress test"
                }
                baselineLabel="Your plan without the shock"
              />
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="demo-finish">
            <div className="demo-section-head">
              <div>
                <div className="decision-eyebrow">
                  A CLEARER DECISION. A CONCRETE NEXT STEP.
                </div>
                <h1>
                  Say yes with
                  <br />
                  <em>a plan, not a guess.</em>
                </h1>
              </div>
              <div
                className={`demo-stat ${current.minimumCents < scenario.cushionCents ? "warning" : "positive"}`}
              >
                <span>Lowest cash · current assumptions</span>
                <strong>{money(current.minimumCents)}</strong>
                <small>{scenario.name}</small>
              </div>
            </div>
            <div className="demo-finish-grid">
              <div className="demo-takeaway">
                <div className="decision-eyebrow">
                  <Sparkles size={16} /> MAKE SENSE OF THE NUMBERS
                </div>
                <h2>Your next move</h2>
                <p className="demo-explanation">
                  {insight?.text || explainForecast(current, scenario)}
                </p>
                <div className="takeaway-stress">
                  <ShieldCheck size={17} />
                  <span>
                    With both stress cases, the lowest cash is{" "}
                    <strong>{money(badWeek.minimumCents)}</strong>.{" "}
                    {badWeek.cushionGapCents > 0
                      ? `That leaves a ${money(badWeek.cushionGapCents)} gap below your cushion to plan for.`
                      : "Your chosen cushion is preserved in this modeled case."}
                  </span>
                </div>
                <div className="demo-ai-action">
                  <button
                    className="button secondary"
                    onClick={explain}
                    disabled={aiBusy}
                  >
                    {aiBusy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}{" "}
                    {aiBusy ? "Preparing explanation…" : "Explain with Gemini"}
                  </button>
                  <span aria-live="polite">
                    {insight?.source === "gemini"
                      ? "Gemini explanation · verified figures shown separately"
                      : "Calculation-based summary"}
                  </span>
                </div>
                {insight?.note && <p className="demo-note">{insight.note}</p>}
                <div className="demo-brief">
                  <BriefButton portfolio={portfolio} scenario={scenario} />
                  <span>
                    Keep the assumptions, timeline and all three stress checks.
                    Opens offline; prints to PDF.
                  </span>
                </div>
              </div>
              <div className="demo-checklist">
                <h2>Before saying yes</h2>
                <div>
                  <Wallet size={20} />
                  <p>
                    <strong>Confirm the first payday.</strong>Ask when money
                    will actually reach your account.
                  </p>
                </div>
                <div>
                  <Home size={20} />
                  <p>
                    <strong>Verify the housing costs.</strong>Confirm
                    availability, the deposit, and moving costs.
                  </p>
                </div>
                <div>
                  <ShieldCheck size={20} />
                  <p>
                    <strong>Protect your cushion.</strong>Review the stress
                    checks and plan for changes.
                  </p>
                </div>
                <a href="/" className="text-button">
                  Explore all assumptions in the planner
                  <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
            <div className="demo-closing">
              FutureYou turns “Can I afford it?” into{" "}
              <strong>“What needs to be true?”</strong>
            </div>
          </section>
        )}
      </main>
      <footer className="demo-footer">
        <div>
          <span>FICTIONAL DATA · MAY–AUG 2027</span>
          <small>
            Daily cash calculations. Transparent assumptions. No real bank
            transactions.
          </small>
        </div>
        <div className="demo-controls">
          <button
            className="button secondary"
            onClick={() => move(step - 1)}
            disabled={step === 0}
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <span>
            {step + 1} / {steps.length}
          </span>
          <button
            className="button primary"
            onClick={() => (step === 4 ? reset() : move(step + 1))}
          >
            {step === 4 ? "Restart story" : "Next"}
            <ArrowRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
