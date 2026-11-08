import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { SERIAL_ALPHABET, serialFromBody, checkSerial, checkChar, buildSheet, buildSecretsHeader } from '../scripts/lib/labels.mjs';
import { PAIRING_ALPHABET, inventorySerial } from '../src/pairing-code.js';
import { encodeQr, byteCapacity, qrSvg } from '../scripts/lib/qr.mjs';

const serial = serialFromBody('ABCDEFG');
const code = 'ABCD-EFGH';
const qr = `https://example.test/customer#claim=${serial}.${code}`;
const key = `dk_${'b'.repeat(64)}`;
const device = { deviceId: 'a'.repeat(24), serial, pairingCode: code, qr, deviceKey: key, name: '<script>alert("x")</script>' };

test('serial check character uses the supplied alphabet length and excludes HB prefix', () => {
  assert.equal(SERIAL_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  assert.equal(SERIAL_ALPHABET.length, 31);
  assert.equal(SERIAL_ALPHABET, PAIRING_ALPHABET);
  for (let i = 0; i < 20; i++) assert.equal(checkSerial(inventorySerial()).checksum, true);
  assert.equal(checkChar('ABCDEFG'), SERIAL_ALPHABET[(0 + 2 + 6 + 12 + 20 + 30 + 42) % SERIAL_ALPHABET.length]);
  assert.deepEqual(checkSerial(serial), { valid: true, checksum: true });
  assert.deepEqual(checkSerial('HB-AAAA-AAAB'), { valid: true, checksum: false });
  assert.deepEqual(checkSerial('HB-0000-0000'), { valid: false, checksum: false });
});

test('outer stickers contain no pairing secret; private cards contain escaped text and no device keys', () => {
  const sheet = buildSheet([device], { batch: '<batch>', origin: 'https://example.test' });
  const sticker = sheet.match(/<div class="sticker">(.*?)<\/div><\/div><div><p class="part-title">/s)[1];
  assert.ok(sticker.includes(serial)); assert.ok(!sticker.includes(code)); assert.ok(!sticker.includes('<svg'));
  assert.ok(!sheet.includes(key)); assert.ok(sheet.includes(code)); assert.ok(!sheet.includes('<script>'));
  assert.ok(sheet.includes('&lt;script&gt;')); assert.ok(sheet.includes('&lt;batch&gt;'));
  assert.match(sheet, /Content-Security-Policy/); assert.match(sheet, /default-src 'none'/);
  assert.match(sheet, /Safe Home/); assert.match(sheet, /@media print/);
  const legacy = { ...device, qr: undefined, qrPayload: qr };
  assert.ok(buildSheet([legacy]).includes('<svg'));
});

test('firmware headers keep the device-specific key and id, and escape Wi-Fi values', () => {
  const header = buildSecretsHeader(device, { apiBase: 'https://api.example.test', wifi: { ssid: 'test"\n#define BAD', pass: 'p\\q' }, rand: () => Buffer.alloc(16, 1) });
  assert.ok(header.includes(key)); assert.ok(header.includes(device.deviceId)); assert.ok(header.includes(serial));
  assert.ok(!header.includes('\n#define BAD')); assert.match(header, /#define WIFI_SSID "test\\"\\n#define BAD"/);
  assert.ok(!header.includes(code)); assert.ok(!header.includes('API_ADMIN_KEY'));
  const other = buildSecretsHeader({ ...device, deviceId: 'c'.repeat(24), deviceKey: `dk_${'c'.repeat(64)}` }, { apiBase: 'https://api.example.test' });
  assert.ok(!other.includes(key));
});

test('QR encoder refuses oversized payloads and unsafe quiet-zone values', () => {
  assert.throws(() => encodeQr('x'.repeat(214)), RangeError);
  for (const quiet of [0, -1, 1.5, '4', 33]) assert.throws(() => qrSvg(qr, { quiet }), RangeError);
  assert.match(qrSvg(qr, { label: '<script>' }), /aria-label="&lt;script&gt;"/);
});

const PYTHON = process.env.HB_QR_PYTHON || 'python3';
function hasDecoder() { return spawnSync(PYTHON, ['-c', 'import cv2, numpy'], { encoding: 'utf8' }).status === 0; }

test('independent OpenCV decoding recovers exact payloads across QR versions 1-10', (t) => {
  if (!hasDecoder()) return t.skip('Install opencv-python to run independent QR decoding (or set HB_QR_PYTHON).');
  const samples = [qr, 'https://example.test/customer#claim=HB-AAAA-AAAB.123456', 'https://example.test/customer#claim=HB-AAAA-AAAB.ABCDEFGH',
    ...Array.from({ length: 10 }, (_, i) => 'x'.repeat(byteCapacity(i + 1)))];
  const input = samples.map(text => ({ text, ...encodeQr(text) }));
  const decoded = spawnSync(PYTHON, ['-c', `import cv2,json,sys,numpy as np
results=[]
for q in json.load(sys.stdin):
 a=np.pad(np.array(q['modules'],dtype=np.uint8),4)
 a=np.repeat(np.repeat((1-a)*255,10,axis=0),10,axis=1)
 text,_,_=cv2.QRCodeDetector().detectAndDecode(a)
 results.append(text)
print(json.dumps(results))
`], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000 });
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.deepEqual(JSON.parse(decoded.stdout), samples);
});

test('independent decoder reads the actual SVG embedded in the printable label', async (t) => {
  if (!hasDecoder()) return t.skip('OpenCV is unavailable.');
  let sharp;
  try { sharp = createRequire(import.meta.url)('sharp'); } catch { return t.skip('Install sharp to rasterize the actual label SVG.'); }
  const svg = buildSheet([device], { origin: 'https://example.test' }).match(/<svg.*?<\/svg>/s)[0];
  const png = await sharp(Buffer.from(svg), { density: 600 }).resize(600, 600, { kernel: 'nearest' }).png().toBuffer();
  const decoded = spawnSync(PYTHON, ['-c', `import cv2,sys,numpy as np
im=cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(),dtype=np.uint8),cv2.IMREAD_GRAYSCALE)
text,_,_=cv2.QRCodeDetector().detectAndDecode(im)
print(text)
`], { input: png, timeout: 30000 });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.toString().trim(), qr);
});
