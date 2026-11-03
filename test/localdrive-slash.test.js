import test from 'brittle';
import { readFile } from 'node:fs/promises';
import { dispatchSlashTag } from './helpers/slash-runtime.js';

function collector() {
  const output = [];
  return { output, ctx: { emitEphemeral(content, metadata) { output.push({ content, metadata }); } } };
}

function fakeLocaldrive() {
  const calls = [];
  const descriptor = { id: 'local-1', name: 'docs', root: '@storage/docs', writable: true, status: 'ready' };
  return {
    calls,
    async add(name, root, writable) { calls.push(['add', name, root, writable]); return { ...descriptor, name, root, writable }; },
    async list() { calls.push(['list']); return [descriptor]; },
    async status(ref) { calls.push(['status', ref]); return { ...descriptor, fileCount: 1, fileCountCapped: false }; },
    async files(ref, prefix) { calls.push(['files', ref, prefix]); return { files: ['/one.txt'], capped: false }; },
    async get(ref, path) { calls.push(['get', ref, path]); return { path, content: 'hello', bytes: 5 }; },
    async put(ref, path, content) { calls.push(['put', ref, path, content]); return { path, bytes: content.length }; },
    async remove(ref) { calls.push(['remove', ref]); return { ...descriptor, status: 'removed' }; }
  };
}

async function dispatch(input, localdrive = fakeLocaldrive()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { localdrive });
  return { ...result, localdrive };
}

test('/localdrive commands support explicit writable flag and safe app-storage aliases', async function (t) {
  const cases = [
    ['/localdrive add docs @storage/docs', ['add', 'docs', '@storage/docs', false], 'add'],
    ['/localdrive add edit @storage/edit --writable', ['add', 'edit', '@storage/edit', true], 'add'],
    ['/localdrive list', ['list'], 'list'],
    ['/localdrive status docs', ['status', 'docs'], 'status'],
    ['/localdrive files docs /notes', ['files', 'docs', '/notes'], 'files'],
    ['/localdrive get docs /one.txt', ['get', 'docs', '/one.txt'], 'get'],
    ['/localdrive put docs /one.txt "hello world"', ['put', 'docs', '/one.txt', 'hello world'], 'put'],
    ['/localdrive remove docs', ['remove', 'docs'], 'remove']
  ];
  for (const [input, call, action] of cases) {
    const { output, localdrive } = await dispatch(input);
    t.alike(localdrive.calls, [call], input);
    t.is(output.length, 1);
    t.is(output[0].metadata.kind, 'slash-localdrive');
    t.is(output[0].metadata.action, action);
    t.alike(JSON.parse(JSON.stringify(output[0])), output[0]);
  }
});

test('/localdrive rejects arbitrary paths, malformed flags, and bad command shapes before service access', async function (t) {
  for (const input of [
    '/localdrive', '/localdrive add', '/localdrive add docs /tmp/docs', '/localdrive add docs @storage',
    '/localdrive add docs @storage/docs extra', '/localdrive add docs @storage/docs --readonly',
    '/localdrive add docs @storage/docs --writable=yes', '/localdrive list extra',
    '/localdrive list --writable', '/localdrive status', '/localdrive files',
    '/localdrive get docs', '/localdrive put docs /x', '/localdrive remove'
  ]) {
    const { output, localdrive } = await dispatch(input);
    t.alike(localdrive.calls, [], input);
    t.is(output[0].metadata.kind, 'slash-error');
  }
});

test('/localdrive output excludes backend absolute paths and remains local-only', async function (t) {
  const forbidden = [];
  const context = new Proxy({ emitEphemeral(content, metadata) {
    const serialized = JSON.stringify({ content, metadata });
    t.absent(serialized.includes('/Users/private'));
  } }, {
    get(target, property) {
      if (property === 'emitEphemeral') return target.emitEphemeral;
      forbidden.push(String(property));
      throw new Error('forbidden');
    }
  });
  const localdrive = fakeLocaldrive();
  await dispatchSlashTag('/localdrive list', context, { localdrive });
  t.alike(forbidden, []);
  t.alike(localdrive.calls, [['list']]);
});

test('/localdrive rejects unsafe service results rather than leaking filesystem fields', async function (t) {
  const { output, ctx } = collector();
  await dispatchSlashTag('/localdrive list', ctx, { localdrive: { list: async () => [{
    id: 'local-1', name: 'docs', root: '@storage/docs', writable: false, status: 'ready', absolutePath: '/Users/private'
  }] } });
  t.is(output[0].metadata.kind, 'slash-error');
  t.absent(JSON.stringify(output).includes('/Users/private'));
});

test('/localdrive tag and adapter use only the injected RPC capability', async function (t) {
  const tag = await readFile(new URL('../js/slash/tags/localdrive.js', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../js/slash/services/localdrive.js', import.meta.url), 'utf8');
  const source = `${tag}\n${adapter}`;
  for (const forbidden of ['localdrive-service', 'worker-runtime', '/network/', '/history', '/llm/', 'persistence-manager', "from 'fs'", "from 'path'"]) {
    t.absent(source.includes(forbidden), forbidden);
  }
  t.absent(tag.includes('emitEphemeral'));
});
