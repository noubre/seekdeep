import Runtime from 'pear-electron';
import Bridge from 'pear-bridge';
import {
  createWorkerBackend,
  resolveDriveStorageRoot,
  resolveLocaldriveStorageRoot
} from './js/p2p/worker-runtime.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';
import { createProviderRouter } from './js/llm/provider.js';

// Bare main process: read launch args from Pear config, falling back to Bare.argv
// (argv[0]/argv[1] are reserved; the first user arg is argv[2]).
function resolveArgs() {
  const config = globalThis.Pear?.config;
  if (Array.isArray(config?.args)) return config.args;
  if (globalThis.Bare && Array.isArray(globalThis.Bare.argv)) return globalThis.Bare.argv.slice(2);
  return [];
}

async function resolveFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  const module = await import('bare-fetch');
  const resolved = module.default || module;
  if (typeof resolved !== 'function') throw new Error('bare-fetch did not provide a fetch implementation');
  return resolved;
}

const bridge = new Bridge();
await bridge.ready();

const runtime = new Runtime();
const pipe = await runtime.start({ bridge });

const args = resolveArgs();
const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(args);
if (bootstrap.length) {
  console.log('[main] using local DHT bootstrap:', bootstrap.map((node) => `${node.host}:${node.port}`).join(', '));
}
const fetchImpl = await resolveFetch();
const providers = createProviderRouter({ fetch: fetchImpl, baseUrls: { ollama: ollamaUrl, lmstudio: lmstudioUrl } });
const backend = createWorkerBackend(pipe, {
  storageRoot: resolveDriveStorageRoot(),
  localdriveRoot: resolveLocaldriveStorageRoot(),
  bootstrap,
  providers
});

let shutdownPromise = null;
function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = backend.close().finally(() => {
    if (globalThis.Pear?.exit) globalThis.Pear.exit(code);
    else process.exit(code);
  });
  return shutdownPromise;
}

pipe.once('close', () => { void shutdown(); });
pipe.once('error', () => { void shutdown(1); });
globalThis.Pear?.teardown?.(() => backend.close());