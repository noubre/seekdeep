/**
 * Shared entrypoint glue.
 *
 * Launch-argument and fetch resolution, the process shutdown latch, and the
 * bridge's no-local-providers stub live here so `bridge.js` does not carry its own copy.
 */

/**
 * Resolve the launch arguments: a non-empty `Pear.config.args`, then Bare's
 * `argv` (argv[0]/argv[1] are reserved; the first user arg is argv[2]), then
 * Node's `process.argv`.
 * @returns {string[]}
 */
function resolveLaunchArgs() {
  const config = globalThis.Pear?.config;
  if (Array.isArray(config?.args) && config.args.length) return config.args;
  const bareArgv = globalThis.Bare?.argv;
  if (Array.isArray(bareArgv)) return bareArgv.slice(2);
  return process.argv.slice(2);
}

/**
 * Resolve a fetch implementation: the platform global first, then `bare-fetch`.
 * @returns {Promise<Function>}
 */
async function resolveRuntimeFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  const module = await import('bare-fetch');
  const resolved = module.default || module;
  if (typeof resolved !== 'function') throw new Error('bare-fetch did not provide a fetch implementation');
  return resolved;
}

/**
 * Exit the process through the Pear runtime when present, else `process.exit`.
 * @param {number} code
 */
function defaultExit(code) {
  if (globalThis.Pear?.exit) return globalThis.Pear.exit(code);
  return process.exit(code);
}

/**
 * Install the process shutdown latch and its SIGINT/SIGTERM wiring.
 * @param {{ close: () => unknown, beforeExit?: () => unknown, exit?: (code: number) => unknown }} options
 * @returns {{ shutdown: (code?: number) => Promise<void> }}
 */
function installShutdown({ close, beforeExit = () => {}, exit = defaultExit }) {
  let shutdownPromise = null;

  function shutdown(code = 0) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try { await beforeExit(); } catch { /* entrypoints report their own errors */ }
      try { await close(); } catch { /* ignore */ }
      exit(code);
    })();
    return shutdownPromise;
  }

  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });

  return { shutdown };
}

/**
 * A provider router that never answers locally: used by the bridge, where the
 * host peer owns the real providers.
 * @returns {Object}
 */
function createNoLocalProviders() {
  const unavailable = async () => { throw new Error('bridge has no local providers'); };
  return { providers: [], ask: unavailable, listModels: unavailable, autoSelect: unavailable };
}

export { resolveLaunchArgs, resolveRuntimeFetch, installShutdown, defaultExit, createNoLocalProviders };
