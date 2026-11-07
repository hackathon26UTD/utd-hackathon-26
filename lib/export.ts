import type { Forecast } from "./model";
export function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function forecastCsv(result: Forecast): string {
  return [
    "Date,Event,Category,Amount USD,End-of-day cash USD",
    ...result.days.flatMap((day) =>
      day.events.length
        ? day.events.map(
            (e) =>
              `${day.date},${csvCell(e.name)},${csvCell(e.category)},${(e.amountCents / 100).toFixed(2)},${(day.balanceCents / 100).toFixed(2)}`,
          )
        : [
            `${day.date},"No scheduled transactions","",0.00,${(day.balanceCents / 100).toFixed(2)}`,
          ],
    ),
  ].join("\r\n");
}
