"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeftRight,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  HelpCircle,
  Home,
  LayoutDashboard,
  Link2,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wallet,
  X,
  AlertTriangle,
  Menu,
} from "lucide-react";
import { z } from "zod";
import { demoPortfolio, defaultScenario, presets } from "@/lib/demo";
import {
  addDays,
  baselineFor,
  daysBetween,
  explainForecast,
  forecast,
  money,
  shortDate,
} from "@/lib/forecast";
import { forecastCsv } from "@/lib/export";
import {
  planInputSchema,
  portfolioSchema,
  scenarioSchema,
  type Portfolio,
  type SavedPlan,
  type Scenario,
} from "@/lib/model";
import CashChart from "./cash-chart";
import { BriefButton, RepairPanel, StressPanel } from "./decision-tools";

type Status = {
  nessie: boolean;
  nessieCustomer: boolean;
  mongodb: boolean;
  ai: boolean;
  storage: string;
};
type View = "forecast" | "accounts" | "plans" | "method";
type Plan = SavedPlan & { storage?: "atlas" | "browser" };
const storedPlanSchema = planInputSchema.extend({
  id: z.string(),
  savedAt: z.string().datetime(),
  storage: z.enum(["atlas", "browser"]).optional(),
});
const jsonHeaders = { "Content-Type": "application/json" };
function readPlans(): Plan[] {
  try {
    const values: unknown = JSON.parse(
      localStorage.getItem("futureyou-plans-v1") || "[]",
    );
    if (!Array.isArray(values)) return [];
    return values
      .flatMap((v) => {
        const p = storedPlanSchema.safeParse(v);
        return p.success ? [p.data] : [];
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}
function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <span />
        <span />
        <i />
      </span>
      future<span className="brand-you">you</span>
      <span className="brand-period">.</span>
    </span>
  );
}
function CurrencyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="money-field">
      <span>{label}</span>
      <div>
        <span>$</span>
        <input
          aria-label={label}
          type="number"
          min="0"
          max="1000000"
          step="1"
          value={value / 100}
          onChange={(e) =>
            onChange(
              Math.max(
                0,
                Math.min(
                  100000000,
                  Math.round((Number(e.target.value) || 0) * 100),
                ),
              ),
            )
          }
        />
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step = 50,
  onChange,
  unit = "money",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: "money" | "days";
}) {
  return (
    <label className="slider-field">
      <span>
        <span>{label}</span>
        <strong>
          {unit === "money" ? money(value * 100) : `${value} days`}
        </strong>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--range-progress": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
      />
      <small>
        <span>{unit === "money" ? money(min * 100) : `${min} days`}</span>
        <span>{unit === "money" ? money(max * 100) : `${max} days`}</span>
      </small>
    </label>
  );
}
export default function FutureYou() {
  const [view, setView] = useState<View>("forecast");
  const [portfolio, setPortfolio] = useState<Portfolio>(demoPortfolio);
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [compare, setCompare] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"save" | "sources" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [filter, setFilter] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [insight, setInsight] = useState<{
    text: string;
    source: string;
    note?: string;
  } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const insightGeneration = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const result = useMemo(
    () => forecast(portfolio, scenario),
    [portfolio, scenario],
  );
  const baseline = useMemo(
    () => forecast(portfolio, baselineFor(scenario)),
    [portfolio, scenario],
  );
  const cash = portfolio.accounts
    .filter((a) => a.type !== "Credit Card")
    .reduce((s, a) => s + a.balanceCents, 0);
  const debt = portfolio.accounts
    .filter((a) => a.type === "Credit Card")
    .reduce((s, a) => s + a.balanceCents, 0);
  const risky = result.minimumCents < scenario.cushionCents;
  const negative = result.minimumCents < 0;
  const savings = portfolio.accounts
    .filter((a) => a.type === "Savings")
    .reduce((s, a) => s + a.balanceCents, 0);
  useEffect(() => {
    setPlans(readPlans());
    try {
      const stored = JSON.parse(
        localStorage.getItem("futureyou-current-v1") || "null",
      );
      const parsed = planInputSchema.safeParse(stored);
      if (parsed.success) {
        setScenario(parsed.data.scenario);
        setPortfolio(parsed.data.portfolio);
      }
    } catch {}
    setHydrated(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    fetch("/api/plans")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans?.length)
          setPlans((previous) => [
            ...data.plans.map((p: Plan) => ({ ...p, storage: "atlas" })),
            ...previous.filter(
              (p) => !data.plans.some((q: Plan) => q.id === p.id),
            ),
          ]);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        "futureyou-current-v1",
        JSON.stringify({ portfolio, scenario }),
      );
    } catch {}
    setInsight(null);
    insightGeneration.current += 1;
  }, [portfolio, scenario, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);
  const change = <K extends keyof Scenario>(key: K, value: Scenario[K]) =>
    setScenario((s) => ({ ...s, [key]: value }));
  function notify(message: string) {
    setToast(message);
  }
  function persistPlans(next: Plan[]) {
    setPlans(next);
    try {
      localStorage.setItem("futureyou-plans-v1", JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }
  function choose(p: Scenario) {
    setScenario({ ...p });
    setView("forecast");
  }
  function reset() {
    setScenario(defaultScenario);
    setPortfolio(demoPortfolio);
    setView("forecast");
    setCompare(true);
    setFilter("all");
    setMenuOpen(false);
    setModal(null);
    setConnectionError("");
    setInsight(null);
    notify(
      "Demo reset to Maya’s original internship plan. Saved plans are unchanged.",
    );
  }
  async function importAccounts() {
    setBusy("nessie");
    setConnectionError("");
    try {
      const res = await fetch("/api/nessie");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const p = portfolioSchema.parse(data.portfolio);
      setPortfolio(p);
      setModal(null);
      notify(
        "Nessie balances and monthly bills imported. Your scenario assumptions are unchanged.",
      );
    } catch (e) {
      setConnectionError(
        e instanceof Error ? e.message : "Could not connect to Nessie.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    const named = { ...scenario, name: saveName.trim() || scenario.name };
    try {
      const local: Plan = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        scenario: named,
        portfolio,
        storage: "browser",
      };
      let saved = local;
      let message = "Plan saved in this browser.";
      if (status?.mongodb) {
        try {
          const res = await fetch("/api/plans", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ scenario: named, portfolio }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error();
          saved = { ...data.plan, storage: "atlas" };
          message = "Plan saved to MongoDB Atlas and this browser.";
        } catch {
          message = "Cloud save was unavailable. Plan saved in this browser.";
        }
      }
      const persisted = persistPlans([saved, ...plans].slice(0, 20));
      if (!persisted)
        message =
          saved.storage === "atlas"
            ? "Plan saved to Atlas; browser storage is unavailable."
            : "Plan is only in memory because browser storage is unavailable. Download a decision brief before closing.";
      change("name", named.name);
      setModal(null);
      notify(message);
    } finally {
      setBusy(null);
    }
  }
  async function removePlan(plan: Plan) {
    if (plan.storage === "atlas") {
      try {
        const r = await fetch("/api/plans", {
          method: "DELETE",
          headers: jsonHeaders,
          body: JSON.stringify({ id: plan.id }),
        });
        if (!r.ok) throw new Error();
      } catch {
        notify("Could not delete the cloud copy. Try again when connected.");
        return;
      }
    }
    const persisted = persistPlans(plans.filter((p) => p.id !== plan.id));
    notify(
      persisted
        ? "Saved plan removed."
        : "Removed from this session, but browser storage could not be updated.",
    );
  }
  function exportTimeline() {
    const url = URL.createObjectURL(
      new Blob([forecastCsv(result)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "futureyou-cash-flow.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Your complete cash-flow timeline has been exported.");
  }
  async function explain() {
    setBusy("insight");
    const generation = insightGeneration.current;
    try {
      const r = await fetch("/api/insights", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ portfolio, scenario }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (generation === insightGeneration.current) setInsight(data);
    } catch {
      notify(
        "Could not load the explanation. The calculation summary remains available.",
      );
    } finally {
      setBusy(null);
    }
  }
  const events = result.events.filter(
    (e) =>
      filter === "all" ||
      (filter === "income" ? e.amountCents > 0 : e.amountCents < 0),
  );
  const nav = [
    { id: "forecast" as View, label: "Your next move", icon: LayoutDashboard },
    { id: "accounts" as View, label: "Money picture", icon: Wallet },
    { id: "plans" as View, label: "Saved plans", icon: Bookmark },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button
          className="brand-button"
          onClick={() => {
            setView("forecast");
            setMenuOpen(false);
          }}
          aria-label="FutureYou home"
        >
          <Brand />
        </button>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => {
                setView(item.id);
                setMenuOpen(false);
              }}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "plans" && plans.length > 0 && (
                <span className="count-badge">{plans.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-illustration">
            <span className="note-orbit" />
            <Sparkles size={29} />
            <span className="note-star">✦</span>
          </div>
          <strong>
            A little clarity.
            <br />A bigger possibility.
          </strong>
          <p>
            Make the next chapter
            <br />
            feel a little more you.
          </p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "method" ? "active" : ""}`}
            onClick={() => setView("method")}
          >
            <HelpCircle size={18} />
            How it works
          </button>
          <div className="demo-label">
            <span className="status-dot" />
            Synthetic-data demo
          </div>
          <small>Made for your next chapter.</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <span>My workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "forecast"
                ? "Your next move"
                : view === "accounts"
                  ? "Money picture"
                  : view === "plans"
                    ? "Saved plans"
                    : "How it works"}
            </strong>
          </div>
          <div className="top-actions">
            <a className="text-button demo-link" href="/demo">
              Present demo <ArrowUpRight size={14} />
            </a>
            <button className="text-button reset-button" onClick={reset}>
              <RotateCcw size={14} />
              Reset demo
            </button>
            <div className="profile">
              <span className="avatar">
                {portfolio.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{portfolio.name}</strong>
                <span>Demo profile</span>
              </div>
            </div>
          </div>
        </header>
        <main id="main-content">
          {view === "forecast" && (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span />
                    YOUR FUTURE, A LITTLE CLEARER
                  </div>
                  <h1>
                    Make room for what’s next<span>.</span>
                  </h1>
                  <p>
                    A new city. A new opportunity. See what it means for your
                    money.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    setSaveName(scenario.name);
                    setModal("save");
                  }}
                >
                  <Bookmark size={16} />
                  Save plan
                </button>
              </section>
              <div className="scenario-heading">
                <h2>What are you thinking about?</h2>
                <span>One decision. A few possibilities.</span>
              </div>
              <section className="scenario-cards" aria-label="Scenario presets">
                {presets.map((preset, i) => {
                  const roommate =
                    scenario.rentCents === 95000 &&
                    scenario.depositCents === 95000 &&
                    scenario.movingCents === 65000;
                  const selected =
                    scenario.kind === preset.scenario.kind &&
                    (scenario.kind === "stay" ||
                      (i === 1 ? roommate : !roommate));
                  const Icon =
                    i === 0 ? BriefcaseBusiness : i === 1 ? Home : MapPin;
                  return (
                    <button
                      className={`scenario-card ${selected ? "selected" : ""}`}
                      key={preset.id}
                      onClick={() => choose(preset.scenario)}
                      aria-pressed={selected}
                    >
                      <span className={`scenario-icon icon-${i}`}>
                        <Icon size={22} />
                      </span>
                      <span className="scenario-copy">
                        <strong>{preset.title}</strong>
                        <small>{preset.subtitle}</small>
                      </span>
                      <span className="radio-dot">
                        {selected && <Check size={11} />}
                      </span>
                    </button>
                  );
                })}
              </section>
              <div className="planning-grid">
                <div className="planning-main">
                  <section
                    className="metrics"
                    aria-label="Financial health indicators"
                  >
                    <div className="metric">
                      <span>
                        Lowest cash balance{" "}
                        <span
                          className={`metric-indicator ${risky ? "warn" : "good"}`}
                        />
                      </span>
                      <strong className={negative ? "negative-text" : ""}>
                        {money(result.minimumCents)}
                      </strong>
                      <small>
                        {shortDate(result.minimumDate)} · your tightest moment
                      </small>
                    </div>
                    <div className="metric">
                      <span>
                        Days below your cushion <ShieldCheck size={14} />
                      </span>
                      <strong>
                        {result.daysBelowCushion}
                        <em>days</em>
                      </strong>
                      <small>
                        Keeping {money(scenario.cushionCents)} set aside
                      </small>
                    </div>
                    <div className="metric">
                      <span>
                        Cash at the finish line <ArrowUpRight size={15} />
                      </span>
                      <strong>{money(result.endingCents)}</strong>
                      <small>
                        Projected for {shortDate(result.days.at(-1)!.date)}
                      </small>
                    </div>
                  </section>
                  <section className="panel forecast-panel">
                    <div className="panel-header">
                      <div>
                        <h2>Your next {scenario.horizonDays} days</h2>
                        <p>Follow the timing, not just the total.</p>
                      </div>
                      <button
                        className={`compare-toggle ${compare ? "on" : ""}`}
                        aria-pressed={compare}
                        onClick={() => setCompare((v) => !v)}
                      >
                        <ArrowLeftRight size={14} />
                        Compare paths
                      </button>
                    </div>
                    <CashChart
                      result={result}
                      baseline={baseline}
                      cushion={scenario.cushionCents}
                      compare={compare}
                    />
                  </section>
                  <section
                    className={`insight-card ${risky ? "caution" : "positive"}`}
                  >
                    <span className="insight-icon">
                      {risky ? (
                        <AlertTriangle size={20} />
                      ) : (
                        <Sparkles size={21} />
                      )}
                    </span>
                    <div>
                      <div className="insight-kicker">
                        THE MOMENT THAT MATTERS
                      </div>
                      <h3>
                        {negative
                          ? "The opportunity works better with a bridge."
                          : risky
                            ? "A little more breathing room would help."
                            : "There’s room for this next chapter."}
                      </h3>
                      <p>
                        {insight?.text || explainForecast(result, scenario)}
                      </p>
                      <div className="insight-footer">
                        <span>
                          {insight?.source === "gemini"
                            ? "AI explanation · grounded in your calculations"
                            : "Calculated from your assumptions"}
                        </span>
                        {status?.ai && (
                          <button
                            onClick={explain}
                            disabled={busy === "insight"}
                          >
                            {busy === "insight" ? (
                              <Loader2 className="spin" size={13} />
                            ) : (
                              <Sparkles size={13} />
                            )}
                            Explain with AI
                          </button>
                        )}
                      </div>
                      {insight?.note && <small>{insight.note}</small>}
                    </div>
                  </section>
                  {scenario.kind === "internship" && (
                    <RepairPanel
                      portfolio={portfolio}
                      scenario={scenario}
                      onApply={choose}
                    />
                  )}
                  <StressPanel portfolio={portfolio} scenario={scenario} />
                  <div className="brief-action">
                    <BriefButton portfolio={portfolio} scenario={scenario} />
                    <span>
                      A printable plan with assumptions and stress checks.
                    </span>
                  </div>
                  <section className="panel timeline-panel">
                    <div className="panel-header">
                      <div>
                        <h2>The money moments</h2>
                        <p>Every bill and paycheck behind the projection.</p>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Export cash-flow timeline"
                        onClick={exportTimeline}
                      >
                        <Download size={17} />
                      </button>
                    </div>
                    <div
                      className="timeline-filters"
                      role="group"
                      aria-label="Filter transactions"
                    >
                      {["all", "income", "expenses"].map((f) => (
                        <button
                          key={f}
                          aria-pressed={filter === f}
                          className={filter === f ? "active" : ""}
                          onClick={() => setFilter(f)}
                        >
                          {f === "all"
                            ? "All moments"
                            : f === "income"
                              ? "Money in"
                              : "Money out"}
                        </button>
                      ))}
                      <span>{events.length} scheduled events</span>
                    </div>
                    <div className="event-list">
                      {events.map((event) => (
                        <div className="event-row" key={event.id}>
                          <div
                            className={`event-icon ${event.amountCents > 0 ? "income" : ""}`}
                          >
                            {event.amountCents > 0 ? (
                              <ArrowUpRight size={17} />
                            ) : (
                              <CalendarDays size={16} />
                            )}
                          </div>
                          <div className="event-name">
                            <strong>{event.name}</strong>
                            <span>{event.category}</span>
                          </div>
                          <time dateTime={event.date}>
                            {shortDate(event.date)}
                          </time>
                          <strong
                            className={
                              event.amountCents > 0 ? "income-text" : ""
                            }
                          >
                            {event.amountCents > 0 ? "+" : ""}
                            {money(event.amountCents)}
                          </strong>
                        </div>
                      ))}
                      {!events.length && (
                        <div className="empty-small">
                          No transactions match this filter.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
                <aside className="assumptions-panel panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        <SlidersHorizontal size={17} />
                        Make it yours
                      </h2>
                      <p>Small changes can change the picture.</p>
                    </div>
                  </div>
                  <div className="assumptions-content">
                    <div className="scenario-location">
                      <span className="location-icon">
                        <MapPin size={17} />
                      </span>
                      <div>
                        <strong>
                          {scenario.kind === "internship"
                            ? "Austin, Texas"
                            : "Dallas, Texas"}
                        </strong>
                        <span>
                          {scenario.kind === "internship"
                            ? `Starts ${shortDate(scenario.startDate)}`
                            : "Your current path"}
                        </span>
                      </div>
                      <span className="small-tag">USD</span>
                    </div>
                    {scenario.kind === "internship" ? (
                      <>
                        <Slider
                          label="Monthly rent"
                          value={scenario.rentCents / 100}
                          min={500}
                          max={3000}
                          onChange={(v) => change("rentCents", v * 100)}
                        />
                        <Slider
                          label="Take-home pay / 2 weeks"
                          value={scenario.paycheckCents / 100}
                          min={500}
                          max={5000}
                          onChange={(v) => change("paycheckCents", v * 100)}
                        />
                        <Slider
                          label="Wait for first paycheck"
                          value={daysBetween(
                            scenario.startDate,
                            scenario.firstPayDate,
                          )}
                          min={0}
                          max={60}
                          step={1}
                          unit="days"
                          onChange={(v) =>
                            change(
                              "firstPayDate",
                              addDays(scenario.startDate, v),
                            )
                          }
                        />
                        <div className="payday-note">
                          <CalendarDays size={13} />
                          First payday: {shortDate(scenario.firstPayDate)}
                        </div>
                        <CurrencyInput
                          label="Moving & travel"
                          value={scenario.movingCents}
                          onChange={(v) => change("movingCents", v)}
                        />
                        <CurrencyInput
                          label="Housing deposit"
                          value={scenario.depositCents}
                          onChange={(v) => change("depositCents", v)}
                          hint="Paid two days before the move. No refund modeled."
                        />
                      </>
                    ) : (
                      <div className="stay-note">
                        <Home size={25} />
                        <p>
                          Keep your current rent of{" "}
                          <strong>
                            {money(portfolio.campusRentCents)}/month
                          </strong>{" "}
                          and campus income of{" "}
                          <strong>
                            {money(portfolio.campusPayCents)}/month
                          </strong>
                          .
                        </p>
                      </div>
                    )}
                    <div className="divider" />
                    <label className="switch-row">
                      <div>
                        <strong>Include my savings</strong>
                        <small>{money(savings)} available if needed</small>
                      </div>
                      <input
                        type="checkbox"
                        checked={scenario.includeSavings}
                        onChange={(e) =>
                          change("includeSavings", e.target.checked)
                        }
                        aria-label="Include my savings"
                      />
                      <span className="switch" />
                    </label>
                    <CurrencyInput
                      label="Cash cushion to protect"
                      value={scenario.cushionCents}
                      onChange={(v) => change("cushionCents", v)}
                    />
                    <details className="more-assumptions">
                      <summary>
                        More assumptions <ChevronDown size={15} />
                      </summary>
                      <CurrencyInput
                        label="Weekly groceries & essentials"
                        value={
                          scenario.kind === "internship"
                            ? scenario.weeklyEssentialsCents
                            : portfolio.weeklyEssentialsCents
                        }
                        onChange={(v) =>
                          scenario.kind === "internship"
                            ? change("weeklyEssentialsCents", v)
                            : setPortfolio((p) => ({
                                ...p,
                                weeklyEssentialsCents: v,
                              }))
                        }
                      />
                      {scenario.kind === "internship" && (
                        <>
                          <CurrencyInput
                            label="Extra monthly city costs"
                            value={scenario.extraMonthlyCents}
                            onChange={(v) => change("extraMonthlyCents", v)}
                          />
                          <CurrencyInput
                            label="Relocation stipend (net)"
                            value={scenario.stipendCents}
                            onChange={(v) => change("stipendCents", v)}
                          />
                          <label className="date-field">
                            Stipend arrives
                            <input
                              aria-label="Stipend arrives"
                              type="date"
                              value={scenario.stipendDate}
                              onChange={(e) => {
                                if (e.target.value)
                                  change("stipendDate", e.target.value);
                              }}
                            />
                          </label>
                        </>
                      )}
                      <CurrencyInput
                        label="One-time planned purchase"
                        value={scenario.purchaseCents}
                        onChange={(v) => change("purchaseCents", v)}
                      />
                      <label className="date-field">
                        Purchase date
                        <input
                          aria-label="Purchase date"
                          type="date"
                          value={scenario.purchaseDate}
                          onChange={(e) => {
                            if (e.target.value)
                              change("purchaseDate", e.target.value);
                          }}
                        />
                      </label>
                    </details>
                    <div className="source-card">
                      <span className="source-symbol">
                        <Wallet size={17} />
                      </span>
                      <div>
                        <strong>
                          {portfolio.source === "nessie"
                            ? "Nessie sandbox connected"
                            : "Using Maya’s demo finances"}
                        </strong>
                        <span>
                          {portfolio.accounts.length} accounts · {money(cash)}{" "}
                          in cash
                        </span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="View data sources"
                        onClick={() => setModal("sources")}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                    <p className="private-note">
                      <ShieldCheck size={13} />
                      Planning with fictional money. No payments are made.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {view === "accounts" && (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span />
                    START WITH THE WHOLE PICTURE
                  </div>
                  <h1>
                    Your money, in one place<span>.</span>
                  </h1>
                  <p>Know what’s available before you imagine what’s next.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("sources")}
                >
                  <Link2 size={16} />
                  Connect Nessie
                </button>
              </section>
              <div className="source-banner">
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {portfolio.source === "nessie"
                      ? "Capital One Nessie sandbox"
                      : "Fictional student profile"}
                  </strong>
                  <p>{portfolio.sourceNote}</p>
                </div>
              </div>
              <div className="account-grid">
                {portfolio.accounts.map((a, i) => (
                  <div className={`account-card account-${i % 3}`} key={a.id}>
                    <div>
                      <Wallet size={21} />
                      <span>{a.type}</span>
                    </div>
                    <h3>{a.name}</h3>
                    <strong>{money(a.balanceCents, 2)}</strong>
                    <span>
                      {a.type === "Credit Card"
                        ? "Outstanding debt · excluded from available cash"
                        : "Opening cash balance"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="account-summary">
                <span>
                  Available cash <strong>{money(cash)}</strong>
                </span>
                <span>
                  Outstanding card debt <strong>{money(debt)}</strong>
                </span>
                <span>
                  Cash less card debt <strong>{money(cash - debt)}</strong>
                </span>
              </div>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Your monthly commitments</h2>
                    <p>These obligations carry across your scenarios.</p>
                  </div>
                </div>
                <div className="bill-table">
                  <div className="bill-row">
                    <strong>Campus rent</strong>
                    <span>1st of each month · until moving</span>
                    <strong>{money(portfolio.campusRentCents)}</strong>
                  </div>
                  {portfolio.commitments.map((b) => (
                    <div className="bill-row" key={b.id}>
                      <strong>{b.name}</strong>
                      <span>Day {b.day} each month</span>
                      <strong>{money(b.amountCents)}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <button
                className="button primary return-button"
                onClick={() => setView("forecast")}
              >
                Explore your next move
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {view === "plans" && (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span />
                    POSSIBILITIES WORTH KEEPING
                  </div>
                  <h1>
                    A few versions of your future<span>.</span>
                  </h1>
                  <p>
                    Return to a plan, compare the details, or start with a fresh
                    perspective.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setSaveName(scenario.name);
                    setModal("save");
                  }}
                >
                  <Plus size={16} />
                  Save current plan
                </button>
              </section>
              {plans.length ? (
                <div className="saved-grid">
                  {plans.map((plan) => {
                    const f = forecast(plan.portfolio, plan.scenario);
                    return (
                      <article className="saved-card panel" key={plan.id}>
                        <div className="saved-card-top">
                          <span className="scenario-icon">
                            <Bookmark size={21} />
                          </span>
                          <button
                            className="icon-button"
                            aria-label={`Delete ${plan.scenario.name}`}
                            onClick={() => removePlan(plan)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <h2>{plan.scenario.name}</h2>
                        <p>
                          Saved{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(plan.savedAt))}{" "}
                          ·{" "}
                          {plan.storage === "atlas"
                            ? "MongoDB Atlas"
                            : "This browser"}
                        </p>
                        <div className="saved-stats">
                          <span>
                            Lowest balance
                            <strong
                              className={
                                f.minimumCents < 0 ? "negative-text" : ""
                              }
                            >
                              {money(f.minimumCents)}
                            </strong>
                          </span>
                          <span>
                            Ending balance
                            <strong>{money(f.endingCents)}</strong>
                          </span>
                        </div>
                        <button
                          className="button secondary full-width"
                          onClick={() => {
                            setPortfolio(plan.portfolio);
                            choose(plan.scenario);
                            notify("Saved plan restored.");
                          }}
                        >
                          Open this plan
                          <ArrowRight size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <span>
                    <Bookmark size={34} />
                  </span>
                  <h2>Your next chapter starts with a possibility.</h2>
                  <p>
                    Save a scenario to keep its assumptions and timeline
                    together.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setView("forecast")}
                  >
                    Explore a scenario
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "method" && (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span />
                    NO MYSTERY MATH
                  </div>
                  <h1>
                    See what’s behind the picture<span>.</span>
                  </h1>
                  <p>
                    Clear inputs. Traceable calculations. Room for uncertainty.
                  </p>
                </div>
              </section>
              <div className="method-grid">
                <section className="panel prose">
                  <h2>How the forecast works</h2>
                  <p>
                    We start with checking balances and, if selected, savings.
                    Then we add dated income and subtract dated expenses for
                    each day of the planning window.
                  </p>
                  <div className="formula">
                    Tomorrow’s cash = today’s cash + money in − money out
                  </div>
                  <p>
                    Amounts are calculated in integer cents. Credit-card
                    balances are debt, not spendable money. Scheduled minimum
                    payments reduce cash; we do not assume the entire debt is
                    repaid.
                  </p>
                  <h3>Timing assumptions</h3>
                  <ul>
                    <li>The demo starts May 15, 2027 and projects 90 days.</li>
                    <li>
                      Internship pay is take-home pay, repeated every 14 days
                      from the first paycheck.
                    </li>
                    <li>
                      The campus job stops paying once the internship starts. A
                      partial final paycheck is not modeled.
                    </li>
                    <li>
                      Moving costs and the housing deposit occur two days before
                      the move.
                    </li>
                    <li>
                      New rent is charged on move-in and on the first of
                      subsequent months. No proration, deposit refund, interest,
                      inflation, or overdraft fees are included.
                    </li>
                    <li>
                      Weekly essentials are charged on Mondays. Bills due on a
                      missing day, such as February 31, use that month’s last
                      day.
                    </li>
                    <li>
                      Balances are end-of-day totals. Intraday transaction order
                      and bank processing delays are not modeled.
                    </li>
                  </ul>
                </section>
                <section className="panel prose">
                  <h2>Understand the indicators</h2>
                  <h3>Lowest cash balance</h3>
                  <p>
                    The lowest opening or end-of-day balance in the window. A
                    negative amount signals a modeled funding gap, not an
                    approved overdraft.
                  </p>
                  <h3>Days below your cushion</h3>
                  <p>
                    Days ending below your chosen buffer. The cushion is a
                    target, not a separate expense or inaccessible account.
                  </p>
                  <h3>Cash at the finish line</h3>
                  <p>
                    Your projected balance at the end of the window. A healthy
                    ending balance can still hide an earlier shortfall.
                  </p>
                  <h3>What AI does</h3>
                  <p>
                    When configured, Gemini explains the calculated results. The
                    forecast itself is deterministic, and its numbers remain the
                    source of truth. Without an AI key, a calculation-based
                    summary is shown.
                  </p>
                  <h3>Data and privacy</h3>
                  <p>
                    This prototype uses fictional profiles and the Nessie
                    banking sandbox. Plans are saved in your browser, with
                    optional Atlas storage scoped to an anonymous browser
                    session. It is designed for demonstration, not real
                    financial accounts.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setModal("sources")}
                  >
                    View connections
                    <Link2 size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              <Brand /> A clearer picture of what comes next.
            </span>
            <span>
              Illustrative projections · USD ·{" "}
              <button onClick={() => setView("method")}>
                View assumptions
              </button>
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="dialog-content">
          <button
            className="dialog-close icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          {modal === "save" ? (
            <form onSubmit={savePlan}>
              <span className="dialog-symbol">
                <Bookmark size={25} />
              </span>
              <h2>Keep this possibility.</h2>
              <p>
                Save the assumptions and money picture together so you can come
                back to them.
              </p>
              <label className="text-field">
                Plan name
                <input
                  autoFocus
                  maxLength={60}
                  required
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="My summer in Austin"
                />
              </label>
              <div className="save-preview">
                <span>
                  Lowest balance<strong>{money(result.minimumCents)}</strong>
                </span>
                <span>
                  Finish line<strong>{money(result.endingCents)}</strong>
                </span>
              </div>
              <button
                className="button primary full-width"
                disabled={busy === "save"}
              >
                {busy === "save" ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Bookmark size={16} />
                )}
                Save plan
              </button>
              <small className="dialog-note">
                {status?.mongodb
                  ? "Saved to your browser session in Atlas, with a browser backup."
                  : "Saved privately in this browser. Clearing browser data removes saved plans."}
              </small>
            </form>
          ) : (
            <>
              <span className="dialog-symbol">
                <Link2 size={25} />
              </span>
              <h2>Your connections.</h2>
              <p>Use fictional sandbox data to explore real decisions.</p>
              <div className="connection-row">
                <div>
                  <strong>Capital One Nessie</strong>
                  <span>
                    {portfolio.source === "nessie"
                      ? "Sandbox data imported"
                      : status?.nessie
                        ? "API key configured; ready to import"
                        : "Needs a server-side API key"}
                  </span>
                </div>
                <span
                  className={`connection-status ${status?.nessie ? "ready" : ""}`}
                >
                  {status?.nessie ? "Ready" : "Not connected"}
                </span>
              </div>
              <button
                className="button primary full-width"
                onClick={importAccounts}
                disabled={busy === "nessie"}
              >
                {busy === "nessie" ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <ArrowLeftRight size={16} />
                )}
                Import sandbox accounts
              </button>
              {connectionError && (
                <p className="connection-error" role="alert">
                  {connectionError}
                </p>
              )}
              <small className="dialog-note">
                Reads the configured fictional customer’s balances and recurring
                bills. No transfers or payments are made.
              </small>
              <div className="connection-row">
                <div>
                  <strong>MongoDB Atlas</strong>
                  <span>
                    {status?.mongodb
                      ? "Cloud storage configured"
                      : "Plans are currently saved in this browser"}
                  </span>
                </div>
                <span
                  className={`connection-status ${status?.mongodb ? "ready" : ""}`}
                >
                  {status?.mongodb ? "Configured" : "Browser mode"}
                </span>
              </div>
              <div className="connection-row">
                <div>
                  <strong>Gemini explanations</strong>
                  <span>
                    {status?.ai
                      ? "AI explains the calculated forecast"
                      : "Calculation summaries available without AI"}
                  </span>
                </div>
                <span
                  className={`connection-status ${status?.ai ? "ready" : ""}`}
                >
                  {status?.ai ? "Configured" : "Optional"}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setPortfolio(demoPortfolio);
                  setModal(null);
                  notify("Switched to the built-in fictional profile.");
                }}
              >
                Use built-in demo profile
                <ArrowRight size={14} />
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
