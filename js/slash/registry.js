import { isSlashTag, parseSlashTag } from './parser.js';
import { createP2PHandler } from './tags/p2p.js';
import { handleSwarm } from './tags/swarm.js';
import { handleDHT } from './tags/dht.js';
import { handleDrive } from './tags/drive.js';
import { handleLocaldrive } from './tags/localdrive.js';
import { handleMirror } from './tags/mirror.js';
import { handleBeam } from './tags/beam.js';

function freezeDefinition(definition) {
  const aliases = definition.aliases
    ? Object.freeze([...definition.aliases])
    : undefined;
  const aliasArguments = definition.aliasArguments
    ? Object.freeze(Object.fromEntries(
      Object.entries(definition.aliasArguments).map(([alias, args]) => [alias, Object.freeze([...args])])
    ))
    : undefined;

  return Object.freeze({ ...definition, aliases, aliasArguments });
}

const handleP2P = createP2PHandler(Object.freeze({
  all: () => formatAllHelp(commandDefinitions),
  command: (target) => formatCommandHelp(target, commandDefinitions)
}));

const commandDefinitions = Object.freeze([
  {
    name: 'p2p',
    summary: 'Show local help for SeekDeep peer-to-peer commands.',
    usage: '/p2p help [command]',
    aliases: ['help'],
    aliasArguments: { help: ['help'] },
    handler: handleP2P
  },
  {
    name: 'swarm',
    summary: 'Inspect and manage peer discovery.',
    usage: '/swarm [status|create|join <64hex>|leave|peers]',
    handler: handleSwarm
  },
  {
    name: 'dht',
    summary: 'Inspect distributed hash table state.',
    usage: '/dht [status|key|nodes]',
    handler: handleDHT
  },
  {
    name: 'drive',
    summary: 'Manage shared Hyperdrive content.',
    usage: '/drive <create|open|list|status|put|get|files|del|close> [arguments]',
    handler: handleDrive
  },
  {
    name: 'localdrive',
    summary: 'Manage local filesystem drive mappings.',
    usage: '/localdrive <add|remove|list|status|files|get|put> [arguments]',
    handler: handleLocaldrive
  },
  {
    name: 'mirror',
    summary: 'Dry-run a one-shot Localdrive to Hyperdrive mirror.',
    usage: '/mirror <start <localdrive> <drive> [--dry-run] [--prefix=/safe/path] [--no-prune]|status [id]|stop <id>>',
    handler: handleMirror
  },
  {
    name: 'beam',
    summary: 'Host or join an ephemeral one-to-one beam.',
    usage: '/beam <create <name>|join <name> <key>|list|status <id>|send <id> <text>|receive <id>|close <id>>',
    handler: handleBeam
  }
].map(freezeDefinition));

const slashRegistry = Object.freeze(commandDefinitions.map(({
  handler: _handler,
  aliasArguments: _aliasArguments,
  ...entry
}) => Object.freeze(entry)));

const slashTagList = Object.freeze(commandDefinitions.map(({
  handler,
  aliasArguments: _aliasArguments,
  ...entry
}) => Object.freeze({ ...entry, implemented: typeof handler === 'function' })));

function listSlashTags() {
  return slashTagList;
}

function createCommandMap(definitions) {
  const commands = new Map();
  for (const definition of definitions) {
    commands.set(definition.name, { definition, alias: null });
    for (const alias of definition.aliases || []) {
      commands.set(alias, { definition, alias });
    }
  }
  return commands;
}

function publicEntries(definitions) {
  return definitions.map(({ handler: _handler, aliasArguments: _aliasArguments, ...entry }) => entry);
}

function formatAllHelp(definitions = commandDefinitions) {
  const lines = publicEntries(definitions).map(({ name, summary, usage }) => (
    `/${name} — ${summary}\n  Usage: ${usage}`
  ));

  return `SeekDeep slash commands\n\n${lines.join('\n')}\n\nUse /p2p help <command> for command help.`;
}

function normalizeHelpTarget(target) {
  return String(target).trim().replace(/^\//, '').toLowerCase();
}

function formatCommandHelp(target, definitions = commandDefinitions) {
  const requested = normalizeHelpTarget(target);
  const resolved = createCommandMap(definitions).get(requested);

  if (!resolved) {
    return `Unknown slash command: /${requested || '(missing)'}\n\n${formatAllHelp(definitions)}`;
  }

  const { definition } = resolved;
  const aliases = definition.aliases?.length
    ? `\nAliases: ${definition.aliases.map((alias) => `/${alias}`).join(', ')}`
    : '';

  return `/${definition.name} — ${definition.summary}\nUsage: ${definition.usage}${aliases}`;
}

function normalizeAlias(parsed, resolution) {
  if (!resolution.alias) return parsed;
  const prefix = resolution.definition.aliasArguments?.[resolution.alias] || [];
  return {
    ...parsed,
    command: resolution.definition.name,
    args: [...prefix, ...parsed.args]
  };
}

function placeholderResult(parsed) {
  return {
    content: `/${parsed.command} is not implemented yet.`,
    metadata: {
      kind: 'slash-placeholder',
      command: parsed.command
    }
  };
}

function hasPlainPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDataDescriptor(descriptor) {
  return descriptor !== undefined &&
    Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
    !Object.prototype.hasOwnProperty.call(descriptor, 'get') &&
    !Object.prototype.hasOwnProperty.call(descriptor, 'set');
}

function isJsonSerializable(value, ancestors = new Set()) {
  if (value === null) return true;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }

  if (ancestors.has(value)) return false;
  const isArray = Array.isArray(value);
  if (isArray) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
  } else if (!hasPlainPrototype(value)) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || key === 'toJSON')) return false;

  ancestors.add(value);
  try {
    if (isArray) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!isDataDescriptor(lengthDescriptor) || lengthDescriptor.enumerable) return false;
      const length = lengthDescriptor.value;
      if (keys.length !== length + 1) return false;

      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!isDataDescriptor(descriptor) || !descriptor.enumerable) return false;
        if (!isJsonSerializable(descriptor.value, ancestors)) return false;
      }
      return true;
    }

    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!isDataDescriptor(descriptor) || !descriptor.enumerable) return false;
      if (!isJsonSerializable(descriptor.value, ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function assertHandlerResult(result) {
  if (!result || typeof result !== 'object' || !hasPlainPrototype(result)) {
    throw new TypeError('Slash handler must return { content, metadata? }');
  }

  const keys = Reflect.ownKeys(result);
  const hasMetadata = keys.includes('metadata');
  const expectedKeyCount = hasMetadata ? 2 : 1;
  if (
    keys.length !== expectedKeyCount ||
    !keys.includes('content') ||
    keys.some((key) => typeof key !== 'string' || (key !== 'content' && key !== 'metadata'))
  ) {
    throw new TypeError('Slash handler must return { content, metadata? }');
  }

  const contentDescriptor = Object.getOwnPropertyDescriptor(result, 'content');
  const metadataDescriptor = hasMetadata
    ? Object.getOwnPropertyDescriptor(result, 'metadata')
    : undefined;
  if (
    !isDataDescriptor(contentDescriptor) ||
    !contentDescriptor.enumerable ||
    typeof contentDescriptor.value !== 'string' ||
    (hasMetadata && (!isDataDescriptor(metadataDescriptor) || !metadataDescriptor.enumerable))
  ) {
    throw new TypeError('Slash handler must return { content, metadata? }');
  }

  const metadata = metadataDescriptor?.value;
  if (hasMetadata && (
    !metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !hasPlainPrototype(metadata)
  )) {
    throw new TypeError('Slash handler metadata must be an object when provided');
  }
  if (hasMetadata && !isJsonSerializable(metadata)) {
    throw new TypeError('Slash handler result must be JSON-serializable');
  }
  return { content: contentDescriptor.value, metadata };
}

function emitResult(ctx, result) {
  ctx.emitEphemeral(result.content, result.metadata);
}

function errorResult(error, command) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: `Slash command error: ${message}`,
    metadata: {
      kind: 'slash-error',
      ...(command ? { command } : {})
    }
  };
}

/**
 * Test seam for dispatching against an injected command list. Production uses
 * dispatchSlashTag below so its frozen registry cannot be extended at runtime.
 */
async function dispatchSlashTagWithCommands(text, ctx, services = {}, definitions = commandDefinitions) {
  if (!isSlashTag(text)) return false;

  if (!ctx || typeof ctx.emitEphemeral !== 'function') {
    throw new TypeError('Slash dispatch requires ctx.emitEphemeral(content, metadata?)');
  }

  let parsed;
  try {
    parsed = parseSlashTag(text);
  } catch (error) {
    emitResult(ctx, errorResult(error));
    return true;
  }

  const resolution = createCommandMap(definitions).get(parsed.command);
  if (!resolution) {
    emitResult(ctx, {
      content: `Unknown slash command: /${parsed.command}\n\n${formatAllHelp(definitions)}`,
      metadata: {
        kind: 'slash-help',
        command: parsed.command,
        error: 'unknown-command'
      }
    });
    return true;
  }

  const normalized = normalizeAlias(parsed, resolution);

  try {
    const result = resolution.definition.handler
      ? await resolution.definition.handler(normalized, services)
      : placeholderResult(normalized);
    emitResult(ctx, assertHandlerResult(result));
  } catch (error) {
    emitResult(ctx, errorResult(error, normalized.command));
  }

  return true;
}

/**
 * Dispatch a composer value as a local-only slash command. Handlers receive
 * parsed input and explicit services, return data, and cannot emit output.
 * This function is the only slash boundary that calls ctx.emitEphemeral.
 */
function dispatchSlashTag(text, ctx, services = {}) {
  return dispatchSlashTagWithCommands(text, ctx, services, commandDefinitions);
}

export { slashRegistry, listSlashTags, dispatchSlashTag, dispatchSlashTagWithCommands };
