/**
 * Built-in p2p-core plugin: the default SeekDeep peer-to-peer slash commands.
 */
import { definePlugin } from '../../js/harness/plugin.js';
import { createP2PHandler } from '../../js/slash/tags/p2p.js';
import { handleSwarm } from '../../js/slash/tags/swarm.js';
import { handleDHT } from '../../js/slash/tags/dht.js';
import { handleDrive } from '../../js/slash/tags/drive.js';
import { handleLocaldrive } from '../../js/slash/tags/localdrive.js';
import { handleMirror } from '../../js/slash/tags/mirror.js';
import { handleBeam } from '../../js/slash/tags/beam.js';

const handleP2P = createP2PHandler({
  allHelp: (services) => services.harness.allHelp(),
  commandHelp: (target, services) => services.harness.commandHelp(target)
});

export default definePlugin({
  name: 'p2p-core',
  version: '1.0.0',
  description: 'Default SeekDeep peer-to-peer slash commands.',
  commands: [
    {
      name: 'p2p',
      summary: 'Show local help for SeekDeep peer-to-peer commands.',
      usage: '/p2p help [command]',
      aliases: ['help'],
      aliasArguments: { help: ['help'] },
      handler: handleP2P
    },
    {
      name: 'swarm',
      summary: 'Inspect and manage peer discovery.',
      usage: '/swarm [status|create|join <64hex>|leave|peers]',
      handler: handleSwarm
    },
    {
      name: 'dht',
      summary: 'Inspect distributed hash table state.',
      usage: '/dht [status|key|nodes]',
      handler: handleDHT
    },
    {
      name: 'drive',
      summary: 'Manage shared Hyperdrive content.',
      usage: '/drive <create|open|list|status|put|get|files|del|close> [arguments]',
      handler: handleDrive
    },
    {
      name: 'localdrive',
      summary: 'Manage local filesystem drive mappings.',
      usage: '/localdrive <add|remove|list|status|files|get|put> [arguments]',
      handler: handleLocaldrive
    },
    {
      name: 'mirror',
      summary: 'Dry-run a one-shot Localdrive to Hyperdrive mirror.',
      usage: '/mirror <start <localdrive> <drive> [--dry-run] [--prefix=/safe/path] [--no-prune]|status [id]|stop <id>>',
      handler: handleMirror
    },
    {
      name: 'beam',
      summary: 'Host or join an ephemeral one-to-one beam.',
      usage: '/beam <create <name>|join <name> <key>|list|status <id>|send <id> <text>|receive <id>|close <id>>',
      handler: handleBeam
    }
  ]
});
