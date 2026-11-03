/**
 * Harness-key sync.
 *
 * Owner-publishes / followers-consume of this machine's user plugins over a
 * Hyperdrive keyed by the 64-hex harness key. A single bundle manifest avoids
 * the per-drive 100-file listing cap; each file stays under the 64 KiB
 * `drive.put` content cap because `listPluginFiles` rejects larger files.
 */
import b4a from 'b4a';
import { MAX_FILES } from '../p2p/hyperdrive-service.js';
import { assertSafeRel, toDrivePath } from './files.js';

const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const DRIVE_NAME = 'harness';
const BUNDLE_PATH = '/harness-bundle.json';
const BUNDLE_VERSION = 1;
const PLUGIN_PREFIX = '/plugins/';

function createHarnessSync({ userPluginsDir, syncedPluginsDir, driveService, files, now, emit, reload, getKey, setKey }) {
  if (!driveService || typeof driveService.create !== 'function') throw new TypeError('Harness sync requires a drive service');
  if (!files || typeof files.listPluginFiles !== 'function') throw new TypeError('Harness sync requires filesystem helpers');
  const clock = now || (() => Date.now());
  const notify = emit || (() => {});

  let ref = null;
  let role = 'none';

  async function ensureOpen() {
    if (ref) return ref;
    const key = getKey();
    if (!key) return null;
    await driveService.open(key, DRIVE_NAME);
    ref = DRIVE_NAME;
    return ref;
  }

  async function status() {
    const key = getKey();
    if (!key) return { key: null, role: 'none', available: true };
    try {
      const reference = await ensureOpen();
      const descriptor = await driveService.status(reference);
      role = descriptor.writable ? 'owner' : 'follower';
      return { key, role, version: descriptor.version };
    } catch (error) {
      return { key, role: 'unknown', available: true, error: error.message };
    }
  }

  async function push() {
    const reference = await ensureOpen();
    if (!reference) throw new Error('A harness key is required to push. Run /harness create first.');
    const descriptor = await driveService.status(reference);
    if (!descriptor.writable) throw new Error('Drive is read-only');
    const entries = await files.listPluginFiles(userPluginsDir);
    if (entries.length > MAX_FILES) {
      throw new RangeError(`Too many plugin files to publish (max ${MAX_FILES}): ${entries.length}`);
    }
    for (const entry of entries) {
      await driveService.put(reference, toDrivePath(entry.rel), entry.content);
    }
    const manifest = {
      version: BUNDLE_VERSION,
      createdAt: clock(),
      files: entries.map((entry) => ({ path: toDrivePath(entry.rel), bytes: b4a.byteLength(entry.content) }))
    };
    await driveService.put(reference, BUNDLE_PATH, JSON.stringify(manifest));
    notify({ type: 'sync', status: 'pushed', key: getKey(), files: entries.length });
    return { key: getKey(), files: entries.length };
  }

  async function writeBundle(manifest, reference) {
    const paths = Array.isArray(manifest?.files) ? manifest.files.map((file) => file?.path) : [];
    const entries = [];
    for (const filePath of paths) {
      if (typeof filePath !== 'string' || !filePath.startsWith(PLUGIN_PREFIX)) continue;
      const rel = assertSafeRel(filePath.slice(PLUGIN_PREFIX.length));
      const file = await driveService.get(reference, filePath);
      entries.push({ rel, content: file.content });
    }
    await files.writeFiles(syncedPluginsDir, entries);
    if (typeof reload === 'function') {
      try { await reload(); } catch {}
    }
    return entries.length;
  }

  async function pull() {
    const reference = await ensureOpen();
    if (!reference) throw new Error('A harness key is required to pull. Run /harness join <64hex> first.');
    const bundle = await driveService.get(reference, BUNDLE_PATH);
    let manifest;
    try {
      manifest = JSON.parse(bundle.content);
    } catch {
      throw new Error('Harness bundle is malformed');
    }
    const filesWritten = await writeBundle(manifest, reference);
    notify({ type: 'sync', status: 'pulled', key: getKey(), files: filesWritten });
    return { files: filesWritten };
  }

  async function create() {
    if (getKey()) return { key: getKey(), role: 'owner', files: 0 };
    const descriptor = await driveService.create(DRIVE_NAME);
    ref = DRIVE_NAME;
    role = 'owner';
    await setKey(descriptor.key);
    const result = await push();
    notify({ type: 'sync', status: 'created', key: descriptor.key });
    return { key: descriptor.key, role: 'owner', files: result.files };
  }

  async function join(keyValue) {
    if (typeof keyValue !== 'string' || !KEY_PATTERN.test(keyValue)) {
      throw new Error('/harness join requires exactly one 64-character hexadecimal harness key.');
    }
    const key = keyValue.toLowerCase();
    await driveService.open(key, DRIVE_NAME);
    ref = DRIVE_NAME;
    await setKey(key);
    const result = await pull();
    return { key, role: 'follower', files: result.files };
  }

  async function leave() {
    await setKey(null);
    ref = null;
    role = 'none';
    if (typeof reload === 'function') {
      try { await reload(); } catch {}
    }
    notify({ type: 'sync', status: 'left' });
    return { key: null, role: 'none' };
  }

  return Object.freeze({ status, create, push, pull, join, leave, close: async () => {} });
}

export { createHarnessSync, KEY_PATTERN };