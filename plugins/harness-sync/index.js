/**
 * Built-in harness-sync plugin: the /harness command.
 */
import { definePlugin } from '../../js/harness/plugin.js';
import { handleHarness } from '../../js/slash/tags/harness.js';

export default definePlugin({
  name: 'harness-sync',
  version: '1.0.0',
  description: 'Publish or follow a harness key and manage plugins.',
  commands: [
    {
      name: 'harness',
      summary: 'Manage the harness key, sync, and plugins.',
      usage: '/harness <status|key|create|push|pull|join <64hex>|leave|plugins|new <name>|enable <name>|disable <name>|reload>',
      handler: handleHarness
    }
  ]
});
