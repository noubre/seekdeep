import { requireService } from './support.js';

/**
 * /harness — inspect the harness, manage the sync key, and author plugins.
 */
const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const NO_ARGUMENT_ACTIONS = new Set(['status', 'key', 'create', 'push', 'pull', 'leave', 'plugins', 'reload']);
const USAGE = 'Use status, key, create, push, pull, join <64hex>, leave, plugins, new <name>, enable <name>, disable <name>, or reload.';

function result(content, metadata = {}) {
  return { content, metadata: { kind: 'slash-harness', command: 'harness', ...metadata } };
}

function describeStatus(status) {
  if (!status || !status.key) return 'Harness has no key. Run /harness create to publish this machine, or /harness join <64hex>.';
  const role = status.role || 'unknown';
  const suffix = role === 'owner' ? ' (this machine publishes)' : role === 'follower' ? ' (read-only follower)' : '';
  return `Harness key: ${status.key}\nRole: ${role}${suffix}\nPlugins dir: see /harness plugins`;
}

function pluginListing(harness) {
  const plugins = harness.list().plugins;
  if (!plugins.length) return 'No plugins are loaded.';
  return `Loaded plugins (${plugins.length}):\n${plugins.map((plugin) => (
    `- ${plugin.name}@${plugin.version} [${plugin.source}]${plugin.enabled ? '' : ' (disabled)'} — ${plugin.commands.map((c) => `/${c}`).join(', ') || 'no commands'}`
  )).join('\n')}`;
}

async function handleHarness(parsed, services) {
  const [requested = 'status', ...args] = parsed.args;
  const action = requested.toLowerCase();
  const harness = requireService(services, 'harness', 'Harness service is unavailable.');

  if (NO_ARGUMENT_ACTIONS.has(action) && args.length > 0) {
    throw new Error(`/harness ${action} does not accept arguments.`);
  }

  if (action === 'status') {
    const status = await harness.status();
    return result(describeStatus(status), { action, key: status?.key || null, role: status?.role || 'none' });
  }

  if (action === 'key') {
    const key = harness.key();
    return result(key ? `Harness key: ${key}` : describeStatus(await harness.status()), { action, key: key || null });
  }

  if (action === 'create') {
    const created = await harness.create();
    return result(`Published this machine's plugins.\nHarness key: ${created.key}\nShare it with peers, then they run /harness join ${created.key}.`, { action, key: created.key, files: created.files });
  }

  if (action === 'push') {
    const pushed = await harness.push();
    return result(`Pushed ${pushed.files} plugin file(s) to the harness drive.`, { action, key: pushed.key, files: pushed.files });
  }

  if (action === 'pull') {
    const pulled = await harness.pull();
    return result(`Pulled ${pulled.files} plugin file(s) from the harness drive.`, { action, files: pulled.files });
  }

  if (action === 'join') {
    if (args.length !== 1 || !KEY_PATTERN.test(args[0])) {
      throw new Error('/harness join requires exactly one 64-character hexadecimal harness key.');
    }
    const joined = await harness.join(args[0]);
    return result(`Joined harness as a follower.\nHarness key: ${joined.key}\nPulled ${joined.files} plugin file(s).`, { action, key: joined.key, files: joined.files });
  }

  if (action === 'leave') {
    await harness.leave();
    return result('Left the harness key. Synced plugins will no longer be loaded after reload.', { action });
  }

  if (action === 'plugins') {
    return result(pluginListing(harness), { action });
  }

  if (action === 'reload') {
    await harness.reload();
    return result(`Reloaded plugins.\n${pluginListing(harness)}`, { action });
  }

  if (action === 'new') {
    if (args.length !== 1) throw new Error('/harness new requires exactly one plugin name.');
    const created = await harness.scaffold(args[0]);
    await harness.reload();
    return result(`Created plugin "${args[0]}" at ${created.path}. Edit it, then run /harness reload.`, { action, name: args[0] });
  }

  if (action === 'enable' || action === 'disable') {
    if (args.length !== 1) throw new Error(`/harness ${action} requires exactly one plugin name.`);
    await harness[action](args[0]);
    return result(`${action === 'enable' ? 'Enabled' : 'Disabled'} plugin "${args[0]}".`, { action, name: args[0] });
  }

  throw new Error(`Unknown /harness action: ${requested}. ${USAGE}`);
}

export { handleHarness };
