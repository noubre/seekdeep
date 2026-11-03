/**
 * SeekDeep headless host.
 *
 * Runs the same chat service + provider router as the desktop worker, with no
 * renderer: it creates a room on boot and serves peer queries through the local
 * LLM provider. It shares the chat service and provider router with
 * `worker-runtime.js`, but does not run the worker runtime itself.
 *
 * Usage: node server.js [--local-dht=<port>] [--ollama-url=…] [--lmstudio-url=…]
 *                    [--http-port=8080] [--http-host=127.0.0.1] [--api-key=<key>] [--model=<model>]
 */
import { createChatService } from './js/p2p/chat-service.js';
import { createProviderRouter } from './js/llm/provider.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';
import { createHttpServer } from './js/openai/http-server.js';
import { createHostBackend } from './js/openai/backends.js';
import { parseHttpArgs } from './js/openai/args.js';
import { resolveLaunchArgs, resolveRuntimeFetch, installShutdown } from './js/runtime/boot.js';

const args = resolveLaunchArgs();
const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(args);
const httpArgs = parseHttpArgs(args);

// `--llm-url` is a convenience alias for the Ollama-compatible provider base URL.
const llmUrlArg = args.find((arg) => typeof arg === 'string' && arg.startsWith('--llm-url='));
let effectiveOllamaUrl = ollamaUrl;
if (llmUrlArg) {
  try { effectiveOllamaUrl = new URL(llmUrlArg.slice('--llm-url='.length)).origin; } catch { /* keep default */ }
}

const fetchImpl = await resolveRuntimeFetch();
const providers = createProviderRouter({ fetch: fetchImpl, baseUrls: { ollama: effectiveOllamaUrl, lmstudio: lmstudioUrl } });
const chat = createChatService({ providers, bootstrap });

let httpServer = null;
const { shutdown } = installShutdown({
  close: async () => {
    try { if (httpServer) await httpServer.close(); } catch { /* ignore */ }
    try { await chat.close(); } catch { /* ignore */ }
  }
});

try {
  const { topic } = await chat.methods['chat.create']({});
  console.log('SeekDeep headless host');
  console.log(`Topic: ${topic}`);
  console.log(`Public key: ${chat.publicKey}`);
  if (httpArgs.http) {
    httpServer = await createHttpServer({
      backend: createHostBackend({ providers, model: httpArgs.model }),
      host: httpArgs.httpHost,
      port: httpArgs.httpPort,
      apiKey: httpArgs.apiKey
    });
    console.log(`OpenAI base URL: ${httpServer.url}/v1`);
    console.log(`HTTP bind: ${httpArgs.httpHost}:${httpServer.port} (auth ${httpArgs.apiKey ? 'on' : 'off'})`);
  }
  console.log('Waiting for peers. Press Ctrl+C to exit.');
} catch (error) {
  console.error(`Failed to start host: ${error?.message || error}`);
  await shutdown(1);
}