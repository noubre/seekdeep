/**
 * Terminal application for the in-process worker backend.
 *
 * Process-agnostic: `tui.js` owns signals and the backend lifecycle. This
 * module wires a `client` (the real RPC client or a fake) to a renderer, a
 * readline interface, and the TUI-local command set.
 */
import readline from 'node:readline';
import { createClientState } from '../session/client-state.js';
import { clear as clearMessages } from '../messages/store.js';
import { applyAssistantChunk } from '../messages/stream.js';
import { createRenderer } from './render.js';
import { createTheme } from './theme.js';
import { classify, TUI_COMMANDS } from './commands.js';

const TUI_HELP = [
  'TUI commands:',
  ...TUI_COMMANDS.map((name) => `  /${name}`),
  '  /model <name|index>   select a model from /models',
  '  /provider <name>      ollama or lmstudio (host only)',
  '  /join <64hex topic>   join a room',
  ''
].join('\n');

const TOPIC_PATTERN = /^[0-9a-f]{64}$/i;

function modelName(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.name || entry.id || String(entry);
  return String(entry);
}

function createTui(options = {}) {
  const client = options.client;
  if (!client || typeof client.request !== 'function' || typeof client.on !== 'function') {
    throw new TypeError('TUI requires a client with request() and on()');
  }
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const args = options.args || {};
  const depth = options.depth ?? 'truecolor';
  const makeReadline = options.readline || ((opts) => readline.createInterface(opts));

  const theme = createTheme(depth);
  const renderer = createRenderer({
    write: (text) => output.write(text),
    depth,
    animate: Boolean(output.isTTY),
    interactive: Boolean(output.isTTY),
    columns: output.columns
  });
  const clientState = createClientState();

  let model = args.model ?? null;
  let rl = null;
  let stopped = false;
  let streamRequestId = null;
  let runResolve = null;
  let bootPromise = null;
  const run = new Promise((resolve) => { runResolve = resolve; });

  function currentState() {
    return { ...clientState.getState(), model };
  }

  function prompt() {
    if (!stopped && rl) rl.prompt();
  }

  function startStream(requestId) {
    streamRequestId = requestId;
    renderer.assistantStart();
    if (rl) rl.pause();
  }

  function endStream() {
    streamRequestId = null;
    renderer.assistantEnd();
    if (rl) {
      rl.resume();
      prompt();
    }
  }

  function applyResponse(event) {
    const { requestId, chunk, done } = event;
    if (streamRequestId !== requestId) startStream(requestId);
    if (chunk) renderer.assistantChunk(chunk);
    applyAssistantChunk(event);
    if (done) endStream();
  }

  function applyMessage(event) {
    const message = event.message;
    if (!message) return;
    const content = message.content ?? '';
    if (message.type === 'system') {
      renderer.system(content);
      return;
    }
    const fromPeer = message.fromPeer;
    if (typeof fromPeer === 'string' && fromPeer && fromPeer !== 'You' && fromPeer !== 'Host') {
      renderer.peer(fromPeer, content);
      return;
    }
    renderer.user(content);
  }

  function onChatEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    clientState.applyEvent(event);
    if (event.type === 'response') applyResponse(event);
    else if (event.type === 'message') applyMessage(event);
  }

  function listModels() {
    const models = clientState.getState().models;
    return Array.isArray(models) ? models : [];
  }

  function showModels() {
    const models = listModels();
    if (!models.length) {
      renderer.system('No models available. Is your provider running?');
      return;
    }
    models.forEach((entry, index) => renderer.system(`${index + 1}. ${modelName(entry)}`));
  }

  function selectModel(arg) {
    if (!arg) {
      renderer.error('Usage: /model <name|index>');
      return;
    }
    const models = listModels();
    let resolved = null;
    if (/^\d+$/.test(arg)) {
      const index = Number(arg) - 1;
      if (index >= 0 && index < models.length) resolved = modelName(models[index]);
    }
    if (resolved === null) {
      const match = models.find((entry) => modelName(entry) === arg || (entry && entry.id === arg));
      if (match) resolved = modelName(match);
    }
    if (resolved === null) {
      renderer.error(`Unknown model: ${arg}`);
      return;
    }
    model = resolved;
    renderer.system(`Model set to ${resolved}`);
  }

  async function guarded(label, fn) {
    try {
      await fn();
    } catch (error) {
      if (!stopped) renderer.error(`${label}: ${error?.message || error}`);
    }
  }

  async function runLocal(parsed) {
    switch (parsed.name) {
      case 'quit':
      case 'exit':
        stop();
        return;
      case 'tui':
        renderer.ephemeral(TUI_HELP, { kind: 'slash-help' });
        break;
      case 'status':
        renderer.status(currentState());
        break;
      case 'models':
        showModels();
        break;
      case 'model':
        selectModel(parsed.args[0]);
        break;
      case 'provider':
        if (parsed.args.length !== 1) {
          renderer.error('Usage: /provider <ollama|lmstudio>');
          break;
        }
        await guarded('Provider error', () => client.request('chat.setProvider', { provider: parsed.args[0] }));
        break;
      case 'join': {
        const topic = (parsed.args[0] || '').toLowerCase();
        if (!TOPIC_PATTERN.test(topic)) {
          renderer.error('Usage: /join <64hex topic>');
          break;
        }
        await guarded('Join failed', () => client.request('chat.join', { topic }));
        break;
      }
      case 'leave':
        await guarded('Leave failed', () => client.request('chat.leave', {}));
        break;
      case 'clear':
        clearMessages();
        if (output.isTTY) output.write('\x1b[2J\x1b[H');
        break;
      default:
        renderer.error(`Unknown TUI command: /${parsed.name}`);
        break;
    }
    prompt();
  }

  async function submit(text) {
    if (stopped) return;
    if (bootPromise) { try { await bootPromise; } catch { /* boot reports its own errors */ } }
    if (stopped) return;
    const parsed = classify(text);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'prompt') {
      if (!model) {
        renderer.system('No model selected; run /models then /model <name>.');
        prompt();
        return;
      }
      await guarded('Send failed', () => client.request('chat.send', { prompt: text, model }));
      prompt();
      return;
    }
    if (parsed.kind === 'slash') {
      await guarded('Slash command failed', () => client.request('slash.dispatch', { text: parsed.raw }));
      prompt();
      return;
    }
    await runLocal(parsed);
  }

  async function boot() {
    renderer.banner({ storage: args.storage, topic: args.topic ? String(args.topic) : null });
    try {
      await client.request('chat.status', {});
      if (args.topic) await client.request('chat.join', { topic: args.topic });
      else await client.request('chat.create', {});
    } catch (error) {
      if (!stopped) renderer.error(`Room setup failed: ${error?.message || error}`);
    }
    await guarded('Model list unavailable', () => client.request('chat.refreshModels', {}));
    if (args.provider) {
      await guarded('Provider error', () => client.request('chat.setProvider', { provider: args.provider }));
    }
    if (stopped) return;
    prompt();
  }

  function start() {
    client.on('chat.event', onChatEvent);
    client.on('harness.event', (event) => {
      if (event && event.type === 'slash') renderer.ephemeral(event.content, event.metadata);
      else renderer.harness(event);
    });

    if (!stopped) {
      rl = makeReadline({ input, output, terminal: Boolean(output.isTTY), prompt: theme.prompt });
      rl.on('line', (line) => void submit(line));
      rl.on('close', () => stop());
    }

    bootPromise = boot();
    return run;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rl) {
      try { rl.close(); } catch { /* already closed */ }
    }
    if (typeof client.close === 'function') {
      try { client.close(); } catch { /* ignore */ }
    }
    if (runResolve) runResolve();
  }

  return {
    start,
    submit,
    stop,
    get state() { return currentState(); },
    get ready() { return bootPromise; }
  };
}

export { createTui, TUI_HELP };
