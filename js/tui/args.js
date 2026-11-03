/**
 * Parse the terminal entrypoint's launch arguments.
 *
 * Lenient by design (mirrors `js/p2p/bootstrap-args.js`): an invalid value is
 * ignored rather than thrown, so a typo degrades to the default instead of
 * refusing to start. The TUI runs under Node only.
 */
import path from 'path';
import os from 'os';

const DEFAULT_STORAGE_DIRNAME = '.seekdeep';
const TOPIC_PATTERN = /^[0-9a-f]{64}$/i;
const PROVIDERS = new Set(['ollama', 'lmstudio']);

function absoluteStorage(value) {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  // `resolveAppStorage` rejects the filesystem root; ignore such input here.
  if (path.dirname(resolved) === resolved) return null;
  return resolved;
}

/**
 * @param {unknown} args - Usually `process.argv.slice(2)`.
 * @param {{ env?: Object, homedir?: string }} [options]
 * @returns {{ storage: string, model: string|null, provider: string|null, topic: string|null, color: boolean }}
 */
function parseTuiArgs(args, options = {}) {
  const env = options.env || process.env;
  const homedir = typeof options.homedir === 'string' && options.homedir
    ? options.homedir
    : os.homedir();

  let storageArg = null;
  let model = null;
  let provider = null;
  let topic = null;
  let noColor = false;

  if (Array.isArray(args)) {
    for (const arg of args) {
      if (typeof arg !== 'string') continue;

      if (arg.startsWith('--storage=')) {
        storageArg = arg.slice('--storage='.length);
        continue;
      }
      if (arg === '--no-color') {
        noColor = true;
        continue;
      }
      if (arg.startsWith('--model=')) {
        const value = arg.slice('--model='.length).trim();
        if (value) model = value;
        continue;
      }
      if (arg.startsWith('--provider=')) {
        const value = arg.slice('--provider='.length).trim().toLowerCase();
        if (PROVIDERS.has(value)) provider = value;
        continue;
      }
      if (arg.startsWith('--topic=')) {
        const value = arg.slice('--topic='.length).trim();
        if (TOPIC_PATTERN.test(value)) topic = value.toLowerCase();
      }
    }
  }

  const envStorage = typeof env?.SEEKDEEP_STORAGE === 'string' ? env.SEEKDEEP_STORAGE : '';
  const storage = absoluteStorage(storageArg)
    || absoluteStorage(envStorage)
    || path.join(homedir, DEFAULT_STORAGE_DIRNAME);

  const color = !noColor && env?.NO_COLOR === undefined;

  return { storage, model, provider, topic, color };
}

export { DEFAULT_STORAGE_DIRNAME, parseTuiArgs };
