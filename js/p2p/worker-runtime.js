import path from 'path';
import { createHyperdriveService } from './hyperdrive-service.js';
import { createLocaldriveService } from './localdrive-service.js';
import { createMirrorService } from './mirror-service.js';
import { createBeamService } from './beam-service.js';
import { createChatService } from './chat-service.js';
import { createApiService } from '../openai/api-service.js';
import { createResourceRpcMethods, createJsonRpcServer } from './rpc-server.js';
import { createBotService } from './bot-service.js';
import { createHarness } from '../harness/harness.js';
import { createHarnessSync } from '../harness/sync.js';

const DRIVE_STORAGE_DIRECTORY = 'seekdeep-hyperdrives-v1';
const LOCALDRIVE_STORAGE_DIRECTORY = 'seekdeep-localdrives-v1';

function resolveAppStorage(config) {
  if (config === undefined) {
    config = globalThis.Pear?.app;
    if (!config?.storage) {
      try { config = globalThis.Pear?.config; } catch {}
    }
  }
  const storage = config?.storage;
  const resolved = typeof storage === 'string' && storage ? path.resolve(storage) : '';
  if (!resolved || !path.isAbsolute(storage) || path.dirname(resolved) === resolved) {
    throw new Error('Pear application storage must be an absolute non-root path');
  }
  return resolved;
}

function resolveDriveStorageRoot(config) {
  return path.join(resolveAppStorage(config), DRIVE_STORAGE_DIRECTORY);
}

function resolveLocaldriveStorageRoot(config) {
  return path.join(resolveAppStorage(config), LOCALDRIVE_STORAGE_DIRECTORY);
}

/**
 * Locate the bundled `plugins/` directory. In the Bare worker this resolves
 * relative to this module; the Pear config directory is the fallback.
 */
function resolveBuiltinPluginsDir() {
  try {
    if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string' && import.meta.url) {
      const modulePath = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '').split('?')[0].split('#')[0]);
      return path.resolve(path.dirname(modulePath), '..', '..', 'plugins');
    }
  } catch {}
  const dir = globalThis.Pear?.config?.dir;
  if (typeof dir === 'string' && dir) return path.join(dir, 'plugins');
  return null;
}

async function createWorkerBackend(pipe, options = {}) {
  if (!pipe || typeof pipe.on !== 'function' || typeof pipe.write !== 'function') throw new TypeError('Runtime pipe must be duplex');
  const service = options.service || createHyperdriveService({
    storageRoot: options.storageRoot || resolveDriveStorageRoot(options.config),
    swarmFactory: options.swarmFactory,
    maxDrives: options.maxDrives,
    maxPeers: options.maxPeers,
    readTimeout: options.readTimeout
  });
  const localdriveService = options.localdriveService || createLocaldriveService({
    localdriveRoot: options.localdriveRoot || resolveLocaldriveStorageRoot(options.config),
    maxMappings: options.maxLocaldrives,
    maxFiles: options.maxLocaldriveFiles,
    fs: options.fs
  });
  const mirrorService = options.mirrorService || createMirrorService({
    localdriveService,
    driveService: service,
    maxJobs: options.maxMirrorJobs,
    maxPaths: options.maxMirrorPaths
  });
  const beamService = options.beamService || createBeamService({
    maxBeams: options.maxBeams,
    maxPendingMessages: options.maxBeamPendingMessages,
    maxBufferBytes: options.maxBeamBufferBytes
  });
  const chatService = options.chatService || (options.providers
    ? createChatService({
        providers: options.providers,
        swarmFactory: options.swarmFactory,
        bootstrap: options.bootstrap,
        now: options.now,
        maxPeers: options.maxChatPeers
      })
    : null);
  // The OpenAI surface is optional: Node callers pass `node:http`, the packed Bare
  // worklet passes `bare-http1`, and a backend built without either simply has no API.
  const apiService = options.http
    ? createApiService({ chatService, http: options.http })
    : null;
  const harness = options.harness || (options.disableHarness
    ? null
    : await createHarness({
        storageRoot: resolveAppStorage(options.config),
        builtinPluginsDir: options.builtinPluginsDir || resolveBuiltinPluginsDir(),
        userPluginsDir: options.userPluginsDir,
        syncedPluginsDir: options.syncedPluginsDir,
        configPath: options.harnessConfigPath,
        driveService: service,
        localdriveService: localdriveService,
        mirrorService: mirrorService,
        beamService: beamService,
        chatService,
        providers: options.providers,
        initialKey: options.harnessKey,
        now: options.now,
        logger: options.harnessLogger,
        fs: options.fs,
        createSync: (context) => createHarnessSync(context),
        createBot: (context) => createBotService({
          key: context.key,
          providers: context.providers,
          model: context.config?.bot?.model || undefined,
          swarmFactory: options.swarmFactory,
          now: context.now
        })
      }));
  const rpc = createJsonRpcServer(
    pipe,
    createResourceRpcMethods({ drive: service, localdrive: localdriveService, mirror: mirrorService, beam: beamService, chat: chatService, harness, api: apiService }),
    options.rpcOptions
  );
  if (chatService) {
    chatService.onEvent((event) => {
      const { type, ...data } = event;
      rpc.notify('chat.event', { type, ...data }).catch(() => {});
    });
  }
  if (harness) {
    harness.onEvent((event) => {
      const { type, ...data } = event;
      rpc.notify('harness.event', { type, ...data }).catch(() => {});
    });
  }
  let closing = null;

  return Object.freeze({
    service,
    localdriveService,
    mirrorService,
    beamService,
    chatService,
    apiService,
    harness,
    rpc,
    close() {
      if (closing) return closing;
      closing = (async () => {
        const errors = [];
        try { await rpc.close(); } catch (error) { errors.push(error); }
        // The API server holds the HTTP port and a backend that references the chat
        // service, so it goes down before the service it depends on.
        if (apiService) { try { await apiService.close(); } catch (error) { errors.push(error); } }
        if (harness) { try { await harness.close(); } catch (error) { errors.push(error); } }
        try { await mirrorService.close(); } catch (error) { errors.push(error); }
        try { await beamService.close(); } catch (error) { errors.push(error); }
        if (chatService) { try { await chatService.close(); } catch (error) { errors.push(error); } }
        try { await service.close(); } catch (error) { errors.push(error); }
        try { await localdriveService.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Drive backend shutdown failed');
      })();
      return closing;
    }
  });
}

export {
  DRIVE_STORAGE_DIRECTORY,
  LOCALDRIVE_STORAGE_DIRECTORY,
  resolveDriveStorageRoot,
  resolveLocaldriveStorageRoot,
  createWorkerBackend
};
