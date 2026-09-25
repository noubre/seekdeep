import test from 'brittle';
import { readFile } from 'node:fs/promises';
import { dispatchSlashTag } from '../js/slash/registry.js';

const KEY = 'ab'.repeat(32);

function collector() {
  const output = [];
  return { output, ctx: { emitEphemeral(content, metadata) { output.push({ content, metadata }); } } };
}

function fakeDrive() {
  const calls = [];
  const descriptor = { id: 'drive-1', name: 'docs', key: KEY, writable: true, status: 'ready', opened: true, discovering: true, version: 1 };
  return {
    calls,
    async create(name) { calls.push(['create', name]); return descriptor; },
    async open(key, name) { calls.push(['open', key, name]); return { ...descriptor, name: name || key.slice(0, 12), writable: false }; },
    async list() { calls.push(['list']); return [descriptor]; },
    async status(ref) { calls.push(['status', ref]); return { ...descriptor, fileCount: 1, fileCountCapped: false }; },
    async put(ref, path, content) { calls.push(['put', ref, path, content]); return { ...descriptor, path, bytes: content.length, version: 2 }; },
    async get(ref, path) { calls.push(['get', ref, path]); return { path, content: 'hello', bytes: 5 }; },
    async files(ref, prefix) { calls.push(['files', ref, prefix]); return { files: ['/notes.txt'], capped: false }; },
    async del(ref, path) { calls.push(['del', ref, path]); return { ...descriptor, path, deleted: true, version: 3 }; },
    async close(ref) { calls.push(['close', ref]); return { ...descriptor, status: 'closed', opened: false, discovering: false }; }
  };
}

async function dispatch(input, drive = fakeDrive()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { drive });
  return { ...result, drive };
}

test('/drive commands call only the injected service and return JSON-safe local output', async function (t) {
  const cases = [
    ['/drive create docs', ['create', 'docs'], 'create'],
    [`/drive open ${KEY} archive`, ['open', KEY, 'archive'], 'open'],
    ['/drive list', ['list'], 'list'],
    ['/drive status docs', ['status', 'docs'], 'status'],
    ['/drive put docs /notes.txt "hello world"', ['put', 'docs', '/notes.txt', 'hello world'], 'put'],
    ['/drive get docs /notes.txt', ['get', 'docs', '/notes.txt'], 'get'],
    ['/drive files docs /notes', ['files', 'docs', '/notes'], 'files'],
    ['/drive del docs /notes.txt', ['del', 'docs', '/notes.txt'], 'del'],
    ['/drive close docs', ['close', 'docs'], 'close']
  ];

  for (const [input, expectedCall, action] of cases) {
    const { output, drive } = await dispatch(input);
    t.alike(drive.calls, [expectedCall], input);
    t.is(output.length, 1);
    t.is(output[0].metadata.kind, 'slash-drive');
    t.is(output[0].metadata.action, action);
    t.alike(JSON.parse(JSON.stringify(output[0])), output[0]);
    t.absent(JSON.stringify(output[0]).includes('secretKey'));
  }
});

test('/drive validates command shapes and public keys before service access', async function (t) {
  for (const input of [
    '/drive', '/drive create', '/drive create one two', '/drive open nope',
    `/drive open ${KEY} one two`, '/drive list extra', '/drive status',
    '/drive put docs /x', '/drive get docs', '/drive files', '/drive del docs', '/drive close'
  ]) {
    const { output, drive } = await dispatch(input);
    t.alike(drive.calls, [], input);
    t.is(output[0].metadata.kind, 'slash-error');
  }
});

test('/drive output remains ephemeral and never accesses hidden context boundaries', async function (t) {
  const forbidden = [];
  const context = new Proxy({ emitEphemeral() {} }, {
    get(target, property) {
      if (property === 'emitEphemeral') return target.emitEphemeral;
      forbidden.push(String(property));
      throw new Error('forbidden');
    }
  });
  const drive = fakeDrive();
  await dispatchSlashTag('/drive list', context, { drive });
  t.alike(forbidden, []);
  t.alike(drive.calls, [['list']]);
});

test('/drive tag and service adapter keep backend, network, history, LLM, and persistence outside the slash boundary', async function (t) {
  const tag = await readFile(new URL('../js/slash/tags/drive.js', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../js/slash/services/drive.js', import.meta.url), 'utf8');
  const source = `${tag}\n${adapter}`;
  for (const forbidden of ['hyperdrive-service', 'drive-runtime', '/network/', '/history', '/llm/', 'persistence-manager']) {
    t.absent(source.includes(forbidden), forbidden);
  }
  t.absent(tag.includes('emitEphemeral'), 'handler returns results; only the registry dispatcher emits');
});
