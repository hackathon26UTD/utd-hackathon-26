// NOAA MRMS radar history is observed reflectivity, not a forecast.
const BASE = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
const CAPS = `${BASE}?service=WMS&version=1.3.0&request=GetCapabilities`;
export function radarFrames(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid radar metadata');
  const dimension = [...doc.getElementsByTagNameNS('*', 'Dimension')].find(d => d.getAttribute('name') === 'time');
  const frames = (dimension?.textContent || '').split(',').map(s => s.trim()).filter(s => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s) && Number.isFinite(Date.parse(s)));
  if (!frames.length) throw new Error('Radar frames unavailable');
  return frames;
}
export function mountRadar(mapView, root) {
  const button = root.querySelector('#radar-toggle'), panel = root.querySelector('#radar-controls');
  if (!button || !panel) return;
  const slider = panel.querySelector('input'), play = panel.querySelector('button'), label = panel.querySelector('output');
  let frames = [], index = 0, timer, active = false, generation = 0, playing = false, drawToken = 0, sliderAnimation, scrubTimer;
  function stop() { playing = false; clearTimeout(timer); timer = null; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); }
  function moveSlider(target) {
    cancelAnimationFrame(sliderAnimation);
    const from = Number(slider.value), started = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - started) / 450), eased = t * t * (3 - 2 * t);
      slider.value = String(from + (target - from) * eased);
      if (t < 1) sliderAnimation = requestAnimationFrame(tick);
    };
    sliderAnimation = requestAnimationFrame(tick);
  }
  async function draw(manual = false) {
    const time = frames[index]; if (!time) return;
    const token = ++drawToken, target = index;
    const ready = await mapView.setRadar(time);
    if (!active || token !== drawToken) return;
    if (!ready) { label.textContent = 'Next radar frame unavailable · keeping last image'; return; }
    if (!manual) moveSlider(target);
    label.textContent = `NOAA radar · ${new Date(time).toLocaleString()}${Date.now() - Date.parse(frames[frames.length - 1]) > 20 * 60000 ? ' · delayed' : ''}`;
  }
  function start() {
    stop(); playing = true;
    play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true');
    const step = async () => {
      if (!playing || !active) return;
      if (!document.hidden) { index = (index + 1) % frames.length; await draw(); }
      if (playing && active) timer = setTimeout(step, 800);
    };
    timer = setTimeout(step, 1200);
  }
  async function refresh(autoplay = false) {
    const request = ++generation;
    try {
      const response = await fetch(CAPS, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Radar unavailable');
      const next = radarFrames(await response.text());
      if (!active || request !== generation) return;
      frames = next; index = frames.length - 1;
      slider.max = String(index); slider.disabled = false; play.disabled = false; await draw();
      if (autoplay) start();
    } catch {
      if (!active || request !== generation) return;
      stop(); slider.disabled = true; play.disabled = true;
      label.textContent = 'NOAA radar unavailable. Check connection and try again.';
    }
  }
  button.addEventListener('click', () => {
    active = !active; button.setAttribute('aria-pressed', String(active)); panel.hidden = !active;
    if (active) { label.textContent = 'Loading NOAA radar…'; refresh(true); }
    else { generation++; drawToken++; stop(); clearTimeout(scrubTimer); cancelAnimationFrame(sliderAnimation); mapView.setRadar(null); }
  });
  slider.step = '0.01';
  slider.addEventListener('input', () => { stop(); cancelAnimationFrame(sliderAnimation); clearTimeout(scrubTimer); index = Math.round(Number(slider.value)); scrubTimer = setTimeout(() => draw(true), 80); });
  play.addEventListener('click', () => {
    if (playing) return stop();
    start();
  });
  setInterval(() => { if (active && !playing && !document.hidden && index === frames.length - 1) refresh(); }, 300000);
}
