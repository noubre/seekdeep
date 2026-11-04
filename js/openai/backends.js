/**
 * The HTTP backend for the OpenAI surface.
 *
 * `createP2PBackend` forwards each request over the DHT chat room to the host, which
 * answers from its own providers — locally when this node is the host, remotely when it
 * is a peer. It exposes the `{ listModels, complete }` shape consumed by
 * `http-server.js`.
 */

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

export { createP2PBackend };
