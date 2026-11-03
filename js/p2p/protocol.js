import b4a from 'b4a';
import { validateMessages, validateTools, CHAT_RESPONSE_KINDS } from '../llm/chat-types.js';

const MAX_PEER_MESSAGE_BYTES = 64 * 1024;
// Chat frames carry tool schemas and multi-turn transcripts, which routinely
// exceed the control-plane 64 KiB cap (Claude Code sends large tool defs).
const MAX_CHAT_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_ID_LENGTH = 64;

const PEER_MESSAGE_TYPES = Object.freeze([
  'handshake',
  'handshake_ack',
  'mode_update',
  'models_update',
  'model_request',
  'query',
  'response',
  'peer_message',
  'chat_query',
  'chat_response'
]);

// For each type: `required` must be present, `optional` may be present, and
// any key outside `required + optional` is rejected as an extra field.
const PEER_MESSAGE_FIELDS = Object.freeze({
  handshake: Object.freeze({ required: Object.freeze(['clientId', 'displayName', 'timestamp', 'isHost']), optional: Object.freeze([]) }),
  handshake_ack: Object.freeze({ required: Object.freeze(['serverId']), optional: Object.freeze([]) }),
  mode_update: Object.freeze({ required: Object.freeze(['isCollaborativeMode', 'isHost']), optional: Object.freeze([]) }),
  models_update: Object.freeze({ required: Object.freeze(['models']), optional: Object.freeze([]) }),
  model_request: Object.freeze({ required: Object.freeze([]), optional: Object.freeze([]) }),
  query: Object.freeze({ required: Object.freeze(['model', 'prompt', 'requestId']), optional: Object.freeze(['fromPeerId']) }),
  response: Object.freeze({ required: Object.freeze(['requestId', 'data', 'isComplete', 'isJson', 'isPrivate']), optional: Object.freeze(['fromPeerId', 'error']) }),
  peer_message: Object.freeze({ required: Object.freeze(['messageType', 'content', 'fromPeer', 'requestId']), optional: Object.freeze([]) }),
  chat_query: Object.freeze({ required: Object.freeze(['requestId', 'model', 'messages']), optional: Object.freeze(['tools', 'temperature', 'maxTokens', 'stop', 'fromPeerId']) }),
  chat_response: Object.freeze({ required: Object.freeze(['requestId', 'kind']), optional: Object.freeze(['text', 'index', 'id', 'name', 'argumentsDelta', 'finishReason', 'error', 'promptTokens', 'completionTokens']) })
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertStringField(message, key, maxLength = 1024) {
  const value = message[key];
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new TypeError(`Peer message ${message.type}.${key} must be a non-empty string`);
  }
}

function assertBooleanField(message, key) {
  if (typeof message[key] !== 'boolean') throw new TypeError(`Peer message ${message.type}.${key} must be a boolean`);
}

function assertOptionalStringField(message, key, maxLength = 1024) {
  if (message[key] === undefined) return;
  assertStringField(message, key, maxLength);
}

function assertOptionalNonNegativeInteger(message, key) {
  if (message[key] === undefined) return;
  const value = message[key];
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Peer message ${message.type}.${key} must be a non-negative integer`);
}

function assertOptionalStringArray(message, key, maxItems, maxLength) {
  if (message[key] === undefined) return;
  const value = message[key];
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(`Peer message ${message.type}.${key} must be an array of at most ${maxItems} entries`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry || entry.length > maxLength) {
      throw new TypeError(`Peer message ${message.type}.${key} entries must be non-empty strings of at most ${maxLength} characters`);
    }
  }
}

function assertRequestId(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_REQUEST_ID_LENGTH) {
    throw new TypeError(`Peer message requestId must be a non-empty string of at most ${MAX_REQUEST_ID_LENGTH} characters`);
  }
}

function validateModels(models) {
  if (!Array.isArray(models) || models.length > 512) throw new TypeError('Peer message models_update.models must be an array');
  for (const model of models) {
    if (!isPlainObject(model)) throw new TypeError('Peer message models_update.models entries must be plain objects');
    for (const key of Reflect.ownKeys(model)) {
      if (key !== 'id' && key !== 'name' && key !== 'created') throw new TypeError(`Peer message model contains an unsupported field: ${String(key)}`);
    }
    if (typeof model.id !== 'string' || !model.id) throw new TypeError('Peer message model.id must be a non-empty string');
    if (typeof model.name !== 'string' || !model.name) throw new TypeError('Peer message model.name must be a non-empty string');
    if (model.created !== undefined && (!Number.isSafeInteger(model.created) || model.created < 0)) {
      throw new TypeError('Peer message model.created must be a non-negative integer (Unix seconds)');
    }
  }
}

function validatePeerMessage(message) {
  if (!isPlainObject(message)) throw new TypeError('Peer message must be a plain object');
  const type = message.type;
  if (typeof type !== 'string' || !Object.hasOwn(PEER_MESSAGE_FIELDS, type)) {
    throw new TypeError(`Unknown peer message type: ${String(type)}`);
  }

  const { required, optional } = PEER_MESSAGE_FIELDS[type];
  const allowed = ['type', ...required, ...optional];
  for (const key of Reflect.ownKeys(message)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`Peer message ${type} contains an unsupported field: ${String(key)}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(message, key)) throw new TypeError(`Peer message ${type} is missing required field: ${key}`);
  }

  switch (type) {
    case 'handshake':
      assertStringField(message, 'clientId');
      assertStringField(message, 'displayName');
      if (typeof message.timestamp !== 'number' || !Number.isFinite(message.timestamp)) throw new TypeError('Peer message handshake.timestamp must be a finite number');
      assertBooleanField(message, 'isHost');
      break;
    case 'handshake_ack':
      assertStringField(message, 'serverId');
      break;
    case 'mode_update':
      assertBooleanField(message, 'isCollaborativeMode');
      assertBooleanField(message, 'isHost');
      break;
    case 'models_update':
      validateModels(message.models);
      break;
    case 'model_request':
      break;
    case 'query':
      assertStringField(message, 'model');
      assertStringField(message, 'prompt', 128 * 1024);
      assertRequestId(message.requestId);
      if (message.fromPeerId !== undefined) assertStringField(message, 'fromPeerId');
      break;
    case 'response':
      assertRequestId(message.requestId);
      if (typeof message.data !== 'string') throw new TypeError('Peer message response.data must be a string');
      assertBooleanField(message, 'isComplete');
      assertBooleanField(message, 'isJson');
      assertBooleanField(message, 'isPrivate');
      if (message.fromPeerId !== undefined) assertStringField(message, 'fromPeerId');
      if (message.error !== undefined) assertStringField(message, 'error', 8 * 1024);
      break;
    case 'peer_message':
      assertStringField(message, 'messageType');
      assertStringField(message, 'content', 128 * 1024);
      assertStringField(message, 'fromPeer');
      assertRequestId(message.requestId);
      break;
    case 'chat_query': {
      assertRequestId(message.requestId);
      assertStringField(message, 'model', 512);
      validateMessages(message.messages);
      if (message.tools !== undefined) validateTools(message.tools);
      if (message.temperature !== undefined) {
        const temperature = message.temperature;
        if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
          throw new TypeError('Peer message chat_query.temperature must be a finite number between 0 and 2');
        }
      }
      if (message.maxTokens !== undefined) {
        const maxTokens = message.maxTokens;
        if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1000000) {
          throw new TypeError('Peer message chat_query.maxTokens must be an integer between 1 and 1000000');
        }
      }
      assertOptionalStringArray(message, 'stop', 4, 64);
      assertOptionalStringField(message, 'fromPeerId');
      break;
    }
    case 'chat_response': {
      assertRequestId(message.requestId);
      if (typeof message.kind !== 'string' || !CHAT_RESPONSE_KINDS.includes(message.kind)) {
        throw new TypeError(`Peer message chat_response.kind must be one of: ${CHAT_RESPONSE_KINDS.join(', ')}`);
      }
      if (message.kind === 'text') assertStringField(message, 'text', 4 * 1024 * 1024);
      if (message.kind === 'tool_call') {
        if (!Number.isSafeInteger(message.index) || message.index < 0) throw new TypeError('Peer message chat_response.index must be a non-negative integer');
        if (typeof message.argumentsDelta !== 'string') throw new TypeError('Peer message chat_response.argumentsDelta must be a string');
      }
      assertOptionalStringField(message, 'id');
      assertOptionalStringField(message, 'name');
      if (message.kind === 'done') assertStringField(message, 'finishReason', 64);
      if (message.kind === 'error') assertStringField(message, 'error', 8 * 1024);
      assertOptionalNonNegativeInteger(message, 'promptTokens');
      assertOptionalNonNegativeInteger(message, 'completionTokens');
      break;
    }
    default:
      throw new TypeError(`Unknown peer message type: ${String(type)}`);
  }

  return message;
}

function parsePeerMessage(buffer, options = {}) {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_PEER_MESSAGE_BYTES;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) throw new TypeError('maxMessageBytes must be a positive integer');
  if (typeof buffer === 'string') {
    if (b4a.byteLength(buffer) > maxMessageBytes) throw new RangeError('Peer message is too large');
    let decoded;
    try { decoded = JSON.parse(buffer); } catch { throw new TypeError('Peer message is not valid JSON'); }
    return validatePeerMessage(decoded);
  }
  if (!buffer || typeof buffer.byteLength !== 'number') throw new TypeError('Peer message must be bytes or a string');
  if (buffer.byteLength > maxMessageBytes) throw new RangeError('Peer message is too large');
  let message;
  try { message = JSON.parse(b4a.toString(buffer)); } catch { throw new TypeError('Peer message is not valid JSON'); }
  return validatePeerMessage(message);
}

function serializePeerMessage(message, options = {}) {
  const maxMessageBytes = options.maxMessageBytes ?? MAX_PEER_MESSAGE_BYTES;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) throw new TypeError('maxMessageBytes must be a positive integer');
  const valid = validatePeerMessage(message);
  const frame = b4a.from(JSON.stringify(valid));
  if (frame.byteLength > maxMessageBytes) throw new RangeError('Peer message is too large');
  return frame;
}

export {
  PEER_MESSAGE_TYPES,
  PEER_MESSAGE_FIELDS,
  MAX_PEER_MESSAGE_BYTES,
  MAX_CHAT_FRAME_BYTES,
  parsePeerMessage,
  serializePeerMessage
};