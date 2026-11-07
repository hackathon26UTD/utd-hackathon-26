import {exerciseProperties} from '../domain/exercise.js';

const pill=(kind,label)=>`<span class="pill p-${kind}"><i class="sym" aria-hidden="true"></i>${label}</span>`;
const arrow='<span class="arrow" aria-hidden="true">&rarr;</span>';

/* ---------- Scene data: the one place scenario facts live ---------- */
const KEYS=['normal','power','water','restore'];
const SCENES={
  normal:{tab:'Normal',beat:'The block is quiet.',text:'All three boxes report to the operator view. Reports arrive while a connection is available.',
    next:'Nothing to do yet. Press Play, or pick Power lost to see what a dropped connection looks like.',lamp:'on',
    homes:{A:{power:'on',link:'up',water:'dry'},B:{power:'on',link:'up',water:'dry'},C:{power:'on',link:'up',water:'dry'}},
    chain:['Each box reads power, water and the network link.','Each box writes what it reads to its own record.','Three homes are reporting. Nothing is flagged.'],now:0},
  power:{tab:'Power lost',beat:'The local record continues.',text:'Home A lost mains power. In this exercise its box keeps writing to its own record and cannot reach the operator view.',
    next:'Treat Home A as unknown until it reports again. Its last report stays on screen, marked old.',lamp:'off',
    homes:{A:{power:'off',link:'waiting',water:'dry'},B:{power:'on',link:'up',water:'dry'},C:{power:'on',link:'up',water:'dry'}},
    chain:['Home A reads that mains power is gone. The box is designed to keep writing on its backup cell. This has not been tested.','In this exercise Home A keeps writing. The entries stay on the box until a link returns.','Home A shows WAITING. Homes B and C still report.'],now:1},
  water:{tab:'Water detected',beat:'A reason to take a closer look.',text:'Home B’s water contact reads wet and its report arrived. Home C has sent nothing. A water report is a sensor reading, not confirmed damage and not a dispatch.',
    next:'Review Home B first. Home C has no data, so do not count it as safe.',lamp:'off',
    homes:{A:{power:'off',link:'waiting',water:'dry'},B:{power:'on',link:'up',water:'wet'},C:{power:'unknown',link:'none',water:'unknown'}},
    chain:['Home B reads its water contact as wet.','Home B writes the reading with its time. Home A still writes offline.','Home B moves to the top. Home C shows NO DATA, which is not the same as safe.'],now:2},
  restore:{tab:'Reconnected',beat:'The missing chapter arrives.',text:'Home A reconnected. Its stored entries arrive with their original times, so the order of events stays readable.',
    next:'Read Home A’s replayed record in order. Home B’s water reading still needs a person to check.',lamp:'on',
    homes:{A:{power:'on',link:'up',water:'dry'},B:{power:'on',link:'up',water:'wet'},C:{power:'on',link:'up',water:'dry'}},
    chain:['Home A has power and a link again.','Home A sends the entries it stored, oldest first.','The gap in Home A’s timeline fills in. Home C reports again, and its earlier silence stays on the record as a gap.'],now:1}
};
const LINK={up:['ok','CONNECTED'],waiting:['wait','WAITING'],none:['none','NO DATA']};
const POWER={on:'ON',off:'OFF',unknown:'UNKNOWN'};
const LINKTXT={up:'UP',waiting:'DOWN',none:'UNKNOWN'};
const WATER={dry:'DRY',wet:'WET',unknown:'UNKNOWN'};
const IDS=['A','B','C'];
const HX={A:90,B:330,C:570};

const STARS=[[30,30],[120,70],[190,28],[260,90],[330,40],[400,86],[470,30],[540,76],[610,34],[680,92],[740,48],[800,100],[880,34],[920,80],[150,130],[600,130],[360,138],[30,170],[900,150],[700,20]];
const house=id=>`<g class="home" id="home-${id}" transform="translate(${HX[id]} 0)" data-power="on" data-link="up" data-water="dry">
<rect class="body" x="0" y="240" width="160" height="90" rx="2"/><path class="roof" d="M-10 244 80 186 170 244Z"/>
<rect class="win" x="22" y="262" width="34" height="30" rx="2"/><rect class="win" x="104" y="262" width="34" height="30" rx="2"/><rect class="door" x="68" y="284" width="26" height="46"/>
<text class="q" x="80" y="312" text-anchor="middle">?</text>
<path class="flood" d="M-6 284q16-8 32 0t32 0t32 0t32 0t32 0t32 0V330H-6Z"/><g class="wl"><path d="M-34 284H-6"/><text x="-38" y="288" text-anchor="end">WATER</text></g>
<g class="mains" transform="translate(80 152)"><circle r="17"/><path class="bolt" d="M3 -10 -7 3H-1L-3 10 7 -3H1Z"/><path class="slash" d="M-12 12 12 -12"/></g>
<g class="box" transform="translate(150 298)"><rect width="30" height="22" rx="4"/><circle class="led" cx="9" cy="11" r="3.5"/><rect class="slot" x="17" y="8" width="8" height="6" rx="1"/></g><circle class="ring" cx="165" cy="309" r="24"/>
<text class="lbl" x="80" y="356" text-anchor="middle">HOME ${id}</text><text class="st" x="80" y="376" text-anchor="middle">CONNECTED</text></g>`;
const SIGS={A:'M270 309C330 250 330 90 560 76S830 90 845 182',B:'M510 309C560 270 560 130 690 112S830 120 845 182',C:'M750 309C790 270 780 220 845 182'};
const operator=`<g transform="translate(790 0)"><line class="ant" x1="55" y1="230" x2="55" y2="190"/><circle class="tip" cx="55" cy="184" r="7"/><rect class="opbody" x="0" y="230" width="110" height="100" rx="2"/>${IDS.map((id,i)=>`<g transform="translate(10 ${240+i*28})"><rect class="orow" width="90" height="22" rx="3"/><rect class="chip" id="chip-${id}" data-link="up" x="6" y="5" width="12" height="12" rx="6"/><text class="otx" x="26" y="15">HOME ${id}</text></g>`).join('')}<text class="lbl" x="55" y="356" text-anchor="middle">OPERATOR<tspan class="vw"> VIEW</tspan></text></g>`;
const sceneSvg=`<svg viewBox="0 0 960 400" role="img" aria-labelledby="sc-t sc-d"><title id="sc-t">Three homes and an operator view at dusk</title><desc id="sc-d">Illustration of three homes, each with a small box on its wall, and an operator view on the right. Lines show which boxes are reaching the operator view. The table beside the scene gives the same facts as text.</desc>
<rect class="sky" width="960" height="400"/>${STARS.map(([x,y])=>`<circle class="star" cx="${x}" cy="${y}" r="${(x+y)%3?1.2:1.8}"/>`).join('')}
<circle class="moon" cx="880" cy="80" r="22"/><circle class="moon-cut" cx="890" cy="73" r="19"/>
<rect class="ground" y="330" width="960" height="70"/><path class="ground-line" d="M0 330H960"/>
<g class="lamp"><polygon class="cone" points="40,262 8,330 72,330"/><line class="lamp-pole" x1="40" y1="330" x2="40" y2="268"/><circle class="lamp-head" cx="40" cy="262" r="9"/></g>
<g class="lamp2"><polygon class="cone" points="540,262 508,330 572,330"/><line class="lamp-pole" x1="540" y1="330" x2="540" y2="268"/><circle cx="540" cy="262" r="9" fill="#FFB547"/></g>
${IDS.map(house).join('')}${operator}
${IDS.map(id=>`<path class="sig" id="sig-${id}" data-link="up" d="${SIGS[id]}"/>`).join('')}<g id="pkts"></g></svg>`;

/* ---------- Page ---------- */
const TABS=[['top','Scene'],['record','Record'],['how','How'],['map','Map'],['device','Device'],['data','Data'],['limits','Limits']];

function stage(){
  return `<div class="stage night" id="stage" data-state="normal">
<div class="stage-bar"><div class="seg" role="tablist" aria-label="Scenario">${KEYS.map((k,i)=>`<button role="tab" id="tab-${k}" data-k="${k}" aria-selected="${i===0}" aria-controls="scene-panel" tabindex="${i===0?0:-1}">${SCENES[k].tab}</button>`).join('')}</div>
<div class="stage-ctrl"><button class="mb mb-outline" id="step" aria-label="Step to the next state" type="button">Step <span class="arrow" aria-hidden="true">&#9654;&#9654;</span></button><button class="mb mb-primary" id="play" type="button" aria-label="Play the outage scenario"><span id="play-sym" aria-hidden="true">&#9654;</span><span id="play-txt">Play</span></button></div></div>
<div class="stage-body" id="scene-panel" role="tabpanel" aria-labelledby="tab-normal">
<figure class="scene" data-lamp="on" data-state="normal">${sceneSvg}<ul class="legend"><li>${pill('ok','Connected')}<span>The box reached the operator view recently.</span></li><li>${pill('wait','Waiting')}<span>The box is not getting through. Its record continues on the box.</span></li><li>${pill('none','No data')}<span>Nothing recent. This is not the same as safe.</span></li></ul><figcaption>${pill('plain','Exercise scene')}<span>Illustration. Synthetic homes. Motion runs only while playing.</span></figcaption></figure>
<div class="readout"><div class="next"><span class="next-l">NEXT STEP</span><p id="next"></p></div>
<div><p class="beat" id="beat"></p></div><p class="beat-text" id="beat-text"></p>
<div class="tbl-wrap" role="region" aria-label="Home status table" tabindex="0"><table><thead><tr><th scope="col">Home</th><th scope="col">Power</th><th scope="col">Water</th><th scope="col">State</th></tr></thead><tbody>${IDS.map(id=>`<tr><th scope="row" class="rh">HOME ${id}</th><td class="v" id="c-p-${id}"></td><td class="v" id="c-w-${id}"></td><td id="c-s-${id}"></td></tr>`).join('')}</tbody></table></div>
</div></div>
<ol class="chain" aria-label="Signal chain">${[['Home box','Reads the home'],['Local record','Keeps the log'],['Operator view','Shows the block']].map(([t],i)=>`<li id="ch-${i}"><span class="badge" aria-hidden="true">0${i+1}</span><h3>${t} <span class="now">NOW</span></h3><p id="ch-p-${i}"></p></li>`).join('')}</ol></div>`;
}

function mapSection(){
  return `<section class="sec g-lav" id="map" aria-labelledby="map-h"><div class="wrap"><div class="sec-head" data-n="03"><p class="kicker">${pill('plain','Exercise data')} Made-up homes. Area names are only labels for orientation. No real home is shown.</p><h2 id="map-h">The recovery map, as an exercise.</h2><p class="lede">An operator sees a list and a map of the same homes. Pick a status to filter. Pick a home to read why it sits where it does.</p></div>
<div class="map-tools"><div class="seg map-tabs" role="tablist" aria-label="Filter homes" id="map-tabs"></div><span class="kicker" style="margin:0" id="map-count"></span></div>
<div class="map-grid"><div class="map-pane"><svg id="map-svg" viewBox="0 0 640 460" role="img" aria-label="Schematic map of the 32 exercise homes. The table lists every home with the same information."></svg><div class="map-note"><span>Schematic layout. Not a basemap. Times are invented and reset on each visit.</span><span aria-hidden="true">${pill('alert','Review first')} ${pill('wait','Check')} ${pill('none','No data')} ${pill('plain','No alert')}</span></div></div>
<div class="map-side"><div class="detail" aria-live="polite"><span class="detail-l">SELECTED HOME</span><p id="detail"></p></div><div class="scroll tbl-wrap" role="region" aria-label="Exercise homes" tabindex="0" style="border:0;border-radius:0"><table><thead><tr><th scope="col">Home</th><th scope="col">Area</th><th scope="col">Status</th><th scope="col">Last report (exercise clock)</th></tr></thead><tbody id="map-rows"></tbody></table></div></div></div></div></section>`;
}

const cut=`<svg viewBox="0 0 560 400" role="img" aria-labelledby="cu-t cu-d"><title id="cu-t">Cutaway of a possible home box</title><desc id="cu-d">A concept drawing of a small enclosure opened to show five parts, numbered one to five. The numbered list beside it describes each part.</desc>
<rect x="40" y="50" width="480" height="280" rx="22" fill="#16152B" stroke="#B7B2D1" stroke-width="2"/>
<path d="M40 130V72a22 22 0 0 1 22-22H520V70" fill="none" stroke="#FFB547" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
<rect x="70" y="90" width="250" height="190" rx="8" fill="#2A2850" stroke="#3D3A6B" stroke-width="1.5"/>
<g fill="#16152B" stroke="#B7B2D1" stroke-width="1.2"><rect x="92" y="112" width="70" height="52" rx="4"/><rect x="180" y="112" width="52" height="38" rx="4"/><rect x="92" y="184" width="44" height="36" rx="4"/></g>
<g stroke="#3D3A6B" stroke-width="2" fill="none"><path d="M162 138H180M114 164V184M232 131H290V250H136"/></g>
<rect x="196" y="190" width="94" height="58" rx="4" fill="#FFB547"/><rect x="206" y="200" width="74" height="10" rx="2" fill="#16152B"/><rect x="206" y="220" width="40" height="10" rx="2" fill="#16152B"/>
<rect x="346" y="100" width="136" height="90" rx="12" fill="#1E1D3A" stroke="#8FD7A6" stroke-width="2"/><rect x="482" y="130" width="12" height="30" rx="3" fill="#8FD7A6"/><path d="M370 130H414M370 150H440M370 170H400" stroke="#8FD7A6" stroke-width="3" stroke-linecap="round"/>
<path d="M440 100V60M440 60l14-14M440 60 426 46" stroke="#FF8A5C" stroke-width="3" stroke-linecap="round" fill="none"/>
<circle cx="478" cy="248" r="9" fill="#FFB547"/><circle cx="478" cy="248" r="17" fill="none" stroke="#FFB547" stroke-width="1.5"/>
<g fill="#16152B" stroke="#B7B2D1" stroke-width="2"><circle cx="110" cy="320" r="11"/><circle cx="160" cy="320" r="11"/><circle cx="210" cy="320" r="11"/></g>
<g font-size="13" font-weight="500" text-anchor="middle" fill="#FFB547"><g stroke="#FFB547" stroke-width="1.2" fill="none"><path d="M160 342V366"/><path d="M360 120 330 84"/><path d="M243 190V80"/><path d="M440 60 470 30"/><path d="M478 266V366"/></g>
${[[160,376,1],[330,72,2],[243,68,3],[480,24,4],[478,376,5]].map(([x,y,n])=>`<circle cx="${x}" cy="${y}" r="13" fill="#16152B" stroke="#FFB547" stroke-width="1.5"/><text x="${x}" y="${y+4.5}">${n}</text>`).join('')}</g></svg>`;

const LEDGER=[['rec','Mains power','On or off, and when it changed.'],['rec','Network link','Up or down, and when it changed.'],['rec','Water contact','Wet or dry at the sensor.'],['rec','Battery','Charge level of the backup cell.'],['rec','Temperature','One probe, one place in the home.'],['rec','Air alarm','Whether a smoke or CO alarm sounded, if the box is set up to detect it. Not built yet.'],['no','Who is home','It does not track or guess occupancy.'],['no','Safe to enter','No reading can promise that.'],['no','Damage','No loss estimate and no probability.'],['no','Coverage','It does not speak for any insurer or policy.'],['no','Dispatch','It does not call or send anyone.']];
const PARTS=[['Sensor inputs','Wires for mains power, a water contact and a temperature probe. Each reading is stamped with a time.'],['Backup cell','Meant to let the box keep writing when mains power drops. How long it lasts has not been measured.'],['Local storage','Meant to hold the record on the box itself, so a dead network does not erase it. Not tested in a home.'],['Link to the block','A short-range link to a neighborhood hub or the home network. The exact radio is not chosen.'],['Status light','Says whether the box is reading and whether it can reach the block. One light, one plain meaning.']];

const SOURCES=[['National Weather Service alerts','Active warnings and watches, with areas.','ok','IN PROTOTYPE'],['USGS earthquakes','Quakes from the last day.','ok','IN PROTOTYPE'],['OpenFEMA declarations','Declared disasters by state.','ok','IN PROTOTYPE'],['USGS water gauges','River height at gauges.','wait','TESTED ONLY'],['Open-Meteo','Rain and river-flow forecasts.','wait','TESTED ONLY'],['National Weather Service forecasts','Hourly forecast for a point.','wait','TESTED ONLY'],['FEMA shelters and flood zones','Open shelters and flood-zone maps.','none','PLANNED']];

const FAQ=[['Does a quiet box mean the home is safe?','No. A box that stops reporting is shown as no data, and its last known reading stays on screen marked as old. Silence is never treated as safe.'],['Does a water reading mean there is damage?','No. It means one contact read wet at one moment. A person has to check before anyone calls it damage.'],['What happens when the network is down?','By design, the box keeps its own record and sends the stored entries, with their original times, when a link returns. This has not been tested in a real home.'],['Does HomeBeacon say who is home?','No. It does not track people, and it does not claim a home is empty or occupied.'],['Is this connected to emergency services or an insurer?','No. Nothing here dispatches anyone or decides coverage. It is a picture for people who are already helping.'],['What is public and what needs a sign-in?','This site and the exercise are public and use made-up data. The portal is for signed-in operators.']];

const steps=[['Observe','Each box reads three things: mains power, water and the network link.','By design, a failed sensor shows as unknown, not as normal.',`<svg viewBox="0 0 320 130" aria-hidden="true"><rect x="40" y="46" width="64" height="48" rx="6" fill="#FFFDF8" stroke="#1B1A2E" stroke-width="2"/><circle cx="58" cy="70" r="5" fill="#B83A12"/><path d="M104 70H150M150 70l-8-8M150 70l-8 8" stroke="#1B1A2E" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M190 100V50M190 50l-9 14M190 50l9 14" stroke="#2E6B3F" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M226 100q10-12 20 0t20 0t20 0" stroke="#5A566B" stroke-width="3" fill="none"/><path d="M230 40q10-8 20 0M222 30q18-16 36 0" stroke="#8A5200" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`],['Keep','The box writes each reading, with its time, to its own record. A lost connection does not erase it.','If the box loses power and its backup cell runs down, the record stops. The gap is shown as a gap.',`<svg viewBox="0 0 320 130" aria-hidden="true"><g fill="#FFFDF8" stroke="#1B1A2E" stroke-width="2"><rect x="70" y="26" width="180" height="22" rx="4"/><rect x="70" y="54" width="180" height="22" rx="4"/><rect x="70" y="82" width="180" height="22" rx="4"/></g><g fill="#1B1A2E"><rect x="82" y="34" width="40" height="6" rx="2"/><rect x="82" y="62" width="64" height="6" rx="2"/><rect x="82" y="90" width="52" height="6" rx="2"/></g><circle cx="232" cy="65" r="5" fill="#B83A12"/></svg>`],['Review','An operator reads the block as a list and a map. Each home says why it is where it is.','By design, a box that has not reported shows how long ago, marked unconfirmed.',`<svg viewBox="0 0 320 130" aria-hidden="true"><rect x="50" y="22" width="220" height="86" rx="8" fill="#FFFDF8" stroke="#1B1A2E" stroke-width="2"/><path d="M50 46H270" stroke="#D9D0BC" stroke-width="2"/><g fill="#1B1A2E"><rect x="66" y="58" width="60" height="6" rx="2"/><rect x="66" y="76" width="44" height="6" rx="2"/><rect x="66" y="92" width="72" height="6" rx="2"/></g><path d="M214 56l10 18-20 0z" fill="#8A5200"/><rect x="180" y="82" width="12" height="12" rx="6" fill="none" stroke="#5A566B" stroke-width="2" stroke-dasharray="3 2"/><rect x="232" y="82" width="12" height="12" transform="rotate(45 238 88)" fill="#B83A12"/></svg>`]];

export function mountMarketing({brand,footer}){
  const app=document.querySelector('#app');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  app.innerHTML=`<div class="marketing mk">
<header class="hdr"><div class="wrap hdr-in"><a href="/" class="mk-brand" aria-label="HomeBeacon home">${brand}</a>
<nav class="seg" aria-label="Sections" id="sec-nav">${TABS.map(([id,l])=>`<a href="#${id}" data-s="${id}">${l}</a>`).join('')}</nav>
<div class="hdr-act"><a class="mb mb-outline" href="/demo">Exercise</a><a class="mb mb-primary" href="/portal">Portal ${arrow}</a></div></div></header>
<main id="main">
<section class="hero" id="top" aria-labelledby="hero-h"><div class="wrap">
<div class="hero-head"><div><p class="kicker">${pill('plain','Exercise scene')} Made-up homes. No live data.</p><h1 id="hero-h">When the grid drops, the house <em>keeps notes</em>.</h1></div>
<div class="hero-side"><p class="lede">HomeBeacon is a small box for a home, now a prototype. It is designed to log power, water and the network link, keep the log on the box, and share it with a neighborhood recovery team when it can.</p><div class="cta-row"><a class="mb mb-primary" href="/demo">Open the exercise ${arrow}</a><a class="mb mb-link" href="#record">What it records</a></div></div></div>
${stage()}</div></section>

<section class="sec g-ember" id="record" aria-labelledby="rec-h"><div class="wrap"><div class="sec-head" data-n="01"><p class="kicker">The black box</p><h2 id="rec-h">What it is designed to write down. What it never claims.</h2><p class="lede">A record is only useful if it is honest about its edges. The box is designed to state what it measured and leave the rest blank. Readings below are the design. The sample record is invented.</p></div>
<div class="ledger tbl-wrap" role="region" aria-label="What the box is designed to record and what it never claims" tabindex="0"><table><thead><tr><th scope="col">Kind</th><th scope="col">Item</th><th scope="col">What it means</th></tr></thead><tbody>${LEDGER.map(([k,i,d])=>`<tr data-k="${k}"><td>${k==='rec'?pill('ok','Designed to record'):pill('alert','Never claims')}</td><th scope="row" class="rh">${i}</th><td>${d}</td></tr>`).join('')}</tbody></table></div>
<div class="unknown-note">${pill('none','No data')}<p>A box that has not reported is <strong>unknown</strong>. HomeBeacon keeps its last reading on screen, marks it old, and never turns silence into a green light.</p></div>
<div class="rec-grid"><div class="sample"><div class="sample-h"><span>Sample record, Home A</span>${pill('plain','Exercise data')}</div><div class="tbl-wrap" role="region" aria-label="Sample record" tabindex="0" style="border:0;border-radius:0"><table><thead><tr><th scope="col">Time</th><th scope="col">Reading</th><th scope="col">Value</th><th scope="col">Reached the block</th></tr></thead><tbody>
<tr><td class="v">T+00:00</td><td>Mains power</td><td class="v">ON</td><td>${pill('ok','Connected')}</td></tr>
<tr><td class="v">T+41:12</td><td>Mains power</td><td class="v">OFF</td><td>${pill('ok','Connected')}</td></tr>
<tr><td class="v">T+41:30</td><td>Network link</td><td class="v">DOWN</td><td>${pill('wait','Waiting')}</td></tr>
<tr><td class="v">T+58:03</td><td>Battery</td><td class="v">LOW</td><td>${pill('wait','Waiting')}</td></tr>
<tr><td class="v">T+96:47</td><td>Mains power</td><td class="v">ON</td><td>${pill('wait','Waiting')}</td></tr>
<tr><td class="v">T+97:20</td><td>Network link</td><td class="v">UP</td><td>${pill('ok','Connected')}</td></tr></tbody></table></div></div>
<figure class="shot"><img src="/images/demo-detail.png" width="600" height="759" loading="lazy" alt="Crop of the exercise command center showing one selected home with power, internet, water, battery and temperature readings. The readings are synthetic."><figcaption>${pill('plain','Exercise data')}<span>Crop of the public exercise at /demo. One made-up home. Not a live reading.</span></figcaption></figure></div></div></section>

<section class="sec g-sand" id="how" aria-labelledby="how-h"><div class="wrap"><div class="sec-head" data-n="02"><p class="kicker">How it works</p><h2 id="how-h">Observe. Keep. Review.</h2><p class="lede">Three steps, and each one says what happens when it fails.</p></div>
<ol class="steps">${steps.map(([t,p,f,svg],i)=>`<li class="step"><div class="step-t"><span class="badge" aria-hidden="true">0${i+1}</span><span class="kicker" style="margin:0">Step ${i+1}</span></div>${svg}<div class="step-b"><h3>${t}</h3><p>${p}</p><div class="fail">${pill('wait','If it fails')}<p>${f}</p></div></div></li>`).join('')}</ol></div></section>

${mapSection()}

<section class="sec device night" id="device" aria-labelledby="dev-h"><div class="wrap"><div class="sec-head" data-n="04"><p class="kicker">${pill('plain','Concept')} Not a finished product</p><h2 id="dev-h">Inside the box.</h2><p class="lede">A drawing of what the box could hold. The team&rsquo;s prototype uses off-the-shelf development boards, not this enclosure.</p></div>
<div class="dev-grid"><div class="cut">${cut}<div class="cut-cap">${pill('plain','Concept illustration')}<span>Not to scale. Not tested.</span></div><p class="dev-limit">No battery life, radio range or safety certification is claimed. Those numbers do not exist yet.</p></div>
<div><ol class="parts">${PARTS.map(([t,p],i)=>`<li><span class="badge" aria-hidden="true">0${i+1}</span><div><h3>${t}</h3><p>${p}</p></div></li>`).join('')}</ol></div></div></div></section>

<section class="sec alt" id="data" aria-labelledby="data-h"><div class="wrap"><div class="sec-head" data-n="05"><p class="kicker">Data sources</p><h2 id="data-h">Public feeds give context. Boxes give readings.</h2><p class="lede">Official feeds describe the area around a home. Only a box in the home can report on that home.</p></div>
<div class="data-wrap"><div class="tbl-wrap" role="region" aria-label="Data sources" tabindex="0"><table><thead><tr><th scope="col">Source</th><th scope="col">What it gives</th><th scope="col">Status</th></tr></thead><tbody>${SOURCES.map(([s,w,k,l])=>`<tr><td class="src">${s}</td><td>${w}</td><td>${pill(k,l)}</td></tr>`).join('')}</tbody></table></div></div>
<p class="data-note">Status checked November 7, 2026. In prototype means it is wired in and shown to operators. Tested only means we called the feed and read the answer, but it is not shown yet. Planned means not tried. Agency names belong to their owners. No endorsement is implied. Statuses are a snapshot and can be out of date.</p></div></section>

<section class="sec" id="limits" aria-labelledby="lim-h"><div class="wrap"><div class="lim-grid"><div class="lim-l" data-n="06"><p class="kicker">Limits</p><h2 id="lim-h">What this is not, yet.</h2>
<ul class="nots" style="margin-top:32px">${[['Not certified hardware.'],['Not installed in any real home.'],['No battery life figure.'],['Model analysis is off on this public site.'],['No real-world results. The exercise data is synthetic.']].map(([t])=>`<li>${pill('none','Not yet')}<span>${t}</span></li>`).join('')}</ul></div>
<div><p class="kicker">Questions</p><div class="faq">${FAQ.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></div></div></div></section>

<section class="final night" aria-labelledby="fin-h"><div class="wrap"><div class="final-in"><div><h2 id="fin-h">See the block from the operator&rsquo;s chair.</h2><p>The exercise is public and uses made-up homes. Nothing in it is live.</p></div><div class="cta-row"><a class="mb mb-primary" href="/demo">Open the exercise ${arrow}</a><a class="mb mb-outline" href="/portal">Portal</a></div></div></div></section>
</main>${footer}</div>`;

  const $=s=>app.querySelector(s);
  initNav($);
  initStage($,reduced);
  initMap($,reduced);
}

function initNav($){
  const links=[...document.querySelectorAll('#sec-nav a')];
  const mark=id=>links.forEach(a=>{if(a.dataset.s===id)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});
  mark('top');
  if(!('IntersectionObserver' in window))return;
  const seen=new Map();
  const io=new IntersectionObserver(es=>{es.forEach(e=>seen.set(e.target.id,e.isIntersecting?e.intersectionRatio:0));let best='top',v=0;seen.forEach((r,id)=>{if(r>v){v=r;best=id;}});if(v>0)mark(best);},{rootMargin:'-96px 0px -40% 0px',threshold:[0,.1,.3,.6]});
  TABS.forEach(([id])=>{const el=document.getElementById(id);if(el)io.observe(el);});
}

function initStage($,reduced){
  const st=$('#stage'),tabs=[...st.querySelectorAll('[role=tab]')],playBtn=$('#play'),panel=$('#scene-panel');
  let idx=0,playing=false,timer=0,raf=new Set(),first=true;
  const setCell=(el,html)=>{if(el.innerHTML===html)return false;el.innerHTML=html;if(!reduced.matches&&!first)el.animate([{background:'rgba(255,181,71,.28)'},{background:'transparent'}],{duration:350});return true;};
  const text=(el,t)=>{if(el.textContent!==t)el.textContent=t;};
  function show(k,quiet){
    const s=SCENES[k];idx=KEYS.indexOf(k);st.dataset.state=k;
    tabs.forEach(t=>{const on=t.dataset.k===k;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
    panel.setAttribute('aria-labelledby','tab-'+k);
    text($('#next'),s.next);text($('#beat'),s.beat);text($('#beat-text'),s.text);
    $('.scene').dataset.lamp=s.lamp;$('.scene').dataset.state=k;
    IDS.forEach(id=>{
      const h=s.homes[id],g=$('#home-'+id);
      g.dataset.power=h.power;g.dataset.link=h.link;g.dataset.water=h.water;
      text(g.querySelector('.st'),LINK[h.link][1]);
      $('#sig-'+id).dataset.link=h.link;$('#chip-'+id).dataset.link=h.link;
      setCell($('#c-p-'+id),POWER[h.power]);
      setCell($('#c-w-'+id),h.water==='wet'?pill('alert','WET'):WATER[h.water]);
      setCell($('#c-s-'+id),pill(...LINK[h.link]));
    });
    s.chain.forEach((c,i)=>{text($('#ch-p-'+i),c);$('#ch-'+i).dataset.now=String(s.now===i);});
    first=false;
    if(playing&&!quiet)packets();else clearPackets();
    st.querySelector('#next').closest('.next').setAttribute('aria-live',playing?'off':'polite');
  }
  function clearPackets(){raf.forEach(cancelAnimationFrame);raf.clear();$('#pkts').replaceChildren();}
  function packets(){
    clearPackets();if(reduced.matches)return;
    const ns='http://www.w3.org/2000/svg',g=$('#pkts'),dots=[];
    IDS.forEach((id,i)=>{
      const path=$('#sig-'+id);if(path.dataset.link!=='up')return;
      const dot=document.createElementNS(ns,'circle');dot.setAttribute('r','5');dot.setAttribute('class','pkt');dot.style.opacity='0';g.append(dot);
      dots.push({dot,path,len:path.getTotalLength(),delay:i*320});
    });
    const t0=performance.now(),dur=1700,gap=500;
    const frame=now=>{
      dots.forEach(d=>{const t=now-t0-d.delay;if(t<0){d.dot.style.opacity='0';return;}const p=(t%(dur+gap))/dur;
        if(p<=1){const pt=d.path.getPointAtLength(p*d.len);d.dot.setAttribute('cx',pt.x);d.dot.setAttribute('cy',pt.y);d.dot.style.opacity='1';}else d.dot.style.opacity='0';});
      raf.clear();raf.add(requestAnimationFrame(frame));
    };
    raf.add(requestAnimationFrame(frame));
  }
  function setPlay(on){
    playing=on;
    playBtn.setAttribute('aria-label',on?'Pause the outage scenario':'Play the outage scenario');
    $('#play-txt').textContent=on?'Pause':'Play';$('#play-sym').innerHTML=on?'&#10074;&#10074;':'&#9654;';
  }
  function stop(){clearTimeout(timer);setPlay(false);clearPackets();st.querySelector('.next').setAttribute('aria-live','polite');}
  function advance(){
    if(idx>=KEYS.length-1){stop();return;}
    show(KEYS[idx+1]);timer=setTimeout(advance,3800);
  }
  playBtn.onclick=()=>{
    if(playing){stop();return;}
    setPlay(true);
    if(idx>=KEYS.length-1)show(KEYS[0],true);
    show(KEYS[idx]);
    timer=setTimeout(advance,3800);
  };
  $('#step').onclick=()=>{stop();show(KEYS[(idx+1)%KEYS.length]);};
  tabs.forEach(t=>{
    t.onclick=()=>{stop();show(t.dataset.k);};
    t.onkeydown=e=>{
      const n=tabs.length;let j=null;
      if(e.key==='ArrowRight')j=(idx+1)%n;else if(e.key==='ArrowLeft')j=(idx+n-1)%n;else if(e.key==='Home')j=0;else if(e.key==='End')j=n-1;
      if(j===null)return;e.preventDefault();stop();show(KEYS[j]);tabs[j].focus();
    };
  });
  reduced.addEventListener('change',()=>{if(reduced.matches)clearPackets();});
  show('normal');
}

function initMap($,reduced){
  const now=Date.now(),props=exerciseProperties(now);
  const CATS={critical:['alert','REVIEW FIRST'],warning:['wait','CHECK'],unknown:['none','NO DATA'],normal:['plain','NO ALERT']};
  const ORDER={critical:0,warning:1,unknown:2,normal:3};
  const W=640,H=460,pad=36;
  const xs=props.map(p=>p.coordinates[0]),ys=props.map(p=>p.coordinates[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const px=p=>pad+(p.coordinates[0]-x0)/(x1-x0)*(W-2*pad),py=p=>H-pad-(p.coordinates[1]-y0)/(y1-y0)*(H-2*pad);
  const AREAS={};props.forEach(p=>{if(!AREAS[p.area])AREAS[p.area]='Area '+String.fromCharCode(65+Object.keys(AREAS).length);});const area=p=>AREAS[p.area];
  const ago=p=>Math.max(1,Math.round((now-Date.parse(p.observedAt))/60000));
  const sorted=[...props].sort((a,b)=>ORDER[a.severity]-ORDER[b.severity]||ago(a)-ago(b));
  const count=k=>props.filter(p=>k==='all'||p.severity===k).length;
  const FILTERS=[['all','All'],['critical','Review first'],['warning','Check'],['unknown','No data']];
  let filter='all',sel=sorted[0].id;
  const tabsEl=$('#map-tabs');
  tabsEl.innerHTML=FILTERS.map(([k,l],i)=>`<button role="tab" data-f="${k}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" type="button">${l} ${count(k)}</button>`).join('');
  const svg=$('#map-svg');
  const grid=[];for(let i=1;i<8;i++)grid.push(`<path class="g" d="M${i*80} 0V${H}"/>`);for(let i=1;i<6;i++)grid.push(`<path class="g" d="M0 ${i*77}H${W}"/>`);
  const shape=(p,x,y)=>{
    if(p.severity==='critical')return `<path d="M${x} ${y-10}L${x+10} ${y}L${x} ${y+10}L${x-10} ${y}Z" fill="#B83A12" stroke="#FFFDF8" stroke-width="2"/>`;
    if(p.severity==='warning')return `<path d="M${x} ${y-10}L${x+10} ${y+8}L${x-10} ${y+8}Z" fill="#8A5200" stroke="#FFFDF8" stroke-width="2"/>`;
    if(p.severity==='unknown')return `<circle cx="${x}" cy="${y}" r="8" fill="#FFFDF8" stroke="#5A566B" stroke-width="2" stroke-dasharray="3 2"/>`;
    return `<circle cx="${x}" cy="${y}" r="5" fill="#1B1A2E" stroke="#FFFDF8" stroke-width="2"/>`;
  };
  svg.innerHTML=`${grid.join('')}<path class="creek" d="M-10 330C120 300 200 380 330 340S520 250 650 290"/><path class="road" d="M0 120C160 150 300 90 440 140S600 150 650 110"/><path class="road" d="M200 0C230 120 190 260 250 470"/>
<g id="pts">${props.map(p=>`<g class="pt" data-id="${p.id}" transform="translate(${px(p).toFixed(1)} ${py(p).toFixed(1)}) scale(1.5)">${shape(p,0,0)}</g>`).join('')}</g><circle class="mk-sel" id="mk-sel" r="20" cx="-50" cy="-50"/>`;
  const rows=$('#map-rows');
  function render(){
    const vis=sorted.filter(p=>filter==='all'||p.severity===filter);
    if(!vis.find(p=>p.id===sel))sel=vis[0]?.id;
    rows.innerHTML=vis.map(p=>`<tr data-id="${p.id}" data-sel="${p.id===sel}"><td><button class="rowbtn" type="button" aria-pressed="${p.id===sel}" data-id="${p.id}">${p.id}</button></td><td>${area(p)}</td><td>${pill(...CATS[p.severity])}</td><td class="v">${ago(p)} min${p.stale?' '+pill('wait','Stale'):''}</td></tr>`).join('');
    svg.querySelectorAll('.pt').forEach(g=>{const p=props.find(q=>q.id===g.dataset.id);g.style.opacity=vis.includes(p)?'1':'.18';});
    $('#map-count').textContent=`Showing ${vis.length} of ${props.length}`;
    detail();
  }
  function detail(){
    const p=props.find(q=>q.id===sel),el=$('#detail'),ring=$('#mk-sel');
    if(!p){el.textContent='No home in this filter.';ring.setAttribute('cx',-50);return;}
    const why=p.reasons.join('. ')+'.';
    const tail=p.severity==='normal'?' No alert is not the same as safe.':p.severity==='unknown'?' Nothing recent. Treat as unknown.':p.stale?' This report is old.':'';
    el.textContent=`Exercise home ${p.id}, ${area(p)}. ${CATS[p.severity][1]}. ${why} Exercise last report: ${ago(p)} min before the exercise snapshot.${tail}`;
    ring.setAttribute('cx',px(p).toFixed(1));ring.setAttribute('cy',py(p).toFixed(1));
  }
  const pick=id=>{sel=id;render();};
  rows.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b){pick(b.dataset.id);rows.querySelector(`button[data-id="${b.dataset.id}"]`)?.focus();}});
  svg.addEventListener('click',e=>{const g=e.target.closest('.pt');if(g)pick(g.dataset.id);});
  const tabs=[...tabsEl.querySelectorAll('button')];
  const go=k=>{filter=k;tabs.forEach(t=>{const on=t.dataset.f===k;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});render();};
  tabs.forEach((t,i)=>{t.onclick=()=>go(t.dataset.f);t.onkeydown=e=>{let j=null;const n=tabs.length;if(e.key==='ArrowRight')j=(i+1)%n;else if(e.key==='ArrowLeft')j=(i+n-1)%n;else if(e.key==='Home')j=0;else if(e.key==='End')j=n-1;if(j===null)return;e.preventDefault();go(tabs[j].dataset.f);tabs[j].focus();};});
  render();
}
