/**
 * Owns the process's OpenAI-compatible surface: at most one HTTP server, always
 * forwarding each request over the room to whoever is the host and streaming the answer
 * back. On the host itself `chat.request` answers locally, so the endpoint serves this
 * machine's models there and a remote host's models everywhere else — one mode, one code
 * path. External harnesses (Claude Code, Codex, Hermes) point their base URL at it and
 * never need to speak the P2P protocol.
 */
import { createHttpServer } from './http-server.js';
import { createP2PBackend } from './backends.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

export function createApiService({ chatService, http } = {}) {
  if (!http) throw new TypeError('createApiService requires an http implementation');
  if (!chatService) throw new TypeError('createApiService requires a chat service');
  let running = null; // { model, host, port, apiKey, server, url }
  let closing = null;

  function describe(current) {
    return {
      running: true,
      model: current.model,
      host: current.host,
      port: current.port,
      url: `${current.url}/v1`,
      auth: Boolean(current.apiKey)
    };
  }

  async function start(params = {}) {
    await stop();
    const host = typeof params.host === 'string' && params.host ? params.host : DEFAULT_HOST;
    const port = Number.isInteger(params.port) ? params.port : DEFAULT_PORT;
    // Port 0 asks the OS for an ephemeral port; the resolved port is reported back.
    if (port < 0 || port > 65535) throw new TypeError('port must be between 0 and 65535');
    const model = typeof params.model === 'string' && params.model ? params.model : null;
    const apiKey = typeof params.apiKey === 'string' && params.apiKey ? params.apiKey : null;
    const backend = createP2PBackend({ service: chatService, model });
    // `createHttpServer` resolves once the socket is listening, so a request for
    // port 0 is reported back as the real port the OS handed out.
    const server = await createHttpServer({ backend, http, host, port, apiKey });
    running = { model, host, port: server.port, apiKey, server, url: server.url };
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
