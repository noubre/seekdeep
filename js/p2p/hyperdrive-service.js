import Corestore from 'corestore';
import Hyperdrive from 'hyperdrive';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import path from 'path';

const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NAME_CHARS = 80;
const MAX_PATH_BYTES = 512;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_FILES = 100;
const MAX_DRIVES = 64;
const READ_TIMEOUT = 10000;
const MAX_SWARM_PEERS = 32;

function normalizeName(value) {
  if (typeof value !== 'string') throw new TypeError('Drive name must be a string');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > MAX_NAME_CHARS || CONTROL_PATTERN.test(name)) {
    throw new TypeError(`Drive name must be 1-${MAX_NAME_CHARS} printable characters`);
  }
  return name;
}

function normalizeKey(value) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new TypeError('Drive key must be a 64-character hexadecimal public key');
  }
  return value.toLowerCase();
}

function normalizeDrivePath(value, { allowRoot = false } = {}) {
  if (typeof value !== 'string') throw new TypeError('Drive path must be a string');
  if (!value || value.includes('\0') || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new TypeError('Drive path contains invalid characters');
  }
  const withRoot = value.startsWith('/') ? value : `/${value}`;
  if (withRoot === '/') {
    if (allowRoot) return withRoot;
    throw new TypeError('Drive path must identify a file, not root');
  }
  const segments = withRoot.split('/');
  if (segments.some((segment, index) => index > 0 && (!segment || segment === '.' || segment === '..'))) {
    throw new TypeError('Drive path must be normalized and must not contain traversal');
  }
  if (b4a.byteLength(withRoot) > MAX_PATH_BYTES) throw new RangeError('Drive path is too large');
  return withRoot;
}

function normalizePrefix(value = '/') {
  if (value === undefined || value === '') return '/';
  return normalizeDrivePath(value, { allowRoot: true });
}

function storageToken(value) {
  return b4a.toString(crypto.data(b4a.from(value)), 'hex');
}

function withTimeout(promise, milliseconds, message) {
  const observed = Promise.resolve(promise);
  // Hyperdrive does not expose cancellation for update/get. Keep a final
  // rejection handler so a failure after our timeout cannot become unhandled.
  observed.catch(() => {});
  let timer;
  return Promise.race([
    observed,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function createDefaultSwarmFactory(maxPeers = MAX_SWARM_PEERS, Swarm = Hyperswarm) {
  positiveInteger(maxPeers, 'maxPeers');
  if (typeof Swarm !== 'function') throw new TypeError('Swarm must be a constructor');
  return () => new Swarm({ maxPeers });
}

function createHyperdriveService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Drive service options must be an object');
  const storageRoot = options.storageRoot;
  if (typeof storageRoot !== 'string' || !storageRoot) throw new TypeError('storageRoot is required');
  const maxDrives = positiveInteger(options.maxDrives ?? MAX_DRIVES, 'maxDrives');
  const maxPeers = positiveInteger(options.maxPeers ?? MAX_SWARM_PEERS, 'maxPeers');
  const readTimeout = positiveInteger(options.readTimeout ?? READ_TIMEOUT, 'readTimeout');
  const swarmFactory = options.swarmFactory === undefined ? createDefaultSwarmFactory(maxPeers) : options.swarmFactory;
  const storeFactory = options.storeFactory === undefined ? (storagePath) => new Corestore(storagePath) : options.storeFactory;
  const driveFactory = options.driveFactory === undefined ? (store, key) => key ? new Hyperdrive(store, key) : new Hyperdrive(store) : options.driveFactory;
  if (typeof swarmFactory !== 'function') throw new TypeError('swarmFactory must be a function');
  if (typeof storeFactory !== 'function') throw new TypeError('storeFactory must be a function');
  if (typeof driveFactory !== 'function') throw new TypeError('driveFactory must be a function');

  const records = new Map();
  const idsByName = new Map();
  const idsByKey = new Map();
  const knownStorageByKey = new Map();
  let sequence = 0;
  let opening = Promise.resolve();
  let closingPromise = null;
  let shutdownStarted = false;

  function assertActive() {
    if (shutdownStarted) throw new Error('Drive service is closed');
  }

  function enqueueOpen(operation) {
    const result = opening.then(operation, operation);
    opening = result.catch(() => {});
    return result;
  }

  function publicDescriptor(record) {
    return {
      id: record.id,
      name: record.name,
      key: record.key,
      writable: record.writable,
      version: record.version,
      status: record.opened ? 'ready' : record.cleanupError ? 'closing-error' : 'closed',
      opened: record.opened,
      discovering: Boolean(record.swarm && record.discovery && record.opened)
    };
  }

  function hasCleanupResources(record) {
    return Boolean(record.discovery || record.swarm || record.drive || record.store);
  }

  function assertCleanupComplete(record) {
    if (hasCleanupResources(record)) throw new Error(`Drive cleanup is incomplete: ${record.name}`);
  }

  function resolve(reference, { requireOpen = true } = {}) {
    if (typeof reference !== 'string' || !reference || CONTROL_PATTERN.test(reference)) {
      throw new TypeError('Drive reference must be a non-empty string');
    }
    const id = records.has(reference) ? reference : idsByName.get(reference.toLowerCase());
    const record = id ? records.get(id) : null;
    if (!record) throw new Error(`Drive not found: ${reference}`);
    if (requireOpen && !record.opened) throw new Error(`Drive is closed: ${reference}`);
    return record;
  }

  async function startDiscovery(record) {
    const swarm = swarmFactory(record);
    if (!swarm) return;
    if (typeof swarm.on !== 'function' || typeof swarm.join !== 'function' || typeof swarm.destroy !== 'function') {
      throw new TypeError('swarmFactory must return a Hyperswarm-compatible instance');
    }
    let done = null;
    record.swarm = swarm;
    try {
      swarm.on('connection', (socket) => {
        if (!record.opened) return socket.destroy();
        try { record.drive.replicate(socket); } catch (error) { socket.destroy(error); }
      });
      done = record.drive.findingPeers();
      record.discovery = swarm.join(record.drive.discoveryKey, { server: true, client: true });
      if (record.discovery?.flushed) await record.discovery.flushed();
    } catch (error) {
      const discovery = record.discovery;
      record.discovery = null;
      record.swarm = null;
      try { await discovery?.destroy?.(); } catch {}
      try { await swarm.destroy(); } catch {}
      throw error;
    } finally {
      done?.();
    }
  }

  async function openRecord({ name, key = null, storagePath }) {
    let openDrives = 0;
    for (const record of records.values()) {
      if (record.opened) openDrives += 1;
    }
    if (openDrives >= maxDrives) throw new RangeError('Drive limit reached');
    const store = storeFactory(storagePath);
    const drive = driveFactory(store, key ? b4a.from(key, 'hex') : null);
    try {
      await drive.ready();
      const keyHex = b4a.toString(drive.key, 'hex');
      const existingId = idsByKey.get(keyHex);
      if (existingId && records.get(existingId)?.opened) throw new Error('Drive is already open');
      const previous = existingId ? records.get(existingId) : null;
      const id = existingId || `drive-${keyHex.slice(0, 12)}-${++sequence}`;
      const record = {
        id,
        name,
        key: keyHex,
        writable: Boolean(drive.writable),
        version: drive.version,
        opened: true,
        drive,
        store,
        swarm: null,
        discovery: null,
        storagePath,
        closePromise: null,
        cleanupError: null
      };
      await startDiscovery(record);
      if (previous && idsByName.get(previous.name.toLowerCase()) === id) idsByName.delete(previous.name.toLowerCase());
      records.set(id, record);
      idsByName.set(name.toLowerCase(), id);
      idsByKey.set(keyHex, id);
      knownStorageByKey.set(keyHex, storagePath);
      return publicDescriptor(record);
    } catch (error) {
      try { await drive.close(); } catch {}
      try { await store.close(); } catch {}
      throw error;
    }
  }

  async function closeRecord(record) {
    if (record.closePromise) return record.closePromise;
    if (record.opened) {
      record.opened = false;
      record.version = record.drive?.version ?? record.version;
    }
    if (!hasCleanupResources(record)) {
      record.cleanupError = null;
      return publicDescriptor(record);
    }
    record.closePromise = (async () => {
      const errors = [];
      const closeOne = async (field) => {
        const resource = record[field];
        if (!resource) return;
        try {
          if (typeof resource.destroy === 'function') await resource.destroy();
          else if (typeof resource.close === 'function') await resource.close();
          if (record[field] === resource) record[field] = null;
        } catch (error) {
          errors.push(error);
        }
      };
      try {
        await closeOne('discovery');
        await closeOne('swarm');
        await closeOne('drive');
        await closeOne('store');
        record.cleanupError = errors[0] || null;
        if (errors.length) throw errors[0];
        return publicDescriptor(record);
      } finally {
        record.closePromise = null;
      }
    })();
    return record.closePromise;
  }

  async function create(nameValue) {
    assertActive();
    const name = normalizeName(nameValue);
    const existingId = idsByName.get(name.toLowerCase());
    if (existingId) {
      const existing = records.get(existingId);
      if (existing.opened) throw new Error(`Drive name is already open: ${name}`);
      assertCleanupComplete(existing);
      return openRecord({
        name,
        key: existing.writable ? null : existing.key,
        storagePath: existing.storagePath
      });
    }
    return openRecord({ name, storagePath: path.join(storageRoot, 'named', storageToken(name.toLowerCase())) });
  }

  async function open(keyValue, nameValue) {
    assertActive();
    const key = normalizeKey(keyValue);
    const name = nameValue === undefined ? `drive-${key.slice(0, 12)}` : normalizeName(nameValue);
    const nameId = idsByName.get(name.toLowerCase());
    if (nameId && records.get(nameId).key !== key) throw new Error(`Drive name is already in use: ${name}`);
    const keyId = idsByKey.get(key);
    if (keyId) {
      const existing = records.get(keyId);
      if (existing.opened) throw new Error('Drive is already open');
      assertCleanupComplete(existing);
    }
    const storagePath = knownStorageByKey.get(key) || path.join(storageRoot, 'keys', key);
    return openRecord({ name, key, storagePath });
  }

  async function listFiles(record, prefix = '/', limit = MAX_FILES) {
    const files = [];
    for await (const entry of record.drive.entries()) {
      if (!entry?.value?.blob || !entry.key.startsWith(prefix)) continue;
      files.push(entry.key);
      if (files.length > limit) break;
    }
    files.sort();
    return { files: files.slice(0, limit), capped: files.length > limit };
  }

  return Object.freeze({
    async create(name) { return enqueueOpen(() => create(name)); },
    async open(key, name) { return enqueueOpen(() => open(key, name)); },
    async list() { assertActive(); return Array.from(records.values(), publicDescriptor); },
    async status(reference) {
      assertActive();
      const record = resolve(reference, { requireOpen: false });
      const descriptor = publicDescriptor(record);
      if (!record.opened) return descriptor;
      record.version = record.drive.version;
      const listing = await listFiles(record);
      return { ...publicDescriptor(record), fileCount: listing.files.length, fileCountCapped: listing.capped };
    },
    async put(reference, pathValue, content) {
      assertActive();
      const record = resolve(reference);
      if (!record.writable) throw new Error('Drive is read-only');
      const filePath = normalizeDrivePath(pathValue);
      if (typeof content !== 'string') throw new TypeError('Drive content must be text');
      const bytes = b4a.byteLength(content);
      if (bytes > MAX_CONTENT_BYTES) throw new RangeError('Drive content is too large');
      await record.drive.put(filePath, b4a.from(content));
      record.version = record.drive.version;
      return { ...publicDescriptor(record), path: filePath, bytes };
    },
    async get(reference, pathValue) {
      assertActive();
      const record = resolve(reference);
      const filePath = normalizeDrivePath(pathValue);
      let content = await record.drive.get(filePath, { wait: false });
      if (content === null && !record.writable) {
        content = await withTimeout((async () => {
          await record.drive.update({ wait: true });
          return record.drive.get(filePath);
        })(), readTimeout, 'Timed out waiting for drive peers');
        record.version = record.drive.version;
      }
      if (content === null) throw new Error(`Drive file not found: ${filePath}`);
      if (content.byteLength > MAX_CONTENT_BYTES) throw new RangeError('Drive output is too large');
      return { path: filePath, content: b4a.toString(content), bytes: content.byteLength };
    },
    async files(reference, prefixValue) {
      assertActive();
      const record = resolve(reference);
      const prefix = normalizePrefix(prefixValue);
      return listFiles(record, prefix);
    },
    async del(reference, pathValue) {
      assertActive();
      const record = resolve(reference);
      if (!record.writable) throw new Error('Drive is read-only');
      const filePath = normalizeDrivePath(pathValue);
      const existed = await record.drive.exists(filePath);
      if (existed) await record.drive.del(filePath);
      record.version = record.drive.version;
      return { ...publicDescriptor(record), path: filePath, deleted: existed };
    },
    async resolveMirrorDestination(reference) {
      assertActive();
      const record = resolve(reference);
      if (!record.writable || !record.drive?.writable) throw new Error('Mirror destination must be open and writable');
      return Object.freeze({ id: record.id, drive: record.drive, writable: true });
    },
    async closeDrive(reference) { assertActive(); return closeRecord(resolve(reference, { requireOpen: false })); },
    replicate(reference, streamOrInitiator) { assertActive(); return resolve(reference).drive.replicate(streamOrInitiator); },
    async close() {
      if (closingPromise) return closingPromise;
      shutdownStarted = true;
      const attempt = opening.then(() => Promise.allSettled(Array.from(records.values(), closeRecord))).then((results) => {
        const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Drive service shutdown failed');
      });
      closingPromise = attempt;
      try {
        return await attempt;
      } finally {
        if (closingPromise === attempt) closingPromise = null;
      }
    }
  });
}

export {
  MAX_CONTENT_BYTES,
  MAX_FILES,
  MAX_PATH_BYTES,
  MAX_SWARM_PEERS,
  createDefaultSwarmFactory,
  normalizeDrivePath,
  normalizeKey,
  normalizeName,
  createHyperdriveService,
  withTimeout
};
