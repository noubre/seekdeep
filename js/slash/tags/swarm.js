import { requireService } from './support.js';

const TOPIC_PATTERN = /^[0-9a-f]{64}$/i;
const NO_ARGUMENT_ACTIONS = new Set(['status', 'create', 'leave', 'peers']);

function assertNoArguments(action, args) {
  if (args.length > 0) throw new Error(`/swarm ${action} does not accept arguments.`);
}

function lifecycleResult(action, state) {
  const active = Boolean(state.topic);
  let content;
  if (action === 'create') {
    content = `Created local swarm as host.\nTopic: ${state.topic}`;
  } else if (action === 'join') {
    content = `Joined local swarm as joiner.\nTopic: ${state.topic}`;
  } else {
    content = 'Left the local swarm.';
  }

  return {
    content,
    metadata: {
      kind: 'slash-swarm',
      command: 'swarm',
      action,
      initialized: Boolean(state.initialized),
      active,
      role: state.role,
      connected: Boolean(state.connected),
      peerCount: state.peerCount,
      ...(active ? { topic: state.topic } : {})
    }
  };
}

function statusResult(state) {
  const active = Boolean(state.topic);
  const content = !state.initialized
    ? 'Swarm is not initialized.'
    : !active
      ? 'Swarm is initialized but has no active topic.'
      : [
          `Swarm active as ${state.role}.`,
          `Topic: ${state.topic}`,
          `Peers: ${state.peerCount}`,
          `Connected: ${state.connected ? 'yes' : 'no'}`
        ].join('\n');

  return {
    content,
    metadata: {
      kind: 'slash-swarm',
      command: 'swarm',
      action: 'status',
      initialized: Boolean(state.initialized),
      active,
      role: state.role,
      connected: Boolean(state.connected),
      peerCount: state.peerCount,
      ...(active ? { topic: state.topic } : {})
    }
  };
}

function peersResult(peers) {
  const content = peers.length === 0
    ? 'No connected swarm peers.'
    : `Swarm peers (${peers.length}):\n${peers.map((peer) => (
        `- ${peer.displayName} (${peer.id}, ${peer.role})`
      )).join('\n')}`;

  return {
    content,
    metadata: {
      kind: 'slash-swarm',
      command: 'swarm',
      action: 'peers',
      peerCount: peers.length,
      peers
    }
  };
}

async function handleSwarm(parsed, services) {
  const [requestedAction = 'status', ...args] = parsed.args;
  const action = requestedAction.toLowerCase();

  if (NO_ARGUMENT_ACTIONS.has(action)) assertNoArguments(action, args);
  if (action === 'join') {
    if (args.length !== 1 || !TOPIC_PATTERN.test(args[0])) {
      throw new Error('/swarm join requires exactly one 64-character hexadecimal topic.');
    }
  } else if (!NO_ARGUMENT_ACTIONS.has(action)) {
    throw new Error(`Unknown /swarm action: ${requestedAction}. Use status, create, join, leave, or peers.`);
  }

  const swarm = requireService(services, 'swarm', 'Swarm service is unavailable.');
  if (action === 'status') return statusResult(await swarm.status());
  if (action === 'peers') return peersResult(await swarm.peers());
  if (action === 'create') return lifecycleResult(action, await swarm.create());
  if (action === 'join') return lifecycleResult(action, await swarm.join(args[0]));
  return lifecycleResult(action, await swarm.leave());
}

export { handleSwarm };
