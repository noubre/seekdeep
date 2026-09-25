const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const ACTIONS = new Set(['create', 'open', 'list', 'status', 'put', 'get', 'files', 'del', 'close']);
const MAX_NAME_CHARS = 80;
const MAX_REFERENCE_CHARS = 160;
const MAX_PATH_BYTES = 512;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_FILES = 100;
const MAX_DRIVES = 64;

function requireService(services) {
  const service = services?.drive;
  if (!service) throw new Error('Drive service is unavailable.');
  return service;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function assertReference(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(value)) {
    throw new Error(`Drive reference must be 1-${MAX_REFERENCE_CHARS} printable characters.`);
  }
}

function assertName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_NAME_CHARS || CONTROL_PATTERN.test(value)) {
    throw new Error(`Drive name must be 1-${MAX_NAME_CHARS} printable characters.`);
  }
}

function assertPath(value, allowRoot = false) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new Error('Drive path contains invalid characters.');
  }
  const rooted = value.startsWith('/') ? value : `/${value}`;
  if (rooted === '/') {
    if (allowRoot) return;
    throw new Error('Drive path must identify a file, not root.');
  }
  if (rooted.split('/').some((segment, index) => index > 0 && (!segment || segment === '.' || segment === '..'))) {
    throw new Error('Drive path must be normalized and must not contain traversal.');
  }
  if (byteLength(rooted) > MAX_PATH_BYTES) throw new Error('Drive path is too large.');
}

function safeDescriptor(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Drive service returned an invalid descriptor.');
  const descriptor = {
    id: row.id,
    name: row.name,
    key: row.key,
    writable: row.writable,
    version: row.version,
    status: row.status,
    opened: row.opened,
    discovering: row.discovering
  };
  if (typeof descriptor.id !== 'string' || typeof descriptor.name !== 'string' || !KEY_PATTERN.test(descriptor.key) ||
      typeof descriptor.writable !== 'boolean' || !Number.isSafeInteger(descriptor.version) || descriptor.version < 0 ||
      typeof descriptor.status !== 'string' || typeof descriptor.opened !== 'boolean' || typeof descriptor.discovering !== 'boolean') {
    throw new Error('Drive service returned an invalid descriptor.');
  }
  return descriptor;
}

function metadata(action, extra = {}) {
  return { kind: 'slash-drive', command: 'drive', action, ...extra };
}

function descriptorLines(row) {
  return [
    `${row.name} (${row.id})`,
    `Key: ${row.key}`,
    `Writable: ${row.writable ? 'yes' : 'no'}`,
    `Version: ${row.version}`,
    `Opened: ${row.opened ? 'yes' : 'no'}`,
    `Discovery: ${row.discovering ? 'active' : 'stopped'}`
  ];
}

function descriptorResult(action, unsafeRow, heading) {
  const row = safeDescriptor(unsafeRow);
  return {
    content: [heading, ...descriptorLines(row)].join('\n'),
    metadata: metadata(action, { descriptor: row })
  };
}

function assertCount(action, args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) {
    throw new Error(`/drive ${action} expects ${minimum === maximum ? minimum : `${minimum}-${maximum}`} argument${maximum === 1 ? '' : 's'}.`);
  }
}

async function handleDrive(parsed, services) {
  if (Reflect.ownKeys(parsed.flags).length) throw new Error('/drive does not accept flags.');
  const [requestedAction, ...args] = parsed.args;
  const action = requestedAction?.toLowerCase();
  if (!action || !ACTIONS.has(action)) {
    throw new Error('Use /drive create, open, list, status, put, get, files, del, or close.');
  }

  if (action === 'list') assertCount(action, args, 0);
  else if (action === 'create') {
    assertCount(action, args, 1);
    assertName(args[0]);
  } else if (action === 'open') {
    assertCount(action, args, 1, 2);
    if (!KEY_PATTERN.test(args[0])) throw new Error('/drive open requires a 64-character hexadecimal public key.');
    if (args[1] !== undefined) assertName(args[1]);
  } else if (action === 'files') {
    assertCount(action, args, 1, 2);
    assertReference(args[0]);
    if (args[1] !== undefined) assertPath(args[1], true);
  } else if (action === 'put') {
    if (args.length < 3) throw new Error('/drive put expects a drive, path, and text.');
    assertReference(args[0]);
    assertPath(args[1]);
    if (byteLength(args.slice(2).join(' ')) > MAX_CONTENT_BYTES) throw new Error('Drive content is too large.');
  } else {
    assertCount(action, args, action === 'get' || action === 'del' ? 2 : 1);
    assertReference(args[0]);
    if (action === 'get' || action === 'del') assertPath(args[1]);
  }

  const drive = requireService(services);
  if (typeof drive[action === 'close' ? 'close' : action] !== 'function') throw new Error('Drive service is unavailable.');
  if (action === 'create') return descriptorResult(action, await drive.create(args[0]), 'Created Hyperdrive.');
  if (action === 'open') return descriptorResult(action, await drive.open(args[0].toLowerCase(), args[1]), 'Opened Hyperdrive.');
  if (action === 'list') {
    const result = await drive.list();
    if (!Array.isArray(result) || result.length > MAX_DRIVES) throw new Error('Drive service returned an invalid list.');
    const rows = result.map(safeDescriptor);
    return {
      content: rows.length ? `Hyperdrives (${rows.length}):\n${rows.map((row) => `- ${row.name} (${row.id}) ${row.writable ? 'writable' : 'read-only'} ${row.opened ? 'open' : 'closed'}\n  ${row.key}`).join('\n')}` : 'No Hyperdrives.',
      metadata: metadata(action, { descriptors: rows })
    };
  }
  if (action === 'status') {
    const unsafeRow = await drive.status(args[0]);
    const row = safeDescriptor(unsafeRow);
    const hasCount = Object.hasOwn(unsafeRow, 'fileCount');
    if (hasCount && (!Number.isSafeInteger(unsafeRow.fileCount) || unsafeRow.fileCount < 0 || typeof unsafeRow.fileCountCapped !== 'boolean')) {
      throw new Error('Drive service returned an invalid status.');
    }
    const descriptor = hasCount ? { ...row, fileCount: unsafeRow.fileCount, fileCountCapped: unsafeRow.fileCountCapped } : row;
    const count = hasCount ? `\nFiles: ${descriptor.fileCount}${descriptor.fileCountCapped ? '+' : ''}` : '';
    return { content: `${descriptorLines(row).join('\n')}${count}`, metadata: metadata(action, { descriptor }) };
  }
  if (action === 'put') {
    const result = await drive.put(args[0], args[1], args.slice(2).join(' '));
    if (!result || typeof result.path !== 'string' || !Number.isSafeInteger(result.bytes) || !Number.isSafeInteger(result.version)) throw new Error('Drive service returned an invalid result.');
    const safe = { path: result.path, bytes: result.bytes, version: result.version };
    return { content: `Stored ${safe.bytes} bytes at ${safe.path}.\nVersion: ${safe.version}`, metadata: metadata(action, { result: safe }) };
  }
  if (action === 'get') {
    const result = await drive.get(args[0], args[1]);
    if (!result || typeof result.path !== 'string' || typeof result.content !== 'string' || !Number.isSafeInteger(result.bytes) || byteLength(result.content) > MAX_CONTENT_BYTES) {
      throw new Error('Drive service returned an invalid result.');
    }
    return { content: `${result.path} (${result.bytes} bytes)\n${result.content}`, metadata: metadata(action, { path: result.path, bytes: result.bytes }) };
  }
  if (action === 'files') {
    const result = await drive.files(args[0], args[1]);
    if (!result || !Array.isArray(result.files) || result.files.length > MAX_FILES || result.files.some((file) => typeof file !== 'string') || typeof result.capped !== 'boolean') {
      throw new Error('Drive service returned an invalid file list.');
    }
    const safe = { files: [...result.files], capped: result.capped };
    return { content: safe.files.length ? `Drive files${safe.capped ? ' (first results)' : ''}:\n${safe.files.map((file) => `- ${file}`).join('\n')}` : 'No matching drive files.', metadata: metadata(action, safe) };
  }
  if (action === 'del') {
    const result = await drive.del(args[0], args[1]);
    if (!result || typeof result.path !== 'string' || typeof result.deleted !== 'boolean' || !Number.isSafeInteger(result.version)) throw new Error('Drive service returned an invalid result.');
    const safe = { path: result.path, deleted: result.deleted, version: result.version };
    return { content: safe.deleted ? `Deleted ${safe.path}.\nVersion: ${safe.version}` : `No file existed at ${safe.path}.`, metadata: metadata(action, { result: safe }) };
  }
  return descriptorResult(action, await drive.close(args[0]), 'Closed Hyperdrive.');
}

export { handleDrive };
