/**
 * Browser-safe JSON-RPC wire constants, validators, and frame helpers.
 *
 * This module is imported by both the renderer client and the Bare worker
 * server, so it MUST stay free of Node/Bare-only dependencies (b4a, streams,
 * fs). Framing uses TextEncoder/TextDecoder/Uint8Array, which are available in
 * Chromium renderers under the app's CSP.
 */

const DEFAULT_MAX_MESSAGE_BYTES = 128 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 512 * 1024;
const DEFAULT_MAX_QUEUED_REQUESTS = 128;
const MAX_ID_LENGTH = 64;
const MIN_MESSAGE_BYTES = 128;
const EVENT_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

const NEWLINE_BYTE = 10;
// Error codes produced by the worker's coded RPC wrappers. A code outside this
// list must never reach the renderer: the wire carries the plain message only.
// Shared by the worker server and the renderer client so both agree on which
// codes survive the transport.
const SAFE_ERROR_CODE_PREFIXES = Object.freeze(['LOCALDRIVE_', 'MIRROR_']);

/**
 * @param {unknown} value
 * @returns {boolean} Whether the code is one of the wrappers' coded errors.
 */
function hasSafeErrorCode(value) {
  return typeof value === 'string' && SAFE_ERROR_CODE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

// Lazy: the Bare worker imports this module for constants/validators only and
// does not expose global TextEncoder/TextDecoder. The Chromium renderer does.
let textEncoder = null;
let textDecoder = null;

function getTextEncoder() {
  if (!textEncoder) textEncoder = new TextEncoder();
  return textEncoder;
}

function getTextDecoder() {
  if (!textDecoder) textDecoder = new TextDecoder();
  return textDecoder;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainDataObject(value, allowedKeys, label = 'RPC params') {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) throw new TypeError(`${label} contains unsupported field: ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function assertJsonData(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('RPC payload must contain only JSON data');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((isArray && prototype !== Array.prototype) || (!isArray && prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('RPC payload must contain only plain JSON data');
  }
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (isArray && keys.length !== value.length + 1) throw new TypeError('RPC arrays must not be sparse or have extra fields');
    for (const key of keys) {
      if (typeof key !== 'string' || key === 'toJSON') throw new TypeError('RPC payload contains an unsupported field');
      if (isArray && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || !descriptor.enumerable) {
        throw new TypeError('RPC payload fields must be enumerable data properties');
      }
      assertJsonData(descriptor.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Normalize a stream chunk to bytes without assuming Node Buffer/b4a.
 * Strings are UTF-8 encoded; typed arrays and ArrayBuffers are viewed, not
 * copied, because callers concatenate immediately.
 */
function toBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return getTextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new TypeError('RPC chunk must be a string, ArrayBuffer, or ArrayBuffer view');
}

function concatBytes(left, right) {
  if (!left.byteLength) return right;
  if (!right.byteLength) return left;
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}

function indexOfNewline(bytes) {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === NEWLINE_BYTE) return index;
  }
  return -1;
}

/** Serialize one newline-delimited JSON-RPC frame to UTF-8 bytes. */
function encodeFrame(value) {
  return getTextEncoder().encode(`${JSON.stringify(value)}\n`);
}

/** Decode one frame body (without its trailing newline) as UTF-8 JSON text. */
function decodeFrame(bytes) {
  return getTextDecoder().decode(bytes);
}

export {
  DEFAULT_MAX_AGGREGATE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_QUEUED_REQUESTS,
  EVENT_PATTERN,
  MAX_ID_LENGTH,
  MIN_MESSAGE_BYTES,
  SAFE_ERROR_CODE_PREFIXES,
  assertJsonData,
  assertPlainDataObject,
  concatBytes,
  decodeFrame,
  encodeFrame,
  hasSafeErrorCode,
  indexOfNewline,
  isPlainObject,
  toBytes
};
