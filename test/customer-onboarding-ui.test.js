import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERIAL_ALPHABET, serialCheckChar, serialCheck, normalizeSerial, normalizeCode, parseClaimText, readClaimFragment, claimBody, boxStatus, needsWifiHelp, pauseUntil, pauseChoiceOf, startCameraScan, scanImageFile } from '../ui/customer-onboarding.js';

test('checksum strips HB and uses the actual alphabet length, including its final character', () => {
  assert.equal(SERIAL_ALPHABET.length, 31);
  assert.equal(serialCheckChar('AAAAAAF'), 'E'); // 5 * 7 = 35, mod 31 = 4
  assert.equal(serialCheckChar('9AAAAAA'), '9');
  assert.equal(serialCheckChar('AAAAAA9'), '3'); // 30 * 7 = 210, mod 31 = 24
  for (const c of SERIAL_ALPHABET) {
    const body = c.repeat(7), check = SERIAL_ALPHABET[(SERIAL_ALPHABET.indexOf(c) * 28) % SERIAL_ALPHABET.length];
    assert.equal(serialCheck(`HB-${body.slice(0, 4)}-${body.slice(4)}${check}`), 'ok');
  }
  assert.equal(serialCheck('HB-AAAA-AAFE'), 'ok');
  assert.equal(serialCheck('HB-AAAA-AAFA'), 'mismatch');
  assert.equal(serialCheck('HB-AAAA-AAI2'), 'invalid');
  assert.equal(serialCheckChar('AAAAAA!'), null);
  assert.equal(serialCheckChar('AAAA'), null);
  assert.equal(normalizeSerial('hb aaaa aaff'), 'HB-AAAA-AAFF');
});

test('codes accept legacy six digits and the complete eight-character alphabet only', () => {
  assert.equal(normalizeCode('012345'), '012345');
  assert.equal(normalizeCode('k4m7-xp2r'), 'K4M7-XP2R');
  assert.equal(normalizeCode('K4M7XP2R'), 'K4M7-XP2R');
  for (const bad of ['12345', '1234567', 'K4M7-XP0R', 'K4M7-XP1R', 'K4MI-XP2R']) assert.equal(normalizeCode(bad), '');
});

test('QR parses complete claims, accepts legacy checksum mismatch, rejects trailing secrets or garbage', () => {
  assert.deepEqual(parseClaimText('https://example.test/customer#claim=HB-AAAA-AAFA.K4M7-XP2R'), { serial: 'HB-AAAA-AAFA', code: 'K4M7-XP2R' });
  assert.equal(parseClaimText('#claim=HB-AAAA-AAFF.012345').code, '012345');
  for (const bad of ['#claim=HB-AAAA-AAFF.0123456', '#claim=HB-AAAA-AAFF.K4M7-XP2R.extra', '?claim=HB-AAAA-AAFF.012345', '#claim=HB-AAAA-AAI2.012345']) assert.equal(parseClaimText(bad), null);
});

test('claim fragments are removed even if malformed; household fragments remain untouched', () => {
  for (const hash of ['#claim=HB-AAAA-AAFF.012345', '#claim=bad.secret']) {
    const calls = [], win = { location: { hash, pathname: '/customer', search: '?mode=signin' }, history: { replaceState: (...a) => calls.push(a) } };
    readClaimFragment(win); assert.deepEqual(calls, [[null, '', '/customer?mode=signin']]);
  }
  const win = { location: { hash: '#household=test' }, history: { replaceState: () => assert.fail('household fragment removed') } };
  assert.equal(readClaimFragment(win), null);
});

test('claim omits optional address and nonconsented contact name; unsupported consents never sent', () => {
  const f = { serial: 'HB-AAAA-AAFA', code: '012345', nickname: ' Garage ', room: ' Utility ', emailAlerts: true, locationConsent: true };
  assert.deepEqual(claimBody(f, { contactName: 'Owner' }), { serial: f.serial, code: f.code, consent: false, nickname: 'Garage', room: 'Utility' });
  assert.deepEqual(claimBody({ ...f, consent: true, address: ' Example address ' }, { contactName: 'Owner' }), { serial: f.serial, code: f.code, consent: true, nickname: 'Garage', room: 'Utility', address: 'Example address', contactName: 'Owner' });
});

test('server fleet status controls connectivity; heartbeat and normal risk do not invent reporting or safety', () => {
  assert.deepEqual(boxStatus({ fleetStatus: { state: 'active', reason: null }, status: 'normal' }), { kind: 'active', label: 'Reporting', pill: 'reporting' });
  for (const [reason, kind] of [['disabled', 'disabled'], ['silent', 'silent'], ['awaiting_first_report', 'awaiting'], ['unlinked', 'other']]) {
    assert.equal(boxStatus({ fleetStatus: { state: 'inactive', reason }, lastSeenAt: new Date().toISOString(), status: 'normal' }).kind, kind);
  }
  assert.equal(boxStatus({ lastSeenAt: new Date().toISOString(), status: 'normal' }).kind, 'other');
  assert.equal(boxStatus({}).kind, 'awaiting');
  assert.equal(boxStatus({ firstReportAt: new Date().toISOString() }).kind, 'other');
});

test('waiting help appears after ten minutes, and pause durations round trip', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const d = { fleetStatus: { state: 'inactive', reason: 'awaiting_first_report' } };
  assert.equal(needsWifiHelp(d, now - 599999, now), false);
  assert.equal(needsWifiHelp(d, now - 600000, now), true);
  assert.equal(needsWifiHelp({ ...d, linkedAt: new Date(now - 600000).toISOString() }, now, now), true);
  for (const choice of ['on', '24h', '7d']) assert.equal(pauseChoiceOf(pauseUntil(choice, now), now), choice);
  assert.equal(pauseChoiceOf(new Date(now - 1).toISOString(), now), 'on');
});

test('cancelled camera scan never requests camera permission after detector initialization', async () => {
  let resolveFormats, cameraCalls = 0;
  const g = { BarcodeDetector: class { static getSupportedFormats() { return new Promise(r => { resolveFormats = r; }); } }, navigator: { mediaDevices: { getUserMedia() { cameraCalls++; } } } };
  const scan = startCameraScan({}, { g, onText: () => assert.fail(), onError: () => assert.fail() });
  scan.stop(); resolveFormats(['qr_code']);
  await new Promise(r => setImmediate(r)); assert.equal(cameraCalls, 0);
});

test('image scanner closes decoded images even when QR detection fails', async () => {
  let closed = false;
  const g = { BarcodeDetector: class { async detect() { throw Error('bad image'); } }, createImageBitmap: async () => ({ close() { closed = true; } }) };
  assert.equal(await scanImageFile({}, g), null); assert.equal(closed, true);
});
