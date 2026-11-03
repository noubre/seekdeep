/**
 * Parse the HTTP-surface arguments shared by `server.js` and `bridge.js`.
 *
 * Lenient like `parseBootstrapArgs`: an invalid value is ignored so a typo
 * never crashes startup; the effective configuration is printed at boot.
 */

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_HTTP_HOST = '127.0.0.1';

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function parseHttpArgs(args) {
  const config = { http: true, httpPort: DEFAULT_HTTP_PORT, httpHost: DEFAULT_HTTP_HOST, apiKey: null, model: null, topic: null };
  if (!Array.isArray(args)) return config;

  for (const arg of args) {
    if (typeof arg !== 'string') continue;

    if (arg === '--no-http') {
      config.http = false;
      continue;
    }
    if (arg.startsWith('--http-port=')) {
      const port = Number(arg.slice('--http-port='.length));
      if (isPort(port)) config.httpPort = port;
      continue;
    }
    if (arg.startsWith('--http-host=')) {
      const host = arg.slice('--http-host='.length);
      if (host) config.httpHost = host;
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      const key = arg.slice('--api-key='.length);
      if (key) config.apiKey = key;
      continue;
    }
    if (arg.startsWith('--model=')) {
      const model = arg.slice('--model='.length);
      if (model) config.model = model;
      continue;
    }
    if (arg.startsWith('--topic=')) {
      const topic = arg.slice('--topic='.length);
      if (topic) config.topic = topic;
    }
  }

  return config;
}

export { DEFAULT_HTTP_PORT, DEFAULT_HTTP_HOST, parseHttpArgs };