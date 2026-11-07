# FutureYou — three-minute judging demo

Live presentation: https://futureyou-utd-26.vercel.app/demo

Full planner: https://futureyou-utd-26.vercel.app

Format supplied by the team: **3 minutes presenting, then 2 minutes for questions. Four presenters.**

## Positioning

**A good opportunity can still fail because the money arrives too late. FutureYou shows what needs to be true before you say yes.**

One fictional student, one internship decision, one reproducible story. The distinctive feature is the combination of a daily cash-flow ledger, calculated conditions that close the gap, and explicit stress tests. Do not claim no competing product has similar features.

## Before the judges arrive

- Open `/demo`, wait for **Live Nessie sandbox**, and verify $3,500 opening cash and $3,225 ending cash. These are sandbox records, not real bank accounts. If import fails, the badge says Synthetic profile; explain the fallback truthfully.
- Walk through once, choose **Share the move**, click **Explain with Gemini** on the last chapter, and verify its source label. This also warms the server cache. Restart before presenting. The reset keeps the current imported snapshot while attempting a refresh; it does not delete saved plans.
- Use a laptop at ordinary browser zoom. Keep one operator for the entire presentation; do not pass the laptop between speakers. All four people speak. Chapter buttons, Next/Back, and left/right arrows on the page move the story. Arrow keys inside the chart explore dates instead.
- Download the decision brief for the roommate plan, or use the checked-in [demo-backup.html](demo-backup.html). Open that HTML file in a separate browser tab before judging. It contains the chart, assumptions and all three stress checks with no external assets. Print to PDF if desired.
- Keep the full planner open in a second tab for Q&A. If practical, record one clean three-minute run as another fallback. This repository does not contain a recorded demo video yet.

## Four-person run of show

Assign the roles to yourselves; these are presentation responsibilities, not claims about who wrote code. Presenter 4 drives the laptop throughout. Presenter 1 tracks time unobtrusively.

| Time | Speaker | Operator action | Words to say |
| --- | --- | --- | --- |
| 0:00–0:35 | 1 — problem and person | Chapter 1, then **See the whole picture** | “Maya is a UT Dallas student with an internship offer in Austin. She has $3,500 available and expects $2,100 every two weeks. Her summer ends with more than $3,000, so it looks affordable. But her first paycheck arrives a month after she starts. FutureYou asks a better question: can she get through every day before that paycheck?” |
| 0:35–1:15 | 2 — evidence and calculation | Chapter 2; point to the minimum and optionally expand **Show the calculation** | “We import fictional accounts and recurring bills through Capital One’s Nessie API. Credit-card debt is not spendable cash. Our engine schedules bills, moving costs, rent and pay day by day. Maya first goes negative June 1 and reaches minus $750 on June 28. To keep her chosen $500 cushion, she needs a $1,250 bridge before the gap. A positive ending balance hides that timing problem.” |
| 1:15–2:05 | 3 — calculated fix and stress | Chapter 3; point out $1,025 rent ceiling and $1,250 support; choose **Share the move → Try this plan**. Chapter 4; select **$500 surprise**, then **Both at once**. | “FutureYou calculates what could change. At these assumptions, rent and deposit capped at $1,025 preserve her cushion, or $1,250 of upfront support does. These are possibilities to verify. Let’s choose a roommate: $950 rent, a $950 deposit and $650 moving costs. Her low point rises to $1,100. A $500 surprise still leaves $600. But add a delayed payroll schedule and she falls to minus $520. We expose that uncertainty instead of promising the plan is safe.” |
| 2:05–2:45 | 4 — AI, takeaway and close | Chapter 5; **Explain with Gemini**; point to separate base/stress summary and **Download decision brief**. Download need not be opened during the clock. | “Gemini explains the tradeoff using server-calculated facts. Verified figures are displayed separately. Maya leaves with a printable brief, the assumptions to confirm with her employer and landlord, and the stress tests. The same planner lets her change inputs, save scenarios in this browser and export the full ledger. FutureYou turns ‘Can I afford it?’ into ‘What needs to be true?’” |
| 2:45–3:00 | Buffer | Remain on the takeaway. | Stop talking when the story is complete. Do not add another feature tour. |

This is roughly 350 spoken words. Rehearse with a timer; use the remaining time for pauses and clicks, not extra claims. If Gemini is slow, say “the verified calculation summary is already available” and continue. Never wait silently for a request.

## The exact numbers

USD; May 15–August 12, 2027; integer-cent simulation. These match the fixed sample and the seeded Nessie sandbox, provided nobody edits its records.

| Case | Lowest cash | Date | What it establishes |
| --- | ---: | --- | --- |
| Original internship | −$750 | Jun 28 | Positive $3,225 ending cash conceals an earlier gap |
| Rent/deposit $1,025; other costs unchanged | $500 | Jun 28 | Maximum whole-dollar rent in the searched range preserving the cushion |
| $1,250 total support by May 29 | $500 | Jun 28 | Minimum whole-dollar support at that date preserving the cushion |
| Roommate | $1,100 | Jun 28 | A concrete alternative preserves the base-case cushion |
| Roommate + $500 surprise | $600 | Jun 28 | Preserves the $500 cushion in this specific case |
| Roommate + payroll seven days later | −$20 | Jul 5 | Timing risk remains |
| Roommate + both shocks | −$520 | Jul 5 | $1,020 below the chosen cushion |

All modeled paychecks move in the delay test. It is a shifted payroll schedule, not a catch-up paycheck model. The surprise expense adds to any existing planned purchase. Neither stress case has a claimed probability.

## Two-minute Q&A

Pick one owner per topic; one answer, then stop. Another teammate adds only a missing fact.

| Likely question | Owner | Accurate short answer |
| --- | --- | --- |
| Why not just a budget? | 1 | “The decision is time-specific. An ending balance can look fine while moving costs arrive before income. We calculate conditions for the decision and stress them.” |
| Where is Nessie actually used? | 2 | “Its account balances and recurring bills are normalized into the forecast inputs. The paycheck, move and housing choices are explicit scenario assumptions.” |
| Are these real people or financial predictions? | 2 | “No. Maya and all money are synthetic. This is a deterministic scenario model, not a prediction of actual spending or a financial recommendation.” |
| How did you calculate the fixes? | 3 | “We search whole-dollar rent or total stipend values and rerun the daily ledger. Tests verify the boundary: a dollar more rent or a dollar less support fails the target. Housing search stops at $500; we do not promise an available listing.” |
| What is AI doing? | 4 | “Gemini explains the base and stress cases from server-recomputed facts. Numerical and date claims are rendered separately; generated numeric/date text is rejected. The integer-cent engine owns all arithmetic. Failed or truncated responses fall back to a labeled calculated summary.” |
| Can AI see financial identities? | 4 | “The explanation request to Gemini contains selected formatted calculated facts and dates, not names, account identifiers or free-text plan titles. We only use fictional data here.” |
| What breaks the model? | 3 | “Wrong assumptions. We show the source and allow changes. We omit tax estimation, interest, overdraft fees, rent proration, deposit refunds and intraday ordering. The model uses net pay and end-of-day balances.” |
| Where are plans saved? | 4 | “Browser storage is working. Atlas integration is implemented but not enabled in this deployment because its database-user setup is unresolved. We are not claiming cloud saving.” |
| What would you do next? | 1 | “Validate the internship decision with students, improve payroll schedules and irregular bills, and add consent-based account linking and secure accounts before any real-money use.” |

## Rehearsal and recovery

Run once for correctness, once against the clock, and once with deliberately unavailable network access after loading the app. In that last run, use the already downloaded brief; a fresh page load still requires the hosted app or a local server. There is no offline service worker.

If someone clicks the wrong step, use the chapter navigation. If the plan is wrong, Restart and use Chapter 3 to select the roommate plan. If network access fails, use the sample label and offline brief openly. If time runs short, skip the expanded calculation and go from the $500 stress test straight to the takeaway; keep the warning that delayed pay can still break the plan.
