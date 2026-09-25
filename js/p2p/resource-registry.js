/**
 * Ephemeral registry of serializable P2P resource descriptors.
 * Live service handles and secret capability keys stay with their owning service.
 */
const RESOURCE_TYPES = Object.freeze(['drive', 'localdrive', 'mirror', 'beam']);
const RESOURCE_TYPE_SET = new Set(RESOURCE_TYPES);
const MAX_NAME_LENGTH = 80;
const ID_ATTEMPTS = 8;
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const TYPE_DEFINITIONS = Object.freeze({
  drive: Object.freeze({
    allowedInput: Object.freeze(['name', 'key', 'status']),
    mutable: Object.freeze(['name', 'key', 'status']),
    statuses: Object.freeze(['creating', 'ready', 'closed', 'error']),
    defaultStatus: 'ready'
  }),
  localdrive: Object.freeze({
    allowedInput: Object.freeze(['name', 'status']),
    mutable: Object.freeze(['name', 'status']),
    statuses: Object.freeze(['opening', 'ready', 'closed', 'error']),
    defaultStatus: 'ready'
  }),
  mirror: Object.freeze({
    allowedInput: Object.freeze(['name', 'localId', 'driveId', 'direction', 'status']),
    mutable: Object.freeze(['name', 'localId', 'driveId', 'direction', 'status']),
    statuses: Object.freeze(['pending', 'running', 'stopped', 'completed', 'error']),
    defaultStatus: 'running'
  }),
  beam: Object.freeze({
    allowedInput: Object.freeze(['name', 'status']),
    mutable: Object.freeze(['name', 'status']),
    statuses: Object.freeze(['connecting', 'open', 'closed', 'error']),
    defaultStatus: 'open'
  })
});

function hasPlainPrototype(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readDataObject(value, allowedKeys, label, { requireAny = false } = {}) {
  if (!hasPlainPrototype(value)) throw new TypeError(`${label} must be a plain object`);

  const keys = Reflect.ownKeys(value);
  if (requireAny && keys.length === 0) throw new TypeError(`${label} must not be empty`);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) {
      throw new TypeError(`${label} contains an unsupported field: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties`);
    }
  }

  return Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key).value]));
}

function normalizeName(value) {
  if (typeof value !== 'string') throw new TypeError('Resource name must be a string');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name) throw new TypeError('Resource name must not be empty');
  if (name.length > MAX_NAME_LENGTH) {
    throw new RangeError(`Resource name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(name)) throw new TypeError('Resource name contains control characters');
  return name;
}

function normalizeLookupName(value) {
  return normalizeName(value).toLowerCase();
}

function normalizeStatus(type, value) {
  const definition = TYPE_DEFINITIONS[type];
  if (typeof value !== 'string' || !definition.statuses.includes(value)) {
    throw new TypeError(`Invalid ${type} status; expected one of: ${definition.statuses.join(', ')}`);
  }
  return value;
}

function normalizeKey(value) {
  if (typeof value !== 'string' || !HEX_KEY_PATTERN.test(value)) {
    throw new TypeError('Drive key must be a 64-character hexadecimal public key');
  }
  return value.toLowerCase();
}

function normalizeDirection(value) {
  if (value !== 'push' && value !== 'pull' && value !== 'sync') {
    throw new TypeError('Mirror direction must be push, pull, or sync');
  }
  return value;
}

function normalizeLimit(value, fallback, label) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return selected;
}

function defaultIdFactory(type) {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure random UUID generation is unavailable; provide an idFactory');
  }
  return `${type}-${crypto.randomUUID()}`;
}

function cloneFrozen(row) {
  return Object.freeze({ ...row });
}

function createP2pResourceRegistry(options = {}) {
  const optionValues = readDataObject(
    options,
    ['idFactory', 'now', 'maxResources', 'maxResourcesPerType'],
    'Registry options'
  );
  const idFactory = optionValues.idFactory ?? defaultIdFactory;
  const now = optionValues.now ?? Date.now;
  const maxResources = normalizeLimit(optionValues.maxResources, 512, 'maxResources');
  const maxResourcesPerType = normalizeLimit(optionValues.maxResourcesPerType, 128, 'maxResourcesPerType');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const rowsById = new Map();
  const idsByType = new Map(RESOURCE_TYPES.map((type) => [type, new Set()]));
  const idsByName = new Map(RESOURCE_TYPES.map((type) => [type, new Map()]));

  function assertType(type) {
    if (!RESOURCE_TYPE_SET.has(type)) {
      throw new TypeError(`Invalid resource type; expected one of: ${RESOURCE_TYPES.join(', ')}`);
    }
  }

  function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('now() must return a non-negative safe integer timestamp');
    }
    return value;
  }

  function createId(type) {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
      const id = idFactory(type);
      if (typeof id !== 'string' || !SAFE_ID_PATTERN.test(id)) {
        throw new TypeError('idFactory must return a safe non-empty string ID');
      }
      if (!rowsById.has(id) && !idsByName.get(type).has(normalizeLookupName(id))) return id;
    }
    throw new Error('Unable to generate a unique resource ID');
  }

  function assertNameAvailable(type, name, currentId = null) {
    const existingId = idsByName.get(type).get(name.toLowerCase());
    if (existingId && existingId !== currentId) {
      throw new Error(`A ${type} resource with that name already exists`);
    }
    for (const id of idsByType.get(type)) {
      if (id !== currentId && id.toLowerCase() === name.toLowerCase()) {
        throw new Error(`A ${type} resource name cannot collide with an existing resource ID`);
      }
    }
  }

  function findInternal(type, idOrName) {
    assertType(type);
    if (typeof idOrName !== 'string') throw new TypeError('Resource lookup must be a string ID or name');
    const direct = rowsById.get(idOrName);
    if (direct?.type === type) return direct;
    const id = idsByName.get(type).get(normalizeLookupName(idOrName));
    return id ? rowsById.get(id) : null;
  }

  function resolveReference(type, value, field) {
    if (typeof value !== 'string') {
      throw new TypeError(`Mirror ${field} must reference a registered ${type} by ID or name`);
    }
    const row = findInternal(type, value);
    if (!row) throw new TypeError(`Mirror ${field} must reference a registered ${type} by ID or name`);
    return row.id;
  }

  function referencingMirror(source) {
    if (source.type !== 'localdrive' && source.type !== 'drive') return null;
    const field = source.type === 'localdrive' ? 'localId' : 'driveId';
    for (const mirrorId of idsByType.get('mirror')) {
      const mirror = rowsById.get(mirrorId);
      if (mirror[field] === source.id) return mirror;
    }
    return null;
  }

  function assertNotReferenced(source, operation) {
    const mirror = referencingMirror(source);
    if (mirror) {
      throw new Error(
        `Cannot ${operation} ${source.type} resource ${source.id}; it is referenced by mirror ${mirror.id}`
      );
    }
  }

  function normalizeCreate(type, input) {
    const definition = TYPE_DEFINITIONS[type];
    const values = readDataObject(input, definition.allowedInput, `${type} descriptor`);
    const name = normalizeName(values.name);
    const status = normalizeStatus(type, values.status ?? definition.defaultStatus);
    const normalized = { name };

    if (type === 'drive' && values.key !== undefined) normalized.key = normalizeKey(values.key);
    if (type === 'mirror') {
      normalized.localId = resolveReference('localdrive', values.localId, 'localId');
      normalized.driveId = resolveReference('drive', values.driveId, 'driveId');
      normalized.direction = normalizeDirection(values.direction);
    }

    normalized.status = status;
    return normalized;
  }

  function add(type, input) {
    assertType(type);
    if (rowsById.size >= maxResources) throw new RangeError('P2P resource limit reached');
    if (idsByType.get(type).size >= maxResourcesPerType) {
      throw new RangeError(`${type} resource limit reached`);
    }

    const values = normalizeCreate(type, input);
    assertNameAvailable(type, values.name);
    const id = createId(type);
    const createdAt = timestamp();
    const row = { id, type, ...values, createdAt, updatedAt: createdAt };
    rowsById.set(id, row);
    idsByType.get(type).add(id);
    idsByName.get(type).set(values.name.toLowerCase(), id);
    return cloneFrozen(row);
  }

  function list(type) {
    if (type !== undefined) assertType(type);
    const ids = type === undefined ? rowsById.keys() : idsByType.get(type).values();
    return Object.freeze(Array.from(ids, (id) => cloneFrozen(rowsById.get(id))));
  }

  function find(type, idOrName) {
    const row = findInternal(type, idOrName);
    return row ? cloneFrozen(row) : null;
  }

  function findById(id) {
    if (typeof id !== 'string') throw new TypeError('Resource ID must be a string');
    const row = rowsById.get(id);
    return row ? cloneFrozen(row) : null;
  }

  function update(type, idOrName, patch) {
    const current = findInternal(type, idOrName);
    if (!current) return null;
    const definition = TYPE_DEFINITIONS[type];
    const values = readDataObject(patch, definition.mutable, `${type} update`, { requireAny: true });
    const next = { ...current };

    if (Object.hasOwn(values, 'name')) {
      const name = normalizeName(values.name);
      assertNameAvailable(type, name, current.id);
      if (name !== current.name) assertNotReferenced(current, 'rename');
      next.name = name;
    }
    if (Object.hasOwn(values, 'status')) next.status = normalizeStatus(type, values.status);
    if (type === 'drive' && Object.hasOwn(values, 'key')) next.key = normalizeKey(values.key);
    if (type === 'mirror') {
      if (Object.hasOwn(values, 'localId')) {
        next.localId = resolveReference('localdrive', values.localId, 'localId');
      }
      if (Object.hasOwn(values, 'driveId')) {
        next.driveId = resolveReference('drive', values.driveId, 'driveId');
      }
      if (Object.hasOwn(values, 'direction')) next.direction = normalizeDirection(values.direction);
    }

    const changed = Object.keys(values).some((key) => next[key] !== current[key]);
    if (!changed) return cloneFrozen(current);
    // Equality is allowed when the clock does not advance or moves backward.
    next.updatedAt = Math.max(current.updatedAt, timestamp());
    rowsById.set(current.id, next);
    if (next.name !== current.name) {
      idsByName.get(type).delete(current.name.toLowerCase());
      idsByName.get(type).set(next.name.toLowerCase(), current.id);
    }
    return cloneFrozen(next);
  }

  function updateStatus(id, status) {
    if (typeof id !== 'string') throw new TypeError('Resource ID must be a string');
    const row = rowsById.get(id);
    return row ? update(row.type, id, { status }) : null;
  }

  function remove(type, idOrName) {
    const row = findInternal(type, idOrName);
    if (!row) return false;
    assertNotReferenced(row, 'remove');
    rowsById.delete(row.id);
    idsByType.get(type).delete(row.id);
    idsByName.get(type).delete(row.name.toLowerCase());
    return true;
  }

  return Object.freeze({
    add,
    list,
    find,
    findById,
    update,
    updateStatus,
    remove,
    addDrive: (input) => add('drive', input),
    listDrives: () => list('drive'),
    findDrive: (idOrName) => find('drive', idOrName),
    updateDrive: (idOrName, patch) => update('drive', idOrName, patch),
    removeDrive: (idOrName) => remove('drive', idOrName),
    addLocaldrive: (input) => add('localdrive', input),
    listLocaldrives: () => list('localdrive'),
    findLocaldrive: (idOrName) => find('localdrive', idOrName),
    updateLocaldrive: (idOrName, patch) => update('localdrive', idOrName, patch),
    removeLocaldrive: (idOrName) => remove('localdrive', idOrName),
    addMirror: (input) => add('mirror', input),
    listMirrors: () => list('mirror'),
    findMirror: (idOrName) => find('mirror', idOrName),
    updateMirror: (idOrName, patch) => update('mirror', idOrName, patch),
    removeMirror: (idOrName) => remove('mirror', idOrName),
    addBeam: (input) => add('beam', input),
    listBeams: () => list('beam'),
    findBeam: (idOrName) => find('beam', idOrName),
    updateBeam: (idOrName, patch) => update('beam', idOrName, patch),
    removeBeam: (idOrName) => remove('beam', idOrName)
  });
}

const defaultP2pResourceRegistry = createP2pResourceRegistry();

export {
  RESOURCE_TYPES,
  TYPE_DEFINITIONS,
  createP2pResourceRegistry,
  defaultP2pResourceRegistry
};
