// Firmware helpers.
//   npm run firmware:sync    copy firmware/common/*.h into each sketch folder (Arduino needs them local)
//   npm run firmware:build   sync, then compile box_a and box_b with arduino-cli (compile check)
import { copyFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FW = join(ROOT, 'firmware');
const SKETCHES = [
  { dir: 'box_a', fqbn: 'esp32:esp32:XIAO_ESP32S3:PSRAM=opi' },
  { dir: 'box_b', fqbn: 'esp32:esp32:esp32' },
];

function sync() {
  for (const f of readdirSync(join(FW, 'common')).filter((n) => n.endsWith('.h'))) {
    for (const s of SKETCHES) copyFileSync(join(FW, 'common', f), join(FW, s.dir, f));
  }
  console.log('synced firmware/common into', SKETCHES.map((s) => s.dir).join(', '));
}

function findCli() {
  const candidates = [process.env.ARDUINO_CLI, 'C:/Program Files/Arduino CLI/arduino-cli.exe', 'arduino-cli'].filter(Boolean);
  for (const c of candidates) if (c === 'arduino-cli' || existsSync(c)) return c;
  return 'arduino-cli';
}

function build() {
  sync();
  const cli = findCli();
  let failed = false;
  for (const s of SKETCHES) {
    console.log(`\n== compiling ${s.dir} (${s.fqbn})`);
    const r = spawnSync(cli, ['compile', '--fqbn', s.fqbn, '--warnings', 'default', join(FW, s.dir)], { stdio: 'inherit' });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === 'sync') sync();
else if (cmd === 'build') build();
else console.log('usage: node scripts/firmware.mjs sync|build');
