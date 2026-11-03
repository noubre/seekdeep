#!/usr/bin/env node
/**
 * Node-only entry: boots the worklet backend and serves it over stdio, so the macOS app
 * can be developed and integration-tested without BareKit.
 *
 *   node worklet/dev.js --stdio --storage=/tmp/seekdeep-dev
 */
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createWorklet } from './worklet.js'

const argv = process.argv.slice(2)
const storageArg = argv.find((arg) => arg.startsWith('--storage='))
const storageRoot = storageArg ? storageArg.slice('--storage='.length) : path.join(os.homedir(), '.seekdeep-dev')

process.stdout.on('error', () => process.exit(0))

// `process` is not a duplex: `js/p2p/rpc-server.js` needs `write(chunk, cb)` plus
// `data`/`end` on one object. Bare.IPC already is that duplex; this Node entry
// presents stdin/stdout as the same surface.
//
// stdin `end`/`close` are deliberately not put on that surface. The RPC server
// treats those events as "never write again", which would drop the reply to a
// request that arrived together with EOF. This entry owns shutdown instead.
const ipc = {
  write (chunk, callback) { return process.stdout.write(chunk, callback) },
  end () { process.stdout.end() },
  on (name, handler) {
    if (name === 'data') return process.stdin.on(name, handler)
    if (name === 'end' || name === 'close' || name === 'error') return undefined
    return process.on(name, handler)
  },
  off (name, handler) {
    if (name === 'data') return process.stdin.off(name, handler)
    if (name === 'end' || name === 'close' || name === 'error') return undefined
    return process.off(name, handler)
  },
  removeListener (name, handler) {
    if (name === 'data') return process.stdin.removeListener(name, handler)
    if (name === 'end' || name === 'close' || name === 'error') return undefined
    return process.removeListener(name, handler)
  }
}

const { backend } = await createWorklet({ ipc, fs, storageRoot, argv, http })

let closing = false
async function shutdown () {
  if (closing) return
  closing = true
  // One macrotask so a request that arrived with EOF can finish its reply.
  await new Promise((resolve) => setImmediate(resolve))
  try { await backend.close() } catch { /* already closing */ }
  // The pipe adapter's write callback is synchronous: wait for user-space
  // stdout to drain so the reply is not lost to process.exit().
  await new Promise((resolve) => {
    if (process.stdout.writableLength === 0) return resolve()
    process.stdout.once('drain', resolve)
    const timer = setTimeout(resolve, 250)
    timer.unref()
  })
  process.exit(0)
}

if (process.stdin.readableEnded) void shutdown()
else process.stdin.once('end', () => { void shutdown() })
