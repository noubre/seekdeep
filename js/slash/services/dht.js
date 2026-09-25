import { getDHTDiagnostics } from '../../network/hyperswarm.js';

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

function normalizeHex(value) {
  return typeof value === 'string' && HEX_KEY_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeConnectionCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createDHTService(dependencies) {
  const { getDHTDiagnostics } = dependencies;

  return Object.freeze({
    status() {
      const diagnostics = getDHTDiagnostics() || {};
      const initialized = Boolean(diagnostics.initialized);
      return {
        initialized,
        publicKey: initialized ? normalizeHex(diagnostics.publicKey) : null,
        topic: initialized ? normalizeHex(diagnostics.topic) : null,
        connectionCount: initialized
          ? normalizeConnectionCount(diagnostics.connectionCount)
          : 0,
        listening: !initialized
          ? false
          : typeof diagnostics.listening === 'boolean'
            ? diagnostics.listening
            : null
      };
    }
  });
}

const dhtService = createDHTService({ getDHTDiagnostics });

export { createDHTService, dhtService };
