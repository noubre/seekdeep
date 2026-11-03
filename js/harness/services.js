/**
 * Builds the `services` object handed to every slash command handler.
 *
 * The P2P facades are the existing `js/slash/services/*` adapters wired to the
 * in-process local client; `harness` and `bot` are direct worker-side facades.
 */
import { createSwarmService } from '../slash/services/swarm.js';
import { createDHTService } from '../slash/services/dht.js';
import { createDriveService } from '../slash/services/drive.js';
import { createLocaldriveService } from '../slash/services/localdrive.js';
import { createMirrorService } from '../slash/services/mirror.js';
import { createBeamService } from '../slash/services/beam.js';
import { createChatSlashService } from '../slash/services/chat.js';

function createHarnessServices({ client, harness, bot }) {
  if (!client || typeof client.request !== 'function') throw new TypeError('Harness services require a local client');
  return Object.freeze({
    swarm: createSwarmService(client),
    dht: createDHTService(client),
    drive: createDriveService(client),
    localdrive: createLocaldriveService(client),
    mirror: createMirrorService(client),
    beam: createBeamService(client),
    chat: createChatSlashService(client),
    harness,
    bot
  });
}

export { createHarnessServices };