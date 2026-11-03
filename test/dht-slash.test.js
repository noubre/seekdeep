import test from 'brittle';
import { dispatchSlashTag } from './helpers/slash-runtime.js';
import { createDHTService } from '../js/slash/services/dht.js';

const PUBLIC_KEY = '12'.repeat(32);
const TOPIC = 'ab'.repeat(32);

function collector() {
  const output = [];
  return {
    output,
    ctx: { emitEphemeral(content, metadata) { output.push({ content, metadata }); } }
  };
}

function fakeDHT(overrides = {}) {
  const calls = [];
  const state = {
    initialized: true,
    publicKey: PUBLIC_KEY,
    topic: TOPIC,
    connectionCount: 2,
    listening: null,
    ...overrides
  };
  return {
    calls,
    status() {
      calls.push(['status']);
      return { ...state };
    }
  };
}

async function dispatch(input, dht = fakeDHT()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { dht });
  return { ...result, dht };
}

function fakeClient(status) {
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push([method, params]);
      if (method !== 'chat.status') throw new Error(`unexpected ${method}`);
      return typeof status === 'function' ? status() : status;
    }
  };
}

test('/dht defaults to status and reports honest uninitialized state', async function (t) {
  const dht = fakeDHT({
    initialized: false,
    publicKey: null,
    topic: null,
    connectionCount: 0,
    listening: false
  });
  const bare = await dispatch('/dht', dht);
  const explicit = await dispatch('/dht status', dht);

  t.ok(bare.output[0].content.includes('not initialized'));
  t.alike(bare.output[0].metadata, {
    kind: 'slash-dht',
    command: 'dht',
    action: 'status',
    initialized: false,
    publicKeyAvailable: false,
    topic: null,
    connectionCount: 0,
    listening: false
  });
  t.alike(explicit.output[0], bare.output[0], 'explicit status matches default');
  t.alike(dht.calls, [['status'], ['status']]);
});

test('/dht status reports only bounded high-level initialized state', async function (t) {
  const { output } = await dispatch('/dht status');
  const serialized = JSON.stringify(output[0]);

  t.ok(output[0].content.includes('Connections: 2'));
  t.ok(output[0].content.includes(`Discovery topic: ${TOPIC}`));
  t.ok(output[0].content.includes('Listening: unknown'));
  t.is(output[0].metadata.publicKeyAvailable, true);
  t.absent(serialized.includes(PUBLIC_KEY), 'status does not unnecessarily expose the local key');
  t.alike(JSON.parse(serialized), output[0], 'result is JSON-safe');
});

test('/dht key returns only a valid available local public key', async function (t) {
  const { output, dht } = await dispatch('/dht key');

  t.alike(dht.calls, [['status']]);
  t.ok(output[0].content.includes(PUBLIC_KEY));
  t.alike(output[0].metadata, {
    kind: 'slash-dht', command: 'dht', action: 'key', publicKey: PUBLIC_KEY
  });
  t.ok(/^[0-9a-f]{64}$/.test(output[0].metadata.publicKey));
});

test('/dht key gives a useful local error when the key is unavailable', async function (t) {
  for (const state of [
    { initialized: false, publicKey: null },
    { initialized: true, publicKey: null }
  ]) {
    const { output } = await dispatch('/dht key', fakeDHT(state));
    t.is(output[0].metadata.kind, 'slash-error');
    t.ok(output[0].content.includes('local public key is unavailable'));
  }
});

test('/dht nodes is explicit that no routing table is exposed', async function (t) {
  const { output } = await dispatch('/dht nodes');
  const result = output[0];

  t.ok(result.content.includes('Routing table details are not available'));
  t.ok(result.content.includes('Available connection count: 2'));
  t.absent(result.content.includes('2 nodes'), 'connections are not mislabeled as DHT nodes');
  t.alike(result.metadata, {
    kind: 'slash-dht',
    command: 'dht',
    action: 'nodes',
    limitation: 'routing-table-unavailable',
    initialized: true,
    connectionCount: 2,
    listening: null
  });
  t.absent(Object.hasOwn(result.metadata, 'nodes'));
});

test('/dht validates subcommands before accessing the service', async function (t) {
  for (const input of ['/dht nope', '/dht status extra', '/dht key extra', '/dht nodes extra']) {
    const { output, dht } = await dispatch(input);
    t.alike(dht.calls, []);
    t.is(output[0].metadata.kind, 'slash-error');
    t.ok(output[0].content.includes('status, key, or nodes'));
  }
});

test('DHT service adapter selects only safe stable diagnostics from chat.status', async function (t) {
  const secret = 'ff'.repeat(64);
  const client = fakeClient({
    initialized: true,
    publicKey: PUBLIC_KEY.toUpperCase(),
    topic: TOPIC.toUpperCase(),
    peerCount: 3,
    listening: true,
    secretKey: secret,
    peers: [{ publicKey: secret, address: '203.0.113.1:49737' }],
    routingTable: [secret]
  });
  const service = createDHTService(client);

  const status = await service.status();
  t.alike(status, {
    initialized: true,
    publicKey: PUBLIC_KEY,
    topic: TOPIC,
    connectionCount: 3,
    listening: null
  });
  const serialized = JSON.stringify(status);
  t.absent(serialized.includes(secret));
  t.absent(serialized.includes('203.0.113.1'));
  t.alike(JSON.parse(serialized), status);
  t.alike(client.calls, [['chat.status', {}]]);
});

test('DHT service rejects malformed keys and normalizes unreliable state', async function (t) {
  const service = createDHTService(fakeClient({
    initialized: true,
    publicKey: 'not-a-key',
    topic: 'also-not-a-topic',
    peerCount: -50
  }));

  t.alike(await service.status(), {
    initialized: true,
    publicKey: null,
    topic: null,
    connectionCount: 0,
    listening: null
  });
});

test('DHT service reports uninitialized state without leaking keys', async function (t) {
  const service = createDHTService(fakeClient({ initialized: false, publicKey: PUBLIC_KEY, topic: TOPIC, peerCount: 4 }));
  t.alike(await service.status(), {
    initialized: false,
    publicKey: null,
    topic: null,
    connectionCount: 0,
    listening: null
  });
});