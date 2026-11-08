import "../../../ui/kit/runtime.js";
import * as maplibregl from "maplibre-gl";
import snapshot from "./alerts-snapshot.json";
import { demoHomes, hurricane } from "./demo-fixtures.js";
const K = window.Kit;
window.HomeBeaconKit.setTheme("dark", { persist: false });
maplibregl.setWorkerUrl("./map-worker.mjs");
const $ = (s) => document.querySelector(s), node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};
const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
const style = { version: 8, sources: { imagery: { type: "raster", tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 16, attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USDA, USGS The National Map: Orthoimagery</a>' } }, layers: [{ id: "canvas", type: "background", paint: { "background-color": "#192027" } }, { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.3, "raster-brightness-max": 0.78, "raster-fade-duration": reduce ? 0 : 180 } }] };
const map = new maplibregl.Map({ container: "map", style, center: [-97, 38], zoom: 3.1, maxZoom: 18, attributionControl: { compact: true }, renderWorldCopies: false });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-right");
const homes = [{ id: "HB-1003", coord: [-81.857, 27.215], status: "Critical observation", tone: "bad", reason: "Water sensor reported water", age: "Observed 2 min ago", battery: "61%", power: "Backup active", network: "Intermittent", kind: "" }, { id: "HB-1004", coord: [-81.855, 27.217], status: "Unknown now", tone: "muted", reason: "No recent observations", age: "Last observation 32 min ago", battery: "Last known 74%", power: "Last known mains", network: "Not reporting", kind: "unknown" }, { id: "HB-1005", coord: [-81.86, 27.216], status: "Reporting", tone: "ok", reason: "No active alarm reported", age: "Observed 40 sec ago", battery: "89%", power: "Mains connected", network: "Connected", kind: "reporting" }];
homes.forEach((h, i) => {
  h.scenario = "snapshot";
  h.priority = i === 0 ? "1" : "3";
  h.prioritySource = "Exercise assignment";
  h.minutes = i === 1 ? 32 : 2;
});
homes.push(...demoHomes);
let currentScenario = "snapshot", devicePredicate = () => true;
const visibleHomes = () => homes.filter((h) => h.scenario === currentScenario);
let selected = null, expanded = false, returnFocus = null, homesVisible = false;
const markers = [];
const regionMarkers = [];
let overviewMarker;
const regions = [];
const card = $("#anchor-card");
const announce = (text) => $("#announce").textContent = text;
function coords(g) {
  if (typeof g[0] === "number") return [g];
  return g.flatMap(coords);
}
for (const feature of snapshot.features) {
  const points = coords(feature.geometry.coordinates), bounds = new maplibregl.LngLatBounds();
  points.forEach((p) => bounds.extend(p));
  regions.push({ feature, bounds, coord: bounds.getCenter().toArray(), name: feature.properties.event, area: feature.properties.areaDesc });
}
function closeSelection() {
  selected = null;
  card.hidden = true;
  $("#connector path").setAttribute("d", "");
  markers.forEach(({ button }) => button.classList.remove("selected"));
  (returnFocus?.isConnected && !returnFocus.closest("[hidden]") ? returnFocus : menu).focus({ preventScroll: true });
  updateHomes();
  announce("Selection closed");
}
function positionCard() {
  if (!selected || card.hidden) return;
  const point = map.project(selected.coord), w = card.offsetWidth, h = card.offsetHeight;
  const mobile = innerWidth < 600;
  const top = Math.max(mobile ? 220 : 148, Math.min(innerHeight - h - 66, point.y - h - 24));
  const left = Math.max(mobile ? 16 : 112, Math.min(innerWidth - w - 16, mobile ? point.x - w / 2 : point.x + 26));
  card.style.left = left + "px";
  card.style.top = top + "px";
  const endX = Math.max(left + 18, Math.min(left + w - 18, point.x)), endY = point.y > top + h ? top + h : point.y < top ? top : Math.max(top + 18, Math.min(top + h - 18, point.y));
  const dx = endX - point.x, dy = endY - point.y, len = Math.hypot(dx, dy) || 1, r = selected.type === "home" ? 25 : 8;
  $("#connector path").setAttribute("d", `M${point.x + dx / len * r},${point.y + dy / len * r} L${endX},${endY}`);
}
function closeButton(action) {
  const b = node("button", "icon-close", "\xD7");
  b.type = "button";
  b.setAttribute("aria-label", "Close");
  b.onclick = action;
  return b;
}
function presentCard(title, desc, status, tone, reason, age, details) {
  const body = node("div");
  body.append(K.pill(status, tone), node("p", "card-reason", reason), node("p", "card-age", age));
  const panel = node("div");
  panel.hidden = !expanded;
  panel.append(...details);
  const foot = node("div", "card-footer");
  const words = node("span", null, expanded ? "Hide evidence" : "View evidence");
  const fold = K.foldOpen({ label: "Expand evidence", panel, open: expanded, onToggle: (open) => {
    expanded = open;
    words.textContent = open ? "Hide evidence" : "View evidence";
    requestAnimationFrame(() => {
      positionCard();
      if (open && innerWidth < 600 && selected) {
        const p = map.project(selected.coord), r = card.getBoundingClientRect(), target = Math.min(innerHeight - 170, r.bottom + 36);
        if (p.y < target) map.panBy([0, p.y - target], { duration: reduce ? 0 : 250 });
      }
    });
  } });
  foot.append(words, fold);
  body.append(foot, panel);
  const box = K.sectionBox({ title, desc, actions: closeButton(closeSelection), body });
  card.replaceChildren(box);
  card.hidden = false;
  requestAnimationFrame(positionCard);
  announce(title + " selected. " + reason);
}
function selectRegion(region, trigger) {
  returnFocus = trigger || document.activeElement;
  expanded = false;
  selected = { ...region, type: "region" };
  closeTool(false);
  $("#scope").textContent = region.area;
  map.fitBounds(region.bounds, { padding: { top: 140, right: innerWidth > 700 ? 420 : 36, bottom: 100, left: 36 }, maxZoom: 9.5, duration: reduce ? 0 : 650 });
  const evidence = [K.details({ items: [{ label: "Source", value: "National Weather Service" }, { label: "Evidence", value: "Official alert geometry" }, { label: "Issued", value: new Date(region.feature.properties.sent).toLocaleString() }, { label: "Snapshot retrieved", value: new Date(snapshot.retrievedAt).toLocaleString() }] }), node("p", "fine-print", "Snapshot for design review. Not a live national feed. Device examples are fictional and do not establish local damage.")];
  presentCard(region.name, region.area, "Official alert snapshot", "warn", "Review the alert and reported home conditions", "Source issued " + new Date(region.feature.properties.sent).toLocaleString(), evidence);
}
function selectHome(home, trigger) {
  returnFocus = trigger || document.activeElement;
  expanded = false;
  selected = { ...home, type: "home" };
  closeTool(false);
  markers.forEach(({ button, h }) => button.classList.toggle("selected", h.id === home.id));
  map.easeTo({ center: home.coord, zoom: 16, padding: { top: innerWidth < 600 ? 280 : 100, left: innerWidth < 600 ? 0 : 300, right: 0, bottom: 0 }, duration: reduce ? 0 : 550 });
  presentCard(home.id, "Fictional device \xB7 exercise only", home.status, home.tone, home.reason, home.age, [K.details({ items: [{ label: "Mains power", value: home.power }, { label: "Battery", value: home.battery }, { label: "Network", value: home.network }, { label: "Occupancy", value: null }, { label: "Assigned priority", value: "P" + home.priority, sub: home.prioritySource }, { label: "Assignment storage", value: "This review session only" }] }), K.historyList({ title: "Exercise evidence", items: [{ what: home.reason, who: "Device observation", when: home.age, tone: home.tone }, { what: "Exercise fixture loaded", who: "Design review", when: "Static sample", tone: "muted" }] }), node("p", "fine-print", "This is an advisory observation, not confirmation of damage or safety. No messages or dispatch actions are sent from this prototype.")]);
}
const tool = $("#tool-panel");
let toolReturn = null;
function closeTool(focus = true) {
  tool.hidden = true;
  tool.dataset.tab = "";
  tabButtons.forEach((b) => {
    b.kitSet({ on: false });
    b.setAttribute("aria-expanded", "false");
  });
  if (focus) toolReturn?.focus({ preventScroll: true });
}
function openTool(title) {
  delete tool.dataset.view;
  tool.dataset.tab = "";
  tabButtons.forEach((b) => {
    b.kitSet({ on: false });
    b.setAttribute("aria-expanded", "false");
  });
  toolReturn = document.activeElement;
  tool.replaceChildren();
  const head = node("div", "tool-head");
  const h = node("h1", null, title);
  h.id = "tool-title";
  tool.setAttribute("aria-labelledby", "tool-title");
  head.append(h, closeButton(() => closeTool()));
  tool.append(head);
  tool.hidden = false;
  requestAnimationFrame(() => tool.querySelector("input,button")?.focus({ preventScroll: true }));
  return tool;
}
function results(panel, query = "") {
  panel.replaceChildren();
  let matches = 0;
  for (const region of regions) {
    if ((region.name + " " + region.area).toLowerCase().includes(query.toLowerCase())) {
      const b = node("button", "result");
      b.append(node("strong", null, region.name), node("small", null, region.area + " \xB7 official snapshot"));
      b.onclick = () => selectRegion(region, b);
      panel.append(b);
      matches++;
    }
  }
  for (const home of visibleHomes()) {
    if ((home.id + " " + home.reason).toLowerCase().includes(query.toLowerCase())) {
      const b = node("button", "result");
      b.append(node("strong", null, home.id), node("small", null, home.reason + " \xB7 fictional device"));
      b.onclick = () => selectHome(home, b);
      panel.append(b);
      matches++;
    }
  }
  if (!matches) panel.append(node("p", "fine-print", "No results in this review sample."));
}
function search() {
  const p = openTool("Find an area or home"), list = node("div");
  const field = K.searchField({ label: "Search sample regions and devices", placeholder: "Area, device or condition", value: "", onInput: (q) => results(list, q) });
  p.append(field, list);
  results(list);
}
function layers() {
  const p = openTool("Layers and sources");
  for (const [key, label, note] of [["alerts", "Official alert boundaries", "Dated NWS snapshot; not all U.S. events"], ["wind", "Exercise wind exposure", "Fictional circles, not a forecast"], ["power", "Power-loss highlights", "Device observations, not utility outage boundaries"], ["water", "Water reports", "Reported sensor water, not flood extent"]]) {
    const row2 = node("div", "layer-row"), text = node("div", null, label);
    text.append(node("small", null, note));
    const disabled = key === "wind" && currentScenario !== "hurricane" || key === "alerts" && currentScenario === "hurricane";
    row2.append(text, K.tickBox({ ariaLabel: label, checked: overlays[key], disabled, onChange: () => overlayToggle(key) }));
    p.append(row2);
  }
  const row = node("div", "layer-row");
  row.append(node("span", null, "Device dots at neighborhood zoom"), K.tickBox({ ariaLabel: "Device dots", checked: homesVisible, onChange: (on) => {
    homesVisible = on;
    updateHomes();
  } }));
  p.append(row, node("p", "fine-print", "Satellite/aerial imagery is geographic context, not a current disaster photograph. Source collection dates and resolution vary."), node("p", "fine-print", "USDA / USGS imagery. National completeness, source failures and production integration remain implementation work."));
}
function activity() {
  const p = openTool("Activity");
  p.append(K.historyList({ title: "Design sample", items: [{ what: "Water sensor reported water", who: "HB-1003 \xB7 fictional", when: "2 min ago", tone: "bad" }, { what: "No recent observations", who: "HB-1004 \xB7 fictional", when: "32 min since observation", tone: "muted" }] }), node("p", "fine-print", "Static review content. No simulated live update loop is running."));
}
function privacy() {
  const p = openTool("Privacy and access");
  p.append(node("p", "fine-print", "This review uses no advertising or analytics cookies. Theme preference may be stored in this browser. No household accounts or production device data are connected."));
  for (const [text, href] of [["Marketing website", "https://utd-hackathon-26.pages.dev/"], ["Operator sign-in", "https://utd-hackathon-26.pages.dev/login"], ["Household portal", "https://utd-hackathon-26.pages.dev/customer"], ["Cookie policy", "https://utd-hackathon-26.pages.dev/cookies"]]) {
    const a = node("a", "result", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    p.append(a);
  }
}
const menu = K.buttonMenu({ label: "Map tools", text: "Tools", items: [{ key: "search", label: "Find an area or home", onSelect: search }, { key: "layers", label: "Layers and sources", onSelect: layers }, { key: "activity", label: "Activity", onSelect: activity }, { key: "event", label: "Preview exercise report", onSelect: previewReport }, { key: "privacy", label: "Privacy and access", onSelect: privacy }, { divider: true }, { key: "national", label: "U.S. overview", onSelect: overview }, { key: "example", label: "Inspect fictional house", onSelect: () => selectHome(visibleHomes()[0], menu) }] });
$("#tools").append(menu);
function previewReport() {
  const home = homes[0], entry = markers.find((m) => m.h.id === home.id);
  if (!entry) return;
  home.age = "Observed just now \xB7 exercise preview";
  if (!reduce) entry.button.animate([{ boxShadow: "0 0 0 4px #f6a623bb" }, { boxShadow: "0 0 0 20px #f6a62300" }], { duration: 700, iterations: 1 });
  if (selected?.id === home.id) {
    card.querySelector(".card-age").textContent = home.age;
  }
  announce("Exercise preview: a new observation arrived for " + home.id + ". Camera and selection unchanged.");
}
function overview() {
  closeSelection();
  closeTool(false);
  $("#scope").textContent = "United States";
  map.easeTo({ center: [-97, 38], zoom: 3.1, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: reduce ? 0 : 650 });
}
$(".wordmark").onclick = (e) => {
  e.preventDefault();
  overview();
};
function updateHomes() {
  const zoom = map.getZoom(), show = homesVisible && zoom >= 12;
  for (const { marker, h } of markers) marker.getElement().hidden = !show || h.scenario !== currentScenario || !devicePredicate(h) && selected?.id !== h.id;
  for (const marker of regionMarkers) marker.getElement().hidden = currentScenario !== "snapshot" || zoom < 6 || zoom >= 12;
  if (overviewMarker) overviewMarker.getElement().hidden = currentScenario !== "snapshot" || zoom >= 6;
}
map.on("load", () => {
  map.addSource("alerts", { type: "geojson", data: { type: "FeatureCollection", features: snapshot.features } });
  map.addLayer({ id: "alerts-fill", type: "fill", source: "alerts", paint: { "fill-color": "#f6a623", "fill-opacity": 0.14 } });
  map.addLayer({ id: "alerts-line", type: "line", source: "alerts", paint: { "line-color": "#ffc86b", "line-width": 2 } });
  for (const region of regions) {
    const button = node("button", "region-pin", region.name + " \xB7 " + region.area);
    button.setAttribute("aria-label", region.name + " in " + region.area + ", open area summary");
    button.onclick = () => selectRegion(region, button);
    regionMarkers.push(new maplibregl.Marker({ element: button }).setLngLat(region.coord).addTo(map));
  }
  const groupBounds = new maplibregl.LngLatBounds();
  regions.forEach((r) => {
    groupBounds.extend(r.bounds.getSouthWest());
    groupBounds.extend(r.bounds.getNorthEast());
  });
  const group = { bounds: groupBounds, coord: groupBounds.getCenter().toArray(), name: "Florida alert areas", area: "DeSoto and Sarasota, Florida", feature: { properties: { sent: snapshot.retrievedAt } } };
  const groupButton = node("button", "region-pin", "Florida \xB7 " + regions.length + " alert areas");
  groupButton.onclick = () => selectRegion(group, groupButton);
  overviewMarker = new maplibregl.Marker({ element: groupButton }).setLngLat(group.coord).addTo(map);
  for (const h of homes) {
    const button = node("button", "home-pin " + h.kind);
    button.dataset.scenario = h.scenario;
    button.setAttribute("aria-label", h.id + ", fictional device, " + h.reason);
    button.onclick = () => selectHome(h, button);
    const marker = new maplibregl.Marker({ element: button }).setLngLat(h.coord).addTo(map);
    markers.push({ marker, button, h });
  }
  map.on("click", "alerts-fill", (e) => {
    const id = e.features?.[0]?.properties?.id, r = regions.find((r2) => r2.feature.properties.id === id);
    if (r) selectRegion(r, menu);
  });
  map.on("mouseenter", "alerts-fill", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "alerts-fill", () => map.getCanvas().style.cursor = "");
  homesVisible = true;
  updateHomes();
  $("#source-state").textContent = "Alert snapshot " + new Date(snapshot.retrievedAt).toLocaleDateString() + " \xB7 imagery is not live";
  setupDemoControls();
  if (new URLSearchParams(location.search).get("scenario") === "hurricane") setScenario("hurricane");
  window.reviewReady = true;
});
map.on("error", (e) => {
  if (e.error?.message) $("#source-state").textContent = "Some imagery could not load. Tools and sample evidence remain available.";
});
map.on("move", () => {
  positionCard();
  updateHomes();
});
new ResizeObserver(positionCard).observe(card);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!tool.hidden) closeTool();
    else if (!card.hidden) closeSelection();
  }
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    search();
  }
});
window.review = { map, selectRegion: (i) => selectRegion(regions[i || 0], menu), selectHome: (i) => selectHome(homes[i || 0], menu), overview, search, layers, activity, privacy, previewReport, setScenario, devices, priorities, overlayToggle, visibleHomes, expand: () => card.querySelector(".kit-fold-open")?.click() };
let tabButtons = [], hurricaneMarker, sortMode = "priority", powerOnly = false;
const overlays = { alerts: true, wind: true, power: false, water: false };
function setScenario(value) {
  if (!map.getSource("exercise-zones")) return;
  currentScenario = value;
  map.setFilter("water-reports", ["==", ["get", "scenario"], value]);
  closeSelection();
  closeTool(false);
  devicePredicate = () => true;
  powerOnly = false;
  const demo = value === "hurricane";
  map.setLayoutProperty("alerts-fill", "visibility", !demo && overlays.alerts ? "visible" : "none");
  map.setLayoutProperty("alerts-line", "visibility", !demo && overlays.alerts ? "visible" : "none");
  for (const id of ["exercise-fill", "exercise-line", "exercise-track"]) map.setLayoutProperty(id, "visibility", demo && overlays.wind ? "visible" : "none");
  $("#scope").textContent = demo ? "Gulf Coast exercise" : "United States";
  $(".review-note").textContent = demo ? "Hurricane exercise \xB7 fictional storm, zones and homes" : "Design review \xB7 source snapshot + fictional devices";
  $("#source-state").textContent = demo ? "Exercise only \xB7 priority edits stay in this browser session" : "Alert snapshot " + new Date(snapshot.retrievedAt).toLocaleDateString() + " \xB7 imagery is not live";
  if (demo) map.easeTo({ center: [-82.7, 27.8], zoom: 7.3, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: reduce ? 0 : 650 });
  else overview();
  updateHomes();
  updateExerciseMarker();
  updateOverlayButtons();
  $("#exposure-key").hidden = !demo;
  scenarioControl?.kitSet(value);
  announce(demo ? "Hurricane exercise loaded. All storm and device conditions are fictional." : "Official alert snapshot loaded.");
}
function overlayToggle(key) {
  overlays[key] = !overlays[key];
  if (key === "wind") $("#exposure-key").hidden = currentScenario !== "hurricane" || !overlays.wind;
  if (key === "water") map.setLayoutProperty("water-reports", "visibility", overlays.water ? "visible" : "none");
  if (key === "wind") {
    for (const id of ["exercise-fill", "exercise-line", "exercise-track"]) map.setLayoutProperty(id, "visibility", currentScenario === "hurricane" && overlays.wind ? "visible" : "none");
  }
  if (key === "alerts") {
    for (const id of ["alerts-fill", "alerts-line"]) map.setLayoutProperty(id, "visibility", currentScenario === "snapshot" && overlays.alerts ? "visible" : "none");
  }
  if (key === "power") {
    markers.forEach(({ button, h }) => button.classList.toggle("power-loss", overlays.power && h.power === "Backup active"));
  }
  updateOverlayButtons();
}
let overlayButtons = {}, scenarioControl;
function updateOverlayButtons() {
  for (const [key, button] of Object.entries(overlayButtons)) {
    button.disabled = key === "wind" && currentScenario !== "hurricane" || key === "alerts" && currentScenario === "hurricane";
    button.title = button.disabled ? key === "wind" ? "Available in hurricane exercise" : "Official alerts are in the snapshot view" : "";
    button.kitSet({ on: overlays[key] });
    button.setAttribute("aria-pressed", String(overlays[key]));
  }
}
function updateExerciseMarker() {
  if (hurricaneMarker) hurricaneMarker.getElement().hidden = currentScenario !== "hurricane" || map.getZoom() >= 11;
}
function selectExercise() {
  const bounds = new maplibregl.LngLatBounds([-84.9, 26.2], [-81.2, 29.3]);
  selected = { type: "region", coord: hurricane.center };
  expanded = false;
  returnFocus = document.activeElement;
  closeTool(false);
  map.fitBounds(bounds, { padding: { top: 170, right: innerWidth > 700 ? 420 : 36, bottom: 180, left: 100 }, maxZoom: 8.5, duration: reduce ? 0 : 550 });
  presentCard("Gulf Coast hurricane exercise", "Fictional scenario \xB7 not an active storm", "Exercise exposure zones", "warn", "Compare wind exposure, power loss and reported water", "Static scenario for design review", [K.details({ items: [{ label: "Outer zone", value: "Elevated exposure \xB7 180 km" }, { label: "Middle zone", value: "High exposure \xB7 95 km" }, { label: "Inner zone", value: "Severe exposure \xB7 38 km" }, { label: "Interpretation", value: "Exercise radii, not a forecast" }] }), node("p", "fine-print", "Circles are fictional exposure zones. They are not official wind radii, hurricane categories, damage estimates or safe/unsafe boundaries.")]);
}
function devices() {
  showDevices(false);
}
function priorities() {
  showDevices(true);
}
function showDevices(assigned) {
  const p = openTool(assigned ? "Assigned priorities" : "All devices");
  p.dataset.view = assigned ? "priorities" : "devices";
  const help = node("p", "fine-print", currentScenario === "hurricane" ? "63 fictional devices \xB7 hurricane exercise" : "3 fictional devices \xB7 alert snapshot");
  p.append(help);
  const controls = node("div", "device-controls"), list = node("div", "device-results");
  let query = "";
  const searchControl = K.searchField({ label: "Search devices", placeholder: "Device or condition", value: "", onInput: (value) => {
    query = value;
    render();
  } });
  const sort = K.select({ value: assigned ? "priority" : sortMode, options: [{ value: "priority", label: "Assigned priority" }, { value: "power", label: "Power loss first" }, { value: "battery", label: "Lowest battery" }, { value: "age", label: "Oldest observation" }], onChange: (value) => {
    sortMode = value;
    render();
  } });
  sort.querySelector("button").setAttribute("aria-label", "Sort devices");
  const filter = K.tickBox({ label: "Power loss only", checked: powerOnly, onChange: (on) => {
    powerOnly = on;
    render();
  } });
  controls.append(searchControl, sort, filter);
  p.append(controls, list);
  function render() {
    const source = visibleHomes();
    const rows = source.filter((h) => (!powerOnly || h.power === "Backup active") && (h.id + " " + h.reason).toLowerCase().includes(query.toLowerCase()));
    const mode = sort.kitValue();
    rows.sort((a, b) => mode === "power" ? Number(b.power === "Backup active") - Number(a.power === "Backup active") : mode === "battery" ? parseInt(a.battery.replace(/\D/g, "")) - parseInt(b.battery.replace(/\D/g, "")) : mode === "age" ? b.minutes - a.minutes : Number(a.priority) - Number(b.priority));
    list.replaceChildren();
    list.setAttribute("aria-label", "Filtered devices");
    const count = node("p", "result-count", rows.length + " of " + source.length + " devices");
    count.setAttribute("role", "status");
    list.append(count);
    for (const h of rows) {
      const row = node("div", "device-row");
      const b = node("button", "result");
      b.append(node("strong", null, h.id), node("small", null, h.reason + " \xB7 " + h.age));
      b.onclick = () => selectHome(h, b);
      const priority = K.select({ value: h.priority, options: [{ value: "1", label: "P1 \xB7 Immediate review" }, { value: "2", label: "P2 \xB7 Follow up" }, { value: "3", label: "P3 \xB7 Monitor" }], onChange: (value) => {
        h.priority = value;
        h.prioritySource = "Operator assigned \xB7 review session";
        announce(h.id + " assigned P" + value + ". Saved for this review session only.");
      } });
      priority.querySelector("button").setAttribute("aria-label", "Assigned priority for " + h.id);
      row.append(b, priority);
      list.append(row);
    }
    if (!rows.length) list.append(node("p", "fine-print", "No devices match these filters."));
    devicePredicate = (h) => (!powerOnly || h.power === "Backup active") && (h.id + " " + h.reason).toLowerCase().includes(query.toLowerCase());
    updateHomes();
  }
  render();
  p.append(node("p", "fine-print", "Priorities are operator assignments, separate from sensor status. Changes are session-only and do not dispatch a team."));
}
function setupDemoControls() {
  map.addSource("water-reports", { type: "geojson", data: { type: "FeatureCollection", features: homes.filter((h) => h.reason.includes("Water")).map((h) => ({ type: "Feature", properties: { scenario: h.scenario }, geometry: { type: "Point", coordinates: h.coord } })) } });
  map.addLayer({ id: "water-reports", type: "circle", source: "water-reports", minzoom: 10, layout: { visibility: "none" }, paint: { "circle-radius": 28, "circle-color": "#63bbd6", "circle-opacity": 0.18, "circle-stroke-color": "#81d3eb", "circle-stroke-width": 1 } });
  map.addSource("exercise-zones", { type: "geojson", data: { type: "FeatureCollection", features: hurricane.features } });
  map.addLayer({ id: "exercise-fill", type: "fill", source: "exercise-zones", layout: { visibility: "none" }, paint: { "fill-color": ["get", "tone"], "fill-opacity": 0.12 } });
  map.addLayer({ id: "exercise-line", type: "line", source: "exercise-zones", layout: { visibility: "none" }, paint: { "line-color": ["get", "tone"], "line-width": 2, "line-opacity": 0.9 } });
  map.addSource("exercise-track", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-84.2, 25.8], [-83.7, 26.6], [-83.1, 27.7], [-82.64, 27.9], [-81.7, 29.1]] } } });
  map.addLayer({ id: "exercise-track", type: "line", source: "exercise-track", layout: { visibility: "none" }, paint: { "line-color": "#f5efe3", "line-width": 2, "line-dasharray": [3, 3], "line-opacity": 0.8 } });
  const label = node("button", "region-pin hurricane-label", "Hurricane exercise \xB7 exposure zones");
  label.onclick = selectExercise;
  hurricaneMarker = new maplibregl.Marker({ element: label, anchor: "left" }).setLngLat(hurricane.center).addTo(map);
  hurricaneMarker.getElement().hidden = true;
  map.on("click", "exercise-fill", selectExercise);
  map.on("move", updateExerciseMarker);
  const strip = node("nav", "overlay-strip");
  strip.setAttribute("aria-label", "Basic map overlays");
  for (const [key, label2] of [["alerts", "Alerts"], ["wind", "Wind zones"], ["power", "Power loss"], ["water", "Water"]]) {
    const b = K.filterButton({ label: label2, icon: "sliders", on: overlays[key], onClick: () => overlayToggle(key) });
    overlayButtons[key] = b;
    strip.append(b);
  }
  scenarioControl = K.select({ value: "snapshot", options: [{ value: "snapshot", label: "Official alert snapshot" }, { value: "hurricane", label: "Hurricane exercise" }], onChange: setScenario });
  scenarioControl.querySelector("button").setAttribute("aria-label", "Map scenario");
  strip.append(scenarioControl);
  $("#workspace").append(strip);
  const island = node("nav", "tab-island");
  island.setAttribute("aria-label", "Workspace views");
  for (const [label2, action] of [["Devices", devices], ["Priorities", priorities], ["Activity", activity]]) {
    const b = K.filterButton({ label: label2, icon: label2 === "Activity" ? "chartLine" : label2 === "Devices" ? "list" : "bookmark", onClick: () => {
      const already = !tool.hidden && tool.dataset.tab === label2;
      if (already) {
        closeTool();
        return;
      }
      action();
      tool.dataset.tab = label2;
      tabButtons.forEach((x) => {
        x.kitSet({ on: x === b });
        x.setAttribute("aria-expanded", String(x === b));
      });
    } });
    b.setAttribute("aria-controls", "tool-panel");
    b.setAttribute("aria-expanded", "false");
    tabButtons.push(b);
    island.append(b);
  }
  $("#workspace").append(island);
  const legend = node("aside", "exposure-key");
  legend.id = "exposure-key";
  legend.setAttribute("aria-label", "Exercise exposure legend");
  legend.hidden = true;
  legend.append(node("strong", null, "Exercise exposure"));
  for (const [label2, cls] of [["Elevated \xB7 180 km", "outer"], ["High \xB7 95 km", "middle"], ["Severe \xB7 38 km", "inner"]]) legend.append(node("span", cls, label2));
  $("#workspace").append(legend);
  map.setFilter("water-reports", ["==", ["get", "scenario"], currentScenario]);
  updateOverlayButtons();
}
