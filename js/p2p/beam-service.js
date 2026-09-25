import Hyperbeam from 'hyperbeam';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import DHT from 'hyperdht';

const KEY_PATTERN = /^[a-z2-7]{52}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NAME_CHARS = 80;
const MAX_REFERENCE_CHARS = 160;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BEAMS = 32;
const MAX_PENDING_MESSAGES = 100;
const MAX_BUFFER_BYTES = 128 * 1024;

function byteLength(value) { return b4a.byteLength(value); }
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}
function normalizeName(value) {
  if (typeof value !== 'string') throw new TypeError('Beam name must be a string');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > MAX_NAME_CHARS || CONTROL_PATTERN.test(name)) throw new TypeError(`Beam name must be 1-${MAX_NAME_CHARS} printable characters`);
  return name;
}
function normalizeReference(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(value)) throw new TypeError('Beam reference is invalid');
  return value;
}
function normalizeKey(value) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) throw new TypeError('Beam key must be a 52-character lowercase base32 capability');
  return value;
}
function normalizeContent(value) {
  if (typeof value !== 'string') throw new TypeError('Beam content must be a string');
  if (byteLength(value) > MAX_MESSAGE_BYTES) throw new RangeError('Beam content is too large');
  return value;
}
function defaultIdFactory() { return `beam-${b4a.toString(crypto.randomBytes(12), 'hex')}`; }
function defaultDhtFactory() { return new DHT({ ephemeral: true }); }

function createBeamService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Beam service options must be an object');
  const Beam = options.Hyperbeam || Hyperbeam;
  const idFactory = options.idFactory || defaultIdFactory;
  const dhtFactory = options.dhtFactory || defaultDhtFactory;
  const maxBeams = positiveInteger(options.maxBeams ?? MAX_BEAMS, 'maxBeams');
  const maxPendingMessages = positiveInteger(options.maxPendingMessages ?? MAX_PENDING_MESSAGES, 'maxPendingMessages');
  const maxBufferBytes = positiveInteger(options.maxBufferBytes ?? MAX_BUFFER_BYTES, 'maxBufferBytes');
  if (typeof Beam !== 'function') throw new TypeError('Hyperbeam must be a constructor');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof dhtFactory !== 'function') throw new TypeError('dhtFactory must be a function');

  const records = new Map();
  const names = new Map();
  let shutdown = false;
  let closing = null;

  function descriptor(record) {
    return {
      id: record.id, name: record.name, status: record.status, connected: record.connected,
      pending: record.messages.length, sentMessages: record.sentMessages, sentBytes: record.sentBytes,
      receivedMessages: record.receivedMessages, receivedBytes: record.receivedBytes
    };
  }
  function resolve(reference) {
    const ref = normalizeReference(reference);
    const record = records.get(ref) || records.get(names.get(ref.toLowerCase()));
    if (!record) throw new Error('Beam was not found');
    return record;
  }
  function fail(record) {
    if (record.status === 'closed') return;
    record.status = 'error';
    record.connected = false;
    if (!record.stream.destroyed) record.stream.destroy();
  }
  function attach(record) {
    record.stream.on('connected', () => { if (record.status !== 'closed' && record.status !== 'error') { record.connected = true; record.status = 'open'; } });
    record.stream.on('data', (chunk) => {
      if (record.status === 'closed' || record.status === 'error') return;
      record.buffered = b4a.concat([record.buffered, b4a.from(chunk)]);
      if (record.buffered.byteLength > maxBufferBytes) return fail(record);
      let newline;
      while ((newline = b4a.indexOf(record.buffered, 10)) !== -1) {
        const line = record.buffered.subarray(0, newline);
        record.buffered = record.buffered.subarray(newline + 1);
        let value;
        try { value = JSON.parse(b4a.toString(line)); } catch { return fail(record); }
        if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1 || typeof value.message !== 'string' || byteLength(value.message) > MAX_MESSAGE_BYTES) return fail(record);
        if (record.messages.length >= maxPendingMessages) return fail(record);
        record.messages.push(value.message);
        record.receivedMessages += 1;
        record.receivedBytes += byteLength(value.message);
      }
    });
    record.stream.on('error', () => fail(record));
    record.stream.on('close', () => { record.connected = false; if (record.status !== 'error') record.status = 'closed'; });
    if (record.stream.connected) { record.connected = true; record.status = 'open'; }
  }
  function register(name, key) {
    if (shutdown) throw new Error('Beam service is closed');
    const normalizedName = normalizeName(name);
    if (records.size >= maxBeams) throw new RangeError('Beam limit reached');
    if (names.has(normalizedName.toLowerCase())) throw new Error('A beam with that name already exists');
    let id;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      id = idFactory();
      if (typeof id !== 'string' || !id || id.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(id)) throw new TypeError('idFactory returned an invalid beam ID');
      if (!records.has(id) && !names.has(id.toLowerCase())) break;
      id = null;
    }
    if (!id) throw new Error('Unable to generate a unique beam ID');
    const dht = dhtFactory();
    // hyperbeam's constructor treats a non-string first argument as the options
    // object (`if (typeof key !== 'string') { options = key; key = null }`), so the
    // announce (host) branch must pass options as the sole argument.
    const stream = key === undefined
      ? new Beam({ announce: true, dht })
      : new Beam(key, { announce: false, dht });
    const record = { id, name: normalizedName, stream, status: 'connecting', connected: false, buffered: b4a.alloc(0), messages: [], sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0, key: stream.key };
    records.set(id, record);
    names.set(normalizedName.toLowerCase(), id);
    attach(record);
    return record;
  }
  async function closeRecord(record) {
    if (record.status !== 'closed') {
      record.status = 'closed'; record.connected = false;
      if (!record.stream.destroyed) record.stream.destroy();
    }
    return descriptor(record);
  }

  return Object.freeze({
    async create(name) {
      const record = register(name);
      const key = normalizeKey(record.key);
      return { descriptor: descriptor(record), key };
    },
    async join(name, key) { return descriptor(register(name, normalizeKey(key))); },
    async list() { return Array.from(records.values(), descriptor); },
    async status(reference) { return descriptor(resolve(reference)); },
    async send(reference, content) {
      const record = resolve(reference);
      const message = normalizeContent(content);
      if (record.status === 'closed' || record.status === 'error') throw new Error('Beam is not available');
      const bytes = byteLength(message);
      await new Promise((resolveWrite, reject) => record.stream.write(b4a.from(`${JSON.stringify({ message })}\n`), (error) => error ? reject(error) : resolveWrite()));
      record.sentMessages += 1; record.sentBytes += bytes;
      return { id: record.id, bytes, sentMessages: record.sentMessages, sentBytes: record.sentBytes };
    },
    async receive(reference) {
      const record = resolve(reference);
      const messages = record.messages.splice(0);
      return { messages, bytes: messages.reduce((sum, message) => sum + byteLength(message), 0), pending: record.messages.length };
    },
    async closeBeam(reference) { return closeRecord(resolve(reference)); },
    close() {
      if (closing) return closing;
      shutdown = true;
      closing = Promise.all(Array.from(records.values(), closeRecord)).then(() => undefined);
      return closing;
    }
  });
}

export { KEY_PATTERN, MAX_MESSAGE_BYTES, createBeamService };