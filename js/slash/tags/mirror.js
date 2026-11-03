import {
  CONTROL_PATTERN,
  byteLength,
  requireService,
  exactKeys,
  metadata,
  isPrintableReference
} from './support.js';

const MAX_PATHS = 25;
const MAX_JOBS = 32;
const DESCRIPTOR_KEYS = [
  'id', 'localId', 'driveId', 'status', 'dryRun', 'prune', 'prefix',
  'counts', 'paths', 'pathsCapped', 'limitReason', 'error'
];
const COUNT_KEYS = ['diffs', 'files', 'add', 'change', 'remove', 'bytesObserved', 'bytesAdded', 'bytesRemoved'];
const STATUSES = new Set(['queued', 'running', 'stopping', 'completed', 'capped', 'failed', 'stopped']);
const LIMIT_REASONS = new Set(['maxDiffs', 'maxDurationMs', 'maxBytesObserved']);

function assertReference(value, label) {
  if (!isPrintableReference(value)) {
    throw new Error(`${label} must be a non-empty printable string.`);
  }
}

function normalizePrefix(value = '/') {
  if (typeof value !== 'string' || !value || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new Error('Mirror prefix contains invalid characters.');
  }
  const prefix = value.startsWith('/') ? value : `/${value}`;
  if (prefix !== '/' && prefix.split('/').slice(1).some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Mirror prefix must be normalized and must not contain traversal.');
  }
  if (byteLength(prefix) > 512) throw new Error('Mirror prefix is too large.');
  return prefix;
}

function safeDescriptor(value) {
  if (!exactKeys(value, DESCRIPTOR_KEYS)) throw new Error('Mirror service returned an invalid descriptor.');
  if (!exactKeys(value.counts, COUNT_KEYS) || COUNT_KEYS.some((key) => !Number.isSafeInteger(value.counts[key]) || value.counts[key] < 0)) {
    throw new Error('Mirror service returned invalid counts.');
  }
  assertReference(value.id, 'Mirror id');
  assertReference(value.localId, 'Localdrive id');
  assertReference(value.driveId, 'Drive id');
  if (!STATUSES.has(value.status) || value.dryRun !== true || value.prune !== false) {
    throw new Error('Mirror service returned an unsafe descriptor.');
  }
  const prefix = normalizePrefix(value.prefix);
  if (!Array.isArray(value.paths) || value.paths.length > MAX_PATHS || typeof value.pathsCapped !== 'boolean') {
    throw new Error('Mirror service returned invalid paths.');
  }
  const paths = value.paths.map((item) => {
    const safe = normalizePrefix(item);
    if (safe === '/') throw new Error('Mirror service returned an invalid path.');
    return safe;
  });
  if (value.error !== null && (typeof value.error !== 'string' || value.error.length > 160 || CONTROL_PATTERN.test(value.error))) {
    throw new Error('Mirror service returned an invalid error.');
  }
  if (value.limitReason !== null && !LIMIT_REASONS.has(value.limitReason)) {
    throw new Error('Mirror service returned an invalid limit reason.');
  }
  return {
    id: value.id,
    localId: value.localId,
    driveId: value.driveId,
    status: value.status,
    dryRun: true,
    prune: false,
    prefix,
    counts: { ...value.counts },
    paths,
    pathsCapped: value.pathsCapped,
    limitReason: value.limitReason,
    error: value.error
  };
}

function summary(row) {
  const counts = row.counts;
  return [
    `${row.id}: ${row.status} (dry run, no prune)`,
    `Source: ${row.localId}`,
    `Destination: ${row.driveId}`,
    `Prefix: ${row.prefix}`,
    `Changes: ${counts.add} add, ${counts.change} update, ${counts.remove} remove; ${counts.bytesAdded} bytes added`,
    ...(row.paths.length ? [`Paths${row.pathsCapped ? ' (first results)' : ''}: ${row.paths.join(', ')}`] : []),
    ...(row.limitReason ? [`Limit: ${row.limitReason}`] : []),
    ...(row.error ? [`Error: ${row.error}`] : [])
  ].join('\n');
}

async function handleMirror(parsed, services) {
  const [requestedAction, ...args] = parsed.args;
  const action = requestedAction?.toLowerCase();
  if (!['start', 'status', 'stop'].includes(action)) {
    throw new Error('Use /mirror start <localdrive> <drive>, /mirror status [id], or /mirror stop <id>.');
  }
  const flagKeys = Reflect.ownKeys(parsed.flags);
  if (action !== 'start' && flagKeys.length) throw new Error(`/mirror ${action} does not accept flags.`);

  if (action === 'start') {
    if (args.length !== 2) throw new Error('/mirror start expects a Localdrive reference and a Hyperdrive reference.');
    assertReference(args[0], 'Localdrive reference');
    assertReference(args[1], 'Drive reference');
    if (flagKeys.some((key) => !['dry-run', 'no-prune', 'prefix'].includes(key))) {
      if (Object.hasOwn(parsed.flags, 'apply')) throw new Error('Mirror apply is unavailable because race-safe Localdrive reads cannot be guaranteed.');
      if (Object.hasOwn(parsed.flags, 'prune')) throw new Error('Mirror prune is not supported.');
      throw new Error('/mirror start accepts only --dry-run, --no-prune, and --prefix=/safe/path.');
    }
    if ((Object.hasOwn(parsed.flags, 'dry-run') && parsed.flags['dry-run'] !== true) ||
        (Object.hasOwn(parsed.flags, 'no-prune') && parsed.flags['no-prune'] !== true)) {
      throw new Error('--dry-run and --no-prune must be boolean flags.');
    }
    const prefix = normalizePrefix(parsed.flags.prefix === undefined ? '/' : parsed.flags.prefix);
    const mirror = requireService(services, 'mirror', 'Mirror service is unavailable.');
    if (typeof mirror.start !== 'function') throw new Error('Mirror service is unavailable.');
    const row = safeDescriptor(await mirror.start(args[0], args[1], { dryRun: true, prune: false, prefix }));
    return {
      content: `Started one-shot MirrorDrive dry run. No files will be changed or pruned.\n${summary(row)}`,
      metadata: metadata('slash-mirror', 'mirror', action, { descriptor: row })
    };
  }

  if (action === 'status') {
    if (args.length > 1) throw new Error('/mirror status expects zero or one job id.');
    if (args[0] !== undefined) assertReference(args[0], 'Mirror id');
    const mirror = requireService(services, 'mirror', 'Mirror service is unavailable.');
    if (typeof mirror.status !== 'function') throw new Error('Mirror service is unavailable.');
    const result = await mirror.status(args[0]);
    if (args[0] !== undefined) {
      const row = safeDescriptor(result);
      return { content: summary(row), metadata: metadata('slash-mirror', 'mirror', action, { descriptor: row }) };
    }
    if (!Array.isArray(result) || result.length > MAX_JOBS) throw new Error('Mirror service returned an invalid list.');
    const rows = result.map(safeDescriptor);
    return {
      content: rows.length ? `Mirror jobs (${rows.length}):\n${rows.map(summary).join('\n\n')}` : 'No Mirror jobs.',
      metadata: metadata('slash-mirror', 'mirror', action, { descriptors: rows })
    };
  }

  if (args.length !== 1) throw new Error('/mirror stop expects one job id.');
  assertReference(args[0], 'Mirror id');
  const mirror = requireService(services, 'mirror', 'Mirror service is unavailable.');
  if (typeof mirror.stop !== 'function') throw new Error('Mirror service is unavailable.');
  const row = safeDescriptor(await mirror.stop(args[0]));
  return { content: `Stopped Mirror job.\n${summary(row)}`, metadata: metadata('slash-mirror', 'mirror', action, { descriptor: row }) };
}

export { handleMirror };
