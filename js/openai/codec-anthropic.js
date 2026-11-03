/**
 * Anthropic Messages codec (`/v1/messages`, `/v1/messages/count_tokens`).
 *
 * Parses Anthropic request bodies into the normalized `ChatRequest` and writes
 * either the non-streaming message body or the documented SSE event sequence.
 * Pure: the only I/O is the `res` it is handed.
 */
import { validateMessages, validateTools, normalizeFinishReason, nextToolCallId, estimateTokens } from '../llm/chat-types.js';
import { randomId, normalizeToolList, normalizeStopList, createWriterBase } from './normalize.js';

function toBlocks(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (Array.isArray(content)) return content.filter((block) => block && typeof block === 'object');
  return [];
}

function flattenText(content) {
  if (typeof content === 'string') return content;
  return toBlocks(content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function extractSystem(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return flattenText(system);
  return null;
}

function normalizeTools(rawTools) {
  return normalizeToolList(rawTools, (tool) => {
    if (typeof tool.name !== 'string' || !tool.name) return null;
    return {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parametersJson: JSON.stringify(tool.input_schema ?? { type: 'object', properties: {} })
    };
  });
}

function normalizeStop(stop) {
  return normalizeStopList(stop);
}

function toToolMessage(block, toolNames) {
  const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
  const normalized = {
    role: 'tool',
    content: typeof block.content === 'string' ? block.content : flattenText(block.content),
    toolCallId: id || `call_${randomId()}`
  };
  const name = toolNames && id ? toolNames.nameFor(id) : undefined;
  if (name) normalized.name = name;
  return normalized;
}

function parseAssistantMessage(message) {
  const toolCalls = [];
  let text = '';
  for (const block of toBlocks(message.content)) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: typeof block.id === 'string' && block.id ? block.id : nextToolCallId(),
        name: typeof block.name === 'string' ? block.name : '',
        argumentsJson: JSON.stringify(block.input ?? {})
      });
    }
  }
  const normalized = { role: 'assistant', content: text };
  if (toolCalls.length) normalized.toolCalls = toolCalls;
  return normalized;
}

function parseMessagesRequest(body, toolNames = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Request body must be a JSON object');
  if (typeof body.model !== 'string' || !body.model) throw new TypeError('model must be a non-empty string');
  if (!Array.isArray(body.messages)) throw new TypeError('messages must be an array');

  const messages = [];
  const system = extractSystem(body.system);
  if (system !== null) messages.push({ role: 'system', content: system });

  for (const message of body.messages) {
    if (!message || typeof message !== 'object') throw new TypeError('each message must be an object');
    if (message.role === 'assistant') {
      messages.push(parseAssistantMessage(message));
      continue;
    }
    // A user message may interleave text and tool_result blocks; a run of text
    // becomes one user message and each tool_result becomes its own tool message.
    let pendingText = '';
    let hasText = false;
    for (const block of toBlocks(message.content)) {
      if (block.type === 'tool_result') {
        if (hasText) {
          messages.push({ role: 'user', content: pendingText });
          pendingText = '';
          hasText = false;
        }
        messages.push(toToolMessage(block, toolNames));
      } else if (block.type === 'text' && typeof block.text === 'string') {
        pendingText += block.text;
        hasText = true;
      }
    }
    if (hasText) messages.push({ role: 'user', content: pendingText });
  }

  validateMessages(messages);
  const tools = validateTools(normalizeTools(body.tools));
  const maxTokens = Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : 4096;
  const request = { model: body.model, messages, tools, maxTokens, stop: normalizeStop(body.stop_sequences), stream: body.stream === true };
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) request.temperature = body.temperature;
  return request;
}

function countInputTokens(body, toolNames = null) {
  const request = parseMessagesRequest(body, toolNames);
  return { input_tokens: estimateTokens(request.messages, request.tools) };
}

function toAnthropicStopReason(reason) {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

function createMessagesWriter({ res, model, stream, toolNames = null }) {
  const base = createWriterBase({ res, stream });
  const sse = base.sse;
  const id = `msg_${randomId()}`;
  const textParts = [];
  const calls = new Map();
  const callOrder = [];
  let started = false;
  let textBlockOpen = false;
  let nextIndex = 0;

  function event(name, payload) {
    sse.event(name, { type: name, ...payload });
  }

  function ensureStarted() {
    if (started || base.aborted) return;
    started = true;
    event('message_start', {
      message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }
    });
  }

  function openTextBlock() {
    if (textBlockOpen) return;
    textBlockOpen = true;
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  }

  function closeTextBlock() {
    if (!textBlockOpen) return;
    textBlockOpen = false;
    event('content_block_stop', { index: 0 });
  }

  function emitToolDelta(call, partial) {
    call.argumentsJson += partial;
    event('content_block_delta', { index: call.blockIndex, delta: { type: 'input_json_delta', partial_json: partial } });
  }

  return {
    text(chunkText) {
      if (base.aborted || typeof chunkText !== 'string' || !chunkText) return;
      if (stream) {
        ensureStarted();
        openTextBlock();
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunkText } });
      } else {
        textParts.push(chunkText);
      }
    },
    toolCall({ index = 0, id: callId, name, argumentsDelta = '' } = {}) {
      if (base.aborted) return;
      const partial = typeof argumentsDelta === 'string' ? argumentsDelta : '';
      const existing = calls.get(index);
      if (stream) {
        ensureStarted();
        if (!existing) {
          closeTextBlock();
          const blockIndex = nextIndex++;
          const startId = typeof callId === 'string' && callId ? callId : nextToolCallId();
          const startName = typeof name === 'string' ? name : '';
          const call = { index, blockIndex, id: startId, name: startName || undefined, argumentsJson: '' };
          calls.set(index, call);
          callOrder.push(index);
          if (call.id && call.name && toolNames) toolNames.record(call.id, call.name);
          event('content_block_start', { index: blockIndex, content_block: { type: 'tool_use', id: startId, name: startName, input: {} } });
          emitToolDelta(call, partial);
          return;
        }
        if (typeof callId === 'string' && callId) existing.id = callId;
        if (typeof name === 'string' && name) existing.name = name;
        if (existing.id && existing.name && toolNames) toolNames.record(existing.id, existing.name);
        emitToolDelta(existing, partial);
        return;
      }
      let call = existing;
      if (!call) {
        call = { index, blockIndex: nextIndex++, id: undefined, name: undefined, argumentsJson: '' };
        calls.set(index, call);
        callOrder.push(index);
      }
      if (typeof callId === 'string' && callId) call.id = callId;
      if (!call.id) call.id = nextToolCallId();
      if (typeof name === 'string' && name) call.name = name;
      if (call.id && call.name && toolNames) toolNames.record(call.id, call.name);
      call.argumentsJson += partial;
    },
    finish({ finishReason, usage } = {}) {
      if (base.aborted) return;
      const reason = normalizeFinishReason(finishReason, calls.size > 0);
      if (stream) {
        ensureStarted();
        if (!textBlockOpen && callOrder.length === 0) openTextBlock();
        closeTextBlock();
        for (const index of callOrder) event('content_block_stop', { index: calls.get(index).blockIndex });
        const outputTokens = Number.isSafeInteger(usage?.completionTokens) ? usage.completionTokens : 0;
        event('message_delta', { delta: { stop_reason: toAnthropicStopReason(reason), stop_sequence: null }, usage: { output_tokens: outputTokens } });
        event('message_stop', {});
        sse.end();
        return;
      }
      const text = textParts.join('');
      const content = [];
      if (text !== '' || callOrder.length === 0) content.push({ type: 'text', text });
      for (const index of callOrder) {
        const call = calls.get(index);
        let input = {};
        try { input = JSON.parse(call.argumentsJson); } catch { input = {}; }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      const inputTokens = Number.isSafeInteger(usage?.promptTokens) ? usage.promptTokens : 0;
      const outputTokens = Number.isSafeInteger(usage?.completionTokens) ? usage.completionTokens : 0;
      base.writeJson(200, {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: toAnthropicStopReason(reason),
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
      });
    },
    error(error) {
      if (base.aborted) return;
      const message = error?.message || 'Request failed';
      if (stream && sse.started) {
        sse.event('error', { type: 'error', error: { type: 'api_error', message } });
        base.end();
      } else {
        base.writeJson(500, { type: 'error', error: { type: 'api_error', message } });
      }
    },
    abort() { base.abort(); }
  };
}

export { parseMessagesRequest, createMessagesWriter, countInputTokens };