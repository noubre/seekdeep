const TOPIC_PATTERN = /^[0-9a-f]{64}$/i;
const NO_ARGUMENT_ACTIONS = new Set(['status', 'create', 'leave', 'peers']);

function requireSwarmService(services) {
  const service = services?.swarm;
  if (!service) throw new Error('Swarm service is unavailable.');
  return service;
}

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

function handleSwarm(parsed, services) {
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

  const swarm = requireSwarmService(services);
  if (action === 'status') return statusResult(swarm.status());
  if (action === 'peers') return peersResult(swarm.peers());
  if (action === 'create') return lifecycleResult(action, swarm.create());
  if (action === 'join') return lifecycleResult(action, swarm.join(args[0]));
  return lifecycleResult(action, swarm.leave());
}

export { handleSwarm };
