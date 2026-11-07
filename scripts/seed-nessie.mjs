import fs from "node:fs";
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.NESSIE_API_KEY;
if (!key) {
  console.error("Set NESSIE_API_KEY in .env.local first.");
  process.exit(1);
}
async function request(path, method = "GET", payload) {
  const url = new URL(path, "https://prod-api.nessieisreal.com");
  url.searchParams.set("key", key);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Nessie is unreachable. No credentials were printed.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `Nessie ${method} ${path.split("?")[0]} returned ${res.status}. Check the sandbox API key and endpoint permissions.`,
    );
  return data;
}
try {
  const customers = await request("/customers");
  if (!Array.isArray(customers))
    throw new Error("Unexpected customer list format.");
  let customer = customers.find(
    (c) =>
      c.first_name === "Maya" &&
      c.last_name === "Chen" &&
      c.address?.street_name === "Demo Avenue",
  );
  if (!customer) {
    const created = await request("/customers", "POST", {
      first_name: "Maya",
      last_name: "Chen",
      address: {
        street_number: "800",
        street_name: "Demo Avenue",
        city: "Richardson",
        state: "TX",
        zip: "75080",
      },
    });
    customer = created.objectCreated || created;
    if (!customer._id)
      throw new Error(
        "Customer creation succeeded but returned no customer ID. Inspect the sandbox before retrying.",
      );
  }
  let accounts = await request(`/customers/${customer._id}/accounts`);
  for (const [type, nickname, balance] of [
    ["Checking", "FutureYou everyday checking", 2600],
    ["Savings", "FutureYou rainy-day savings", 900],
    ["Credit Card", "FutureYou student credit", 450],
  ]) {
    if (!accounts.some((a) => a.nickname === nickname))
      await request(`/customers/${customer._id}/accounts`, "POST", {
        type,
        nickname,
        rewards: 0,
        balance,
      });
  }
  accounts = await request(`/customers/${customer._id}/accounts`);
  const checking = accounts.find(
    (a) => a.nickname === "FutureYou everyday checking",
  );
  if (!checking) throw new Error("Checking account was not found after setup.");
  const bills = await request(`/accounts/${checking._id}/bills`);
  for (const [payee, payment_amount, recurring_date] of [
    ["Campus rent", 750, 1],
    ["Phone plan", 45, 10],
    ["Transit pass", 65, 5],
    ["Insurance", 40, 12],
    ["Credit card minimum", 75, 18],
  ]) {
    // Nessie currently accepts these fields as optional on creation but requires them on reads.
    if (!bills.some((b) => b.payee === payee && b.status !== "cancelled"))
      await request(`/accounts/${checking._id}/bills`, "POST", {
        status: "recurring",
        payee,
        nickname: payee,
        payment_amount,
        recurring_date,
        payment_date: `2027-06-${String(recurring_date).padStart(2, "0")}`,
      });
  }
  const verifiedBills = await request(`/accounts/${checking._id}/bills`);
  if (!Array.isArray(verifiedBills) || verifiedBills.length < 5)
    throw new Error("Could not verify the seeded bills.");
  const existing = fs.existsSync(".env.local")
    ? fs.readFileSync(".env.local", "utf8")
    : "";
  const line = `NESSIE_CUSTOMER_ID=${customer._id}`;
  fs.writeFileSync(
    ".env.local",
    /^NESSIE_CUSTOMER_ID=.*$/m.test(existing)
      ? existing.replace(/^NESSIE_CUSTOMER_ID=.*$/m, line)
      : `${existing}\n${line}\n`,
    { mode: 0o600 },
  );
  console.log(
    "Nessie verified. Fictional FutureYou customer, three accounts, and five recurring bills are ready. Customer ID saved in ignored .env.local.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
