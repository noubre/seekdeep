/**
 * Bare entry. Packed by bare-pack into app.bundle and started by BareKit.
 *
 * Bare.IPC is the duplex byte stream to the Swift host (see bare-kit's README);
 * bare-fs supplies the promise-based fs the Localdrive service and harness need.
 * The storage root is passed in by the host: a Bare worklet has no Pear.app.storage.
 *
 * `globalThis.fetch` does not exist in this Bare build even though it does in Node, so
 * the provider router gets an explicit implementation — same resolution order as
 * js/runtime/boot.js.
 */
import * as bareFs from 'bare-fs'
import http from 'bare-http1'
import { createWorklet } from './worklet.js'

const fs = bareFs.promises || (await import('bare-fs/promises'))

async function resolveFetch () {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch
  const module = await import('bare-fetch')
  const resolved = module.default || module
  if (typeof resolved !== 'function') throw new Error('bare-fetch did not provide a fetch implementation')
  return resolved
}

const storageArg = Bare.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--storage='))
if (!storageArg) {
  console.error('[worklet] missing --storage=<absolute path>')
  Bare.exit(1)
}
const storageRoot = storageArg.slice('--storage='.length)

await createWorklet({
  ipc: Bare.IPC,
  fs,
  storageRoot,
  argv: Bare.argv.slice(1),
  fetchImpl: await resolveFetch(),
  http
})

// The worklet dies with the host process; createWorklet()'s `end` handler flushes
// drives on a clean quit.
//
// `process` is not a global in this Bare build (Bare.IPC and Bare.argv are), so the
// handlers are installed only when it exists. Without them an uncaught rejection
// reaches BareKit and aborts the host, which is Bare's documented default.
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('uncaughtException', (error) => { console.error('[worklet] uncaught', error); process.exit(1) })
  process.on('unhandledRejection', (error) => { console.error('[worklet] unhandled', error); process.exit(1) })
}
