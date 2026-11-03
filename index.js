import Runtime from 'pear-electron';
import Bridge from 'pear-bridge';
import { createWorkerBackend } from './js/p2p/worker-runtime.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';
import { parseHarnessKey } from './js/harness/args.js';
import { createProviderRouter } from './js/llm/provider.js';
import { resolveLaunchArgs, resolveRuntimeFetch, installShutdown } from './js/runtime/boot.js';

const bridge = new Bridge();
await bridge.ready();

const runtime = new Runtime();
const pipe = await runtime.start({ bridge });

const args = resolveLaunchArgs();
const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(args);
const { harnessKey } = parseHarnessKey(args);
if (bootstrap.length) {
  console.log('[main] using local DHT bootstrap:', bootstrap.map((node) => `${node.host}:${node.port}`).join(', '));
}
const fetchImpl = await resolveRuntimeFetch();
const providers = createProviderRouter({ fetch: fetchImpl, baseUrls: { ollama: ollamaUrl, lmstudio: lmstudioUrl } });
const backend = await createWorkerBackend(pipe, {
  bootstrap,
  providers,
  harnessKey
});

const { shutdown } = installShutdown({ close: () => backend.close() });

pipe.once('close', () => { void shutdown(); });
pipe.once('error', () => { void shutdown(1); });
globalThis.Pear?.teardown?.(() => backend.close());