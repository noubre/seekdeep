/**
 * Shared leaf helpers for the P2P services. Runs in the Bare worker only, so it
 * may import Bare modules but nothing from the renderer.
 */
import b4a from 'b4a';
import crypto from 'hypercore-crypto';

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NAME_CHARS = 80;
const MAX_REFERENCE_CHARS = 160;
const ID_ATTEMPTS = 8;

/**
 * Reject anything that is not a safe positive integer.
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

/**
 * Normalize a display name (NFC, trimmed, collapsed whitespace) when it is a
 * printable string of at most `maxChars` characters.
 * @param {unknown} value
 * @param {{ maxChars?: number }} [options]
 * @returns {string|null}
 */
function normalizePrintableName(value, { maxChars = MAX_NAME_CHARS } = {}) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > maxChars || CONTROL_PATTERN.test(name)) return null;
  return name;
}

/**
 * Whether a value is a non-empty string of printable characters.
 * @param {unknown} value
 * @param {{ maxChars?: number }} [options]
 * @returns {boolean}
 */
function isPrintableReference(value, { maxChars = MAX_REFERENCE_CHARS } = {}) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars && !CONTROL_PATTERN.test(value);
}

/**
 * Build an id generator whose ids carry the given prefix.
 * @param {string} prefix
 * @returns {() => string}
 */
function createIdFactory(prefix) {
  return () => `${prefix}-${b4a.toString(crypto.randomBytes(12), 'hex')}`;
}

/**
 * Allocate a unique printable id, retrying up to `ID_ATTEMPTS` times.
 * @param {{ idFactory: () => string, isTaken: (id: string) => boolean, invalidMessage: string, exhaustedMessage: string|(() => Error) }} options
 * @returns {string}
 */
function allocateId({ idFactory, isTaken, invalidMessage, exhaustedMessage }) {
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
    const id = idFactory();
    if (!isPrintableReference(id)) throw new TypeError(invalidMessage);
    if (!isTaken(id)) return id;
  }
  throw typeof exhaustedMessage === 'function' ? exhaustedMessage() : new Error(exhaustedMessage);
}

/**
 * Close every record, aggregating failures into one error.
 * @param {Iterable<object>} records
 * @param {(record: object) => Promise<unknown>} closeRecord
 * @param {string} message
 * @returns {Promise<void>}
 */
async function closeAllRecords(records, closeRecord, message) {
  const results = await Promise.allSettled(Array.from(records, (record) => closeRecord(record)));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, message);
}

export {
  MAX_NAME_CHARS,
  MAX_REFERENCE_CHARS,
  ID_ATTEMPTS,
  positiveInteger,
  normalizePrintableName,
  isPrintableReference,
  createIdFactory,
  allocateId,
  closeAllRecords
};
