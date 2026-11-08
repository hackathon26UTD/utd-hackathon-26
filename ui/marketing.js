import { allowsMotion, mountDisplaySettings } from './display-settings.js';
const icons = {
  power: '<path d="m13 2-8 12h6l-1 8 9-13h-7l1-7Z"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".7"/>',
  conditions: '<path d="m5 12 4 4L19 6"/><path d="M21 12a9 9 0 1 1-5-8"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const down = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const github = 'https://github.com/hackathon26UTD/utd-hackathon-26';
const specs = [
  ['Home box', 'XIAO ESP32-S3 Sense', 'Keeps the local event log on microSD.'],
  ['Second node', 'ESP32', 'An ESP-NOW peer link between devices.'],
  ['Local hub', 'Arduino Uno Q', 'Connects the local dashboard and cloud-forwarding design.'],
  ['Sensors', 'Water, sound, flame, tilt and PIR', 'Reports changes for a person to review.'],
  ['Clock & power', 'DS1307 RTC, USB and 6×AA holder', 'Offline timekeeping and a backup power path under test.']
];
export function mountMarketing({brand, footer}) {
  const app = document.querySelector('#app');
  app.innerHTML = `<div class="home-site">
    <header class="home-header" id="home-header"><div class="home-island">
      <a class="home-brand" href="/" aria-label="HomeBeacon home">${brand}</a>
      <nav class="home-desktop-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#about">About</a><a href="/portal">Sign in</a></nav>
      <details class="display-settings" id="home-settings"><summary>Settings ${down}</summary><div class="display-settings-panel" id="home-display-options"></div></details>
      <button class="home-menu-toggle" id="home-nav-toggle" type="button" aria-expanded="false" aria-controls="home-menu">Menu ${down}</button>
    </div><nav class="home-menu" id="home-menu" aria-label="Expanded navigation" hidden>
      <div><a href="#how-it-works">How it works</a><a href="#device">The device</a><a href="#about">Team & project</a><a href="/simulations">Command center</a></div>
      <div><a href="/signup">Sign up</a><a href="/customer?mode=signin">Customer sign in</a><a href="/portal">Operator sign in</a><a href="${github}" target="_blank" rel="noopener">GitHub</a></div>
    </nav></header>
    <main id="main">
      <section class="home-hero home-width" aria-labelledby="home-title">
        <div class="home-intro"><h1 id="home-title" class="home-headline">See trouble sooner.<br>Know where to look.</h1><p class="home-description">HomeBeacon brings home sensor reports and nearby disaster alerts into one map, so response teams can find critical conditions and follow up.</p><div class="home-actions"><a class="button primary home-demo-link" href="/simulations">Open command center</a><a class="home-register-link" href="/signup">Create an account</a></div></div>
        <figure class="home-preview-shell" aria-label="Animated example of the command map">
          <div class="home-preview-frame"><iframe id="home-preview" src="/demo?embed=hero&amp;scenario=normal" title="Non-interactive map illustration with simulated readings" tabindex="-1" inert loading="lazy" referrerpolicy="same-origin"></iframe></div>
          <figcaption class="home-preview-controls"><span>Simulated overview <span id="home-preview-label">Normal day</span></span><button id="home-preview-pause" type="button" aria-label="Pause overview animation">Pause</button></figcaption>
        </figure>
        <div class="home-example"><p class="home-example-label">Example device</p><dl class="home-signals" aria-label="Simulated device readings">
          <div><dt>${icon('power')}Power</dt><dd id="example-power">On</dd></div>
          <div><dt>${icon('wifi')}Wi-Fi</dt><dd id="example-wifi">Connected</dd></div>
          <div><dt>${icon('conditions')}Conditions</dt><dd id="example-conditions">No disaster or disturbances detected.</dd></div>
        </dl></div>
      </section>
      <section class="home-purpose home-width" id="how-it-works" aria-labelledby="home-purpose-title">
        <div class="home-section-intro"><h2 id="home-purpose-title">Help teams find the homes that need a check.</h2><p>During a storm, a single alert rarely tells the whole story. HomeBeacon puts critical readings, lost connections and nearby reports in one place for first-responder support.</p><p>The intent is simple: give people a clearer starting point for follow-up. A person reviews each report and decides what happens next.</p></div>
        <div class="home-workflow"><article><h3>Notice a change</h3><p>Water, heat, power and connection readings create a timestamped record. Critical pings stay visible until reviewed.</p></article><article><h3>Check the area</h3><p>Compare device reports with weather alerts and disaster zones. A missing report stays unknown.</p></article><article><h3>Keep people informed</h3><p>Operators can send device messages and record follow-up. Customers see updates tied to their own device.</p></article></div>
      </section>
      <section class="home-endurance home-width" aria-labelledby="endurance-title"><div class="home-section-intro"><h2 id="endurance-title">Keep the record going.<br>Use less power.</h2><p>A disaster can take away power and internet at the same time. The design aims to keep the box running as long as its remaining power allows.</p></div><div class="home-endurance-copy"><p>Local storage holds observations when the link drops. A backup power path and reduced activity are part of the design, so recording can take priority over frequent updates.</p><p>When a connection returns, the system is designed to send the saved history. Battery endurance, offline replay and automatic power saving still need physical testing.</p></div></section>
      <section class="home-device home-width" id="device" aria-labelledby="home-device-title"><div class="home-section-intro"><h2 id="home-device-title">A permanent place<br>for the home’s record.</h2><p>The box is intended to stay with the home when its owner is away. Sensors feed a local record, a nearby hub and the shared command map.</p><p class="home-device-note">This is an experimental prototype, not a certified alarm or emergency dispatch service.</p></div><dl class="home-specs">${specs.map(([label,value,detail])=>`<div><dt>${label}</dt><dd><strong>${value}</strong><span>${detail}</span></dd></div>`).join('')}</dl></section>
      <section class="home-about home-width" id="about" aria-labelledby="about-title"><div class="home-section-intro"><h2 id="about-title">Built by four people<br>at HackUTD.</h2><p>Ayan, Dhruv, Adyaan and Saif built HomeBeacon for <a href="https://zeroday.hackutd.co/" target="_blank" rel="noopener">HackUTD 2026: Zero Day</a>, the 24-hour hackathon at The University of Texas at Dallas on November 7–8.</p><p>We brought together hardware, public data and a response workspace around one question: what can a home keep telling us when its usual connections fail?</p><p><a href="/build">Build your own box and connect your assistant</a></p><a class="home-source-link" href="${github}" target="_blank" rel="noopener">View the project on GitHub <span>Repository access required</span></a></div><div class="home-services"><h3>What we use</h3><dl><div><dt>Website and records</dt><dd>Cloudflare Pages and Functions host the site. MongoDB Atlas stores device history and accounts.</dd></div><div><dt>Map and public context</dt><dd>MapLibre and OpenFreeMap show the streets. NOAA, USGS and FEMA provide weather, water and disaster context.</dd></div><div><dt>Interface and model support</dt><dd>The Argus UI kit provides the controls. NVIDIA Nemotron helps operators explore recorded observations.</dd></div></dl><p>Source availability varies. Simulations use fictional readings; it does not report conditions at actual households.</p></div></section>
      <section class="home-entry home-width"><h2>Start with your home.<br>See the wider picture.</h2><div class="home-entry-links"><a href="/signup">Create an account</a><a href="/portal">Operator sign in</a></div></section>
    </main>${footer}
  </div>`;
  mountDisplaySettings(app.querySelector('#home-display-options'));
  const toggle=app.querySelector('#home-nav-toggle'),menu=app.querySelector('#home-menu'),header=app.querySelector('#home-header');
  function setMenu(open,restore=false){menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));header.dataset.open=String(open);if(restore)toggle.focus();}
  toggle.addEventListener('click',()=>setMenu(menu.hidden));
  menu.addEventListener('click',e=>{if(e.target.closest('a'))setMenu(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden)setMenu(false,true);});
  document.addEventListener('click',e=>{if(!menu.hidden&&!header.contains(e.target))setMenu(false);});
  const preview=app.querySelector('#home-preview'),pause=app.querySelector('#home-preview-pause'),label=app.querySelector('#home-preview-label');
  let paused=false,visible=true,ready=false,timer;
  const paintPlayback=()=>{clearInterval(timer);const running=!paused&&allowsMotion()&&!document.hidden&&visible;pause.textContent=running?'Pause':'Play';pause.setAttribute('aria-label',running?'Pause overview animation':'Play overview animation');pause.disabled=!allowsMotion();if(running&&ready)timer=setInterval(()=>preview.contentWindow?.postMessage({type:'homebeacon:preview-step'},location.origin),6500);};
  pause.addEventListener('click',()=>{paused=!paused;paintPlayback();});
  preview.addEventListener('load',()=>{ready=true;paintPlayback();});
  document.addEventListener('visibilitychange',paintPlayback);document.addEventListener('homebeacon:motion',paintPlayback);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;paintPlayback();},{threshold:.1}).observe(preview);
  const examples={normal:['On','Connected','No disaster or disturbances detected.'],'power-outage':['Backup power','Disconnected','Power interruption detected.'],'water-hurricane':['Backup power','Disconnected','Water detected. Needs review.'],recovery:['Restored','Connected','Earlier water report needs review.']};
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==preview.contentWindow||event.data?.type!=='homebeacon:preview-state')return;
    const values=examples[event.data.scenarioId];if(!values)return;
    label.textContent=event.data.label;
    ['power','wifi','conditions'].forEach((id,i)=>{app.querySelector('#example-'+id).textContent=values[i];});
  });
  paintPlayback();
}
