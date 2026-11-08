// Only accept complete reports from the existing Uno Q sketch.
export function parseUnoReport(line) {
  if (typeof line !== 'string' || line.length > 1024) return null;
  try {
    const value = JSON.parse(line.startsWith('UNO ') ? line.slice(4) : line);
    if (value?.src !== 'unoq' || !Number.isSafeInteger(value.seq) || value.seq < 0) return null;
    if (!['water', 'flame', 'tilt'].every(k => typeof value[k] === 'boolean')) return null;
    if (!['water_raw', 'flame_raw'].every(k => Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 65535)) return null;
    return Object.fromEntries(['seq', 'water', 'water_raw', 'flame', 'flame_raw', 'tilt'].map(k => [k, value[k]]));
  } catch { return null; }
}

export function unoReadings(report, receivedAt) {
  return ['water_detected', 'water_raw', 'flame', 'flame_raw', 'tilt'].map(sensor => ({
    sensor, value: report[sensor === 'water_detected' ? 'water' : sensor], ts: receivedAt,
    meta: {source: 'unoq-usb', sourceSequence: report.seq, timestampBasis: 'host-receipt'},
  }));
}

export const POSIX_SERIAL_READER = `
import os,sys,termios,select
fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NONBLOCK|os.O_NOCTTY)
old=termios.tcgetattr(fd);a=old.copy();a[3]=0;a[4]=termios.B115200;a[5]=termios.B115200;a[6]=old[6].copy();a[6][termios.VMIN]=0;a[6][termios.VTIME]=1
termios.tcsetattr(fd,termios.TCSANOW,a);termios.tcflush(fd,termios.TCIFLUSH)
try:
 while True:
  if select.select([fd],[],[],1)[0]:
   try:
    chunk=os.read(fd,4096)
    if chunk: os.write(sys.stdout.fileno(),chunk)
   except BlockingIOError: pass
finally:
 try: termios.tcsetattr(fd,termios.TCSANOW,old)
 except: pass
 os.close(fd)
`;
