// Fleet availability is separate from sensor severity. A heartbeat never means a home is safe.
export function silenceAfterMs(device) {
  const seconds = device.expectedReportIntervalSeconds;
  return Math.max(15 * 60_000, (Number.isInteger(seconds) && seconds >= 5 && seconds <= 86400 ? seconds * 3 + 60 : 0) * 1000);
}
export function fleetStatus(device, link, now = new Date()) {
  if (device.disabled) return { state: 'inactive', reason: 'disabled' };
  if (!link?.active) return { state: 'inactive', reason: device.unlinkedAt ? 'unlinked' : 'not_linked' };
  if (!device.lastSeen) return { state: 'inactive', reason: 'awaiting_first_report' };
  const age = now - new Date(device.lastSeen);
  if (!Number.isFinite(age) || age < -300000 || age > silenceAfterMs(device)) return { state: 'inactive', reason: 'silent' };
  return { state: 'active', reason: 'reporting' };
}
async function event(db, device, code, at, token, msg) {
  await db.collection('device_logs').updateOne({ _id: `fleet:${device._id}:${code}:${token}` }, { $setOnInsert: {
    deviceId: String(device._id), at, receivedAt: at, level: code === 'fleet.silent' ? 'warn' : 'info', code, msg,
    source: 'server', exercise: device.meta?.exercise === true,
  } }, { upsert: true });
}
export async function recordAcceptedReport(db, device, now = new Date(), version) {
  const first = device.firstReportAt || device.lastSeen || now;
  const set = { firstReportAt: first };
  if (typeof version === 'string' && /^[A-Za-z0-9._+-]{1,64}$/.test(version)) set.firmwareVersion = version;
  // Older records retain their historical first-known receipt rather than claiming today was first.
  await db.collection('devices').updateOne({ _id: device._id, firstReportAt: { $exists: false } }, { $set: set });
  if (version && set.firmwareVersion) await db.collection('devices').updateOne({ _id: device._id }, { $set: { firmwareVersion: set.firmwareVersion } });
  if (!device.lastSeen) await event(db, device, 'fleet.first_report', now, 'first', 'First data received');
  else if (now - new Date(device.lastSeen) > silenceAfterMs(device)) await event(db, device, 'fleet.recovered', now, new Date(device.lastSeen).getTime(), 'Reporting resumed');
}
export async function recordSilentBoxes(db, devices, links, now = new Date()) {
  const linked = new Map(links.map(l => [String(l.deviceId), l]));
  for (const device of devices) {
    if (fleetStatus(device, linked.get(String(device._id)), now).reason !== 'silent') continue;
    const last = new Date(device.lastSeen);
    if (!Number.isFinite(last.getTime())) continue;
    await event(db, device, 'fleet.silent', new Date(last.getTime() + silenceAfterMs(device)), last.getTime(), 'Box has stopped reporting');
  }
}

// Called by the existing scheduled refresh as well as operator fleet reads.
export async function checkSilentFleet(db, now = new Date()) {
  const devices = await db.collection('devices').find({ disabled: { $ne: true }, 'meta.exercise': { $ne: true }, lastSeen: { $lt: new Date(now.getTime() - 15 * 60000) } }, { projection: { keyHash: 0 } }).limit(500).toArray();
  const links = await db.collection('customer_links').find({ active: true, deviceId: { $in: devices.map(d => String(d._id)) } }).toArray();
  await recordSilentBoxes(db, devices, links, now);
  return { checked: devices.length, limit: 500 };
}
