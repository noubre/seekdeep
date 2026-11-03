/**
 * Adapt a Bare.IPC (or any duplex byte stream) to the exact surface
 * js/p2p/rpc-server.js expects: on/off/once for data|error|close|end,
 * write(chunk, cb), end(), destroy(), and `destroyed` / `writableEnded` flags.
 *
 * Zero dependencies on purpose: this file runs inside Bare, inside Node, and in tests.
 */
import { EventEmitter } from 'node:events'

const FORWARDED = ['data', 'error', 'close', 'end']

export function createPipeAdapter (ipc) {
  if (!ipc || typeof ipc.write !== 'function') throw new TypeError('createPipeAdapter requires a writable stream')

  const events = new EventEmitter()
  let destroyed = false
  let writableEnded = false

  // Inbound frames can arrive while the backend is still booting, before
  // createJsonRpcServer attaches `data`/`end`. EventEmitter drops those, so
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
    if (once) events.once(name, handler)
    else events.on(name, handler)
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
      if (error) setImmediate(() => events.emit('error', error))
    }
  }

  return pipe
}
