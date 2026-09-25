import b4a from 'b4a';
import {
  DEFAULT_MAX_AGGREGATE_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  assertJsonData,
  assertPlainDataObject
} from './rpc-server.js';

const DEFAULT_MAX_PENDING_REQUESTS = 128;

const ALLOWED_METHODS = new Set([
  'drive.create', 'drive.open', 'drive.list', 'drive.status', 'drive.put',
  'drive.get', 'drive.files', 'drive.del', 'drive.close',
  'localdrive.add', 'localdrive.list', 'localdrive.status', 'localdrive.files',
  'localdrive.get', 'localdrive.put', 'localdrive.remove',
  'mirror.start', 'mirror.status', 'mirror.stop',
  'beam.create', 'beam.join', 'beam.list', 'beam.status', 'beam.send', 'beam.receive', 'beam.close'
]);


function defaultPipeFactory() {
  const worker = globalThis.Pear?.worker;
  if (!worker || typeof worker.pipe !== 'function') throw new Error('Pear worker pipe is unavailable');
  const pipe = worker.pipe();
  if (!pipe) throw new Error('Pear worker pipe is unavailable');
  return pipe;
}

function createRpcClient(options = {}) {
  const pipeFactory = options.pipeFactory || defaultPipeFactory;
  const timeout = options.timeout ?? 10000;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const maxAggregateBytes = options.maxAggregateBytes ?? Math.max(DEFAULT_MAX_AGGREGATE_BYTES, maxMessageBytes);
  const maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS;
  if (typeof pipeFactory !== 'function') throw new TypeError('pipeFactory must be a function');
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new TypeError('timeout must be a positive integer');
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 128) throw new TypeError('maxMessageBytes must be an integer of at least 128');
  if (!Number.isSafeInteger(maxAggregateBytes) || maxAggregateBytes < maxMessageBytes) throw new TypeError('maxAggregateBytes must be an integer of at least maxMessageBytes');
  if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1) throw new TypeError('maxPendingRequests must be a positive integer');
  let pipe = null;
  let buffered = b4a.alloc(0);
  let counter = 0;
  let closed = false;
  const pending = new Map();
  const eventHandlers = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function detach(target) {
    target.off?.('data', onData);
    target.off?.('error', onError);
    target.off?.('close', onClose);
    target.off?.('end', onClose);
  }

  function losePipe(target, error) {
    if (pipe !== target) return;
    detach(target);
    pipe = null;
    buffered = b4a.alloc(0);
    rejectPending(error);
  }

  function onError(error) { losePipe(this, error instanceof Error ? error : new Error('RPC pipe error')); }
  function onClose() { losePipe(this, new Error('RPC pipe closed')); }

  function malformed(error = new Error('Malformed RPC response')) {
    const target = pipe;
    if (!target) return;
    losePipe(target, error);
    if (typeof target.destroy !== 'function' || target.destroyed) return;

    // Node streams emit destroy(error)'s error asynchronously. Keep a scoped
    // listener until that error (or close) arrives after the pipe is detached.
    const cleanup = () => {
      target.off?.('error', consumeError);
      target.off?.('close', cleanup);
    };
    const consumeError = () => cleanup();
    target.on('error', consumeError);
    target.on('close', cleanup);
    try { target.destroy(error); } catch { cleanup(); }
  }

  function handleLine(line) {
    try {
      const parsed = JSON.parse(b4a.toString(line));
      if (
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        typeof parsed.event === 'string' && Reflect.ownKeys(parsed).length === 2 && Object.hasOwn(parsed, 'data')
      ) {
        assertJsonData(parsed.data);
        const handlers = eventHandlers.get(parsed.event);
        if (handlers) {
          for (const handler of handlers) {
            try { handler(parsed.data); } catch (error) { console.error(`RPC event handler failed for ${parsed.event}:`, error); }
          }
        }
        return;
      }
      const response = assertPlainDataObject(parsed, ['id', 'ok', 'result', 'error'], 'RPC response');
      if (typeof response.id !== 'string' && !Number.isSafeInteger(response.id)) throw new TypeError('RPC response id is invalid');
      const id = String(response.id);
      if (response.ok === true && Object.hasOwn(response, 'result') && !Object.hasOwn(response, 'error') && Reflect.ownKeys(response).length === 3) {
        assertJsonData(response.result);
      } else if (response.ok === false && !Object.hasOwn(response, 'result') && Reflect.ownKeys(response).length === 3 && (
        typeof response.error === 'string' || (
          response.error && Object.getPrototypeOf(response.error) === Object.prototype &&
          Reflect.ownKeys(response.error).length === 2 && typeof response.error.code === 'string' &&
          (response.error.code.startsWith('LOCALDRIVE_') || response.error.code.startsWith('MIRROR_')) && typeof response.error.message === 'string'
        )
      )) {
      } else {
        throw new Error('Malformed RPC response');
      }
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timer);
      if (response.ok) request.resolve(response.result);
      else {
        const error = new Error(typeof response.error === 'string' ? response.error : response.error.message);
        if (typeof response.error !== 'string') error.code = response.error.code;
        request.reject(error);
      }
    } catch (error) {
      malformed(error instanceof Error ? error : new Error('Malformed RPC response'));
    }
  }

  function onData(chunk) {
    const incoming = b4a.from(chunk);
    if (incoming.byteLength > maxAggregateBytes || buffered.byteLength + incoming.byteLength > maxAggregateBytes) {
      return malformed(new Error('RPC aggregate response is too large'));
    }
    buffered = b4a.concat([buffered, incoming]);
    let newline;
    while ((newline = b4a.indexOf(buffered, 10)) !== -1) {
      if (newline + 1 > maxMessageBytes) return malformed(new Error('RPC response is too large'));
      const line = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (line.byteLength) handleLine(line);
      if (!pipe) return;
    }
    if (buffered.byteLength > maxMessageBytes) malformed(new Error('RPC response is too large'));
  }

  function getPipe() {
    if (closed) throw new Error('RPC client is closed');
    if (pipe && !pipe.destroyed) return pipe;
    const next = pipeFactory();
    if (!next || typeof next.on !== 'function' || typeof next.write !== 'function') throw new TypeError('RPC pipe must be duplex');
    pipe = next;
    next.on('data', onData);
    next.on('error', onError);
    next.on('close', onClose);
    next.on('end', onClose);
    return next;
  }

  function request(method, params) {
    if (!ALLOWED_METHODS.has(method)) return Promise.reject(new Error(`RPC method is not allowed: ${String(method)}`));
    try {
      const allowedKeys = params && typeof params === 'object' ? Reflect.ownKeys(params) : [];
      assertPlainDataObject(params, allowedKeys, 'RPC params');
      assertJsonData(params);
    } catch (error) {
      return Promise.reject(error);
    }
    const id = String(++counter);
    const frame = b4a.from(`${JSON.stringify({ id, method, params })}\n`);
    if (frame.byteLength > maxMessageBytes) return Promise.reject(new RangeError('RPC request is too large'));
    if (pending.size >= maxPendingRequests) return Promise.reject(new RangeError('RPC pending request limit reached'));
    let target;
    try { target = getPipe(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      try {
        target.write(frame, (error) => {
          if (!error || !pending.has(id)) return;
          if (pipe === target) losePipe(target, error);
          else {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          }
        });
      } catch (error) {
        if (pipe === target) losePipe(target, error);
        else {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      }
    });
  }

  return Object.freeze({
    on(event, handler) {
      if (typeof event !== 'string' || !event) throw new TypeError('RPC event name must be a non-empty string');
      if (typeof handler !== 'function') throw new TypeError('RPC event handler must be a function');
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (!handlers.size) eventHandlers.delete(event);
      };
    },
    request,
    close() {
      if (closed) return;
      closed = true;
      const target = pipe;
      if (target) {
        detach(target);
        pipe = null;
        if (!target.destroyed && !target.writableEnded) target.end?.();
      }
      buffered = b4a.alloc(0);
      rejectPending(new Error('RPC client closed'));
    }
  });
}

const rpcClient = createRpcClient();

export { DEFAULT_MAX_PENDING_REQUESTS, createRpcClient, rpcClient };
