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
  let frames = [], index = 0, timer, active = false, generation = 0;
  function stop() { clearInterval(timer); timer = null; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); }
  function draw() {
    const time = frames[index]; if (!time) return;
    slider.value = String(index);
    label.textContent = `NOAA radar · ${new Date(time).toLocaleString()}${Date.now() - Date.parse(time) > 20 * 60000 ? ' · delayed' : ''}`;
    mapView.setRadar(time);
  }
  function start() {
    stop();
    play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => { if (!document.hidden) { index = (index + 1) % frames.length; draw(); } }, 1200);
  }
  async function refresh(autoplay = false) {
    const request = ++generation;
    try {
      const response = await fetch(CAPS, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Radar unavailable');
      const next = radarFrames(await response.text());
      if (!active || request !== generation) return;
      frames = next.filter((_, i) => i % 3 === 0 || i === next.length - 1); index = frames.length - 1;
      slider.max = String(index); slider.disabled = false; play.disabled = false; draw();
      if (autoplay) start();
    } catch {
      if (!active || request !== generation) return;
      stop(); mapView.setRadar(null); slider.disabled = true; play.disabled = true;
      label.textContent = 'NOAA radar unavailable. Check connection and try again.';
    }
  }
  button.addEventListener('click', () => {
    active = !active; button.setAttribute('aria-pressed', String(active)); panel.hidden = !active;
    if (active) { label.textContent = 'Loading NOAA radar…'; refresh(true); }
    else { generation++; stop(); mapView.setRadar(null); }
  });
  slider.addEventListener('input', () => { stop(); index = Number(slider.value); draw(); });
  play.addEventListener('click', () => {
    if (timer) return stop();
    start();
  });
  setInterval(() => { if (active && !timer && !document.hidden && index === frames.length - 1) refresh(); }, 300000);
}
