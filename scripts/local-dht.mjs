#!/usr/bin/env node
/**
 * Local DHT bootstrap for same-machine peer testing.
 *
 * Runs a single isolated hyperdht node (no public bootstrap) on loopback so two
 * SeekDeep instances launched with `--local-dht=<port>` can discover each other
 * over 127.0.0.1 instead of relying on public-DHT NAT hairpinning.
 *
 * Usage:
 *   node scripts/local-dht.mjs [port]     (default 40001)
 *
 * Prints `READY 127.0.0.1:<port>` once listening, then stays alive until killed.
 */
import DHT from 'hyperdht';

const port = Number(process.argv[2] || 40001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port must be an integer between 1 and 65535');
  process.exit(1);
}

const node = DHT.bootstrapper(port, '127.0.0.1');
await node.ready();

// Debug hook: log incoming discovery traffic so you can see two instances find
// each other through this node. Command numbers match hyperdht's COMMANDS table
// (see node_modules/hyperdht/lib/constants.js).
const COMMAND_NAMES = { 0: 'peer_handshake', 1: 'peer_holepunch', 2: 'find_peer', 3: 'lookup', 4: 'announce', 5: 'unannounce', 6: 'mutable_put', 7: 'mutable_get', 8: 'immutable_put', 9: 'immutable_get', 10: 'plugin' };
const originalOnRequest = node.onrequest.bind(node);
node.onrequest = (req) => {
  const name = COMMAND_NAMES[req.command] || `cmd_${req.command}`;
  if (req.command !== 1 && req.command !== 2) {
    console.log(`[dht] ${name} from ${req.from?.host}:${req.from?.port}`);
  }
  return originalOnRequest(req);
};

console.log(`READY 127.0.0.1:${port}`);
console.log(`Launch instances with: pear run . --local-dht=${port}`);

const shutdown = async () => {
  try {
    for (const server of node.listening) await server.close();
    await node.destroy();
  } catch {}
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
