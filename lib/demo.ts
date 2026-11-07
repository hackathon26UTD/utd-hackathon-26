import type { Portfolio, Scenario } from "./model";
export const demoPortfolio: Portfolio = {
  id: "maya-chen-demo",
  name: "Maya Chen",
  subtitle: "UT Dallas student · planning a summer in Austin",
  asOf: "2027-05-15",
  accounts: [
    {
      id: "checking",
      name: "Everyday checking",
      type: "Checking",
      balanceCents: 260000,
    },
    {
      id: "savings",
      name: "Rainy-day savings",
      type: "Savings",
      balanceCents: 90000,
    },
    {
      id: "credit",
      name: "Student credit card",
      type: "Credit Card",
      balanceCents: 45000,
    },
  ],
  commitments: [
    {
      id: "phone",
      name: "Phone plan",
      amountCents: 4500,
      day: 10,
      category: "Essentials",
    },
    {
      id: "transit",
      name: "Transit pass",
      amountCents: 6500,
      day: 5,
      category: "Transport",
    },
    {
      id: "insurance",
      name: "Insurance",
      amountCents: 4000,
      day: 12,
      category: "Essentials",
    },
    {
      id: "card",
      name: "Credit card minimum",
      amountCents: 7500,
      day: 18,
      category: "Debt payment",
    },
  ],
  campusRentCents: 75000,
  campusPayCents: 120000,
  campusPayDay: 20,
  weeklyEssentialsCents: 9000,
  source: "sample",
  sourceNote:
    "Fictional student and illustrative costs. Balances are a snapshot on May 15, 2027; income and bills are planning assumptions.",
};
export const defaultScenario: Scenario = {
  name: "Austin internship",
  kind: "internship",
  startDate: "2027-06-01",
  firstPayDate: "2027-07-01",
  paycheckCents: 210000,
  rentCents: 165000,
  depositCents: 165000,
  movingCents: 110000,
  weeklyEssentialsCents: 10500,
  extraMonthlyCents: 6000,
  stipendCents: 0,
  stipendDate: "2027-05-29",
  includeSavings: true,
  cushionCents: 50000,
  purchaseCents: 0,
  purchaseDate: "2027-06-05",
  horizonDays: 90,
};
export const presets: {
  id: string;
  title: string;
  subtitle: string;
  scenario: Scenario;
}[] = [
  {
    id: "austin",
    title: "Take the internship",
    subtitle: "Austin · new city, new possibilities",
    scenario: defaultScenario,
  },
  {
    id: "roommate",
    title: "Move with a roommate",
    subtitle: "Same opportunity. A softer landing.",
    scenario: {
      ...defaultScenario,
      name: "Austin with a roommate",
      rentCents: 95000,
      depositCents: 95000,
      movingCents: 65000,
    },
  },
  {
    id: "stay",
    title: "Stay close to home",
    subtitle: "Keep your campus job and current costs",
    scenario: { ...defaultScenario, kind: "stay", name: "Stay in Dallas" },
  },
];
