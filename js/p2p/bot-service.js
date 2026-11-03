/**
 * Peer bot service.
 *
 * Harnesses that share a 64-hex harness key join a Hyperswarm topic derived
 * from that key and exchange newline-delimited JSON messages. Incoming peer
 * messages are answered by the local LLM unless the message was itself produced
 * by a bot (`bot: true`), which prevents reply loops between two harnesses.
 */
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import Hyperswarm from 'hyperswarm';

const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const REPLY_COOLDOWN_MS = 5000;
const MAX_REPLIES_PER_PEER = 20;
const DEFAULT_MAX_PEERS = 16;
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024;
const BOT_SYSTEM_PROMPT = 'You are a SeekDeep peer bot. Reply to the peer message in one or two sentences.';

function createBotService(options = {}) {
  const key = options.key;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new TypeError('Bot service requires a 64-character hexadecimal harness key');
  }
  const providers = options.providers || null;
  const displayName = options.displayName || `bot-${key.slice(0, 8)}`;
  const model = options.model || null;
  const maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const swarmFactory = options.swarmFactory || (() => new Hyperswarm({ maxPeers }));
  const clock = options.now || (() => Date.now());
  const topic = crypto.data(b4a.from(key, 'hex'));
  const selfId = b4a.toString(crypto.randomBytes(16), 'hex');

  const handlers = new Set();
  const connections = new Map();
  const peers = new Map();
  let swarm = null;
  let discovery = null;
  let enabled = false;

  function emit(event) {
    for (const handler of handlers) {
      try { handler(event); } catch {}
    }
  }

  function onEvent(handler) {
    if (typeof handler !== 'function') throw new TypeError('onEvent requires a function');
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function writeFrame(socket, frame) {
    try {
      const line = `${JSON.stringify(frame)}\n`;
      if (b4a.byteLength(line) > maxMessageBytes) return;
      socket.write(line);
    } catch {}
  }

  function status() {
    return {
      available: true,
      enabled,
      key,
      topic: b4a.toString(topic, 'hex'),
      name: displayName,
      peers: peers.size
    };
  }

  async function generateReply(text) {
    if (!providers) throw new Error('No provider is configured for bot replies');
    const provider = typeof providers.autoSelect === 'function' ? await providers.autoSelect() : null;
    if (!provider) throw new Error('No LLM provider is available for bot replies');
    let resolvedModel = model;
    if (!resolvedModel && typeof providers.listModels === 'function') {
      const models = await providers.listModels(provider);
      resolvedModel = Array.isArray(models) ? models[0] : null;
    }
    if (!resolvedModel) throw new Error('No model is available for bot replies');
    let collected = '';
    const params = {
      messages: [
        { role: 'system', content: BOT_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    };
    const result = await providers.chat(provider, resolvedModel, params, (event) => {
      if (event?.kind === 'text' && typeof event.text === 'string') collected += event.text;
    });
    if (!collected && typeof result === 'string') collected = result;
    if (!collected && typeof result?.content === 'string') collected = result.content;
    if (!collected) throw new Error('The model returned an empty reply');
    return collected;
  }

  async function handleFrame(frame, conn) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.t === 'hello') {
      if (typeof frame.id === 'string' && frame.id) {
        conn.id = frame.id;
        conn.name = typeof frame.name === 'string' ? frame.name : null;
        peers.set(conn.id, conn);
      }
      emit({ type: 'peer', status: 'hello', id: conn.id, name: conn.name });
      return;
    }
    if (frame.t !== 'msg') return;
    const text = typeof frame.text === 'string' ? frame.text : '';
    const from = conn.id || (typeof frame.from === 'string' ? frame.from : 'peer');
    emit({ type: 'message', from, fromName: conn.name, text, bot: frame.bot === true });

    // Loop guard: never answer a bot-authored message.
    if (frame.bot === true || !enabled || !text.trim()) return;
    if (conn.replies >= MAX_REPLIES_PER_PEER) return;
    if (clock() - conn.lastReplyAt < REPLY_COOLDOWN_MS) return;
    conn.replies += 1;
    conn.lastReplyAt = clock();

    try {
      const reply = await generateReply(text);
      writeFrame(conn.socket, { t: 'msg', id: selfId, from: selfId, fromName: displayName, text: reply, bot: true, ts: clock() });
      emit({ type: 'reply', from, text: reply });
    } catch (error) {
      emit({ type: 'error', from, message: error.message });
    }
  }

  function onConnection(socket) {
    const conn = { socket, id: null, name: null, replies: 0, lastReplyAt: 0 };
    connections.set(socket, conn);
    let buffer = '';
    const onData = (chunk) => {
      if (!enabled) return;
      buffer += b4a.toString(chunk);
      if (b4a.byteLength(buffer) > maxMessageBytes * 4) buffer = '';
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        void handleFrame(frame, conn);
      }
    };
    const onClose = () => {
      socket.off?.('data', onData);
      connections.delete(socket);
      if (conn.id) peers.delete(conn.id);
      emit({ type: 'peer', status: 'closed', id: conn.id });
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    socket.on('close', onClose);
    writeFrame(socket, { t: 'hello', id: selfId, name: displayName, ts: clock() });
    emit({ type: 'peer', status: 'connected' });
  }

  async function enable() {
    if (enabled) return status();
    swarm = swarmFactory();
    if (!swarm || typeof swarm.on !== 'function' || typeof swarm.join !== 'function') {
      throw new TypeError('swarmFactory must return a Hyperswarm-compatible instance');
    }
    swarm.on('connection', onConnection);
    discovery = swarm.join(topic, { server: true, client: true });
    if (typeof discovery?.flushed === 'function') {
      try { await discovery.flushed(); } catch {}
    }
    enabled = true;
    emit({ type: 'status', ...status() });
    return status();
  }

  async function disable() {
    if (!enabled) return status();
    enabled = false;
    for (const conn of connections.values()) {
      try { conn.socket.destroy?.(); } catch {}
    }
    connections.clear();
    peers.clear();
    try { await discovery?.destroy?.(); } catch {}
    discovery = null;
    try { await swarm?.destroy?.(); } catch {}
    swarm = null;
    emit({ type: 'status', ...status() });
    return status();
  }

  async function send(peerRef, text) {
    const conn = peers.get(peerRef);
    if (!conn) throw new Error(`Unknown bot peer: ${String(peerRef)}`);
    if (typeof text !== 'string' || !text) throw new Error('Bot message text is required');
    if (b4a.byteLength(text) > maxMessageBytes) throw new RangeError('Bot message is too large');
    writeFrame(conn.socket, { t: 'msg', id: selfId, from: selfId, fromName: displayName, text, bot: true, ts: clock() });
    emit({ type: 'sent', to: peerRef, text });
    return { to: peerRef, delivered: true };
  }

  async function broadcast(text) {
    if (typeof text !== 'string' || !text) throw new Error('Bot message text is required');
    let delivered = 0;
    for (const [ref, conn] of peers) {
      try { await send(ref, text); delivered += 1; } catch {}
    }
    return { delivered };
  }

  function peersList() {
    return Array.from(peers, ([id, conn]) => ({ id, name: conn.name }));
  }

  async function close() {
    await disable();
    handlers.clear();
  }

  return Object.freeze({
    methods: Object.freeze({
      status,
      enable,
      disable,
      peers: peersList,
      send,
      broadcast
    }),
    onEvent,
    status,
    peers: peersList,
    enable,
    disable,
    send,
    broadcast,
    close,
    get enabled() { return enabled; }
  });
}

export { createBotService, BOT_SYSTEM_PROMPT, REPLY_COOLDOWN_MS, MAX_REPLIES_PER_PEER };