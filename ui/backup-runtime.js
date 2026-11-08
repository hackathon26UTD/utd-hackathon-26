// Series cells share capacity; doubling the cell count must not double mAh.
// This is an operator/user-supplied estimate, not battery telemetry.
export function estimateBackupHours(capacityMah, currentMa, reserveFraction = .15) {
  if (!Number.isFinite(capacityMah) || capacityMah <= 0 || capacityMah > 5000 ||
      !Number.isFinite(currentMa) || currentMa <= 0 || currentMa > 10000 ||
      !Number.isFinite(reserveFraction) || reserveFraction < 0 || reserveFraction >= 1) return null;
  return capacityMah * (1 - reserveFraction) / currentMa;
}
export function runtimeText(hours) {
  if (hours == null) return 'Not measured';
  if (hours < 1 / 60) return 'Less than 1 minute';
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function backupRuntime(h) {
  const output = h('strong', {id:'backup-estimate'}, 'Not measured');
  const form = h('form',{onsubmit:e=>{
    e.preventDefault();const fields=new FormData(e.currentTarget);
    const hours=estimateBackupHours(Number(fields.get('capacity')),Number(fields.get('draw')));
    output.textContent=hours===null?'Enter valid capacity and current':runtimeText(hours)+' estimated';
  }},h('p',{class:'fine'},'Use usable capacity for one cell and current measured at the battery pack. The estimate includes a 15% reserve. Converter losses, temperature and battery age can reduce runtime.'),
  h('div',{class:'backup-fields'},
    h('label',null,'Capacity per cell (mAh)',h('input',{name:'capacity',type:'number',min:'1',max:'5000',step:'any',required:true,placeholder:'From battery data'})),
    h('label',null,'Pack current (mA)',h('input',{name:'draw',type:'number',min:'.01',max:'10000',step:'any',required:true,placeholder:'Measured at the pack'}))),
  h('button',{type:'submit'},'Estimate runtime'));
  return h('section',{class:'backup-runtime','aria-label':'Battery backup'},
    h('div',{class:'backup-header'},h('div',null,h('span',{class:'box-kicker'},'BATTERY BACKUP'),h('p',null,'2 × AAA · 3 V nominal')),h('div',{class:'backup-result'},h('small',null,'Estimated backup time'),output)),
    h('p',{class:'fine'},'24/7 Life Super Alkaline Plus · 1.5 V per cell · connected in series'),
    h('details',null,h('summary',null,'Calculate from battery measurements'),form),
    h('p',{class:'fine'},'For wall-power loss. A lost Wi-Fi connection alone does not indicate battery use.'));
}
