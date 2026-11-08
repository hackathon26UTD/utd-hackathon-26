import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { POWER_PROFILES } from '../domain/system-policy.js';

test('portable firmware policy compiles and agrees with server profile timings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-policy-'));
  try {
    const source = join(dir, 'policy.cpp'), binary = join(dir, 'policy');
    writeFileSync(source, `#include "power_policy.h"\n#include <stdio.h>\nint main() {
      auto n=beaconPowerPolicy(true,true,false), s=beaconPowerPolicy(true,false,false), c=beaconPowerPolicy(false,false,true);
      for(auto p : {n,s,c}) printf("%u,%u,%u,%d,%d\\n",p.sampleMs,p.reportMs,p.wifiRetryMs,p.camera,p.display);
      return beaconPowerPolicy(false,true,false).mode == BeaconPowerMode::Saver ? 0 : 1;
    }\n`.replace('#include <stdio.h>', '#include <stdio.h>\n#include <initializer_list>'));
    const build = spawnSync('c++', ['-std=c++11', '-Wall', '-Werror', '-I', resolve('firmware/common'), source, '-o', binary], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    const expected = Object.values(POWER_PROFILES).map(p => [p.sampleMs, p.reportMs, p.wifiRetryMs, Number(p.camera), Number(p.display)].join(',')).join('\n');
    assert.equal(run.stdout.trim(), expected);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
