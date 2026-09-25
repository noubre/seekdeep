import Localdrive from 'localdrive';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import path from 'path';

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const STORAGE_PREFIX = '@storage/';
const MAX_LOCAL_NAME_CHARS = 80;
const MAX_LOCAL_ALIAS_BYTES = 512;
const MAX_LOCAL_PATH_BYTES = 512;
const MAX_LOCAL_CONTENT_BYTES = 64 * 1024;
const MAX_LOCAL_FILES = 100;
const MAX_LOCAL_MAPPINGS = 32;
const MAX_ID_ATTEMPTS = 8;
const FS_METHODS = ['lstat', 'mkdir', 'readFile', 'realpath'];
const SAFE_LOCALDRIVE_ERROR = Symbol('safeLocaldriveError');

function createFilesystem(filesystem) {
  const loading = filesystem
    ? Promise.resolve(filesystem)
    : import('bare-fs/promises').then((module) => module.default || module);
  return Object.freeze(Object.fromEntries(FS_METHODS.map((method) => [method, async (...args) => {
    const implementation = await loading;
    if (typeof implementation?.[method] !== 'function') throw new TypeError(`Filesystem does not implement ${method}`);
    return implementation[method](...args);
  }])));
}

function byteLength(value) {
  return b4a.byteLength(value);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function normalizeLocalName(value) {
  if (typeof value !== 'string') throw new TypeError('Localdrive name must be a string');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > MAX_LOCAL_NAME_CHARS || CONTROL_PATTERN.test(name)) {
    throw new TypeError(`Localdrive name must be 1-${MAX_LOCAL_NAME_CHARS} printable characters`);
  }
  return name;
}

function referenceKey(value) {
  return value.normalize('NFC').toLowerCase();
}

function normalizedSegments(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${label} contains invalid characters`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must be normalized and must not contain traversal`);
  }
  return segments;
}

function normalizeLocalAlias(value) {
  if (typeof value !== 'string' || !value.startsWith(STORAGE_PREFIX)) {
    throw new TypeError(`Localdrive root alias must start with ${STORAGE_PREFIX}`);
  }
  const relative = value.slice(STORAGE_PREFIX.length);
  const segments = normalizedSegments(relative, 'Localdrive root alias');
  const alias = `${STORAGE_PREFIX}${segments.join('/')}`;
  if (byteLength(alias) > MAX_LOCAL_ALIAS_BYTES) throw new RangeError('Localdrive root alias is too large');
  return alias;
}

function normalizeLocalPath(value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new TypeError('Localdrive path contains invalid characters');
  }
  const rooted = value.startsWith('/') ? value : `/${value}`;
  if (rooted === '/') {
    if (allowRoot) return rooted;
    throw new TypeError('Localdrive path must identify a file, not root');
  }
  normalizedSegments(rooted.slice(1), 'Localdrive path');
  if (byteLength(rooted) > MAX_LOCAL_PATH_BYTES) throw new RangeError('Localdrive path is too large');
  return rooted;
}

function contains(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeError(message, code) {
  const error = new Error(message);
  error.code = code;
  Object.defineProperty(error, SAFE_LOCALDRIVE_ERROR, { value: true });
  return error;
}

function operationError(operation) {
  return safeError(`Localdrive ${operation} failed`, `LOCALDRIVE_${operation.toUpperCase()}_FAILED`);
}

function sanitizeError(operation, error) {
  if (error?.[SAFE_LOCALDRIVE_ERROR] || error instanceof TypeError || error instanceof RangeError) return error;
  return operationError(operation);
}

async function lstatOrNull(fs, filename) {
  try { return await fs.lstat(filename); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertNoSymlinkPath(fs, root, target, { allowMissing = false } = {}) {
  if (!contains(root, target)) throw safeError('Localdrive path is outside the configured storage root', 'LOCALDRIVE_PATH_OUTSIDE_ROOT');
  const rootReal = await fs.realpath(root);
  const relative = target === root ? '' : target.slice(root.length + 1);
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(fs, current);
    if (!stat) {
      if (allowMissing) return;
      throw safeError('Localdrive path does not exist', 'LOCALDRIVE_PATH_NOT_FOUND');
    }
    if (stat.isSymbolicLink()) throw safeError('Localdrive symbolic links are not allowed in mapped paths', 'LOCALDRIVE_SYMLINK_REJECTED');
  }
  const real = await fs.realpath(target);
  if (!contains(rootReal, real)) throw safeError('Localdrive path is outside the configured storage root', 'LOCALDRIVE_PATH_OUTSIDE_ROOT');
}

function statType(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isFile()) return 'file';
  if (stat.isDirectory()) return 'directory';
  return 'other';
}

function statValue(stat, name) {
  return stat[name] === undefined ? null : stat[name];
}

function snapshotEntry(stat) {
  return {
    dev: statValue(stat, 'dev'),
    ino: statValue(stat, 'ino'),
    mode: statValue(stat, 'mode'),
    type: statType(stat),
    size: statValue(stat, 'size'),
    mtimeMs: statValue(stat, 'mtimeMs'),
    ctimeMs: statValue(stat, 'ctimeMs')
  };
}

function sameSnapshot(before, after) {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index];
    const right = after[index];
    for (const field of ['dev', 'ino', 'mode', 'type', 'size', 'mtimeMs', 'ctimeMs']) {
      if (left[field] !== right[field]) return false;
    }
  }
  return true;
}

function defaultIdFactory() {
  return `local-${b4a.toString(crypto.randomBytes(12), 'hex')}`;
}

function createLocaldriveService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Localdrive service options must be an object');
  const configuredRoot = options.localdriveRoot;
  if (typeof configuredRoot !== 'string' || !configuredRoot) throw new TypeError('localdriveRoot is required');
  const localdriveRoot = path.resolve(configuredRoot);
  if (!path.isAbsolute(configuredRoot) || path.dirname(localdriveRoot) === localdriveRoot) {
    throw new TypeError('localdriveRoot must be an absolute non-root path');
  }
  const LocaldriveConstructor = options.Localdrive || Localdrive;
  const fs = createFilesystem(options.fs);
  const idFactory = options.idFactory || defaultIdFactory;
  const maxMappings = positiveInteger(options.maxMappings ?? MAX_LOCAL_MAPPINGS, 'maxMappings');
  const maxFiles = positiveInteger(options.maxFiles ?? MAX_LOCAL_FILES, 'maxFiles');
  if (typeof LocaldriveConstructor !== 'function') throw new TypeError('Localdrive must be a constructor');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');

  const records = new Map();
  const idsByName = new Map();
  const idsByAlias = new Map();
  const idsByReference = new Map();
  let operations = Promise.resolve();
  let shutdown = false;
  let closing = null;

  function assertActive() {
    if (shutdown) throw safeError('Localdrive service is closed', 'LOCALDRIVE_CLOSED');
  }

  function enqueue(operation) {
    const result = operations.then(operation, operation);
    operations = result.catch(() => {});
    return result;
  }

  function run(operation, task) {
    return enqueue(async () => {
      assertActive();
      try { return await task(); } catch (error) { throw sanitizeError(operation, error); }
    });
  }

  function descriptor(record, status = 'ready') {
    return { id: record.id, name: record.name, root: record.alias, writable: false, status };
  }

  function resolve(reference) {
    if (typeof reference !== 'string' || !reference || reference.length > 160 || CONTROL_PATTERN.test(reference)) {
      throw new TypeError('Localdrive reference must be a non-empty printable string');
    }
    const id = idsByReference.get(referenceKey(reference));
    const record = id ? records.get(id) : null;
    if (!record) throw safeError('Localdrive mapping was not found', 'LOCALDRIVE_NOT_FOUND');
    return record;
  }

  async function prepareRoot(alias) {
    await fs.mkdir(localdriveRoot, { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(fs, path.dirname(localdriveRoot), localdriveRoot);
    const relative = alias.slice(STORAGE_PREFIX.length).split('/');
    const target = path.resolve(localdriveRoot, ...relative);
    if (!contains(localdriveRoot, target) || target === localdriveRoot) {
      throw safeError('Localdrive root alias is outside the configured storage root', 'LOCALDRIVE_PATH_OUTSIDE_ROOT');
    }
    const existing = await lstatOrNull(fs, target);
    if (!existing) {
      await assertNoSymlinkPath(fs, localdriveRoot, target, { allowMissing: true });
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
    }
    await assertNoSymlinkPath(fs, localdriveRoot, target);
    const stat = await fs.lstat(target);
    if (!stat.isDirectory()) throw safeError('Localdrive root alias must identify a directory', 'LOCALDRIVE_ROOT_NOT_DIRECTORY');
    return { target, identity: { dev: stat.dev, ino: stat.ino } };
  }

  async function assertRecordRoot(record) {
    await assertNoSymlinkPath(fs, localdriveRoot, record.rootPath);
    const stat = await fs.lstat(record.rootPath);
    if (!stat.isDirectory() || stat.dev !== record.identity.dev || stat.ino !== record.identity.ino) {
      throw safeError('Localdrive mapped root changed during operation', 'LOCALDRIVE_ROOT_CHANGED');
    }
  }

  async function snapshotPath(record, target) {
    if (!contains(record.rootPath, target)) {
      throw safeError('Localdrive path is outside the mapped root', 'LOCALDRIVE_PATH_OUTSIDE_ROOT');
    }
    await assertRecordRoot(record);
    const relative = target === record.rootPath ? '' : target.slice(record.rootPath.length + 1);
    const filenames = [record.rootPath];
    let current = record.rootPath;
    for (const segment of relative ? relative.split(path.sep) : []) {
      current = path.join(current, segment);
      filenames.push(current);
    }

    const snapshot = [];
    for (const filename of filenames) {
      const stat = await lstatOrNull(fs, filename);
      if (!stat) throw safeError('Localdrive path does not exist', 'LOCALDRIVE_PATH_NOT_FOUND');
      if (stat.isSymbolicLink()) {
        throw safeError('Localdrive symbolic links are not allowed in mapped paths', 'LOCALDRIVE_SYMLINK_REJECTED');
      }
      snapshot.push(snapshotEntry(stat));
    }
    const root = snapshot[0];
    if (root.type !== 'directory' || root.dev !== record.identity.dev || root.ino !== record.identity.ino) {
      throw safeError('Localdrive mapped root changed during operation', 'LOCALDRIVE_ROOT_CHANGED');
    }
    const rootReal = await fs.realpath(record.rootPath);
    const targetReal = await fs.realpath(target);
    if (!contains(rootReal, targetReal)) {
      throw safeError('Localdrive path is outside the mapped root', 'LOCALDRIVE_PATH_OUTSIDE_ROOT');
    }
    return snapshot;
  }

  function pathChanged() {
    return safeError('Localdrive path changed during operation', 'LOCALDRIVE_PATH_CHANGED');
  }

  async function verifySnapshot(record, target, before) {
    let after;
    try {
      after = await snapshotPath(record, target);
    } catch {
      throw pathChanged();
    }
    if (!sameSnapshot(before, after)) throw pathChanged();
    return after;
  }

  async function listFiles(record, prefixValue = '/', limit = maxFiles) {
    const prefix = normalizeLocalPath(prefixValue || '/', { allowRoot: true });
    const rootSnapshot = await snapshotPath(record, record.rootPath);
    const candidates = [];
    const candidateSnapshots = [];
    const scanLimit = Math.max(limit + 1, Math.min(limit * 10, 1000));
    let capped = false;
    for await (const entry of record.drive.list('/')) {
      if (!entry?.value?.blob || !entry.key.startsWith(prefix)) continue;
      let filePath;
      try { filePath = normalizeLocalPath(entry.key); } catch { capped = true; continue; }
      const target = path.resolve(record.rootPath, `.${filePath}`);
      const snapshot = await snapshotPath(record, target);
      candidates.push(filePath);
      candidateSnapshots.push({ target, snapshot });
      if (candidates.length >= scanLimit) { capped = true; break; }
    }
    await verifySnapshot(record, record.rootPath, rootSnapshot);
    for (const candidate of candidateSnapshots) {
      await verifySnapshot(record, candidate.target, candidate.snapshot);
    }
    candidates.sort();
    const files = [];
    let outputBytes = 0;
    for (const filePath of candidates) {
      const bytes = byteLength(filePath);
      if (files.length >= limit || outputBytes + bytes > MAX_LOCAL_CONTENT_BYTES) { capped = true; break; }
      files.push(filePath);
      outputBytes += bytes;
    }
    return { files, capped };
  }

  async function add(nameValue, aliasValue, writable = false) {
    const name = normalizeLocalName(nameValue);
    const alias = normalizeLocalAlias(aliasValue);
    if (typeof writable !== 'boolean') throw new TypeError('Localdrive writable must be a boolean');
    if (writable) {
      throw safeError('Localdrive writable mappings are not supported without a race-safe filesystem primitive', 'LOCALDRIVE_WRITABLE_UNSUPPORTED');
    }
    if (records.size >= maxMappings) throw new RangeError('Localdrive mapping limit reached');
    const nameKey = referenceKey(name);
    if (idsByName.has(nameKey)) throw safeError('Localdrive name is already in use', 'LOCALDRIVE_NAME_IN_USE');
    if (idsByReference.has(nameKey)) throw safeError('Localdrive name conflicts with an existing id', 'LOCALDRIVE_REFERENCE_IN_USE');
    if (idsByAlias.has(alias)) throw safeError('Localdrive root is already in use', 'LOCALDRIVE_ROOT_IN_USE');

    let id = null;
    let idKey = null;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = idFactory();
      if (typeof candidate !== 'string' || !candidate || candidate.length > 160 || CONTROL_PATTERN.test(candidate)) {
        throw new TypeError('Localdrive idFactory returned an invalid id');
      }
      const candidateKey = referenceKey(candidate);
      if (records.has(candidate) || idsByReference.has(candidateKey) || idsByName.has(candidateKey) || candidateKey === nameKey) continue;
      id = candidate;
      idKey = candidateKey;
      break;
    }
    if (!id) throw safeError('Unable to allocate a unique Localdrive id', 'LOCALDRIVE_ID_EXHAUSTED');

    const { target: rootPath, identity } = await prepareRoot(alias);
    const drive = new LocaldriveConstructor(rootPath, { atomic: true, followLinks: false, followExternalLinks: false });
    try {
      await drive.ready();
    } catch (error) {
      try { await drive.close(); } catch {}
      throw error;
    }
    const record = { id, idKey, name, nameKey, alias, rootPath, identity, drive, closePromise: null, closed: false };
    records.set(id, record);
    idsByName.set(nameKey, id);
    idsByAlias.set(alias, id);
    idsByReference.set(nameKey, id);
    idsByReference.set(idKey, id);
    return descriptor(record);
  }

  async function closeRecord(record) {
    if (record.closed) return descriptor(record, 'removed');
    if (record.closePromise) return record.closePromise;
    record.closePromise = Promise.resolve()
      .then(() => record.drive.close())
      .then(() => {
        record.closed = true;
        return descriptor(record, 'removed');
      })
      .catch(() => {
        record.closePromise = null;
        throw operationError('close');
      });
    return record.closePromise;
  }

  return Object.freeze({
    add(name, alias, writable = false) { return run('add', () => add(name, alias, writable)); },
    list() { return run('list', () => Array.from(records.values(), (record) => descriptor(record))); },
    status(reference) {
      return run('status', async () => {
        const record = resolve(reference);
        const listing = await listFiles(record);
        return { ...descriptor(record), fileCount: listing.files.length, fileCountCapped: listing.capped };
      });
    },
    files(reference, prefix) { return run('files', () => listFiles(resolve(reference), prefix)); },
    get(reference, pathValue) {
      return run('get', async () => {
        const record = resolve(reference);
        const filePath = normalizeLocalPath(pathValue);
        const target = path.resolve(record.rootPath, `.${filePath}`);
        const before = await snapshotPath(record, target);
        const targetStat = before[before.length - 1];
        if (targetStat.type !== 'file') throw safeError('Localdrive file was not found', 'LOCALDRIVE_FILE_NOT_FOUND');
        if (targetStat.size > MAX_LOCAL_CONTENT_BYTES) throw new RangeError('Localdrive output is too large');
        const content = await fs.readFile(target);
        await verifySnapshot(record, target, before);
        if (content.byteLength > MAX_LOCAL_CONTENT_BYTES) throw new RangeError('Localdrive output is too large');
        return { path: filePath, content: b4a.toString(content), bytes: content.byteLength };
      });
    },
    put(reference, pathValue, content) {
      return run('put', async () => {
        resolve(reference);
        normalizeLocalPath(pathValue);
        if (typeof content !== 'string') throw new TypeError('Localdrive content must be text');
        if (byteLength(content) > MAX_LOCAL_CONTENT_BYTES) throw new RangeError('Localdrive content is too large');
        throw safeError('Localdrive mapping is read-only', 'LOCALDRIVE_READ_ONLY');
      });
    },
    resolveMirrorSource(reference) {
      return run('resolve', async () => {
        const record = resolve(reference);
        await assertRecordRoot(record);
        return Object.freeze({
          id: record.id,
          drive: record.drive,
          validate: () => assertRecordRoot(record)
        });
      });
    },
    remove(reference) {
      return run('remove', async () => {
        const record = resolve(reference);
        const result = await closeRecord(record);
        records.delete(record.id);
        idsByName.delete(record.nameKey);
        idsByAlias.delete(record.alias);
        idsByReference.delete(record.nameKey);
        idsByReference.delete(record.idKey);
        return result;
      });
    },
    close() {
      if (closing) return closing;
      shutdown = true;
      const attempt = operations.then(async () => {
        const results = await Promise.allSettled(Array.from(records.values(), closeRecord));
        const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Localdrive service shutdown failed');
      });
      closing = attempt.catch((error) => {
        closing = null;
        throw error;
      });
      return closing;
    }
  });
}

export {
  MAX_LOCAL_ALIAS_BYTES,
  MAX_LOCAL_CONTENT_BYTES,
  MAX_LOCAL_FILES,
  MAX_LOCAL_MAPPINGS,
  MAX_LOCAL_PATH_BYTES,
  createLocaldriveService,
  normalizeLocalAlias,
  normalizeLocalName,
  normalizeLocalPath
};
