import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function runCpp(source, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'homebeacon-history-'));
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    writeFileSync(join(dir, 'test.cpp'), source);
    const build = spawnSync('c++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', dir, '-I', resolve('firmware/common'), join(dir, 'test.cpp'), '-o', join(dir, 'test')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    const run = spawnSync(join(dir, 'test'), [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const fixture = `
#include <cassert>
#include "local_history_core.h"
using namespace local_history;
MeshMsg sample(uint32_t seq, uint32_t epoch = 1800000000) {
  MeshMsg m = {}; m.boot=1; m.seq=seq; m.type=MSG_READING; m.epoch=epoch;
  m.flags=F_WATER_VALID|F_MAINS_VALID|F_MAINS|F_TIME_VALID|F_ACCEL_VALID;
  m.waterRaw=100; m.accelMilliG=20; m.batteryMv=8000;
  return m;
}
Policy p = {F_WATER_VALID|F_MAINS_VALID|F_ACCEL_VALID, true, 400, 6};
`;
test('portable recorder: ring/means, duplicate/outage/reboot, qualification and unknown timestamps', () => runCpp(fixture + `
int main() {
  State s;
  for (unsigned i=1; i<=80; ++i) {
    auto m=sample(i,1800000000+i*3600); m.waterRaw=100+i;
    assert(observe(s,m,true,i*HISTORY_SAMPLE_MS,p)); // no Wi-Fi dependency
  }
  assert(s.count==CAPACITY && s.overwritten==16);
  assert(s.metrics[WATER_RAW].count==80 && s.metrics[WATER_RAW].min==101 && s.metrics[WATER_RAW].max==180);
  assert(s.metrics[WATER_RAW].mean()==140.5 && s.metrics[WATER_RAW].reference());
  assert(!observe(s,sample(80),true,81*HISTORY_SAMPLE_MS,p));
  assert(!observe(s,sample(81),false,81*HISTORY_SAMPLE_MS,p));
  assert(s.metrics[WATER_RAW].count==80);
  auto m=sample(81,1800000000+81*3600);
  assert(!observe(s,m,true,80*HISTORY_SAMPLE_MS+10,p));
  m=sample(82); m.flags &= ~F_TIME_VALID;
  assert(observe(s,m,true,82*HISTORY_SAMPLE_MS,p));
  const auto &unknown=s.samples[(s.head+CAPACITY-1)%CAPACITY];
  assert(unknown.epoch==0 && unknown.boot==1 && unknown.seq==82 && !(unknown.flags&F_TIME_VALID));
  assert(s.unknownTime==1 && s.metrics[WATER_RAW].count==80);
  for (unsigned i=0;i<8;++i) {
    m=sample(83+i,1800000000+(83+i)*3600);
    if(i==0)m.flags|=F_WATER;
    if(i==1)m.flags&=~F_MAINS;
    if(i==2)m.flags&=~F_WATER_VALID;
    if(i==3)m.batteryMv=6000;
    if(i==4)m.accelMilliG=400;
    if(i==5){m.flags|=F_SOUND_VALID;m.soundHits=6;}
    if(i==6)m.flags|=F_FLAME;
    if(i==7)m.flags|=F_TILT;
    assert(observe(s,m,true,(83+i)*HISTORY_SAMPLE_MS,p));
  }
  assert(s.metrics[WATER_RAW].count==80);
  s.checksum=checksum(s); assert(valid(s));
  State restored=s; // exact checkpoint image, then new boot / reset uptime
  m=sample(1,1800000000+100*3600);m.boot=2;
  assert(observe(restored,m,true,1,p));
  assert(restored.metrics[WATER_RAW].count==81 && restored.count==CAPACITY);
  assert(!observe(restored,m,true,2,p));
  assert(!observe(restored,sample(999),true,3,p)); // old boot replay
  State alert;
  m=sample(1);m.type=MSG_EVENT;strcpy(m.event,"alarm.sound");
  observe(alert,m,true,1,p);
  assert(observe(alert,sample(2),true,2,p)); assert(alert.metrics[WATER_RAW].count==0);
  assert(observe(alert,sample(3,1800003600),true,HISTORY_CHECKPOINT_MS+1,p));
  assert(alert.metrics[WATER_RAW].count==1);
  State rapid;
  for(unsigned i=1;i<=30;++i)observe(rapid,sample(i,1800000000+i*300),true,i*HISTORY_SAMPLE_MS,p);
  assert(rapid.metrics[WATER_RAW].count==30 && !rapid.metrics[WATER_RAW].reference());
  rapid.metrics[WATER_RAW].count=UINT32_MAX; auto sum=rapid.metrics[WATER_RAW].sum;
  rapid.metrics[WATER_RAW].add(4000,1900000000); assert(rapid.metrics[WATER_RAW].sum==sum);
  restored.checksum=checksum(restored); assert(valid(restored));
  restored.samples[0].waterRaw++; assert(!valid(restored));
}
`));

test('NVS adapter: checkpoint survives restart, interrupted slot falls back, writes rate-limited and failure visible', () => runCpp(`
#include <cassert>
#include <cstdint>
#include <cstdio>
uint32_t fakeMs=0;
uint32_t millis(){return fakeMs;}
struct SerialMock { void println(const char*){} template<typename... Args> void printf(const char*,Args...){} } Serial;
#include "local_history.h"
using namespace local_history;
const char *deviceA="0123456789abcdef01234567",*deviceB="abcdef0123456789abcdef01";
void restart(const char *device=deviceA){state=State{};activeSlot=-1;dirty=false;attempted=false;lastAttemptMs=0;begin({F_WATER_VALID|F_MAINS_VALID,false,400,6},device);}
MeshMsg reading(unsigned seq){MeshMsg m={};m.boot=1;m.seq=seq;m.type=MSG_READING;m.flags=F_WATER_VALID|F_MAINS_VALID|F_MAINS|F_TIME_VALID;m.epoch=1800000000+seq*3600;m.waterRaw=100;return m;}
int main(){
  restart(); assert(identityReady);const int bindingWrites=Preferences::writes;observe(reading(1),true); assert(Preferences::writes==bindingWrites+1);
  fakeMs=HISTORY_SAMPLE_MS;observe(reading(2),true);assert(Preferences::writes==bindingWrites+1 && dirty);
  fakeMs=HISTORY_CHECKPOINT_MS;loop();assert(Preferences::writes==bindingWrites+2 && !dirty);
  restart();assert(state.count==2 && state.metrics[WATER_RAW].count==2);
  observe(reading(2),true);assert(state.count==2);
  Preferences::blobs["slot1"][20]^=1;
  restart();assert(state.count==1 && state.metrics[WATER_RAW].count==1);
  fakeMs=HISTORY_CHECKPOINT_MS*2;Preferences::fail=true;observe(reading(3),true);
  assert(writeFailures==1 && dirty);
  loop();assert(writeFailures==1); // retries cannot hammer flash
  fakeMs+=HISTORY_CHECKPOINT_MS;Preferences::fail=false;loop();assert(!dirty);
  restart();assert(state.count==2);
  assert(state.samples[0].epoch==1800003600); // retained original timestamp, not replay time
  print();
  // Device ID, not the key, owns the recorder: same ID/key rotation restores.
  restart(deviceA);assert(identityReady && state.count==2);
  restart(deviceB);assert(identityReady && state.count==0);
  assert(Preferences::blobs["slot0"].empty() && Preferences::blobs["slot1"].empty());
  fakeMs+=HISTORY_CHECKPOINT_MS;observe(reading(1),true);assert(state.count==1);
  restart(deviceB);assert(identityReady && state.count==1);
  // Legacy unbound slots must never be restored or uploaded.
  Preferences::blobs.erase("identity");restart(deviceB);assert(identityReady && state.count==0);
  observe(reading(1),true);assert(state.count==1);
  Preferences::failRemove=true;restart(deviceA);assert(!identityReady && !storageOk && state.count==0);
  Preferences::failRemove=false;Preferences::fail=true;restart(deviceA);assert(!identityReady && state.count==0);
  Preferences::fail=false;restart(deviceA);assert(identityReady && state.count==0);
  restart("invalid");assert(!identityReady && state.count==0);
}
`, { 'Preferences.h': `#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
class Preferences { public:
 static std::map<std::string,std::vector<char>> blobs; static int writes; static bool fail, failRemove;
 bool begin(const char*,bool){return true;}
 bool remove(const char*k){if(failRemove)return false;return blobs.erase(k)>0;}
 size_t getBytesLength(const char*k){return blobs[k].size();}
 size_t getBytes(const char*k,void*p,size_t n){if(blobs[k].size()!=n)return 0;memcpy(p,blobs[k].data(),n);return n;}
 size_t putBytes(const char*k,const void*p,size_t n){++writes;if(fail)return 0;blobs[k]=std::vector<char>((const char*)p,(const char*)p+n);return n;}
};
std::map<std::string,std::vector<char>> Preferences::blobs;int Preferences::writes=0;bool Preferences::fail=false;bool Preferences::failRemove=false;
` }));

test('generated local history headers match common source in all sketches', () => {
  for (const name of ['local_history.h', 'local_history_core.h']) for (const sketch of ['box_a', 'box_b', 'mesh_test']) {
    assert.deepEqual(readFileSync(`firmware/${sketch}/${name}`), readFileSync(`firmware/common/${name}`));
  }
});
