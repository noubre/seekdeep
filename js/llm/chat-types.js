/**
 * Normalized chat vocabulary shared by the provider adapters, the DHT chat
 * frames, and the HTTP codecs. Pure: no I/O, no DOM, no provider imports.
 *
 * A "message" is `{ role, content, toolCalls?, toolCallId?, name? }` where
 * `toolCalls` only appears on `assistant` messages and `toolCallId`/`name` only
 * on `tool` messages. A "tool" is `{ name, description, parametersJson }`.
 * Everything that crosses a boundary is validated with these functions so the
 * three surfaces cannot drift apart.
 */

const CHAT_ROLES = Object.freeze(['system', 'user', 'assistant', 'tool']);
const CHAT_RESPONSE_KINDS = Object.freeze(['text', 'tool_call', 'done', 'error']);

const MAX_MESSAGES = 512;
const MAX_TOOLS = 256;
const MAX_TOOL_CALLS = 64;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonText(value) {
  try { JSON.parse(value); return true; } catch { return false; }
}

function validateToolCall(call) {
  if (!isPlainObject(call)) throw new TypeError('message.toolCalls entries must be plain objects');
  for (const key of Reflect.ownKeys(call)) {
    if (typeof key !== 'string' || (key !== 'id' && key !== 'name' && key !== 'argumentsJson')) {
      throw new TypeError(`message.toolCalls entry contains an unsupported field: ${String(key)}`);
    }
  }
  if (typeof call.id !== 'string' || !call.id) throw new TypeError('message.toolCalls[].id must be a non-empty string');
  if (typeof call.name !== 'string' || !call.name) throw new TypeError('message.toolCalls[].name must be a non-empty string');
  if (typeof call.argumentsJson !== 'string') throw new TypeError('message.toolCalls[].argumentsJson must be a string');
  if (call.argumentsJson && !isJsonText(call.argumentsJson)) {
    throw new TypeError('message.toolCalls[].argumentsJson must be JSON text');
  }
}

function validateMessage(message) {
  if (!isPlainObject(message)) throw new TypeError('message must be a plain object');
  const role = message.role;
  if (typeof role !== 'string' || !CHAT_ROLES.includes(role)) {
    throw new TypeError(`message.role must be one of: ${CHAT_ROLES.join(', ')}`);
  }
  const allowed = ['role', 'content'];
  if (role === 'assistant') allowed.push('toolCalls');
  if (role === 'tool') allowed.push('toolCallId', 'name');
  for (const key of Reflect.ownKeys(message)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new TypeError(`message contains an unsupported field: ${String(key)}`);
    }
  }
  if (typeof message.content !== 'string') throw new TypeError('message.content must be a string');
  if (role === 'assistant' && message.toolCalls !== undefined) {
    if (!Array.isArray(message.toolCalls) || message.toolCalls.length > MAX_TOOL_CALLS) {
      throw new TypeError(`message.toolCalls must be an array of at most ${MAX_TOOL_CALLS} entries`);
    }
    for (const call of message.toolCalls) validateToolCall(call);
  }
  if (role === 'tool') {
    if (typeof message.toolCallId !== 'string' || !message.toolCallId) {
      throw new TypeError('message.toolCallId must be a non-empty string on tool messages');
    }
    if (message.name !== undefined && typeof message.name !== 'string') {
      throw new TypeError('message.name must be a string on tool messages');
    }
  }
  return message;
}

/**
 * Validate a normalized message list. Returns the same array; throws TypeError.
 * @param {unknown} messages
 */
function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
  if (messages.length > MAX_MESSAGES) throw new TypeError(`messages must contain at most ${MAX_MESSAGES} entries`);
  for (const message of messages) validateMessage(message);
  return messages;
}

/**
 * Validate a normalized tool list. Returns a new array; a tool whose
 * `parametersJson` does not parse is dropped (never thrown).
 * @param {unknown} tools
 */
function validateTools(tools) {
  if (!Array.isArray(tools)) throw new TypeError('tools must be an array');
  if (tools.length > MAX_TOOLS) throw new TypeError(`tools must contain at most ${MAX_TOOLS} entries`);
  const result = [];
  for (const tool of tools) {
    if (!isPlainObject(tool)) throw new TypeError('tool must be a plain object');
    for (const key of Reflect.ownKeys(tool)) {
      if (typeof key !== 'string' || (key !== 'name' && key !== 'description' && key !== 'parametersJson')) {
        throw new TypeError(`tool contains an unsupported field: ${String(key)}`);
      }
    }
    if (typeof tool.name !== 'string' || !tool.name) throw new TypeError('tool.name must be a non-empty string');
    if (tool.description !== undefined && typeof tool.description !== 'string') {
      throw new TypeError('tool.description must be a string');
    }
    if (typeof tool.parametersJson !== 'string') throw new TypeError('tool.parametersJson must be a string');
    if (!isJsonText(tool.parametersJson)) continue;
    result.push({ name: tool.name, description: tool.description ?? '', parametersJson: tool.parametersJson });
  }
  return result;
}

/**
 * Map a provider finish reason onto the normalized set.
 * @param {unknown} reason
 * @param {boolean} hasToolCalls
 * @returns {'stop'|'tool_calls'|'length'}
 */
function normalizeFinishReason(reason, hasToolCalls) {
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'length') return reason;
  return hasToolCalls ? 'tool_calls' : 'stop';
}

let toolCallCounter = 0;

/** Synthesize a tool-call id for providers that omit one. */
function nextToolCallId() {
  toolCallCounter += 1;
  return `call_${toolCallCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Cheap character/4 token estimate over message text and tool metadata.
 * @param {Array<{content?: string}>} messages
 * @param {Array<{name?: string, description?: string}>} [tools]
 * @returns {number}
 */
function estimateTokens(messages, tools = []) {
  let chars = 0;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (message && typeof message.content === 'string') chars += message.content.length;
    }
  }
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (!tool) continue;
      if (typeof tool.name === 'string') chars += tool.name.length;
      if (typeof tool.description === 'string') chars += tool.description.length;
    }
  }
  return Math.ceil(chars / 4);
}

export {
  CHAT_ROLES,
  CHAT_RESPONSE_KINDS,
  MAX_MESSAGES,
  MAX_TOOLS,
  validateMessages,
  validateTools,
  normalizeFinishReason,
  nextToolCallId,
  estimateTokens
};