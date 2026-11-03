import { requireService } from './support.js';

/**
 * /bot — control the peer bot and exchange messages with peer harnesses.
 */
function result(content, metadata = {}) {
  return { content, metadata: { kind: 'slash-bot', command: 'bot', ...metadata } };
}

function describe(status) {
  if (!status?.available) return 'Bots require a harness key. Run /harness create (or /harness join <64hex>) first.';
  return [
    `Bot: ${status.enabled ? 'enabled' : 'disabled'}`,
    `Name: ${status.name}`,
    status.topic ? `Topic: ${status.topic}` : null,
    `Peers: ${status.peers ?? 0}`
  ].filter(Boolean).join('\n');
}

async function handleBot(parsed, services) {
  const [requested = 'status', ...args] = parsed.args;
  const action = requested.toLowerCase();
  const bot = requireService(services, 'bot', 'Bot service is unavailable.');

  if (action === 'status') {
    const status = await bot.status();
    return result(describe(status), { action, enabled: Boolean(status?.enabled), peers: status?.peers ?? 0 });
  }

  if (action === 'enable') {
    if (args.length > 0) throw new Error('/bot enable does not accept arguments.');
    const status = await bot.enable();
    return result(`Bot enabled.\n${describe(status)}`, { action, enabled: true });
  }

  if (action === 'disable') {
    if (args.length > 0) throw new Error('/bot disable does not accept arguments.');
    const status = await bot.disable();
    return result(`Bot disabled.\n${describe(status)}`, { action, enabled: false });
  }

  if (action === 'peers') {
    if (args.length > 0) throw new Error('/bot peers does not accept arguments.');
    const peers = await bot.peers();
    const content = peers.length === 0
      ? 'No bot peers are connected.'
      : `Bot peers (${peers.length}):\n${peers.map((peer) => `- ${peer.name || 'peer'} (${peer.id})`).join('\n')}`;
    return result(content, { action, count: peers.length });
  }

  if (action === 'send') {
    const [peer, ...rest] = args;
    const text = rest.join(' ').trim();
    if (!peer || !text) throw new Error('/bot send requires a peer id and message text.');
    await bot.send(peer, text);
    return result(`Sent to ${peer}: ${text}`, { action, peer });
  }

  if (action === 'broadcast') {
    const text = args.join(' ').trim();
    if (!text) throw new Error('/bot broadcast requires message text.');
    const sent = await bot.broadcast(text);
    return result(`Broadcast to ${sent.delivered} peer(s): ${text}`, { action, delivered: sent.delivered });
  }

  throw new Error(`Unknown /bot action: ${requested}. Use status, enable, disable, peers, send <peer> <text>, or broadcast <text>.`);
}

export { handleBot };
