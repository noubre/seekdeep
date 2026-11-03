#!/usr/bin/env node
/**
 * SeekDeep terminal UI.
 *
 * Runs the same worker backend as the desktop app and headless server, but
 * in-process over an in-memory duplex pipe, and renders the same JSON-RPC
 * surface as a line-oriented terminal client. The worker owns all P2P,
 * provider, and plugin work; this entrypoint only wires the pipes and the
 * process lifecycle.
 *
 * Usage: node tui.js [--storage=<abs path>] [--model=<name>]
 *                 [--provider=ollama|lmstudio] [--topic=<64hex>] [--no-color]
 *                 [--harness-key=<64hex>] [--local-dht[=<port>]] [--bootstrap=host:port]
 *                 [--ollama-url=…] [--lmstudio-url=…]
 */
import * as nodeFs from 'node:fs/promises';
import { createWorkerBackend } from './js/p2p/worker-runtime.js';
import { createRpcClient } from './js/p2p/rpc-client.js';
import { createProviderRouter } from './js/llm/provider.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';
import { parseHarnessKey } from './js/harness/args.js';
import { parseTuiArgs } from './js/tui/args.js';
import { createMemoryPipePair } from './js/tui/memory-pipe.js';
import { createTui } from './js/tui/app.js';
import { detectColorDepth } from './js/tui/theme.js';
import { resolveLaunchArgs, resolveRuntimeFetch, installShutdown } from './js/runtime/boot.js';

async function main() {
  const args = resolveLaunchArgs();
  const { storage, model, provider, topic, color } = parseTuiArgs(args);
  const depth = color ? detectColorDepth(process.env, Boolean(process.stdout.isTTY)) : 'none';
  const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(args);
  const { harnessKey } = parseHarnessKey(args);

  const fetchImpl = await resolveRuntimeFetch();
  const providers = createProviderRouter({
    fetch: fetchImpl,
    baseUrls: { ollama: ollamaUrl, lmstudio: lmstudioUrl }
  });

  const { server, client: clientPipe } = createMemoryPipePair();
  // `fs` injection makes the Localdrive service and harness run under Node.
  const backend = await createWorkerBackend(server, {
    config: { storage },
    providers,
    bootstrap,
    harnessKey,
    fs: nodeFs
  });
  const client = createRpcClient({ pipeFactory: () => clientPipe });

  const tui = createTui({
    client,
    input: process.stdin,
    output: process.stdout,
    args: { storage, model, provider, topic },
    depth
  });

  const run = tui.start();

  const { shutdown } = installShutdown({
    beforeExit: () => tui.stop(),
    close: async () => {
      await run;
      try { client.close(); } catch { /* ignore */ }
      try { await backend.close(); } catch { /* ignore */ }
    }
  });

  await run;
  await shutdown(0);
}

main().catch((error) => {
  console.error(`Failed to start TUI: ${error?.message || error}`);
  process.exit(1);
});
