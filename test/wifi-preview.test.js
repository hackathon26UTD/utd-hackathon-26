import test from 'node:test';
import assert from 'node:assert/strict';
import {wifiPreviewEnabled} from '../ui/command/wifi-preview.js';
import {readingSummary} from '../ui/command/reading-summary.js';

const operator = {role: 'operator', demo: false};
const device = {id: 'uno-q'};
const response = (displayPreview = {wifiConnected: true, source: 'simulation'}) => ({
  id: 'uno-q', state: 'ok', data: {device: {id: 'uno-q'}, mode: 'live', displayPreview},
});

test('a backend preview enables automatically and is absent without the server flag', () => {
  assert.equal(wifiPreviewEnabled(operator, device, response()), true);
  for (const preview of [null, {}, {wifiConnected: true}, {wifiConnected: 'true', source: 'simulation'}, {wifiConnected: true, source: 'sensor'}, {wifiConnected: false, source: 'simulation'}]) {
    assert.equal(wifiPreviewEnabled(operator, device, response(preview)), false);
  }
  assert.equal(wifiPreviewEnabled(operator, device, response()), true, 'a fresh page can use the response without browser preferences');
});

test('preview follows only the successful matching device detail, never stale or cross-device responses', () => {
  for (const state of ['loading', 'unavailable', 'local']) assert.equal(wifiPreviewEnabled(operator, device, {...response(), state}), false);
  assert.equal(wifiPreviewEnabled(operator, device, null), false);
  assert.equal(wifiPreviewEnabled(operator, device, {...response(), id: 'other-box'}), false);
  const otherDevice = response(); otherDevice.data.device.id = 'other-box';
  assert.equal(wifiPreviewEnabled(operator, device, otherDevice), false);
  assert.equal(wifiPreviewEnabled(operator, {id: 'other-box'}, response()), false);
});

test('public, exercise, shared demo and generated-device views cannot use a live preview', () => {
  for (const ctx of [{role: null}, {role: 'demo'}, {role: 'customer'}, {role: 'operator', demo: true}]) assert.equal(wifiPreviewEnabled(ctx, device, response()), false);
  for (const other of [{}, {...device, synthetic: true}, {...device, source: 'simulation-studio'}]) assert.equal(wifiPreviewEnabled(operator, other, response()), false);
  assert.equal(wifiPreviewEnabled(operator, device, response(), true), false);
  const exercise = response(); exercise.data.mode = 'exercise';
  assert.equal(wifiPreviewEnabled(operator, device, exercise), false);
});

test('automatic preview does not alter a disconnected observation or the sensor summary', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  const latest = Object.freeze({wifi_connected: Object.freeze({value: false, ts: '2026-11-08T17:59:30Z'}), water_detected: Object.freeze({value: true, ts: '2026-11-08T17:59:30Z'})});
  const before = structuredClone(latest), summary = readingSummary(latest, now);
  const detail = response(); detail.data.latest = latest;
  assert.equal(wifiPreviewEnabled(operator, device, detail), true);
  assert.equal(detail.data.latest.wifi_connected.value, false);
  assert.deepEqual(latest, before);
  assert.deepEqual(readingSummary(latest, now), summary);
});
