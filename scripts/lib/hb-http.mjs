// HTTP client for the HomeBeacon API. Keys come from env by name and are never printed.
import { HbError, EXIT } from './hb-errors.mjs';

export const PRODUCTION_SITE = 'https://utd-hackathon-26.pages.dev';
export const LOCAL_SITE = 'http://127.0.0.1:8788';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function siteFromFlags(flags = {}, env = {}) {
  let raw = flags.local ? LOCAL_SITE : typeof flags.site === 'string' ? flags.site : env.HB_SITE || PRODUCTION_SITE;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return raw.replace(/\/+$/, '');
}

export const isLocalSite = (site) => LOCAL_HOSTS.has(new URL(site).hostname);

export function adminKeyFor(site, env) {
  if (isLocalSite(site)) return env.HB_LOCAL_ADMIN_KEY || 'ak_local_dev_only';
  return env.API_ADMIN_KEY || '';
}

export function createApi({ site, env, fetchImpl, redact }) {
  async function api(path, { method = 'GET', body, auth = 'none', headers = {}, timeoutMs = 15000, query } = {}) {
    const url = new URL(site + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const h = { Accept: 'application/json', ...headers };
    if (auth !== 'none' && !LOCAL_HOSTS.has(url.hostname) && url.protocol !== 'https:') {
      throw new HbError('Refusing to send credentials over plain http to a non-local host.', EXIT.USAGE);
    }
    if (auth === 'admin') {
      const key = adminKeyFor(site, env);
      if (!key) throw new HbError('API_ADMIN_KEY is not set. Add it to .env (never paste it into commands).', EXIT.AUTH);
      h.Authorization = `Bearer ${key}`;
    } else if (auth === 'job') {
      if (!env.DATA_JOB_TOKEN) throw new HbError('DATA_JOB_TOKEN is not set. Add it to .env, or use --admin to refresh with the admin key.', EXIT.AUTH);
      h['X-Data-Job-Key'] = env.DATA_JOB_TOKEN;
      h['X-Data-Trigger'] = 'manual';
    }
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch (e) {
      const reason = e?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : e?.cause?.code || e?.message || 'network error';
      throw new HbError(redact(`Could not reach ${url.origin}${url.pathname}: ${reason}`), EXIT.NETWORK);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: redact(text.slice(0, 300)) }; }
    return { ok: res.ok, status: res.status, data, ms: Date.now() - started, url: url.origin + url.pathname };
  }
  /** Like api() but throws a friendly HbError for non-2xx responses. */
  api.ok = async (path, opts = {}) => {
    const r = await api(path, opts);
    if (r.ok) return r;
    const msg = r.data?.error || r.data?.message || `HTTP ${r.status}`;
    const code = r.status === 401 || r.status === 403 ? EXIT.AUTH : r.status >= 500 ? EXIT.NETWORK : EXIT.FAIL;
    throw new HbError(redact(`${opts.method || 'GET'} ${path}: ${msg} (HTTP ${r.status})`), code);
  };
  return api;
}
