/**
 * SeekDeep headless host.
 *
 * Runs the same chat service + provider router as the desktop worker, with no
 * renderer: it creates a room on boot and serves peer queries through the local
 * LLM provider. Shares one implementation with `index.js` / `worker-runtime.js`.
 *
 * Usage: node server.js [--local-dht=<port>] [--ollama-url=…] [--lmstudio-url=…]
 */
import { createChatService } from './js/p2p/chat-service.js';
import { createProviderRouter } from './js/llm/provider.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';

function resolveArgs() {
  const config = globalThis.Pear?.config;
  if (Array.isArray(config?.args) && config.args.length) return config.args;
  if (globalThis.Pear && Array.isArray(globalThis.Pear?.args)) return globalThis.Pear.args;
  return process.argv.slice(2);
}

async function resolveFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  const module = await import('bare-fetch');
  const resolved = module.default || module;
  if (typeof resolved !== 'function') throw new Error('bare-fetch did not provide a fetch implementation');
  return resolved;
}

const args = resolveArgs();
const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(args);

// `--llm-url` is a convenience alias for the Ollama-compatible provider base URL.
const llmUrlArg = args.find((arg) => typeof arg === 'string' && arg.startsWith('--llm-url='));
let effectiveOllamaUrl = ollamaUrl;
if (llmUrlArg) {
  try { effectiveOllamaUrl = new URL(llmUrlArg.slice('--llm-url='.length)).origin; } catch { /* keep default */ }
}

const fetchImpl = await resolveFetch();
const providers = createProviderRouter({ fetch: fetchImpl, baseUrls: { ollama: effectiveOllamaUrl, lmstudio: lmstudioUrl } });
const chat = createChatService({ providers, bootstrap });

let shutdownPromise = null;
async function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    try { await chat.close(); } catch { /* ignore */ }
    process.exit(code);
  })();
  return shutdownPromise;
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });

try {
  const { topic } = await chat.methods['chat.create']({});
  console.log('SeekDeep headless host');
  console.log(`Topic: ${topic}`);
  console.log(`Public key: ${chat.publicKey}`);
  console.log('Waiting for peers. Press Ctrl+C to exit.');
} catch (error) {
  console.error(`Failed to start host: ${error?.message || error}`);
  await shutdown(1);
}