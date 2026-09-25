import net from 'node:net';
import DHT from 'hyperdht';

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Start an isolated loopback DHT bootstrapper on an ephemeral port so two
 * in-process Hyperswarm nodes can discover each other without the public DHT.
 * @returns {Promise<{ bootstrap: Array<{host: string, port: number}>, port: number, node: object, stop: () => Promise<void> }>}
 */
export async function startLocalDht() {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await pickFreePort();
    const node = DHT.bootstrapper(port, '127.0.0.1');
    try {
      await node.ready();
    } catch (error) {
      lastError = error;
      try { await node.destroy(); } catch { /* ignore */ }
      continue;
    }
    return {
      node,
      port,
      bootstrap: [{ host: '127.0.0.1', port }],
      async stop() {
        try { await node.destroy(); } catch { /* ignore */ }
      }
    };
  }
  throw lastError || new Error('could not start a local DHT bootstrapper');
}