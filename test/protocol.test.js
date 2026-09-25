import test from 'brittle';
import b4a from 'b4a';
import {
  PEER_MESSAGE_TYPES,
  PEER_MESSAGE_FIELDS,
  MAX_PEER_MESSAGE_BYTES,
  parsePeerMessage,
  serializePeerMessage
} from '../js/p2p/protocol.js';

const samples = {
  handshake: { type: 'handshake', clientId: 'abc123', displayName: 'Peer1', timestamp: 1, isHost: true },
  handshake_ack: { type: 'handshake_ack', serverId: 'server-1' },
  mode_update: { type: 'mode_update', isCollaborativeMode: true, isHost: false },
  models_update: { type: 'models_update', models: [{ id: 'llama2:7b', name: 'Llama 2', modified_at: '2024-01-01' }] },
  model_request: { type: 'model_request' },
  query: { type: 'query', model: 'llama2:7b', prompt: 'hi', requestId: 'req-1', fromPeerId: 'peer-2' },
  response: { type: 'response', requestId: 'req-1', data: 'hello', isComplete: false, isJson: false, isPrivate: true },
  peer_message: { type: 'peer_message', messageType: 'user', content: 'hi there', fromPeer: 'Host', requestId: 'req-1' }
};

test('every peer message type round-trips through serialize/parse', async function (t) {
  t.alike(PEER_MESSAGE_TYPES.slice().sort(), Object.keys(samples).sort());
  for (const type of PEER_MESSAGE_TYPES) {
    const sample = samples[type];
    const bytes = serializePeerMessage(sample);
    t.ok(b4a.isBuffer(bytes) || bytes instanceof Uint8Array, `${type} serializes to bytes`);
    t.alike(parsePeerMessage(bytes), sample, `${type} round-trips`);
    t.alike(parsePeerMessage(JSON.stringify(sample)), sample, `${type} parses from a string`);
  }
});

test('optional fields are permitted but not required', async function (t) {
  const query = { type: 'query', model: 'm', prompt: 'p', requestId: 'r' };
  t.alike(parsePeerMessage(serializePeerMessage(query)), query);
  const response = { type: 'response', requestId: 'r', data: '', isComplete: true, isJson: false, isPrivate: false, fromPeerId: 'p' };
  t.alike(parsePeerMessage(serializePeerMessage(response)), response);
});

test('unknown types, extra fields, and missing fields are rejected', async function (t) {
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'nope' })), /Unknown peer message type/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'model_request', extra: 1 })), /unsupported field/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'handshake', clientId: 'a', displayName: 'b', timestamp: 1 })), /missing required field: isHost/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'response', requestId: 'r', data: 'x', isComplete: true, isJson: false })), /missing required field: isPrivate/i);
});

test('requestId must be a non-empty string of at most 64 characters', async function (t) {
  const base = { type: 'query', model: 'm', prompt: 'p' };
  t.exception.all(() => parsePeerMessage(serializeRaw({ ...base, requestId: '' })), /requestId/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ ...base, requestId: 42 })), /requestId/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ ...base, requestId: 'x'.repeat(65) })), /requestId/i);
  t.alike(parsePeerMessage(serializeRaw({ ...base, requestId: 'x'.repeat(64) })).requestId, 'x'.repeat(64));
});

test('payloads over the byte limit are rejected', async function (t) {
  const big = { type: 'query', model: 'm', prompt: 'x'.repeat(MAX_PEER_MESSAGE_BYTES + 1), requestId: 'r' };
  t.exception.all(() => parsePeerMessage(serializeRaw(big)), /too large/i);
  t.exception.all(() => parsePeerMessage(b4a.from(JSON.stringify(big)), { maxMessageBytes: 64 }), /too large/i);
});

test('non-JSON, non-object, and malformed model payloads are rejected', async function (t) {
  t.exception.all(() => parsePeerMessage(b4a.from('{not json')), /valid JSON/i);
  t.exception.all(() => parsePeerMessage(b4a.from('"hello"')), /plain object/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'models_update', models: [{ id: 'a' }] })), /name/i);
  t.exception.all(() => parsePeerMessage(serializeRaw({ type: 'models_update', models: [{ id: 'a', name: 'b', extra: true }] })), /unsupported field/i);
});

function serializeRaw(message) {
  return b4a.from(JSON.stringify(message));
}