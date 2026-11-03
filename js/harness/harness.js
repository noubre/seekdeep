/**
 * The SeekDeep harness core.
 *
 * Discovers and loads plugins from three sources (built-in, user, synced),
 * builds the slash runtime from their commands, and exposes the services,
 * lifecycle hooks, and event stream the worker relays to the renderer.
 */
import path from 'path';
import { createSlashRuntime } from '../slash/registry.js';
import { createResourceRpcMethods } from '../p2p/rpc-server.js';
import { createHarnessFiles } from './files.js';
import { createLocalClient } from './local-client.js';
import { createHarnessServices } from './services.js';
import { validatePlugin } from './plugin.js';

const CONFIG_VERSION = 1;
const CONFIG_FILENAME = 'harness.json';
const USER_PLUGINS_DIRECTORY = 'plugins';
const SYNCED_PLUGINS_DIRECTORY = 'plugins-synced';
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

function assertAbsolute(value, label) {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value) || path.dirname(path.resolve(value)) === path.resolve(value)) {
    throw new TypeError(`${label} must be an absolute non-root path`);
  }
  return path.resolve(value);
}

function fileUrl(file) {
  const normalized = file.split(path.sep).join('/');
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${absolute.split('/').map(encodeURIComponent).join('/')}`;
}

function defaultConfig() {
  return { version: CONFIG_VERSION, key: null, disabledPlugins: [], bot: { enabled: false, model: null } };
}

function normalizeConfig(value) {
  const base = defaultConfig();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const key = typeof value.key === 'string' && KEY_PATTERN.test(value.key) ? value.key.toLowerCase() : null;
  const disabledPlugins = Array.isArray(value.disabledPlugins)
    ? value.disabledPlugins.filter((name) => typeof name === 'string' && name)
    : [];
  const bot = value.bot && typeof value.bot === 'object' && !Array.isArray(value.bot)
    ? { enabled: Boolean(value.bot.enabled), model: typeof value.bot.model === 'string' ? value.bot.model : null }
    : base.bot;
  return { version: CONFIG_VERSION, key, disabledPlugins, bot };
}

const PLUGIN_TEMPLATE = `/**
 * Custom SeekDeep plugin: {{name}}
 *
 * Edit the handler below, then run /harness reload in the composer. A plugin's
 * default export is a plain object; no imports are required.
 */
export default {
  name: '{{name}}',
  version: '0.1.0',
  description: 'My custom plugin.',
  commands: [
    {
      name: '{{command}}',
      summary: 'Say hello from {{name}}.',
      usage: '/{{command}} [name]',
      handler(parsed) {
        const who = parsed.args[0] || 'world';
        return { content: 'Hello, ' + who + '!', metadata: { kind: 'slash-help', command: '{{command}}' } };
      }
    }
  ]
};
`;

async function createHarness(options = {}) {
  const storageRoot = assertAbsolute(options.storageRoot, 'storageRoot');
  const files = createHarnessFiles(options.fs);
  const logger = options.logger || console;
  const now = options.now || (() => Date.now());
  const importModule = options.importModule || ((specifier) => import(specifier));
  const userPluginsDir = options.userPluginsDir || path.join(storageRoot, USER_PLUGINS_DIRECTORY);
  const syncedPluginsDir = options.syncedPluginsDir || path.join(storageRoot, SYNCED_PLUGINS_DIRECTORY);
  const builtinPluginsDir = options.builtinPluginsDir || null;
  const configPath = options.configPath || path.join(storageRoot, CONFIG_FILENAME);

  const config = normalizeConfig(await files.readJson(configPath));
  if (options.initialKey) {
    if (typeof options.initialKey === 'string' && KEY_PATTERN.test(options.initialKey)) {
      config.key = options.initialKey.toLowerCase();
    } else {
      logger.warn?.(`[harness] ignoring invalid --harness-key value`);
    }
  }

  const eventHandlers = new Set();
  const backlog = [];

  function emit(event) {
    if (eventHandlers.size === 0) {
      if (backlog.length < 64) backlog.push(event);
      return;
    }
    for (const handler of eventHandlers) {
      try { handler(event); } catch (error) { logger.error?.('[harness] event handler failed:', error); }
    }
  }

  function onEvent(handler) {
    if (typeof handler !== 'function') throw new TypeError('onEvent requires a function');
    eventHandlers.add(handler);
    if (backlog.length) {
      const pending = backlog.splice(0, backlog.length);
      for (const event of pending) {
        try { handler(event); } catch (error) { logger.error?.('[harness] event handler failed:', error); }
      }
    }
    return () => eventHandlers.delete(handler);
  }

  async function saveConfig() {
    try {
      await files.writeJson(configPath, config);
    } catch (error) {
      logger.warn?.(`[harness] failed to persist config: ${error.message}`);
    }
  }

  const sources = [
    builtinPluginsDir && { kind: 'builtin', dir: builtinPluginsDir },
    { kind: 'user', dir: userPluginsDir },
    { kind: 'synced', dir: syncedPluginsDir }
  ].filter(Boolean);

  let loadCounter = 0;
  let loaded = [];
  let sync = null;
  let bot = null;

  async function loadModule(entryPath) {
    const specifier = `${fileUrl(entryPath)}?v=${++loadCounter}`;
    try {
      return await importModule(specifier);
    } catch (error) {
      if (typeof globalThis.require === 'function') {
        try { return globalThis.require(entryPath); } catch {}
      }
      throw error;
    }
  }

  async function discoverPlugins() {
    const plugins = [];
    const seen = new Set();
    for (const source of sources) {
      for (const name of await files.listDirs(source.dir)) {
        if (seen.has(name)) {
          emit({ type: 'plugin', status: 'skipped', plugin: name, source: source.kind, message: `Duplicate plugin name: ${name}` });
          continue;
        }
        if (config.disabledPlugins.includes(name)) {
          seen.add(name);
          emit({ type: 'plugin', status: 'disabled', plugin: name, source: source.kind });
          continue;
        }
        const entryPath = path.join(source.dir, name, 'index.js');
        let module;
        try {
          module = await loadModule(entryPath);
        } catch (error) {
          seen.add(name);
          emit({ type: 'plugin', status: 'error', plugin: name, source: source.kind, message: `Failed to import: ${error.message}` });
          continue;
        }
        let plugin;
        try {
          const candidate = module?.default ?? module;
          plugin = candidate?.name && candidate?.version ? validatePlugin(candidate) : null;
          if (!plugin) throw new TypeError('Plugin must export a default plugin definition');
        } catch (error) {
          seen.add(name);
          emit({ type: 'plugin', status: 'error', plugin: name, source: source.kind, message: error.message });
          continue;
        }
        seen.add(name);
        plugins.push({ plugin, source: source.kind, dir: source.dir, name });
        emit({ type: 'plugin', status: 'loaded', plugin: plugin.name, source: source.kind });
      }
    }
    return plugins;
  }

  const state = { runtime: null };

  function publicList() {
    return {
      key: config.key,
      storageRoot,
      dirs: { builtin: builtinPluginsDir, user: userPluginsDir, synced: syncedPluginsDir },
      configPath,
      plugins: loaded.map((entry) => ({
        name: entry.plugin.name,
        version: entry.plugin.version,
        description: entry.plugin.description || '',
        source: entry.source,
        enabled: !config.disabledPlugins.includes(entry.plugin.name),
        commands: entry.plugin.commands.map((command) => command.name)
      }))
    };
  }

  // The harness facade is referenced by `services`, which plugins use during
  // activate(); it closes over `state`/`sync` so later rebinding stays live.
  const harnessFacade = Object.freeze({
    list: () => publicList(),
    plugins: () => publicList().plugins,
    dirs: () => publicList().dirs,
    allHelp: () => (state.runtime ? state.runtime.allHelp() : ''),
    commandHelp: (target) => (state.runtime ? state.runtime.commandHelp(target) : ''),
    key: () => config.key,
    status: () => (sync ? sync.status() : { key: config.key, role: config.key ? 'follower' : 'none', available: false }),
    create: (...args) => (sync ? sync.create(...args) : Promise.reject(new Error('Harness sync is unavailable'))),
    push: (...args) => (sync ? sync.push(...args) : Promise.reject(new Error('Harness sync is unavailable'))),
    pull: (...args) => (sync ? sync.pull(...args) : Promise.reject(new Error('Harness sync is unavailable'))),
    join: (...args) => (sync ? sync.join(...args) : Promise.reject(new Error('Harness sync is unavailable'))),
    leave: (...args) => (sync ? sync.leave(...args) : Promise.reject(new Error('Harness sync is unavailable'))),
    reload: () => reload(),
    scaffold: (name) => scaffoldPlugin(name),
    enable: (name) => setEnabled(name, true),
    disable: (name) => setEnabled(name, false)
  });

  const botFacade = Object.freeze({
    status: () => (bot ? bot.status() : { available: false, enabled: false }),
    enable: (...args) => (bot ? bot.enable(...args) : Promise.reject(new Error('A harness key is required for bots'))),
    disable: (...args) => (bot ? bot.disable(...args) : Promise.reject(new Error('A harness key is required for bots'))),
    peers: (...args) => (bot ? bot.peers(...args) : Promise.resolve([])),
    send: (...args) => (bot ? bot.send(...args) : Promise.reject(new Error('A harness key is required for bots'))),
    broadcast: (...args) => (bot ? bot.broadcast(...args) : Promise.reject(new Error('A harness key is required for bots')))
  });

  const client = createLocalClient(createResourceRpcMethods({
    drive: options.driveService,
    localdrive: options.localdriveService,
    mirror: options.mirrorService,
    beam: options.beamService,
    chat: options.chatService
  }));
  const services = createHarnessServices({ client, harness: harnessFacade, bot: botFacade });

  async function activateAll() {
    for (const entry of loaded) {
      if (!entry.plugin.activate) continue;
      try {
        await entry.plugin.activate({
          harness: harnessFacade,
          services,
          config,
          storageDir: storageRoot,
          pluginDir: path.join(entry.dir, entry.name),
          source: entry.source,
          log: logger
        });
      } catch (error) {
        emit({ type: 'plugin', status: 'error', plugin: entry.plugin.name, source: entry.source, message: `activate failed: ${error.message}` });
      }
    }
  }

  async function deactivateAll() {
    for (const entry of loaded) {
      if (!entry.plugin.deactivate) continue;
      try {
        await entry.plugin.deactivate({ harness: harnessFacade, services, storageDir: storageRoot, log: logger });
      } catch (error) {
        logger.warn?.(`[harness] ${entry.plugin.name} deactivate failed: ${error.message}`);
      }
    }
  }

  async function reload() {
    await deactivateAll();
    loaded = await discoverPlugins();
    state.runtime = createSlashRuntime(loaded.flatMap((entry) => entry.plugin.commands));
    await activateAll();
    return publicList();
  }

  async function setEnabled(name, enabled) {
    if (typeof name !== 'string' || !name) throw new TypeError('Plugin name must be a non-empty string');
    const disabled = new Set(config.disabledPlugins);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    config.disabledPlugins = Array.from(disabled);
    await saveConfig();
    await reload();
    return publicList().plugins.find((plugin) => plugin.name === name) || null;
  }

  async function scaffoldPlugin(name) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
      throw new TypeError('Plugin name must be lowercase letters, digits, or hyphens and start with a letter');
    }
    const dir = path.join(userPluginsDir, name);
    if (await files.exists(dir)) throw new Error(`A plugin directory already exists: ${dir}`);
    const source = PLUGIN_TEMPLATE.replaceAll('{{name}}', name).replaceAll('{{command}}', name);
    await files.writeText(path.join(dir, 'index.js'), source);
    emit({ type: 'plugin', status: 'scaffolded', plugin: name, source: 'user', path: dir });
    return { name, path: path.join(dir, 'index.js') };
  }

  async function dispatch(text) {
    if (!state.runtime) return false;
    return state.runtime.dispatch(text, {
      emitEphemeral(content, metadata) {
        emit({ type: 'slash', content, metadata });
      }
    }, services);
  }

  await files.ensureDir(userPluginsDir);
  await files.ensureDir(syncedPluginsDir);
  await reload();

  function botEvent(event) {
    const { type, ...rest } = event;
    emit({ type: 'bot', kind: type, ...rest });
  }

  async function rebuildBot() {
    if (bot) {
      try { await bot.close?.(); } catch {}
      bot = null;
    }
    if (!config.key || typeof options.createBot !== 'function') return;
    const created = options.createBot({ key: config.key, providers: options.providers, config, now });
    if (created?.onEvent) created.onEvent(botEvent);
    bot = created;
  }

  if (typeof options.createSync === 'function') {
    sync = options.createSync({
      storageRoot, userPluginsDir, syncedPluginsDir, driveService: options.driveService,
      files, now, emit, reload,
      getKey: () => config.key,
      setKey: async (key) => {
        config.key = key || null;
        await saveConfig();
        await rebuildBot();
      }
    });
  }
  await rebuildBot();

  let closing = null;
  return Object.freeze({
    services,
    get runtime() { return state.runtime; },
    list: () => publicList(),
    dispatch,
    onEvent,
    reload,
    enable: (name) => setEnabled(name, true),
    disable: (name) => setEnabled(name, false),
    scaffold: (name) => scaffoldPlugin(name),
    sync: () => sync,
    bot: () => bot,
    close() {
      if (closing) return closing;
      closing = (async () => {
        await deactivateAll();
        try { await bot?.close?.(); } catch (error) { logger.warn?.(`[harness] bot close failed: ${error.message}`); }
        try { await sync?.close?.(); } catch (error) { logger.warn?.(`[harness] sync close failed: ${error.message}`); }
      })();
      return closing;
    }
  });
}

export { createHarness, defaultConfig, normalizeConfig, KEY_PATTERN, PLUGIN_TEMPLATE };