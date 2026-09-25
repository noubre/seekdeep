/**
 * Parse local peer-discovery arguments passed to the app via
 * `pear run . --local-dht=<port>` (or `--bootstrap=host:port`).
 *
 * These are read from `globalThis.Pear.config.args` in the renderer. They are
 * only used for development/iteration: pointing the chat Hyperswarm at a
 * loopback DHT bootstrap lets two instances on one machine discover each other
 * without relying on the public DHT's NAT hairpinning.
 */

const DEFAULT_LOCAL_DHT_PORT = 40001;

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function addBootstrap(list, host, port) {
  const entry = { host, port };
  if (list.some((existing) => existing.host === host && existing.port === port)) return;
  list.push(entry);
}

/**
 * @param {unknown} args - Usually `Pear.config.args` (an array of strings).
 * @returns {Array<{ host: string, port: number }>} Normalized bootstrap nodes.
 */
function parseBootstrapArgs(args) {
  const bootstrap = [];
  if (!Array.isArray(args)) return bootstrap;

  for (const arg of args) {
    if (typeof arg !== 'string') continue;

    if (arg === '--local-dht') {
      addBootstrap(bootstrap, '127.0.0.1', DEFAULT_LOCAL_DHT_PORT);
      continue;
    }

    if (arg.startsWith('--local-dht=')) {
      const port = Number(arg.slice('--local-dht='.length));
      if (isPort(port)) addBootstrap(bootstrap, '127.0.0.1', port);
      continue;
    }

    if (arg.startsWith('--bootstrap=')) {
      const value = arg.slice('--bootstrap='.length);
      for (const entry of value.split(',')) {
        const separator = entry.lastIndexOf(':');
        if (separator <= 0) continue;
        const host = entry.slice(0, separator);
        const port = Number(entry.slice(separator + 1));
        if (host && isPort(port)) addBootstrap(bootstrap, host, port);
      }
    }
  }

  return bootstrap;
}

export { DEFAULT_LOCAL_DHT_PORT, parseBootstrapArgs };
