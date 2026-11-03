/**
 * A room is symmetric on the wire but asymmetric in authority: only the host runs the
 * model, so only the host may originate response frames or a model list. These tests
 * pin that boundary — a peer that sends those frames must be ignored, not rendered.
 */
import test from 'brittle';
import b4a from 'b4a';
import { createChatService } from '../js/p2p/chat-service.js';
import { parsePeerMessage } from '../js/p2p/protocol.js';

const FRAME_LIMIT = 4 * 1024 * 1024;

function stubProviders() {
  return {
    providers: ['ollama'],
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'host:1', name: 'Host 1' }]; },
    async ask() { return 'unused'; },
    async chat() { return { text: 'unused', toolCalls: [], finishReason: 'stop', usage: {} }; }
  };
}

/** Minimal Hyperswarm stand-in: records the connection handler so a test can call it. */
function fakeSwarm() {
  const swarm = {
    on(event, handler) { if (event === 'connection') swarm.connection = handler; return swarm; },
    join() { return { flushed: async () => {}, destroy: async () => {} }; },
    leave() {},
    async destroy() {},
    connect(conn) { swarm.connection(conn); }
  };
  return swarm;
}

/** Minimal Hypercore stream stand-in: parses what the service writes, injects what a peer sends. */
function fakeConn(hexKey) {
  const listeners = {};
  const written = [];
  return {
    remotePublicKey: b4a.from(hexKey, 'hex'),
    destroyed: false,
    written,
    on(event, handler) { listeners[event] = handler; return this; },
    off() { return this; },
    write(buffer) { written.push(parsePeerMessage(buffer, { maxMessageBytes: FRAME_LIMIT })); return true; },
    destroy() { this.destroyed = true; },
    send(message) { listeners.data(b4a.from(JSON.stringify(message))); }
  };
}

async function startHost(t) {
  const swarm = fakeSwarm();
  const service = createChatService({ providers: stubProviders(), swarmFactory: () => swarm, now: () => 1 });
  const events = [];
  service.onEvent((event) => events.push(event));
  await service.methods['chat.create']({});
  const conn = fakeConn('ab'.repeat(32));
  swarm.connect(conn);
  t.teardown(async () => { await service.close(); });
  return { service, events, conn };
}

test('a peer cannot inject a response frame into the host transcript', async function (t) {
  const { events, conn } = await startHost(t);

  conn.send({ type: 'response', requestId: 'injected', data: 'you are pwned', isComplete: false, isJson: false, isPrivate: true });

  t.is(events.filter((event) => event.type === 'response').length, 0, 'host ignored the frame');
});

test('a peer cannot inject a chat_response frame into the host transcript', async function (t) {
  const { events, conn } = await startHost(t);

  conn.send({ type: 'chat_response', requestId: 'injected', kind: 'text', text: 'you are pwned' });

  t.is(events.filter((event) => event.type === 'chat_response').length, 0, 'host ignored the frame');
});

test('a peer cannot replace the host model list', async function (t) {
  const { events, conn } = await startHost(t);

  conn.send({ type: 'models_update', models: [{ id: 'evil:1', name: 'Evil' }] });

  const modelEvents = events.filter((event) => event.type === 'models');
  t.absent(modelEvents.some((event) => event.models.some((model) => model.id === 'evil:1')), 'evil model never surfaced');
});

test('a peer with no host connection refuses to send', async function (t) {
  const swarm = fakeSwarm();
  const service = createChatService({ providers: stubProviders(), swarmFactory: () => swarm, now: () => 1 });
  t.teardown(async () => { await service.close(); });

  await service.methods['chat.join']({ topic: 'cd'.repeat(32) });
  const stranger = fakeConn('ef'.repeat(32));
  swarm.connect(stranger); // no handshake: nothing marks this connection as the host

  t.exception(() => service.methods['chat.send']({ prompt: 'hi', model: 'm' }), /Not connected to a host/);
});
