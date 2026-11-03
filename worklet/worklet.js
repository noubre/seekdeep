/**
 * Boot the unmodified SeekDeep worker backend over a duplex byte stream.
 *
 * tui.js proves this is legal outside Pear: pass `config.storage` explicitly and inject
 * an `fs`. Everything else is the same code path the desktop app uses.
 */
import path from 'path'                     // Bare resolves its builtin; Node resolves node:path
import { createPipeAdapter } from './pipe-adapter.js'
import { createWorkerBackend } from '../js/p2p/worker-runtime.js'
import { createProviderRouter } from '../js/llm/provider.js'
import { parseBootstrapArgs } from '../js/p2p/bootstrap-args.js'

export async function createWorklet ({ ipc, fs, storageRoot, argv = [], fetchImpl = globalThis.fetch, logger = console }) {
  if (typeof storageRoot !== 'string' || !path.isAbsolute(storageRoot)) {
    throw new TypeError('createWorklet requires an absolute storageRoot')
  }
  const pipe = createPipeAdapter(ipc)
  const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(argv)
  const providers = createProviderRouter({
    fetch: fetchImpl,
    baseUrls: { ollama: ollamaUrl, lmstudio: lmstudioUrl }
  })
  const backend = await createWorkerBackend(pipe, {
    config: { storage: storageRoot },
    providers,
    bootstrap,
    fs,
    harnessLogger: logger
  })
  // When the host closes its side of the IPC the pipe ends: flush drives, stop the swarm,
  // and end our own side. Without that last step the IPC keeps the worklet alive forever
  // and the host's `worklet.wait()` never returns.
  pipe.once('end', () => {
    void backend.close().catch(() => {}).then(() => { try { pipe.end() } catch {} })
  })
  return { backend, pipe }
}
