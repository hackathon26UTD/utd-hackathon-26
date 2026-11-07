import { z } from "zod";
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Use a valid calendar date");
const cents = z.number().int().min(0).max(100_000_000);
export const accountSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(100),
  type: z.enum(["Checking", "Savings", "Credit Card"]),
  balanceCents: cents,
});
export const commitmentSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(100),
  amountCents: cents,
  day: z.number().int().min(1).max(31),
  category: z.string().max(50),
});
export const portfolioSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(80),
  subtitle: z.string().max(160),
  asOf: isoDate,
  accounts: z.array(accountSchema).max(30),
  commitments: z.array(commitmentSchema).max(50),
  campusRentCents: cents,
  campusPayCents: cents,
  campusPayDay: z.number().int().min(1).max(28),
  weeklyEssentialsCents: cents,
  source: z.enum(["sample", "nessie"]),
  sourceNote: z.string().max(600),
});
export const scenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(["internship", "stay"]),
    startDate: isoDate,
    firstPayDate: isoDate,
    paycheckCents: cents,
    rentCents: cents,
    depositCents: cents,
    movingCents: cents,
    weeklyEssentialsCents: cents,
    extraMonthlyCents: cents,
    stipendCents: cents,
    stipendDate: isoDate,
    includeSavings: z.boolean(),
    cushionCents: cents,
    purchaseCents: cents,
    purchaseDate: isoDate,
    horizonDays: z.number().int().min(30).max(180),
  })
  .refine((v) => v.firstPayDate >= v.startDate, {
    message: "First paycheck must be on or after the internship starts",
    path: ["firstPayDate"],
  });
export const planInputSchema = z.object({
  scenario: scenarioSchema,
  portfolio: portfolioSchema,
});
export type Account = z.infer<typeof accountSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type SavedPlan = {
  id: string;
  savedAt: string;
  scenario: Scenario;
  portfolio: Portfolio;
};
export type LedgerEvent = {
  id: string;
  date: string;
  name: string;
  amountCents: number;
  category: string;
};
export type ForecastDay = {
  date: string;
  balanceCents: number;
  events: LedgerEvent[];
};
export type Forecast = {
  days: ForecastDay[];
  events: LedgerEvent[];
  openingCents: number;
  endingCents: number;
  minimumCents: number;
  minimumDate: string;
  firstNegativeDate: string | null;
  daysBelowZero: number;
  daysBelowCushion: number;
  fundingGapCents: number;
  cushionGapCents: number;
  incomeCents: number;
  expenseCents: number;
  fixedCostShare: number;
};
