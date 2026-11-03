import test from 'brittle';
import { createInitialRoom } from '../js/ui/startup.js';

test('initial room reconciles authoritative status into client state', async function (t) {
  const applied = [];
  const errors = [];
  const chatClient = {
    api: {
      async create() { return { topic: 'cd'.repeat(32), role: 'host' }; },
      async status() {
        return {
          topic: 'cd'.repeat(32),
          role: 'host',
          connected: false,
          peerCount: 0,
          collaborative: false,
          provider: 'ollama'
        };
      }
    }
  };

  const result = await createInitialRoom({
    chatClient,
    applyEvent: (event) => applied.push(event),
    reportError: (message) => errors.push(message)
  });

  t.ok(result.ok);
  t.is(applied.length, 2, 'create fallback then authoritative status');
  t.alike(applied[0], {
    type: 'status',
    topic: 'cd'.repeat(32),
    role: 'host'
  }, 'created room identity is applied before reconciliation');
  t.alike(applied[1], {
    type: 'status',
    topic: 'cd'.repeat(32),
    role: 'host',
    connected: false,
    peerCount: 0,
    collaborative: false,
    provider: 'ollama'
  }, 'authoritative status reconciles the fallback');
  t.alike(errors, []);
});

test('created room survives a status failure without being reported as a creation failure', async function (t) {
  const applied = [];
  const errors = [];
  const room = { topic: 'ab'.repeat(32), role: 'host' };
  const result = await createInitialRoom({
    chatClient: {
      api: {
        async create() { return room; },
        async status() { throw new Error('status pipe closed'); }
      }
    },
    applyEvent: (event) => applied.push(event),
    reportError: (message) => errors.push(message)
  });

  t.absent(result.ok, 'startup reconciliation did not complete');
  t.is(result.phase, 'status', 'the failing phase is identifiable');
  t.ok(result.roomCreated, 'the room creation is distinguishable from a failure');
  t.alike(result.room, room, 'the known room result is preserved');
  t.alike(applied, [{ type: 'status', topic: room.topic, role: room.role }],
    'known room identity stays applied so the key remains visible');
  t.alike(errors, ['Could not read the chat room status: status pipe closed'],
    'only the status failure is reported');
});

test('initial room failure is reported for GUI rendering', async function (t) {
  const applied = [];
  const errors = [];
  const result = await createInitialRoom({
    chatClient: { api: { async create() { throw new Error('worker unavailable'); } } },
    applyEvent: (event) => applied.push(event),
    reportError: (message) => errors.push(message)
  });

  t.absent(result.ok);
  t.is(result.phase, 'create');
  t.alike(applied, []);
  t.alike(errors, ['Could not create a chat room: worker unavailable']);
});