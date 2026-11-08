export const demoHomes = Array.from({ length: 63 }, (_, i) => {
  const loss = i % 4 === 0 || i % 7 === 0, unknown = i % 11 === 0, water = i % 9 === 0;
  return {
    id: "HB-" + (2001 + i),
    coord: [-82.64 + i % 9 * 0.042, 27.83 + Math.floor(i / 9) * 0.043],
    scenario: "hurricane",
    status: unknown ? "Unknown now" : water ? "Critical observation" : loss ? "Needs review" : "Reporting",
    tone: unknown ? "muted" : water ? "bad" : loss ? "warn" : "ok",
    reason: unknown ? "No recent observations" : water ? "Water sensor reported water" : loss ? "Mains power lost; backup active" : "No active alarm reported",
    age: unknown ? "Last observation 38 min ago" : "Observed " + (i % 5 + 1) + " min ago",
    minutes: unknown ? 38 : i % 5 + 1,
    battery: (unknown ? "Last known " : "") + (24 + i * 13 % 72) + "%",
    power: unknown ? "Last known " + (loss ? "backup active" : "mains connected") : loss ? "Backup active" : "Mains connected",
    network: unknown ? "Not reporting" : loss ? "Intermittent" : "Connected",
    kind: unknown ? "unknown" : loss || water ? "" : "reporting",
    priority: water ? "1" : loss ? "2" : "3",
    prioritySource: "Exercise assignment"
  };
});
export function circle(center, km, properties) {
  const [lon, lat] = center.map((n) => n * Math.PI / 180), d = km / 6371, ring = [];
  for (let i = 0; i <= 96; i++) {
    const b = i / 96 * Math.PI * 2, phi = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b)), lambda = lon + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(phi));
    ring.push([lambda * 180 / Math.PI, phi * 180 / Math.PI]);
  }
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
}
export const hurricane = { center: [-83.1, 27.7], features: [circle([-83.1, 27.7], 180, { name: "Elevated exposure \xB7 exercise", tone: "#ffc86b" }), circle([-82.85, 27.8], 95, { name: "High exposure \xB7 exercise", tone: "#ed8f53" }), circle([-82.64, 27.9], 38, { name: "Severe exposure \xB7 exercise", tone: "#e56366" })] };
