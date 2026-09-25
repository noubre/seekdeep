/**
 * Parse local peer-discovery and provider arguments passed to the app, e.g.
 * `pear run . --local-dht=<port>` (or `--bootstrap=host:port`).
 *
 * Read once in the Bare worker (`Pear.config.args`, falling back to `Bare.argv`)
 * and in the headless server (`process.argv`); the renderer never parses args.
 *
 * `--local-dht`/`--bootstrap` point Hyperswarm at a loopback DHT so two
 * instances on one machine discover each other. `--ollama-url`/`--lmstudio-url`
 * override the provider base URLs (defaults: localhost:11434 / localhost:1234).
 */

const DEFAULT_LOCAL_DHT_PORT = 40001;
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function addBootstrap(list, host, port) {
  const entry = { host, port };
  if (list.some((existing) => existing.host === host && existing.port === port)) return;
  list.push(entry);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} args - Usually `Pear.config.args` / `process.argv` (array of strings).
 * @returns {{ bootstrap: Array<{host: string, port: number}>, ollamaUrl: string, lmstudioUrl: string }}
 */
function parseBootstrapArgs(args) {
  const bootstrap = [];
  let ollamaUrl = DEFAULT_OLLAMA_URL;
  let lmstudioUrl = DEFAULT_LMSTUDIO_URL;
  if (!Array.isArray(args)) return { bootstrap, ollamaUrl, lmstudioUrl };

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
      continue;
    }

    if (arg.startsWith('--ollama-url=')) {
      const url = normalizeUrl(arg.slice('--ollama-url='.length));
      if (url) ollamaUrl = url;
      continue;
    }

    if (arg.startsWith('--lmstudio-url=')) {
      const url = normalizeUrl(arg.slice('--lmstudio-url='.length));
      if (url) lmstudioUrl = url;
    }
  }

  return { bootstrap, ollamaUrl, lmstudioUrl };
}

export { DEFAULT_LOCAL_DHT_PORT, DEFAULT_OLLAMA_URL, DEFAULT_LMSTUDIO_URL, parseBootstrapArgs };