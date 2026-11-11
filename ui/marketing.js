import { allowsMotion, mountDisplaySettings } from './display-settings.js';
import { mountHomeProfile } from './home-profile.js';
const icons = {
  power: '<path d="m13 2-8 12h6l-1 8 9-13h-7l1-7Z"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".7"/>',
  conditions: '<path d="m5 12 4 4L19 6"/><path d="M21 12a9 9 0 1 1-5-8"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const down = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const github = 'https://github.com/hackathon26UTD/utd-hackathon-26';
export function mountMarketing({brand, footer, about = false}) {
  const app = document.querySelector('#app');
  app.innerHTML = `<div class="home-site">
    <header class="home-header" id="home-header">
      <a class="home-brand" href="/" aria-label="Safe Home home">${brand}</a>
      <nav class="home-desktop-nav" aria-label="Main navigation"><a href="/#how-it-works">Features</a><a href="/#device">The box</a><a href="/about" ${about ? 'aria-current="page"' : ''}>About</a></nav>
      <div class="home-account-controls"><a class="button primary home-signin" href="/dashboard">Dashboard</a>
        <details class="home-profile" id="home-profile"><summary aria-label="Open profile menu"><img id="home-avatar" src="/assets/avatars/face-01.svg" alt="" width="44" height="44">${down}</summary>
          <div class="home-profile-panel"><a id="home-profile-link" href="/portal">View profile</a>
            <details id="home-settings"><summary>Settings ${down}</summary><div id="home-display-options"></div><fieldset class="home-avatar-picker"><legend>Default avatar</legend><div>${['01','04','08','12'].map(id=>`<button type="button" data-avatar="${id}" aria-label="Choose avatar ${Number(id)}" aria-pressed="${id==='01'}"><img src="/assets/avatars/face-${id}.svg" alt="" width="40" height="40"></button>`).join('')}</div><small>Saved on this browser. Your uploaded photo takes priority.</small></fieldset></details>
          </div>
        </details>
      </div>
    </header>
    <main id="main">
      <section class="home-hero home-width" aria-labelledby="home-title">
        <div class="home-intro"><h1 id="home-title" class="home-headline">See trouble sooner.<br>Know where to look.</h1><p class="home-description">A record for your home. A clearer picture for the people looking after it. Bring your box, household updates and nearby conditions together in one place.</p><div class="home-actions"><a class="button primary home-demo-link" href="/dashboard">Dashboard</a><a class="home-register-link" href="#device">Explore the box</a></div></div>
        <figure class="home-preview-shell" aria-label="Animated example of the command map">
          <div class="home-showcase-tabs" role="group" aria-label="Explore the dashboard"><button type="button" data-showcase="map" aria-pressed="true">Command map</button><button type="button" data-showcase="home" aria-pressed="false">Your home</button><button type="button" data-showcase="history" aria-pressed="false">Event history</button></div>
          <div class="home-showcase-stage"><div class="home-preview-frame" data-showcase-panel="map"><iframe id="home-preview" src="/demo?embed=hero&amp;scenario=normal&amp;weather=wind" title="Non-interactive map illustration with simulated readings" tabindex="-1" inert loading="eager" referrerpolicy="same-origin"></iframe></div><div class="home-product-preview" data-showcase-panel="home" hidden><div class="home-sample-heading"><span>Living room</span><span class="home-sample-dot">Sample box</span></div><h3>Your home, at a glance.</h3><p>One place for the latest report and the people you share it with.</p><dl class="home-sample-vitals"><div><dt>Power</dt><dd>Connected</dd></div><div><dt>Wi-Fi</dt><dd>Reporting</dd></div><div><dt>Water</dt><dd>Not detected</dd></div></dl><div class="home-sample-update"><span>Household update</span><strong>Everyone sees the same report.</strong><p>Share selected boxes with people you trust.</p></div><a href="/signup">Set up your household</a></div><div class="home-product-preview" data-showcase-panel="history" hidden><div class="home-sample-heading"><span>Box history</span><span class="home-sample-dot">Sample sequence</span></div><h3>A moment becomes a record.</h3><p>Read what changed, when it changed, and what came next.</p><ol class="home-sample-timeline"><li><time>14:02</time><div><strong>Wall power lost</strong><span>The latest observation stays visible.</span></div></li><li><time>14:08</time><div><strong>Connection restored</strong><span>A fresh report adds context.</span></div></li><li><time>14:09</time><div><strong>Follow-up recorded</strong><span>People decide what happens next.</span></div></li></ol><a href="/simulations">Explore a full simulation</a></div></div>
          <figcaption class="home-preview-controls"><span>Product preview · fictional data <span id="home-preview-label">Normal day</span></span><button id="home-preview-pause" type="button" aria-label="Pause overview animation">Pause</button></figcaption>
        </figure>
        <div class="home-example"><p class="home-example-label">What the box monitors</p><dl class="home-signals" aria-label="What Safe Home monitors">
          <div><dt>${icon('power')}Power</dt><dd>Checks whether home power is on or off. A backup battery is designed to keep the box recording during an outage.</dd></div>
          <div><dt>${icon('wifi')}Wi-Fi</dt><dd>Checks its connection. If Wi-Fi drops, the box keeps a local record to send when the connection returns.</dd></div>
          <div><dt>${icon('conditions')}Conditions</dt><dd>Checks connected sensors for water, heat, humidity and alarm signals. Changes are flagged for someone to review.</dd></div>
        </dl></div>
      </section>
      <section class="home-purpose home-width" id="how-it-works" aria-labelledby="home-purpose-title">
        <div class="home-section-intro"><h2 id="home-purpose-title">Help teams find the homes that need a check.</h2><p>During a storm, a single alert rarely tells the whole story. Safe Home puts critical readings, lost connections and nearby reports in one place for first-responder support.</p><p>The intent is simple: give people a clearer starting point for follow-up. A person reviews each report and decides what happens next.</p></div>
        <div class="home-workflow"><article><h3>Notice a change</h3><p>Water, heat, power and connection readings create a timestamped record. Critical pings stay visible until reviewed.</p></article><article><h3>Check the area</h3><p>Compare device reports with weather alerts and disaster zones. A missing report stays unknown.</p></article><article><h3>Keep people informed</h3><p>Operators can send device messages and record follow-up. Customers see updates tied to their own device.</p></article></div>
      </section>
      <section class="home-endurance home-width" aria-labelledby="endurance-title"><div class="home-section-intro"><h2 id="endurance-title">Keep the record going.<br>Use less power.</h2><p>A disaster can take away power and internet at the same time. The design aims to keep the box running as long as its remaining power allows.</p></div><div class="home-endurance-copy"><p>Local storage holds observations when the link drops. A backup power path and reduced activity are part of the design, so recording can take priority over frequent updates.</p><p>When a connection returns, the system is designed to send the saved history. Battery endurance, offline replay and automatic power saving still need physical testing.</p></div></section>
      <section class="home-device home-width home-explorer" id="device" aria-labelledby="home-device-title"><div class="home-section-intro"><h2 id="home-device-title">Meet the box.<br>Look a little closer.</h2><p>Turn it around. Open the lid. Explore how a small box becomes a record of what happened at home.</p><div class="home-feature-buttons" role="group" aria-label="Box features"><button type="button" data-box-feature="record" aria-pressed="true">Local recording</button><button type="button" data-box-feature="connection" aria-pressed="false">Staying connected</button><button type="button" data-box-feature="sensors" aria-pressed="false">Connected sensors</button></div><div class="home-feature-detail" aria-live="polite"><h3 id="box-feature-title">A record that stays with the home.</h3><p id="box-feature-copy">Local storage is designed to hold timestamped observations when the internet drops. Offline replay still needs physical testing.</p></div><a href="/build">Build your own box</a></div><div class="home-box-visual"><div id="marketing-enclosure" class="home-enclosure-stage" aria-label="Interactive Safe Home enclosure"></div><p data-model-status role="status">Scroll here to explore the 3D box.</p><div class="home-model-actions"><button type="button" id="box-lid" disabled>Open lid</button><button type="button" id="box-reset" disabled>Reset view</button></div><p class="home-model-note">Prototype enclosure. Internal components are an illustration, not a wiring guide.</p></div></section>
      <section class="home-origin home-width"><p>Started at HackUTD. Built around a question that lasts longer than a weekend.</p><a href="/about">How Safe Home started</a></section>
      <section class="home-entry home-width"><h2>Start with your home.<br>See the wider picture.</h2><div class="home-entry-links"><a href="/signup">Create an account</a><a href="/dashboard">Dashboard</a></div></section>
    </main>${footer}
  </div>`;
  if (about) {
    app.querySelector('main').innerHTML = `<section class="home-story-hero home-width"><p class="home-story-date">Our story</p><h1>A weekend build.<br>A lasting question.</h1><p>What can a home keep telling us when its usual connections fail?</p></section>      <section class="home-about home-width" id="our-start" aria-labelledby="about-title"><div class="home-section-intro"><h2 id="about-title">Built by four people<br>at HackUTD.</h2><p>Ayan, Dhruv, Adyaan and Saif built Safe Home for <a href="https://zeroday.hackutd.co/" target="_blank" rel="noopener">HackUTD 2026: Zero Day</a>, the 24-hour hackathon at The University of Texas at Dallas on November 7–8.</p><p>We brought together hardware, public data and a response workspace around one question: what can a home keep telling us when its usual connections fail?</p><p><a href="/build">Build your own box and connect your assistant</a></p><a class="home-source-link" href="${github}" target="_blank" rel="noopener">View the project on GitHub <span>Repository access required</span></a></div><div class="home-services"><h3>What we use</h3><dl><div><dt>Website and records</dt><dd>Cloudflare Pages and Functions host the site. MongoDB Atlas stores device history and accounts.</dd></div><div><dt>Map and public context</dt><dd>MapLibre and OpenFreeMap show the streets. NOAA, USGS and FEMA provide weather, water and disaster context.</dd></div><div><dt>Interface and model support</dt><dd>The Argus UI kit provides the controls. NVIDIA Nemotron helps operators explore recorded observations.</dd></div></dl><p>Source availability varies. Simulations use fictional readings; it does not report conditions at actual households.</p></div></section>
<section class="home-purpose home-width"><div class="home-section-intro"><h2>From a hackathon<br>to the next chapter.</h2><p>We started with a home disaster recorder and a shared map. We’re continuing to connect the box, the household and the people reviewing its reports.</p></div><div class="home-workflow"><article><h3>The question</h3><p>When power and internet disappear, a missing update tells you very little. We wanted to preserve observations and make the gaps visible.</p></article><article><h3>The first build</h3><p>At HackUTD, we brought sensors, local recording and a shared response workspace into one prototype.</p></article><article><h3>What comes next</h3><p>Keep testing the physical hardware, improve the household experience, and make the records easier for people to review.</p></article></div></section><section class="home-entry home-width"><h2>Take a look at<br>what we’re building.</h2><div class="home-entry-links"><a href="/#device">Explore the box</a><a href="/simulations">Try a simulation</a></div></section>`;
  }
  mountDisplaySettings(app.querySelector('#home-display-options'));
  mountHomeProfile(app);
  if (about) return;
  mountBoxExplorer(app);
  let selectedShowcase = 'map', scenarioLabel = 'Normal day · fictional readings';
  app.querySelectorAll('[data-showcase]').forEach(button => button.addEventListener('click', () => {
    selectedShowcase = button.dataset.showcase;
    app.querySelectorAll('[data-showcase]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    app.querySelectorAll('[data-showcase-panel]').forEach(panel => panel.hidden = panel.dataset.showcasePanel !== selectedShowcase);
    label.textContent = selectedShowcase === 'map' ? scenarioLabel : selectedShowcase === 'home' ? 'Household dashboard illustration' : 'Event history illustration';
    pause.disabled = selectedShowcase !== 'map';
    paintPlayback();
  }));
  const preview=app.querySelector('#home-preview'),pause=app.querySelector('#home-preview-pause'),label=app.querySelector('#home-preview-label');
  let paused=false,visible=true,ready=false,timer;
  const step=()=>preview.contentWindow?.postMessage({type:'homebeacon:preview-step'},location.origin);
  const paintPlayback=()=>{
    clearInterval(timer);
    const reduced=!allowsMotion(),running=!paused&&!reduced&&!document.hidden&&visible&&selectedShowcase==='map';
    pause.textContent=reduced?'Next':running?'Pause':'Play';
    pause.setAttribute('aria-label',reduced?'Next simulated scenario':running?'Pause overview animation':'Play overview animation');
    preview.contentWindow?.postMessage({type:'homebeacon:preview-playback',running,visible:visible&&!document.hidden&&selectedShowcase==='map'},location.origin);
    if(running&&ready)timer=setInterval(step,6500);
  };
  pause.addEventListener('click',()=>{if(!allowsMotion()){step();return;}paused=!paused;paintPlayback();});
  preview.addEventListener('load',()=>{ready=true;paintPlayback();});
  document.addEventListener('visibilitychange',paintPlayback);document.addEventListener('homebeacon:motion',paintPlayback);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;paintPlayback();},{threshold:.1}).observe(preview);
  const scenarios=new Set(['normal','power-outage','water-hurricane','recovery']);
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==preview.contentWindow||event.data?.type!=='homebeacon:preview-state')return;
    if(!ready){ready=true;paintPlayback();}
    if(!scenarios.has(event.data.scenarioId))return;
    scenarioLabel=event.data.label+' · fictional readings';
    if (selectedShowcase === 'map') label.textContent=scenarioLabel;
  });
  paintPlayback();
}

function mountBoxExplorer(app) {
  const host = app.querySelector('#marketing-enclosure');
  const features = {
    record: ['A record that stays with the home.', 'Local storage is designed to hold timestamped observations when the internet drops. Offline replay still needs physical testing.'],
    connection: ['A box. A nearby hub. A wider view.', 'The design combines a local peer link and a hub with cloud forwarding. Connection gaps stay visible instead of being treated as normal conditions.'],
    sensors: ['Small signals, useful context.', 'Connected sensors record changes such as water, sound and tilt. Reports help a person decide what to check; they do not certify that a home is safe.'],
  };
  let controller;
  const select = (id, fromModel = false) => {
    if (!features[id]) return;
    app.querySelectorAll('[data-box-feature]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.boxFeature === id)));
    app.querySelector('#box-feature-title').textContent = features[id][0];
    app.querySelector('#box-feature-copy').textContent = features[id][1];
    if (!fromModel) controller?.selectFeature(id);
  };
  app.querySelectorAll('[data-box-feature]').forEach(b => b.addEventListener('click', () => select(b.dataset.boxFeature)));
  const observer = new IntersectionObserver(async entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    observer.disconnect();
    try {
      const { mountEnclosure } = await import('./enclosure-viewer.js');
      await mountEnclosure(host, { interactiveFeatures: true, onFeature: id => select(id, true), onReady: api => { controller = api; app.querySelectorAll('.home-model-actions button').forEach(b => b.disabled = false); select(app.querySelector('[data-box-feature][aria-pressed="true"]').dataset.boxFeature); } });
    } catch { app.querySelector('[data-model-status]').textContent = '3D view unavailable. Explore every feature using the buttons.'; }
  }, { rootMargin: '200px' });
  observer.observe(host);
  app.querySelector('#box-lid').addEventListener('click', () => controller?.toggleLid());
  app.querySelector('#box-reset').addEventListener('click', () => controller?.reset());
  host.addEventListener('enclosure:lid', event => { app.querySelector('#box-lid').textContent = event.detail.open ? 'Close lid' : 'Open lid'; });
}
