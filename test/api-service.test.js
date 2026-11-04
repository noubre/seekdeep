/**
 * The API service owns the process's single OpenAI-compatible endpoint. It always
 * forwards over the room to the host, so these tests pin the forwarding backend, the
 * requirement for a chat service, replacement of a running server, and shutdown.
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

function makeChat(t) {
  const chat = createChatService({ providers: stubProviders(), swarmFactory: () => swarm });
  t.teardown(async () => { await chat.close(); });
  return chat;
}

test('the endpoint listens on a real port and reports it', async function (t) {
  const service = createApiService({ chatService: makeChat(t), http });
  t.teardown(async () => { await service.close(); });

  const started = await service.start({ port: 0 });
  t.is(started.running, true);
  t.ok(started.port > 0, 'asked for port 0 and got a real one');
  t.is(started.auth, false);
  t.is(service.status().port, started.port);
});

test('a chat service is required: there is no local-only mode', async function (t) {
  await t.exception.all(() => createApiService({ http }), /requires a chat service/);
});

test('starting again replaces the running server and the old port is released', async function (t) {
  const service = createApiService({ chatService: makeChat(t), http });
  t.teardown(async () => { await service.close(); });

  const first = await service.start({ port: 0 });
  const second = await service.start({ port: 0 });
  t.not(first.port, second.port);
  // `t.exception` rethrows native TypeErrors, and `fetch` rejects with one, so the
  // refusal is asserted directly instead.
  const refused = await fetch(`${first.url}/models`).then(
    () => false,
    (error) => error.cause?.code === 'ECONNREFUSED'
  );
  t.ok(refused, 'the replaced server is gone');
});

test('stop() releases the port and status goes back to off', async function (t) {
  const service = createApiService({ chatService: makeChat(t), http });
  t.teardown(async () => { await service.close(); });

  const started = await service.start({ port: 0 });
  const stopped = await service.stop();
  t.is(stopped.stopped, true);
  t.is(service.status().running, false);
  const refused = await fetch(`${started.url}/models`).then(
    () => false,
    (error) => error.cause?.code === 'ECONNREFUSED'
  );
  t.ok(refused, 'the stopped server is gone');
});
