/**
 * Slash command engine.
 *
 * The command set is no longer hardcoded: the harness builds a runtime from the
 * command definitions contributed by the loaded plugins. This module only owns
 * parsing/dispatch mechanics and the pure help formatters.
 */
import { isSlashTag, parseSlashTag } from './parser.js';

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

function listedEntries(definitions) {
  return definitions.map((definition) => {
    const { handler, aliasArguments: _aliasArguments, aliases, ...entry } = definition;
    const listed = { ...entry, implemented: typeof handler === 'function' };
    if (aliases) listed.aliases = aliases;
    return Object.freeze(listed);
  });
}

function formatAllHelp(definitions) {
  const lines = publicEntries(definitions).map(({ name, summary, usage }) => (
    `/${name} — ${summary}\n  Usage: ${usage}`
  ));

  return `SeekDeep slash commands\n\n${lines.join('\n')}\n\nUse /p2p help <command> for command help.`;
}

function normalizeHelpTarget(target) {
  return String(target).trim().replace(/^\//, '').toLowerCase();
}

function formatCommandHelp(target, definitions) {
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
 * Dispatch a composer value against an explicit command list. This is the
 * engine behind `createSlashRuntime` and the direct test seam.
 */
async function dispatchSlashTagWithCommands(text, ctx, services = {}, definitions = []) {
  if (!isSlashTag(text)) return false;

  if (!ctx || typeof ctx.emitEphemeral !== 'function') {
    throw new TypeError('Slash dispatch requires ctx.emitEphemeral(content, metadata?)');
  }
  if (!Array.isArray(definitions)) throw new TypeError('Slash dispatch requires a command definition array');

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
 * Build an immutable slash runtime from a plugin's contributed definitions.
 */
function createSlashRuntime(definitions) {
  if (!Array.isArray(definitions)) throw new TypeError('Slash runtime requires a command definition array');
  const frozen = Object.freeze(definitions.map(freezeDefinition));

  return Object.freeze({
    definitions: frozen,
    list: () => Object.freeze(listedEntries(frozen)),
    allHelp: () => formatAllHelp(frozen),
    commandHelp: (target) => formatCommandHelp(target, frozen),
    dispatch: (text, ctx, services) => dispatchSlashTagWithCommands(text, ctx, services, frozen)
  });
}

export {
  createSlashRuntime,
  freezeDefinition,
  dispatchSlashTagWithCommands,
  formatAllHelp,
  formatCommandHelp,
  createCommandMap,
  publicEntries
};