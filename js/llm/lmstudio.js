/**
 * LM Studio provider factory.
 *
 * Pure: no DOM, no chat history, no UI imports. Streams SSE `data:` lines and
 * wraps `reasoning_content` deltas as ` thinking…</think>` for the renderer.
 */
import { toUnixSeconds } from './model-entry.js';
import { resolveFetch, resolveBaseUrl, readDecodedLines, createToolCallAccumulator, finalizeStream } from './stream.js';

const DEFAULT_BASE_URL = 'http://localhost:1234';

function normalizeModels(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((model) => {
      const id = model?.id;
      if (typeof id !== 'string' || !id) return null;
      const entry = { id, name: id };
      const created = toUnixSeconds(model?.created);
      if (created !== undefined) entry.created = created;
      return entry;
    })
    .filter(Boolean);
}

function toOpenAIMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson }
        }))
      };
    }
    return { role: message.role, content: message.content };
  });
}

function createLMStudio(options = {}) {
  const fetchImpl = resolveFetch('LM Studio', options.fetch);
  const baseUrl = resolveBaseUrl(options.baseUrl, DEFAULT_BASE_URL);

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

    let text = '';
    let thinkOpen = false;
    let thinkClosed = false;

    const thinkOpenTag = '<' + 'think>';
    const thinkCloseTag = '<' + '/think>';

    const emit = (chunk) => {
      text += chunk;
      if (onChunk) onChunk(chunk);
    };

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
        if (!thinkOpen) {
          thinkOpen = true;
          emit(thinkOpenTag);
        }
        emit(reasoningChunk);
      }
      const content = typeof delta.content === 'string' ? delta.content : '';
      if (content) {
        if (thinkOpen && !thinkClosed) {
          thinkClosed = true;
          emit(thinkCloseTag);
        }
        emit(content);
      }
    };

    await readDecodedLines(response, consumeLine, 'LM Studio ask');
    if (thinkOpen && !thinkClosed) emit(thinkCloseTag);
    return text;
  }

  async function chat(model, params = {}, onEvent) {
    if (typeof model !== 'string' || !model) throw new TypeError('LM Studio chat requires a model');
    if (!Array.isArray(params.messages)) throw new TypeError('LM Studio chat requires messages');
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');

    const body = { model, messages: toOpenAIMessages(params.messages), stream: true };
    const tools = Array.isArray(params.tools) ? params.tools : [];
    if (tools.length) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.parametersJson) }
      }));
    }
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.stop !== undefined) body.stop = params.stop;

    const request = (pathname) => fetchImpl(new URL(pathname, baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal
    });

    // LM Studio's OpenAI-compatible surface is `/v1/chat/completions`; older
    // builds only answer `/api/v0/chat/completions` with the same SSE shape.
    let response = await request('/v1/chat/completions');
    if (response.status === 404) response = await request('/api/v0/chat/completions');
    if (!response.ok) throw new Error(`LM Studio chat failed: HTTP ${response.status}`);

    let text = '';
    let reasoning = '';
    let finishReason;
    let promptTokens;
    let completionTokens;
    const accumulator = createToolCallAccumulator();

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') return;
      let json;
      try { json = JSON.parse(payload); } catch { return; }
      const choice = json?.choices?.[0];
      const delta = choice?.delta;
      if (delta) {
        const content = typeof delta.content === 'string' ? delta.content : '';
        if (content) {
          text += content;
          if (onEvent) onEvent({ type: 'text', text: content });
        }
        const reasoningChunk = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
        if (reasoningChunk) {
          reasoning += reasoningChunk;
          if (onEvent) onEvent({ type: 'reasoning', text: reasoningChunk });
        }
        if (Array.isArray(delta.tool_calls)) {
          delta.tool_calls.forEach((entry, arrayIndex) => {
            const index = Number.isInteger(entry?.index) ? entry.index : arrayIndex;
            const argumentsDelta = typeof entry?.function?.arguments === 'string' ? entry.function.arguments : '';
            const call = accumulator.upsert({ index, id: entry?.id, name: entry?.function?.name, argumentsDelta });
            if (onEvent) onEvent({ type: 'tool_call', index, id: call.id, name: entry?.function?.name, argumentsDelta });
          });
        }
      }
      if (choice && choice.finish_reason) finishReason = choice.finish_reason;
      if (json.usage) {
        if (typeof json.usage.prompt_tokens === 'number') promptTokens = json.usage.prompt_tokens;
        if (typeof json.usage.completion_tokens === 'number') completionTokens = json.usage.completion_tokens;
      }
    };

    await readDecodedLines(response, consumeLine, 'LM Studio chat');
    return finalizeStream({ text, reasoning, accumulator, finishReason, promptTokens, completionTokens });
  }

  return Object.freeze({ listModels, ask, chat, baseUrl: baseUrl.origin, provider: 'lmstudio' });
}

export { createLMStudio };
