import b4a from 'b4a';
import {
  DEFAULT_MAX_AGGREGATE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_MAX_QUEUED_REQUESTS,
  EVENT_PATTERN,
  MAX_ID_LENGTH,
  MIN_MESSAGE_BYTES,
  assertJsonData,
  assertPlainDataObject,
  hasSafeErrorCode,
  isPlainObject
} from './rpc-codec.js';
import { RPC_METHOD_NAMES } from './rpc-methods.js';

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

/**
 * Wrap one method so any service failure becomes a coded, message-only payload
 * the renderer client is allowed to forward (`rpc-codec.js`'s allowlist).
 * `label` is derived from the code prefix: `LOCALDRIVE` -> `Localdrive`.
 */
function codedDefinition(prefix, operation, validate, invoke) {
  return {
    validate,
    async invoke(...args) {
      try {
        return await invoke(...args);
      } catch {
        const label = prefix.charAt(0) + prefix.slice(1).toLowerCase();
        const safe = new Error(`${label} ${operation} failed`);
        safe.code = `${prefix}_${operation.toUpperCase()}_FAILED`;
        throw safe;
      }
    }
  };
}

/**
 * Build one method definition from its parameter spec.
 *
 * - `required`/`optional` list the accepted keys in argument order; each is
 *   validated as a non-empty string unless `validators[key]` overrides the rule.
 * - `asParams` hands the method a single params object instead of positional
 *   arguments (the chat methods take one object).
 * - `validate` replaces the generated validation for shapes that do not fit it.
 */
function defineRpcMethod({ required = [], optional = [], validators = {}, asParams = false, validate, invoke }) {
  if (typeof invoke !== 'function') throw new TypeError('RPC method definitions require an invoke function');
  if (validate) return { validate, invoke };
  const keys = [...required, ...optional];
  const rule = (key, fallback) => validators[key] || fallback;
  return {
    validate(params) {
      const p = assertPlainDataObject(params, keys);
      if (asParams) {
        const args = {};
        for (const key of required) args[key] = rule(key, requiredString)(p, key);
        for (const key of optional) args[key] = rule(key, optionalString)(p, key);
        return [args];
      }
      const args = required.map((key) => rule(key, requiredString)(p, key));
      for (const key of optional) {
        if (p[key] !== undefined) args.push(rule(key, requiredString)(p, key));
      }
      return args;
    },
    invoke
  };
}

function buildMethods(specs, codePrefix = null) {
  const table = {};
  for (const [name, spec] of Object.entries(specs)) {
    const definition = defineRpcMethod(spec);
    table[name] = codePrefix
      ? codedDefinition(codePrefix, name.slice(name.indexOf('.') + 1), definition.validate, definition.invoke)
      : definition;
  }
  return Object.freeze(table);
}

/**
 * Method specs per service group. Building a group's table never touches the
 * service, so the drift check below enumerates every name any factory can
 * produce without a second hand-maintained list.
 */
const METHOD_SPECS = Object.freeze({
  drive: (service) => ({
    'drive.create': { required: ['name'], invoke: (name) => service.create(name) },
    'drive.open': { required: ['key'], optional: ['name'], invoke: (key, name) => service.open(key, name) },
    'drive.list': { invoke: () => service.list() },
    'drive.status': { required: ['ref'], invoke: (ref) => service.status(ref) },
    'drive.put': { required: ['ref', 'path', 'content'], validators: { content: stringValue }, invoke: (ref, path, content) => service.put(ref, path, content) },
    'drive.get': { required: ['ref', 'path'], invoke: (ref, path) => service.get(ref, path) },
    'drive.files': { required: ['ref'], optional: ['prefix'], invoke: (ref, prefix) => service.files(ref, prefix) },
    'drive.del': { required: ['ref', 'path'], invoke: (ref, path) => service.del(ref, path) },
    'drive.close': { required: ['ref'], invoke: (ref) => service.closeDrive(ref) }
  }),
  localdrive: (service) => ({
    'localdrive.add': { required: ['name', 'root', 'writable'], validators: { writable: booleanValue }, invoke: (name, root, writable) => service.add(name, root, writable) },
    'localdrive.list': { invoke: () => service.list() },
    'localdrive.status': { required: ['ref'], invoke: (ref) => service.status(ref) },
    'localdrive.files': { required: ['ref'], optional: ['prefix'], invoke: (ref, prefix) => service.files(ref, prefix) },
    'localdrive.get': { required: ['ref', 'path'], invoke: (ref, path) => service.get(ref, path) },
    'localdrive.put': { required: ['ref', 'path', 'content'], validators: { content: stringValue }, invoke: (ref, path, content) => service.put(ref, path, content) },
    'localdrive.remove': { required: ['ref'], invoke: (ref) => service.remove(ref) }
  }),
  mirror: (service) => ({
    'mirror.start': {
      validate(params) {
        const p = assertPlainDataObject(params, ['localRef', 'driveRef', 'dryRun', 'prune', 'prefix']);
        return [requiredString(p, 'localRef'), requiredString(p, 'driveRef'), {
          dryRun: booleanValue(p, 'dryRun'),
          prune: booleanValue(p, 'prune'),
          prefix: requiredString(p, 'prefix')
        }];
      },
      invoke: (localRef, driveRef, options) => service.start(localRef, driveRef, options)
    },
    'mirror.status': { optional: ['id'], invoke: (id) => service.status(id) },
    'mirror.stop': { required: ['id'], invoke: (id) => service.stop(id) }
  }),
  beam: (service) => ({
    'beam.create': { required: ['name'], invoke: (name) => service.create(name) },
    'beam.join': { required: ['name', 'key'], invoke: (name, key) => service.join(name, key) },
    'beam.list': { invoke: () => service.list() },
    'beam.status': { required: ['ref'], invoke: (ref) => service.status(ref) },
    'beam.send': { required: ['ref', 'content'], validators: { content: stringValue }, invoke: (ref, content) => service.send(ref, content) },
    'beam.receive': { required: ['ref'], invoke: (ref) => service.receive(ref) },
    'beam.close': { required: ['ref'], invoke: (ref) => service.closeBeam(ref) }
  }),
  chat: (service) => {
    const call = (name) => (params) => service.methods[name](params);
    return {
      'chat.status': { asParams: true, invoke: call('chat.status') },
      'chat.create': { optional: ['name'], asParams: true, invoke: call('chat.create') },
      'chat.join': { required: ['topic'], asParams: true, invoke: call('chat.join') },
      'chat.leave': { asParams: true, invoke: call('chat.leave') },
      'chat.peers': { asParams: true, invoke: call('chat.peers') },
      'chat.send': { required: ['prompt', 'model'], asParams: true, invoke: call('chat.send') },
      'chat.setMode': { required: ['collaborative'], validators: { collaborative: booleanValue }, asParams: true, invoke: call('chat.setMode') },
      'chat.refreshModels': { asParams: true, invoke: call('chat.refreshModels') },
      'chat.setProvider': { required: ['provider'], asParams: true, invoke: call('chat.setProvider') }
    };
  },
  harness: (harness) => ({
    'slash.list': { invoke: () => harness.runtime.list() },
    'slash.dispatch': { required: ['text'], invoke: async (text) => ({ handled: await harness.dispatch(text) }) }
  })
});

const METHOD_PROBE = Object.freeze({ methods: Object.freeze({}) });

/** Every method name any factory can produce, enumerated from its spec table. */
const KNOWN_METHOD_NAMES = Object.freeze(
  Object.values(METHOD_SPECS).flatMap((buildSpecs) => Object.keys(buildSpecs(METHOD_PROBE)))
);

{
  const known = new Set(KNOWN_METHOD_NAMES);
  const listed = new Set(RPC_METHOD_NAMES);
  const missing = RPC_METHOD_NAMES.filter((name) => !known.has(name));
  const unexpected = KNOWN_METHOD_NAMES.filter((name) => !listed.has(name));
  if (missing.length || unexpected.length || known.size !== KNOWN_METHOD_NAMES.length) {
    const duplicates = KNOWN_METHOD_NAMES.filter((name, index) => KNOWN_METHOD_NAMES.indexOf(name) !== index);
    throw new Error(
      `RPC method list drift: missing [${missing.join(', ')}]; unexpected [${unexpected.join(', ')}]; duplicate [${duplicates.join(', ')}]`
    );
  }
}

function createDriveRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Drive service is required');
  return buildMethods(METHOD_SPECS.drive(service));
}

function createLocaldriveRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Localdrive service is required');
  return buildMethods(METHOD_SPECS.localdrive(service), 'LOCALDRIVE');
}

function createMirrorRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Mirror service is required');
  return buildMethods(METHOD_SPECS.mirror(service), 'MIRROR');
}

function createBeamRpcMethods(service) {
  if (!service || typeof service !== 'object') throw new TypeError('Beam service is required');
  return buildMethods(METHOD_SPECS.beam(service));
}

function createChatRpcMethods(service) {
  if (!service || typeof service.methods !== 'object' || !service.methods) throw new TypeError('Chat service is required');
  return buildMethods(METHOD_SPECS.chat(service));
}

function createHarnessRpcMethods(harness) {
  if (!harness || typeof harness.dispatch !== 'function' || typeof harness.runtime?.list !== 'function') {
    throw new TypeError('Harness is required');
  }
  return buildMethods(METHOD_SPECS.harness(harness));
}

/**
 * Look up, validate, and invoke one method. Shared by the pipe server and the
 * in-process harness client so both validate identically.
 */
async function dispatchMethod(methods, name, params) {
  const definition = Object.hasOwn(methods, name) ? methods[name] : null;
  if (!definition || typeof definition.validate !== 'function' || typeof definition.invoke !== 'function') {
    throw new Error(`RPC method is not allowed: ${String(name)}`);
  }
  const args = definition.validate(params ?? {});
  return definition.invoke(...args);
}

function createResourceRpcMethods(services) {
  if (!services || typeof services !== 'object' || Array.isArray(services)) throw new TypeError('Resource services are required');
  return Object.freeze({
    ...(services.drive ? createDriveRpcMethods(services.drive) : {}),
    ...(services.localdrive ? createLocaldriveRpcMethods(services.localdrive) : {}),
    ...(services.mirror ? createMirrorRpcMethods(services.mirror) : {}),
    ...(services.beam ? createBeamRpcMethods(services.beam) : {}),
    ...(services.chat ? createChatRpcMethods(services.chat) : {}),
    ...(services.harness ? createHarnessRpcMethods(services.harness) : {})
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
      // Oversized frames are dropped, never rejected (see `notify`).
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
      const result = await dispatchMethod(methods, request.method, request.params);
      assertJsonData(result);
      await send({ id, ok: true, result });
    } catch (error) {
      const safe = error instanceof Error && hasSafeErrorCode(error.code)
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
    // Oversized frames are dropped, never rejected: the peer has no reply
    // channel for an event, and this matches `send()`'s silent drop.
    if (frame.byteLength > maxMessageBytes) return Promise.resolve();
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
  MAX_ID_LENGTH,
  MIN_MESSAGE_BYTES,
  assertJsonData,
  assertPlainDataObject,
  createHarnessRpcMethods,
  createResourceRpcMethods,
  createJsonRpcServer,
  dispatchMethod
};
