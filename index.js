import Runtime from 'pear-electron';
import Bridge from 'pear-bridge';
import {
  createDriveBackend,
  resolveDriveStorageRoot,
  resolveLocaldriveStorageRoot
} from './js/p2p/drive-runtime.js';

const bridge = new Bridge();
await bridge.ready();

const runtime = new Runtime();
const pipe = await runtime.start({ bridge });
const backend = createDriveBackend(pipe, {
  storageRoot: resolveDriveStorageRoot(),
  localdriveRoot: resolveLocaldriveStorageRoot()
});

let shutdownPromise = null;
function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = backend.close().finally(() => {
    if (globalThis.Pear?.exit) globalThis.Pear.exit(code);
    else process.exit(code);
  });
  return shutdownPromise;
}

pipe.once('close', () => { void shutdown(); });
pipe.once('error', () => { void shutdown(1); });
globalThis.Pear?.teardown?.(() => backend.close());
