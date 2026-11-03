import test from 'brittle';
import { createChatService } from '../js/p2p/chat-service.js';
import { createP2PBackend } from '../js/openai/backends.js';
import { createHttpServer } from '../js/openai/http-server.js';
import { startLocalDht } from './helpers/local-dht.js';
import { createNoLocalProviders } from '../js/runtime/boot.js';

function hostProviders({ fail = false } = {}) {
  const chats = [];
  return {
    providers: ['ollama'],
    chats,
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'stub:1', name: 'Stub 1' }]; },
    async ask() { throw new Error('ask not used by the bridge'); },
    async chat(provider, model, params, onEvent) {
      chats.push({ provider, model, params });
      if (fail) throw new Error('provider exploded');
      onEvent?.({ type: 'text', text: 'hello ' });
      onEvent?.({ type: 'text', text: 'world' });
      onEvent?.({ type: 'tool_call', index: 0, id: 'call_77', name: 'get_time', argumentsDelta: '{"a":1}' });
      return {
        text: 'hello world',
        toolCalls: [{ index: 0, id: 'call_77', name: 'get_time', argumentsJson: '{"a":1}' }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 5, completionTokens: 7 }
      };
    }
  };
}

function peerService(bootstrap) {
  return createChatService({ providers: createNoLocalProviders(), bootstrap });
}

async function waitFor(predicate, message, timeout = 15000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function sseData(text) {
  return text.split('\n\n').filter((block) => block.startsWith('data:')).map((block) => block.slice('data:'.length).trim());
}

test('the bridge forwards a streamed chat completion through the DHT room', async function (t) {
  const dht = await startLocalDht();
  const providers = hostProviders();
  const host = createChatService({ providers, bootstrap: dht.bootstrap, now: () => 1 });
  const peer = peerService(dht.bootstrap);
  const { topic } = await host.methods['chat.create']({});
  await peer.methods['chat.join']({ topic });
  const peerEvents = [];
  peer.onEvent((event) => peerEvents.push(event));
  await waitFor(() => peerEvents.some((event) => event.type === 'peers' && event.peers.length === 1), 'peer connected');

  const server = await createHttpServer({ backend: createP2PBackend({ service: peer }), host: '127.0.0.1', port: 0, log: () => {} });
  t.teardown(async () => {
    await server.close();
    await host.close();
    await peer.close();
    await dht.stop();
  });

  const models = await (await fetch(`${server.url}/v1/models`)).json();
  t.is(models.data[0].id, 'stub:1', 'peer sees the host models');

  const response = await fetch(`${server.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', messages: [{ role: 'user', content: 'do it' }], stream: true })
  });
  t.is(response.status, 200);
  const text = await response.text();
  const lines = sseData(text);
  t.ok(text.endsWith('data: [DONE]\n\n'));
  const chunks = lines.filter((line) => line !== '[DONE]').map((line) => JSON.parse(line));
  const textDelta = chunks.flatMap((chunk) => chunk.choices[0].delta.content ? [chunk.choices[0].delta.content] : []).join('');
  t.is(textDelta, 'hello world');
  const toolDelta = chunks.flatMap((chunk) => chunk.choices[0].delta.tool_calls || []).at(0);
  t.is(toolDelta.id, 'call_77');
  t.is(toolDelta.function.name, 'get_time');
  t.is(toolDelta.function.arguments, '{"a":1}');
  t.is(chunks.at(-1).choices[0].finish_reason, 'tool_calls');

  t.is(providers.chats.length, 1);
  t.is(providers.chats[0].model, 'stub:1');
  t.is(host.methods['chat.status']().collaborative, false, 'room stays private');
});

test('a host-side chat failure surfaces as the format error event', async function (t) {
  const dht = await startLocalDht();
  const providers = hostProviders({ fail: true });
  const host = createChatService({ providers, bootstrap: dht.bootstrap, now: () => 3 });
  const peer = peerService(dht.bootstrap);
  const { topic } = await host.methods['chat.create']({});
  await peer.methods['chat.join']({ topic });
  const peerEvents = [];
  peer.onEvent((event) => peerEvents.push(event));
  await waitFor(() => peerEvents.some((event) => event.type === 'peers' && event.peers.length === 1), 'peer connected');

  const server = await createHttpServer({ backend: createP2PBackend({ service: peer }), host: '127.0.0.1', port: 0, log: () => {} });
  t.teardown(async () => {
    await server.close();
    await host.close();
    await peer.close();
    await dht.stop();
  });

  const response = await fetch(`${server.url}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub:1', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }], stream: true })
  });
  t.is(response.status, 500);
  const text = await response.text();
  t.ok(text.includes('provider exploded'));
  t.ok(peerEvents.some((event) => event.type === 'chat_response' && event.kind === 'error' && /provider exploded/.test(event.error)));
});