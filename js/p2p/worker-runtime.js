import path from 'path';
import { createHyperdriveService } from './hyperdrive-service.js';
import { createLocaldriveService } from './localdrive-service.js';
import { createMirrorService } from './mirror-service.js';
import { createBeamService } from './beam-service.js';
import { createChatService } from './chat-service.js';
import { createResourceRpcMethods, createJsonRpcServer } from './rpc-server.js';

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

function unavailableLocaldriveService() {
  const unavailable = async () => { throw new Error('Localdrive service is unavailable'); };
  return Object.freeze({
    add: unavailable,
    list: unavailable,
    status: unavailable,
    files: unavailable,
    get: unavailable,
    put: unavailable,
    remove: unavailable,
    close: async () => {}
  });
}

function unavailableMirrorService() {
  const unavailable = async () => { throw new Error('Mirror service is unavailable'); };
  return Object.freeze({ start: unavailable, status: unavailable, stop: unavailable, close: async () => {} });
}

function unavailableBeamService() {
  const unavailable = async () => { throw new Error('Beam service is unavailable'); };
  return Object.freeze({ create: unavailable, join: unavailable, list: unavailable, status: unavailable, send: unavailable, receive: unavailable, closeBeam: unavailable, close: async () => {} });
}

function createWorkerBackend(pipe, options = {}) {
  if (!pipe || typeof pipe.on !== 'function' || typeof pipe.write !== 'function') throw new TypeError('Runtime pipe must be duplex');
  const service = options.service || createHyperdriveService({
    storageRoot: options.storageRoot || resolveDriveStorageRoot(options.config),
    swarmFactory: options.swarmFactory,
    maxDrives: options.maxDrives,
    maxPeers: options.maxPeers,
    readTimeout: options.readTimeout
  });
  // Existing test/injection callers that supply only a Hyperdrive service retain
  // their narrow fake. Production always creates the real app-scoped Localdrive.
  const localdriveService = options.localdriveService || (options.service
    ? unavailableLocaldriveService()
    : createLocaldriveService({
        localdriveRoot: options.localdriveRoot || resolveLocaldriveStorageRoot(options.config),
        maxMappings: options.maxLocaldrives,
        maxFiles: options.maxLocaldriveFiles
      }));
  const mirrorService = options.mirrorService || (options.service
    ? unavailableMirrorService()
    : createMirrorService({
        localdriveService,
        driveService: service,
        maxJobs: options.maxMirrorJobs,
        maxPaths: options.maxMirrorPaths
      }));
  const beamService = options.beamService || (options.service
    ? unavailableBeamService()
    : createBeamService({
        maxBeams: options.maxBeams,
        maxPendingMessages: options.maxBeamPendingMessages,
        maxBufferBytes: options.maxBeamBufferBytes
      }));
  const chatService = options.chatService || (options.providers
    ? createChatService({
        providers: options.providers,
        swarmFactory: options.swarmFactory,
        bootstrap: options.bootstrap,
        now: options.now,
        maxPeers: options.maxChatPeers
      })
    : null);
  const rpc = createJsonRpcServer(
    pipe,
    createResourceRpcMethods({ drive: service, localdrive: localdriveService, mirror: mirrorService, beam: beamService, chat: chatService }),
    options.rpcOptions
  );
  if (chatService) {
    chatService.onEvent((event) => {
      const { type, ...data } = event;
      rpc.notify('chat.event', { type, ...data }).catch(() => {});
    });
  }
  let closing = null;

  return Object.freeze({
    service,
    localdriveService,
    mirrorService,
    beamService,
    chatService,
    rpc,
    close() {
      if (closing) return closing;
      closing = (async () => {
        const errors = [];
        try { await rpc.close(); } catch (error) { errors.push(error); }
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
