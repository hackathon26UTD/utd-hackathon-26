import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { renderCustomerAlertEmail } from '../src/customer-alert-email.js';
const directory=resolve(process.argv[2]||'work/customer-email-preview');
await mkdir(directory,{recursive:true});
for(const event of ['detected-condition','stale-offline','recovery-needs-review']) {
  const result=renderCustomerAlertEmail({event,homeLabel:'Example home (synthetic)',source:'simulation',severity:event==='recovery-needs-review'?'attention':'critical',power:'battery',wifi:event==='stale-offline'?'offline':'connected',conditions:event==='recovery-needs-review'?['none_detected']:['water'],observedAt:'2026-11-08T12:00:00Z',now:event==='stale-offline'?'2026-11-08T13:00:00Z':'2026-11-08T12:05:00Z'});
  await writeFile(join(directory,event+'.html'),result.html);
  await writeFile(join(directory,event+'.txt'),result.subject+'\n\n'+result.text+'\n');
}
console.log('Wrote three synthetic HTML/text previews to '+directory);
