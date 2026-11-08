import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateBackupHours,runtimeText} from '../ui/backup-runtime.js';

test('series AAA estimate uses one cell capacity and explicit reserve, not doubled capacity',()=>{
  assert.equal(estimateBackupHours(1000,100),8.5);
  assert.equal(runtimeText(8.5),'8h 30m');
  assert.equal(estimateBackupHours(1000,200),4.25);
});
test('missing, invalid or physically unusable inputs do not fabricate runtime',()=>{
  for(const args of [[0,100],[1000,0],[NaN,100],[1000,Infinity],[-100,20],[6000,100],[1000,100,1]]) assert.equal(estimateBackupHours(...args),null);
  assert.equal(runtimeText(null),'Not measured');
  assert.equal(runtimeText(.001),'Less than 1 minute');
});
