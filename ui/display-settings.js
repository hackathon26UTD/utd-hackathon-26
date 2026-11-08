const MOTION_KEY = 'homebeacon-motion';
export function motionPreference() {
  try { return localStorage.getItem(MOTION_KEY) === 'reduce' ? 'reduce' : 'system'; } catch { return 'system'; }
}
export function allowsMotion() { return motionPreference() !== 'reduce' && !matchMedia('(prefers-reduced-motion: reduce)').matches; }
export function applyDisplaySettings() {
  document.documentElement.dataset.hbMotion = allowsMotion() ? 'full' : 'reduce';
}
export function mountDisplaySettings(root) {
  const group = document.createElement('div'); group.className = 'display-options';
  group.innerHTML = '<label>Theme<select aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Motion<select aria-label="Motion"><option value="system">Follow device setting</option><option value="reduce">Reduce motion</option></select></label>';
  const theme = group.querySelector('[aria-label=Theme]'), motion = group.querySelector('[aria-label=Motion]');
  theme.id = root.id + '-theme'; motion.id = root.id + '-motion';
  theme.value = window.HomeBeaconKit.theme(); motion.value = motionPreference();
  theme.addEventListener('change', () => window.HomeBeaconKit.setTheme(theme.value));
  document.addEventListener('hbkit:theme', () => {
    const value = window.HomeBeaconKit.theme();
    if (theme.value !== value) { theme.value = value; theme.nextElementSibling?.kitSet?.(value); }
  });
  motion.addEventListener('change', () => {
    try { localStorage.setItem(MOTION_KEY, motion.value); } catch { /* Page preference still handled by system settings. */ }
    applyDisplaySettings(); document.dispatchEvent(new CustomEvent('homebeacon:motion'));
  });
  root.append(group);
  const details = root.closest('details');
  if (details) {
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented && details.open) { details.open = false; details.querySelector('summary').focus(); } });
    document.addEventListener('click', e => { if (details.open && !details.contains(e.target) && !e.target.closest('.kit-pop-out,.kit-select-pop,.kit-select-menu,[role=listbox]')) details.open = false; });
  }
}
