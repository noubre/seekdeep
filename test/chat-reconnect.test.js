/**
 * A peer whose host vanishes must say so and re-announce on the same topic until the
 * host's handshake returns — or give up with instructions, never silently.
 */
import test from 'brittle';
import b4a from 'b4a';
import { createChatService } from '../js/p2p/chat-service.js';
import { parsePeerMessage } from '../js/p2p/protocol.js';

const FRAME_LIMIT = 4 * 1024 * 1024;

function stubProviders() {
  return {
    providers: ['ollama'],
    async autoSelect() { return 'ollama'; },
    async listModels() { return [{ id: 'host:1', name: 'Host 1' }]; },
    async ask() { return 'unused'; },
    async chat() { return { text: 'unused', toolCalls: [], finishReason: 'stop', usage: {} }; }
  };
}

/** Minimal Hyperswarm stand-in that records every join so a test can assert the re-announce. */
function fakeSwarm() {
  const swarm = {
    joinCalls: [],
    on(event, handler) { if (event === 'connection') swarm.connection = handler; return swarm; },
    join(topic, options) {
      swarm.joinCalls.push({ topic, options });
      return { flushed: async () => {}, destroy: async () => {} };
    },
    leave() {},
    async destroy() {},
    connect(conn) { swarm.connection(conn); }
  };
  return swarm;
}

/** Minimal Hypercore stream stand-in: parses what the service writes, injects what a peer sends. */
function fakeConn(hexKey) {
  const listeners = {};
  const written = [];
  return {
    remotePublicKey: b4a.from(hexKey, 'hex'),
    destroyed: false,
    written,
    on(event, handler) { listeners[event] = handler; return this; },
    off() { return this; },
    write(buffer) { written.push(parsePeerMessage(buffer, { maxMessageBytes: FRAME_LIMIT })); return true; },
    destroy() { this.destroyed = true; },
    send(message) { listeners.data(b4a.from(JSON.stringify(message))); },
    close() {
      this.destroyed = true;
      if (listeners.close) listeners.close();
    }
  };
}

/** Deterministic scheduler: nothing fires unless the test runs it, so no real sleeps. */
function fakeScheduler() {
  const pending = [];
  return {
    schedule(fn, ms) {
      const timer = { fn, ms, cancelled: false };
      pending.push(timer);
      return timer;
    },
    cancel(timer) {
      if (timer) timer.cancelled = true;
    },
    runNext() {
      const timer = pending.find((entry) => !entry.cancelled);
      if (!timer) return false;
      timer.cancelled = true;
      timer.fn();
      return true;
    },
    pendingCount() {
      return pending.filter((entry) => !entry.cancelled).length;
    }
  };
}

/** Lets an async rejoin (discovery flush + the `.then` that arms the next attempt) settle. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function startPeer(t, { maxReconnectAttempts }) {
  const swarm = fakeSwarm();
  const clock = fakeScheduler();
  const service = createChatService({
    providers: stubProviders(),
    swarmFactory: () => swarm,
    now: () => 1,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    reconnectIntervalMs: 2000,
    maxReconnectAttempts
  });
  const events = [];
  service.onEvent((event) => events.push(event));
  t.teardown(async () => { await service.close(); });

  await service.methods['chat.join']({ topic: 'cd'.repeat(32) });
  const host = fakeConn('ab'.repeat(32));
  swarm.connect(host);
  host.send({ type: 'handshake', clientId: 'host', displayName: 'Host', timestamp: 1, isHost: true });
  return { swarm, clock, service, events, host };
}

test('a peer detects host loss and rejoins the same topic', async function (t) {
  const { swarm, clock, events, host } = await startPeer(t, { maxReconnectAttempts: 5 });
  t.is(swarm.joinCalls.length, 1, 'the initial join announced once');
  t.is(clock.pendingCount(), 0, 'no re-announce while the host is here');

  host.close();

  t.ok(events.some((event) => event.type === 'host' && event.connected === false), 'host-loss event emitted');
  t.ok(
    events.some((event) => event.type === 'message' && event.message.content === 'Host disconnected. Reconnecting...'),
    'a system line tells the user the host dropped'
  );
  t.is(clock.pendingCount(), 1, 'a re-announce is scheduled');

  clock.runNext();
  await settle();

  t.is(swarm.joinCalls.length, 2, 'the service re-announced');
  t.alike(swarm.joinCalls[1].topic, b4a.from('cd'.repeat(32), 'hex'), 'same topic as the original join');
  t.alike(swarm.joinCalls[1].options, { server: true, client: true }, 'same join options as join()');
  t.is(clock.pendingCount(), 1, 'the next attempt is armed until the host answers');

  const reconnected = fakeConn('ef'.repeat(32));
  swarm.connect(reconnected);
  reconnected.send({ type: 'handshake', clientId: 'host-again', displayName: 'Host', timestamp: 2, isHost: true });

  t.ok(events.some((event) => event.type === 'host' && event.connected === true), 'host-restore event emitted');
  t.ok(
    events.some((event) => event.type === 'message' && event.message.content === 'Reconnected to the host.'),
    'a system line tells the user the host is back'
  );
  t.is(clock.pendingCount(), 0, 'no further re-joins are scheduled');

  const joinsAfterRestore = swarm.joinCalls.length;
  t.is(clock.runNext(), false, 'nothing left to run');
  await settle();
  t.is(swarm.joinCalls.length, joinsAfterRestore, 'no re-join after the host returned');
});

test('a first-time host handshake is not reported as a reconnection', async function (t) {
  const { swarm, clock, events } = await startPeer(t, { maxReconnectAttempts: 5 });

  t.ok(
    !events.some((event) => event.type === 'message' && event.message.content === 'Reconnected to the host.'),
    'the first host handshake is just a join'
  );
  t.is(clock.pendingCount(), 0);
  t.is(swarm.joinCalls.length, 1);
});

test('a peer gives up after the attempt budget and says how to recover', async function (t) {
  const { swarm, clock, events, host } = await startPeer(t, { maxReconnectAttempts: 2 });

  host.close();
  clock.runNext();
  await settle();
  clock.runNext();
  await settle();

  t.is(swarm.joinCalls.length, 3, 'initial join plus two attempts');
  t.is(clock.pendingCount(), 0, 'the loop stops at the budget');
  t.ok(
    events.some((event) => event.type === 'message' && /Check the topic key and re-join/.test(event.message.content)),
    'exhaustion tells the user what to do'
  );
});

test('closing the service cancels a pending re-announce', async function (t) {
  const { swarm, clock, service, host } = await startPeer(t, { maxReconnectAttempts: 5 });

  host.close();
  t.is(clock.pendingCount(), 1, 'a re-announce is pending');

  await service.close();
  t.is(clock.pendingCount(), 0, 'close cleared the timer');
  const joins = swarm.joinCalls.length;
  clock.runNext();
  await settle();
  t.is(swarm.joinCalls.length, joins, 'no re-join after close');
});
