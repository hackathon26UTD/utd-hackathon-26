// Synthetic sample data for previews, tests and the ops test endpoint. Nothing here is a real person or home.
const NOW = '2026-11-08T15:00:00.000Z';
export const SAMPLES = {
  welcome: { contactName: 'Sam Rivera', nickname: 'Lake house', linked: true, consent: true, linkedAt: NOW, exercise: true },
  'help-status': { status: 'follow_up_assigned', nickname: 'Lake house', updatedAt: NOW, exercise: true },
  'critical-incident': {
    deviceId: '0123456789abcdef01234567', deviceName: 'Lake house', region: 'gh5:9vgm0', observedAt: '2026-11-08T14:56:00.000Z', now: NOW, source: 'Device observation',
    facts: [{ label: 'Water sensor', value: 'Wet', known: true }, { label: 'Power', value: 'Battery', known: true }, { label: 'Temperature', known: false }, { label: 'Smoke', known: false }], exercise: true,
  },
  digest: {
    periodLabel: 'Last 24 hours', now: NOW, counts: { devices: 42, critical: 2, watch: 5, stale: 3 },
    staleDevices: [{ name: 'Pine St box', lastSeen: '2026-11-08T09:10:00.000Z' }, { name: 'Harbor unit 4', lastSeen: '2026-11-07T22:00:00.000Z' }, { name: 'Oak Ave', lastSeen: null }],
    feeds: [{ name: 'Weather alerts', status: 'ok' }, { name: 'River gauges', status: 'degraded', note: 'delayed 20 minutes' }, { name: 'Earthquakes', status: 'down', note: 'no data' }], exercise: true,
  },
  'account-notice': { kind: 'recovery_used', role: 'operator', at: NOW, exercise: true },
  receipt: { deviceName: 'Lake house', title: 'Stay inside', state: 'acked', at: NOW, exercise: true },
};
export const sampleFor = (template, overrides = {}) => ({ ...SAMPLES[template], ...overrides });
