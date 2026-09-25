import test from 'brittle';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Corestore from 'corestore';
import Hyperdrive from 'hyperdrive';
import Localdrive from 'localdrive';
import MirrorDrive from 'mirror-drive';
import { createMirrorService } from '../js/p2p/mirror-service.js';

async function eventuallyStatus(service, id, expected = 'completed') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await service.status(id);
    if (row.status === expected || row.status === 'failed') return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('mirror job did not settle');
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'seekdeep-mirror-'));
  const localRoot = path.join(root, 'local');
  await mkdir(path.join(localRoot, 'safe'), { recursive: true });
  await writeFile(path.join(localRoot, 'safe', 'one.txt'), 'hello');
  await writeFile(path.join(localRoot, 'outside.txt'), 'outside');
  const local = new Localdrive(localRoot, { followLinks: false, followExternalLinks: false });
  await local.ready();
  const store = new Corestore(path.join(root, 'store'));
  const drive = new Hyperdrive(store);
  await drive.ready();
  t.teardown(async () => {
    try { await local.close(); } catch {}
    try { await drive.close(); } catch {}
    try { await store.close(); } catch {}
    await rm(root, { recursive: true, force: true });
  });
  let validations = 0;
  const service = createMirrorService({
    localdriveService: {
      async resolveMirrorSource(ref) {
        if (ref !== 'docs') throw new Error('missing local');
        return { id: 'local-canonical', drive: local, async validate() { validations += 1; } };
      }
    },
    driveService: {
      async resolveMirrorDestination(ref) {
        if (ref !== 'backup') throw new Error('missing drive');
        return { id: 'drive-canonical', drive, writable: true };
      }
    },
    idFactory: () => 'mirror-1'
  });
  t.teardown(() => service.close());
  return { service, drive, root, get validations() { return validations; } };
}

test('real MirrorDrive dry run reports bounded additions without mutating destination', async function (t) {
  const f = await fixture(t);
  const version = f.drive.version;
  const queued = await f.service.start('docs', 'backup', { dryRun: true, prune: false, prefix: '/safe' });
  t.is(queued.id, 'mirror-1');
  t.is(queued.localId, 'local-canonical');
  t.is(queued.driveId, 'drive-canonical');
  t.is(queued.status, 'queued');
  const done = await eventuallyStatus(f.service, queued.id);
  t.is(done.status, 'completed');
  t.is(done.counts.add, 1);
  t.is(done.counts.remove, 0);
  t.alike(done.paths, ['/safe/one.txt']);
  t.is(await f.drive.get('/safe/one.txt'), null, 'dry run never writes');
  t.is(f.drive.version, version, 'dry run does not append an empty destination transaction');
  t.is(f.validations, 2, 'source root is validated before and after MirrorDrive');
  t.alike(JSON.parse(JSON.stringify(done)), done, 'descriptor is JSON-safe');
  t.absent(JSON.stringify(done).includes(f.root), 'absolute roots are never exposed');
});

test('source identity changes during MirrorDrive fail closed with no path leakage', async function (t) {
  let validations = 0;
  class OneDiffMirror {
    async *[Symbol.asyncIterator]() {
      yield { op: 'add', key: '/safe.txt', bytesAdded: 1, bytesRemoved: 0 };
    }
  }
  const service = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({
      id: 'local',
      drive: {},
      async validate() {
        validations += 1;
        if (validations === 2) throw new Error('/Users/private/source changed');
      }
    }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: true }) },
    MirrorDrive: OneDiffMirror,
    idFactory: () => 'mirror-race'
  });
  t.teardown(() => service.close());
  const job = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' });
  const failed = await eventuallyStatus(service, job.id);
  t.is(failed.status, 'failed');
  t.is(failed.error, 'Mirror source changed during dry run');
  t.absent(JSON.stringify(failed).includes('/Users/private'));
});

test('mirror service rejects apply, prune, unsafe prefixes, and read-only destinations', async function (t) {
  const f = await fixture(t);
  await t.exception.all(() => f.service.start('docs', 'backup', { dryRun: false, prune: false, prefix: '/' }), /apply.*unavailable|dry.?run/i);
  await t.exception.all(() => f.service.start('docs', 'backup', { dryRun: true, prune: true, prefix: '/' }), /prune.*not supported/i);
  for (const prefix of ['/../escape', '/safe//bad', '/safe/./bad', '\\safe']) {
    await t.exception.all(() => f.service.start('docs', 'backup', { dryRun: true, prune: false, prefix }), /prefix/i);
  }
  const readOnly = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: {}, validate: async () => {} }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: false }) }
  });
  t.teardown(() => readOnly.close());
  await t.exception.all(() => readOnly.start('a', 'b', { dryRun: true, prune: false, prefix: '/' }), /writable/i);
});

test('mirror registry is capped, descriptors omit handles, and failed work does not block the queue', async function (t) {
  let calls = 0;
  class FakeMirror {
    constructor() { calls += 1; }
    async *[Symbol.asyncIterator]() {
      if (calls === 1) throw new Error('/Users/private/source failed');
      yield { op: 'add', key: '/ok.txt', bytesAdded: 2, bytesRemoved: 0 };
    }
  }
  let id = 0;
  const service = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: {}, validate: async () => {} }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: true }) },
    MirrorDrive: FakeMirror,
    idFactory: () => `mirror-${++id}`,
    maxJobs: 2
  });
  t.teardown(() => service.close());
  const first = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' });
  const second = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' });
  const failed = await eventuallyStatus(service, first.id);
  const completed = await eventuallyStatus(service, second.id);
  t.is(failed.status, 'failed');
  t.is(failed.error, 'Mirror dry run failed');
  t.absent(JSON.stringify(failed).includes('/Users/private'));
  t.is(completed.status, 'completed');
  t.is((await service.status()).length, 2);
  await t.exception.all(() => service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' }), /limit/i);
  for (const row of await service.status()) {
    t.absent(Object.hasOwn(row, 'drive'));
    t.absent(Object.hasOwn(row, 'handle'));
  }
});

test('diff iteration is bounded and cancelled at maxDiffs', async function (t) {
  const state = { nextCalls: 0, returnCalls: 0 };
  class AdversarialMirror {
    [Symbol.asyncIterator]() { return this; }
    async next() {
      state.nextCalls += 1;
      if (state.nextCalls > 100000) return { done: true };
      return {
        done: false,
        value: { op: 'add', key: `/file-${state.nextCalls}.txt`, bytesAdded: 1, bytesRemoved: 0 }
      };
    }
    async return() {
      state.returnCalls += 1;
      return { done: true };
    }
  }
  const service = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: {}, validate: async () => {} }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: true }) },
    MirrorDrive: AdversarialMirror,
    idFactory: () => 'mirror-bounded',
    maxDiffs: 3,
    maxDurationMs: 1000
  });
  t.teardown(() => service.close());
  const job = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' });
  const capped = await eventuallyStatus(service, job.id, 'capped');
  t.is(capped.status, 'capped');
  t.is(capped.limitReason, 'maxDiffs');
  t.is(capped.counts.diffs, 3);
  t.is(capped.counts.files, 3);
  t.is(capped.counts.bytesObserved, 3);
  t.ok(state.nextCalls <= 3, 'iterator work never exceeds maxDiffs');
  t.is(state.returnCalls, 1, 'iterator cleanup is invoked exactly once');
});

test('diff iteration is capped by duration and observed bytes', async function (t) {
  async function run(id, limits, next) {
    let returnCalls = 0;
    class LimitedMirror {
      [Symbol.asyncIterator]() { return this; }
      async next() { return next(); }
      async return() { returnCalls += 1; return { done: true }; }
    }
    const service = createMirrorService({
      localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: {}, validate: async () => {} }) },
      driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: true }) },
      MirrorDrive: LimitedMirror,
      idFactory: () => id,
      ...limits
    });
    const job = await service.start('local', 'drive');
    const result = await eventuallyStatus(service, job.id, 'capped');
    await service.close();
    return { result, returnCalls };
  }

  let durationCalls = 0;
  const duration = await run('mirror-duration', { maxDurationMs: 1 }, async () => {
    durationCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { done: false, value: { op: 'add', key: '/slow.txt', bytesAdded: 1, bytesRemoved: 0 } };
  });
  t.is(duration.result.limitReason, 'maxDurationMs');
  t.is(duration.result.counts.diffs, 1);
  t.is(durationCalls, 1, 'duration is checked before requesting another diff');
  t.is(duration.returnCalls, 1);

  let byteCalls = 0;
  const bytes = await run('mirror-bytes', { maxBytesObserved: 5 }, async () => {
    byteCalls += 1;
    return { done: false, value: { op: 'change', key: '/large.txt', bytesAdded: 3, bytesRemoved: 2 } };
  });
  t.is(bytes.result.limitReason, 'maxBytesObserved');
  t.is(bytes.result.counts.bytesObserved, 5);
  t.is(bytes.result.counts.diffs, 1);
  t.is(byteCalls, 1, 'byte cap stops iteration after the counted diff');
  t.is(bytes.returnCalls, 1);
});

test('stop reports stopping until a blocked one-shot iterator really exits', async function (t) {
  let release;
  let startedResolve;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  class BlockingMirror {
    async *[Symbol.asyncIterator]() {
      startedResolve();
      await gate;
      yield { op: 'add', key: '/late.txt', bytesAdded: 1, bytesRemoved: 0 };
    }
  }
  const service = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: {}, validate: async () => {} }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: {}, writable: true }) },
    MirrorDrive: BlockingMirror,
    idFactory: () => 'mirror-running'
  });
  const job = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/' });
  await started;
  t.is((await service.status(job.id)).status, 'running');
  t.is((await service.stop(job.id)).status, 'stopping');
  t.is((await service.status(job.id)).status, 'stopping', 'status does not claim stopped while next() is blocked');
  let closed = false;
  const closing = service.close().then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.is(closed, false, 'shutdown waits for the active iterator');
  release();
  await closing;
  t.is(closed, true);
  t.is((await service.status(job.id)).status, 'stopped');
  t.is((await service.status(job.id)).counts.diffs, 0, 'late diff is not processed after stop');
});

test('MirrorDrive is instantiated with mandatory safe options and consumed once', async function (t) {
  const seen = [];
  class InspectMirror {
    constructor(src, dst, options) { seen.push({ src, dst, options, iterations: 0 }); }
    async *[Symbol.asyncIterator]() { seen[0].iterations += 1; yield { op: 'change', key: '/x', bytesAdded: 3, bytesRemoved: 1 }; }
    async done() { throw new Error('done must not be called after iteration'); }
  }
  const service = createMirrorService({
    localdriveService: { resolveMirrorSource: async () => ({ id: 'local', drive: 'src', validate: async () => {} }) },
    driveService: { resolveMirrorDestination: async () => ({ id: 'drive', drive: 'dst', writable: true }) },
    MirrorDrive: InspectMirror,
    idFactory: () => 'mirror-safe'
  });
  t.teardown(() => service.close());
  const job = await service.start('local', 'drive', { dryRun: true, prune: false, prefix: '/x' });
  const done = await eventuallyStatus(service, job.id);
  t.is(done.status, 'completed');
  t.alike(seen, [{ src: 'src', dst: 'dst', options: { dryRun: true, prune: false, prefix: '/x', progress: false, batch: true }, iterations: 1 }]);
});
