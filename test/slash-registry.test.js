import test from 'brittle';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slashRegistry,
  listSlashTags,
  dispatchSlashTag,
  dispatchSlashTagWithCommands,
  helpServices
} from './helpers/slash-runtime.js';

const expectedCommands = ['p2p', 'swarm', 'dht', 'drive', 'localdrive', 'mirror', 'beam'];

function collector(extra = {}) {
  const output = [];
  return {
    output,
    ctx: {
      ...extra,
      emitEphemeral(content, metadata) {
        output.push({ content, metadata });
      }
    }
  };
}

function privacyCollector() {
  const output = [];
  const forbiddenOperations = [];
  const forbid = (operation) => function () {
    forbiddenOperations.push(operation);
    throw new Error(`slash dispatch crossed privacy boundary: ${operation}`);
  };
  const connection = Object.freeze({
    write: forbid('connection.write'),
    send: forbid('connection.send')
  });
  const forbiddenContext = {
    addMessage: forbid('addMessage'),
    appendMessage: forbid('appendMessage'),
    saveMessage: forbid('saveMessage'),
    persist: forbid('persist'),
    save: forbid('save'),
    sendToLLM: forbid('sendToLLM'),
    callProvider: forbid('callProvider'),
    broadcastToPeers: forbid('broadcastToPeers'),
    sendToPeer: forbid('sendToPeer'),
    messages: Object.freeze([]),
    history: Object.freeze([]),
    persistence: Object.freeze({ write: forbid('persistence.write') }),
    llm: Object.freeze({ send: forbid('llm.send') }),
    provider: Object.freeze({ send: forbid('provider.send') }),
    network: Object.freeze({ send: forbid('network.send') }),
    messaging: Object.freeze({ send: forbid('messaging.send') }),
    conns: Object.freeze([connection]),
    connections: Object.freeze([connection])
  };

  const ctx = new Proxy(forbiddenContext, {
    get(target, property) {
      if (property === 'emitEphemeral') {
        return (content, metadata) => output.push({ content, metadata });
      }
      if (Reflect.has(target, property)) {
        forbiddenOperations.push(`ctx.${String(property)}`);
        throw new Error(`slash dispatch accessed privacy boundary: ctx.${String(property)}`);
      }
      forbiddenOperations.push(`unexpected ctx.${String(property)}`);
      throw new Error(`slash dispatch accessed unexpected context: ctx.${String(property)}`);
    },
    set(_target, property) {
      forbiddenOperations.push(`ctx.${String(property)}=`);
      throw new Error(`slash dispatch wrote context: ctx.${String(property)}`);
    }
  });

  return { ctx, output, forbiddenOperations };
}

function guardedServices() {
  const accesses = [];
  const callbacks = Object.freeze({
    output() {},
    persist() {},
    provider() {},
    transport() {}
  });
  const services = new Proxy(callbacks, {
    get(target, property, receiver) {
      accesses.push(String(property));
      throw new Error(`slash handler accessed hidden service callback: ${String(property)}`);
    }
  });
  return { services, accesses };
}

function slashSourceFiles() {
  const slashDirectory = fileURLToPath(new URL('../js/slash/', import.meta.url));
  const tagDirectory = join(slashDirectory, 'tags');
  return readdirSync(tagDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(tagDirectory, entry.name));
}

// Defense in depth only: runtime proxy tests above enforce the capability
// boundary. Keep this narrow so legitimate service names do not false-positive.
const forbiddenSourceBoundaries = [
  ['direct output', /\b(?:ctx|emitEphemeral)\b/],
  ['direct external module import', /from\s+['"][^'"]*(?:network|messages|llm|storage)[^'"]*['"]/i]
];

test('registry describes every slash command family', function (t) {
  t.alike(slashRegistry.map((entry) => entry.name), expectedCommands);

  for (const entry of slashRegistry) {
    t.is(typeof entry.summary, 'string', `/${entry.name} has a summary`);
    t.ok(entry.summary.length > 0, `/${entry.name} summary is not empty`);
    t.is(typeof entry.usage, 'string', `/${entry.name} has usage`);
    t.ok(entry.usage.startsWith(`/${entry.name}`), `/${entry.name} usage starts with its command`);
    if (entry.aliases !== undefined) t.ok(Array.isArray(entry.aliases), `/${entry.name} aliases are an array`);
  }
});

test('slash discovery lists registry metadata and implementation state', function (t) {
  const tags = listSlashTags();

  t.alike(tags.map((entry) => entry.name), expectedCommands);
  t.alike(
    tags.filter((entry) => entry.implemented).map((entry) => entry.name),
    ['p2p', 'swarm', 'dht', 'drive', 'localdrive', 'mirror', 'beam'],
    'implementation state comes from registered handlers'
  );
  t.alike(
    tags.filter((entry) => !entry.implemented).map((entry) => entry.name),
    [],
    'no resource placeholders remain'
  );
  t.ok(Object.isFrozen(tags));
  t.ok(tags.every(Object.isFrozen));
});

test('dispatch ignores non-slash input without requiring context', async function (t) {
  t.is(await dispatchSlashTag('ordinary chat text'), false);
  t.is(await dispatchSlashTag('ask about /drive'), false);
  t.is(await dispatchSlashTag(null), false);
});

test('every slash dispatch path is local-only and uses emitEphemeral', async function (t) {
  const cases = [
    ['/p2p help', 'slash-help'],
    ['/swarm status', 'slash-swarm'],
    ['/dht status', 'slash-dht'],
    ['/drive status docs', 'slash-drive'],
    ['/localdrive status docs', 'slash-localdrive'],
    ['/mirror status', 'slash-mirror'],
    ['/beam status sender', 'slash-beam'],
    ['/nope', 'slash-help'],
    ['/drive "unterminated', 'slash-error']
  ];

  for (const [input, expectedKind] of cases) {
    const { ctx, output, forbiddenOperations } = privacyCollector();
    const guarded = guardedServices();
    let services = guarded.services;
    if (input === '/p2p help') {
      services = helpServices();
    } else if (input === '/swarm status') {
      services = {
        swarm: {
          status: () => ({
            initialized: false,
            topic: null,
            role: 'none',
            connected: false,
            peerCount: 0
          })
        }
      };
    } else if (input === '/dht status') {
      services = {
        dht: {
          status: () => ({
            initialized: false,
            publicKey: null,
            topic: null,
            connectionCount: 0,
            listening: null
          })
        }
      };
    } else if (input === '/drive status docs') {
      services = {
        drive: {
          status: () => ({
            id: 'drive-1',
            name: 'docs',
            key: 'ab'.repeat(32),
            writable: true,
            version: 1,
            status: 'ready',
            opened: true,
            discovering: false,
            fileCount: 0,
            fileCountCapped: false
          })
        }
      };
    } else if (input === '/localdrive status docs') {
      services = {
        localdrive: {
          status: () => ({
            id: 'local-1',
            name: 'docs',
            root: '@storage/docs',
            writable: false,
            status: 'ready',
            fileCount: 0,
            fileCountCapped: false
          })
        }
      };
    } else if (input === '/mirror status') {
      services = {
        mirror: {
          status: () => []
        }
      };
    } else if (input === '/beam status sender') {
      services = {
        beam: {
          status: () => ({
            id: 'beam-1',
            name: 'sender',
            status: 'connecting',
            connected: false,
            pending: 0,
            sentMessages: 0,
            sentBytes: 0,
            receivedMessages: 0,
            receivedBytes: 0
          })
        }
      };
    }
    const accesses = guarded.accesses;
    t.is(await dispatchSlashTag(input, ctx, services), true, `${input} is handled locally`);
    t.is(output.length, 1, `${input} emits exactly one ephemeral result`);
    t.is(output[0].metadata.kind, expectedKind, `${input} emits ${expectedKind}`);
    t.alike(forbiddenOperations, [], `${input} does not access a forbidden context boundary`);
    t.alike(accesses, [], `${input} does not access hidden output, persistence, provider, or transport callbacks`);
  }
});

test('tag modules retain narrow source-level capability guardrails', function (t) {
  const files = slashSourceFiles();
  t.ok(files.some((file) => file.includes('/tags/')), 'tag sources are inspected');

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativeFile = `js/${file.split('/js/')[1]}`;
    for (const [boundary, pattern] of forbiddenSourceBoundaries) {
      t.absent(pattern.test(source), `${relativeFile} does not reference ${boundary}`);
    }
  }
});

test('/p2p help is deterministic and lists every family', async function (t) {
  const first = collector();
  const second = collector();

  t.is(await dispatchSlashTag('/p2p help', first.ctx, helpServices()), true);
  t.is(await dispatchSlashTag('/p2p help', second.ctx, helpServices()), true);
  t.alike(first.output, second.output, 'same request produces the same local help');
  t.is(first.output.length, 1);

  for (const command of expectedCommands) {
    t.ok(first.output[0].content.includes(`/${command}`), `help lists /${command}`);
  }
});

test('/p2p help <command> shows focused deterministic help', async function (t) {
  const { output, ctx } = collector();

  t.is(await dispatchSlashTag('/p2p help drive', ctx, helpServices()), true);
  t.is(output.length, 1);
  t.ok(output[0].content.includes('/drive'));
  t.ok(output[0].content.includes('Usage:'));
  t.absent(output[0].content.includes('Unknown slash command'));
});

test('/help aliases /p2p help exactly', async function (t) {
  for (const suffix of ['', ' drive', ' /swarm', ' nope']) {
    const alias = collector();
    const canonical = collector();

    t.is(await dispatchSlashTag(`/help${suffix}`, alias.ctx, helpServices()), true);
    t.is(await dispatchSlashTag(`/p2p help${suffix}`, canonical.ctx, helpServices()), true);
    t.alike(alias.output, canonical.output, `/help${suffix} matches canonical output`);
  }
});

test('unknown slash commands emit useful local help and are handled', async function (t) {
  const { output, ctx } = collector();

  t.is(await dispatchSlashTag('/nope', ctx), true);
  t.is(output.length, 1);
  t.ok(output[0].content.includes('Unknown slash command: /nope'));
  t.ok(output[0].content.includes('/p2p help'));
});

test('malformed slash input becomes local output and is handled', async function (t) {
  const { output, ctx } = collector();

  t.is(await dispatchSlashTag('/drive "unterminated', ctx), true);
  t.is(output.length, 1);
  t.ok(output[0].content.includes('Slash command error:'));
  t.ok(output[0].content.includes('Unclosed quote'));
});

test('handlers receive only parsed input and explicit services', async function (t) {
  const { ctx, output } = collector({ secretContextValue: true });
  const accesses = [];
  const services = new Proxy(Object.freeze({ allowed: 'service-value' }), {
    get(target, property, receiver) {
      accesses.push(String(property));
      if (['emitEphemeral', 'persist', 'provider', 'transport', 'output'].includes(property)) {
        throw new Error(`forbidden handler capability: ${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    }
  });
  let received;
  const definitions = [{
    name: 'test-capability',
    handler(...args) {
      received = args;
      return {
        content: `allowed=${args[1].allowed}`,
        metadata: { kind: 'slash-test' }
      };
    }
  }];

  t.is(await dispatchSlashTagWithCommands('/test-capability value', ctx, services, definitions), true);
  t.is(received.length, 2, 'handler receives only parsed input and explicit services');
  t.is(received[0].command, 'test-capability');
  t.is(received[1], services, 'services are explicitly injected without wrapping in context');
  t.not(received[0], ctx);
  t.not(received[1], ctx);
  t.alike(accesses, ['allowed'], 'handler cannot discover hidden capabilities through dispatch');
  t.alike(output, [{ content: 'allowed=service-value', metadata: { kind: 'slash-test' } }]);
  t.is(JSON.parse(JSON.stringify(output[0])).content, 'allowed=service-value', 'handler result is serializable');
});

test('dispatch consumes synchronous and asynchronous handler failures locally', async function (t) {
  const cases = [
    ['sync-failure', function () { throw new Error('sync exploded'); }, 'sync exploded'],
    ['async-failure', async function () { throw new Error('async exploded'); }, 'async exploded']
  ];

  for (const [name, handler, message] of cases) {
    const { ctx, output } = collector();
    t.is(await dispatchSlashTagWithCommands(`/${name}`, ctx, {}, [{ name, handler }]), true);
    t.is(output.length, 1, `${name} emits exactly one local error`);
    t.is(output[0].metadata.kind, 'slash-error');
    t.is(output[0].metadata.command, name);
    t.ok(output[0].content.includes(message));
  }
});

test('handler results require JSON-safe plain metadata', async function (t) {
  const cyclic = {};
  cyclic.self = cyclic;
  const invalidMetadata = [
    ['cyclic-result', cyclic],
    ['bigint-result', { value: 1n }],
    ['function-result', { value() {} }],
    ['symbol-result', { value: Symbol('value') }],
    ['undefined-object-result', { value: undefined }],
    ['undefined-array-result', { values: ['value', undefined] }],
    ['non-finite-result', { value: Number.POSITIVE_INFINITY }],
    ['map-result', { value: new Map([['key', 'value']]) }],
    ['set-result', { value: new Set(['value']) }],
    ['date-result', { value: new Date(0) }]
  ];
  const expectedError = 'Slash command error: Slash handler result must be JSON-serializable';

  for (const [name, metadata] of invalidMetadata) {
    const { ctx, output } = collector();
    const definitions = [{ name, handler: () => ({ content: 'must not emit', metadata }) }];

    t.is(await dispatchSlashTagWithCommands(`/${name}`, ctx, {}, definitions), true, `${name} is consumed`);
    t.alike(output, [{
      content: expectedError,
      metadata: { kind: 'slash-error', command: name }
    }], `${name} emits one deterministic dispatcher error`);
  }
});

test('handler validation covers the complete result object', async function (t) {
  const { ctx, output } = collector();
  const definitions = [{
    name: 'extra-field-result',
    handler: () => ({ content: 'must not emit', metadata: { kind: 'slash-test' }, extra: 1n })
  }];

  t.is(await dispatchSlashTagWithCommands('/extra-field-result', ctx, {}, definitions), true);
  t.alike(output, [{
    content: 'Slash command error: Slash handler must return { content, metadata? }',
    metadata: { kind: 'slash-error', command: 'extra-field-result' }
  }]);
});

test('handler results require an exact own-key shape', async function (t) {
  let getterCalls = 0;
  const invalidResults = [
    ['extra-top-level-field', () => ({ content: 'must not emit', extra: 'unexpected' })],
    ['symbol-top-level-field', () => {
      const result = { content: 'must not emit' };
      result[Symbol('hidden')] = 'unexpected';
      return result;
    }],
    ['non-enumerable-top-level-field', () => {
      const result = { content: 'must not emit' };
      Object.defineProperty(result, 'hidden', { value: 'unexpected' });
      return result;
    }],
    ['top-level-accessor', () => {
      const result = {};
      Object.defineProperty(result, 'content', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'must not emit';
        }
      });
      return result;
    }]
  ];

  for (const [name, createResult] of invalidResults) {
    const { ctx, output } = collector();
    const definitions = [{ name, handler: createResult }];

    t.is(await dispatchSlashTagWithCommands(`/${name}`, ctx, {}, definitions), true, `${name} is consumed`);
    t.alike(output, [{
      content: 'Slash command error: Slash handler must return { content, metadata? }',
      metadata: { kind: 'slash-error', command: name }
    }], `${name} emits exactly one deterministic dispatcher error`);
  }

  t.is(getterCalls, 0, 'result-shape validation never invokes getters');
});

test('handler validation rejects structural JSON hazards without invoking code', async function (t) {
  let getterCalls = 0;
  let toJSONCalls = 0;
  const invalidMetadata = [
    ['non-enumerable-to-json', () => {
      const metadata = { kind: 'slash-test' };
      Object.defineProperty(metadata, 'toJSON', {
        value() {
          toJSONCalls += 1;
          return 1n;
        }
      });
      return metadata;
    }],
    ['sparse-array', () => ({ values: new Array(2) })],
    ['custom-prototype', () => ({ value: Object.create({ inherited: true }) })],
    ['accessor-property', () => {
      const metadata = {};
      Object.defineProperty(metadata, 'value', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'unexpected';
        }
      });
      return metadata;
    }],
    ['symbol-property', () => {
      const metadata = { kind: 'slash-test' };
      metadata[Symbol('hidden')] = 'unexpected';
      return metadata;
    }],
    ['non-enumerable-property', () => {
      const metadata = { kind: 'slash-test' };
      Object.defineProperty(metadata, 'hidden', { value: 'unexpected' });
      return metadata;
    }],
    ['array-extra-property', () => {
      const values = ['safe'];
      values.extra = 'unexpected';
      return { values };
    }]
  ];

  for (const [name, createMetadata] of invalidMetadata) {
    const { ctx, output } = collector();
    const definitions = [{
      name,
      handler: () => ({ content: 'must not emit', metadata: createMetadata() })
    }];

    t.is(await dispatchSlashTagWithCommands(`/${name}`, ctx, {}, definitions), true, `${name} is consumed`);
    t.alike(output, [{
      content: 'Slash command error: Slash handler result must be JSON-serializable',
      metadata: { kind: 'slash-error', command: name }
    }], `${name} emits exactly one deterministic dispatcher error`);
  }

  t.is(getterCalls, 0, 'validation never invokes getters');
  t.is(toJSONCalls, 0, 'validation never invokes toJSON');
});

test('handler results accept known-good nested JSON metadata', async function (t) {
  const { ctx, output } = collector();
  const metadata = {
    kind: 'slash-test',
    nested: {
      enabled: true,
      count: 3,
      nothing: null,
      items: ['one', 2, false, { deeper: ['value'] }]
    }
  };
  const definitions = [{
    name: 'nested-result',
    handler: () => ({ content: 'nested metadata', metadata })
  }];

  t.is(await dispatchSlashTagWithCommands('/nested-result', ctx, {}, definitions), true);
  t.alike(output, [{ content: 'nested metadata', metadata }]);
});

test('registry, entries, and aliases are deeply immutable', async function (t) {
  const originalNames = slashRegistry.map((entry) => entry.name);
  const p2p = slashRegistry.find((entry) => entry.name === 'p2p');

  t.ok(Object.isFrozen(slashRegistry));
  t.ok(slashRegistry.every(Object.isFrozen), 'all registry entries are frozen');
  t.ok(Object.isFrozen(p2p.aliases));
  await t.exception.all(() => slashRegistry.push({ name: 'mutant' }), /object is not extensible/);
  await t.exception.all(() => { p2p.name = 'mutant'; }, /read only property/);
  await t.exception.all(() => p2p.aliases.push('mutant'), /object is not extensible/);
  t.alike(slashRegistry.map((entry) => entry.name), originalNames);
  t.alike(p2p.aliases, ['help']);
});

test('missing emitEphemeral fails safely and clearly for slash input', async function (t) {
  for (const ctx of [undefined, null, {}, { emitEphemeral: 'not a function' }]) {
    let error = null;
    try {
      await dispatchSlashTag('/p2p help', ctx);
    } catch (cause) {
      error = cause;
    }
    t.ok(error instanceof TypeError);
    t.ok(error.message.includes('ctx.emitEphemeral'));
  }
});
