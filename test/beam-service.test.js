import test from 'brittle';
import { Duplex } from 'node:stream';
import { createBeamService } from '../js/p2p/beam-service.js';

class FakeBeam extends Duplex {
  static waiting = new Map();

  constructor(key, opts) {
    super({ read() {} });
    // Match hyperbeam 3.1.0's argument normalization exactly:
    // a non-string first argument is treated as the options object.
    if (typeof key !== 'string') {
      opts = key;
      key = null;
    }
    const announce = opts && typeof opts === 'object' ? opts.announce : undefined;
    this._announce = announce !== undefined ? announce : (key === null || key === undefined);
    this.key = key || (this._announce ? 'a'.repeat(52) : undefined);
    if (!this.key) {
      // When connecting with a key, use the provided key
      this.key = key;
    }
    this.connected = false;
    this.peer = null;
    this.destroyCalls = 0;
    const lookupKey = this.key;
    if (!lookupKey) return;
    const waiting = FakeBeam.waiting.get(lookupKey);
    if (waiting) {
      FakeBeam.waiting.delete(lookupKey);
      this.peer = waiting;
      waiting.peer = this;
      this.connected = waiting.connected = true;
      queueMicrotask(() => { this.emit('connected'); waiting.emit('connected'); });
    } else {
      FakeBeam.waiting.set(lookupKey, this);
    }
  }

  _write(chunk, _encoding, callback) {
    if (!this.peer || this.peer.destroyed) return callback(new Error('not connected'));
    this.peer.push(Buffer.from(chunk));
    callback();
  }

  _destroy(error, callback) {
    this.destroyCalls += 1;
    if (FakeBeam.waiting.get(this.key) === this) FakeBeam.waiting.delete(this.key);
    callback(error);
  }
}

test('beam service creates and joins a real duplex capability without leaking it from descriptors', async function (t) {
  FakeBeam.waiting.clear();
  const dhtFactory = () => ({ destroy: async () => {} });
  const left = createBeamService({ Hyperbeam: FakeBeam, idFactory: () => 'beam-left', dhtFactory });
  const right = createBeamService({ Hyperbeam: FakeBeam, idFactory: () => 'beam-right', dhtFactory });
  t.teardown(() => Promise.all([left.close(), right.close()]));

  const created = await left.create('sender');
  t.is(created.key, 'a'.repeat(52), 'create returns capability exactly where it is needed for sharing');
  t.absent(JSON.stringify(created.descriptor).includes(created.key));
  const joined = await right.join('receiver', created.key);
  t.absent(Object.hasOwn(joined, 'key'), 'join result does not echo secret capability material');
  await new Promise((resolve) => setImmediate(resolve));

  await left.send('sender', 'hello beam');
  t.alike(await right.receive('receiver'), { messages: ['hello beam'], bytes: 10, pending: 0 });
  t.alike(await right.receive('receiver'), { messages: [], bytes: 0, pending: 0 }, 'receive drains queued messages');

  const status = await left.status('sender');
  t.is(status.status, 'open');
  t.is(status.sentMessages, 1);
  t.is(status.sentBytes, 10);
  t.absent(JSON.stringify(await left.list()).includes(created.key));
});

test('beam service validates keys and payloads, caps queues, and closes every active stream on shutdown', async function (t) {
  FakeBeam.waiting.clear();
  const beams = [];
  class TrackingBeam extends FakeBeam {
    constructor(key, opts) { super(key, opts); beams.push(this); }
  }
  let next = 0;
  const dhtFactory = () => ({ destroy: async () => {} });
  const service = createBeamService({ Hyperbeam: TrackingBeam, idFactory: () => `beam-${++next}`, maxPendingMessages: 1, dhtFactory });

  await t.exception.all(() => service.join('bad', 'not-a-key'), /52-character/i);
  const one = await service.create('one');
  const peer = new TrackingBeam(one.key);
  t.teardown(() => peer.destroy());
  await new Promise((resolve) => setImmediate(resolve));
  peer.write(Buffer.from('not-framed\n'));
  await new Promise((resolve) => setImmediate(resolve));
  t.is((await service.status('one')).status, 'error', 'malformed incoming wire data closes the beam safely');

  await service.create('two');
  await service.close();
  t.ok(beams.filter((beam) => beam !== peer).every((beam) => beam.destroyed), 'shutdown destroys all owned beam streams');
  await t.exception.all(() => service.create('closed'), /closed/i);
});

test('real Hyperbeam constructor accepts the announce (host) options argument', async function (t) {
  const RealHyperbeam = (await import('hyperbeam')).default;
  const fakeDht = { destroy: async () => {} };
  // No key + options-as-first-arg must construct an announcing beam (the host path).
  const beam = new RealHyperbeam({ announce: true, dht: fakeDht });
  t.ok(/^[a-z2-7]{52}$/.test(beam.key), 'host beam exposes a 52-character base32 key');
  t.is(beam.announce, true, 'host beam announces');
  beam.destroy();
});