/**
 * Build the pure /p2p handler around harness-provided help formatters. The help
 * text reflects the live plugin registry, so the formatters are resolved from
 * `services.harness` at call time rather than captured.
 */
function createP2PHandler(help) {
  if (!help || typeof help.allHelp !== 'function' || typeof help.commandHelp !== 'function') {
    throw new TypeError('createP2PHandler requires allHelp(services) and commandHelp(target, services)');
  }

  return function handleP2P(parsed, services) {
    const [action, target] = parsed.args;

    if (!action || action.toLowerCase() === 'help') {
      return {
        content: target ? help.commandHelp(target, services) : help.allHelp(services),
        metadata: { kind: 'slash-help', command: target || 'p2p' }
      };
    }

    return {
      content: `Unknown /p2p action: ${action}\n\n${help.allHelp(services)}`,
      metadata: { kind: 'slash-help', command: 'p2p', error: 'unknown-action' }
    };
  };
}

export { createP2PHandler };
