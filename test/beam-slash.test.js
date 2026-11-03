import test from 'brittle';
import { readFile } from 'node:fs/promises';
import { dispatchSlashTag, listSlashTags } from './helpers/slash-runtime.js';

const KEY = 'a'.repeat(52);
const base = { id: 'beam-1', name: 'sender', status: 'connecting', connected: false, pending: 0, sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0 };

function fakeBeam() {
  const calls = [];
  return {
    calls,
    async create(name) { calls.push(['create', name]); return { descriptor: { ...base, name }, key: KEY }; },
    async join(name, key) { calls.push(['join', name, key]); return { ...base, id: 'beam-2', name }; },
    async list() { calls.push(['list']); return [{ ...base }]; },
    async status(ref) { calls.push(['status', ref]); return { ...base }; },
    async send(ref, content) { calls.push(['send', ref, content]); return { id: 'beam-1', bytes: new TextEncoder().encode(content).byteLength, sentMessages: 1, sentBytes: new TextEncoder().encode(content).byteLength }; },
    async receive(ref) { calls.push(['receive', ref]); return { messages: ['hello'], bytes: 5, pending: 0 }; },
    async close(ref) { calls.push(['close', ref]); return { ...base, status: 'closed' }; }
  };
}

async function dispatch(input, beam = fakeBeam()) {
  const output = [];
  await dispatchSlashTag(input, { emitEphemeral(content, metadata) { output.push({ content, metadata }); } }, { beam });
  return { output, beam };
}

test('/beam lifecycle is implemented through the injected service and returns JSON-safe descriptors', async function (t) {
  const cases = [
    ['/beam create sender', ['create', 'sender'], 'create'],
    [`/beam join receiver ${KEY}`, ['join', 'receiver', KEY], 'join'],
    ['/beam list', ['list'], 'list'],
    ['/beam status sender', ['status', 'sender'], 'status'],
    ['/beam send sender "hello world"', ['send', 'sender', 'hello world'], 'send'],
    ['/beam receive sender', ['receive', 'sender'], 'receive'],
    ['/beam close sender', ['close', 'sender'], 'close']
  ];
  for (const [input, call, action] of cases) {
    const result = await dispatch(input);
    t.alike(result.beam.calls, [call], input);
    t.is(result.output[0].metadata.kind, 'slash-beam');
    t.is(result.output[0].metadata.action, action);
    t.alike(JSON.parse(JSON.stringify(result.output[0])), result.output[0]);
  }
  const created = await dispatch('/beam create sender');
  t.ok(created.output[0].content.includes(KEY), 'create explicitly returns the share capability');
  t.absent(JSON.stringify(created.output[0].metadata).includes(KEY), 'capability is not copied into metadata/descriptors');
});

test('/beam rejects malformed commands before touching the service', async function (t) {
  for (const input of ['/beam', '/beam join receiver bad', '/beam send sender', '/beam receive', '/beam close', '/beam list extra', '/beam create x --flag']) {
    const result = await dispatch(input);
    t.alike(result.beam.calls, [], input);
    t.is(result.output[0].metadata.kind, 'slash-error');
  }
});

test('/beam sources keep stream handles in the parent service and registry help is honest', async function (t) {
  const tag = await readFile(new URL('../js/slash/tags/beam.js', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../js/slash/services/beam.js', import.meta.url), 'utf8');
  const source = `${tag}\n${adapter}`;
  for (const forbidden of ['hyperbeam', 'hyperswarm', '/network/', '/history', '/llm/', 'persistence-manager']) t.absent(source.toLowerCase().includes(forbidden), forbidden);
  t.absent(tag.includes('emitEphemeral'));
  const row = listSlashTags().find((entry) => entry.name === 'beam');
  t.is(row.implemented, true);
  t.ok(/create.*join.*list.*status.*send.*receive.*close/.test(row.usage));
});
