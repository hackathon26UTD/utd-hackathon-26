// Secret redaction for every line the CLI prints. Pure; no I/O.
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS|URI|DSN|CREDENTIAL|AUTH|COOKIE)/i;
const PATTERNS = [
  [/(Bearer\s+)[A-Za-z0-9._~+\/=-]{6,}/gi, '$1[redacted]'],
  [/(mongodb(?:\+srv)?:\/\/)[^\s"'@/]+@/gi, '$1[redacted]@'],
  [/\b(ak|dk|sk|rk)_[A-Za-z0-9_-]{8,}/g, '$1_[redacted]'],
  [/\bnvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-[redacted]'],
  [/\bre_[A-Za-z0-9_]{8,}/g, 're_[redacted]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{12,})/g, 'gh_[redacted]'],
  [/((?:x-device-key|x-data-job-key|x-api-key|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, '$1[redacted]'],
  [/([?&](?:key|token|api_key|apikey|secret)=)[^&\s"']+/gi, '$1[redacted]'],
];

/** Values in env whose names look secret and are long enough to be worth masking. */
export function secretValues(env = {}) {
  const out = new Set();
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.length >= 8 && SECRET_NAME.test(k)) out.add(v);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Build a redactor that masks known secret values plus common secret shapes. */
export function makeRedactor(env = {}, extra = []) {
  const values = [...secretValues(env), ...extra.filter((v) => typeof v === 'string' && v.length >= 8)];
  return function redact(input) {
    let s = typeof input === 'string' ? input : String(input ?? '');
    for (const v of values) if (s.includes(v)) s = s.split(v).join('[redacted]');
    for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
    return s;
  };
}

/** Deep-redact any JSON-able value (strings only; keys that look secret are masked outright). */
export function redactDeep(value, redact, depth = 0) {
  if (depth > 12) return '[deep]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /^(deviceKey|adminKey|apiKey|token|secret|password|keyHash|authorization)$/i.test(k) && typeof v === 'string' ? '[redacted]' : redactDeep(v, redact, depth + 1);
    }
    return out;
  }
  return value;
}
