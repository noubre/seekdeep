/**
 * The API service owns the process's single OpenAI-compatible endpoint. These tests
 * pin the two modes (this machine's providers vs the room's host), replacement of a
 * running server, and rejection of unknown modes.
 */
import test from 'brittle';
import http from 'node:http';
import { createApiService } from '../js/openai/api-service.js';
import { createChatService } from '../js/p2p/chat-service.js';

function stubProviders() {
  return {
    providers: ['ollama'],
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'stub:1', name: 'Stub 1' }]; },
    async ask() { return 'unused'; },
    async chat() { return { text: 'hi', toolCalls: [], finishReason: 'stop', usage: {} }; }
  };
}

const swarm = { on() {}, join() { return { flushed: async () => {}, destroy: async () => {} }; }, leave() {}, async destroy() {} };

test('server mode serves models from the local providers', async function (t) {
  const service = createApiService({ providers: stubProviders(), http });
  t.teardown(async () => { await service.close(); });

  const started = await service.start({ mode: 'server', port: 0 });
  t.is(started.mode, 'server');
  t.is(started.running, true);
  t.ok(started.port > 0, 'asked for port 0 and got a real one');

  const body = await fetch(`${started.url}/models`).then((r) => r.json());
  t.is(body.data[0].id, 'stub:1');
});

test('bridge mode forwards through the chat service', async function (t) {
  const chat = createChatService({ providers: stubProviders(), swarmFactory: () => swarm });
  t.teardown(async () => { await chat.close(); });
  const service = createApiService({ providers: stubProviders(), chatService: chat, http });
  t.teardown(async () => { await service.close(); });

  const started = await service.start({ mode: 'bridge', port: 0 });
  t.is(started.mode, 'bridge');
});

test('starting again replaces the running server and the old port is released', async function (t) {
  const service = createApiService({ providers: stubProviders(), http });
  t.teardown(async () => { await service.close(); });

  const first = await service.start({ mode: 'server', port: 0 });
  const second = await service.start({ mode: 'server', port: 0 });
  t.not(first.port, second.port);
  // `t.exception` rethrows native TypeErrors, and `fetch` rejects with one, so the
  // refusal is asserted directly instead.
  const refused = await fetch(`${first.url}/models`).then(
    () => false,
    (error) => error.cause?.code === 'ECONNREFUSED'
  );
  t.ok(refused, 'the replaced server is gone');
});

test('an unknown mode is rejected', async function (t) {
  const service = createApiService({ providers: stubProviders(), http });
  t.teardown(async () => { await service.close(); });
  // `t.exception` rethrows native TypeErrors, so the looser `exception.all` is used.
  await t.exception.all(async () => { await service.start({ mode: 'relay', port: 0 }); }, /server.*bridge/);
  t.is(service.status().running, false);
});
