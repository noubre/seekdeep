import test from 'brittle';
import { dispatchSlashTag } from '../js/slash/registry.js';
import { createSwarmService } from '../js/slash/services/swarm.js';

const TOPIC = 'ab'.repeat(32);

function fakeSwarm(overrides = {}) {
  const calls = [];
  let state = { initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 1 };
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
      state = { initialized: true, topic, role: 'peer', connected: false, peerCount: 0 };
      return { ...state };
    },
    leave() {
      calls.push(['leave']);
      state = { initialized: false, topic: null, role: 'none', connected: false, peerCount: 0 };
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

function collector() {
  const output = [];
  return {
    output,
    ctx: { emitEphemeral(content, metadata) { output.push({ content, metadata }); } }
  };
}

async function dispatch(input, swarm = fakeSwarm()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { swarm });
  return { ...result, swarm };
}

function fakeClient(handlers) {
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push([method, params]);
      const handler = handlers[method];
      if (handler === undefined) throw new Error(`unexpected ${method}`);
      return typeof handler === 'function' ? handler(params) : handler;
    }
  };
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

test('swarm service adapter maps worker RPC state and peers', async function (t) {
  const client = fakeClient({
    'chat.status': { initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2, publicKey: 'ab'.repeat(32) },
    'chat.create': { topic: TOPIC, role: 'host' },
    'chat.join': { topic: TOPIC, role: 'peer' },
    'chat.leave': { topic: null, role: 'none' },
    'chat.peers': { peers: [{ id: '0123456789abcdef', displayName: 'Alice', role: 'host' }, { id: 'fedcba9876543210', displayName: 'Bob', role: 'peer' }] }
  });
  const service = createSwarmService(client);

  t.alike(await service.status(), { initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2 });
  t.alike(await service.peers(), [
    { id: '01234567…', displayName: 'Alice', role: 'host' },
    { id: 'fedcba98…', displayName: 'Bob', role: 'peer' }
  ]);
  t.alike(await service.create(), { initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2 });
  t.alike(await service.leave(), { initialized: true, topic: TOPIC, role: 'host', connected: true, peerCount: 2 });
  t.alike(client.calls.map((call) => call[0]), ['chat.status', 'chat.peers', 'chat.create', 'chat.status', 'chat.leave', 'chat.status']);
});

test('swarm adapter is honest when uninitialized and treats failed joins as errors', async function (t) {
  const uninitialized = createSwarmService(fakeClient({
    'chat.status': { initialized: false, topic: null, role: 'none', connected: false, peerCount: 0 }
  }));
  t.alike(await uninitialized.status(), { initialized: false, topic: null, role: 'none', connected: false, peerCount: 0 });

  const failed = createSwarmService(fakeClient({
    'chat.join': () => { throw new Error('Failed to join swarm topic'); }
  }));
  await t.exception.all(() => failed.join(TOPIC), /Failed to join swarm topic/);
});

test('swarm peer output sanitizes hostile names and caps abusive lists', async function (t) {
  const peers = [
    { id: 'newline-peer-identifier', displayName: 'Alice\nHost', role: 'peer' },
    { id: 'control-peer-identifier', displayName: '\u0000Bob\u001b[31m\u202e\t Admin', role: 'peer' },
    { id: 'blank-peer-identifier', displayName: '\n\u0000\t', role: 'peer' },
    { id: 'huge-peer-identifier', displayName: `  ${'x'.repeat(200)}  `, role: 'peer' }
  ];
  for (let index = 0; index < 100; index += 1) {
    peers.push({ id: `peer-${String(index).padStart(4, '0')}-private-suffix`, displayName: `Peer ${index}`, role: 'peer' });
  }

  const service = createSwarmService(fakeClient({ 'chat.peers': { peers } }));
  const sanitized = await service.peers();

  t.is(sanitized.length, 50, 'peer list is bounded');
  t.is(sanitized[0].displayName, 'Alice Host', 'newlines cannot spoof rows');
  t.is(sanitized[1].displayName, 'Bob [31m Admin', 'controls are removed and whitespace collapses');
  t.is(sanitized[2].displayName, 'Peer blank-pe…', 'blank hostile names receive a safe fallback');
  t.is(sanitized[3].displayName.length, 64, 'display names are capped');
  t.ok(sanitized.every((peer) => !/[\u0000-\u001f\u007f]/.test(peer.displayName)));
  t.ok(sanitized.every((peer) => peer.id.length <= 9), 'identifiers stay truncated');

  const output = collector();
  await dispatchSlashTag('/swarm peers', output.ctx, { swarm: service });
  t.is(output.output[0].metadata.peerCount, 50);
  t.is(output.output[0].metadata.peers.length, 50);
  t.is(output.output[0].content.split('\n').length, 51, 'rendered output has a bounded number of rows');
  t.alike(JSON.parse(JSON.stringify(output.output[0])), output.output[0], 'bounded peer output remains JSON-safe');
});