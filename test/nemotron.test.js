import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NVIDIA_MODEL, nemotronCompletion } from '../src/nemotron.js';

const messages = Object.freeze([
  Object.freeze({ role: 'system', content: 'Review recorded evidence only.' }),
  Object.freeze({ role: 'user', content: 'Check the water observation.' }),
]);
const tools = [{ type: 'function', function: { name: 'read_sensor_timeline', parameters: { type: 'object', properties: {} } } }];
const toolCall = { id: 'read-1', type: 'function', function: { name: 'read_sensor_timeline', arguments: '{}' } };
const complete = async (model, input = messages) => {
  let payload;
  const result = await nemotronCompletion({ NVIDIA_BASE_URL: 'http://localhost:8000/v1', ...(model ? { NVIDIA_MODEL: model } : {}) },
    { messages: input, tools }, async (url, init) => {
      assert.equal(url, 'http://localhost:8000/v1/chat/completions');
      payload = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: null, tool_calls: [toolCall] } }] });
    });
  assert.deepEqual(result.tool_calls, [toolCall]);
  return payload;
};

test('Nano 9B v2 tool requests disable reasoning without mutating the investigation history', async () => {
  for (const model of ['nvidia/NVIDIA-Nemotron-Nano-9B-v2', 'nvidia/nvidia-nemotron-nano-9b-v2']) {
    const payload = await complete(model);
    assert.equal(payload.messages[0].content, 'Review recorded evidence only.\n/no_think');
    assert.deepEqual(payload.messages[1], messages[1]);
    assert.equal(messages[0].content, 'Review recorded evidence only.');
    assert.deepEqual(payload.tools, tools);
    assert.equal(payload.tool_choice, 'auto');
    assert.equal(payload.stream, false);
    assert.equal(payload.max_tokens, 1200);
  }
  const payload = await complete('nvidia/NVIDIA-Nemotron-Nano-9B-v2', messages.slice(1));
  assert.deepEqual(payload.messages, [{ role: 'system', content: '/no_think' }, messages[1]]);
});

test('49B defaults and other model families retain their original prompts and template controls', async () => {
  for (const model of [undefined, DEFAULT_NVIDIA_MODEL, 'nvidia/NVIDIA-Nemotron-Nano-9B-v2-FP8', 'nvidia/nemotron-nano-12b-v2-vl']) {
    const payload = await complete(model);
    assert.equal(payload.model, model || DEFAULT_NVIDIA_MODEL);
    assert.deepEqual(payload.messages, messages);
    assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
  }
});
