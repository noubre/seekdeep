/**
 * Ollama provider factory.
 *
 * Pure: no DOM, no chat history, no UI imports. The worker owns the HTTP call
 * and streams decoded text chunks back through `onChunk`.
 */
import { toUnixSeconds } from './model-entry.js';
import { resolveFetch, resolveBaseUrl, readDecodedLines, createToolCallAccumulator, finalizeStream } from './stream.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

function normalizeModels(data) {
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((model) => {
      const id = model?.name || model?.id;
      if (typeof id !== 'string' || !id) return null;
      const entry = { id, name: id };
      const created = toUnixSeconds(model?.modified_at);
      if (created !== undefined) entry.created = created;
      return entry;
    })
    .filter(Boolean);
}

// Ollama keys tool results by name (not id), and takes assistant tool-call
// arguments as an object rather than a JSON string.
function toOllamaMessages(messages) {
  const result = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      result.push({ role: 'tool', tool_name: message.name || message.toolCallId, content: message.content });
      continue;
    }
    const entry = { role: message.role, content: message.content };
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const calls = [];
      for (const call of message.toolCalls) {
        let args;
        try { args = JSON.parse(call.argumentsJson); } catch { continue; }
        calls.push({ type: 'function', function: { name: call.name, arguments: args } });
      }
      if (calls.length) entry.tool_calls = calls;
    }
    result.push(entry);
  }
  return result;
}

function createOllama(options = {}) {
  const fetchImpl = resolveFetch('Ollama', options.fetch);
  const baseUrl = resolveBaseUrl(options.baseUrl, DEFAULT_BASE_URL);

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
    await readDecodedLines(response, consumeLine, 'Ollama ask');
    return text;
  }

  async function chat(model, params = {}, onEvent) {
    if (typeof model !== 'string' || !model) throw new TypeError('Ollama chat requires a model');
    if (!Array.isArray(params.messages)) throw new TypeError('Ollama chat requires messages');
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');

    const body = { model, messages: toOllamaMessages(params.messages), stream: true };
    const options = {};
    if (params.temperature !== undefined) options.temperature = params.temperature;
    if (params.maxTokens !== undefined) options.num_predict = params.maxTokens;
    if (params.stop !== undefined) options.stop = params.stop;
    if (Object.keys(options).length) body.options = options;
    const tools = Array.isArray(params.tools) ? params.tools : [];
    if (tools.length) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.parametersJson) }
      }));
    }

    const response = await fetchImpl(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!response.ok) throw new Error(`Ollama chat failed: HTTP ${response.status}`);

    let text = '';
    let reasoning = '';
    let finishReason;
    let promptTokens;
    let completionTokens;
    const accumulator = createToolCallAccumulator();

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json;
      try { json = JSON.parse(trimmed); } catch { return; }
      const message = json.message;
      if (message) {
        if (typeof message.content === 'string' && message.content) {
          text += message.content;
          if (onEvent) onEvent({ type: 'text', text: message.content });
        }
        if (typeof message.thinking === 'string' && message.thinking) {
          reasoning += message.thinking;
          if (onEvent) onEvent({ type: 'reasoning', text: message.thinking });
        }
        if (Array.isArray(message.tool_calls)) {
          message.tool_calls.forEach((entry, arrayIndex) => {
            const index = Number.isInteger(entry?.function?.index) ? entry.function.index : arrayIndex;
            const argumentsDelta = JSON.stringify(entry?.function?.arguments ?? {});
            const call = accumulator.upsert({ index, id: undefined, name: entry?.function?.name, argumentsDelta });
            if (onEvent) onEvent({ type: 'tool_call', index, id: call.id, name: entry?.function?.name, argumentsDelta });
          });
        }
      }
      if (typeof json.prompt_eval_count === 'number') promptTokens = json.prompt_eval_count;
      if (typeof json.eval_count === 'number') completionTokens = json.eval_count;
      if (json.done === true && json.done_reason !== undefined) finishReason = json.done_reason;
    };

    await readDecodedLines(response, consumeLine, 'Ollama chat');
    return finalizeStream({ text, reasoning, accumulator, finishReason, promptTokens, completionTokens });
  }

  return Object.freeze({ listModels, ask, chat, baseUrl: baseUrl.origin, provider: 'ollama' });
}

export { createOllama };
