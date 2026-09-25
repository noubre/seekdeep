import test from 'brittle';
import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_LOCAL_CONTENT_BYTES,
  createLocaldriveService,
  normalizeLocalAlias,
  normalizeLocalPath
} from '../js/p2p/localdrive-service.js';

const { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } = nodeFs;

test('Localdrive parent service uses Bare-compatible filesystem imports', async function (t) {
  const source = await readFile(new URL('../js/p2p/localdrive-service.js', import.meta.url), 'utf8');
  t.ok(source.includes("import('bare-fs/promises')"));
  for (const forbidden of ["from 'fs'", "from 'fs/promises'", "from 'node:fs'", "from 'node:fs/promises'", 'path.parse']) {
    t.absent(source.includes(forbidden), forbidden);
  }
});

async function temporaryRoot(t, label) {
  const root = await mkdtemp(join(tmpdir(), `seekdeep-${label}-`));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('real Localdrive 2.2.1 service adds app-local roots and reads bounded files', async function (t) {
  const root = await temporaryRoot(t, 'localdrive');
  let id = 0;
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, idFactory: () => `local-${++id}` });
  t.teardown(() => service.close());

  const added = await service.add('Notes', '@storage/work/notes');
  t.alike(added, { id: 'local-1', name: 'Notes', root: '@storage/work/notes', writable: false, status: 'ready' });
  t.absent(JSON.stringify(added).includes(root), 'descriptor never leaks an absolute path');

  await mkdir(join(root, 'work/notes/daily'), { recursive: true });
  await writeFile(join(root, 'work/notes/daily/today.txt'), 'hello localdrive');
  t.is(await readFile(join(root, 'work/notes/daily/today.txt'), 'utf8'), 'hello localdrive');
  t.alike(await service.get(added.id, '/daily/today.txt'), { path: '/daily/today.txt', content: 'hello localdrive', bytes: 16 });
  t.alike(await service.files('notes'), { files: ['/daily/today.txt'], capped: false });
  t.alike(await service.files('notes', '/daily'), { files: ['/daily/today.txt'], capped: false });
  t.alike(await service.status('notes'), { ...added, fileCount: 1, fileCountCapped: false });
  t.alike(await service.list(), [added]);
});

test('Localdrive mappings default read-only and removal retains filesystem contents', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-readonly');
  await mkdir(join(root, 'existing'), { recursive: true });
  await writeFile(join(root, 'existing/kept.txt'), 'keep me');
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, idFactory: () => 'local-readonly' });
  t.teardown(() => service.close());

  const added = await service.add('Archive', '@storage/existing');
  t.is(added.writable, false);
  await t.exception.all(() => service.put('archive', '/blocked.txt', 'no'), /read-only/i);
  t.is((await service.get('archive', '/kept.txt')).content, 'keep me');
  t.alike(await service.remove('archive'), { ...added, status: 'removed' });
  t.alike(await service.list(), []);
  t.is(await readFile(join(root, 'existing/kept.txt'), 'utf8'), 'keep me');
  await t.exception.all(() => service.status('archive'), /not found/i);
});

test('Localdrive rejects unsafe aliases, drive traversal, duplicates, and bounded overflows', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-validation');
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, maxMappings: 2, maxFiles: 2 });
  t.teardown(() => service.close());

  for (const alias of ['', '@storage', '@storage/', '@storage/../x', '@storage/a/./b', '@storage/a//b', '/tmp/x', '~/x', '@storage/a\\b', '@storage/a\0b']) {
    await t.exception.all(() => service.add('bad', alias), /alias|path|storage/i, alias);
  }
  for (const bad of ['', '/', '../x', '/a/../x', '/a//b', '/a/./b', 'a\\b', '/a\0b']) {
    await t.exception.all(() => normalizeLocalPath(bad), /path/i, bad);
  }
  t.is(normalizeLocalAlias('@storage/team/docs'), '@storage/team/docs');

  await service.add('Docs', '@storage/docs');
  await t.exception.all(() => service.add('docs', '@storage/other'), /name.*use|duplicate/i);
  await t.exception.all(() => service.add('Other', '@storage/docs'), /root.*use|duplicate/i);
  await service.add('Two', '@storage/two');
  await t.exception.all(() => service.add('Three', '@storage/three'), /limit/i);
  await t.exception.all(() => service.put('docs', '/huge.txt', 'x'.repeat(MAX_LOCAL_CONTENT_BYTES + 1)), /too large/i);
  await t.exception.all(() => service.get('docs', '../outside'), /path/i);

  await writeFile(join(root, 'docs/1.txt'), '1');
  await writeFile(join(root, 'docs/2.txt'), '2');
  await writeFile(join(root, 'docs/3.txt'), '3');
  t.alike(await service.files('docs'), { files: ['/1.txt', '/2.txt'], capped: true });
  const status = await service.status('docs');
  t.is(status.fileCount, 2);
  t.is(status.fileCountCapped, true);
});

test('Localdrive rejects mapping and operation symlink escapes', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-links');
  const outside = await temporaryRoot(t, 'localdrive-outside');
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(root, 'escape'));
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs });
  t.teardown(() => service.close());

  await t.exception.all(() => service.add('escape', '@storage/escape'), /symbolic link|symlink|outside/i);
  await mkdir(join(root, 'safe'), { recursive: true });
  await service.add('safe', '@storage/safe');
  await symlink(outside, join(root, 'safe/link'));
  await t.exception.all(() => service.get('safe', '/link/secret.txt'), /symbolic link|symlink|outside/i);
});

test('Localdrive caps text reads before loading oversized content and close is idempotent', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-caps');
  const mapped = join(root, 'large');
  await mkdir(mapped, { recursive: true });
  await writeFile(join(mapped, 'large.txt'), 'x'.repeat(MAX_LOCAL_CONTENT_BYTES + 1));
  let closes = 0;
  class FakeLocaldrive {
    constructor() {}
    async ready() {}
    async close() { closes += 1; }
  }
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, Localdrive: FakeLocaldrive });
  const added = await service.add('large', '@storage/large');
  await t.exception.all(() => service.get(added.id, '/large.txt'), /too large/i);
  await Promise.all([service.close(), service.close()]);
  t.is(closes, 1);
  await t.exception.all(() => service.list(), /closed/i);
});

test('Localdrive rejects writable mappings when no race-safe filesystem primitive exists', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-write-race');
  const outside = await temporaryRoot(t, 'localdrive-write-race-outside');
  await writeFile(join(outside, 'untouched.txt'), 'outside');
  let puts = 0;
  class RacingLocaldrive {
    async ready() {}
    async put() { puts += 1; await writeFile(join(outside, 'escaped.txt'), 'escaped'); }
    async close() {}
  }
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, Localdrive: RacingLocaldrive });
  t.teardown(() => service.close());

  await t.exception.all(() => service.add('unsafe', '@storage/unsafe', true), /writable.*not supported|race-safe/i);
  t.is(puts, 0, 'the unsafe Localdrive mutation is never reached');
  await t.exception.all(() => readFile(join(outside, 'escaped.txt')), /ENOENT/);
  t.is(await readFile(join(outside, 'untouched.txt'), 'utf8'), 'outside');
});

test('Localdrive rejects intermediate and mapped-root swaps after precheck without returning raced bytes', async function (t) {
  for (const raceTarget of ['intermediate', 'root']) {
    const root = await temporaryRoot(t, `localdrive-read-race-${raceTarget}`);
    const outside = await temporaryRoot(t, `localdrive-read-race-${raceTarget}-outside`);
    const mapped = join(root, 'safe');
    const insideDirectory = join(mapped, 'inside');
    const swapped = raceTarget === 'root' ? mapped : insideDirectory;
    const parked = `${swapped}-parked`;
    await mkdir(insideDirectory, { recursive: true });
    await writeFile(join(insideDirectory, 'secret.txt'), 'inside');
    const outsideFileDirectory = join(outside, 'inside');
    await mkdir(outsideFileDirectory, { recursive: true });
    const linkDestination = raceTarget === 'root' ? outside : outsideFileDirectory;
    await writeFile(join(outsideFileDirectory, 'secret.txt'), 'OUTSIDE-RACED');

    let racedContent = null;
    let armed = false;
    const racingFs = {
      ...nodeFs,
      async readFile(filename, ...args) {
        if (armed && filename === join(insideDirectory, 'secret.txt')) {
          armed = false;
          await rename(swapped, parked);
          await symlink(linkDestination, swapped);
        }
        const content = await nodeFs.readFile(filename, ...args);
        racedContent = content.toString();
        return content;
      }
    };
    const service = createLocaldriveService({ localdriveRoot: root, fs: racingFs });
    t.teardown(() => service.close());
    await service.add('safe', '@storage/safe');
    armed = true;

    const [result] = await Promise.allSettled([service.get('safe', '/inside/secret.txt')]);
    t.is(racedContent, 'OUTSIDE-RACED', `${raceTarget} race reached external bytes inside the filesystem wrapper`);
    t.is(result.status, 'rejected', `${raceTarget} race is rejected before bytes can be returned`);
    if (result.status === 'rejected') {
      t.is(result.reason.code, 'LOCALDRIVE_PATH_CHANGED');
      t.absent(result.reason.message.includes(outside));
      t.absent(result.reason.message.includes(root));
    }
  }
});

test('Localdrive rejects a raced listing when the mapped root changes during iteration', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-list-race');
  const outside = await temporaryRoot(t, 'localdrive-list-race-outside');
  const mapped = join(root, 'safe');
  const parked = join(root, 'safe-parked');
  await mkdir(mapped, { recursive: true });
  await writeFile(join(mapped, 'inside.txt'), 'inside');
  await writeFile(join(outside, 'secret.txt'), 'outside');

  class RacingLocaldrive {
    constructor(rootPath) { this.root = rootPath; }
    async ready() {}
    async *list() {
      yield { key: '/inside.txt', value: { blob: true } };
      await rename(this.root, parked);
      await symlink(outside, this.root);
      yield { key: '/secret.txt', value: { blob: true } };
    }
    async close() {}
  }
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, Localdrive: RacingLocaldrive });
  t.teardown(() => service.close());
  await service.add('safe', '@storage/safe');

  const [result] = await Promise.allSettled([service.files('safe')]);
  t.is(result.status, 'rejected');
  if (result.status === 'rejected') {
    t.absent(result.reason.message.includes(outside));
    t.absent(result.reason.message.includes(root));
  }
});

test('Localdrive close failures retain records, clear rejected promises, and retry without double-close', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-close-retry');
  let next = 0;
  const closes = new Map();
  class FlakyLocaldrive {
    constructor(rootPath) { this.root = rootPath; closes.set(rootPath, 0); }
    async ready() {}
    async close() {
      const count = closes.get(this.root) + 1;
      closes.set(this.root, count);
      if (this.root.endsWith('/one') && count === 1) throw new Error('transient close failure');
    }
  }
  const service = createLocaldriveService({
    localdriveRoot: root,
    fs: nodeFs,
    Localdrive: FlakyLocaldrive,
    idFactory: () => `local-${++next}`
  });
  const one = await service.add('one', '@storage/one');
  await service.add('two', '@storage/two');

  await t.exception.all(() => service.remove(one.id), /close failed/i);
  t.is((await service.list()).length, 2, 'failed removal retains the live mapping');
  t.alike(await service.remove(one.id), { ...one, status: 'removed' });
  t.is(closes.get(join(root, 'one')), 2, 'remove retries the failed close');

  await service.close();
  t.is(closes.get(join(root, 'one')), 2, 'removed mapping is not closed again');
  t.is(closes.get(join(root, 'two')), 1);
});

test('Localdrive service close resets after failure and retries only resources that remain live', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-service-close-retry');
  const closes = new Map();
  class FlakyLocaldrive {
    constructor(rootPath) { this.root = rootPath; closes.set(rootPath, 0); }
    async ready() {}
    async close() {
      const count = closes.get(this.root) + 1;
      closes.set(this.root, count);
      if (this.root.endsWith('/flaky') && count === 1) throw new Error('transient close failure');
    }
  }
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, Localdrive: FlakyLocaldrive });
  await service.add('flaky', '@storage/flaky');
  await service.add('steady', '@storage/steady');

  await t.exception.all(() => service.close(), /shutdown failed/i);
  await service.close();
  t.is(closes.get(join(root, 'flaky')), 2);
  t.is(closes.get(join(root, 'steady')), 1, 'successful close is memoized');
});

test('Localdrive globally prevents normalized name and id ambiguity with bounded retries', async function (t) {
  const root = await temporaryRoot(t, 'localdrive-reference-ambiguity');
  const ids = ['local-1', 'docs', 'DOCS', 'local-2'];
  const service = createLocaldriveService({ localdriveRoot: root, fs: nodeFs, idFactory: () => ids.shift() });
  t.teardown(() => service.close());

  const docs = await service.add('Docs', '@storage/docs');
  const other = await service.add('Other', '@storage/other');
  t.is(docs.id, 'local-1');
  t.is(other.id, 'local-2', 'ids colliding with any normalized name are retried');
  await t.exception.all(() => service.add(' LOCAL-1 ', '@storage/collision'), /name.*id|reference.*use|already.*use/i);
  t.is((await service.status('docs')).id, docs.id);
  t.is((await service.status('LOCAL-2')).name, 'Other');
});

test('Localdrive filesystem failures are sanitized without configured-path leakage', async function (t) {
  const root = join(await temporaryRoot(t, 'localdrive-redaction'), 'private-root');
  const leaking = new Error(`EACCES: permission denied, lstat '${root}'`);
  leaking.code = 'EACCES';
  const fs = {
    mkdir: async () => {},
    realpath: async () => root,
    lstat: async () => { throw leaking; }
  };
  const service = createLocaldriveService({ localdriveRoot: root, fs });
  const result = await Promise.allSettled([service.add('docs', '@storage/docs')]);
  t.is(result[0].status, 'rejected');
  t.is(result[0].reason.code, 'LOCALDRIVE_ADD_FAILED');
  t.is(result[0].reason.message, 'Localdrive add failed');
  t.absent(result[0].reason.message.includes(root));
  await service.close();
});
