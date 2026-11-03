import test from 'brittle';
import * as nodeFs from 'node:fs/promises';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duplex } from 'node:stream';
import { createHarness } from '../js/harness/harness.js';
import { createHarnessRpcMethods, createJsonRpcServer } from '../js/p2p/rpc-server.js';
import { createRpcClient } from '../js/p2p/rpc-client.js';

const BUILTIN_PLUGINS = fileURLToPath(new URL('../plugins', import.meta.url));

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

test('slash.list and slash.dispatch are served over the worker pipe', async function (t) {
  const root = await mkdtemp(join(tmpdir(), 'seekdeep-harness-rpc-'));
  const harness = await createHarness({
    storageRoot: root,
    builtinPluginsDir: BUILTIN_PLUGINS,
    fs: nodeFs,
    logger: { warn() {}, error() {} }
  });
  await mkdir(join(root, 'plugins', 'hello'), { recursive: true });
  await writeFile(join(root, 'plugins', 'hello', 'index.js'), `export default {
    name: 'hello', version: '1.0.0',
    commands: [{ name: 'hello', summary: 'Say hi.', usage: '/hello', handler: () => ({ content: 'from plugin', metadata: {} }) }]
  };\n`);
  await harness.reload();

  const [clientPipe, serverPipe] = duplexPair();
  const server = createJsonRpcServer(serverPipe, createHarnessRpcMethods(harness));
  harness.onEvent((event) => {
    const { type, ...data } = event;
    server.notify('harness.event', { type, ...data }).catch(() => {});
  });
  const client = createRpcClient({ pipeFactory: () => clientPipe, timeout: 2000 });
  t.teardown(async () => {
    client.close();
    await server.close();
    await harness.close();
    await rm(root, { recursive: true, force: true });
  });

  const events = [];
  client.on('harness.event', (event) => { if (event.type === 'slash') events.push(event); });

  const list = await client.request('slash.list', {});
  t.ok(list.some((entry) => entry.name === 'hello'), 'slash.list includes the user plugin command');
  t.ok(list.some((entry) => entry.name === 'harness'), 'slash.list includes built-in commands');

  const dispatched = await client.request('slash.dispatch', { text: '/hello' });
  t.alike(dispatched, { handled: true });
  t.alike(events, [{ type: 'slash', content: 'from plugin', metadata: {} }]);

  const plain = await client.request('slash.dispatch', { text: 'ordinary prompt' });
  t.alike(plain, { handled: false }, 'non-slash input is not handled');
});
