/**
 * Shared helpers for slash tag handlers.
 *
 * These only shape local input and output: printable-string validation, service
 * lookup, argument counting, and result metadata. Tag modules stay independent
 * of backend, network, history, LLM, and persistence concerns.
 */
import b4a from 'b4a';

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NAME_CHARS = 80;
const MAX_REFERENCE_CHARS = 160;

function byteLength(value) {
  return b4a.byteLength(value);
}

function requireService(services, key, message) {
  const service = services?.[key];
  if (!service) throw new Error(message);
  return service;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key));
}

function metadata(kind, command, action, extra = {}) {
  return { kind, command, action, ...extra };
}

function assertCount(command, action, args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) {
    throw new Error(`/${command} ${action} expects ${minimum === maximum ? minimum : `${minimum}-${maximum}`} argument${maximum === 1 ? '' : 's'}.`);
  }
}

function normalized(value) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function isPrintableName(value, { maxChars = MAX_NAME_CHARS } = {}) {
  if (typeof value !== 'string' || value.length > maxChars || CONTROL_PATTERN.test(value)) return false;
  return normalized(value).length > 0;
}

function isPrintableReference(value, { maxChars = MAX_REFERENCE_CHARS } = {}) {
  if (typeof value !== 'string' || value.length > maxChars || CONTROL_PATTERN.test(value)) return false;
  return normalized(value).length > 0;
}

export {
  CONTROL_PATTERN,
  MAX_NAME_CHARS,
  MAX_REFERENCE_CHARS,
  byteLength,
  requireService,
  exactKeys,
  metadata,
  assertCount,
  isPrintableName,
  isPrintableReference
};
