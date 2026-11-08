// Browser-only presentation preferences. Never add these values to device records or API requests.
export const wifiPreviewAllowed = (ctx, device) => ctx?.role === 'operator' && !ctx.demo &&
  !!device?.id && device.synthetic !== true && device.source !== 'simulation-studio';

export function createWifiPreviewPreference({ mode = 'live', storage = () => globalThis.sessionStorage } = {}) {
  const memory = new Map();
  const key = id => `safe-home:wifi-preview:v1:${mode === 'exercise' ? 'exercise' : 'live'}:${encodeURIComponent(id)}`;
  return {
    isEnabled(id) {
      if (typeof id !== 'string' || !id) return false;
      if (memory.has(id)) return memory.get(id);
      let enabled = false;
      try { enabled = storage()?.getItem(key(id)) === '1'; } catch { /* Storage can be blocked. Default off. */ }
      memory.set(id, enabled);
      return enabled;
    },
    setEnabled(id, enabled) {
      if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') return false;
      memory.set(id, enabled);
      try {
        const target = storage();
        if (!target) return false;
        if (enabled) target.setItem(key(id), '1'); else target.removeItem(key(id));
        return true;
      } catch { return false; }
    },
  };
}

// WAN or a successful upload cannot establish that the box's Wi-Fi is connected.
// Keep the actual Wi-Fi observation and its age visible alongside the simulated display.
export function recordedWifi(latest = {}, now = Date.now(), freshMs = 120000) {
  const reading = latest?.wifi_connected;
  const connected = reading?.value === true || reading?.value === 1;
  const disconnected = reading?.value === false || reading?.value === 0;
  if (!connected && !disconnected) return { state: 'Not reported', observedAt: null, stale: true };
  const at = Date.parse(reading.ts);
  return {
    state: connected ? 'Connected' : 'Disconnected',
    observedAt: Number.isFinite(at) ? reading.ts : null,
    stale: !Number.isFinite(at) || now - at > freshMs || at > now + 30000,
  };
}
