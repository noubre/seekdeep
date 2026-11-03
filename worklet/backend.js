/**
 * Bare entry. Packed by bare-pack into app.bundle and started by BareKit.
 *
 * Bare.IPC is the duplex byte stream to the Swift host (see bare-kit's README);
 * bare-fs supplies the promise-based fs the Localdrive service and harness need.
 * The storage root is passed in by the host: a Bare worklet has no Pear.app.storage.
 */
import * as bareFs from 'bare-fs'
import { createWorklet } from './worklet.js'

const fs = bareFs.promises || (await import('bare-fs/promises'))

const storageArg = Bare.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--storage='))
if (!storageArg) {
  console.error('[worklet] missing --storage=<absolute path>')
  Bare.exit(1)
}
const storageRoot = storageArg.slice('--storage='.length)

await createWorklet({ ipc: Bare.IPC, fs, storageRoot, argv: Bare.argv.slice(1) })

// The worklet dies with the host process; createWorklet()'s `end` handler flushes
// drives on a clean quit.
process.on('uncaughtException', (error) => { console.error('[worklet] uncaught', error); process.exit(1) })
process.on('unhandledRejection', (error) => { console.error('[worklet] unhandled', error); process.exit(1) })
