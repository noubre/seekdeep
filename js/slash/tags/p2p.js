/**
 * Build the pure /p2p handler around local help formatters.
 */
function createP2PHandler(help) {
  return function handleP2P(parsed, _services) {
    const [action, target] = parsed.args;

    if (!action || action.toLowerCase() === 'help') {
      return {
        content: target ? help.command(target) : help.all(),
        metadata: { kind: 'slash-help', command: target || 'p2p' }
      };
    }

    return {
      content: `Unknown /p2p action: ${action}\n\n${help.all()}`,
      metadata: { kind: 'slash-help', command: 'p2p', error: 'unknown-action' }
    };
  };
}

export { createP2PHandler };
