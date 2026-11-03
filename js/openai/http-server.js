/**
 * Loopback HTTP surface for OpenAI/Anthropic-compatible clients.
 *
 * Serves Chat Completions, the legacy Completions API, Anthropic Messages
 * (incl. `count_tokens`) and OpenAI Responses on both `http://host:port/...`
 * and `http://host:port/v1/...` base URLs, backed by a `{ listModels, complete }`
 * backend (host-local provider router, or the DHT bridge).
 *
 * Prompts are never logged; only `method path status`.
 */
import http from 'node:http';
import { createToolRegistry } from './tool-registry.js';
import { parseChatCompletionsRequest, createChatCompletionsWriter, parseCompletionsRequest, createCompletionsWriter } from './codec-openai.js';
import { parseMessagesRequest, createMessagesWriter, countInputTokens } from './codec-anthropic.js';
import { parseResponsesRequest, createResponsesWriter } from './codec-responses.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const KNOWN_PATHS = new Set(['/chat/completions', '/completions', '/messages', '/messages/count_tokens', '/responses', '/models']);

function errorPayload(message, code = 'invalid_request_error') {
  return { error: { message, type: 'invalid_request_error', code } };
}

function createHttpServer({ backend, host = '127.0.0.1', port = 8080, apiKey = null, log = console.log } = {}) {
  if (!backend || typeof backend.complete !== 'function' || typeof backend.listModels !== 'function') {
    throw new TypeError('createHttpServer requires a backend with complete() and listModels()');
  }
  const toolNames = createToolRegistry();

  function sendJson(res, status, payload, extraHeaders = {}) {
    if (res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extraHeaders });
    res.end(JSON.stringify(payload));
  }

  function authorized(req) {
    if (!apiKey) return true;
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice('Bearer '.length) === apiKey) return true;
    return req.headers?.['x-api-key'] === apiKey;
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy();
          finish({ error: 'request body too large', status: 413 });
          return;
        }
        chunks.push(chunk);
      });
      req.on('error', () => finish({ error: 'request error', status: 400 }));
      req.on('end', () => {
        if (settled) return;
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          finish({ body: JSON.parse(text) });
        } catch {
          finish({ error: 'Request body is not valid JSON', status: 400 });
        }
      });
    });
  }

  function runCompletion({ req, res, kind }) {
    return (async () => {
      const parsed = await readJson(req);
      if (parsed.error) {
        log(`${req.method} ${req.pathname} ${parsed.status}`);
        sendJson(res, parsed.status, errorPayload(parsed.error));
        return;
      }
      let request;
      let writer;
      try {
        if (kind === 'chat') {
          request = parseChatCompletionsRequest(parsed.body, toolNames);
          writer = createChatCompletionsWriter({ res, model: request.model, stream: request.stream, toolNames });
        } else if (kind === 'completions') {
          request = parseCompletionsRequest(parsed.body);
          writer = createCompletionsWriter({ res, model: request.model, stream: request.stream });
        } else if (kind === 'messages') {
          request = parseMessagesRequest(parsed.body, toolNames);
          writer = createMessagesWriter({ res, model: request.model, stream: request.stream, toolNames });
        } else {
          request = parseResponsesRequest(parsed.body, toolNames);
          writer = createResponsesWriter({ res, model: request.model, stream: request.stream, toolNames });
        }
      } catch (error) {
        log(`${req.method} ${req.pathname} 400`);
        sendJson(res, 400, errorPayload(error?.message || 'Invalid request'));
        return;
      }

      log(`${req.method} ${req.pathname} 200`);
      let cancel = () => {};
      const sink = {
        text: (chunk) => writer.text(chunk),
        toolCall: (call) => writer.toolCall(call),
        done: (result) => writer.finish(result),
        error: (error) => writer.error(error)
      };
      try {
        cancel = backend.complete(request, sink) || (() => {});
      } catch (error) {
        writer.error(error);
      }
      res.on('close', () => {
        if (res.writableEnded) return;
        writer.abort();
        cancel();
      });
    })();
  }

  function handleModels(req, res) {
    return (async () => {
      let list = [];
      try {
        list = await backend.listModels();
      } catch (error) {
        log(`warning: failed to list models: ${error?.message || error}`);
      }
      const created = Math.floor(Date.now() / 1000);
      const data = (Array.isArray(list) ? list : []).map((entry) => ({
        id: entry.id,
        object: 'model',
        created: entry.created ?? created,
        owned_by: 'seekdeep'
      }));
      log(`${req.method} ${req.pathname} 200`);
      sendJson(res, 200, { object: 'list', data });
    })();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/^\/v1(?=\/|$)/, '') || '/';
    req.pathname = pathname;

    if (req.method === 'OPTIONS' && KNOWN_PATHS.has(pathname)) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      });
      res.end();
      return;
    }

    const known = KNOWN_PATHS.has(pathname);
    if (!known) {
      log(`${req.method} ${pathname} 404`);
      sendJson(res, 404, errorPayload('Not found', 'not_found'));
      return;
    }
    if (!authorized(req)) {
      log(`${req.method} ${pathname} 401`);
      sendJson(res, 401, { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } });
      return;
    }

    if (req.method === 'GET' && pathname === '/models') { void handleModels(req, res); return; }
    if (req.method === 'POST' && pathname === '/chat/completions') { void runCompletion({ req, res, kind: 'chat' }); return; }
    if (req.method === 'POST' && pathname === '/completions') { void runCompletion({ req, res, kind: 'completions' }); return; }
    if (req.method === 'POST' && pathname === '/messages') { void runCompletion({ req, res, kind: 'messages' }); return; }
    if (req.method === 'POST' && pathname === '/responses') { void runCompletion({ req, res, kind: 'responses' }); return; }
    if (req.method === 'POST' && pathname === '/messages/count_tokens') { void handleCountTokens(req, res); return; }

    log(`${req.method} ${pathname} 405`);
    sendJson(res, 405, errorPayload('Method not allowed', 'method_not_allowed'));
  });

  async function handleCountTokens(req, res) {
    const parsed = await readJson(req);
    if (parsed.error) {
      log(`${req.method} ${req.pathname} ${parsed.status}`);
      sendJson(res, parsed.status, errorPayload(parsed.error));
      return;
    }
    try {
      const result = countInputTokens(parsed.body, toolNames);
      log(`${req.method} ${req.pathname} 200`);
      sendJson(res, 200, result);
    } catch (error) {
      log(`${req.method} ${req.pathname} 400`);
      sendJson(res, 400, errorPayload(error?.message || 'Invalid request'));
    }
  }

  server.requestTimeout = 0;
  server.headersTimeout = 60000;

  return (async () => {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${resolvedPort}`;
    return {
      url,
      port: resolvedPort,
      close() {
        return new Promise((resolve) => server.close(() => resolve()));
      }
    };
  })();
}

export { createHttpServer };