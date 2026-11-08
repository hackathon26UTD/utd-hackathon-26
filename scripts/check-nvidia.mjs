// Opt-in live smoke test; sends only a fictional constant, never household data.
import { env } from './env.mjs';
import { nemotronCompletion, nvidiaConfig } from '../src/nemotron.js';
const config = nvidiaConfig(env);
if (!config.configured) {
  console.error('NVIDIA is not configured. Add NVIDIA_API_KEY to ignored .env. Use npm run system:demo without a key.');
  process.exitCode = 1;
} else {
  try {
    const result = await nemotronCompletion(env, { messages: [
      { role: 'system', content: 'Call record_probe with status connected. Do not respond in plain text.' },
      { role: 'user', content: 'This is a synthetic Safe Home integration check.' },
    ], tools: [{ type: 'function', function: { name: 'record_probe', description: 'Record a synthetic connectivity check.',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['connected'] } }, required: ['status'], additionalProperties: false } } }] });
    const call = result.tool_calls[0];
    if (call?.function?.name !== 'record_probe' || JSON.parse(call.function.arguments).status !== 'connected') throw new Error('Model did not pass the expected tool-call check.');
    console.log(`Verified a structured tool call from ${config.model}. No household data sent.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
