import test from 'brittle';
import { createChatService } from '../js/p2p/chat-service.js';

function stubProviders() {
  return {
    providers: ['ollama'],
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'stub:1', name: 'Stub 1' }]; },
    // Emits one chunk, then hangs: a model mid-generation.
    ask(provider, model, prompt, options = {}) {
      options.onChunk?.('first');
      return new Promise(() => {});
    },
    async chat() { return { text: '', toolCalls: [], finishReason: 'stop', usage: {} }; }
  };
}

const swarm = {
  on() {},
  join() { return { flushed: async () => {}, destroy: async () => {} }; },
  leave() {},
  async destroy() {}
};

async function waitFor(predicate, message, timeout = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('chat.cancel ends the stream for one requestId', async function (t) {
  const service = createChatService({ providers: stubProviders(), swarmFactory: () => swarm, now: () => 1 });
  t.teardown(async () => { await service.close(); });
  const events = [];
  service.onEvent((event) => events.push(event));

  await service.methods['chat.create']({});
  const sent = service.methods['chat.send']({ prompt: 'hi', model: 'stub:1' });
  await waitFor(() => events.some((e) => e.type === 'response' && e.requestId === sent.requestId && !e.done), 'first chunk');

  t.alike(service.methods['chat.cancel']({ requestId: sent.requestId }), { cancelled: true });
  await waitFor(() => events.some((e) => e.type === 'response' && e.requestId === sent.requestId && e.done), 'terminal frame');

  t.alike(service.methods['chat.cancel']({ requestId: sent.requestId }), { cancelled: false }, 'second cancel is a no-op');
  t.ok(
    events.some((e) => e.type === 'message' && e.message.content === 'Request cancelled.'),
    'a system message explains why the answer stopped'
  );
});
