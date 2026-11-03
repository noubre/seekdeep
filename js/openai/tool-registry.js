/**
 * Tool-call id → name registry.
 *
 * OpenAI/Anthropic clients echo tool-call ids back on the *next* HTTP request,
 * but Ollama keys tool results by name; and some providers (Ollama) hand back
 * tool calls without any id at all, so the id we synthesized for the client is
 * the only handle that survives the round trip. Insertion-ordered with FIFO
 * eviction so a long-lived bridge process cannot grow unbounded.
 */

function createToolRegistry({ max = 4096 } = {}) {
  const map = new Map();

  function record(id, name) {
    if (typeof id !== 'string' || !id) return;
    if (typeof name !== 'string' || !name) return;
    if (map.has(id)) map.delete(id);
    map.set(id, name);
    while (map.size > max) map.delete(map.keys().next().value);
  }

  return {
    record,
    nameFor(id) { return typeof id === 'string' ? map.get(id) : undefined; }
  };
}

export { createToolRegistry };