/**
 * OpenAI Chat Completions codec (+ the legacy `/v1/completions` surface).
 *
 * Parses requests into the normalized `ChatRequest` shape and writes replies as
 * either SSE (`stream: true`) or a single JSON body. Pure: the only I/O is the
 * `res` it is handed.
 */
import { validateMessages, validateTools, normalizeFinishReason, nextToolCallId } from '../llm/chat-types.js';
import { randomId, nowSeconds, normalizeToolList, normalizeStopList, createWriterBase } from './normalize.js';

// OpenAI content may be a plain string or an array of parts; image/audio parts
// are dropped (this bridge is text-first).
function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      if (part && part.type === 'text' && typeof part.text === 'string') text += part.text;
    }
    return text;
  }
  return '';
}

function normalizeTools(rawTools) {
  return normalizeToolList(rawTools, (tool) => {
    if (typeof tool.type === 'string' && tool.type !== 'function') return null;
    const fn = tool.function && typeof tool.function === 'object' ? tool.function : tool;
    if (typeof fn.name !== 'string' || !fn.name) return null;
    return {
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parametersJson: JSON.stringify(fn.parameters ?? { type: 'object', properties: {} })
    };
  });
}

function normalizeStop(stop) {
  return normalizeStopList(stop, { allowString: true });
}

function parseChatCompletionsRequest(body, toolNames = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Request body must be a JSON object');
  if (typeof body.model !== 'string' || !body.model) throw new TypeError('model must be a non-empty string');
  if (!Array.isArray(body.messages)) throw new TypeError('messages must be an array');

  const messages = body.messages.map((message) => {
    if (!message || typeof message !== 'object') throw new TypeError('each message must be an object');
    const role = message.role;
    if (role === 'tool') {
      const toolCallId = typeof message.tool_call_id === 'string' && message.tool_call_id ? message.tool_call_id : null;
      const normalized = { role: 'tool', content: normalizeContent(message.content), toolCallId: toolCallId || `call_${randomId()}` };
      const name = typeof message.name === 'string' && message.name
        ? message.name
        : (toolNames && toolCallId ? toolNames.nameFor(toolCallId) : undefined);
      if (name) normalized.name = name;
      return normalized;
    }
    if (role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const toolCalls = message.tool_calls.map((call) => ({
        id: typeof call?.id === 'string' && call.id ? call.id : nextToolCallId(),
        name: typeof call?.function?.name === 'string' ? call.function.name : '',
        argumentsJson: typeof call?.function?.arguments === 'string' ? call.function.arguments : ''
      }));
      return { role: 'assistant', content: normalizeContent(message.content), toolCalls };
    }
    return { role, content: normalizeContent(message.content) };
  });

  validateMessages(messages);
  const tools = validateTools(normalizeTools(body.tools));
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  const request = { model: body.model, messages, tools, stop: normalizeStop(body.stop), stream: body.stream === true };
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) request.temperature = body.temperature;
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) request.maxTokens = maxTokens;
  return request;
}

function parseCompletionsRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Request body must be a JSON object');
  if (typeof body.model !== 'string' || !body.model) throw new TypeError('model must be a non-empty string');
  const { prompt } = body;
  if (typeof prompt !== 'string' && !Array.isArray(prompt)) throw new TypeError('prompt must be a string or an array of strings');
  const text = Array.isArray(prompt) ? prompt.filter((entry) => typeof entry === 'string').join('\n') : prompt;
  const messages = [{ role: 'user', content: text }];
  validateMessages(messages);
  const maxTokens = body.max_tokens;
  const request = { model: body.model, messages, tools: [], stop: normalizeStop(body.stop), stream: body.stream === true };
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) request.temperature = body.temperature;
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) request.maxTokens = maxTokens;
  return request;
}

// Both OpenAI surfaces share this error payload shape.
function emitOpenAiError(base, stream, error) {
  if (base.aborted) return;
  const message = error?.message || 'Request failed';
  if (stream && base.sse.started) {
    base.sse.event('error', { error: { message, type: 'api_error', code: null } });
    base.sse.raw('[DONE]');
    base.end();
  } else {
    base.writeJson(500, { error: { message, type: 'api_error', code: null } });
  }
}

function createChatCompletionsWriter({ res, model, stream, toolNames = null }) {
  const base = createWriterBase({ res, stream });
  const id = `chatcmpl-${randomId()}`;
  const created = nowSeconds();
  let started = false;
  const textParts = [];
  const calls = new Map();
  const callOrder = [];

  function ensureStarted() {
    if (started || base.aborted) return;
    started = true;
    if (stream) {
      base.sse.data({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    }
  }

  function chunk(delta, finishReason = null) {
    base.sse.data({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] });
  }

  function recordCall({ index = 0, id: callId, name, argumentsDelta = '', emit }) {
    const existing = calls.has(index);
    let call = calls.get(index);
    if (!call) {
      call = { index, id: undefined, name: undefined, argumentsJson: '' };
      calls.set(index, call);
      callOrder.push(index);
    }
    const idProvided = typeof callId === 'string' && callId;
    if (idProvided) call.id = callId;
    if (!call.id) call.id = nextToolCallId();
    const nameProvided = typeof name === 'string' && name;
    if (nameProvided) call.name = name;
    call.argumentsJson += typeof argumentsDelta === 'string' ? argumentsDelta : '';
    if (call.id && call.name && toolNames) toolNames.record(call.id, call.name);
    if (emit) {
      const toolCall = { index, type: 'function' };
      // The id and name belong on the first delta for this index; later deltas
      // carry only the argument fragment.
      if (!existing) toolCall.id = call.id;
      const fn = {};
      if (nameProvided || (!existing && call.name)) fn.name = call.name;
      fn.arguments = typeof argumentsDelta === 'string' ? argumentsDelta : '';
      toolCall.function = fn;
      chunk({ tool_calls: [toolCall] });
    }
  }

  return {
    text(chunkText) {
      if (base.aborted || typeof chunkText !== 'string' || !chunkText) return;
      if (stream) {
        ensureStarted();
        chunk({ content: chunkText });
      } else {
        textParts.push(chunkText);
      }
    },
    toolCall({ index = 0, id: callId, name, argumentsDelta = '' } = {}) {
      if (base.aborted) return;
      if (stream) ensureStarted();
      recordCall({ index, id: callId, name, argumentsDelta, emit: stream });
    },
    finish({ finishReason, usage } = {}) {
      if (base.aborted) return;
      const reason = normalizeFinishReason(finishReason, calls.size > 0);
      if (stream) {
        ensureStarted();
        chunk({}, reason);
        base.sse.raw('[DONE]');
        base.sse.end();
        return;
      }
      const text = textParts.join('');
      const toolCalls = callOrder.map((index) => {
        const call = calls.get(index);
        return { id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsJson } };
      });
      const promptTokens = Number.isSafeInteger(usage?.promptTokens) ? usage.promptTokens : 0;
      const completionTokens = Number.isSafeInteger(usage?.completionTokens) ? usage.completionTokens : 0;
      base.writeJson(200, {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text === '' && toolCalls.length > 0 ? null : text, tool_calls: toolCalls },
          finish_reason: reason
        }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
      });
    },
    error(error) { emitOpenAiError(base, stream, error); },
    abort() { base.abort(); }
  };
}

function createCompletionsWriter({ res, model, stream }) {
  const base = createWriterBase({ res, stream });
  const id = `cmpl-${randomId()}`;
  const created = nowSeconds();
  const textParts = [];

  function chunk(text, finishReason = null) {
    base.sse.data({ id, object: 'text_completion', created, model, choices: [{ text, index: 0, logprobs: null, finish_reason: finishReason }] });
  }

  return {
    text(chunkText) {
      if (base.aborted || typeof chunkText !== 'string' || !chunkText) return;
      if (stream) chunk(chunkText);
      else textParts.push(chunkText);
    },
    toolCall() { /* the legacy surface has no tool calls */ },
    finish({ finishReason, usage } = {}) {
      if (base.aborted) return;
      const reason = normalizeFinishReason(finishReason, false);
      if (stream) {
        chunk('', reason);
        base.sse.raw('[DONE]');
        base.sse.end();
        return;
      }
      const promptTokens = Number.isSafeInteger(usage?.promptTokens) ? usage.promptTokens : 0;
      const completionTokens = Number.isSafeInteger(usage?.completionTokens) ? usage.completionTokens : 0;
      base.writeJson(200, {
        id,
        object: 'text_completion',
        created,
        model,
        choices: [{ text: textParts.join(''), index: 0, logprobs: null, finish_reason: reason }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
      });
    },
    error(error) { emitOpenAiError(base, stream, error); },
    abort() { base.abort(); }
  };
}

export {
  parseChatCompletionsRequest,
  createChatCompletionsWriter,
  parseCompletionsRequest,
  createCompletionsWriter
};