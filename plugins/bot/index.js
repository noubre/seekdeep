/**
 * Built-in bot plugin: the /bot command. Disabled until a harness key exists;
 * auto-enables when harness.json sets `bot.enabled`.
 */
import { definePlugin } from '../../js/harness/plugin.js';
import { handleBot } from '../../js/slash/tags/bot.js';

export default definePlugin({
  name: 'bot',
  version: '1.0.0',
  description: 'Talk to peer harnesses over the harness key, with LLM auto-replies.',
  commands: [
    {
      name: 'bot',
      summary: 'Talk to peer harnesses sharing this harness key.',
      usage: '/bot <status|enable|disable|peers|send <peer> <text>|broadcast <text>>',
      handler: handleBot
    }
  ],
  async activate(ctx) {
    if (!ctx.config?.bot?.enabled) return;
    try {
      await ctx.services.bot.enable();
    } catch (error) {
      ctx.log?.warn?.(`[bot] auto-enable failed: ${error.message}`);
    }
  },
  async deactivate(ctx) {
    try {
      await ctx.services.bot.disable();
    } catch {}
  }
});
