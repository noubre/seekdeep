/**
 * The host GPU is one shared resource: a peer that floods `query` frames must be cut
 * off before the model runs, with a terminal error frame so it can stop waiting.
 */
import test from 'brittle';
import b4a from 'b4a';
import { createChatService } from '../js/p2p/chat-service.js';
import { parsePeerMessage } from '../js/p2p/protocol.js';

const FRAME_LIMIT = 4 * 1024 * 1024;

function stubProviders() {
  const asks = [];
  return {
    providers: ['ollama'],
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'stub:1', name: 'Stub 1' }]; },
    async ask(provider, model, prompt) {
      asks.push(prompt);
      return 'ok';
    },
    async chat() { return { text: '', toolCalls: [], finishReason: 'stop', usage: {} }; },
    asks
  };
}

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
    destroy() {
      this.destroyed = true;
      // A real socket emits 'close' when it is destroyed.
      if (typeof listeners.close === 'function') listeners.close();
    },
    send(message) { listeners.data(b4a.from(JSON.stringify(message))); }
  };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('the sixth prompt from one peer inside the window never reaches the model', async function (t) {
  const swarm = fakeSwarm();
  const providers = stubProviders();
  const service = createChatService({
    providers,
    swarmFactory: () => swarm,
    now: () => 1,
    maxPeerPrompts: 5,
    peerPromptWindowMs: 60000
  });
  const events = [];
  service.onEvent((event) => events.push(event));
  t.teardown(async () => { await service.close(); });

  await service.methods['chat.create']({});
  const peer = fakeConn('ab'.repeat(32));
  swarm.connect(peer);
  peer.send({ type: 'handshake', clientId: 'peer', displayName: 'Peer', timestamp: 1, isHost: false });

  for (let i = 0; i < 5; i += 1) {
    peer.send({ type: 'query', model: 'stub:1', prompt: `prompt-${i}`, requestId: `r${i}` });
  }
  await settle();

  t.is(providers.asks.length, 5, 'the first five prompts ran');
  t.is(providers.asks.join(','), 'prompt-0,prompt-1,prompt-2,prompt-3,prompt-4');

  peer.send({ type: 'query', model: 'stub:1', prompt: 'prompt-5', requestId: 'r5' });
  await settle();

  t.is(providers.asks.length, 5, 'the sixth prompt never reached the model');
  t.ok(
    events.some((event) => event.type === 'message' && event.message.content === 'Peer abababab is sending requests too quickly.'),
    'a system line names the flooding peer'
  );

  const errorFrame = peer.written.find((frame) => frame.type === 'response' && frame.requestId === 'r5');
  t.ok(errorFrame, 'a terminal frame went back to the peer');
  t.is(errorFrame.error, 'Rate limited by host. Try again shortly.');
  t.is(errorFrame.isComplete, true);
  t.is(errorFrame.data, '');
  t.is(errorFrame.isPrivate, true);
});

test('pruned stamps free the budget again after the window', async function (t) {
  const swarm = fakeSwarm();
  const providers = stubProviders();
  let clock = 0;
  const service = createChatService({
    providers,
    swarmFactory: () => swarm,
    now: () => clock,
    maxPeerPrompts: 2,
    peerPromptWindowMs: 1000
  });
  t.teardown(async () => { await service.close(); });

  await service.methods['chat.create']({});
  const peer = fakeConn('cd'.repeat(32));
  swarm.connect(peer);
  peer.send({ type: 'handshake', clientId: 'peer', displayName: 'Peer', timestamp: 0, isHost: false });

  peer.send({ type: 'query', model: 'stub:1', prompt: 'a', requestId: 'r1' });
  peer.send({ type: 'query', model: 'stub:1', prompt: 'b', requestId: 'r2' });
  peer.send({ type: 'query', model: 'stub:1', prompt: 'c', requestId: 'r3' });
  await settle();
  t.is(providers.asks.length, 2, 'third prompt inside the window is refused');

  clock = 2000; // both stamps are now outside the 1000ms window
  peer.send({ type: 'query', model: 'stub:1', prompt: 'd', requestId: 'r4' });
  await settle();
  t.is(providers.asks.length, 3, 'the window sliding forward admits new prompts');
});

test('a closed peer frees its budget for a new peer and a reconnect', async function (t) {
  const swarm = fakeSwarm();
  const providers = stubProviders();
  const service = createChatService({
    providers,
    swarmFactory: () => swarm,
    now: () => 1,
    maxPeerPrompts: 5,
    peerPromptWindowMs: 60000
  });
  t.teardown(async () => { await service.close(); });

  await service.methods['chat.create']({});
  const flooder = fakeConn('ab'.repeat(32));
  swarm.connect(flooder);
  flooder.send({ type: 'handshake', clientId: 'peer', displayName: 'Peer', timestamp: 1, isHost: false });
  for (let i = 0; i < 5; i += 1) {
    flooder.send({ type: 'query', model: 'stub:1', prompt: `flood-${i}`, requestId: `f${i}` });
  }
  await settle();
  t.is(providers.asks.length, 5, 'the flooder used its whole window');

  flooder.send({ type: 'query', model: 'stub:1', prompt: 'flood-5', requestId: 'f5' });
  await settle();
  t.is(providers.asks.length, 5, 'still capped while the connection is alive');

  flooder.destroy();
  await settle();

  const newcomer = fakeConn('cd'.repeat(32));
  swarm.connect(newcomer);
  newcomer.send({ type: 'handshake', clientId: 'peer', displayName: 'Newcomer', timestamp: 1, isHost: false });
  for (let i = 0; i < 5; i += 1) {
    newcomer.send({ type: 'query', model: 'stub:1', prompt: `new-${i}`, requestId: `n${i}` });
  }
  await settle();
  t.is(providers.asks.length, 10, 'after the flooder closed, a new peer is admitted five times');

  // Same peer id, new connection: the closed id must not keep its stamps, or a
  // reconnecting peer would stay locked out for the rest of the window.
  const reconnector = fakeConn('ab'.repeat(32));
  swarm.connect(reconnector);
  reconnector.send({ type: 'handshake', clientId: 'peer', displayName: 'Peer', timestamp: 1, isHost: false });
  for (let i = 0; i < 5; i += 1) {
    reconnector.send({ type: 'query', model: 'stub:1', prompt: `re-${i}`, requestId: `r${i}` });
  }
  await settle();
  t.is(providers.asks.length, 15, 'the reconnecting peer id starts a fresh window');
});
