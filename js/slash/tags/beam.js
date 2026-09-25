const KEY_PATTERN = /^[a-z2-7]{52}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_NAME_CHARS = 80;
const MAX_REFERENCE_CHARS = 160;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DESCRIPTOR_KEYS = ['id', 'name', 'status', 'connected', 'pending', 'sentMessages', 'sentBytes', 'receivedMessages', 'receivedBytes'];
const STATUSES = new Set(['connecting', 'open', 'closed', 'error']);
const ACTIONS = ['create', 'join', 'list', 'status', 'send', 'receive', 'close'];

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function requireService(services) {
  const service = services?.beam;
  if (!service) throw new Error('Beam service is unavailable.');
  return service;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key));
}

function assertName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_NAME_CHARS || CONTROL_PATTERN.test(value)) {
    throw new Error(`Beam name must be 1-${MAX_NAME_CHARS} printable characters.`);
  }
}

function assertReference(value, label = 'Beam reference') {
  if (typeof value !== 'string' || !value || value.length > MAX_REFERENCE_CHARS || CONTROL_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-empty printable string.`);
  }
}

function assertKey(value) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new Error('Beam key must be a 52-character lowercase base32 capability.');
  }
  return value;
}

function assertCount(key, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Beam service returned an invalid ${key}.`);
  return value;
}

function safeDescriptor(value) {
  if (!exactKeys(value, DESCRIPTOR_KEYS)) throw new Error('Beam service returned an invalid descriptor.');
  assertReference(value.id, 'Beam id');
  assertName(value.name);
  if (!STATUSES.has(value.status)) throw new Error('Beam service returned an invalid status.');
  if (typeof value.connected !== 'boolean') throw new Error('Beam service returned an invalid connected state.');
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    connected: value.connected,
    pending: assertCount('pending', value.pending),
    sentMessages: assertCount('sentMessages', value.sentMessages),
    sentBytes: assertCount('sentBytes', value.sentBytes),
    receivedMessages: assertCount('receivedMessages', value.receivedMessages),
    receivedBytes: assertCount('receivedBytes', value.receivedBytes)
  };
}

function safeSendResult(value) {
  if (!exactKeys(value, ['id', 'bytes', 'sentMessages', 'sentBytes'])) throw new Error('Beam service returned an invalid send result.');
  assertReference(value.id, 'Beam id');
  return {
    id: value.id,
    bytes: assertCount('bytes', value.bytes),
    sentMessages: assertCount('sentMessages', value.sentMessages),
    sentBytes: assertCount('sentBytes', value.sentBytes)
  };
}

function safeReceiveResult(value) {
  if (!exactKeys(value, ['messages', 'bytes', 'pending'])) throw new Error('Beam service returned an invalid receive result.');
  if (!Array.isArray(value.messages) || value.messages.some((message) => typeof message !== 'string' || byteLength(message) > MAX_MESSAGE_BYTES)) {
    throw new Error('Beam service returned an invalid message list.');
  }
  return {
    messages: [...value.messages],
    bytes: assertCount('bytes', value.bytes),
    pending: assertCount('pending', value.pending)
  };
}

function metadata(action, extra = {}) {
  return { kind: 'slash-beam', command: 'beam', action, ...extra };
}

function summary(row) {
  return [
    `${row.name} (${row.id}): ${row.status}${row.connected ? ', connected' : ''}`,
    `Sent: ${row.sentMessages} messages / ${row.sentBytes} bytes`,
    `Received: ${row.receivedMessages} messages / ${row.receivedBytes} bytes`,
    `Pending: ${row.pending}`
  ].join('\n');
}

async function handleBeam(parsed, services) {
  if (Reflect.ownKeys(parsed.flags).length) throw new Error('/beam does not accept flags.');
  const [requestedAction, ...args] = parsed.args;
  const action = requestedAction?.toLowerCase();
  if (!ACTIONS.includes(action)) {
    throw new Error('Use /beam create, join, list, status, send, receive, or close.');
  }

  if (action === 'create') {
    if (args.length !== 1) throw new Error('/beam create expects one name.');
    assertName(args[0]);
  } else if (action === 'join') {
    if (args.length !== 2) throw new Error('/beam join expects a name and a beam key.');
    assertName(args[0]);
    assertKey(args[1]);
  } else if (action === 'list') {
    if (args.length !== 0) throw new Error('/beam list does not accept arguments.');
  } else if (action === 'send') {
    if (args.length < 2) throw new Error('/beam send expects a beam id and text.');
    assertReference(args[0]);
    if (byteLength(args.slice(1).join(' ')) > MAX_MESSAGE_BYTES) throw new Error('Beam content is too large.');
  } else {
    if (args.length !== 1) throw new Error(`/beam ${action} expects one beam id or name.`);
    assertReference(args[0]);
  }

  const beam = requireService(services);
  if (typeof beam[action] !== 'function') throw new Error('Beam service is unavailable.');

  if (action === 'create') {
    const result = await beam.create(args[0]);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Beam service returned an invalid result.');
    const row = safeDescriptor(result.descriptor);
    const key = assertKey(result.key);
    return {
      content: `Created ephemeral beam ${row.name} (${row.id}). Share this capability once:\n${key}`,
      metadata: metadata(action, { descriptor: row })
    };
  }

  if (action === 'list') {
    const result = await beam.list();
    if (!Array.isArray(result)) throw new Error('Beam service returned an invalid list.');
    const rows = result.map(safeDescriptor);
    return {
      content: rows.length ? `Beams (${rows.length}):\n${rows.map(summary).join('\n\n')}` : 'No active beams.',
      metadata: metadata(action, { descriptors: rows })
    };
  }

  if (action === 'join') {
    const row = safeDescriptor(await beam.join(args[0], assertKey(args[1])));
    return { content: `Joined beam ${row.name} (${row.id}).`, metadata: metadata(action, { descriptor: row }) };
  }

  if (action === 'status') {
    const row = safeDescriptor(await beam.status(args[0]));
    return { content: summary(row), metadata: metadata(action, { descriptor: row }) };
  }

  if (action === 'send') {
    const result = safeSendResult(await beam.send(args[0], args.slice(1).join(' ')));
    return { content: `Sent ${result.bytes} bytes to ${result.id}.`, metadata: metadata(action, { result }) };
  }

  if (action === 'receive') {
    const result = safeReceiveResult(await beam.receive(args[0]));
    return {
      content: result.messages.length ? `Received (${result.messages.length}):\n${result.messages.join('\n')}` : 'No pending messages.',
      metadata: metadata(action, { result })
    };
  }

  const row = safeDescriptor(await beam.close(args[0]));
  return { content: `Closed beam ${row.name} (${row.id}).`, metadata: metadata(action, { descriptor: row }) };
}

export { handleBeam };
