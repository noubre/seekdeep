#!/usr/bin/env node
/**
 * SeekDeep OpenAI bridge.
 *
 * The proxy that lets an ordinary AI harness — Claude Code, Codex, Hermes, the OpenAI SDK —
 * use a SeekDeep room's inference without a plugin and without knowing anything about the
 * P2P network. It serves an OpenAI/Anthropic-compatible endpoint on loopback, resolves every
 * request into a room request over the DHT, and streams the host's answer back, including
 * tool calls. The harness only ever sees a base URL.
 *
 * Joins an existing room as a peer, so the machine with the models runs SeekDeep as the host
 * (the desktop app, or the headless host). One room, many harnesses, one GPU.
 *
 * Usage:
 *   node bridge.js --topic=<64-hex topic from the host>
 *     [--http-port=8080] [--http-host=127.0.0.1] [--api-key=<key>]
 *     [--model=<model>] [--no-http] [--local-dht=<port>|--bootstrap=host:port]
 */
import http from 'node:http';
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
  console.log('Forwarding over the room: the host answers with its own providers.');

  if (httpArgs.http) {
    server = await createHttpServer({
      backend: createP2PBackend({ service, model: httpArgs.model }),
      http,
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