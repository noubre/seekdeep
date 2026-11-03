/**
 * Filesystem helpers for the harness plugin loader and sync.
 *
 * Uses `bare-fs/promises` (the same module the Localdrive service loads) so the
 * code runs unchanged in the Bare worker and under Node in tests. All path
 * handling is POSIX-normalised to keep drive paths deterministic across hosts.
 */
import path from 'path';
import b4a from 'b4a';
import { MAX_CONTENT_BYTES } from '../p2p/hyperdrive-service.js';

const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.json']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.git']);

/**
 * Prefer the Bare filesystem; fall back to Node's so the harness also runs
 * under `node` (tests, headless tooling).
 */
async function loadDefaultFilesystem() {
  try {
    const module = await import('bare-fs/promises');
    return module.default || module;
  } catch {
    const module = await import('node:fs/promises');
    return module.default || module;
  }
}

function createHarnessFiles(filesystem) {
  const loading = filesystem ? Promise.resolve(filesystem) : loadDefaultFilesystem();

  async function call(method, ...args) {
    const fs = await loading;
    if (typeof fs?.[method] !== 'function') throw new TypeError(`Filesystem does not implement ${method}`);
    return fs[method](...args);
  }

  async function exists(target) {
    try { await call('stat', target); return true; } catch { return false; }
  }

  async function ensureDir(dir) {
    await call('mkdir', dir, { recursive: true });
  }

  async function readText(file) {
    return call('readFile', file, 'utf8');
  }

  async function writeText(file, content) {
    await ensureDir(path.dirname(file));
    await call('writeFile', file, content);
  }

  async function readJson(file) {
    let text;
    try { text = await readText(file); } catch { return null; }
    try { return JSON.parse(text); } catch { return null; }
  }

  async function writeJson(file, value) {
    await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function listDirs(root) {
    let entries;
    try {
      entries = await call('readdir', root, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs = [];
    for (const entry of entries) {
      const name = String(entry.name);
      if (name.startsWith('.') || SKIP_DIRECTORIES.has(name)) continue;
      if (typeof entry.isDirectory === 'function') {
        if (entry.isDirectory()) dirs.push(name);
        continue;
      }
      try {
        const stat = await call('stat', path.join(root, name));
        if (stat.isDirectory()) dirs.push(name);
      } catch {}
    }
    return dirs.sort();
  }

  async function listPluginFiles(root) {
    const files = [];
    async function walk(dir, prefix) {
      let entries;
      try {
        entries = await call('readdir', dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
      for (const entry of entries) {
        const name = String(entry.name);
        if (name.startsWith('.') || SKIP_DIRECTORIES.has(name)) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        const full = path.join(dir, name);
        if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) continue;
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
        if (isDir) { await walk(full, rel); continue; }
        if (!entry.isDirectory && typeof entry.isFile !== 'function') {
          let stat;
          try { stat = await call('stat', full); } catch { continue; }
          if (stat.isDirectory()) { await walk(full, rel); continue; }
        }
        if (!ALLOWED_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) continue;
        const content = await readText(full);
        if (b4a.byteLength(content) > MAX_CONTENT_BYTES) {
          throw new RangeError(`Plugin file is too large to sync (max ${MAX_CONTENT_BYTES} bytes): ${rel}`);
        }
        files.push({ rel, content });
      }
    }
    await walk(root, '');
    return files;
  }

  async function writeFiles(root, entries) {
    for (const entry of entries) {
      const rel = assertSafeRel(entry.rel);
      const target = path.join(root, ...rel.split('/'));
      await ensureDir(path.dirname(target));
      await call('writeFile', target, entry.content);
    }
  }

  return Object.freeze({
    call, exists, ensureDir, readText, writeText, readJson, writeJson,
    listDirs, listPluginFiles, writeFiles
  });
}

function assertSafeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) {
    throw new TypeError(`Unsafe relative path: ${String(rel)}`);
  }
  const segments = rel.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`Unsafe relative path: ${rel}`);
  }
  return rel;
}

function toDrivePath(rel) {
  return `/plugins/${assertSafeRel(rel)}`;
}

export { createHarnessFiles, assertSafeRel, toDrivePath };
