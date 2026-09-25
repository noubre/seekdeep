/**
 * Ollama provider factory.
 *
 * Pure: no DOM, no chat history, no UI imports. The worker owns the HTTP call
 * and streams decoded text chunks back through `onChunk`.
 */

const DEFAULT_BASE_URL = 'http://localhost:11434';

function resolveFetch(fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch;
  if (typeof resolved !== 'function') throw new TypeError('Ollama provider requires a fetch implementation');
  return resolved;
}

function resolveBaseUrl(baseUrl) {
  const url = new URL(baseUrl || DEFAULT_BASE_URL);
  return url;
}

function normalizeModels(data) {
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((model) => {
      const id = model?.name || model?.id;
      if (typeof id !== 'string' || !id) return null;
      const entry = { id, name: id };
      if (typeof model?.modified_at === 'string') entry.modified_at = model.modified_at;
      return entry;
    })
    .filter(Boolean);
}

function createOllama(options = {}) {
  const fetchImpl = resolveFetch(options.fetch);
  const baseUrl = resolveBaseUrl(options.baseUrl);

  async function listModels({ signal } = {}) {
    const response = await fetchImpl(new URL('/api/tags', baseUrl), { method: 'GET', signal });
    if (!response.ok) throw new Error(`Ollama listModels failed: HTTP ${response.status}`);
    const data = await response.json();
    return normalizeModels(data);
  }

  async function ask(model, prompt, askOptions = {}) {
    if (typeof model !== 'string' || !model) throw new TypeError('Ollama ask requires a model');
    if (typeof prompt !== 'string') throw new TypeError('Ollama ask requires a prompt');
    const onChunk = askOptions.onChunk;
    if (onChunk !== undefined && typeof onChunk !== 'function') throw new TypeError('onChunk must be a function');

    const response = await fetchImpl(new URL('/api/generate', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
      signal: askOptions.signal
    });
    if (!response.ok) throw new Error(`Ollama ask failed: HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json;
      try { json = JSON.parse(trimmed); } catch { return; }
      const chunk = typeof json.response === 'string' ? json.response : '';
      if (!chunk) return;
      text += chunk;
      if (onChunk) onChunk(chunk);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    consumeLine(buffer);
    return text;
  }

  return Object.freeze({ listModels, ask, baseUrl: baseUrl.origin, provider: 'ollama' });
}

export { DEFAULT_BASE_URL, createOllama, normalizeModels };