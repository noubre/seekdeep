import b4a from 'b4a';

const DEFAULT_MAX_MESSAGE_BYTES = 128 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 512 * 1024;
const DEFAULT_MAX_QUEUED_REQUESTS = 128;
const MAX_ID_LENGTH = 64;
const MIN_MESSAGE_BYTES = 128;
const EVENT_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

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

function requiredString(values, key) {
  if (typeof values[key] !== 'string' || !values[key]) throw new TypeError(`${key} must be a non-empty string`);
  return values[key];
}

function stringValue(values, key) {
  if (typeof values[key] !== 'string') throw new TypeError(`${key} must be a string`);
  return values[key];
}

function optionalString(values, key) {
  if (values[key] === undefined) return undefined;
  return requiredString(values, key);
}

function booleanValue(values, key) {
  if (typeof values[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`);
  return values[key];
}

function localdriveDefinition(operation, validate, invoke) {
  return {
    validate,
    async invoke(...args) {
      try {
        return await invoke(...args);
      } catch {
        const safe = new Error(`Localdrive ${operation} failed`);
        safe.code = `LOCALDRIVE_${operation.toUpperCase()}_FAILED`;
        throw safe;
      }
    }
  };
}

function mirrorDefinition(operation, validate, invoke) {
  return {
    validate,
    async invoke(...args) {
      try {
        return await invoke(...args);
      } catch {
        const safe = new Error(`Mirror ${operation} failed`);
        safe.code = `MIRROR_${operation.toUpperCase()}_FAILED`;
        throw safe;
      }
    }
  };
}

function createDriveRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Drive service is required');
  return Object.freeze({
    'drive.create': { validate(params) { const p = assertPlainDataObject(params, ['name']); return [requiredString(p, 'name')]; }, invoke: (name) => service.create(name) },
    'drive.open': { validate(params) { const p = assertPlainDataObject(params, ['key', 'name']); return [requiredString(p, 'key'), optionalString(p, 'name')]; }, invoke: (key, name) => service.open(key, name) },
    'drive.list': { validate(params) { assertPlainDataObject(params, []); return []; }, invoke: () => service.list() },
    'drive.status': { validate(params) { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, invoke: (ref) => service.status(ref) },
    'drive.put': { validate(params) { const p = assertPlainDataObject(params, ['ref', 'path', 'content']); return [requiredString(p, 'ref'), requiredString(p, 'path'), stringValue(p, 'content')]; }, invoke: (ref, path, content) => service.put(ref, path, content) },
    'drive.get': { validate(params) { const p = assertPlainDataObject(params, ['ref', 'path']); return [requiredString(p, 'ref'), requiredString(p, 'path')]; }, invoke: (ref, path) => service.get(ref, path) },
    'drive.files': { validate(params) { const p = assertPlainDataObject(params, ['ref', 'prefix']); return [requiredString(p, 'ref'), optionalString(p, 'prefix')]; }, invoke: (ref, prefix) => service.files(ref, prefix) },
    'drive.del': { validate(params) { const p = assertPlainDataObject(params, ['ref', 'path']); return [requiredString(p, 'ref'), requiredString(p, 'path')]; }, invoke: (ref, path) => service.del(ref, path) },
    'drive.close': { validate(params) { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, invoke: (ref) => service.closeDrive(ref) }
  });
}

function createLocaldriveRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Localdrive service is required');
  return Object.freeze({
    'localdrive.add': localdriveDefinition('add', (params) => { const p = assertPlainDataObject(params, ['name', 'root', 'writable']); return [requiredString(p, 'name'), requiredString(p, 'root'), booleanValue(p, 'writable')]; }, (name, root, writable) => service.add(name, root, writable)),
    'localdrive.list': localdriveDefinition('list', (params) => { assertPlainDataObject(params, []); return []; }, () => service.list()),
    'localdrive.status': localdriveDefinition('status', (params) => { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, (ref) => service.status(ref)),
    'localdrive.files': localdriveDefinition('files', (params) => { const p = assertPlainDataObject(params, ['ref', 'prefix']); return [requiredString(p, 'ref'), optionalString(p, 'prefix')]; }, (ref, prefix) => service.files(ref, prefix)),
    'localdrive.get': localdriveDefinition('get', (params) => { const p = assertPlainDataObject(params, ['ref', 'path']); return [requiredString(p, 'ref'), requiredString(p, 'path')]; }, (ref, path) => service.get(ref, path)),
    'localdrive.put': localdriveDefinition('put', (params) => { const p = assertPlainDataObject(params, ['ref', 'path', 'content']); return [requiredString(p, 'ref'), requiredString(p, 'path'), stringValue(p, 'content')]; }, (ref, path, content) => service.put(ref, path, content)),
    'localdrive.remove': localdriveDefinition('remove', (params) => { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, (ref) => service.remove(ref))
  });
}

function createMirrorRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Mirror service is required');
  return Object.freeze({
    'mirror.start': mirrorDefinition('start', (params) => {
      const p = assertPlainDataObject(params, ['localRef', 'driveRef', 'dryRun', 'prune', 'prefix']);
      return [requiredString(p, 'localRef'), requiredString(p, 'driveRef'), {
        dryRun: booleanValue(p, 'dryRun'),
        prune: booleanValue(p, 'prune'),
        prefix: requiredString(p, 'prefix')
      }];
    }, (localRef, driveRef, options) => service.start(localRef, driveRef, options)),
    'mirror.status': mirrorDefinition('status', (params) => {
      const p = assertPlainDataObject(params, ['id']);
      return [optionalString(p, 'id')];
    }, (id) => service.status(id)),
    'mirror.stop': mirrorDefinition('stop', (params) => {
      const p = assertPlainDataObject(params, ['id']);
      return [requiredString(p, 'id')];
    }, (id) => service.stop(id))
  });
}

function createBeamRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Beam service is required');
  return Object.freeze({
    'beam.create': { validate(params) { const p = assertPlainDataObject(params, ['name']); return [requiredString(p, 'name')]; }, invoke: (name) => service.create(name) },
    'beam.join': { validate(params) { const p = assertPlainDataObject(params, ['name', 'key']); return [requiredString(p, 'name'), requiredString(p, 'key')]; }, invoke: (name, key) => service.join(name, key) },
    'beam.list': { validate(params) { assertPlainDataObject(params, []); return []; }, invoke: () => service.list() },
    'beam.status': { validate(params) { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, invoke: (ref) => service.status(ref) },
    'beam.send': { validate(params) { const p = assertPlainDataObject(params, ['ref', 'content']); return [requiredString(p, 'ref'), stringValue(p, 'content')]; }, invoke: (ref, content) => service.send(ref, content) },
    'beam.receive': { validate(params) { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, invoke: (ref) => service.receive(ref) },
    'beam.close': { validate(params) { const p = assertPlainDataObject(params, ['ref']); return [requiredString(p, 'ref')]; }, invoke: (ref) => service.closeBeam(ref) }
  });
}

function createChatRpcMethods(service) {
  if (!service || typeof service.methods !== 'object' || !service.methods) throw new TypeError('Chat service is required');
  const call = (name) => (params) => service.methods[name](params);
  return Object.freeze({
    'chat.status': { validate(params) { assertPlainDataObject(params, []); return [{}]; }, invoke: call('chat.status') },
    'chat.create': { validate(params) { const p = assertPlainDataObject(params, ['name']); return [{ name: optionalString(p, 'name') }]; }, invoke: call('chat.create') },
    'chat.join': { validate(params) { const p = assertPlainDataObject(params, ['topic']); return [{ topic: requiredString(p, 'topic') }]; }, invoke: call('chat.join') },
    'chat.leave': { validate(params) { assertPlainDataObject(params, []); return [{}]; }, invoke: call('chat.leave') },
    'chat.peers': { validate(params) { assertPlainDataObject(params, []); return [{}]; }, invoke: call('chat.peers') },
    'chat.send': { validate(params) { const p = assertPlainDataObject(params, ['prompt', 'model']); return [{ prompt: requiredString(p, 'prompt'), model: requiredString(p, 'model') }]; }, invoke: call('chat.send') },
    'chat.setMode': { validate(params) { const p = assertPlainDataObject(params, ['collaborative']); return [{ collaborative: booleanValue(p, 'collaborative') }]; }, invoke: call('chat.setMode') },
    'chat.refreshModels': { validate(params) { assertPlainDataObject(params, []); return [{}]; }, invoke: call('chat.refreshModels') },
    'chat.setProvider': { validate(params) { const p = assertPlainDataObject(params, ['provider']); return [{ provider: requiredString(p, 'provider') }]; }, invoke: call('chat.setProvider') }
  });
}

function createResourceRpcMethods(services) {
  if (!services || typeof services !== 'object' || Array.isArray(services)) throw new TypeError('Resource services are required');
  return Object.freeze({
    ...createDriveRpcMethods(services.drive),
    ...createLocaldriveRpcMethods(services.localdrive),
    ...(services.mirror ? createMirrorRpcMethods(services.mirror) : {}),
    ...(services.beam ? createBeamRpcMethods(services.beam) : {}),
    ...(services.chat ? createChatRpcMethods(services.chat) : {})
  });
}

function validateRequest(value) {
  const request = assertPlainDataObject(value, ['id', 'method', 'params'], 'RPC request');
  if (!Object.hasOwn(request, 'id') || !Object.hasOwn(request, 'method') || !Object.hasOwn(request, 'params')) {
    throw new TypeError('RPC request requires exactly id, method, and params');
  }
  if ((typeof request.id !== 'string' && !Number.isSafeInteger(request.id)) || !String(request.id) || String(request.id).length > MAX_ID_LENGTH) {
    throw new TypeError('RPC request id is invalid');
  }
  if (typeof request.method !== 'string' || !request.method) throw new TypeError('RPC method is invalid');
  if (!isPlainObject(request.params)) throw new TypeError('RPC params must be a plain object');
  return request;
}

function validateLimit(value, label = 'maxMessageBytes') {
  if (!Number.isSafeInteger(value) || value < MIN_MESSAGE_BYTES) throw new TypeError(`${label} must be an integer of at least ${MIN_MESSAGE_BYTES}`);
  return value;
}

function validateCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function createJsonRpcServer(pipe, methods, options = {}) {
  if (!pipe || typeof pipe.on !== 'function' || typeof pipe.write !== 'function') throw new TypeError('RPC pipe must be duplex');
  if (!isPlainObject(methods)) throw new TypeError('RPC methods must be a plain object');
  const maxMessageBytes = validateLimit(options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES);
  const maxAggregateBytes = validateLimit(options.maxAggregateBytes ?? Math.max(DEFAULT_MAX_AGGREGATE_BYTES, maxMessageBytes), 'maxAggregateBytes');
  if (maxAggregateBytes < maxMessageBytes) throw new TypeError('maxAggregateBytes must be at least maxMessageBytes');
  const maxQueuedRequests = validateCount(options.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS, 'maxQueuedRequests');
  let buffered = b4a.alloc(0);
  let closed = false;
  let transportClosed = false;
  let closingPromise = null;
  let chain = Promise.resolve();
  let queuedRequests = 0;
  let terminating = false;

  function write(frame) {
    return new Promise((resolve, reject) => {
      try { pipe.write(frame, (error) => error ? reject(error) : resolve()); } catch (error) { reject(error); }
    });
  }

  function send(message) {
    if (closed || transportClosed || pipe.destroyed) return Promise.resolve();
    assertJsonData(message);
    const frame = b4a.from(`${JSON.stringify(message)}\n`);
    if (frame.byteLength > maxMessageBytes) {
      const fallback = b4a.from(`${JSON.stringify({ id: message.id ?? null, ok: false, error: 'RPC response is too large' })}\n`);
      if (fallback.byteLength > maxMessageBytes) return Promise.resolve();
      return write(fallback);
    }
    return write(frame);
  }

  async function handle(line) {
    let id = null;
    try {
      const request = validateRequest(JSON.parse(b4a.toString(line)));
      id = request.id;
      const definition = Object.hasOwn(methods, request.method) ? methods[request.method] : null;
      if (!definition || typeof definition.validate !== 'function' || typeof definition.invoke !== 'function') {
        throw new Error(`RPC method is not allowed: ${request.method}`);
      }
      const args = definition.validate(request.params);
      const result = await definition.invoke(...args);
      assertJsonData(result);
      await send({ id, ok: true, result });
    } catch (error) {
      const safe = error instanceof Error && typeof error.code === 'string' && (error.code.startsWith('LOCALDRIVE_') || error.code.startsWith('MIRROR_'))
        ? { code: error.code.slice(0, 128), message: error.message.slice(0, 1024) }
        : (error instanceof Error ? error.message.slice(0, 1024) : 'RPC request failed');
      try { await send({ id, ok: false, error: safe }); } catch {}
    }
  }

  function terminate(message) {
    if (terminating || transportClosed) return;
    terminating = true;
    buffered = b4a.alloc(0);
    void send({ id: null, ok: false, error: message }).catch(() => {}).then(() => {
      try { pipe.destroy?.(new Error(message)); } catch {}
    });
  }

  function onData(chunk) {
    if (closed || terminating) return;
    const incoming = b4a.from(chunk);
    if (incoming.byteLength > maxAggregateBytes || buffered.byteLength + incoming.byteLength > maxAggregateBytes) {
      return terminate('RPC aggregate message is too large');
    }
    buffered = b4a.concat([buffered, incoming]);
    let newline;
    while ((newline = b4a.indexOf(buffered, 10)) !== -1) {
      if (newline + 1 > maxMessageBytes) return terminate('RPC message is too large');
      const line = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (!line.byteLength) continue;
      if (queuedRequests >= maxQueuedRequests) return terminate('RPC queued request limit reached');
      queuedRequests += 1;
      chain = chain.then(() => handle(line)).catch(() => {}).finally(() => { queuedRequests -= 1; });
    }
    if (buffered.byteLength > maxMessageBytes) terminate('RPC message is too large');
  }

  function onError() {
    transportClosed = true;
    buffered = b4a.alloc(0);
  }
  function onClose() {
    transportClosed = true;
    buffered = b4a.alloc(0);
  }
  pipe.on('data', onData);
  pipe.on('error', onError);
  pipe.on('close', onClose);
  pipe.on('end', onClose);

  function notify(event, data) {
    if (typeof event !== 'string' || !EVENT_PATTERN.test(event)) throw new TypeError('RPC event name is invalid');
    assertJsonData(data);
    if (closed || transportClosed || pipe.destroyed) return Promise.resolve();
    const frame = b4a.from(`${JSON.stringify({ event, data })}\n`);
    if (frame.byteLength > maxMessageBytes) return Promise.reject(new RangeError('RPC event is too large'));
    return write(frame);
  }

  return Object.freeze({
    notify,
    close() {
      if (closingPromise) return closingPromise;
      closed = true;
      pipe.off?.('data', onData);
      pipe.off?.('error', onError);
      pipe.off?.('close', onClose);
      pipe.off?.('end', onClose);
      closingPromise = chain.then(() => {
        if (!transportClosed && !pipe.destroyed && !pipe.writableEnded) pipe.end?.();
      });
      return closingPromise;
    }
  });
}

export {
  DEFAULT_MAX_AGGREGATE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_QUEUED_REQUESTS,
  EVENT_PATTERN,
  assertJsonData,
  assertPlainDataObject,
  createDriveRpcMethods,
  createLocaldriveRpcMethods,
  createMirrorRpcMethods,
  createBeamRpcMethods,
  createChatRpcMethods,
  createResourceRpcMethods,
  createJsonRpcServer
};
