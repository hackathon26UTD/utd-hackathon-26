import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const jsonHeaders = resolve('.tools/arduino-cli/user/libraries/ArduinoJson/src');
const options = { skip: !existsSync(join(jsonHeaders, 'ArduinoJson.h')) && 'ArduinoJson headers unavailable; install the firmware toolchain to run host transport tests.' };
function runCpp(code) {
  const dir = mkdtempSync(join(tmpdir(), 'homebeacon-sync-'));
  try {
    writeFileSync(join(dir, 'test.cpp'), code);
    const build = spawnSync('c++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', jsonHeaders, '-I', resolve('firmware/common'), join(dir, 'test.cpp'), '-o', join(dir, 'test')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    const run = spawnSync(join(dir, 'test'), [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    return run.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const helpers = `
#include <cassert>
#include <string>
#include <cstdio>
#include "local_history_core.h"
void fill(local_history::State &state, unsigned count) {
  state = local_history::State{};
  for (unsigned i=1;i<=count;++i) {
    MeshMsg m={};m.type=MSG_READING;m.boot=2;m.seq=i;m.epoch=1800000000+i*3600;
    m.flags=F_WATER_VALID|F_MAINS_VALID|F_MAINS|F_TIME_VALID|F_ACCEL_VALID;
    m.waterRaw=100+i;m.accelMilliG=20;m.batteryMv=8000;
    if(i==1){m.flags&=~F_TIME_VALID;m.epoch=0;}
    local_history::observe(state,m,true,i*local_history::HISTORY_SAMPLE_MS,{F_WATER_VALID|F_MAINS_VALID,false,400,6});
  }
}
`;
test('history sync serialization keeps original observations, bounded batches, ACK cursor and frozen retries', options, async () => {
  const output = runCpp(helpers + `
#include "history_sync.h"
using namespace history_sync;
std::string reply(const Batch &batch) {
  JsonDocument doc;doc["version"]=1;doc["stored"]=batch.count;auto ids=doc["accepted"].to<JsonArray>();
  for(size_t i=batch.count;i>0;--i){char id[24];snprintf(id,sizeof(id),"%u:%u",batch.boots[i-1],batch.sequences[i-1]);ids.add(std::string(id));}
  std::string out;serializeJson(doc,out);return out;
}
int main(){
  local_history::State state;fill(state,10);Batch batch;Cursor cursor;
  assert(prepare(batch,state,cursor)&&batch.count==8&&batch.length<MAX_BODY);
  std::puts(batch.body);std::string original=batch.body;
  assert(original.find("\\\"epoch\\\":0")!=std::string::npos);
  local_history::State changed;fill(changed,90);
  assert(prepare(batch,changed,cursor)&&original==batch.body); // overwritten ring cannot mutate a retry
  const char *bad="{\\\"version\\\":1,\\\"accepted\\\":[\\\"2:1\\\"],\\\"stored\\\":1}";
  assert(!acknowledge(batch,cursor,bad,strlen(bad))&&cursor.seq==0);
  auto good=reply(batch);
  auto badVersion=good;badVersion.replace(badVersion.find("\\\"version\\\":1"),11,"\\\"version\\\":2");
  assert(!acknowledge(batch,cursor,badVersion.c_str(),badVersion.size()));
  assert(!acknowledge(batch,cursor,good.c_str(),MAX_RESPONSE+1));
  auto duplicate=good;duplicate.replace(duplicate.find("2:2"),3,"2:1");
  assert(!acknowledge(batch,cursor,duplicate.c_str(),duplicate.size()));
  assert(acknowledge(batch,cursor,good.c_str(),good.size())&&cursor.boot==2&&cursor.seq==8&&!batch.count);
  assert(prepare(batch,state,cursor)&&batch.count==2&&batch.sequences[0]==9);
  good=reply(batch);assert(acknowledge(batch,cursor,good.c_str(),good.size()));
  assert(!prepare(batch,state,cursor)); // acknowledged data remains skipped
  Cursor reboot;assert(prepare(batch,state,reboot)&&batch.count==8&&std::string(batch.body)==original);
  clear(batch);Cursor empty;assert(prepare(batch,changed,empty)&&batch.sequences[0]==27); // oldest retained, ascending
  local_history::State invalid;fill(invalid,1);invalid.samples[0].epoch=1800000000;clear(batch);
  assert(!prepare(batch,invalid,empty)&&!batch.count); // never fix unknown time by assigning now
}
`);
  const body = JSON.parse(output.trim());
  assert.deepEqual(Object.keys(body), ['version', 'snapshot', 'samples', 'metrics', 'overwritten']);
  assert.deepEqual(body.snapshot, { boot: 2, seq: 10 });
  assert.equal(body.version, 1); assert.equal(body.samples.length, 8);
  assert.deepEqual(body.samples.map(s => `${s.boot}:${s.seq}`), ['2:1', '2:2', '2:3', '2:4', '2:5', '2:6', '2:7', '2:8']);
  assert.equal(body.samples[0].epoch, 0); assert.equal(body.samples[1].epoch, 1800007200);
  assert.deepEqual(Object.keys(body.samples[0]), ['boot', 'seq', 'epoch', 'uptimeMs', 'flags', 'waterRaw', 'flameRaw', 'accelMilliG', 'batteryMv', 'soundHits']);
  assert.deepEqual(Object.keys(body.metrics), ['water_raw', 'accel_dev_mg', 'battery_mv']);
  assert.equal(body.metrics.water_raw.count, 9); assert.equal(body.metrics.water_raw.sum, 954);
  assert.equal(body.metrics.water_raw.firstEpoch, 1800007200);
  // Check the actual C++ wire payload against the parent's stable endpoint bounds.
  const { validateHistorySync } = await import('../src/device-history-sync.js');
  const validated = validateHistorySync(body, new Date(1800100000 * 1000));
  assert.deepEqual(validated.snapshot, body.snapshot);
  assert.equal(validated.samples[0].observedAt, null);
});

test('history transport uses own key and verified HTTPS; retries same batch, bounds response, pauses conflicts', options, () => runCpp(helpers + `
#include <ArduinoJson.h>
#define ARDUINO 10800
using String=std::string;
class Stream { public: virtual ~Stream(){} virtual int available()=0;virtual int read()=0;virtual int peek()=0;virtual void flush()=0;virtual size_t write(uint8_t)=0;virtual size_t write(const uint8_t*,size_t)=0; };
struct SerialMock {void println(const char*){}template<typename... T>void printf(const char*,T...){} } Serial;
uint32_t fakeMs=0;uint32_t millis(){return fakeMs;}
const char *ROOT_CA_BUNDLE="test-root";
struct WiFiClientSecure {void setCACert(const char *ca){assert(ca==ROOT_CA_BUNDLE);}};
int code=503,calls=0;std::string response,sent,auth,url;int reportedSize=-1;
struct HTTPClient {
 void setTimeout(int n){assert(n==5000);}void setConnectTimeout(int n){assert(n==5000);}
 bool begin(WiFiClientSecure&,const String &u){url=u;return true;}
 void addHeader(const char*k,const char*v){if(std::string(k)=="X-Device-Key")auth=v;}
 int POST(uint8_t*p,size_t n){++calls;sent.assign((char*)p,n);return code;}
 int getSize(){return reportedSize;}
 int writeToStream(Stream *out){size_t n=out->write((const uint8_t*)response.data(),response.size());return n==response.size()?int(n):-1;}
 void end(){}
};
namespace uplink {bool connected=true;const char *apiBase="https://local.test";bool wifiUp(){return connected;}}
namespace mesh {const char *myId="B";MeshNodeCfg self={"B","","test-device-id","test-own-key"};const MeshNodeCfg *nodeCfg(const char*id){assert(id==myId);return &self;}}
namespace local_history {State state;bool identityReady=true;}
#include "history_sync.h"
int main(){
  fill(local_history::state,2);local_history::identityReady=false;history_sync::loop();assert(calls==0);local_history::identityReady=true;history_sync::loop();assert(calls==1);
  assert(auth=="test-own-key"&&url=="https://local.test/api/device/history-sync");
  const auto original=sent;fill(local_history::state,90);
  fakeMs=29999;history_sync::loop();assert(calls==1);
  fakeMs=30000;code=-1;history_sync::loop();assert(calls==2&&sent==original&&history_sync::cursor.seq==0);
  fakeMs+=30000;code=200;response="{\\\"version\\\":1,\\\"stored\\\":1,\\\"accepted\\\":[\\\"2:1\\\"]}";history_sync::loop();assert(history_sync::cursor.seq==0);
  fakeMs+=30000;response=std::string(3000,'x');history_sync::loop();assert(history_sync::cursor.seq==0);
  fakeMs+=30000;response="{\\\"version\\\":1,\\\"stored\\\":2,\\\"accepted\\\":[\\\"2:1\\\",\\\"2:2\\\"]}";history_sync::loop();assert(history_sync::cursor.seq==2&&!history_sync::pending.count);
  fakeMs+=30000;code=409;history_sync::loop();assert(history_sync::stopped&&history_sync::pending.count==8);
  const int before=calls;fakeMs+=60000;code=200;history_sync::loop();assert(calls==before&&history_sync::cursor.seq==2);
  history_sync::print();
}
`));

test('history sync generated headers match common source', () => {
  for (const box of ['box_a', 'box_b', 'mesh_test']) assert.deepEqual(readFileSync(`firmware/${box}/history_sync.h`), readFileSync('firmware/common/history_sync.h'));
});
