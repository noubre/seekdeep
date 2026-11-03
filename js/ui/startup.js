/**
 * Renderer startup reconciliation.
 *
 * The worker is authoritative for room state: after creating the initial room
 * the GUI re-reads a `chat.status` snapshot and applies it to client state, so
 * the initial render does not depend on the timing of `chat.event` delivery.
 */
async function createInitialRoom({ chatClient, applyEvent, reportError }) {
  if (!chatClient?.api?.create) {
    throw new TypeError('createInitialRoom requires a chat create API');
  }
  if (typeof applyEvent !== 'function' || typeof reportError !== 'function') {
    throw new TypeError('createInitialRoom requires applyEvent and reportError callbacks');
  }

  let room;
  try {
    room = await chatClient.api.create();
  } catch (error) {
    const message = error?.message || 'unknown startup error';
    reportError(`Could not create a chat room: ${message}`);
    return { ok: false, phase: 'create', error: message };
  }

  // Keep the known room identity renderable even if the authoritative status
  // snapshot is unavailable or delayed; status below reconciles when it is.
  if (room && (room.topic || room.role)) {
    applyEvent({ type: 'status', topic: room.topic, role: room.role });
  }

  try {
    const status = await chatClient.api.status();
    applyEvent({ type: 'status', ...status });
    return { ok: true, status };
  } catch (error) {
    const message = error?.message || 'unknown startup error';
    reportError(`Could not read the chat room status: ${message}`);
    return { ok: false, phase: 'status', roomCreated: true, room, error: message };
  }
}

export { createInitialRoom };