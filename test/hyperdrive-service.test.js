import test from 'brittle';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDefaultSwarmFactory,
  createHyperdriveService,
  normalizeDrivePath,
  withTimeout
} from '../js/p2p/hyperdrive-service.js';

async function temporaryRoot(t, label) {
  const root = await mkdtemp(join(tmpdir(), `seekdeep-${label}-`));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  return root;
}

function offlineOptions(storageRoot) {
  return { storageRoot, swarmFactory: () => null };
}

test('real Hyperdrive service creates, mutates, lists, deletes, closes, and reopens persistent data', async function (t) {
  const root = await temporaryRoot(t, 'drive');
  const first = createHyperdriveService(offlineOptions(root));
  t.teardown(() => first.close());

  const created = await first.create('docs');
  t.ok(/^[0-9a-f]{64}$/.test(created.key));
  t.is(created.writable, true);
  t.absent(Object.hasOwn(created, 'secretKey'));

  const put = await first.put(created.id, '/notes/hello.txt', 'hello hyperdrive');
  t.ok(put.version > created.version);
  t.alike(await first.get('docs', '/notes/hello.txt'), {
    path: '/notes/hello.txt', content: 'hello hyperdrive', bytes: 16
  });
  const files = await first.files(created.id, '/notes');
  t.alike(files.files, ['/notes/hello.txt']);
  t.is(files.capped, false);
  t.is((await first.status('docs')).fileCount, 1);

  t.is((await first.del('docs', '/notes/hello.txt')).deleted, true);
  t.alike((await first.files('docs')).files, []);
  const closed = await first.closeDrive('docs');
  t.is(closed.opened, false);
  t.is(closed.discovering, false);

  const reopened = await first.create('docs');
  t.is(reopened.key, created.key, 'same named on-disk Corestore retains its writable keypair');
  t.is(reopened.writable, true);
  await first.put('docs', '/persisted.txt', 'survives service restart');
  await first.close();

  const second = createHyperdriveService(offlineOptions(root));
  t.teardown(() => second.close());
  const afterRestart = await second.create('docs');
  t.is(afterRestart.key, created.key);
  t.is((await second.get('docs', '/persisted.txt')).content, 'survives service restart');
});

test('real key-only reader receives writer bytes over paired in-memory Hyperdrive protocol streams', async function (t) {
  const writerRoot = await temporaryRoot(t, 'writer');
  const readerRoot = await temporaryRoot(t, 'reader');
  const writer = createHyperdriveService(offlineOptions(writerRoot));
  const reader = createHyperdriveService(offlineOptions(readerRoot));
  t.teardown(() => Promise.all([writer.close(), reader.close()]));

  const writable = await writer.create('source');
  const readonly = await reader.open(writable.key, 'replica');
  t.is(readonly.writable, false);

  const left = writer.replicate('source', true);
  const right = reader.replicate('replica', false);
  left.pipe(right).pipe(left);
  t.teardown(() => { left.destroy(); right.destroy(); });

  await writer.put('source', '/shared.txt', 'replicated bytes');
  const received = await reader.get('replica', '/shared.txt');
  t.is(received.content, 'replicated bytes');
  t.alike((await reader.files('replica')).files, ['/shared.txt']);
});

test('drive validation rejects traversal, roots, NULs, bad keys, and bounded payload overflows', async function (t) {
  for (const bad of ['/', '', '../x', '/a/../x', '/a//b', '/a/./b', 'a\\b', '/a\0b']) {
    await t.exception.all(() => normalizeDrivePath(bad), /path/i, bad);
  }

  const root = await temporaryRoot(t, 'validation');
  const service = createHyperdriveService(offlineOptions(root));
  t.teardown(() => service.close());
  const drive = await service.create('limits');
  await t.exception.all(() => service.open('not-a-key'), /64-character hexadecimal/i);
  await t.exception.all(() => service.put(drive.id, '/large.txt', 'x'.repeat(65537)), /too large/i);
  await t.exception.all(() => service.get(drive.id, '../secret'), /path/i);
  await t.exception.all(() => service.files(drive.id, `/${'x'.repeat(600)}`), /path/i);
});

test('failed discovery rolls back registration and reopening a key replaces its old name', async function (t) {
  const root = await temporaryRoot(t, 'rollback');
  let failDiscovery = true;
  let destroyed = 0;
  const service = createHyperdriveService({
    storageRoot: root,
    swarmFactory() {
      if (!failDiscovery) return null;
      return {
        on() {},
        join() { throw new Error('forced discovery failure'); },
        async destroy() { destroyed += 1; }
      };
    }
  });
  t.teardown(() => service.close());

  await t.exception.all(() => service.create('docs'), /forced discovery failure/);
  t.is(destroyed, 1, 'failed discovery destroys its swarm');
  t.alike(await service.list(), [], 'failed open is not registered');

  failDiscovery = false;
  const created = await service.create('docs');
  await service.closeDrive('docs');
  const reopened = await service.open(created.key, 'archive');
  t.is(reopened.id, created.id);
  await t.exception.all(() => service.status('docs'), /not found/i, 'stale name alias is removed');
  t.is((await service.status('archive')).key, created.key);

  await service.close();
  await t.exception.all(() => service.list(), /service is closed/i);
});

test('concurrent creates cannot register duplicate normalized names', async function (t) {
  const root = await temporaryRoot(t, 'duplicate');
  const service = createHyperdriveService(offlineOptions(root));
  t.teardown(() => service.close());
  const results = await Promise.allSettled([service.create('Docs'), service.create('docs')]);
  t.is(results.filter((result) => result.status === 'fulfilled').length, 1);
  t.is(results.filter((result) => result.status === 'rejected').length, 1);
  t.is((await service.list()).length, 1);
});

test('drive capacity counts open drives rather than historical closed records', async function (t) {
  const root = await temporaryRoot(t, 'capacity');
  const service = createHyperdriveService({ ...offlineOptions(root), maxDrives: 2 });
  t.teardown(() => service.close());

  await service.create('one');
  await service.create('two');
  await t.exception.all(() => service.create('blocked'), /drive limit/i);
  await service.closeDrive('one');
  await service.create('three');
  await service.closeDrive('two');
  await service.closeDrive('three');
  await service.create('four');
  const reopened = await service.create('one');
  t.is(reopened.name, 'one');
  t.is(reopened.opened, true);
});

test('create on a closed key-only record reopens the same read-only remote drive', async function (t) {
  const writerRoot = await temporaryRoot(t, 'remote-writer');
  const readerRoot = await temporaryRoot(t, 'remote-reader');
  const writer = createHyperdriveService(offlineOptions(writerRoot));
  const reader = createHyperdriveService(offlineOptions(readerRoot));
  t.teardown(() => Promise.all([writer.close(), reader.close()]));

  const source = await writer.create('source');
  const opened = await reader.open(source.key, 'replica');
  t.is(opened.writable, false);
  await reader.closeDrive('replica');
  const reopened = await reader.create('replica');
  t.is(reopened.id, opened.id);
  t.is(reopened.key, source.key);
  t.is(reopened.writable, false, 'create must not mint a replacement writable drive');
});

test('each drive receives a distinct record-aware swarm that joins and replicates only its drive', async function (t) {
  const root = await temporaryRoot(t, 'mock-swarm');
  const instances = [];
  const records = [];
  function swarmFactory(record) {
    records.push(record);
    const listeners = new Map();
    const instance = {
      joined: null,
      discoveryDestroys: 0,
      destroys: 0,
      on(event, listener) { listeners.set(event, listener); },
      emit(event, value) { listeners.get(event)?.(value); },
      join(discoveryKey, options) {
        this.joined = { discoveryKey: Buffer.from(discoveryKey), options };
        return {
          flushed: async () => {},
          destroy: async () => { this.discoveryDestroys += 1; }
        };
      },
      async destroy() { this.destroys += 1; }
    };
    instances.push(instance);
    return instance;
  }
  const service = createHyperdriveService({ storageRoot: root, swarmFactory });
  t.teardown(() => service.close());
  const first = await service.create('first');
  const second = await service.create('second');
  t.is(instances.length, 2);
  t.not(instances[0], instances[1]);
  for (let index = 0; index < 2; index += 1) {
    t.ok(instances[index].joined.discoveryKey.equals(Buffer.from(records[index].drive.discoveryKey)));
    t.alike(instances[index].joined.options, { server: true, client: true });
  }

  const replicated = [];
  records[0].drive.replicate = (socket) => { replicated.push(['first', socket]); };
  records[1].drive.replicate = (socket) => { replicated.push(['second', socket]); };
  const firstSocket = { destroy() {} };
  const secondSocket = { destroy() {} };
  instances[0].emit('connection', firstSocket);
  instances[1].emit('connection', secondSocket);
  t.alike(replicated, [['first', firstSocket], ['second', secondSocket]]);

  await service.closeDrive(first.id);
  await service.closeDrive(second.id);
  for (const instance of instances) {
    t.is(instance.discoveryDestroys, 1);
    t.is(instance.destroys, 1);
  }
});

async function retryableCleanupHarness(t, target) {
  const root = await temporaryRoot(t, `retry-${target}`);
  const calls = { discovery: 0, swarm: 0, drive: 0, store: 0 };
  let record;
  const attempt = (name, operation = async () => {}) => async () => {
    calls[name] += 1;
    if (name === target && calls[name] === 1) throw new Error(`forced ${name} close failure`);
    return operation();
  };
  const discovery = { flushed: async () => {}, destroy: attempt('discovery') };
  const swarm = {
    on() {},
    join() { return discovery; },
    destroy: attempt('swarm')
  };
  const store = { close: attempt('store') };
  const drive = {
    key: Buffer.alloc(32, 7),
    discoveryKey: Buffer.alloc(32, 9),
    writable: true,
    version: 0,
    ready: async () => {},
    findingPeers: () => () => {},
    close: attempt('drive')
  };
  const service = createHyperdriveService({
    storageRoot: root,
    storeFactory: () => store,
    driveFactory: () => drive,
    swarmFactory(value) { record = value; return swarm; }
  });
  const descriptor = await service.create('retry');
  t.ok(record, 'the focused factories still create a service record');
  t.teardown(() => service.close().catch(() => {}));
  return { calls, descriptor, service };
}

for (const resource of ['discovery', 'swarm', 'drive', 'store']) {
  test(`${resource} cleanup failure is retained and only that resource is retried`, async function (t) {
    const { calls, descriptor, service } = await retryableCleanupHarness(t, resource);

    await t.exception.all(() => service.closeDrive(descriptor.id), new RegExp(`forced ${resource} close failure`, 'i'));
    const failed = await service.status(descriptor.id);
    t.is(failed.opened, false, 'the drive becomes unavailable immediately');
    t.is(failed.status, 'closing-error');
    await t.exception.all(() => service.create('retry'), /cleanup.*incomplete/i);

    const closed = await service.closeDrive(descriptor.id);
    t.is(closed.status, 'closed');
    t.is(calls[resource], 2, 'the failed resource is retried');
    for (const [name, count] of Object.entries(calls)) {
      if (name !== resource) t.is(count, 1, `${name} is not double-closed`);
    }
  });
}

test('service close can retry retained cleanup after a failed shutdown attempt', async function (t) {
  const { calls, service } = await retryableCleanupHarness(t, 'discovery');
  await t.exception.all(() => service.close(), /shutdown failed/i);
  await t.exception.all(() => service.create('blocked'), /service is closed/i);
  await service.close();
  t.alike(calls, { discovery: 2, swarm: 1, drive: 1, store: 1 });
});

test('default swarm factory creates bounded distinct Hyperswarm instances', function (t) {
  const options = [];
  class FakeSwarm {
    constructor(value) { options.push(value); }
  }
  const factory = createDefaultSwarmFactory(7, FakeSwarm);
  const first = factory({ id: 'one' });
  const second = factory({ id: 'two' });
  t.not(first, second);
  t.alike(options, [{ maxPeers: 7 }, { maxPeers: 7 }]);
});

test('timed-out operations retain a rejection handler for late failures', async function (t) {
  let rejectOperation;
  const operation = new Promise((_, reject) => { rejectOperation = reject; });
  let unhandled = null;
  const onUnhandled = (error) => { unhandled = error; };
  process.on('unhandledRejection', onUnhandled);
  try {
    await t.exception.all(() => withTimeout(operation, 5, 'expected timeout'), /expected timeout/i);
    rejectOperation(new Error('late operation failure'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    t.is(unhandled, null);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
