import test from 'brittle';
import { dispatchSlashTag } from '../js/slash/registry.js';
import { createSwarmService, swarmService } from '../js/slash/services/swarm.js';
import {
  initializeSwarm,
  initializeNewChat,
  joinExistingChat,
  leaveExistingChat,
  getTopicHex,
  getConnections
} from '../js/network/hyperswarm.js';
import { clearChatHistory, getChatHistory } from '../js/messages/history.js';
import { isSessionHost } from '../js/session/modes.js';

const TOPIC = 'ab'.repeat(32);

function fakeNetwork(joinBehavior = () => ({ destroy() {} })) {
  const calls = [];
  const discoveries = [];
  const handlers = new Map();
  return {
    calls,
    discoveries,
    keyPair: { publicKey: new Uint8Array(32) },
    on(event, handler) {
      calls.push(['on', event]);
      handlers.set(event, handler);
    },
    emit(event, value) { handlers.get(event)?.(value); },
    join(topic) {
      calls.push(['join', Buffer.from(topic).toString('hex')]);
      const result = joinBehavior(topic, discoveries.length);
      if (result) discoveries.push(result);
      return result;
    },
    leave(topic) { calls.push(['leave', Buffer.from(topic).toString('hex')]); }
  };
}

function collector() {
  const output = [];
  return {
    output,
    ctx: {
      emitEphemeral(content, metadata) {
        output.push({ content, metadata });
      }
    }
  };
}

function fakeSwarm(overrides = {}) {
  const calls = [];
  let state = {
    initialized: true,
    topic: TOPIC,
    role: 'host',
    connected: true,
    peerCount: 1
  };
  const service = {
    calls,
    status() {
      calls.push(['status']);
      return { ...state };
    },
    create() {
      calls.push(['create']);
      state = { initialized: true, topic: TOPIC, role: 'host', connected: false, peerCount: 0 };
      return { ...state };
    },
    join(topic) {
      calls.push(['join', topic]);
      state = { initialized: true, topic, role: 'joiner', connected: false, peerCount: 0 };
      return { ...state };
    },
    leave() {
      calls.push(['leave']);
      state = { initialized: true, topic: null, role: 'none', connected: false, peerCount: 0 };
      return { ...state };
    },
    peers() {
      calls.push(['peers']);
      return [{ id: '01234567…', displayName: 'Peer One', role: 'host' }];
    },
    ...overrides
  };
  return service;
}

async function dispatch(input, swarm = fakeSwarm()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { swarm });
  return { ...result, swarm };
}

test('/swarm defaults to status and reports honest inactive state', async function (t) {
  const swarm = fakeSwarm({
    status() {
      this.calls.push(['status']);
      return { initialized: false, topic: null, role: 'none', connected: false, peerCount: 0 };
    }
  });
  const bare = await dispatch('/swarm', swarm);
  const explicit = await dispatch('/swarm status', swarm);

  t.ok(bare.output[0].content.includes('not initialized'));
  t.alike(bare.output[0].metadata, {
    kind: 'slash-swarm', command: 'swarm', action: 'status', initialized: false,
    active: false, role: 'none', connected: false, peerCount: 0
  });
  t.alike(explicit.output[0], bare.output[0], 'explicit status matches the default');
  t.alike(swarm.calls, [['status'], ['status']]);
});

test('/swarm lifecycle commands invoke only the requested capability', async function (t) {
  for (const [input, expectedCall, action] of [
    ['/swarm create', ['create'], 'create'],
    [`/swarm join ${TOPIC}`, ['join', TOPIC], 'join'],
    ['/swarm leave', ['leave'], 'leave']
  ]) {
    const { output, swarm } = await dispatch(input);
    t.alike(swarm.calls, [expectedCall], `${input} performs one lifecycle operation`);
    t.is(output.length, 1);
    t.is(output[0].metadata.action, action);
    t.is(JSON.stringify(output[0]).includes(TOPIC), action !== 'leave', 'topic appears only in the local lifecycle result when active');
    t.alike(JSON.parse(JSON.stringify(output[0])), output[0], 'result is JSON-safe');
  }
});

test('/swarm join validates exactly one strict 64-character hex topic before service access', async function (t) {
  for (const input of [
    '/swarm join',
    '/swarm join abc',
    `/swarm join ${'g'.repeat(64)}`,
    `/swarm join ${TOPIC} extra`
  ]) {
    const { output, swarm } = await dispatch(input);
    t.alike(swarm.calls, [], `${input} does not reach the service`);
    t.is(output[0].metadata.kind, 'slash-error');
    t.ok(output[0].content.includes('64-character hexadecimal'));
  }
});

test('/swarm rejects unknown subcommands and extra arguments without service effects', async function (t) {
  for (const input of ['/swarm nope', '/swarm status extra', '/swarm create extra', '/swarm leave extra', '/swarm peers extra']) {
    const { output, swarm } = await dispatch(input);
    t.alike(swarm.calls, []);
    t.is(output[0].metadata.kind, 'slash-error');
    t.is(output.length, 1);
  }
});

test('/swarm peers returns only display names, roles, and truncated identifiers', async function (t) {
  const { output, swarm } = await dispatch('/swarm peers');

  t.alike(swarm.calls, [['peers']]);
  t.ok(output[0].content.includes('Peer One'));
  t.ok(output[0].content.includes('01234567…'));
  t.absent(output[0].content.includes('0123456789'));
  t.alike(output[0].metadata.peers, [{ id: '01234567…', displayName: 'Peer One', role: 'host' }]);
});

test('/swarm service errors are caught by dispatch and remain local', async function (t) {
  const swarm = fakeSwarm({ create() { throw new Error('network unavailable'); } });
  const { output } = await dispatch('/swarm create', swarm);

  t.alike(output, [{
    content: 'Slash command error: network unavailable',
    metadata: { kind: 'slash-error', command: 'swarm' }
  }]);
});

test('swarm service adapter reports state without touching the public network', function (t) {
  const calls = [];
  const peers = new Map([
    ['0123456789abcdef', { displayName: 'Alice', isHost: true, clientId: 'secret-client-key', colorClass: 'secret-style' }],
    ['fedcba9876543210', { displayName: 'Bob', isServer: false, privateKey: 'must-not-leak' }]
  ]);
  const service = createSwarmService({
    initializeNewChat(options) { calls.push(['create', options]); },
    joinExistingChat(topic, options) { calls.push(['join', topic, options]); return true; },
    leaveExistingChat() { calls.push(['leave']); },
    isSwarmInitialized: () => true,
    getTopicHex: () => TOPIC,
    isConnectedToPeers: () => true,
    isSessionHost: () => true,
    getActivePeers: () => peers
  });

  t.alike(service.status(), {
    initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2
  });
  t.alike(service.peers(), [
    { id: '01234567…', displayName: 'Alice', role: 'host' },
    { id: 'fedcba98…', displayName: 'Bob', role: 'peer' }
  ]);
  t.alike(calls, [], 'read helpers cause no lifecycle operations');
  t.alike(service.create(), {
    initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2
  });
  t.alike(service.join(TOPIC), {
    initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2
  });
  t.alike(service.leave(), {
    initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2
  });
  t.alike(calls, [
    ['create', { announce: false, notify: true }],
    ['join', TOPIC, { announce: false, notify: true }],
    ['leave']
  ], 'slash lifecycle requests local state notification without legacy history output');
});

test('swarm adapter is honest when uninitialized and converts failed joins to errors', function (t) {
  const uninitialized = createSwarmService({
    initializeNewChat() {}, joinExistingChat: () => true, leaveExistingChat() {},
    isSwarmInitialized: () => false,
    getTopicHex: () => null,
    isConnectedToPeers: () => false,
    isSessionHost: () => false,
    getActivePeers: () => new Map()
  });
  t.alike(uninitialized.status(), {
    initialized: false, topic: null, role: 'none', connected: false, peerCount: 0
  });

  const failed = createSwarmService({
    initializeNewChat() {}, joinExistingChat: () => false, leaveExistingChat() {},
    isSwarmInitialized: () => true,
    getTopicHex: () => null,
    isConnectedToPeers: () => false,
    isSessionHost: () => false,
    getActivePeers: () => new Map()
  });
  t.exception(() => failed.join(TOPIC), /Failed to join swarm topic/);
});

test('real slash lifecycle notifies local state without history or peer output', async function (t) {
  const originalDocument = globalThis.document;
  const eventTarget = new EventTarget();
  globalThis.document = eventTarget;
  t.teardown(() => {
    leaveExistingChat({ announce: false, notify: false });
    clearChatHistory();
    globalThis.document = originalDocument;
  });

  const network = fakeNetwork();
  initializeSwarm({ swarmFactory: () => network });
  clearChatHistory();
  const observedTopics = [];
  eventTarget.addEventListener('swarmTopicChanged', () => {
    observedTopics.push(getTopicHex());
  });

  const created = await dispatch('/swarm create', swarmService);
  const createdTopic = created.output[0].metadata.topic;
  const joined = await dispatch(`/swarm join ${TOPIC}`, swarmService);

  t.alike(observedTopics, [createdTopic, TOPIC], 'slash create/join each publish the completed local topic transition');
  t.is(getChatHistory().length, 0, 'slash create/join add no legacy history');
  t.is(getTopicHex(), TOPIC, 'the requested room remains active locally');
  t.is(network.calls.filter((call) => call[0] === 'join').length, 2, 'only lifecycle joins are sent to the network');
  t.absent(network.calls.some((call) => JSON.stringify(call).includes('/swarm')), 'slash text and output are never sent to peers');
  t.is(joined.output.length, 1, 'slash output remains a single local ephemeral result');

  initializeNewChat();
  t.is(observedTopics.length, 3, 'ordinary create still dispatches the lifecycle event');
  t.is(getChatHistory().length, 1, 'ordinary create still records legacy history');
  t.is(joinExistingChat(TOPIC), true);
  t.is(observedTopics.length, 4, 'ordinary join still dispatches the lifecycle event');
  t.is(getChatHistory().length, 2, 'ordinary join still records legacy history');
});

test('failed room transitions tear down the prior room and roll back all new state', function (t) {
  const originalDocument = globalThis.document;
  globalThis.document = new EventTarget();
  t.teardown(() => {
    leaveExistingChat({ announce: false });
    clearChatHistory();
    globalThis.document = originalDocument;
  });

  let destroyed = 0;
  let connectionDestroyed = 0;
  const connectionHandlers = new Map();
  const partialConnection = {
    remotePublicKey: new Uint8Array(32).fill(7),
    on(event, handler) { connectionHandlers.set(event, handler); },
    write() {},
    destroy() { connectionDestroyed += 1; }
  };
  let network;
  network = fakeNetwork((topic, attempt) => {
    if (attempt === 0) return { destroy() { destroyed += 1; } };
    network.emit('connection', partialConnection);
    throw new Error('injected join failure');
  });
  initializeSwarm({ swarmFactory: () => network });
  t.is(initializeNewChat({ announce: false }), true);
  const priorTopic = getTopicHex();
  t.is(isSessionHost(), true);

  t.is(joinExistingChat(TOPIC, { announce: false }), false);
  t.is(destroyed, 1, 'prior discovery handle is destroyed exactly once');
  t.is(getTopicHex(), null, 'failed target is not shown as active');
  t.is(isSessionHost(), false, 'failed target has no stale host/joiner mode');
  t.alike(getConnections(), [], 'failed target retains no connections');
  t.is(connectionDestroyed, 1, 'connection created during the failed transition is destroyed');
  t.absent(network.calls.some((call) => call[0] === 'leave' && call[1] === priorTopic), 'destroying discovery avoids duplicate prior leave');
  t.ok(network.calls.some((call) => call[0] === 'leave' && call[1] === TOPIC), 'partially joined target was left');
});

test('a falsy discovery result rolls create back and surfaces a slash error', async function (t) {
  const originalDocument = globalThis.document;
  globalThis.document = new EventTarget();
  t.teardown(() => {
    leaveExistingChat({ announce: false });
    globalThis.document = originalDocument;
  });

  const network = fakeNetwork(() => null);
  initializeSwarm({ swarmFactory: () => network });
  const result = await dispatch('/swarm create', swarmService);

  t.is(result.output[0].metadata.kind, 'slash-error');
  t.is(getTopicHex(), null);
  t.is(isSessionHost(), false);
  t.alike(getConnections(), []);
});

test('swarm peer output sanitizes hostile names and caps abusive lists', function (t) {
  const peers = new Map([
    ['newline-peer-identifier', { displayName: 'Alice\nHost' }],
    ['control-peer-identifier', { displayName: '\u0000Bob\u001b[31m\u202e\t Admin' }],
    ['blank-peer-identifier', { displayName: '\n\u0000\t' }],
    ['huge-peer-identifier', { displayName: `  ${'x'.repeat(200)}  ` }]
  ]);
  for (let index = 0; index < 100; index += 1) {
    peers.set(`peer-${String(index).padStart(4, '0')}-private-suffix`, { displayName: `Peer ${index}` });
  }

  const service = createSwarmService({
    initializeNewChat() {}, joinExistingChat: () => true, leaveExistingChat() {},
    isSwarmInitialized: () => true,
    getTopicHex: () => TOPIC,
    isConnectedToPeers: () => true,
    isSessionHost: () => false,
    getActivePeers: () => peers
  });
  const sanitized = service.peers();

  t.is(sanitized.length, 50, 'peer list is bounded');
  t.is(sanitized[0].displayName, 'Alice Host', 'newlines cannot spoof rows');
  t.is(sanitized[1].displayName, 'Bob [31m Admin', 'controls are removed and whitespace collapses');
  t.is(sanitized[2].displayName, 'Peer blank-pe…', 'blank hostile names receive a safe fallback');
  t.is(sanitized[3].displayName.length, 64, 'display names are capped');
  t.ok(sanitized.every((peer) => !/[\u0000-\u001f\u007f]/.test(peer.displayName)));
  t.ok(sanitized.every((peer) => peer.id.length <= 9), 'identifiers stay truncated');

  const output = collector();
  return dispatchSlashTag('/swarm peers', output.ctx, { swarm: service }).then(() => {
    t.is(output.output[0].metadata.peerCount, 50);
    t.is(output.output[0].metadata.peers.length, 50);
    t.is(output.output[0].content.split('\n').length, 51, 'rendered output has a bounded number of rows');
    t.alike(JSON.parse(JSON.stringify(output.output[0])), output.output[0], 'bounded peer output remains JSON-safe');
  });
});
