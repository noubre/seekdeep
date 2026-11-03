/**
 * Owns the process's OpenAI-compatible surface: at most one server at a time, backed
 * either by this machine's providers (`server`) or by the room's host (`bridge`).
 *
 * The two modes differ only in the backend. Keeping them behind one object means the
 * RPC surface, the UI and the tests never have to know which node is doing the work.
 */
import { createHttpServer } from './http-server.js';
import { createHostBackend, createP2PBackend } from './backends.js';

const MODES = new Set(['server', 'bridge']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

export function createApiService({ providers, chatService, http } = {}) {
  if (!http) throw new TypeError('createApiService requires an http implementation');
  let running = null; // { mode, model, host, port, apiKey, server, url }
  let closing = null;

  function describe(current) {
    return {
      running: true,
      mode: current.mode,
      model: current.model,
      host: current.host,
      port: current.port,
      url: `${current.url}/v1`,
      auth: Boolean(current.apiKey)
    };
  }

  async function start(params = {}) {
    const mode = params.mode ?? 'server';
    if (!MODES.has(mode)) throw new TypeError("mode must be 'server' or 'bridge'");
    if (mode === 'bridge' && !chatService) throw new TypeError('bridge mode requires a chat service');
    if (mode === 'server' && !providers) throw new TypeError('server mode requires a provider router');
    await stop();
    const host = typeof params.host === 'string' && params.host ? params.host : DEFAULT_HOST;
    const port = Number.isInteger(params.port) ? params.port : DEFAULT_PORT;
    // Port 0 asks the OS for an ephemeral port; the resolved port is reported back.
    if (port < 0 || port > 65535) throw new TypeError('port must be between 0 and 65535');
    const model = typeof params.model === 'string' && params.model ? params.model : null;
    const apiKey = typeof params.apiKey === 'string' && params.apiKey ? params.apiKey : null;
    const backend = mode === 'server'
      ? createHostBackend({ providers, model })
      : createP2PBackend({ service: chatService, model });
    // `createHttpServer` resolves once the socket is listening, so a request for
    // port 0 is reported back as the real port the OS handed out.
    const server = await createHttpServer({ backend, http, host, port, apiKey });
    running = { mode, model, host, port: server.port, apiKey, server, url: server.url };
    return describe(running);
  }

  async function stop() {
    if (!running) return { running: false, stopped: false };
    const current = running;
    running = null;
    try { await current.server.close(); } catch { /* already gone */ }
    return { running: false, stopped: true };
  }

  function status() {
    return running ? describe(running) : { running: false };
  }

  function close() {
    if (!closing) closing = stop().then(() => {});
    return closing;
  }

  return Object.freeze({ start, stop, status, close });
}
