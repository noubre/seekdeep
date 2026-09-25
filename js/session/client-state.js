/**
 * Renderer-side session snapshot.
 *
 * Keeps the small amount of room state the UI needs, updated exclusively from
 * `chat.event` payloads. No DOM access; consumers subscribe for updates.
 */

const INITIAL_STATE = Object.freeze({
  topic: null,
  role: 'none',
  connected: false,
  peerCount: 0,
  collaborative: false,
  peers: [],
  provider: null,
  models: []
});

function createClientState(initial = {}) {
  let state = { ...INITIAL_STATE, ...initial };
  const listeners = new Set();

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setState(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try { listener(state); } catch { /* a view must not break state updates */ }
    }
  }

  function applyEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    switch (event.type) {
      case 'status':
        setState({
          topic: event.topic ?? null,
          role: event.role ?? 'none',
          connected: Boolean(event.connected),
          peerCount: Number.isSafeInteger(event.peerCount) ? event.peerCount : 0,
          collaborative: typeof event.collaborative === 'boolean' ? event.collaborative : state.collaborative,
          provider: event.provider ?? state.provider
        });
        break;
      case 'peers':
        setState({ peers: Array.isArray(event.peers) ? event.peers : [] });
        break;
      case 'mode':
        setState({ collaborative: event.collaborative === true });
        break;
      case 'models':
        setState({
          provider: event.provider ?? state.provider,
          models: Array.isArray(event.models) ? event.models : []
        });
        break;
      default:
        break;
    }
  }

  return Object.freeze({ getState, subscribe, setState, applyEvent });
}

// Shared renderer instance used by the views and main entry.
const clientState = createClientState();
const getState = () => clientState.getState();
const subscribe = (listener) => clientState.subscribe(listener);
const applyEvent = (event) => clientState.applyEvent(event);

export { INITIAL_STATE, createClientState, clientState, getState, subscribe, applyEvent };