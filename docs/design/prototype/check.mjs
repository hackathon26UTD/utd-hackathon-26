import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
await fs.mkdir("work", { recursive: true });
const b = await chromium.launch({ channel: "chrome" }), results = [];
for (const mobile of [false, true]) {
  const c = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 } }), p = await c.newPage();
  let errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.REVIEW_BASE_URL || "http://localhost:8797");
  await p.waitForFunction(() => window.reviewReady);
  await p.getByRole("button", { name: "Map scenario", exact: true }).click();
  await p.getByRole("option", { name: "Hurricane exercise" }).click();
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: "Power loss", exact: true }).click();
  await p.getByRole("button", { name: "Water", exact: true }).click();
  for (const state of ["hurricane", "devices", "priorities", "neighborhood", "expanded"]) {
    if (state === "devices") {
      await p.getByRole("button", { name: "Devices", exact: true }).click();
      await p.getByRole("checkbox", { name: "Power loss only" }).click();
      await p.getByRole("button", { name: "Sort devices", exact: true }).click();
      await p.getByRole("option", { name: "Power loss first" }).click();
    }
    if (state === "priorities") {
      await p.getByRole("button", { name: "Priorities", exact: true }).click();
      const control = p.locator('[aria-label^="Assigned priority for"]').first();
      const id = await control.getAttribute("aria-label");
      await control.click();
      await p.getByRole("option", { name: "P3 \xB7 Monitor" }).click();
      results.push({ mobile, assignment: id, assigned: await control.textContent(), stored: await p.evaluate((id2) => review.visibleHomes().find((h) => id2.endsWith(h.id))?.priority, id) });
    }
    if (state === "neighborhood") {
      await p.evaluate(() => {
        review.selectHome(3);
        review.map.jumpTo({ zoom: 12.5 });
      });
      await p.waitForTimeout(700);
      await p.keyboard.press("Escape");
    }
    if (state === "expanded") {
      await p.evaluate(() => review.selectHome(3));
      await p.waitForTimeout(700);
      await p.getByRole("button", { name: "Expand evidence" }).click();
    }
    await p.waitForTimeout(700);
    await p.screenshot({ path: "work/refined-" + state + (mobile ? "-mobile" : "") + ".png" });
    const a = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    results.push({ mobile, state, errors: [...errors], issues: a.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), overflow: await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), visibleDots: await p.locator(".home-pin:visible").count() });
  }
  await c.close();
}
await fs.writeFile("work/refined-audit.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
await b.close();
if(results.some(r=>r.errors?.length||r.issues?.length||r.overflow||('stored' in r&&r.stored!=='3')||(r.state==='hurricane'&&r.visibleDots!==0)||(r.state==='neighborhood'&&r.visibleDots===0)))process.exitCode=1;
