/**
 * Adapt a Bare.IPC (or any duplex byte stream) to the exact surface
 * js/p2p/rpc-server.js expects: on/off/once for data|error|close|end,
 * write(chunk, cb), end(), destroy(), and `destroyed` / `writableEnded` flags.
 *
 * Zero imports on purpose: this file runs inside Bare, inside Node, and in tests.
 * `node:events` does not resolve under Bare — bare-pack leaves it as a runtime import
 * and the worklet aborts with MODULE_NOT_FOUND — so the six methods we need are inline.
 */

const FORWARDED = ['data', 'error', 'close', 'end']

function createEventEmitter () {
  const listeners = new Map()

  function entries (name) {
    let list = listeners.get(name)
    if (!list) {
      list = []
      listeners.set(name, list)
    }
    return list
  }

  return {
    on (name, handler, once = false) {
      entries(name).push({ handler, once })
    },
    off (name, handler) {
      listeners.set(name, entries(name).filter((entry) => entry.handler !== handler))
    },
    emit (name, payload) {
      const list = entries(name)
      if (list.length === 0) return false
      for (const entry of [...list]) {
        if (entry.once) listeners.set(name, entries(name).filter((candidate) => candidate !== entry))
        entry.handler(payload)
      }
      return true
    },
    listenerCount (name) {
      return entries(name).length
    }
  }
}

export function createPipeAdapter (ipc) {
  if (!ipc || typeof ipc.write !== 'function') throw new TypeError('createPipeAdapter requires a writable stream')

  const events = createEventEmitter()
  let destroyed = false
  let writableEnded = false

  // Inbound frames can arrive while the backend is still booting, before
  // createJsonRpcServer attaches `data`/`end`. A plain emitter drops those, so
  // queue them. `end`/`close` are sticky: a later `once('end')` (used by
  // createWorklet to flush drives) must still fire.
  const queued = new Map()
  const settled = new Map()

  function deliver (name, payload) {
    if (events.listenerCount(name) === 0) {
      const queue = queued.get(name)
      if (queue) queue.push(payload)
      else queued.set(name, [payload])
      return
    }
    events.emit(name, payload)
  }

  function flush (name) {
    const queue = queued.get(name)
    if (!queue || queue.length === 0) return false
    queued.set(name, [])
    for (const payload of queue) events.emit(name, payload)
    return true
  }

  function subscribe (name, handler, once) {
    const hadQueued = (queued.get(name)?.length ?? 0) > 0
    events.on(name, handler, once)
    const flushed = flush(name)
    if (!hadQueued && !flushed && settled.has(name)) {
      events.emit(name, settled.get(name))
    }
    return pipe
  }

  const bound = {}
  for (const name of FORWARDED) {
    bound[name] = (payload) => {
      if (name === 'end' || name === 'close') {
        writableEnded = true
        settled.set(name, payload)
      }
      deliver(name, payload)
    }
    if (typeof ipc.on === 'function') ipc.on(name, bound[name])
  }

  const pipe = {
    get destroyed () { return destroyed },
    get writableEnded () { return writableEnded },
    on: (name, handler) => subscribe(name, handler, false),
    off: (name, handler) => { events.off(name, handler); return pipe },
    once: (name, handler) => subscribe(name, handler, true),
    write (chunk, callback) {
      if (destroyed) { callback?.(new Error('pipe is destroyed')); return false }
      try { ipc.write(chunk); callback?.(); return true } catch (error) { callback?.(error); return false }
    },
    end () {
      if (writableEnded) return
      writableEnded = true
      try { ipc.end?.() } catch { /* already closed */ }
    },
    destroy (error) {
      if (destroyed) return
      destroyed = true
      writableEnded = true
      settled.set('close', undefined)
      for (const name of FORWARDED) {
        if (typeof ipc.off === 'function') ipc.off(name, bound[name])
        else if (typeof ipc.removeListener === 'function') ipc.removeListener(name, bound[name])
      }
      events.emit('close')
      if (error) queueMicrotask(() => events.emit('error', error))
    }
  }

  return pipe
}
