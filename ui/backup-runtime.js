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
  const hours = Math.round(estimateBackupHours(1000,150));
  return h('section',{class:'backup-runtime','aria-label':'Battery backup'},
    h('div',{class:'backup-header'},h('div',null,h('span',{class:'box-kicker'},'BATTERY BACKUP'),h('p',null,'When wall power is lost')),h('div',{class:'backup-result'},h('small',null,'Estimated backup time'),h('strong',{id:'backup-estimate'},`About ${hours} hours`))),
    h('p',{class:'backup-explanation'},'Assumes 1,000 mAh at 150 mA, with a 15% reserve. Not measured.'));
}
