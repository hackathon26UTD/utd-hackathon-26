import {spawnSync} from 'node:child_process';

// Reuse the shipped Uno Q agent's read-only system sampler, over an identified USB link.
// The agent source must be copied to this directory first. No secret goes to the board.
const sampleCode = `import sys,json,pathlib
sys.path.insert(0,'/home/arduino/safe-home-agent')
from hbagent.system import sample
d=sample()
p=pathlib.Path('/sys/class/net/wlan0/operstate')
if p.exists():
 s=p.read_text().strip()
 if s in ('up','down'): d['wifi_connected']=s=='up'
print(json.dumps(d))`;

export function hubReadings(sample, receivedAt) {
  const limits={cpu_temp_c:[-50,150],load1:[0,10000],mem_avail_mb:[0,1000000],os_uptime_s:[0,1e12]};
  const values=Object.entries(sample).filter(([key,value])=>key==='wifi_connected' ? typeof value==='boolean' : limits[key] && typeof value==='number' && Number.isFinite(value) && value>=limits[key][0] && value<=limits[key][1]);
  return values.map(([sensor,value])=>({sensor,value,ts:receivedAt,meta:{source:'unoq-linux-usb',timestampBasis:'host-receipt'}}));
}

export function readHub(adb, serial) {
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(serial||''))throw Error('An exact USB serial is required');
  const encoded=Buffer.from(sampleCode).toString('base64');
  const command=`python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`;
  const result=spawnSync(adb,['-s',serial,'exec-out',command],{encoding:'utf8',timeout:8000,maxBuffer:8192});
  if(result.error||result.status!==0)throw Error('Uno Q USB connection unavailable');
  const readings=hubReadings(JSON.parse(result.stdout),new Date().toISOString());
  if(!readings.length)throw Error('Uno Q returned no measured system values');
  return readings;
}
