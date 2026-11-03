import test from 'brittle';
import * as nodeFs from 'node:fs/promises';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createHarness } from '../js/harness/harness.js';
import { createHarnessSync } from '../js/harness/sync.js';
import { createBotService, REPLY_COOLDOWN_MS } from '../js/p2p/bot-service.js';

const BUILTIN_PLUGINS = fileURLToPath(new URL('../plugins', import.meta.url));

function stubDriveService() {
  const records = new Map();
  let counter = 0;
  const byKey = new Map();
  function resolve(reference) {
    if (records.has(reference)) return records.get(reference);
    const record = byKey.get(reference);
    if (!record) throw new Error(`Drive not found: ${reference}`);
    return record;
  }
  return {
    async create(name) {
      counter += 1;
      const key = String(counter).padStart(64, 'a').slice(-64);
      const record = { name, key, writable: true, version: 1, files: new Map() };
      records.set(name, record);
      byKey.set(key, record);
      return { name, key, writable: true, version: 1 };
    },
    async open(key, name) {
      counter += 1;
      let record = byKey.get(key);
      if (!record) {
        record = { name, key, writable: false, version: 1, files: new Map() };
        byKey.set(key, record);
      }
      if (name) records.set(name, record);
      return { name, key, writable: record.writable, version: record.version };
    },
    async status(reference) {
      const record = resolve(reference);
      return { name: record.name, key: record.key, writable: record.writable, version: record.version };
    },
    async put(reference, filePath, content) {
      const record = resolve(reference);
      if (!record.writable) throw new Error('Drive is read-only');
      if (content.length > 64 * 1024) throw new RangeError('Drive content is too large');
      record.files.set(filePath, content);
      record.version += 1;
      return { path: filePath, bytes: content.length };
    },
    async get(reference, filePath) {
      const record = resolve(reference);
      if (!record.files.has(filePath)) throw new Error(`Drive file not found: ${filePath}`);
      const content = record.files.get(filePath);
      return { path: filePath, content, bytes: content.length };
    },
    async list() { return Array.from(records.values()); },
    async closeDrive() {}
  };
}

async function makeHarness(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seekdeep-harness-'));
  const driveService = overrides.driveService || stubDriveService();
  const harness = await createHarness({
    storageRoot: root,
    builtinPluginsDir: null,
    driveService,
    fs: nodeFs,
    createSync: (ctx) => createHarnessSync(ctx),
    logger: { warn() {}, error() {} },
    ...overrides
  });
  return { harness, root, driveService };
}

async function writePlugin(root, name, source) {
  const dir = join(root, 'plugins', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.js'), source);
}

const HELLO = `export default {
  name: 'hello',
  version: '1.0.0',
  commands: [{ name: 'hello', summary: 'Say hi.', usage: '/hello', handler: () => ({ content: 'hello', metadata: {} }) }]
};
`;

test('harness loads an on-disk user plugin and dispatches its command', async function (t) {
  const { harness, root } = await makeHarness();
  t.teardown(async () => { await harness.close(); await rm(root, { recursive: true, force: true }); });
  await writePlugin(root, 'hello', HELLO);
  await harness.reload();

  const events = [];
  harness.onEvent((event) => events.push(event));
  t.is(harness.list().plugins.some((plugin) => plugin.name === 'hello'), true);

  const handled = await harness.dispatch('/hello');
  t.is(handled, true);
  const slash = events.find((event) => event.type === 'slash');
  t.alike(slash, { type: 'slash', content: 'hello', metadata: {} });
});

test('harness loads built-in plugins and lists help for every command', async function (t) {
  const { harness, root } = await makeHarness({ builtinPluginsDir: BUILTIN_PLUGINS });
  t.teardown(async () => { await harness.close(); await rm(root, { recursive: true, force: true }); });

  const names = harness.runtime.list().map((entry) => entry.name);
  for (const name of ['p2p', 'swarm', 'dht', 'drive', 'localdrive', 'mirror', 'beam', 'harness', 'bot']) {
    t.ok(names.includes(name), `runtime lists /${name}`);
  }
});

test('harness skips duplicate plugin names and disabled plugins', async function (t) {
  const { harness, root } = await makeHarness({ builtinPluginsDir: BUILTIN_PLUGINS });
  t.teardown(async () => { await harness.close(); await rm(root, { recursive: true, force: true }); });
  await writePlugin(root, 'p2p-core', `export default { name: 'p2p-core', version: '9.9.9', commands: [] };\n`);
  const events = [];
  harness.onEvent((event) => events.push(event));
  await harness.reload();

  t.ok(events.some((event) => event.type === 'plugin' && event.status === 'skipped' && event.plugin === 'p2p-core'), 'duplicate is skipped');
  t.ok(harness.list().plugins.find((plugin) => plugin.name === 'p2p-core').source === 'builtin', 'built-in wins');

  await harness.disable('bot');
  t.is(harness.list().plugins.find((plugin) => plugin.name === 'bot'), undefined, 'disabled plugin is not loaded');
  await harness.enable('bot');
  t.ok(harness.list().plugins.some((plugin) => plugin.name === 'bot'), 'plugin can be re-enabled');
});

test('harness sync publishes and consumes plugins over a shared drive', async function (t) {
  const driveService = stubDriveService();
  const owner = await makeHarness({ driveService });
  const followerRoot = await mkdtemp(join(tmpdir(), 'seekdeep-harness-'));
  const follower = await createHarness({
    storageRoot: followerRoot,
    builtinPluginsDir: null,
    driveService,
    fs: nodeFs,
    createSync: (ctx) => createHarnessSync(ctx),
    logger: { warn() {}, error() {} }
  });
  t.teardown(async () => {
    await owner.harness.close();
    await follower.close();
    await rm(owner.root, { recursive: true, force: true });
    await rm(followerRoot, { recursive: true, force: true });
  });

  await writePlugin(owner.root, 'hello', HELLO);
  await owner.harness.reload();
  const created = await owner.harness.sync().create();
  t.is(typeof created.key, 'string');
  t.is(created.files >= 1, true, 'push publishes the plugin file');

  const joined = await follower.sync().join(created.key);
  t.is(joined.files >= 1, true);
  t.ok(follower.list().plugins.some((plugin) => plugin.name === 'hello'), 'follower loads the synced plugin');

  const events = [];
  follower.onEvent((event) => events.push(event));
  t.is(await follower.dispatch('/hello'), true);
  t.is(events.find((event) => event.type === 'slash').content, 'hello');
});

test('bot service answers a peer once and never answers itself', async function (t) {
  const topicJoins = [];
  const sockets = [];
  const swarm = {
    on(event, handler) { if (event === 'connection') this.connection = handler; },
    join(topic) { topicJoins.push(topic); return { flushed: Promise.resolve(), async destroy() {} }; },
    async destroy() {}
  };
  const providers = {
    async autoSelect() { return 'ollama'; },
    async listModels() { return ['test-model']; },
    async chat(_provider, _model, _params, onEvent) { onEvent({ kind: 'text', text: 'pong' }); return ''; }
  };
  const bot = createBotService({
    key: 'ab'.repeat(32),
    providers,
    swarmFactory: () => swarm,
    now: () => 10000
  });
  t.teardown(async () => { await bot.close(); });

  await bot.enable();
  t.is(topicJoins.length, 1, 'joins a key-derived topic');

  const socket = new EventEmitter();
  const writes = [];
  socket.write = (line) => { writes.push(line); };
  socket.destroy = () => {};
  swarm.connection(socket);
  socket.emit('data', Buffer.from(`${JSON.stringify({ t: 'hello', id: 'peer-1', name: 'Peer' })}\n`));

  socket.emit('data', Buffer.from(`${JSON.stringify({ t: 'msg', bot: true, text: 'from a bot' })}\n`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.is(writes.filter((line) => JSON.parse(line).t === 'msg').length, 0, 'bot-authored messages are not answered');

  socket.emit('data', Buffer.from(`${JSON.stringify({ t: 'msg', text: 'are you there?' })}\n`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const replies = writes.map((line) => JSON.parse(line)).filter((frame) => frame.t === 'msg');
  t.is(replies.length, 1, 'a peer message gets exactly one reply');
  t.is(replies[0].bot, true);
  t.is(replies[0].text, 'pong');

  socket.emit('data', Buffer.from(`${JSON.stringify({ t: 'msg', text: 'again' })}\n`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.is(writes.map((line) => JSON.parse(line)).filter((frame) => frame.t === 'msg').length, 1, `second reply is throttled within ${REPLY_COOLDOWN_MS}ms`);
});

test('harness scaffolds a user plugin that is then loaded', async function (t) {
  const { harness, root } = await makeHarness();
  t.teardown(async () => { await harness.close(); await rm(root, { recursive: true, force: true }); });

  const created = await harness.scaffold('my-plugin');
  t.ok(created.path.endsWith(join('plugins', 'my-plugin', 'index.js')));
  await harness.reload();
  const plugin = harness.list().plugins.find((entry) => entry.name === 'my-plugin');
  t.ok(plugin, 'scaffolded plugin loads');
  t.alike(plugin.commands, ['my-plugin']);

  const events = [];
  harness.onEvent((event) => events.push(event));
  t.is(await harness.dispatch('/my-plugin Sam'), true);
  t.is(events.find((event) => event.type === 'slash').content, 'Hello, Sam!');
});
