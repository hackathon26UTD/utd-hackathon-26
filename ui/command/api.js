// Thin fetch wrapper. Never throws: callers read {ok,status,data,error}. Status 0 means the network failed.
// Operators can open /command-center?mode=exercise to work with simulator and drill data (kept apart from live data on the server).
export const exerciseMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'exercise';
export function withMode(url) {
  if (!exerciseMode) return url;
  const add = (k, v) => url + (url.includes('?') ? '&' : '?') + k + '=' + v;
  if (/^\/api\/(ops|risk)(\/|\?|$)/.test(url)) return add('mode', 'exercise');
  if (url.startsWith('/api/overlays?layer=zones')) return add('exercise', '1');
  return url;
}
export async function api(url, { method = 'GET', body, signal } = {}) {
  try {
    const r = await fetch(withMode(url), {
      method, signal, cache: 'no-store', credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await r.json(); } catch { /* empty or non-JSON body */ }
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : data?.error || null };
  } catch {
    return { ok: false, status: 0, data: null, error: null };
  }
}
