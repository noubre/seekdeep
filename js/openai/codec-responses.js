/**
 * OpenAI Responses codec (`/v1/responses`).
 *
 * Parses Responses request bodies into the normalized `ChatRequest` and writes
 * either the non-streaming response body or the documented SSE event sequence
 * (`response.created` … `response.completed`/`response.incomplete`). Pure: the
 * only I/O is the `res`.
 */
import { validateMessages, validateTools, nextToolCallId, normalizeFinishReason } from '../llm/chat-types.js';
import { randomId, nowSeconds, normalizeToolList, createWriterBase } from './normalize.js';

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if ((part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
        text += part.text;
      }
    }
    return text;
  }
  return '';
}

function normalizeTools(rawTools) {
  return normalizeToolList(rawTools, (tool) => {
    if (tool.type !== 'function') return null;
    if (typeof tool.name !== 'string' || !tool.name) return null;
    return {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parametersJson: JSON.stringify(tool.parameters ?? { type: 'object', properties: {} })
    };
  });
}

function parseResponsesRequest(body, toolNames = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Request body must be a JSON object');
  if (typeof body.model !== 'string' || !body.model) throw new TypeError('model must be a non-empty string');

  const messages = [];
  if (typeof body.instructions === 'string' && body.instructions) messages.push({ role: 'system', content: body.instructions });

  const pendingCalls = [];
  const flushCalls = () => {
    if (!pendingCalls.length) return;
    messages.push({ role: 'assistant', content: '', toolCalls: [...pendingCalls] });
    pendingCalls.length = 0;
  };

  const input = body.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'function_call') {
        pendingCalls.push({
          id: typeof item.call_id === 'string' && item.call_id ? item.call_id : nextToolCallId(),
          name: typeof item.name === 'string' ? item.name : '',
          argumentsJson: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {})
        });
        continue;
      }
      flushCalls();
      if (item.type === 'function_call_output') {
        const toolCallId = typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_${randomId()}`;
        const normalized = { role: 'tool', content: contentToText(item.output), toolCallId };
        const name = toolNames && item.call_id ? toolNames.nameFor(item.call_id) : undefined;
        if (name) normalized.name = name;
        messages.push(normalized);
        continue;
      }
      if (item.type === 'message') {
        const role = typeof item.role === 'string' ? item.role : 'user';
        messages.push({ role, content: contentToText(item.content) });
      }
    }
    flushCalls();
  }

  validateMessages(messages);
  const tools = validateTools(normalizeTools(body.tools));
  const maxTokens = body.max_output_tokens;
  const request = { model: body.model, messages, tools, stop: [], stream: body.stream === true };
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) request.temperature = body.temperature;
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) request.maxTokens = maxTokens;
  return request;
}

function createResponsesWriter({ res, model, stream, toolNames = null }) {
  const base = createWriterBase({ res, stream });
  const sse = base.sse;
  const responseId = `resp_${randomId()}`;
  const created = nowSeconds();
  const calls = new Map();
  const callOrder = [];
  let sequence = 0;
  let started = false;
  let textItem = null; // { id, outputIndex, part }
  let text = '';
  let nextOutputIndex = 0;

  function emit(name, payload) {
    sse.event(name, { type: name, sequence_number: sequence++, ...payload });
  }

  function responseObject(status, output, usage, incompleteDetails) {
    const object = { id: responseId, object: 'response', created_at: created, status, model, output };
    if (usage) object.usage = usage;
    if (incompleteDetails) object.incomplete_details = incompleteDetails;
    return object;
  }

  function ensureStarted() {
    if (started || base.aborted) return;
    started = true;
    emit('response.created', { response: responseObject('in_progress', []) });
    emit('response.in_progress', { response: responseObject('in_progress', []) });
  }

  function openTextItem() {
    if (textItem) return;
    textItem = { id: `msg_${randomId()}`, outputIndex: nextOutputIndex++, part: { type: 'output_text', text: '', annotations: [] } };
    emit('response.output_item.added', {
      output_index: textItem.outputIndex,
      item: { id: textItem.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] }
    });
    emit('response.content_part.added', {
      item_id: textItem.id,
      output_index: textItem.outputIndex,
      content_index: 0,
      part: textItem.part
    });
  }

  function closeTextItem() {
    if (!textItem) return;
    emit('response.output_text.done', { item_id: textItem.id, output_index: textItem.outputIndex, content_index: 0, text });
    emit('response.content_part.done', { item_id: textItem.id, output_index: textItem.outputIndex, content_index: 0, part: { type: 'output_text', text, annotations: [] } });
    emit('response.output_item.done', {
      output_index: textItem.outputIndex,
      item: { id: textItem.id, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }
    });
    textItem = null;
  }

  function buildFinalOutput() {
    const output = [];
    if (text !== '') {
      output.push({ id: `msg_${randomId()}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });
    }
    for (const index of callOrder) {
      const call = calls.get(index);
      output.push({ id: call.itemId, type: 'function_call', status: 'completed', call_id: call.id, name: call.name, arguments: call.argumentsJson });
    }
    return output;
  }

  return {
    text(chunkText) {
      if (base.aborted || typeof chunkText !== 'string' || !chunkText) return;
      text += chunkText;
      if (stream) {
        ensureStarted();
        openTextItem();
        emit('response.output_text.delta', { item_id: textItem.id, output_index: textItem.outputIndex, content_index: 0, delta: chunkText });
      }
    },
    toolCall({ index = 0, id: callId, name, argumentsDelta = '' } = {}) {
      if (base.aborted) return;
      const partial = typeof argumentsDelta === 'string' ? argumentsDelta : '';
      let call = calls.get(index);
      const isNew = !call;
      if (!call) {
        call = { index, itemId: `fc_${randomId()}`, outputIndex: nextOutputIndex++, id: undefined, name: undefined, argumentsJson: '' };
        calls.set(index, call);
        callOrder.push(index);
      }
      if (typeof callId === 'string' && callId) call.id = callId;
      if (!call.id) call.id = nextToolCallId();
      if (typeof name === 'string' && name) call.name = name;
      if (call.id && call.name && toolNames) toolNames.record(call.id, call.name);
      call.argumentsJson += partial;
      if (stream) {
        ensureStarted();
        if (isNew) {
          closeTextItem();
          emit('response.output_item.added', {
            output_index: call.outputIndex,
            item: { id: call.itemId, type: 'function_call', status: 'in_progress', call_id: call.id, name: call.name, arguments: '' }
          });
        }
        emit('response.function_call_arguments.delta', { item_id: call.itemId, output_index: call.outputIndex, delta: partial });
      }
    },
    finish({ finishReason, usage } = {}) {
      if (base.aborted) return;
      const promptTokens = Number.isSafeInteger(usage?.promptTokens) ? usage.promptTokens : 0;
      const completionTokens = Number.isSafeInteger(usage?.completionTokens) ? usage.completionTokens : 0;
      const usageObject = { input_tokens: promptTokens, output_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
      const reason = normalizeFinishReason(finishReason, callOrder.length > 0);
      const status = reason === 'length' ? 'incomplete' : 'completed';
      const incompleteDetails = status === 'incomplete' ? { reason: 'max_output_tokens' } : undefined;
      if (stream) {
        ensureStarted();
        closeTextItem();
        for (const index of callOrder) {
          const call = calls.get(index);
          emit('response.function_call_arguments.done', { item_id: call.itemId, output_index: call.outputIndex, arguments: call.argumentsJson });
          emit('response.output_item.done', {
            output_index: call.outputIndex,
            item: { id: call.itemId, type: 'function_call', status: 'completed', call_id: call.id, name: call.name, arguments: call.argumentsJson }
          });
        }
        emit(
          status === 'incomplete' ? 'response.incomplete' : 'response.completed',
          { response: responseObject(status, buildFinalOutput(), usageObject, incompleteDetails) }
        );
        sse.end();
        return;
      }
      base.writeJson(200, responseObject(status, buildFinalOutput(), usageObject, incompleteDetails));
    },
    error(error) {
      if (base.aborted) return;
      const message = error?.message || 'Request failed';
      if (stream && sse.started) {
        sse.event('error', { type: 'error', code: 'api_error', message, param: null });
        base.end();
      } else {
        base.writeJson(500, { error: { message, type: 'api_error' } });
      }
    },
    abort() { base.abort(); }
  };
}

export { parseResponsesRequest, createResponsesWriter };