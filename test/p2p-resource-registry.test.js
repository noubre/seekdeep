import test from 'brittle';
import { createP2pResourceRegistry } from '../js/p2p/resource-registry.js';

const DRIVE_KEY = 'ab'.repeat(32);
const BEAM_SECRET = 'ff'.repeat(32);

function deterministicRegistry(options = {}) {
  let id = 0;
  let now = 1_700_000_000_000;
  return createP2pResourceRegistry({
    idFactory: (type) => `${type}-${++id}`,
    now: () => now++,
    ...options
  });
}

test('registry creates safe descriptors for every resource type', function (t) {
  const registry = deterministicRegistry();
  const drive = registry.addDrive({ name: '  Shared   Vault  ', key: DRIVE_KEY.toUpperCase(), status: 'ready' });
  const local = registry.addLocaldrive({ name: 'Local Vault', status: 'ready' });
  const mirror = registry.addMirror({
    name: 'Vault Mirror',
    localId: local.id,
    driveId: drive.id,
    direction: 'push',
    status: 'running'
  });
  const beam = registry.addBeam({ name: 'One-time transfer', status: 'open' });

  t.alike(drive, {
    id: 'drive-1', type: 'drive', name: 'Shared Vault', key: DRIVE_KEY,
    status: 'ready', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000
  });
  t.alike(local, {
    id: 'localdrive-2', type: 'localdrive', name: 'Local Vault',
    status: 'ready', createdAt: 1_700_000_000_001, updatedAt: 1_700_000_000_001
  });
  t.alike(mirror, {
    id: 'mirror-3', type: 'mirror', name: 'Vault Mirror', localId: local.id,
    driveId: drive.id, direction: 'push', status: 'running',
    createdAt: 1_700_000_000_002, updatedAt: 1_700_000_000_002
  });
  t.alike(beam, {
    id: 'beam-4', type: 'beam', name: 'One-time transfer', status: 'open',
    createdAt: 1_700_000_000_003, updatedAt: 1_700_000_000_003
  });
  t.alike(registry.listDrives(), [drive]);
  t.alike(registry.listLocaldrives(), [local]);
  t.alike(registry.listMirrors(), [mirror]);
  t.alike(registry.listBeams(), [beam]);
});

test('default IDs use collision-resistant UUIDs when Web Crypto is available', function (t) {
  const registry = createP2pResourceRegistry();
  const drive = registry.addDrive({ name: 'UUID drive', status: 'ready' });

  t.ok(/^drive-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(drive.id));
});

test('IDs and normalized names are unique at the required scopes', async function (t) {
  const ids = ['same-id', 'same-id', 'different-id'];
  const registry = createP2pResourceRegistry({ idFactory: () => ids.shift(), now: () => 1 });
  const first = registry.addDrive({ name: 'Alpha', status: 'ready' });
  const second = registry.addBeam({ name: 'Alpha', status: 'open' });

  t.is(first.id, 'same-id');
  t.is(second.id, 'different-id', 'ID collision is retried globally');
  t.exception.all(
    () => registry.addDrive({ name: '  ALPHA ', status: 'ready' }),
    /name already exists/i
  );

  const stuck = createP2pResourceRegistry({ idFactory: () => 'fixed', now: () => 1 });
  stuck.addDrive({ name: 'One', status: 'ready' });
  t.exception.all(() => stuck.addBeam({ name: 'Two', status: 'open' }), /unique resource ID/i);
});

test('outputs are cloned and frozen with mutation isolation', async function (t) {
  const registry = deterministicRegistry();
  const created = registry.addDrive({ name: 'Immutable', key: DRIVE_KEY, status: 'ready' });
  const listed = registry.listDrives();
  const found = registry.findDrive(created.id);

  t.ok(Object.isFrozen(created));
  t.ok(Object.isFrozen(listed));
  t.ok(Object.isFrozen(listed[0]));
  t.ok(Object.isFrozen(found));
  t.not(created, listed[0]);
  t.not(created, found);
  t.exception.all(() => { created.name = 'mutated'; }, /read only|assign/i);
  t.is(registry.findDrive(created.id).name, 'Immutable');
});

test('validation rejects unknown fields, accessors, prototypes, invalid names, statuses, and links', async function (t) {
  const registry = deterministicRegistry();
  let getterCalls = 0;
  const accessor = { name: 'Accessor', status: 'ready' };
  Object.defineProperty(accessor, 'handle', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    }
  });

  const invalid = [
    () => registry.addDrive({ name: 'Raw handle', status: 'ready', handle: {} }),
    () => registry.addDrive(accessor),
    () => registry.addDrive(Object.assign(Object.create({ inherited: true }), { name: 'Prototype', status: 'ready' })),
    () => registry.addDrive({ name: '', status: 'ready' }),
    () => registry.addDrive({ name: 'x'.repeat(81), status: 'ready' }),
    () => registry.addDrive({ name: 'bad\u0000name', status: 'ready' }),
    () => registry.addDrive({ name: 'Bad status', status: 'whatever' }),
    () => registry.addDrive({ name: 'Bad key', key: 'not-public-key', status: 'ready' }),
    () => registry.addBeam({ name: 'Secret', status: 'open', key: BEAM_SECRET }),
    () => registry.addBeam({ name: 'Secret', status: 'open', capabilityKey: BEAM_SECRET }),
    () => registry.addMirror({
      name: 'Missing links', localId: 'no-local', driveId: 'no-drive',
      direction: 'push', status: 'running'
    })
  ];

  for (const attempt of invalid) t.exception.all(attempt);
  t.is(getterCalls, 0, 'validation does not invoke accessors');
});

test('caps are enforced globally and per type', async function (t) {
  const globalRegistry = deterministicRegistry({ maxResources: 2, maxResourcesPerType: 2 });
  globalRegistry.addDrive({ name: 'One', status: 'ready' });
  globalRegistry.addBeam({ name: 'Two', status: 'open' });
  t.exception.all(() => globalRegistry.addLocaldrive({ name: 'Three', status: 'ready' }), /resource limit/i);

  const typeRegistry = deterministicRegistry({ maxResources: 4, maxResourcesPerType: 1 });
  typeRegistry.addDrive({ name: 'One', status: 'ready' });
  t.exception.all(() => typeRegistry.addDrive({ name: 'Two', status: 'ready' }), /drive resource limit/i);
  typeRegistry.addBeam({ name: 'Two', status: 'open' });
  t.is(typeRegistry.list().length, 2);
});

test('beam list descriptors never expose capability secrets', function (t) {
  const registry = deterministicRegistry();
  registry.addBeam({ name: 'Transfer', status: 'open' });

  const serialized = JSON.stringify(registry.listBeams());
  t.absent(serialized.includes(BEAM_SECRET));
  t.absent(serialized.includes('key'));
  t.absent(serialized.includes('capability'));
});

test('find, update, status update, and remove preserve registry invariants', function (t) {
  const registry = deterministicRegistry();
  const beam = registry.addBeam({ name: 'Transfer', status: 'open' });

  t.alike(registry.findBeam(' transfer '), beam, 'find accepts normalized per-type name');
  const closed = registry.updateBeam(beam.id, { status: 'closed' });
  t.is(closed.status, 'closed');
  t.is(closed.createdAt, beam.createdAt);
  t.is(closed.updatedAt, beam.updatedAt + 1);
  t.alike(registry.updateStatus(beam.id, 'closed'), closed, 'no-op status updates preserve updatedAt');
  t.is(registry.removeBeam(beam.id), true);
  t.is(registry.findBeam(beam.id), null);
  t.is(registry.removeBeam(beam.id), false);
});

test('mirror references resolve names to canonical IDs and remain referentially intact', function (t) {
  const registry = deterministicRegistry();
  const drive = registry.addDrive({ name: 'Remote One', status: 'ready' });
  const replacementDrive = registry.addDrive({ name: 'Remote Two', status: 'ready' });
  const local = registry.addLocaldrive({ name: 'Local One', status: 'ready' });
  const replacementLocal = registry.addLocaldrive({ name: 'Local Two', status: 'ready' });
  const mirror = registry.addMirror({
    name: 'Linked', localId: ' local one ', driveId: 'REMOTE ONE',
    direction: 'sync', status: 'running'
  });

  t.is(mirror.localId, local.id, 'localdrive name is stored as its canonical ID');
  t.is(mirror.driveId, drive.id, 'drive name is stored as its canonical ID');
  t.exception.all(() => registry.removeLocaldrive(local.id), /referenced by mirror/i);
  t.exception.all(() => registry.removeDrive(drive.id), /referenced by mirror/i);
  t.exception.all(() => registry.updateLocaldrive(local.id, { name: 'Renamed Local' }), /referenced by mirror/i);
  t.exception.all(() => registry.updateDrive(drive.id, { name: 'Renamed Drive' }), /referenced by mirror/i);

  const moved = registry.updateMirror(mirror.id, {
    localId: replacementLocal.name,
    driveId: replacementDrive.name
  });
  t.is(moved.localId, replacementLocal.id);
  t.is(moved.driveId, replacementDrive.id);
  t.is(registry.removeLocaldrive(local.id), true, 'repointing releases the previous localdrive');
  t.is(registry.removeDrive(drive.id), true, 'repointing releases the previous drive');
  t.exception.all(() => registry.updateMirror(mirror.id, { driveId: 'missing' }), /registered drive/i);
  t.is(registry.removeMirror(mirror.id), true);
  t.is(registry.removeLocaldrive(replacementLocal.id), true, 'source removal works after mirror removal');
  t.is(registry.removeDrive(replacementDrive.id), true, 'source removal works after mirror removal');
});

test('typed lookup falls back to same-type names when another type owns the exact ID', function (t) {
  const ids = ['cross-type-token', 'drive-id', 'same-type-id', 'unused'];
  const registry = createP2pResourceRegistry({ idFactory: () => ids.shift(), now: () => 1 });
  const beam = registry.addBeam({ name: 'Beam', status: 'open' });
  const namedDrive = registry.addDrive({ name: beam.id, status: 'ready' });

  t.is(registry.findDrive(beam.id).id, namedDrive.id);
  t.is(registry.updateDrive(beam.id, { status: 'closed' }).id, namedDrive.id);

  const sameType = registry.addDrive({ name: 'Other drive', status: 'ready' });
  t.is(sameType.id, 'same-type-id');
  t.exception.all(
    () => registry.addDrive({ name: 'SAME-TYPE-ID', status: 'ready' }),
    /name.*ID|ID.*name/i,
    'same-type names cannot collide with existing IDs'
  );
});

test('generated IDs do not shadow existing same-type names', function (t) {
  const ids = ['first-id', 'reserved-name', 'safe-id'];
  const registry = createP2pResourceRegistry({ idFactory: () => ids.shift(), now: () => 1 });
  registry.addDrive({ name: 'Reserved-Name', status: 'ready' });
  const second = registry.addDrive({ name: 'Second', status: 'ready' });

  t.is(second.id, 'safe-id', 'ID candidates colliding with normalized same-type names are retried');
});

test('timestamps remain monotonic when the injected clock moves backward', function (t) {
  const times = [100, 90, 80, 110];
  const registry = createP2pResourceRegistry({
    idFactory: () => 'beam-id',
    now: () => times.shift()
  });
  const beam = registry.addBeam({ name: 'Clock', status: 'open' });
  const first = registry.updateBeam(beam.id, { status: 'closed' });
  const second = registry.updateBeam(beam.id, { name: 'Clock renamed' });
  const third = registry.updateBeam(beam.id, { status: 'open' });

  t.is(beam.createdAt, 100);
  t.is(first.updatedAt, 100, 'timestamp equality is allowed when the clock regresses');
  t.is(second.updatedAt, 100);
  t.is(third.updatedAt, 110);
  t.ok(third.updatedAt >= third.createdAt);

  const invalidClock = createP2pResourceRegistry({ idFactory: () => 'bad-clock', now: () => -1 });
  t.exception.all(
    () => invalidClock.addBeam({ name: 'Invalid creation clock', status: 'open' }),
    /non-negative safe integer timestamp/i
  );
});

test('all public descriptors are JSON-safe data-only values', function (t) {
  const registry = deterministicRegistry();
  registry.addDrive({ name: 'Drive', key: DRIVE_KEY, status: 'ready' });
  registry.addLocaldrive({ name: 'Local', status: 'ready' });

  const listed = registry.list();
  t.alike(JSON.parse(JSON.stringify(listed)), listed);
  for (const descriptor of listed) {
    t.is(Object.getPrototypeOf(descriptor), Object.prototype);
    for (const key of Reflect.ownKeys(descriptor)) {
      const property = Object.getOwnPropertyDescriptor(descriptor, key);
      t.ok(Object.hasOwn(property, 'value'));
      t.absent(Object.hasOwn(property, 'get'));
      t.absent(Object.hasOwn(property, 'set'));
    }
  }
});
