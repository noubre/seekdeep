/**
 * HTTP backends for the OpenAI surface.
 *
 * `createHostBackend` answers from the process-local provider router (used by
 * `server.js`). `createP2PBackend` forwards each request over the DHT chat room
 * to the host (used by `bridge.js`). Both expose the same
 * `{ listModels, complete }` shape consumed by `http-server.js`.
 */

function createHostBackend({ providers, model = null }) {
  let active = null;

  async function resolveActive() {
    if (active) return active;
    if (typeof providers.autoSelect === 'function') {
      try {
        active = await providers.autoSelect();
        return active;
      } catch { /* fall through to the first declared provider */ }
    }
    active = Array.isArray(providers.providers) && providers.providers.length ? providers.providers[0] : null;
    return active;
  }

  async function listModels() {
    const provider = await resolveActive();
    if (!provider || typeof providers.listModels !== 'function') return [];
    try {
      const list = await providers.listModels(provider);
      if (!Array.isArray(list)) return [];
      return list.map((entry) => {
        const mapped = { id: entry.id, name: entry.name };
        if (entry.created !== undefined) mapped.created = entry.created;
        return mapped;
      });
    } catch {
      return [];
    }
  }

  function complete(request, sink) {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const provider = await resolveActive();
      if (cancelled) return;
      if (!provider || typeof providers.chat !== 'function') {
        sink.error(new Error('No local LLM provider is available'));
        return;
      }
      const params = { messages: request.messages, tools: request.tools || [], signal: controller.signal };
      if (request.temperature !== undefined) params.temperature = request.temperature;
      if (request.maxTokens !== undefined) params.maxTokens = request.maxTokens;
      if (request.stop !== undefined) params.stop = request.stop;
      try {
        const result = await providers.chat(provider, model ?? request.model, params, (event) => {
          if (cancelled) return;
          if (event.type === 'text') sink.text(event.text);
          else if (event.type === 'tool_call') sink.toolCall({ index: event.index, id: event.id, name: event.name, argumentsDelta: event.argumentsDelta });
        });
        if (cancelled) return;
        sink.done({ finishReason: result?.finishReason, usage: result?.usage });
      } catch (error) {
        if (!cancelled) sink.error(error);
      }
    })();

    return () => {
      cancelled = true;
      try { controller.abort(); } catch { /* ignore */ }
    };
  }

  return Object.freeze({ listModels, complete });
}

function createP2PBackend({ service, model = null, modelTimeoutMs = 10000 }) {
  let models = [];
  const modelWaiters = new Set();
  const pending = new Map();

  service.onEvent((event) => {
    if (event.type === 'models') {
      models = Array.isArray(event.models)
        ? event.models.map((entry) => ({ id: entry.id, name: entry.name, created: entry.created }))
        : [];
      for (const waiter of [...modelWaiters]) waiter();
      return;
    }
    if (event.type !== 'chat_response') return;
    const sink = pending.get(event.requestId);
    if (!sink) return;
    if (event.kind === 'text') {
      sink.text(event.text);
    } else if (event.kind === 'tool_call') {
      sink.toolCall({ index: event.index, id: event.id, name: event.name, argumentsDelta: event.argumentsDelta });
    } else if (event.kind === 'done') {
      pending.delete(event.requestId);
      const usage = {};
      if (event.promptTokens !== undefined) usage.promptTokens = event.promptTokens;
      if (event.completionTokens !== undefined) usage.completionTokens = event.completionTokens;
      sink.done({ finishReason: event.finishReason, usage });
    } else if (event.kind === 'error') {
      pending.delete(event.requestId);
      sink.error(new Error(event.error));
    }
  });

  async function listModels() {
    if (models.length) return models;
    try { await service.methods['chat.refreshModels'](); } catch { /* host may be absent */ }
    if (models.length) return models;
    await new Promise((resolve) => {
      const entry = () => {
        clearTimeout(timer);
        modelWaiters.delete(entry);
        resolve();
      };
      const timer = setTimeout(entry, modelTimeoutMs);
      modelWaiters.add(entry);
    });
    return models;
  }

  function complete(request, sink) {
    let requestId;
    try {
      requestId = service.methods['chat.request']({
        model: model ?? request.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stop: request.stop
      }).requestId;
    } catch (error) {
      sink.error(error);
      return () => {};
    }
    pending.set(requestId, sink);
    // Cancellation only stops the local sink from receiving frames; the host
    // finishes generating and discards the result (no cancel frame on the wire).
    return () => { pending.delete(requestId); };
  }

  return Object.freeze({ listModels, complete });
}

export { createHostBackend, createP2PBackend };