import test from 'brittle';
import { readFile } from 'node:fs/promises';
import { dispatchSlashTag, listSlashTags } from '../js/slash/registry.js';

function collector() {
  const output = [];
  return { output, ctx: { emitEphemeral(content, metadata) { output.push({ content, metadata }); } } };
}

function fakeMirror() {
  const calls = [];
  const descriptor = {
    id: 'mirror-1', localId: 'local-1', driveId: 'drive-1', status: 'queued',
    dryRun: true, prune: false, prefix: '/',
    counts: { diffs: 0, files: 0, add: 0, change: 0, remove: 0, bytesObserved: 0, bytesAdded: 0, bytesRemoved: 0 },
    paths: [], pathsCapped: false, limitReason: null, error: null
  };
  return {
    calls,
    descriptor,
    async start(localRef, driveRef, options) { calls.push(['start', localRef, driveRef, options]); return { ...descriptor }; },
    async status(id) { calls.push(['status', id]); return id ? { ...descriptor, status: 'completed' } : [{ ...descriptor }]; },
    async stop(id) { calls.push(['stop', id]); return { ...descriptor, status: 'stopped' }; }
  };
}

async function dispatch(input, mirror = fakeMirror()) {
  const result = collector();
  await dispatchSlashTag(input, result.ctx, { mirror });
  return { ...result, mirror };
}

test('/mirror start defaults to dry-run/no-prune and supports only safe options', async function (t) {
  const basic = await dispatch('/mirror start docs backup');
  t.alike(basic.mirror.calls, [['start', 'docs', 'backup', { dryRun: true, prune: false, prefix: '/' }]]);
  t.ok(/dry run/i.test(basic.output[0].content));
  t.is(basic.output[0].metadata.kind, 'slash-mirror');

  const prefixed = await dispatch('/mirror start docs backup --dry-run --no-prune --prefix=/safe/path');
  t.alike(prefixed.mirror.calls, [['start', 'docs', 'backup', { dryRun: true, prune: false, prefix: '/safe/path' }]]);

  for (const input of [
    '/mirror start docs backup --apply', '/mirror start docs backup --prune',
    '/mirror start docs backup --prefix=/../escape', '/mirror start docs backup --prefix=/safe//bad',
    '/mirror start docs', '/mirror start docs backup extra', '/mirror start docs backup --dry-run=yes',
    '/mirror run docs backup', '/mirror start docs backup --unknown'
  ]) {
    const result = await dispatch(input);
    t.alike(result.mirror.calls, [], input);
    t.is(result.output[0].metadata.kind, 'slash-error');
  }
});

test('/mirror status and stop call only the injected capability', async function (t) {
  const list = await dispatch('/mirror status');
  t.alike(list.mirror.calls, [['status', undefined]]);
  t.is(list.output[0].metadata.action, 'status');
  const one = await dispatch('/mirror status mirror-1');
  t.alike(one.mirror.calls, [['status', 'mirror-1']]);
  const stopped = await dispatch('/mirror stop mirror-1');
  t.alike(stopped.mirror.calls, [['stop', 'mirror-1']]);
  t.is(stopped.output[0].metadata.action, 'stop');
});

test('/mirror output rejects unsafe descriptor fields and stays local-only', async function (t) {
  const unsafe = fakeMirror();
  unsafe.status = async () => [{ ...unsafe.descriptor, rootPath: '/Users/private/source' }];
  const result = await dispatch('/mirror status', unsafe);
  t.is(result.output[0].metadata.kind, 'slash-error');
  t.absent(JSON.stringify(result.output).includes('/Users/private'));

  const tag = await readFile(new URL('../js/slash/tags/mirror.js', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../js/slash/services/mirror.js', import.meta.url), 'utf8');
  const source = `${tag}\n${adapter}`;
  for (const forbidden of ['mirror-drive', 'localdrive-service', 'hyperdrive-service', 'drive-runtime', '/network/', '/history', '/llm/', 'persistence-manager', "from 'fs'", "from 'path'"]) {
    t.absent(source.includes(forbidden), forbidden);
  }
  t.absent(tag.includes('emitEphemeral'));
  const row = listSlashTags().find((entry) => entry.name === 'mirror');
  t.is(row.implemented, true);
  t.ok(/start.*status.*stop/.test(row.usage));
  t.ok(/dry-run/i.test(row.usage));
});
