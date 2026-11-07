import { demoPortfolio } from "./demo";
import type { Portfolio } from "./model";
import { portfolioSchema } from "./model";
type NessieAccount = {
  _id: string;
  nickname?: string;
  type: string;
  balance: number;
};
type NessieBill = {
  _id: string;
  payee: string;
  payment_amount: number;
  recurring_date?: number;
  status?: string;
};
export async function nessieGet(path: string) {
  const key = process.env.NESSIE_API_KEY;
  if (!key)
    throw new Error("Add NESSIE_API_KEY on the server to connect the sandbox.");
  const url = new URL(path, "https://prod-api.nessieisreal.com");
  url.searchParams.set("key", key);
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      "Nessie could not be reached. Your current plan has not changed.",
    );
  }
  if (!res.ok)
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Nessie did not accept the configured API key."
        : `Nessie returned status ${res.status}. Check the customer ID and sandbox setup.`,
    );
  return res.json();
}
export function normalizeNessie(
  accounts: NessieAccount[],
  bills: NessieBill[],
  name: string,
  id: string,
): Portfolio {
  const eligible = accounts.filter((a) =>
    ["Checking", "Savings", "Credit Card"].includes(a.type),
  );
  if (!eligible.some((a) => a.type === "Checking" || a.type === "Savings"))
    throw new Error(
      "This sandbox customer needs a checking or savings account.",
    );
  const recurring = bills.filter(
    (b) =>
      b.status !== "cancelled" &&
      Number.isInteger(b.recurring_date) &&
      b.recurring_date! >= 1 &&
      b.recurring_date! <= 31 &&
      Number.isFinite(b.payment_amount),
  );
  const rent = recurring.find((b) => /rent|housing/i.test(b.payee));
  return portfolioSchema.parse({
    ...demoPortfolio,
    id,
    name,
    subtitle: "Nessie sandbox profile · internship planning example",
    accounts: eligible.map((a) => ({
      id: a._id,
      name: a.nickname || a.type,
      type: a.type,
      balanceCents: Math.round(a.balance * 100),
    })),
    commitments: recurring
      .filter((b) => !/rent|housing/i.test(b.payee))
      .map((b) => ({
        id: b._id,
        name: b.payee,
        amountCents: Math.round(b.payment_amount * 100),
        day: b.recurring_date,
        category: "Essentials",
      })),
    campusRentCents: rent
      ? Math.round(rent.payment_amount * 100)
      : demoPortfolio.campusRentCents,
    source: "nessie",
    sourceNote: `Balances and ${recurring.length} monthly bills imported from the Nessie sandbox. They are treated as the opening snapshot for the illustrative May 15, 2027 planning window. Campus income remains an illustrative assumption; internship terms are editable. Non-monthly bills are not forecast.`,
  });
}
export async function importNessie(): Promise<Portfolio> {
  const id = process.env.NESSIE_CUSTOMER_ID;
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error(
      "Set NESSIE_CUSTOMER_ID to your fictional sandbox customer. See the setup guide for the seed script.",
    );
  const [customer, accounts] = await Promise.all([
    nessieGet(`/customers/${id}`),
    nessieGet(`/customers/${id}/accounts`),
  ]);
  if (!Array.isArray(accounts) || accounts.length > 30)
    throw new Error("Nessie returned an unsupported account list.");
  const billLists = await Promise.all(
    accounts.map((a) =>
      nessieGet(`/accounts/${encodeURIComponent(a._id)}/bills`),
    ),
  );
  if (billLists.some((b) => !Array.isArray(b)))
    throw new Error("Nessie returned an unsupported bill list.");
  return normalizeNessie(
    accounts,
    billLists.flat(),
    `${customer.first_name || "Demo"} ${customer.last_name || "student"}`,
    id,
  );
}
