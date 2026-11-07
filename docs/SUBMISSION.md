# FutureYou — submission draft and team finish plan

This is a draft for the team to review and enter. It has not been submitted to Devpost.

## Project title and tagline

**FutureYou** — See what needs to be true before you say yes.

## Inspiration

A student can accept an exciting internship, end the summer with a positive balance, and still run out of cash before the first paycheck. We wanted to make that gap visible before the commitment, then help the student explore specific changes that could make it work.

## What it does

FutureYou models a fictional student's 90-day internship decision. It combines account balances and recurring obligations with explicit housing, moving and payroll assumptions. A daily timeline exposes the early cash shortfall. A deterministic search calculates a housing ceiling or the upfront support needed to preserve a chosen cushion. The user can compare a roommate plan, test delayed payroll and unexpected expenses, save plans in their browser, and export the ledger or a printable decision brief. Gemini provides a plain-language explanation of recomputed facts, including the stress case.

## How we built it

Next.js, React and TypeScript power the application. Capital One Nessie provides actual sandbox accounts and recurring bills, all containing fictional data. The forecast engine schedules events in UTC and calculates money in integer cents. Bounded searches rerun that same engine to find whole-dollar repair options. Gemini receives formatted calculation facts without names or account identifiers. Integration failures retain labeled calculation-based summaries and a built-in fictional profile. The standalone HTML decision brief contains its own chart and styles and works offline.

## Challenges and what we learned

Cash timing matters as much as totals. A stipend after the shortfall cannot repair an earlier negative balance. A plan that survives one expense can still fail when payroll moves. We made these distinctions visible in both the interface and automated tests. We also learned to separate mathematical feasibility from an available housing option or employer offer.

Do not present this as user research. Add only actual interviews, findings, or implementation challenges the team can substantiate.

## What works and what does not

Working: hosted app, guided presentation, deterministic forecasts and repairs, live Nessie sandbox import, live Gemini explanations with labeled fallback, browser persistence, CSV and offline decision-brief exports.

Not implemented: real bank linking, account authentication, transfers, financial-product recommendations, predictive accuracy claims, tax/interest/fee modeling, intraday cash ordering, or full offline app loading. MongoDB Atlas API code exists, but cloud storage is not active in this deployment. An existing cluster does not qualify as a working Atlas integration.

## Track choices

| Entry | Evidence to demonstrate |
| --- | --- |
| **PNC — 360° Financial Health Navigator** | Combined cash/accounts and obligations; lowest cash, days below cushion and ending balance; scenario and stress forecasts; AI explanation of the next decision |
| **Capital One — Best Use of Nessie** | Live sandbox account and recurring-bill import that actually changes calculation inputs |
| **Design** | A five-chapter narrative, understandable assumptions, direct comparisons and a useful takeaway |
| **Gemini API (MLH)** | Live Gemini output with an explicit label; server recomputes facts first |
| **Overall** | Automatic consideration according to the organizer notes supplied by the team |

The event site says a team can enter up to two company tracks: choose PNC and Capital One. Confirm whether general and MLH entries are counted separately before submitting. Beginner applies only if the majority of the team are first-time hackathon participants. Do not enter Hardware for this software project. Do not claim MongoDB Atlas until a real cloud save/restore is configured and verified.

Official event schedule, checked November 7, 2026: initial submission window **11:00–11:15 p.m. CT November 7**; final deadline **noon CT November 8**. Use the actual Devpost form and organizer announcements as the final authority. Source: https://zeroday.hackutd.co/

## Submission links and access

- Live demo: https://futureyou-utd-26.vercel.app/demo
- Full planner: https://futureyou-utd-26.vercel.app
- Code branch: https://github.com/hackathon26UTD/utd-hackathon-26/tree/feat/futureyou
- Draft PR: https://github.com/hackathon26UTD/utd-hackathon-26/pull/15

The repository is private and main is not the FutureYou branch. Confirm the event's code-access requirement, ensure judges can access the submitted code, and agree with teammates before merging or changing visibility. Other project branches share this repository. The live app requires no judge login.

Credits: Next.js, React, TypeScript, Zod, Lucide, DM Sans and Manrope, Capital One Nessie, Google Gemini, Vercel, and the existing organization starter. Disclose AI coding assistance and pre-existing work accurately under the event rules. The team must add its own actual contribution descriptions; do not assign authorship from presentation roles.

## How to give this the best chance

Focus on a working, defensible story rather than extra integrations. A stronger demo is not a guarantee of a prize.

1. **Presenter 1: user and submission.** Ask five students to explain what they think the chart means and what they would verify before accepting an internship. Record only actual observations, without collecting financial details. Own track selection, attribution and submission fields.
2. **Presenter 2: data and evidence.** Verify the sandbox import and explain which inputs come from Nessie versus the scenario. Keep the exact-number table in DEMO.md handy. Do not edit sandbox balances before judging.
3. **Presenter 3: behavior and edge cases.** Recheck the roommate option, all three stress tests, and the whole-dollar repair boundaries. Own the calculation questions and limitations.
4. **Presenter 4: operator and delivery.** Keep the laptop, app tabs, offline brief, charger and optional screen recording ready. Verify Gemini output and take the AI/architecture questions.

Freeze feature changes early enough for three complete rehearsals. Fix any broken primary flow; resist adding another scenario, AI provider or database simply to expand the prize list. All four presenters should be able to deliver the closing sentence if someone loses their place.
