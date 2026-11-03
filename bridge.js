#!/usr/bin/env node
/**
 * SeekDeep OpenAI bridge.
 *
 * Joins an existing SeekDeep room as a peer and serves an OpenAI/Anthropic
 * compatible endpoint on loopback. Each HTTP request is forwarded over the DHT
 * room to the host, which answers from its local LLM provider; the streamed
 * answer is relayed back, including tool calls. This lets several clients on
 * several machines share one machine's GPU inference.
 *
 * Usage:
 *   node bridge.js --topic=<64-hex topic from the host>
 *     [--http-port=8080] [--http-host=127.0.0.1] [--api-key=<key>]
 *     [--model=<model>] [--no-http] [--local-dht=<port>|--bootstrap=host:port]
 */
import { createChatService } from './js/p2p/chat-service.js';
import { createHttpServer } from './js/openai/http-server.js';
import { createP2PBackend } from './js/openai/backends.js';
import { parseBootstrapArgs } from './js/p2p/bootstrap-args.js';
import { parseHttpArgs } from './js/openai/args.js';
import { resolveLaunchArgs, createNoLocalProviders, installShutdown } from './js/runtime/boot.js';

const TOPIC_PATTERN = /^[0-9a-f]{64}$/i;
const USAGE = 'Usage: node bridge.js --topic=<64-hex topic from the host> [--http-port=8080] [--http-host=127.0.0.1] [--api-key=<key>] [--model=<model>] [--local-dht=<port>|--bootstrap=host:port]';

const args = resolveLaunchArgs();
const httpArgs = parseHttpArgs(args);
const { bootstrap } = parseBootstrapArgs(args);

if (!httpArgs.topic || !TOPIC_PATTERN.test(httpArgs.topic)) {
  console.error(USAGE);
  process.exit(1);
}

// A peer never answers from local providers; the host's router does the work.
const providers = createNoLocalProviders();

const service = createChatService({ providers, bootstrap });

let server = null;
const { shutdown } = installShutdown({
  close: async () => {
    try { if (server) await server.close(); } catch { /* ignore */ }
    try { await service.close(); } catch { /* ignore */ }
  }
});

try {
  const joined = await service.methods['chat.join']({ topic: httpArgs.topic });
  console.log('SeekDeep OpenAI bridge');
  console.log(`Joined topic: ${joined.topic}`);
  console.log('Note: the host must run SeekDeep with chat bridge support.');

  if (httpArgs.http) {
    server = await createHttpServer({
      backend: createP2PBackend({ service, model: httpArgs.model }),
      host: httpArgs.httpHost,
      port: httpArgs.httpPort,
      apiKey: httpArgs.apiKey
    });
    console.log(`OpenAI base URL: ${server.url}/v1`);
    console.log(`HTTP bind: ${httpArgs.httpHost}:${server.port} (auth ${httpArgs.apiKey ? 'on' : 'off'})`);
  }

  let peerCount = 0;
  service.onEvent((event) => {
    if (event.type !== 'peers') return;
    if (event.peers.length === peerCount) return;
    peerCount = event.peers.length;
    console.log(`Peers: ${peerCount}`);
  });
} catch (error) {
  console.error(`Failed to start bridge: ${error?.message || error}`);
  await shutdown(1);
}