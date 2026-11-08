import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONUS_API_BOX as clientBox, clampBbox, inConus as clientConus } from '../ui/command/geo.js';
import { CONUS_API_BOX as serverBox, inConus as serverConus } from '../src/place.js';
import { buildConditions, NODE_IDS } from '../src/timeline.js';

test('map and place service use the same lower-48 limits', () => {
  assert.deepEqual(clientBox, serverBox);
  for (const [lat, lon, expected] of [[32.78, -96.8, true], [21.3, -157.8, false], [61.2, -149.9, false]]) {
    assert.equal(clientConus(lat, lon), expected);
    assert.equal(serverConus(lat, lon), expected);
  }
  assert.deepEqual(clampBbox([-130, 30, -100, 55]), [-125.1, 30, -100, 49.6]);
  assert.equal(clampBbox([-160, 18, -154, 22]), null);
});

test('an old critical reading stays last known and missing sensors stay unknown', () => {
  const now = new Date('2026-11-08T04:00:00Z');
  const ts = new Date('2026-11-07T23:00:00Z');
  const out = buildConditions({
    now,
    latest: { water_detected: { value: true, ts } },
    assessment: { status: 'critical', lastSeen: ts, reasons: [{ text: 'Water reported', hazard: 'water', evidence: [{ stale: true }] }] },
    incidents: [], nodes: NODE_IDS.map(id => ({ id, status: 'unknown' })), siblings: [], link: null, help: null,
  });
  assert.match(out.headline, /critical condition.*last known/i);
  assert.match(out.freshness, /out of date/i);
  assert.match(out.what.join(' '), /last known/i);
  assert.match(out.unknown.join(' '), /No temperature reading/i);
});

test('address matching rejects ambiguous or unavailable locations', async () => {
  const {matchCustomerAddress}=await import('../src/customer-location.js');
  await assert.rejects(()=>matchCustomerAddress('123 Example Street, TX',async()=>new Response(JSON.stringify({result:{addressMatches:[]}}))),/matched uniquely/);
  await assert.rejects(()=>matchCustomerAddress('123 Example Street, TX',async()=>{throw Error('offline');}),/unavailable/);
});

test('state selection uses complete state bounds rather than a clipped map tile',async()=>{
  const {MapView}=await import('../ui/command/map.js');
  const bounds=[-106.65,25.84,-93.5,36.5];let fitted;
  MapView.prototype.onClick.call({drawing:false,hit:()=>({kind:'state',properties:{bounds:JSON.stringify(bounds)},geometry:{coordinates:[[[0,0],[1,1]]]}}),clearHover(){},fitTo:b=>{fitted=b;}},{point:{x:10,y:10}});
  assert.deepEqual(fitted,bounds);
});
