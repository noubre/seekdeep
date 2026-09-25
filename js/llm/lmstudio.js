/**
 * LM Studio provider factory.
 *
 * Pure: no DOM, no chat history, no UI imports. Streams SSE `data:` lines and
 * wraps `reasoning_content` deltas as ` thinking…</think>` for the renderer.
 */

const DEFAULT_BASE_URL = 'http://localhost:1234';

function resolveFetch(fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch;
  if (typeof resolved !== 'function') throw new TypeError('LM Studio provider requires a fetch implementation');
  return resolved;
}

function normalizeModels(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((model) => {
      const id = model?.id;
      if (typeof id !== 'string' || !id) return null;
      const entry = { id, name: id };
      if (typeof model?.created === 'string') entry.modified_at = model.created;
      return entry;
    })
    .filter(Boolean);
}

function createLMStudio(options = {}) {
  const fetchImpl = resolveFetch(options.fetch);
  const baseUrl = new URL(options.baseUrl || DEFAULT_BASE_URL);

  async function listModels({ signal } = {}) {
    const response = await fetchImpl(new URL('/api/v0/models', baseUrl), { method: 'GET', signal });
    if (!response.ok) throw new Error(`LM Studio listModels failed: HTTP ${response.status}`);
    const data = await response.json();
    return normalizeModels(data);
  }

  async function ask(model, prompt, askOptions = {}) {
    if (typeof model !== 'string' || !model) throw new TypeError('LM Studio ask requires a model');
    if (typeof prompt !== 'string') throw new TypeError('LM Studio ask requires a prompt');
    const onChunk = askOptions.onChunk;
    if (onChunk !== undefined && typeof onChunk !== 'function') throw new TypeError('onChunk must be a function');

    const response = await fetchImpl(new URL('/api/v0/chat/completions', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0.7,
        max_tokens: -1
      }),
      signal: askOptions.signal
    });
    if (!response.ok) throw new Error(`LM Studio ask failed: HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') return;
      let json;
      try { json = JSON.parse(payload); } catch { return; }
      const delta = json?.choices?.[0]?.delta;
      if (!delta) return;
      const reasoningChunk = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
      if (reasoningChunk) {
        reasoning += reasoningChunk;
        const wrapped = ` thinking${reasoning}</think>`;
        text = `${text.replace(/ thinking[\s\S]*?<\/think>/g, '')}${wrapped}`;
        if (onChunk) onChunk(wrapped);
      }
      const content = typeof delta.content === 'string' ? delta.content : '';
      if (content) {
        text += content;
        if (onChunk) onChunk(content);
      }
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
    if (buffer) consumeLine(buffer);
    return text;
  }

  return Object.freeze({ listModels, ask, baseUrl: baseUrl.origin, provider: 'lmstudio' });
}

export { DEFAULT_BASE_URL, createLMStudio, normalizeModels };