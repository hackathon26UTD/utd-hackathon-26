"use client";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Download,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { money, shortDate } from "@/lib/forecast";
import {
  repairOptions,
  stressCases,
  stressedForecast,
  type StressKey,
} from "@/lib/decision";
import type { Portfolio, Scenario } from "@/lib/model";
import { downloadDecisionBrief } from "@/lib/decision-brief";

export function RepairPanel({
  portfolio,
  scenario,
  onApply,
  compact = false,
}: {
  portfolio: Portfolio;
  scenario: Scenario;
  onApply: (s: Scenario) => void;
  compact?: boolean;
}) {
  const [protectBadWeek, setProtectBadWeek] = useState(false);
  const stress: StressKey = protectBadWeek ? "both" : "none";
  const current = useMemo(
    () => stressedForecast(portfolio, scenario, stress),
    [portfolio, scenario, stress],
  );
  const options = useMemo(
    () => repairOptions(portfolio, scenario, stress),
    [portfolio, scenario, stress],
  );
  return (
    <section
      className={`decision-panel ${compact ? "compact" : ""}`}
      aria-labelledby="repair-title"
    >
      <div className="decision-heading">
        <div>
          <div className="decision-eyebrow">
            <SlidersHorizontal size={15} />
            CALCULATED POSSIBILITIES
          </div>
          <h2 id="repair-title">Find a way to make it work.</h2>
          <p>Keep the opportunity. See exactly what would need to change.</p>
        </div>
        <label className="stress-guard">
          <input
            type="checkbox"
            checked={protectBadWeek}
            onChange={(e) => setProtectBadWeek(e.target.checked)}
          />
          <span>
            Also cover a bad week
            <small>Payroll +7 days and a $500 surprise</small>
          </span>
        </label>
      </div>
      <div className="constraint-note">
        <ShieldCheck size={17} />
        <span>
          Target: at least <strong>{money(scenario.cushionCents)}</strong>{" "}
          available every day.{" "}
          {protectBadWeek
            ? "Includes both stress cases."
            : "Uses your current assumptions."}
        </span>
      </div>
      {current.minimumCents >= scenario.cushionCents ? (
        <div className="decision-success">
          <Check size={23} />
          <div>
            <strong>
              This plan preserves your cushion
              {protectBadWeek ? " in both stress cases" : ""}.
            </strong>
            <p>
              The lowest modeled balance is {money(current.minimumCents)} on{" "}
              {shortDate(current.minimumDate)}. Confirm the assumptions before
              committing.
            </p>
          </div>
        </div>
      ) : options.length ? (
        <div className="repair-grid">
          {options.map((option) => (
            <article key={option.id} className="repair-card">
              <span className="repair-type">{option.title}</span>
              <h3>{option.headline}</h3>
              <p>{option.details}</p>
              <dl>
                {option.changes.map((c) => (
                  <div key={c.label}>
                    <dt>{c.label}</dt>
                    <dd>
                      <s>{c.before}</s>
                      <ArrowRight size={12} />
                      <strong>{c.after}</strong>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="repair-result">
                <span>
                  New lowest balance{protectBadWeek ? " · bad week" : ""}
                </span>
                <strong>{money(option.forecast.minimumCents)}</strong>
              </div>
              <button
                className="button primary full-width"
                onClick={() => onApply(option.scenario)}
              >
                Try this plan
                <ArrowRight size={15} />
              </button>
              <small>
                <CircleHelp size={13} />
                {option.tradeoff}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <div className="decision-empty">
          <strong>No option in this search protects the whole window.</strong>
          <p>
            These housing and stipend changes cannot solve every situation.
            Check earlier obligations, the opening balance, or a different
            opportunity. No extra income is assumed automatically.
          </p>
        </div>
      )}
      <p className="decision-footnote">
        Each option is recalculated day by day. Availability and payment dates
        are assumptions to verify, not offers or approvals.
      </p>
    </section>
  );
}
export function StressPanel({
  portfolio,
  scenario,
  onSelect,
  selected = "none",
}: {
  portfolio: Portfolio;
  scenario: Scenario;
  onSelect?: (s: StressKey) => void;
  selected?: StressKey;
}) {
  const StressCard = onSelect ? "button" : "article";
  const cases =
    scenario.kind === "internship"
      ? stressCases
      : stressCases.filter((c) => c.id === "expense");
  return (
    <section className="stress-panel" aria-labelledby="stress-title">
      <div className="decision-heading">
        <div>
          <div className="decision-eyebrow">
            <ShieldCheck size={15} />
            TEST THE ASSUMPTIONS
          </div>
          <h2 id="stress-title">Would it survive a bad week?</h2>
          <p>
            These are specific what-if cases, not probabilities or a guarantee.
          </p>
        </div>
        {onSelect && (
          <button className="text-button" onClick={() => onSelect("none")}>
            Show original plan
          </button>
        )}
      </div>
      <div className="stress-grid">
        {cases.map((c) => {
          const f = stressedForecast(portfolio, scenario, c.id);
          const fits = f.minimumCents >= scenario.cushionCents;
          return (
            <StressCard
              key={c.id}
              className={`stress-case ${selected === c.id ? "selected" : ""}`}
              onClick={() => onSelect?.(c.id)}
              aria-pressed={onSelect ? selected === c.id : undefined}
            >
              <span>{c.title}</span>
              <strong className={fits ? "income-text" : "negative-text"}>
                {money(f.minimumCents)}
              </strong>
              <small>Lowest balance · {shortDate(f.minimumDate)}</small>
              <span className={`stress-verdict ${fits ? "fits" : "misses"}`}>
                {fits ? <Check size={14} /> : <CircleHelp size={14} />}{" "}
                {fits
                  ? "Cushion preserved"
                  : `${money(f.cushionGapCents)} below your cushion`}
              </span>
              <p>
                {scenario.kind === "internship"
                  ? c.detail
                  : `One extra expense on ${shortDate(scenario.startDate > portfolio.asOf ? scenario.startDate : portfolio.asOf)}.`}
              </p>
            </StressCard>
          );
        })}
      </div>
    </section>
  );
}
export function BriefButton({
  portfolio,
  scenario,
}: {
  portfolio: Portfolio;
  scenario: Scenario;
}) {
  return (
    <button
      className="button secondary"
      onClick={() => downloadDecisionBrief(portfolio, scenario)}
    >
      <Download size={16} />
      Download decision brief
    </button>
  );
}
