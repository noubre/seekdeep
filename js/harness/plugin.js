/**
 * Plugin SDK for the SeekDeep harness.
 *
 * A plugin is a plain object that contributes slash commands and, optionally,
 * lifecycle hooks. User-authored plugins live on disk (`<storage>/plugins/
 * <name>/index.js`) and export a plugin via `definePlugin` or plain object
 * default export.
 */
import { freezeDefinition } from '../slash/registry.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_DESCRIPTION_LENGTH = 280;
const PLUGIN_KEYS = new Set(['name', 'version', 'description', 'commands', 'activate', 'deactivate']);
const COMMAND_KEYS = new Set(['name', 'summary', 'usage', 'aliases', 'aliasArguments', 'handler']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(`${label} has unsupported field: ${String(key)}`);
    }
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim() || CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a non-empty printable string`);
  }
  return value;
}

function assertName(value, label) {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    throw new TypeError(`${label} must match ${NAME_PATTERN}`);
  }
  return value;
}

function validateCommand(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`commands[${index}] must be a plain object`);
  assertAllowedKeys(value, COMMAND_KEYS, `commands[${index}]`);
  assertName(value.name, `commands[${index}].name`);
  assertNonEmptyString(value.summary, `commands[${index}].summary`);
  assertNonEmptyString(value.usage, `commands[${index}].usage`);
  if (value.handler !== undefined && typeof value.handler !== 'function') {
    throw new TypeError(`commands[${index}].handler must be a function when provided`);
  }
  if (value.aliases !== undefined) {
    if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== 'string' || !alias)) {
      throw new TypeError(`commands[${index}].aliases must be an array of non-empty strings`);
    }
  }
  if (value.aliasArguments !== undefined) {
    if (!isPlainObject(value.aliasArguments)) throw new TypeError(`commands[${index}].aliasArguments must be an object`);
    for (const args of Object.values(value.aliasArguments)) {
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        throw new TypeError(`commands[${index}].aliasArguments values must be arrays of strings`);
      }
    }
  }
  return freezeDefinition(value);
}

function validatePlugin(definition) {
  if (!isPlainObject(definition)) throw new TypeError('Plugin definition must be a plain object');
  assertAllowedKeys(definition, PLUGIN_KEYS, 'Plugin definition');
  assertName(definition.name, 'Plugin name');
  assertNonEmptyString(definition.version, `Plugin ${definition.name} version`);
  if (definition.description !== undefined) {
    if (typeof definition.description !== 'string' || definition.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new TypeError(`Plugin ${definition.name} description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }
  }
  if (definition.commands !== undefined && !Array.isArray(definition.commands)) {
    throw new TypeError(`Plugin ${definition.name} commands must be an array`);
  }
  const commands = (definition.commands || []).map((command, index) => validateCommand(command, index));
  const names = new Set();
  for (const command of commands) {
    if (names.has(command.name)) throw new TypeError(`Plugin ${definition.name} declares duplicate command: ${command.name}`);
    names.add(command.name);
  }
  for (const hook of ['activate', 'deactivate']) {
    if (definition[hook] !== undefined && typeof definition[hook] !== 'function') {
      throw new TypeError(`Plugin ${definition.name} ${hook} must be a function when provided`);
    }
  }
  return Object.freeze({
    name: definition.name,
    version: definition.version,
    description: definition.description,
    commands: Object.freeze(commands),
    activate: definition.activate,
    deactivate: definition.deactivate
  });
}

function definePlugin(definition) {
  return validatePlugin(definition);
}

export { NAME_PATTERN, definePlugin, validatePlugin };
