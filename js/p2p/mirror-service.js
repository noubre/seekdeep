import MirrorDrive from 'mirror-drive';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_REFERENCE_CHARS = 160;
const MAX_PREFIX_BYTES = 512;
const MAX_JOBS = 32;
const MAX_PATHS = 25;
const MAX_DIFFS = 1000;
const MAX_DURATION_MS = 10000;
const MAX_BYTES_OBSERVED = 64 * 1024 * 1024;
const MAX_ID_ATTEMPTS = 8;
const STATUSES = new Set(['queued', 'running', 'stopping', 'completed', 'capped', 'failed', 'stopped']);

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function normalizeReference(value, label) {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a non-empty printable string`);
  }
  return value;
}

function normalizePrefix(value = '/') {
  if (typeof value !== 'string' || !value || value.includes('\\') || CONTROL_PATTERN.test(value)) {
    throw new TypeError('Mirror prefix contains invalid characters');
  }
  const prefix = value.startsWith('/') ? value : `/${value}`;
  if (prefix !== '/' && prefix.split('/').slice(1).some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Mirror prefix must be normalized and must not contain traversal');
  }
  if (b4a.byteLength(prefix) > MAX_PREFIX_BYTES) throw new RangeError('Mirror prefix is too large');
  return prefix;
}

function normalizeOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Mirror options must be an object');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !['dryRun', 'prune', 'prefix'].includes(key))) {
    throw new TypeError('Mirror options contain an unsupported field');
  }
  const dryRun = value.dryRun === undefined ? true : value.dryRun;
  const prune = value.prune === undefined ? false : value.prune;
  if (typeof dryRun !== 'boolean') throw new TypeError('Mirror dryRun must be a boolean');
  if (typeof prune !== 'boolean') throw new TypeError('Mirror prune must be a boolean');
  if (!dryRun) throw new Error('Mirror apply is unavailable because race-safe Localdrive reads cannot be guaranteed');
  if (prune) throw new Error('Mirror prune is not supported');
  return { dryRun: true, prune: false, prefix: normalizePrefix(value.prefix ?? '/') };
}

function defaultIdFactory() {
  return `mirror-${b4a.toString(crypto.randomBytes(12), 'hex')}`;
}

function safeBytes(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeSum(...values) {
  let total = 0;
  for (const value of values) {
    const next = safeBytes(value);
    if (next > Number.MAX_SAFE_INTEGER - total) return Number.MAX_SAFE_INTEGER;
    total += next;
  }
  return total;
}

function createMirrorService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Mirror service options must be an object');
  const localdriveService = options.localdriveService;
  const driveService = options.driveService;
  const MirrorDriveConstructor = options.MirrorDrive || MirrorDrive;
  const idFactory = options.idFactory || defaultIdFactory;
  const maxJobs = positiveInteger(options.maxJobs ?? MAX_JOBS, 'maxJobs');
  const maxPaths = positiveInteger(options.maxPaths ?? MAX_PATHS, 'maxPaths');
  const maxDiffs = positiveInteger(options.maxDiffs ?? MAX_DIFFS, 'maxDiffs');
  const maxDurationMs = positiveInteger(options.maxDurationMs ?? MAX_DURATION_MS, 'maxDurationMs');
  const maxBytesObserved = positiveInteger(options.maxBytesObserved ?? MAX_BYTES_OBSERVED, 'maxBytesObserved');
  if (!localdriveService || typeof localdriveService.resolveMirrorSource !== 'function') throw new TypeError('Mirror Localdrive resolver is required');
  if (!driveService || typeof driveService.resolveMirrorDestination !== 'function') throw new TypeError('Mirror Hyperdrive resolver is required');
  if (typeof MirrorDriveConstructor !== 'function') throw new TypeError('MirrorDrive must be a constructor');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');

  const jobs = new Map();
  let work = Promise.resolve();
  let shutdown = false;
  let closing = null;
  let startReservations = 0;

  function descriptor(job) {
    if (!STATUSES.has(job.status)) throw new Error('Mirror job has an invalid status');
    return {
      id: job.id,
      localId: job.localId,
      driveId: job.driveId,
      status: job.status,
      dryRun: true,
      prune: false,
      prefix: job.prefix,
      counts: { ...job.counts },
      paths: [...job.paths],
      pathsCapped: job.pathsCapped,
      limitReason: job.limitReason,
      error: job.error
    };
  }

  function allocateId() {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = idFactory();
      if (typeof id !== 'string' || !id || id.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(id)) {
        throw new TypeError('Mirror idFactory returned an invalid id');
      }
      if (!jobs.has(id)) return id;
    }
    throw new Error('Unable to allocate a unique Mirror id');
  }

  function recordDiff(job, diff) {
    if (!diff || typeof diff !== 'object') throw new Error('MirrorDrive returned an invalid diff');
    const key = normalizePrefix(diff.key);
    if (key === '/') throw new Error('MirrorDrive returned an invalid file path');
    if (!['add', 'change', 'remove', 'equal'].includes(diff.op)) throw new Error('MirrorDrive returned an invalid operation');
    job.counts.diffs += 1;
    job.counts.bytesObserved = safeSum(job.counts.bytesObserved, diff.bytesAdded, diff.bytesRemoved);
    if (diff.op === 'equal') return;
    job.counts.files += 1;
    job.counts[diff.op] += 1;
    job.counts.bytesAdded += safeBytes(diff.bytesAdded);
    job.counts.bytesRemoved += safeBytes(diff.bytesRemoved);
    if (job.paths.length < maxPaths) job.paths.push(key);
    else job.pathsCapped = true;
  }

  function cleanupIterator(job) {
    if (job.iteratorCleanup) return job.iteratorCleanup;
    const iterator = job.iterator;
    job.iteratorCleanup = Promise.resolve().then(async () => {
      if (iterator && typeof iterator.return === 'function') await iterator.return();
    });
    return job.iteratorCleanup;
  }

  function cap(job, reason) {
    job.limitReason = reason;
    job.status = 'capped';
  }

  async function execute(job) {
    if (job.stopRequested) {
      job.status = 'stopped';
      return;
    }
    job.status = 'running';
    let validated = false;
    try {
      await job.source.validate();
      validated = true;
      if (job.stopRequested) {
        job.status = 'stopped';
        return;
      }
      const mirror = new MirrorDriveConstructor(job.source.drive, job.destination.drive, {
        dryRun: true,
        prune: false,
        prefix: job.prefix,
        progress: false,
        batch: true
      });
      const iterator = mirror[Symbol.asyncIterator]();
      if (!iterator || typeof iterator.next !== 'function') throw new Error('MirrorDrive returned an invalid iterator');
      job.iterator = iterator;
      job.startedAt = Date.now();
      while (!job.stopRequested) {
        if (job.counts.diffs >= maxDiffs) {
          cap(job, 'maxDiffs');
          break;
        }
        if (Date.now() - job.startedAt >= maxDurationMs) {
          cap(job, 'maxDurationMs');
          break;
        }
        const result = await iterator.next();
        if (job.stopRequested) break;
        if (!result || typeof result !== 'object') throw new Error('MirrorDrive returned an invalid iterator result');
        if (result.done) break;
        recordDiff(job, result.value);
        if (job.counts.bytesObserved >= maxBytesObserved) {
          cap(job, 'maxBytesObserved');
          break;
        }
      }
      if (job.stopRequested) job.status = 'stopped';
      else if (job.status !== 'capped') job.status = 'completed';
    } catch {
      job.status = 'failed';
      job.error = 'Mirror dry run failed';
    } finally {
      try {
        await cleanupIterator(job);
      } catch {
        job.status = 'failed';
        job.error = 'Mirror dry run failed';
      }
      if (validated) {
        try {
          await job.source.validate();
        } catch {
          job.status = 'failed';
          job.error = 'Mirror source changed during dry run';
        }
      }
      job.iterator = null;
      job.iteratorCleanup = null;
      job.source = null;
      job.destination = null;
    }
  }

  return Object.freeze({
    async start(localReference, driveReference, optionsValue = {}) {
      if (shutdown) throw new Error('Mirror service is closed');
      if (jobs.size + startReservations >= maxJobs) throw new RangeError('Mirror job limit reached');
      const localRef = normalizeReference(localReference, 'Localdrive reference');
      const driveRef = normalizeReference(driveReference, 'Drive reference');
      const safeOptions = normalizeOptions(optionsValue);
      startReservations += 1;
      let source;
      let destination;
      try {
        source = await localdriveService.resolveMirrorSource(localRef);
        destination = await driveService.resolveMirrorDestination(driveRef);
      } finally {
        startReservations -= 1;
      }
      if (shutdown) throw new Error('Mirror service is closed');
      if (!source || typeof source.id !== 'string' || !source.drive || typeof source.validate !== 'function') {
        throw new Error('Localdrive mirror source is unavailable');
      }
      if (!destination || typeof destination.id !== 'string' || !destination.drive || destination.writable !== true) {
        throw new Error('Mirror destination must be open and writable');
      }
      const job = {
        id: allocateId(),
        localId: normalizeReference(source.id, 'Localdrive id'),
        driveId: normalizeReference(destination.id, 'Drive id'),
        status: 'queued',
        prefix: safeOptions.prefix,
        counts: { diffs: 0, files: 0, add: 0, change: 0, remove: 0, bytesObserved: 0, bytesAdded: 0, bytesRemoved: 0 },
        paths: [],
        pathsCapped: false,
        limitReason: null,
        error: null,
        source,
        destination,
        stopRequested: false,
        iterator: null,
        iteratorCleanup: null,
        startedAt: null
      };
      jobs.set(job.id, job);
      work = work.then(() => execute(job), () => execute(job));
      work.catch(() => {});
      return descriptor(job);
    },
    async status(id) {
      if (id === undefined) return Array.from(jobs.values(), descriptor);
      const reference = normalizeReference(id, 'Mirror id');
      const job = jobs.get(reference);
      if (!job) throw new Error('Mirror job was not found');
      return descriptor(job);
    },
    async stop(id) {
      const reference = normalizeReference(id, 'Mirror id');
      const job = jobs.get(reference);
      if (!job) throw new Error('Mirror job was not found');
      if (job.status === 'queued') {
        job.stopRequested = true;
        job.status = 'stopped';
      } else if (job.status === 'running') {
        job.stopRequested = true;
        job.status = 'stopping';
        cleanupIterator(job).catch(() => {});
      } else if (job.status !== 'stopping' && job.status !== 'stopped') {
        throw new Error('Mirror job is not running');
      }
      return descriptor(job);
    },
    close() {
      if (closing) return closing;
      shutdown = true;
      for (const job of jobs.values()) {
        if (job.status === 'queued') {
          job.stopRequested = true;
          job.status = 'stopped';
        } else if (job.status === 'running') {
          job.stopRequested = true;
          job.status = 'stopping';
          cleanupIterator(job).catch(() => {});
        }
      }
      closing = work;
      return closing;
    }
  });
}

export {
  MAX_JOBS,
  MAX_PATHS,
  MAX_DIFFS,
  MAX_DURATION_MS,
  MAX_BYTES_OBSERVED,
  normalizePrefix,
  createMirrorService
};
