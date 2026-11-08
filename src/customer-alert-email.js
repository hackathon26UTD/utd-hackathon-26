// Presentation only: no recipient, provider, queue, network or delivery side effects.
const ORIGIN = 'https://utd-hackathon-26.pages.dev';
const EVENTS = {
  'detected-condition': 'Detected condition: review needed',
  'stale-offline': 'No recent signal: review needed',
  'recovery-needs-review': 'Recovery update: review needed',
};
const POWER = {on:'Power reported on',out:'Power loss reported',battery:'Battery power reported',unknown:'Unknown'};
const WIFI = {connected:'Connected at observation',offline:'Offline reported',unknown:'Unknown'};
const CONDITIONS = {water:'Water detected',smoke:'Smoke detected',heat:'High temperature detected',impact:'Impact detected',none_detected:'No disturbance detected at observation',unknown:'Unknown'};
const SOURCES = {device:'Device observation',operator:'Operator review',simulation:'Synthetic exercise'};
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = value => typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100):'';
const own = (map,value) => typeof value==='string'&&Object.hasOwn(map,value)?map[value]:null;
function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))return null;
  const d=new Date(value);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,19)===value.slice(0,19)?d:null;
}
function customerLink(value) {
  try {const u=new URL(value);if(u.origin===ORIGIN&&u.pathname==='/customer'&&!u.username&&!u.password&&!u.search&&!u.hash)return u.href;}catch{}
  return ORIGIN+'/customer';
}
/** Pure renderer: caller supplies `now` (UTC ISO) for reproducible freshness. */
export function renderCustomerAlertEmail(input={}) {
  const title=own(EVENTS,input.event);if(!title)throw new TypeError('Unsupported customer alert event.');
  const observed=date(input.observedAt), now=date(input.now);
  const validTime=observed&&now&&observed<=now;
  const stale=input.event==='stale-offline'||input.freshness==='stale'||(validTime&&now-observed>15*60*1000);
  const freshness=stale?'Stale / offline: current conditions unknown':validTime?'Recent observation':'Unknown freshness: current conditions unknown';
  const critical=input.severity==='critical';
  const severity=critical?((stale||!validTime)?'Last known critical condition':'Critical condition: review needed'):'Review needed';
  const home=label(input.homeLabel)||'Your home';
  const source=own(SOURCES,input.source)||'Unknown source';
  const simulation=input.source==='simulation';
  const conditions=Array.isArray(input.conditions)?[...new Set(input.conditions.map(c=>own(CONDITIONS,c)).filter(Boolean))].slice(0,6):[];
  // Contradictory normal/unknown facts must never drown out detected conditions.
  const detected=conditions.filter(c=>!['Unknown',CONDITIONS.none_detected].includes(c));
  const conditionText=(detected.length?detected:conditions.length?conditions:['Unknown']).join('; ');
  const rows=[['Home',home],['Status',severity],['Power',own(POWER,input.power)||'Unknown'],['Wi-Fi',own(WIFI,input.wifi)||'Unknown'],['Conditions',conditionText],['Observed',observed?observed.toISOString():'Unknown observation time'],['Source',source],['Freshness',freshness]];
  const disclaimer='These observations need human review. They do not establish current safety or confirm that help has been dispatched.';
  const url=customerLink(input.customerUrl);
  const heading=(simulation?'EXERCISE: ':'')+title;
  return {
    subject:'HomeBeacon: '+heading,
    text:[heading,...rows.map(([key,value])=>`${key}: ${value}`),disclaimer,`Review your home: ${url}`].join('\n\n'),
    html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(heading)}</title></head><body style="font-family:Arial,sans-serif;line-height:1.5;color:#17241d;max-width:560px;margin:32px auto;padding:20px"><h1 style="font-size:24px">${escape(heading)}</h1><dl>${rows.map(([key,value])=>`<dt style="font-weight:bold;margin-top:12px">${escape(key)}</dt><dd style="margin:0">${escape(value)}</dd>`).join('')}</dl><p>${escape(disclaimer)}</p><p><a href="${escape(url)}">Review your home</a></p></body></html>`,
  };
}
