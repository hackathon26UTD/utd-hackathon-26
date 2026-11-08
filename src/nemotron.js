import { HttpError } from './http.js';

export const DEFAULT_NVIDIA_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
export function nvidiaConfig(env) {
  return { configured: Boolean(env.NVIDIA_API_KEY || env.NVIDIA_BASE_URL), model: env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
    verified: false, verification: 'Configuration alone does not prove a successful model call.' };
}

/** Bounded, server-only NIM adapter. Never expose upstream bodies (may contain request data). */
export async function nemotronCompletion(env, { messages, tools, signal }, fetcher = fetch) {
  if (!nvidiaConfig(env).configured) throw new HttpError(503, 'NVIDIA is not configured. Add NVIDIA_API_KEY to the server secret store.');
  const base = new URL(env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new HttpError(503, 'NVIDIA endpoint must use HTTPS (except local development).');
  }
  if (base.username || base.password || base.search || base.hash) throw new HttpError(503, 'Invalid NVIDIA endpoint configuration.');
  let response;
  try {
    response = await fetcher(base.href.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal || AbortSignal.timeout(45_000), AbortSignal.timeout(20_000)]),
      headers: { 'Content-Type': 'application/json', ...(env.NVIDIA_API_KEY ? { Authorization: `Bearer ${env.NVIDIA_API_KEY}` } : {}) },
      body: JSON.stringify({ model: env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL, messages, tools, tool_choice: 'auto',
        temperature: 0, max_tokens: 1200, stream: false, chat_template_kwargs: { enable_thinking: false } }),
    });
  } catch { throw new HttpError(502, 'NVIDIA request failed or timed out. Local recording and deterministic policies are unaffected.'); }
  if (!response.ok) throw new HttpError(502, `NVIDIA returned HTTP ${response.status}. No review checkpoint was committed.`);
  const text = await response.text();
  if (text.length > 100_000) throw new HttpError(502, 'NVIDIA response exceeded the size limit.');
  try {
    const message = JSON.parse(text)?.choices?.[0]?.message;
    if (!message || !Array.isArray(message.tool_calls) || !message.tool_calls.length) throw new Error();
    return { role: 'assistant', content: null, tool_calls: message.tool_calls };
  } catch { throw new HttpError(502, 'NVIDIA did not return structured tool calls. Check model/tool-calling support.'); }
}
