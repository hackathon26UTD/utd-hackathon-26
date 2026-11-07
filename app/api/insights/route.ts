import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { planInputSchema } from "@/lib/model";
import { explainForecast, forecast, money } from "@/lib/forecast";
import { body, response } from "@/lib/server";
import { stressedForecast } from "@/lib/decision";
export const runtime = "nodejs";

// Bounded per-instance demo protection. Provider quotas remain the global spending limit.
const cache = new Map<string, { text: string; expires: number }>();
const inFlight = new Set<string>();
let windowStarted = Date.now();
let requestsInWindow = 0;

export async function POST(request: NextRequest) {
  let input;
  try {
    input = planInputSchema.parse(await body(request));
  } catch {
    return response({ error: "Invalid scenario." }, undefined, 400);
  }
  const result = forecast(input.portfolio, input.scenario);
  const fallback = explainForecast(result, input.scenario);
  if (!process.env.GEMINI_API_KEY)
    return response({ text: fallback, source: "calculation" });

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const badWeek = stressedForecast(
    input.portfolio,
    input.scenario,
    input.scenario.kind === "internship" ? "both" : "expense",
  );
  const facts = {
    scenario: input.scenario.kind,
    planningStart: input.portfolio.asOf,
    planningEnd: result.days.at(-1)!.date,
    firstPayDate:
      input.scenario.kind === "internship" ? input.scenario.firstPayDate : null,
    openingCash: money(result.openingCents, 2),
    minimumCash: money(result.minimumCents, 2),
    minimumDate: result.minimumDate,
    firstNegativeDate: result.firstNegativeDate,
    extraOpeningCashToAvoidNegativeBalances: money(result.fundingGapCents, 2),
    extraOpeningCashToPreserveCushion: money(result.cushionGapCents, 2),
    chosenCushion: money(input.scenario.cushionCents, 2),
    endingCash: money(result.endingCents, 2),
    stressAssumption:
      input.scenario.kind === "internship"
        ? "Payroll schedule 7 days later plus a $500 expense at move-in"
        : "$500 extra expense",
    stressMinimumCash: money(badWeek.minimumCents, 2),
    stressMinimumDate: badWeek.minimumDate,
    stressFirstNegativeDate: badWeek.firstNegativeDate,
    stressCushionGap: money(badWeek.cushionGapCents, 2),
  };
  const key = createHash("sha256")
    .update(JSON.stringify({ model, facts }))
    .digest("hex");
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  const cached = cache.get(key);
  if (cached) return response({ text: cached.text, source: "gemini" });
  if (now - windowStarted > 3600000) {
    windowStarted = now;
    requestsInWindow = 0;
  }
  if (inFlight.has(key) || inFlight.size >= 3 || requestsInWindow >= 60) {
    return response({
      text: fallback,
      source: "calculation",
      note: "AI explanations are busy. Your calculated summary is ready.",
    });
  }
  requestsInWindow += 1;
  inFlight.add(key);
  try {
    if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY.trim(),
        },
        signal: AbortSignal.timeout(18000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Explain this fictional student cash-flow simulation in one complete plain-text paragraph of at most 75 words. Do not give investment, tax, credit-approval, or product advice. Use only supplied calculations; do not calculate new numbers or make promises. Emphasize the timing of a shortfall, whether the ending balance conceals it, and one practical assumption to verify with an employer or landlord. Distinguish the base case from the supplied stress case and explain whether the stress case violates the cushion or goes negative. Do not call the plan safe or guaranteed. If there is no base-case shortfall, say so. Do not repeat any amounts, dates, numerical values or month names in your answer, in digits or in words. The interface displays verified figures separately; your role is to explain the tradeoff and a practical next step, not restate the arithmetic. No names or account identifiers are supplied. Facts: ${JSON.stringify(facts)}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 600,
            ...(model.startsWith("gemini-2.5-flash")
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        }),
      },
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text || "")
      .join("")
      .trim();
    // Numeric/date claims stay in deterministic UI so an explanation cannot
    // accidentally attach a base-case date to a stress-case balance.
    if (
      candidate?.finishReason !== "STOP" ||
      !text ||
      text.length > 1800 ||
      /[0-9$€£%]|\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/i.test(
        text,
      )
    )
      throw new Error();
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { text, expires: now + 10 * 60000 });
    return response({ text, source: "gemini" });
  } catch {
    return response({
      text: fallback,
      source: "calculation",
      note: "AI explanation is unavailable; showing the verified calculation summary.",
    });
  } finally {
    inFlight.delete(key);
  }
}
