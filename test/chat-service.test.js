import test from 'brittle';
import { createChatService } from '../js/p2p/chat-service.js';
import { startLocalDht } from './helpers/local-dht.js';

function stubProviders(chunks = ['a', 'b']) {
  const asks = [];
  return {
    providers: ['ollama', 'lmstudio'],
    asks,
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'stub:1', name: 'Stub 1' }]; },
    async ask(provider, model, prompt, options = {}) {
      asks.push({ provider, model, prompt });
      for (const chunk of chunks) options.onChunk?.(chunk);
      return chunks.join('');
    }
  };
}

function collect(service) {
  const events = [];
  service.onEvent((event) => events.push(event));
  return {
    events,
    of(type) { return events.filter((event) => event.type === type); }
  };
}

async function waitFor(predicate, message, timeout = 15000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('two chat services discover each other, sync mode/models, and stream a response', async function (t) {
  const dht = await startLocalDht();
  const hostProviders = stubProviders(['a', 'b']);
  const peerProviders = stubProviders();
  const host = createChatService({ providers: hostProviders, bootstrap: dht.bootstrap, now: () => 1 });
  const peer = createChatService({ providers: peerProviders, bootstrap: dht.bootstrap, now: () => 2 });
  t.teardown(async () => {
    await host.close();
    await peer.close();
    await dht.stop();
  });

  const hostEvents = collect(host);
  const peerEvents = collect(peer);

  const created = await await host.methods['chat.create']({});
  t.is(created.role, 'host');
  t.is(typeof created.topic, 'string');
  t.is(created.topic.length, 64);
  t.alike(hostEvents.of('status').at(-1), { type: 'status', initialized: true, topic: created.topic, role: 'host', connected: false, peerCount: 0, collaborative: false, provider: null });

  const joined = await peer.methods['chat.join']({ topic: created.topic });
  t.is(joined.role, 'peer');

  await waitFor(() => hostEvents.of('peers').some((event) => event.peers.length === 1), 'host sees peer');
  await waitFor(() => peerEvents.of('peers').some((event) => event.peers.length === 1), 'peer sees host');
  t.is(hostEvents.of('peers').at(-1).peers[0].role, 'peer');
  t.is(peerEvents.of('peers').at(-1).peers[0].role, 'host');

  const mode = host.methods['chat.setMode']({ collaborative: true });
  t.alike(mode, { collaborative: true });
  await waitFor(() => peerEvents.of('mode').some((event) => event.collaborative === true), 'peer receives collaborative mode');
  t.is(peerEvents.of('mode').at(-1).collaborative, true);

  const refreshed = await host.methods['chat.refreshModels']();
  t.is(refreshed.provider, 'ollama');
  t.alike(refreshed.models, [{ id: 'stub:1', name: 'Stub 1' }]);
  await waitFor(() => peerEvents.of('models').length > 0, 'peer receives models');
  t.alike(peerEvents.of('models').at(-1).models, [{ id: 'stub:1', name: 'Stub 1' }]);

  const sent = host.methods['chat.send']({ prompt: 'hi', model: 'stub:1' });
  t.is(typeof sent.requestId, 'string');

  await waitFor(() => hostEvents.of('response').some((event) => event.done), 'host stream completes');
  const hostChunks = hostEvents.of('response').filter((event) => !event.done).map((event) => event.chunk);
  t.alike(hostChunks, ['a', 'b']);
  t.alike(hostEvents.of('response').at(-1), { type: 'response', requestId: sent.requestId, chunk: '', done: true });

  await waitFor(() => peerEvents.of('response').some((event) => event.done), 'peer stream completes');
  const peerChunks = peerEvents.of('response').filter((event) => !event.done).map((event) => event.chunk);
  t.alike(peerChunks, ['a', 'b']);

  t.is(hostProviders.asks.length, 1);
  t.alike(hostProviders.asks[0], { provider: 'ollama', model: 'stub:1', prompt: 'hi' });
  t.is(peerProviders.asks.length, 0, 'peer never calls its own provider');
});

test('a non-host chat.send forwards to the host and returns a requestId', async function (t) {
  const dht = await startLocalDht();
  const hostProviders = stubProviders(['only']);
  const host = createChatService({ providers: hostProviders, bootstrap: dht.bootstrap, now: () => 5 });
  const peer = createChatService({ providers: stubProviders(), bootstrap: dht.bootstrap, now: () => 6 });
  t.teardown(async () => {
    await host.close();
    await peer.close();
    await dht.stop();
  });

  const hostEvents = collect(host);
  const peerEvents = collect(peer);
  const { topic } = await await host.methods['chat.create']({});
  await peer.methods['chat.join']({ topic });
  await waitFor(() => peerEvents.of('peers').some((event) => event.peers.length === 1), 'peer connected');

  host.methods['chat.setMode']({ collaborative: true });
  const sent = peer.methods['chat.send']({ prompt: 'from peer', model: 'stub:1' });
  t.is(typeof sent.requestId, 'string');

  await waitFor(() => peerEvents.of('response').some((event) => event.done), 'peer receives streamed response');
  t.alike(peerEvents.of('response').filter((event) => !event.done).map((event) => event.chunk), ['only']);
  t.is(hostProviders.asks.at(-1).prompt, 'from peer');
  t.ok(hostEvents.of('message').some((event) => event.message.type === 'user' && event.message.fromPeer), 'host renders the peer prompt in collaborative mode');
});

test('host-only methods reject on a peer and validate topics', async function (t) {
  const dht = await startLocalDht();
  const host = createChatService({ providers: stubProviders(), bootstrap: dht.bootstrap, now: () => 7 });
  const peer = createChatService({ providers: stubProviders(), bootstrap: dht.bootstrap, now: () => 8 });
  t.teardown(async () => {
    await host.close();
    await peer.close();
    await dht.stop();
  });

  await host.methods['chat.create']({});
  t.exception.all(() => peer.methods['chat.setMode']({ collaborative: true }), /host/i);
  t.exception.all(() => peer.methods['chat.join']({ topic: 'not-a-topic' }), /topic/i);
  await t.exception.all(() => peer.methods['chat.setProvider']({ provider: 'ollama' }), /host/i);
});