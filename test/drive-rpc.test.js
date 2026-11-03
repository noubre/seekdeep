import test from 'brittle';
import { Duplex, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createJsonRpcServer } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';
import { createWorkerBackend, resolveDriveStorageRoot } from '../js/p2p/worker-runtime.js';

function duplexPair() {
  let a;
  let b;
  a = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); },
    final(callback) { b.push(null); callback(); }
  });
  b = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); },
    final(callback) { a.push(null); callback(); }
  });
  return [a, b];
}

function nextLines(stream, count) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const lines = [];
    const onData = (chunk) => {
      buffered += chunk.toString();
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line) lines.push(JSON.parse(line));
        if (lines.length === count) cleanup(resolve, lines);
      }
    };
    const onError = (error) => cleanup(reject, error);
    const cleanup = (done, value) => {
      stream.off('data', onData);
      stream.off('error', onError);
      done(value);
    };
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

const methods = {
  'drive.list': { validate(params) { if (Reflect.ownKeys(params).length) throw new Error('extra fields'); return []; }, invoke: async () => [{ id: 'drive-1' }] },
  'drive.get': { validate(params) { return [params.ref, params.path]; }, invoke: async (ref, path) => ({ ref, path, content: 'ok' }) }
};

/**
 * Explicit fakes for the peer services the backend wires up. The runtime no
 * longer infers fakes from a `service` override, so every injected service must
 * be supplied by the caller.
 */
function stubRpcServices(drive) {
  const close = async () => {};
  return {
    service: drive,
    localdriveService: { close },
    mirrorService: { close },
    beamService: { close },
    disableHarness: true
  };
}

test('RPC client/server correlate concurrent replies and lazily reuse one Pear-compatible duplex pipe', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  let pipeCalls = 0;
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory() { pipeCalls += 1; return clientPipe; }, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  const [list, get] = await Promise.all([
    client.request('drive.list', {}),
    client.request('drive.get', { ref: 'docs', path: '/x' })
  ]);
  t.alike(list, [{ id: 'drive-1' }]);
  t.alike(get, { ref: 'docs', path: '/x', content: 'ok' });
  t.is(pipeCalls, 1, 'one lazy pipe is reused');
});

test('default client obtains globalThis.Pear.worker.pipe lazily and only once', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const previous = globalThis.Pear;
  let calls = 0;
  globalThis.Pear = { worker: { pipe() { calls += 1; return clientPipe; } } };
  const client = createRpcClient({ timeout: 1000 });
  t.teardown(async () => {
    client.close();
    globalThis.Pear = previous;
    await server.close();
  });
  t.is(calls, 0, 'client construction does not acquire the pipe');
  await client.request('drive.list', {});
  await client.request('drive.list', {});
  t.is(calls, 1);
});

test('RPC allowlists methods and rejects non-plain, accessor, and extra-field payloads', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });

  await t.exception.all(() => client.request('constructor', {}), /not allowed/i);
  await t.exception.all(() => client.request('drive.list', { extra: true }), /extra fields/i);
  await t.exception.all(() => client.request('drive.get', null), /plain object/i);
  const accessor = {};
  Object.defineProperty(accessor, 'ref', { enumerable: true, get() { throw new Error('getter ran'); } });
  await t.exception.all(() => client.request('drive.get', accessor), /data propert/i);
});

test('RPC server accepts split and coalesced newline frames and rejects malformed JSON', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods);
  t.teardown(() => server.close());
  const responses = nextLines(clientPipe, 3);
  const first = JSON.stringify({ id: '1', method: 'drive.list', params: {} });
  const second = JSON.stringify({ id: '2', method: 'drive.get', params: { ref: 'docs', path: '/é' } });
  const bytes = Buffer.from(`${first}\n${second}\n{bad json}\n`);
  clientPipe.write(bytes.subarray(0, first.length - 2));
  clientPipe.write(bytes.subarray(first.length - 2, first.length + 3));
  clientPipe.write(bytes.subarray(first.length + 3));
  const rows = await responses;
  t.alike(rows[0], { id: '1', ok: true, result: [{ id: 'drive-1' }] });
  t.alike(rows[1], { id: '2', ok: true, result: { ref: 'docs', path: '/é', content: 'ok' } });
  t.is(rows[2].id, null);
  t.is(rows[2].ok, false);
  t.ok(/json/i.test(rows[2].error));
});

test('RPC enforces per-frame byte limits without rejecting coalesced valid frames', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, methods, { maxMessageBytes: 256 });
  t.teardown(() => server.close());
  const responses = nextLines(clientPipe, 2);
  const frame = `${JSON.stringify({ id: '1', method: 'drive.list', params: {} })}\n`;
  clientPipe.write(Buffer.from(frame + frame.replace('"1"', '"2"')));
  t.is((await responses).length, 2, 'coalesced frames are measured individually');

  const [limitedClient] = duplexPair();
  const client = createRpcClient({ pipeFactory: () => limitedClient, timeout: 100, maxMessageBytes: 256 });
  await t.exception.all(() => client.request('drive.get', { ref: 'docs', path: `/${'x'.repeat(400)}` }), /too large/i);
  client.close();
});

test('RPC server rejects non-JSON results instead of throwing during serialization', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  const unsafeMethods = {
    'drive.list': { validate: () => [], invoke: async () => ({ count: 1n }) }
  };
  const server = createJsonRpcServer(serverPipe, unsafeMethods);
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  t.teardown(async () => { client.close(); await server.close(); });
  await t.exception.all(() => client.request('drive.list', {}), /JSON data/i);
});

test('RPC timeout, close, and stream error reject pending calls and a later request reconnects', async function (t) {
  const first = duplexPair();
  const second = duplexPair();
  const server = createJsonRpcServer(second[1], methods);
  let index = 0;
  const client = createRpcClient({ pipeFactory: () => [first[0], second[0]][index++], timeout: 30 });
  t.teardown(async () => { client.close(); first[1].destroy(); await server.close(); });

  await t.exception.all(() => client.request('drive.list', {}), /timed out/i);
  first[0].destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.alike(await client.request('drive.list', {}), [{ id: 'drive-1' }]);

  const pendingClose = client.request('drive.get', { ref: 'docs', path: '/x' });
  client.close();
  await t.exception.all(() => pendingClose, /closed/i);

  const errorPair = duplexPair();
  const errorClient = createRpcClient({ pipeFactory: () => errorPair[0], timeout: 1000 });
  const pendingError = errorClient.request('drive.list', {});
  errorPair[0].emit('error', new Error('forced pipe failure'));
  await t.exception.all(() => pendingError, /forced pipe failure/i);
  errorPair[1].destroy();
  errorClient.close();
});

test('malformed peer data rejects all pending work without process errors and reconnects', async function (t) {
  const first = duplexPair();
  const second = duplexPair();
  const server = createJsonRpcServer(second[1], methods);
  let pipeIndex = 0;
  const client = createRpcClient({
    pipeFactory: () => [first[0], second[0]][pipeIndex++],
    timeout: 1000
  });
  const uncaught = [];
  const unhandled = [];
  const onUncaught = (error) => { uncaught.push(error); };
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  t.teardown(async () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
    client.close();
    first[1].destroy();
    await server.close();
  });

  try {
    const pending = [
      client.request('drive.list', {}),
      client.request('drive.get', { ref: 'docs', path: '/x' })
    ];
    first[1].write(Buffer.from('{bad}\n'));
    const settled = await Promise.allSettled(pending);
    t.is(settled.filter((result) => result.status === 'rejected').length, 2);
    for (const result of settled) t.ok(/JSON|malformed/i.test(result.reason.message));

    await new Promise((resolve) => setTimeout(resolve, 20));
    t.alike(uncaught, [], 'destroy error is consumed by the pipe lifecycle');
    t.alike(unhandled, [], 'pending rejection handling does not leak');
    t.is(first[0].listenerCount('error'), 0, 'temporary destroy listener is removed');
    t.is(first[0].listenerCount('close'), 0, 'temporary close listener is removed');
    t.alike(await client.request('drive.list', {}), [{ id: 'drive-1' }]);
    t.is(pipeIndex, 2, 'a later request acquires a fresh pipe');
  } finally {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
  }
});

test('async pipe write errors promptly reject the originating request and every pending peer once', async function (t) {
  const pipe = new EventEmitter();
  pipe.write = (_frame, callback) => {
    queueMicrotask(() => callback(new Error('async write failure')));
    return true;
  };
  pipe.end = () => {};
  const client = createRpcClient({ pipeFactory: () => pipe, timeout: 1000 });
  t.teardown(() => client.close());

  const requests = [
    client.request('drive.list', {}),
    client.request('drive.get', { ref: 'docs', path: '/x' })
  ];
  const settled = await Promise.race([
    Promise.allSettled(requests),
    new Promise((_, reject) => setTimeout(() => reject(new Error('write-error settlement was not prompt')), 100))
  ]);
  t.is(settled.length, 2);
  for (const result of settled) {
    t.is(result.status, 'rejected');
    t.ok(/async write failure/i.test(result.reason.message));
  }
});

test('RPC client caps pending requests before writing more work', async function (t) {
  const pipe = new EventEmitter();
  let writes = 0;
  pipe.write = (_frame, callback) => { writes += 1; callback(); return true; };
  pipe.end = () => {};
  const client = createRpcClient({ pipeFactory: () => pipe, timeout: 1000, maxPendingRequests: 2 });
  const first = client.request('drive.list', {});
  const second = client.request('drive.list', {});
  await t.exception.all(() => client.request('drive.list', {}), /pending request limit/i);
  t.is(writes, 2);
  client.close();
  const settled = await Promise.allSettled([first, second]);
  t.is(settled.filter((result) => result.status === 'rejected').length, 2);
});

test('RPC server rejects oversized aggregate chunks before dispatch and caps queued requests', async function (t) {
  const aggregatePair = duplexPair();
  let aggregateInvocations = 0;
  const aggregateServer = createJsonRpcServer(aggregatePair[1], {
    'drive.list': { validate: () => [], invoke: async () => { aggregateInvocations += 1; return []; } }
  }, { maxMessageBytes: 128, maxAggregateBytes: 128 });
  const frame = `${JSON.stringify({ id: '1', method: 'drive.list', params: {} })}\n`;
  aggregatePair[0].write(Buffer.from(frame + frame.replace('"1"', '"2"') + frame.replace('"1"', '"3"')));
  await new Promise((resolve) => setTimeout(resolve, 20));
  t.is(aggregateInvocations, 0, 'an oversized chunk is rejected before any frame is dispatched');
  await aggregateServer.close();
  aggregatePair[0].destroy();

  const queuedPair = duplexPair();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let queuedInvocations = 0;
  const queuedServer = createJsonRpcServer(queuedPair[1], {
    'drive.list': { validate: () => [], invoke: async () => { queuedInvocations += 1; await gate; return []; } }
  }, { maxQueuedRequests: 2 });
  queuedPair[0].write(Buffer.from(frame + frame.replace('"1"', '"2"') + frame.replace('"1"', '"3"')));
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  await queuedServer.close();
  t.is(queuedInvocations, 2, 'only the bounded queued work is invoked');
  queuedPair[0].destroy();
});

test('runtime storage resolution is app-scoped and backend shutdown is idempotent', async function (t) {
  t.is(resolveDriveStorageRoot({ storage: '/tmp/pear-app' }), '/tmp/pear-app/seekdeep-hyperdrives-v1');
  t.is(resolveDriveStorageRoot({ storage: '/tmp/pear-app/../pear-app/' }), '/tmp/pear-app/seekdeep-hyperdrives-v1');
  await t.exception.all(() => resolveDriveStorageRoot({ storage: 'relative' }), /absolute/);
  await t.exception.all(() => resolveDriveStorageRoot({ storage: '/' }), /non-root/);
  await t.exception.all(() => resolveDriveStorageRoot({ storage: '/tmp/..' }), /non-root/);
  await t.exception.all(() => resolveDriveStorageRoot({}), /storage/);

  const previousPear = globalThis.Pear;
  globalThis.Pear = { app: { storage: '/tmp/current-pear-app' } };
  t.is(resolveDriveStorageRoot(), '/tmp/current-pear-app/seekdeep-hyperdrives-v1');
  globalThis.Pear = previousPear;

  const pipe = new PassThrough();
  let serviceCloses = 0;
  let pipeEnds = 0;
  const end = pipe.end.bind(pipe);
  pipe.end = (...args) => { pipeEnds += 1; return end(...args); };
  const service = { close: async () => { serviceCloses += 1; } };
  const backend = await createWorkerBackend(pipe, stubRpcServices(service));
  await Promise.all([backend.close(), backend.close()]);
  t.is(serviceCloses, 1);
  t.is(pipeEnds, 1);
});

test('backend shutdown still closes the service when RPC shutdown fails', async function (t) {
  const pipe = new PassThrough();
  pipe.end = () => { throw new Error('forced pipe close failure'); };
  let serviceCloses = 0;
  const backend = await createWorkerBackend(pipe, stubRpcServices({ close: async () => { serviceCloses += 1; } }));
  await t.exception.all(() => backend.close(), /shutdown failed/i);
  t.is(serviceCloses, 1);
  pipe.destroy();
});

test('backend shutdown drains an in-flight RPC operation before closing drive storage', async function (t) {
  const [clientPipe, serverPipe] = duplexPair();
  let release;
  let startedResolve;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const events = [];
  const service = {
    async list() {
      events.push('operation-start');
      startedResolve();
      await gate;
      events.push('operation-end');
      return [];
    },
    async close() { events.push('service-close'); }
  };
  const backend = await createWorkerBackend(serverPipe, stubRpcServices(service));
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 1000 });
  const request = client.request('drive.list', {}).catch((error) => error);
  await started;
  const closing = backend.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.alike(events, ['operation-start'], 'storage remains open while RPC work is in flight');
  release();
  await closing;
  t.alike(events, ['operation-start', 'operation-end', 'service-close']);
  client.close();
  await request;
});
