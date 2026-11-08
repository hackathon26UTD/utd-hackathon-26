// What a person does for each situation. Single source for docs/RUNBOOK.md and the model's runbook section.
// Status, priority and customer wording are NOT typed here: each situation carries sample readings and the real
// risk engine and customer view produce them, so the table cannot drift from the code.
import { assessDevice } from '../risk/device.js';
import { customerView } from '../risk/customer.js';
import { BODY_MAX, TITLE_MAX } from '../messages.js';

export const RUNBOOK_NOW = new Date('2026-11-08T12:00:00Z');
const MIN = 60_000;
// Sample reading: [sensor, value, minutes ago].
const R = (sensor, value, ago = 1) => ({ sensor, value, ago });

/** Message to the box: kind, severity, title (plain ASCII), body. Never claims help is coming or that anyone is safe. */
const M = (severity, title, body, customerVisible = true) => ({ kind: severity === 'info' ? 'info' : 'condition', severity, title, body, customerVisible });

export const RUNBOOK = Object.freeze([
  { id: 'water_detected', situation: 'Water reported at the sensor', readings: [R('water_detected', true)],
    operator: 'Open the box, read the reason and time, and review now. Call the linked contact only if consent is recorded. Send the message. Set the help status to review queued, then follow up assigned only when a person takes it.',
    message: M('urgent', 'Water reported', 'Check near the box. If anyone is in danger call 911.'),
    never: 'Do not say the house is flooded, damaged, empty or safe.' },
  { id: 'water_rising', situation: 'Water depth rising at the sensor', readings: [R('water_level_mm', 4, 8), R('water_level_mm', 12, 1)],
    operator: 'Treat as urgent review. Compare with the weather alert and flood zone context shown on the card. Ask the household to check the box area if a contact is recorded.',
    message: M('advisory', 'Water rising', 'Water depth is rising at the box. Please check it.'),
    never: 'Do not predict how high the water will get.' },
  { id: 'fire_signal', situation: 'Flame or smoke alarm input reported', readings: [R('fire_flame', true)],
    operator: 'Review now. The flame and smoke inputs are proxies, not certified detectors. Encourage the household to call 911 if anyone sees fire or smoke.',
    message: M('urgent', 'Flame signal', 'Box flame sensor was active. If unsafe call 911.'),
    never: 'Do not confirm a fire, and do not say responders were sent.' },
  { id: 'high_temperature', situation: 'High temperature at the box', readings: [R('temp_c', 49)],
    operator: 'Check the card for other fire or power signals and recent trend. Contact the household if consent is recorded.',
    message: M('advisory', 'High temperature', 'Box reported a high temperature. Please check it.'),
    never: 'Do not call it a fire without a fire signal.' },
  { id: 'carbon_monoxide', situation: 'Raised carbon monoxide at the box', readings: [R('co_ppm', 80)],
    operator: 'Review now. Encourage fresh air and a call to 911 if anyone feels unwell. The box is not a certified CO alarm.',
    message: M('urgent', 'CO reading high', 'Box CO reading is high. If unwell get fresh air, call 911.'),
    never: 'Do not say the air is safe or unsafe to breathe.' },
  { id: 'poor_air', situation: 'Poor air quality at the box', readings: [R('pm25_ugm3', 160)],
    operator: 'Check the regional air and fire detection layers for context. Share general guidance only.',
    message: M('advisory', 'Poor air quality', 'Box reported poor air quality. Limit time outdoors.'),
    never: 'Do not give health advice beyond general guidance.' },
  { id: 'power_lost_battery_low', situation: 'External power lost and backup battery low', readings: [R('mains_power', false), R('battery_pct', 25)],
    operator: 'Review soon. Check neighbors in the same area for a wider outage. Ask the household to restore power or replace cells if a contact is recorded.',
    message: M('advisory', 'Power lost', 'Box lost mains power and the battery is low.'),
    never: 'Do not state how long the battery will last unless a bench measurement exists.' },
  { id: 'power_lost', situation: 'External power lost, battery fine', readings: [R('mains_power', false), R('battery_pct', 90)],
    operator: 'Watch. Check whether nearby boxes report the same. The box keeps recording and relaying.',
    message: M('info', 'Power lost', 'Box reports mains power is off. It is on backup.'),
    never: 'Do not say the whole street is out from one box.' },
  { id: 'battery_very_low', situation: 'Backup battery very low', readings: [R('mains_power', true), R('battery_pct', 15)],
    operator: 'Review soon. Ask the household to check the pack. The box will conserve optional loads but never shed alarms or logging.',
    message: M('advisory', 'Battery low', 'Box battery is very low. Please check it.'),
    never: 'Do not guess battery life from the percentage.' },
  { id: 'internet_down', situation: 'Box reports internet down', readings: [R('wan_connected', false), R('temp_c', 21)],
    operator: 'Watch. The box keeps logging locally and replays later. Do not treat a quiet home as safe.',
    message: M('info', 'Internet down', 'Box cannot reach the internet. It keeps recording.'),
    never: 'Wi-Fi association is not internet access. Do not call the box healthy.' },
  { id: 'box_moved', situation: 'Box tilted or jolted', readings: [R('tilt_deg', 30)],
    operator: 'Review. A bump or a moved box is not structural damage. Ask the household to check the box position.',
    message: M('advisory', 'Box moved', 'Box was tilted or jolted. Please check its position.'),
    never: 'Do not claim structural damage.' },
  { id: 'silent_box', situation: 'No signal for a long time', readings: [], lastSeenAgo: 30,
    operator: 'Unknown, not safe. Check whether neighbors are also silent (possible outage). Offline alone is never critical, but do not clear a previous critical reading.',
    message: M('info', 'No recent signal', 'We have not heard from your box. Please check it.'),
    never: 'Do not infer the home is empty or fine because it is quiet.' },
  { id: 'stale_critical', situation: 'Old critical reading, nothing newer', readings: [R('water_detected', true, 60)],
    operator: 'Still critical. The last report may be out of date, so review it with a person, and try the household contact. A newer fresh reading is the only thing that replaces it.',
    message: M('urgent', 'Last report: water', 'Last report showed water. Please check your box.'),
    never: 'Do not downgrade because time has passed.' },
  { id: 'stale_hazard', situation: 'Old elevated reading, nothing newer', readings: [R('temp_c', 50, 60)],
    operator: 'The box is unknown with a raised priority. Try to reach the household or get a fresh reading.',
    message: M('info', 'No recent signal', 'We cannot see current readings. Please check your box.'),
    never: 'Do not call it normal.' },
  { id: 'help_request', situation: 'Household pressed the help button', readings: [], noEngine: true, customerSees: 'The help status the operator sets, with a note written for the customer.',
    operator: 'Review now. Set help status to review queued. Move it to follow up assigned or help on the way only when a person actually does that. Resolve only after a person confirms.',
    message: M('info', 'We got your signal', 'Your request was received and is being reviewed.'),
    never: 'Do not say help is on the way unless a person has arranged it.' },
  { id: 'area_outage', situation: 'Many boxes in one area stopped reporting together', readings: [], noEngine: true, customerSees: 'Each customer sees only their own box status. Area summaries are for operators.',
    operator: 'The area summary reports a possible grid or internet outage. Review the area, check mains reports from reachable neighbors, and send one regional information message. Do not dispatch from this alone.',
    message: M('info', 'Possible outage', 'Many boxes nearby are quiet. This may be an outage.'),
    never: 'Offline boxes are unknown, not damaged and not safe.' },
]);

export const RUNBOOK_IDS = Object.freeze(RUNBOOK.map(s => s.id));

/** Runs the real engine on a situation's sample readings. */
export function evaluateSituation(s, now = RUNBOOK_NOW) {
  if (s.noEngine) return { status: null, tier: null, operatorText: null, customerStatus: null, customerText: s.customerSees, customerCondition: null };
  const readings = s.readings.map(r => ({ sensor: r.sensor, value: r.value, ts: new Date(now.getTime() - r.ago * MIN), receivedAt: new Date(now.getTime() - r.ago * MIN) }));
  const device = { _id: s.id, lastSeen: s.lastSeenAgo ? new Date(now.getTime() - s.lastSeenAgo * MIN) : undefined };
  const a = assessDevice({ device, readings, series: undefined, location: null }, {}, now);
  const c = customerView(a, now);
  return {
    status: a.status, tier: a.priority.tier, score: a.priority.score, operatorText: a.reasons[0]?.text ?? null,
    customerStatus: c.status, customerText: c.statusText, customerCondition: c.conditions[0]?.text ?? null,
  };
}

export const RUNBOOK_LIMITS = Object.freeze({ titleMax: TITLE_MAX, bodyMax: BODY_MAX });

/** Runbook entries as the model sees them (compact). */
export function renderRunbookPack() {
  return RUNBOOK.map(s => {
    const e = evaluateSituation(s);
    return `- ${s.id}: ${s.situation}.${e.status ? ` Engine shows ${e.status}, ${e.tier}.` : ''} Operator: ${s.operator} Never: ${s.never}`;
  }).join('\n');
}

const cell = t => String(t ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

/** docs/RUNBOOK.md. Generated: do not edit by hand. */
export function renderRunbookDoc() {
  const out = ['# HomeBeacon runbook: what to do for each situation', '',
    '<!-- Generated by `npm run hb -- harness runbook --write` from src/harness/runbook.js and the real risk engine. Do not edit by hand; test/harness.test.js fails if this file differs. -->', '',
    'Advisory only. Every row is for a person to read and decide. HomeBeacon never says who is home, whether a building is safe to enter, how much damage there is, what is covered, or who to dispatch. If anyone may be in danger, the answer is always to call 911 first.', '',
    'The "Status" and "Customer sees" columns are produced by running the real risk engine and customer wording on sample readings, so they match the product. Messages are validated against the downlink limits in test/harness.test.js.', '',
    '## Rules before any row', '',
    '1. Missing or old data is unknown, not safe.',
    '2. An old critical reading stays critical until a newer fresh reading replaces it.',
    '3. Offline alone is never critical and never normal.',
    '4. Messages are information only. They cannot switch alarms off or change box settings, and the dashboard does not control the hardware.',
    '5. Send messages from the operator console only. Exercise (demo) data is read-only.',
    '6. Never put keys, passwords, links or the household address in a message.', '',
    '## Decision table', '',
    '| Situation | Status | What the operator does | What the customer sees | Message to send (title / body) | Do not say |',
    '| --- | --- | --- | --- | --- | --- |'];
  for (const s of RUNBOOK) {
    const e = evaluateSituation(s);
    const status = e.status ? `${e.status}, ${e.tier}` : 'n/a';
    const cust = e.customerCondition ? `${e.customerText} ${e.customerCondition}` : e.customerText;
    out.push(`| ${cell(s.situation)} | ${status} | ${cell(s.operator)} | ${cell(cust)} | ${cell(s.message.title)} / ${cell(s.message.body)} (${s.message.severity}) | ${cell(s.never)} |`);
  }
  out.push('', '## Message limits', '', `Title up to ${RUNBOOK_LIMITS.titleMax} characters and body up to ${RUNBOOK_LIMITS.bodyMax}, plain keyboard characters, no links. See [THRESHOLDS.md](THRESHOLDS.md) for the rest.`, '');
  return out.join('\n');
}
