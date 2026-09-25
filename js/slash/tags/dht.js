const ACTIONS = new Set(['status', 'key', 'nodes']);

function requireDHTService(services) {
  const service = services?.dht;
  if (!service || typeof service.status !== 'function') {
    throw new Error('DHT diagnostics service is unavailable.');
  }
  return service;
}

function listeningLabel(listening) {
  return listening === null ? 'unknown' : listening ? 'yes' : 'no';
}

function statusMetadata(state) {
  return {
    kind: 'slash-dht',
    command: 'dht',
    action: 'status',
    initialized: Boolean(state.initialized),
    publicKeyAvailable: Boolean(state.publicKey),
    topic: state.topic || null,
    connectionCount: state.connectionCount,
    listening: state.listening
  };
}

function statusResult(state) {
  const content = !state.initialized
    ? 'DHT diagnostics unavailable: Hyperswarm is not initialized.'
    : [
        'DHT diagnostics:',
        'Initialized: yes',
        `Listening: ${listeningLabel(state.listening)}`,
        `Connections: ${state.connectionCount}`,
        `Discovery topic: ${state.topic || 'none'}`,
        `Local public key: ${state.publicKey ? 'available' : 'unavailable'}`
      ].join('\n');

  return { content, metadata: statusMetadata(state) };
}

function keyResult(state) {
  if (!state.publicKey) {
    const reason = state.initialized
      ? 'the initialized Hyperswarm instance did not provide one'
      : 'Hyperswarm is not initialized';
    throw new Error(`The local public key is unavailable because ${reason}.`);
  }

  return {
    content: `Local DHT public key: ${state.publicKey}`,
    metadata: {
      kind: 'slash-dht',
      command: 'dht',
      action: 'key',
      publicKey: state.publicKey
    }
  };
}

function nodesResult(state) {
  return {
    content: [
      'Routing table details are not available through the current Hyperswarm diagnostics.',
      `Available connection count: ${state.connectionCount}`,
      `Initialized: ${state.initialized ? 'yes' : 'no'}`,
      `Listening: ${listeningLabel(state.listening)}`
    ].join('\n'),
    metadata: {
      kind: 'slash-dht',
      command: 'dht',
      action: 'nodes',
      limitation: 'routing-table-unavailable',
      initialized: Boolean(state.initialized),
      connectionCount: state.connectionCount,
      listening: state.listening
    }
  };
}

async function handleDHT(parsed, services) {
  const [requestedAction = 'status', ...args] = parsed.args;
  const action = requestedAction.toLowerCase();

  if (!ACTIONS.has(action) || args.length > 0) {
    throw new Error(`Unknown or invalid /dht action: ${requestedAction}. Use status, key, or nodes without extra arguments.`);
  }

  const state = await requireDHTService(services).status();
  if (action === 'status') return statusResult(state);
  if (action === 'key') return keyResult(state);
  return nodesResult(state);
}

export { handleDHT };
