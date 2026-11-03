/**
 * Chat P2P service — the single data plane for the chat room.
 *
 * Runs in the Bare worker only. Owns one Hyperswarm, the topic, the role
 * (`host` | `peer` | `none`), the collaborative flag, the connection set, the
 * peer map, and the LLM provider router. It never touches the DOM; all
 * renderer-facing output is emitted through `onEvent` as `chat.event` payloads.
 *
 * Besides the legacy prompt path (`chat.send` → `query`/`response`), it carries
 * the multi-turn chat surface used by the OpenAI/Anthropic bridge:
 * `chat.request` → `chat_query` → streamed `chat_response` frames back to the
 * requester (host-local, peer, or relayed through the host).
 */
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import Hyperswarm from 'hyperswarm';
import { parsePeerMessage, serializePeerMessage, MAX_CHAT_FRAME_BYTES } from './protocol.js';
import { getDefaultModels } from '../llm/models.js';

const MAX_PEERS = 32;
const TOPIC_PATTERN = /^[0-9a-f]{64}$/;

function createChatService(options = {}) {
  const providers = options.providers;
  if (!providers || typeof providers.ask !== 'function' || typeof providers.listModels !== 'function') {
    throw new TypeError('Chat service requires a provider router with ask() and listModels()');
  }
  const swarmFactory = options.swarmFactory || ((swarmOptions) => new Hyperswarm(swarmOptions));
  const bootstrap = Array.isArray(options.bootstrap) && options.bootstrap.length > 0 ? options.bootstrap : undefined;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxPeers = Number.isSafeInteger(options.maxPeers) && options.maxPeers > 0 ? options.maxPeers : MAX_PEERS;

  const swarm = swarmFactory(bootstrap ? { bootstrap } : undefined);
  if (!swarm || typeof swarm.on !== 'function') throw new TypeError('swarmFactory must return a Hyperswarm-like instance');
  const keyPair = crypto.keyPair();
  const publicKey = b4a.toString(keyPair.publicKey, 'hex');

  const connections = new Set();
  const peers = new Map();
  const eventHandlers = new Set();

  let topic = null;
  let topicHex = null;
  let discovery = null;
  let role = 'none';
  let collaborative = false;
  let provider = null;
  let models = [];
  let messageCounter = 0;
  // Cancelled requestIds. Chunks are dropped and exactly one terminal frame is emitted,
  // so a provider that keeps generating cannot append to a bubble the user stopped.
  // No AbortController: Bare does not guarantee it, and a flag cannot fail.
  const cancelled = new Set();
  // Requests the service started and has not settled — cancel refuses unknown ids.
  const activeRequests = new Set();

  function nextId() {
    messageCounter += 1;
    return `${now().toString(36)}-${messageCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function emit(type, payload) {
    const event = { type, ...payload };
    for (const handler of eventHandlers) {
      try { handler(event); } catch { /* renderer event consumers must not break the worker */ }
    }
  }

  function onEvent(handler) {
    if (typeof handler !== 'function') throw new TypeError('onEvent requires a function');
    eventHandlers.add(handler);
    return () => eventHandlers.delete(handler);
  }

  function statusEvent() {
    return { initialized: Boolean(topicHex), topic: topicHex, role, connected: connections.size > 0, peerCount: peers.size, collaborative, provider };
  }
  function emitStatus() { emit('status', statusEvent()); }
  function peerList() {
    return [...peers.values()].map((peer) => ({ id: peer.id, displayName: peer.displayName, role: peer.isHost ? 'host' : 'peer' }));
  }
  function emitPeers() { emit('peers', { peers: peerList() }); }
  function systemMessage(content, requestId) {
    const message = { id: nextId(), type: 'system', content, timestamp: now() };
    if (requestId) message.requestId = requestId;
    emit('message', { message });
  }

  function sendTo(conn, message) {
    if (!conn || conn.destroyed) return false;
    try { conn.write(serializePeerMessage(message, { maxMessageBytes: MAX_CHAT_FRAME_BYTES })); return true; } catch { return false; }
  }
  function broadcast(message, excludeConn) {
    let sent = 0;
    for (const conn of connections) {
      if (conn === excludeConn) continue;
      if (sendTo(conn, message)) sent += 1;
    }
    return sent;
  }
  function findHostConnection() {
    for (const conn of connections) {
      const peerId = b4a.toString(conn.remotePublicKey, 'hex');
      if (peers.get(peerId)?.isHost) return conn;
    }
    // No fallback on purpose: forwarding a prompt to an arbitrary peer silently loses
    // it, and the caller's error message is more useful than a black hole.
    return null;
  }

  async function resolveProvider() {
    if (provider) return provider;
    if (typeof providers.autoSelect === 'function') {
      try {
        provider = await providers.autoSelect();
        return provider;
      } catch { /* fall through to default */ }
    }
    provider = Array.isArray(providers.providers) && providers.providers.length ? providers.providers[0] : 'ollama';
    return provider;
  }

  async function fetchModels() {
    const active = await resolveProvider();
    try {
      const list = await providers.listModels(active);
      if (Array.isArray(list) && list.length) return list;
    } catch { /* fall back to defaults */ }
    return getDefaultModels();
  }

  async function pushModels(targetConn) {
    const active = await resolveProvider();
    const list = await fetchModels();
    models = list;
    const wireModels = list.map((model) => {
      const entry = { id: model.id, name: model.name };
      if (model.created !== undefined) entry.created = model.created;
      return entry;
    });
    const frame = { type: 'models_update', models: wireModels };
    if (targetConn) sendTo(targetConn, frame); else broadcast(frame);
    emit('models', { provider: active, models: list });
    return { provider: active, models: list };
  }

  function runHostRequest(requestId, model, prompt, requesterConn) {
    activeRequests.add(requestId);
    return resolveProvider().then((active) => providers.ask(active, model, prompt, {
      onChunk: (chunk) => {
        if (!chunk || cancelled.has(requestId)) return;
        emit('response', { requestId, chunk, done: false });
        if (requesterConn) {
          sendTo(requesterConn, { type: 'response', requestId, data: chunk, isComplete: false, isJson: false, isPrivate: true, fromPeerId: publicKey });
        }
        if (collaborative) {
          broadcast({ type: 'response', requestId, data: chunk, isComplete: false, isJson: false, isPrivate: false, fromPeerId: publicKey }, requesterConn);
        }
      }
    })).then(
      () => {
        activeRequests.delete(requestId);
        if (cancelled.delete(requestId)) return; // the terminal frame was already emitted
        emit('response', { requestId, chunk: '', done: true });
        if (requesterConn) {
          sendTo(requesterConn, { type: 'response', requestId, data: '', isComplete: true, isJson: false, isPrivate: true, fromPeerId: publicKey });
        }
        if (collaborative) {
          broadcast({ type: 'response', requestId, data: '', isComplete: true, isJson: false, isPrivate: false, fromPeerId: publicKey }, requesterConn);
        }
      },
      (error) => {
        activeRequests.delete(requestId);
        if (cancelled.delete(requestId)) return;
        const message = error?.message || 'LLM request failed';
        if (requesterConn) {
          sendTo(requesterConn, { type: 'response', requestId, data: '', isComplete: true, isJson: false, isPrivate: true, fromPeerId: publicKey, error: message });
        }
        systemMessage(`Error: ${message}`, requestId);
        emit('response', { requestId, chunk: '', done: true });
        if (collaborative) {
          broadcast({ type: 'response', requestId, data: '', isComplete: true, isJson: false, isPrivate: false, fromPeerId: publicKey }, requesterConn);
        }
      }
    );
  }

  function runChatRequest(requestId, message, requesterConn) {
    activeRequests.add(requestId);
    const deliver = (frame) => {
      if (cancelled.has(requestId)) return;
      if (requesterConn) sendTo(requesterConn, { type: 'chat_response', requestId, ...frame });
      emit('chat_response', { requestId, ...frame });
    };

    const onEvent = (event) => {
      if (event.type === 'text') {
        deliver({ kind: 'text', text: event.text });
      } else if (event.type === 'tool_call') {
        const frame = { kind: 'tool_call', index: event.index, argumentsDelta: event.argumentsDelta };
        if (event.id !== undefined) frame.id = event.id;
        if (event.name !== undefined) frame.name = event.name;
        deliver(frame);
      }
      // `reasoning` events are dropped: a thinking stream would corrupt an agent
      // transcript, and Anthropic thinking blocks need signatures we cannot forge.
    };

    return resolveProvider()
      .then((active) => {
        if (typeof providers.chat !== 'function') throw new Error('Host provider does not support chat completions');
        const params = { messages: message.messages, tools: message.tools || [] };
        if (message.temperature !== undefined) params.temperature = message.temperature;
        if (message.maxTokens !== undefined) params.maxTokens = message.maxTokens;
        if (message.stop !== undefined) params.stop = message.stop;
        return providers.chat(active, message.model, params, onEvent);
      })
      .then(
        (result) => {
          activeRequests.delete(requestId);
          if (cancelled.delete(requestId)) return;
          const done = { kind: 'done', finishReason: result?.finishReason || 'stop' };
          if (result?.usage?.promptTokens !== undefined) done.promptTokens = result.usage.promptTokens;
          if (result?.usage?.completionTokens !== undefined) done.completionTokens = result.usage.completionTokens;
          deliver(done);
        },
        (error) => {
          activeRequests.delete(requestId);
          if (cancelled.delete(requestId)) return;
          const failure = error?.message || 'Chat request failed';
          deliver({ kind: 'error', error: failure });
          systemMessage(`Error: ${failure}`, requestId);
        }
      );
  }

  function handleHandshake(conn, peerId, message) {
    const existing = peers.get(peerId) || { id: peerId, conn };
    let displayName = message.displayName;
    if (displayName === 'You') displayName = `Peer${peerId.slice(0, 6)}`;
    Object.assign(existing, { displayName, clientId: message.clientId, isHost: message.isHost === true, conn });
    peers.set(peerId, existing);
    sendTo(conn, { type: 'handshake_ack', serverId: publicKey });
    sendTo(conn, { type: 'mode_update', isCollaborativeMode: collaborative, isHost: role === 'host' });
    if (role === 'host') void pushModels(conn);
    emitPeers();
    emitStatus();
    systemMessage(`Peer ${peerId.slice(0, 8)}... identified as ${displayName}`);
  }

  function handleHostQuery(peerId, message, conn) {
    if (collaborative) {
      const fromPeer = peers.get(peerId)?.displayName || `Peer${peerId.slice(0, 6)}`;
      emit('message', { message: { id: nextId(), type: 'user', content: message.prompt, fromPeer, requestId: message.requestId, timestamp: now() } });
    }
    void runHostRequest(message.requestId, message.model, message.prompt, conn);
  }

  function handleData(conn, peerId, data) {
    let message;
    try {
      message = parsePeerMessage(data, { maxMessageBytes: MAX_CHAT_FRAME_BYTES });
    } catch (error) {
      systemMessage(`Ignored malformed peer message: ${error?.message || 'invalid payload'}`);
      return;
    }
    switch (message.type) {
      case 'handshake':
        handleHandshake(conn, peerId, message);
        break;
      case 'handshake_ack':
        break;
      case 'mode_update':
        // Only the host owns the mode. A peer sends its own (initially private) state in
        // its handshake and in reply to ours, so trusting any mode_update lets a joining
        // peer silently flip the host back to private: the host then reports
        // collaborative=true from a stale broadcast while send() drops every prompt.
        if (message.isHost !== true || role === 'host') break;
        collaborative = message.isCollaborativeMode === true;
        emit('mode', { collaborative });
        systemMessage(`Host changed chat mode to ${collaborative ? 'Collaborative' : 'Private'}.`);
        break;
      case 'models_update':
        // The model list is the host's property; a peer overwriting it would make the
        // host send prompts for models it never advertised.
        if (role === 'host') break;
        models = message.models.map((entry) => ({ id: entry.id, name: entry.name, ...(entry.created !== undefined ? { created: entry.created } : {}) }));
        emit('models', { provider, models });
        systemMessage(`Received ${models.length} models from host.`);
        break;
      case 'model_request':
        if (role === 'host') void pushModels(conn);
        break;
      case 'query':
        if (role === 'host') {
          handleHostQuery(peerId, message, conn);
        } else {
          const hostConn = findHostConnection();
          if (hostConn && hostConn !== conn) sendTo(hostConn, message);
        }
        break;
      case 'response': {
        // Only the host runs the model. A peer that sends a response frame could type
        // arbitrary text into the host's transcript under any requestId it guesses.
        if (role === 'host') break;
        const payload = { requestId: message.requestId, chunk: message.data, done: message.isComplete };
        if (message.error !== undefined) payload.error = message.error;
        emit('response', payload);
        break;
      }
      case 'peer_message':
        if (collaborative) {
          emit('message', { message: { id: nextId(), type: message.messageType, content: message.content, fromPeer: message.fromPeer, requestId: message.requestId, timestamp: now() } });
        }
        break;
      case 'chat_query':
        if (role === 'host') {
          void runChatRequest(message.requestId, message, conn);
        } else {
          const hostConn = findHostConnection();
          if (hostConn && hostConn !== conn) sendTo(hostConn, message);
        }
        break;
      case 'chat_response': {
        if (role === 'host') break;
        const { type, requestId, kind, ...rest } = message;
        emit('chat_response', { requestId, kind, ...rest });
        break;
      }
      default:
        break;
    }
  }

  function handleConnection(conn) {
    if (connections.size >= maxPeers) {
      try { conn.destroy(); } catch { /* ignore */ }
      return;
    }
    const peerId = b4a.toString(conn.remotePublicKey, 'hex');
    connections.add(conn);
    if (!peers.has(peerId)) peers.set(peerId, { id: peerId, displayName: `Peer${peerId.slice(0, 6)}`, clientId: peerId, isHost: false, conn });

    conn.on('data', (data) => handleData(conn, peerId, data));
    conn.on('error', () => { /* stream errors surface as close */ });
    conn.on('close', () => {
      connections.delete(conn);
      peers.delete(peerId);
      emitStatus();
      emitPeers();
      systemMessage(`Peer disconnected: ${peerId.slice(0, 8)}...`);
    });

    sendTo(conn, { type: 'handshake', clientId: publicKey, displayName: role === 'host' ? 'Host' : 'You', timestamp: now(), isHost: role === 'host' });
    emitStatus();
    emitPeers();
    systemMessage(`New peer connected: ${peerId.slice(0, 8)}...`);
  }
  swarm.on('connection', handleConnection);

  function clearLifecycle() {
    const previousTopic = topic;
    const previousDiscovery = discovery;
    const previousConnections = [...connections];
    topic = null;
    topicHex = null;
    discovery = null;
    role = 'none';
    collaborative = false;
    models = [];
    connections.clear();
    peers.clear();

    if (previousDiscovery && typeof previousDiscovery.destroy === 'function') {
      try {
        const destroying = previousDiscovery.destroy();
        if (destroying && typeof destroying.catch === 'function') destroying.catch(() => {});
      } catch { /* ignore */ }
    } else if (previousTopic && typeof swarm.leave === 'function') {
      try { swarm.leave(previousTopic); } catch { /* ignore */ }
    }
    for (const conn of previousConnections) {
      try { conn.destroy(); } catch { /* ignore */ }
    }
    emitStatus();
    emitPeers();
  }

  async function create(params = {}) {
    clearLifecycle();
    topic = crypto.randomBytes(32);
    topicHex = b4a.toString(topic, 'hex');
    role = 'host';
    const nextDiscovery = swarm.join(topic, { server: true, client: true });
    if (!nextDiscovery) throw new Error('Hyperswarm did not create a discovery handle.');
    discovery = nextDiscovery;
    emitStatus();
    systemMessage(`Connected to Hyperswarm. Waiting for peers...\n\nP2P Topic: ${topicHex}`);
    void pushModels();
    if (typeof nextDiscovery.flushed === 'function') {
      try { await nextDiscovery.flushed(); } catch { /* announce may still settle */ }
    }
    void params;
    return { topic: topicHex, role: 'host' };
  }

  async function join(params = {}) {
    const hex = typeof params.topic === 'string' ? params.topic.toLowerCase() : '';
    if (!TOPIC_PATTERN.test(hex)) throw new Error('Invalid topic key format. It should be a 64-character hexadecimal string.');
    clearLifecycle();
    topic = b4a.from(hex, 'hex');
    topicHex = hex;
    role = 'peer';
    const nextDiscovery = swarm.join(topic, { server: true, client: true });
    if (!nextDiscovery) throw new Error('Hyperswarm did not create a discovery handle.');
    discovery = nextDiscovery;
    emitStatus();
    systemMessage(`Joining existing chat session with topic: ${topicHex}\n\nWaiting for peers...`);
    if (typeof nextDiscovery.flushed === 'function') {
      try { await nextDiscovery.flushed(); } catch { /* announce may still settle */ }
    }
    return { topic: topicHex, role: 'peer' };
  }

  function leave() {
    clearLifecycle();
    return { topic: null, role: 'none' };
  }

  function setMode(params = {}) {
    if (role !== 'host') throw new Error('Only the host can change the collaboration mode');
    collaborative = params.collaborative === true;
    broadcast({ type: 'mode_update', isCollaborativeMode: collaborative, isHost: true });
    emit('mode', { collaborative });
    return { collaborative };
  }

  async function refreshModels() {
    if (role === 'host') {
      const result = await pushModels();
      return result;
    }
    const hostConn = findHostConnection();
    if (hostConn) sendTo(hostConn, { type: 'model_request' });
    return { provider, models };
  }

  async function setProvider(params = {}) {
    if (role !== 'host') throw new Error('Only the host can change the provider');
    if (typeof params.provider !== 'string' || !params.provider) throw new Error('provider must be a non-empty string');
    provider = params.provider;
    return pushModels();
  }

  function send(params = {}) {
    const prompt = params.prompt;
    const model = params.model;
    const requestId = nextId();
    const fromPeer = role === 'host' ? 'Host' : 'You';
    emit('message', { message: { id: nextId(), type: 'user', content: prompt, fromPeer, requestId, timestamp: now() } });

    if (role === 'host') {
      if (collaborative) {
        broadcast({ type: 'peer_message', messageType: 'user', content: prompt, fromPeer: 'Host', requestId });
      }
      void runHostRequest(requestId, model, prompt, null);
      return { requestId };
    }

    const hostConn = findHostConnection();
    if (!hostConn) throw new Error('Not connected to a host');
    sendTo(hostConn, { type: 'query', model, prompt, requestId, fromPeerId: publicKey });
    return { requestId };
  }

  // Multi-turn chat used by the HTTP bridge. On the host it answers locally; on
  // a peer it forwards the frame to the host and streams `chat_response` frames
  // back through `onEvent`.
  function requestChat(params = {}) {
    const requestId = nextId();
    const frame = { type: 'chat_query', requestId, model: params.model, messages: params.messages, fromPeerId: publicKey };
    if (params.tools !== undefined) frame.tools = params.tools;
    if (params.temperature !== undefined) frame.temperature = params.temperature;
    if (params.maxTokens !== undefined) frame.maxTokens = params.maxTokens;
    if (params.stop !== undefined) frame.stop = params.stop;

    if (role === 'host') {
      void runChatRequest(requestId, frame, null);
      return { requestId };
    }

    const hostConn = findHostConnection();
    if (!hostConn) throw new Error('Not connected to a host');
    sendTo(hostConn, frame);
    return { requestId };
  }

  // Stops one in-flight request. The provider keeps running in the background; its
  // chunks are dropped, so the transcript stops where the user clicked.
  function cancelRequest(params = {}) {
    const requestId = params.requestId;
    if (typeof requestId !== 'string' || !requestId) throw new Error('requestId must be a non-empty string');
    if (!activeRequests.has(requestId) || cancelled.has(requestId)) return { cancelled: false };
    cancelled.add(requestId);
    systemMessage('Request cancelled.', requestId);
    emit('response', { requestId, chunk: '', done: true });
    return { cancelled: true };
  }

  const methods = Object.freeze({
    'chat.status': () => ({ ...statusEvent(), publicKey }),
    'chat.create': (params) => create(params),
    'chat.join': (params) => join(params),
    'chat.leave': () => leave(),
    'chat.peers': () => ({ peers: peerList() }),
    'chat.send': (params) => send(params),
    'chat.cancel': (params) => cancelRequest(params),
    'chat.request': (params) => requestChat(params),
    'chat.setMode': (params) => setMode(params),
    'chat.refreshModels': () => refreshModels(),
    'chat.setProvider': (params) => setProvider(params)
  });

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      clearLifecycle();
      eventHandlers.clear();
      try {
        if (typeof swarm.destroy === 'function') await swarm.destroy();
      } catch { /* ignore */ }
    })();
    return closing;
  }

  return Object.freeze({ methods, onEvent, close, publicKey, get topic() { return topicHex; }, get role() { return role; } });
}

export { MAX_PEERS, createChatService };