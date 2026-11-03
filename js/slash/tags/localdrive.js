import {
  CONTROL_PATTERN,
  MAX_NAME_CHARS,
  MAX_REFERENCE_CHARS,
  byteLength,
  requireService,
  exactKeys,
  metadata,
  assertCount,
  isPrintableName,
  isPrintableReference
} from './support.js';

const ACTIONS = new Set(['add', 'list', 'status', 'files', 'get', 'put', 'remove']);
const MAX_ALIAS_BYTES = 512;
const MAX_PATH_BYTES = 512;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_FILES = 100;
const MAX_MAPPINGS = 32;
const DESCRIPTOR_KEYS = ['id', 'name', 'root', 'status', 'writable'];

function assertName(value) {
  if (!isPrintableName(value)) {
    throw new Error(`Localdrive name must be 1-${MAX_NAME_CHARS} printable characters.`);
  }
}

function assertReference(value) {
  if (!isPrintableReference(value)) {
    throw new Error(`Localdrive reference must be 1-${MAX_REFERENCE_CHARS} printable characters.`);
  }
}

function assertAlias(value) {
  if (typeof value !== 'string' || !value.startsWith('@storage/')) throw new Error('Localdrive root must use @storage/<relative>.');
  const relative = value.slice('@storage/'.length);
  const parts = relative.split('/');
  if (!relative || value.includes('\\') || CONTROL_PATTERN.test(value) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Localdrive root alias must be normalized and must not contain traversal.');
  }
  if (byteLength(value) > MAX_ALIAS_BYTES) throw new Error('Localdrive root alias is too large.');
}

function assertPath(value, allowRoot = false) {
  if (typeof value !== 'string' || !value || value.includes('\\') || CONTROL_PATTERN.test(value)) throw new Error('Localdrive path contains invalid characters.');
  const rooted = value.startsWith('/') ? value : `/${value}`;
  if (rooted === '/') {
    if (allowRoot) return;
    throw new Error('Localdrive path must identify a file, not root.');
  }
  if (rooted.slice(1).split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Localdrive path must be normalized and must not contain traversal.');
  }
  if (byteLength(rooted) > MAX_PATH_BYTES) throw new Error('Localdrive path is too large.');
}

function safeDescriptor(row) {
  if (!exactKeys(row, DESCRIPTOR_KEYS)) throw new Error('Localdrive service returned an invalid descriptor.');
  const descriptor = { id: row.id, name: row.name, root: row.root, writable: row.writable, status: row.status };
  if (typeof descriptor.id !== 'string' || typeof descriptor.name !== 'string' || typeof descriptor.root !== 'string' ||
      !descriptor.root.startsWith('@storage/') || typeof descriptor.writable !== 'boolean' ||
      !['ready', 'removed'].includes(descriptor.status)) {
    throw new Error('Localdrive service returned an invalid descriptor.');
  }
  assertAlias(descriptor.root);
  return descriptor;
}

function descriptorLines(row) {
  return [
    `${row.name} (${row.id})`,
    `Root: ${row.root}`,
    `Access: ${row.writable ? 'writable' : 'read-only'}`,
    `Status: ${row.status}`
  ];
}

async function handleLocaldrive(parsed, services) {
  const [requestedAction, ...args] = parsed.args;
  const action = requestedAction?.toLowerCase();
  if (!action || !ACTIONS.has(action)) throw new Error('Use /localdrive add, list, status, files, get, put, or remove.');
  const flagKeys = Reflect.ownKeys(parsed.flags);
  if (action === 'add') {
    if (flagKeys.some((key) => key !== 'writable') || (Object.hasOwn(parsed.flags, 'writable') && parsed.flags.writable !== true)) {
      throw new Error('/localdrive add accepts only the boolean --writable flag.');
    }
  } else if (flagKeys.length) {
    throw new Error(`/localdrive ${action} does not accept flags.`);
  }

  if (action === 'add') {
    assertCount('localdrive', action, args, 2);
    assertName(args[0]);
    assertAlias(args[1]);
  } else if (action === 'list') {
    assertCount('localdrive', action, args, 0);
  } else if (action === 'files') {
    assertCount('localdrive', action, args, 1, 2);
    assertReference(args[0]);
    if (args[1] !== undefined) assertPath(args[1], true);
  } else if (action === 'put') {
    if (args.length < 3) throw new Error('/localdrive put expects a mapping, path, and text.');
    assertReference(args[0]);
    assertPath(args[1]);
    if (byteLength(args.slice(2).join(' ')) > MAX_CONTENT_BYTES) throw new Error('Localdrive content is too large.');
  } else {
    assertCount('localdrive', action, args, action === 'get' ? 2 : 1);
    assertReference(args[0]);
    if (action === 'get') assertPath(args[1]);
  }

  const localdrive = requireService(services, 'localdrive', 'Localdrive service is unavailable.');
  if (typeof localdrive[action] !== 'function') throw new Error('Localdrive service is unavailable.');
  if (action === 'add') {
    const row = safeDescriptor(await localdrive.add(args[0], args[1], parsed.flags.writable === true));
    return { content: ['Added Localdrive mapping.', ...descriptorLines(row)].join('\n'), metadata: metadata('slash-localdrive', 'localdrive', action, { descriptor: row }) };
  }
  if (action === 'list') {
    const result = await localdrive.list();
    if (!Array.isArray(result) || result.length > MAX_MAPPINGS) throw new Error('Localdrive service returned an invalid list.');
    const rows = result.map(safeDescriptor);
    return {
      content: rows.length ? `Localdrive mappings (${rows.length}):\n${rows.map((row) => `- ${row.name} (${row.id}) ${row.writable ? 'writable' : 'read-only'}\n  ${row.root}`).join('\n')}` : 'No Localdrive mappings.',
      metadata: metadata('slash-localdrive', 'localdrive', action, { descriptors: rows })
    };
  }
  if (action === 'status') {
    const unsafe = await localdrive.status(args[0]);
    const base = {};
    for (const key of DESCRIPTOR_KEYS) base[key] = unsafe?.[key];
    const row = safeDescriptor(base);
    const keys = Reflect.ownKeys(unsafe || {});
    if (keys.length !== DESCRIPTOR_KEYS.length + 2 || keys.some((key) => ![...DESCRIPTOR_KEYS, 'fileCount', 'fileCountCapped'].includes(key)) ||
        !Number.isSafeInteger(unsafe.fileCount) || unsafe.fileCount < 0 || typeof unsafe.fileCountCapped !== 'boolean') {
      throw new Error('Localdrive service returned an invalid status.');
    }
    const descriptor = { ...row, fileCount: unsafe.fileCount, fileCountCapped: unsafe.fileCountCapped };
    return { content: `${descriptorLines(row).join('\n')}\nFiles: ${unsafe.fileCount}${unsafe.fileCountCapped ? '+' : ''}`, metadata: metadata('slash-localdrive', 'localdrive', action, { descriptor }) };
  }
  if (action === 'files') {
    const result = await localdrive.files(args[0], args[1]);
    if (!result || Reflect.ownKeys(result).length !== 2 || !Array.isArray(result.files) || result.files.length > MAX_FILES ||
        result.files.some((file) => typeof file !== 'string') || typeof result.capped !== 'boolean') throw new Error('Localdrive service returned an invalid file list.');
    const safe = { files: [...result.files], capped: result.capped };
    return { content: safe.files.length ? `Localdrive files${safe.capped ? ' (first results)' : ''}:\n${safe.files.map((file) => `- ${file}`).join('\n')}` : 'No matching Localdrive files.', metadata: metadata('slash-localdrive', 'localdrive', action, safe) };
  }
  if (action === 'get') {
    const result = await localdrive.get(args[0], args[1]);
    if (!result || Reflect.ownKeys(result).length !== 3 || typeof result.path !== 'string' || typeof result.content !== 'string' ||
        !Number.isSafeInteger(result.bytes) || result.bytes < 0 || byteLength(result.content) > MAX_CONTENT_BYTES) throw new Error('Localdrive service returned an invalid result.');
    return { content: `${result.path} (${result.bytes} bytes)\n${result.content}`, metadata: metadata('slash-localdrive', 'localdrive', action, { path: result.path, bytes: result.bytes }) };
  }
  if (action === 'put') {
    const result = await localdrive.put(args[0], args[1], args.slice(2).join(' '));
    if (!result || Reflect.ownKeys(result).length !== 2 || typeof result.path !== 'string' || !Number.isSafeInteger(result.bytes) || result.bytes < 0) {
      throw new Error('Localdrive service returned an invalid result.');
    }
    return { content: `Stored ${result.bytes} bytes at ${result.path}.`, metadata: metadata('slash-localdrive', 'localdrive', action, { result: { path: result.path, bytes: result.bytes } }) };
  }
  const row = safeDescriptor(await localdrive.remove(args[0]));
  return { content: ['Removed Localdrive mapping. Files were retained.', ...descriptorLines(row)].join('\n'), metadata: metadata('slash-localdrive', 'localdrive', action, { descriptor: row }) };
}

export { handleLocaldrive };
