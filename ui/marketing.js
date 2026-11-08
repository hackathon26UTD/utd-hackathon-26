const arrow = '<span aria-hidden="true">↗</span>';
const icons = {
  power: '<path d="m13 2-8 12h6l-1 8 9-13h-7l1-7Z"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".7"/>',
  water: '<path d="M12 3c-2.3 3.4-7 8.3-7 12a7 7 0 0 0 14 0c0-3.7-4.7-8.6-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  weather: '<path d="M7 16H6a4 4 0 0 1-.2-8A6 6 0 0 1 17 7a4.5 4.5 0 0 1 1 9h-1M10 14l-2 5h4l-2 4 6-7h-4l1-2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const signals = [
  ['power', 'Power', 'Know when mains power changes.'],
  ['wifi', 'Wi-Fi', 'Separate a lost link from a normal reading.'],
  ['water', 'Water', 'Flag a wet contact for a closer look.'],
  ['weather', 'Nearby disasters', 'Put home reports in regional context.']
];
const specs = [
  ['Home box', 'XIAO ESP32-S3 Sense', 'microSD storage for the local event log.'],
  ['Second node', 'ESP32', 'ESP-NOW peer link to the home box.'],
  ['Local hub', 'Arduino Uno Q', 'Local dashboard and cloud-forwarding design.'],
  ['Sensor kit', 'Water, sound, flame, tilt and PIR', 'Sensor signals are evidence, not a damage or occupancy verdict.'],
  ['Clock & power', 'DS1307 RTC · USB · 6×AA holder', 'Offline timestamps and a backup power path under test.']
];

export function mountMarketing({brand, footer}) {
  const app = document.querySelector('#app');
  app.innerHTML = `<div class="home-site">
    <header class="home-header" id="home-header">
      <div class="home-island">
        <a class="home-brand" href="/" aria-label="HomeBeacon home">${brand}</a>
        <nav class="home-desktop-nav" aria-label="Main navigation"><a href="#device">The device</a><a href="/portal">Sign in ${arrow}</a><a href="/signup">Sign up ${arrow}</a></nav>
        <button class="home-menu-toggle" id="home-nav-toggle" type="button" aria-expanded="false" aria-controls="home-menu" aria-label="Open navigation"><span>Menu</span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7h12M4 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      </div>
      <nav class="home-menu" id="home-menu" aria-label="Expanded navigation" hidden>
        <div><span class="home-menu-label">Explore</span><a href="#how-it-works">How it works ${arrow}</a><a href="#device">Inside the prototype ${arrow}</a><a href="/demo">Open command center ${arrow}</a></div>
        <div><span class="home-menu-label">Your access</span><a href="/signup">Sign up ${arrow}</a><a href="/customer?mode=signin">Homeowner sign in ${arrow}</a><a href="/portal">Operator sign in ${arrow}</a></div>
      </nav>
    </header>
    <main id="main">
      <section class="home-hero home-width" aria-labelledby="home-title">
        <div class="home-intro"><p class="home-eyebrow"><span class="home-dot" aria-hidden="true"></span>Built for HackUTD 2026</p><h1 id="home-title" class="home-headline">See trouble sooner.<br>Help limit the loss.</h1><p class="home-description">HomeBeacon is built to help homeowners and insurers reduce preventable damage. One shared view brings together home sensors and nearby disaster alerts.</p><div class="home-actions"><a class="button primary home-demo-link" href="/demo">Open command center <span aria-hidden="true">→</span></a><a class="home-register-link" href="/signup">Sign up ${arrow}</a></div><p class="home-demo-caption">Hackathon prototype. Demo homes and events are simulated.</p></div>
        <div class="home-preview-shell">
          <div class="home-preview-bar"><span><i aria-hidden="true"></i>Command center</span><a href="/demo?scenario=hurricane" aria-label="Open hurricane exercise in full view">Full view ${arrow}</a></div>
          <div class="home-preview-frame"><iframe id="home-preview" src="/demo?embed=hero&amp;scenario=hurricane" title="Interactive HomeBeacon hurricane exercise with fictional homes" loading="eager" referrerpolicy="same-origin"></iframe></div>
          <div class="home-preview-controls"><div><span class="home-preview-caption">Simulated scenario</span><p id="home-preview-label">Hurricane response</p></div><button id="home-preview-next" type="button" disabled>Next scenario <span aria-hidden="true">→</span></button></div>
          <p class="home-preview-help">Select a home on the map to inspect its readings.</p>
        </div>
        <dl class="home-signals" aria-label="What HomeBeacon brings together">${signals.map(([name, label, description]) => `<div><dt>${icon(name)}<span>${label}</span></dt><dd>${description}</dd></div>`).join('')}</dl>
      </section>

      <section class="home-purpose home-width" id="how-it-works" aria-labelledby="home-purpose-title">
        <div class="home-section-intro"><p class="home-eyebrow">Before, during and after</p><h2 id="home-purpose-title">A home’s signals.<br>A team’s next step.</h2><p>Give people the context to check a small issue early, then keep the same record useful when an entire region needs help.</p><p class="home-independent">Designed around State Farm’s catastrophe-response challenge. An independent student project, not affiliated with or endorsed by State Farm.</p></div>
        <div class="home-workflow"><article><span class="home-step-number">01</span><div><h3>Notice the change</h3><p>A wet sensor, lost power or a broken connection becomes a timestamped observation. A person decides what needs a check.</p></div></article><article><span class="home-step-number">02</span><div><h3>Keep a local record</h3><p>The device is designed to store readings when the internet is down, then send the backlog when a link returns.</p></div></article><article><span class="home-step-number">03</span><div><h3>See the neighborhood</h3><p>Operators review home reports alongside regional alerts. Missing reports stay unknown, and unresolved issues stay visible.</p></div></article></div>
      </section>

      <section class="home-device home-width" id="device" aria-labelledby="home-device-title">
        <div class="home-section-intro"><p class="home-eyebrow">Inside the prototype</p><h2 id="home-device-title">A small box.<br>A useful history.</h2><p>Built from the boards and sensors our team has on hand, with a local hub between the home and the command center.</p><div class="home-connection" aria-label="Prototype data path"><span>Home box</span><i aria-hidden="true">→</i><span>Local hub</span><i aria-hidden="true">→</i><span>Shared map</span></div><p class="home-device-note">Prototype assembly and bench validation are in progress. Battery life, radio range and safety certification are not established.</p></div>
        <dl class="home-specs">${specs.map(([label, value, detail]) => `<div><dt>${label}</dt><dd><strong>${value}</strong><span>${detail}</span></dd></div>`).join('')}</dl>
      </section>

      <section class="home-entry home-width" aria-labelledby="home-entry-title"><div><p class="home-eyebrow">Start here</p><h2 id="home-entry-title">Your home, or the whole region.</h2></div><div class="home-entry-links"><a href="/signup">Sign up ${arrow}</a><a href="/portal">Operator sign in ${arrow}</a></div></section>
    </main>${footer}
  </div>`;

  const toggle = app.querySelector('#home-nav-toggle');
  const menu = app.querySelector('#home-menu');
  const header = app.querySelector('#home-header');
  function setMenu(open, restoreFocus = false) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    header.dataset.open = String(open);
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setMenu(false, true); });
  document.addEventListener('click', event => { if (!menu.hidden && !header.contains(event.target)) setMenu(false); });

  const preview = app.querySelector('#home-preview');
  const next = app.querySelector('#home-preview-next');
  const label = app.querySelector('#home-preview-label');
  preview.addEventListener('load', () => { next.disabled = false; });
  next.addEventListener('click', () => {
    preview.contentWindow?.postMessage({type: 'homebeacon:preview-step'}, window.location.origin);
  });
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== preview.contentWindow || event.data?.type !== 'homebeacon:preview-state') return;
    if (typeof event.data.label === 'string' && event.data.label.length < 120) label.textContent = event.data.label;
  });
}
