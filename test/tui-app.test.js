import test from 'brittle';
import { createTui } from '../js/tui/app.js';

const TOPIC = 'ab'.repeat(32);

function createOutput() {
  const chunks = [];
  return {
    isTTY: false,
    write: (text) => chunks.push(text),
    text: () => chunks.join('')
  };
}

function createFakeClient(responses = {}) {
  const calls = [];
  const handlers = new Map();
  const client = {
    calls,
    closed: false,
    request(method, params) {
      calls.push({ method, params });
      const handler = responses[method];
      if (typeof handler === 'function') return Promise.resolve(handler(params));
      if (handler instanceof Error) return Promise.reject(handler);
      return Promise.resolve(handler ?? {});
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(handler);
      return () => set.delete(handler);
    },
    emit(event, data) {
      for (const handler of handlers.get(event) || []) handler(data);
    },
    close() { client.closed = true; }
  };
  return client;
}

function createFakeReadline() {
  const handlers = new Map();
  const iface = {
    closed: false,
    paused: false,
    prompts: 0,
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(handler);
      return () => set.delete(handler);
    },
    emitLine(text) {
      for (const handler of handlers.get('line') || []) handler(text);
    },
    close() { iface.closed = true; },
    pause() { iface.paused = true; },
    resume() { iface.paused = false; },
    prompt() { iface.prompts += 1; }
  };
  return iface;
}

function setup({ args = {}, responses = {}, depth = 'none' } = {}) {
  const client = createFakeClient({
    'chat.status': { topic: null },
    'chat.create': { topic: TOPIC, role: 'host' },
    'chat.join': { topic: TOPIC, role: 'peer' },
    'chat.refreshModels': { provider: 'ollama', models: [] },
    ...responses
  });
  const rl = createFakeReadline();
  const output = createOutput();
  const tui = createTui({ client, input: {}, output, readline: () => rl, args, depth });
  return { client, rl, output, tui };
}

test('start() creates a room when no topic is supplied', async function (t) {
  const { client, tui } = setup();
  const run = tui.start();
  await tui.ready;
  const methods = client.calls.map((call) => call.method);
  t.ok(methods.includes('chat.create'));
  t.not(methods.includes('chat.join'));
  tui.stop();
  await run;
});

test('start() joins the topic when one is supplied', async function (t) {
  const { client, tui } = setup({ args: { topic: TOPIC } });
  tui.start();
  await tui.ready;
  const join = client.calls.find((call) => call.method === 'chat.join');
  t.ok(join);
  t.is(join.params.topic, TOPIC);
  t.not(client.calls.some((call) => call.method === 'chat.create'));
  tui.stop();
});

test('submitting a prompt without a model prints guidance and sends nothing', async function (t) {
  const { client, output, tui } = setup();
  tui.start();
  await tui.ready;
  await tui.submit('hello');
  t.ok(output.text().includes('No model selected'));
  t.not(client.calls.some((call) => call.method === 'chat.send'));
  tui.stop();
});

test('/model resolves an index from the seeded list and later prompts send it', async function (t) {
  const { client, tui } = setup();
  tui.start();
  await tui.ready;
  client.emit('chat.event', { type: 'models', provider: 'ollama', models: [{ name: 'llama3' }, { name: 'qwen' }] });
  await tui.submit('/model 1');
  await tui.submit('hello');
  const send = client.calls.find((call) => call.method === 'chat.send');
  t.ok(send);
  t.is(send.params.model, 'llama3');
  t.is(send.params.prompt, 'hello');
  tui.stop();
});

test('/model without an argument reports usage', async function (t) {
  const { output, tui } = setup();
  tui.start();
  await tui.ready;
  await tui.submit('/model');
  t.ok(output.text().includes('Usage: /model'));
  tui.stop();
});

test('forwards non-local slash input to slash.dispatch', async function (t) {
  const { client, tui } = setup();
  tui.start();
  await tui.ready;
  await tui.submit('/p2p help drive');
  const dispatch = client.calls.find((call) => call.method === 'slash.dispatch');
  t.ok(dispatch);
  t.is(dispatch.params.text, '/p2p help drive');
  tui.stop();
});

test('streamed response chunks render as one assistant message', async function (t) {
  const { client, output, rl, tui } = setup();
  tui.start();
  await tui.ready;
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: 'par', done: false });
  t.ok(rl.paused);
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: 'tial', done: true });
  t.ok(output.text().includes('ai \u276f partial\n'));
  t.not(rl.paused);
  tui.stop();
});

test('streamed reasoning markers render only the answer', async function (t) {
  const { client, output, tui } = setup();
  tui.start();
  await tui.ready;
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: '<' + 'think>', done: false });
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: 'secret reasoning', done: false });
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: '<' + '/think>', done: false });
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: 'answer', done: true });
  const text = output.text();
  t.ok(text.includes('answer'));
  t.not(text.includes('secret reasoning'));
  t.ok(text.includes('thinking'));
  tui.stop();
});

test('harness slash events render through the ephemeral renderer', async function (t) {
  const { client, output, tui } = setup();
  tui.start();
  await tui.ready;
  client.emit('harness.event', { type: 'slash', content: 'hi there', metadata: { kind: 'slash-help' } });
  t.ok(output.text().includes('hi there'));
  tui.stop();
});

test('/quit closes readline and resolves the run promise', async function (t) {
  const { rl, tui } = setup();
  const run = tui.start();
  await tui.ready;
  await tui.submit('/quit');
  t.ok(rl.closed);
  await run;
});

test('after stop, submit is a no-op', async function (t) {
  const { client, tui } = setup();
  tui.start();
  await tui.ready;
  tui.stop();
  const before = client.calls.length;
  await tui.submit('hello');
  t.is(client.calls.length, before);
});

test('stop() closes the client', async function (t) {
  const { client, tui } = setup();
  tui.start();
  await tui.ready;
  tui.stop();
  t.ok(client.closed);
});

test('streamed markdown renders the formatted answer', async function (t) {
  const { client, output, tui } = setup();
  tui.start();
  await tui.ready;
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: '## Hi\n', done: false });
  client.emit('chat.event', { type: 'response', requestId: 'r1', chunk: '- a\n- b\n', done: true });
  const text = output.text();
  t.ok(text.includes('ai \u276f Hi\n'));
  t.ok(text.includes('\u2022 a\n\u2022 b\n'));
  t.not(text.includes('##'));
  tui.stop();
});
