import test from 'node:test';
import assert from 'node:assert/strict';
import {createWifiPreviewPreference, recordedWifi, wifiPreviewAllowed} from '../ui/command/wifi-preview.js';
import {readingSummary} from '../ui/command/reading-summary.js';

const storageFixture = () => {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
};

test('preview defaults off and survives refresh only for the opted-in device and data mode', () => {
  const storage = storageFixture(), options = {storage: () => storage};
  const first = createWifiPreviewPreference(options);
  assert.equal(first.isEnabled('uno-q'), false);
  assert.equal(first.setEnabled('uno-q', true), true);
  const refreshed = createWifiPreviewPreference(options);
  assert.equal(refreshed.isEnabled('uno-q'), true);
  assert.equal(refreshed.isEnabled('other-box'), false);
  assert.equal(createWifiPreviewPreference({...options, mode: 'exercise'}).isEnabled('uno-q'), false);
  assert.equal(refreshed.setEnabled('uno-q', false), true);
  assert.equal(createWifiPreviewPreference(options).isEnabled('uno-q'), false);
});

test('blocked storage getter or writes keep preview usable in memory without inventing persistence', () => {
  for (const storage of [() => {throw Error('storage blocked');}, () => ({getItem: () => null, setItem: () => {throw Error('quota');}, removeItem: () => {throw Error('blocked');}}), () => undefined]) {
    const preference = createWifiPreviewPreference({storage});
    assert.equal(preference.isEnabled('uno-q'), false);
    assert.equal(preference.setEnabled('uno-q', true), false);
    assert.equal(preference.isEnabled('uno-q'), true);
    assert.equal(preference.isEnabled('other-box'), false);
    assert.equal(preference.setEnabled('uno-q', false), false);
    assert.equal(preference.isEnabled('uno-q'), false);
  }
});

test('only a registered operator device view permits the preview', () => {
  const device = {id: 'uno-q'};
  assert.equal(wifiPreviewAllowed({role: 'operator', demo: false}, device), true);
  for (const ctx of [{role: null}, {role: 'demo'}, {role: 'operator', demo: true}]) assert.equal(wifiPreviewAllowed(ctx, device), false);
  for (const other of [{}, {...device, synthetic: true}, {...device, source: 'simulation-studio'}]) assert.equal(wifiPreviewAllowed({role: 'operator'}, other), false);
});

test('enabling a preview does not alter the disconnected Wi-Fi observation or sensor summary', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  const latest = Object.freeze({wifi_connected: Object.freeze({value: false, ts: '2026-11-08T17:59:30Z'}), water_detected: Object.freeze({value: true, ts: '2026-11-08T17:59:30Z'})});
  const before = structuredClone(latest), summary = readingSummary(latest, now);
  const preference = createWifiPreviewPreference({storage: () => storageFixture()});
  preference.setEnabled('uno-q', true);
  assert.deepEqual(recordedWifi(latest, now), {state: 'Disconnected', observedAt: '2026-11-08T17:59:30Z', stale: false});
  assert.deepEqual(latest, before);
  assert.deepEqual(readingSummary(latest, now), summary);
});

test('recorded Wi-Fi keeps stale and missing timestamps explicit', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  assert.deepEqual(recordedWifi({wifi_connected: {value: true, ts: '2026-11-08T17:00:00Z'}}, now), {state: 'Connected', observedAt: '2026-11-08T17:00:00Z', stale: true});
  assert.deepEqual(recordedWifi({wifi_connected: {value: false}}, now), {state: 'Disconnected', observedAt: null, stale: true});
  assert.equal(recordedWifi({wifi_connected: {value: true, ts: '2026-11-08T19:00:00Z'}}, now).stale, true);
});

test('WAN, RSSI or malformed values cannot become an actual Wi-Fi connection report', () => {
  for (const latest of [{}, {wan_connected: {value: true}}, {rssi_dbm: {value: -40}}, {wifi_connected: {value: 'true'}}, {wifi_connected: {value: 42}}]) {
    assert.deepEqual(recordedWifi(latest), {state: 'Not reported', observedAt: null, stale: true});
  }
});
