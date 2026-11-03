/**
 * Classify composer input for the terminal client.
 *
 * TUI-local names win over plugin commands: none of them collide with a
 * built-in plugin command (`p2p`, `help`, `swarm`, `dht`, `drive`,
 * `localdrive`, `mirror`, `beam`, `harness`, `bot`), and a user plugin must not
 * name a command after a TUI-local control. Everything else beginning with `/`
 * is forwarded to the worker verbatim so the harness owns parsing and errors.
 */
import { parseSlashTag } from '../slash/parser.js';

const TUI_COMMANDS = Object.freeze([
  'quit', 'exit', 'tui', 'models', 'model', 'provider', 'join', 'leave', 'clear', 'status'
]);

function classify(input) {
  if (typeof input !== 'string') return { kind: 'empty' };
  const raw = input.trim();
  if (!raw) return { kind: 'empty' };
  if (!raw.startsWith('/')) return { kind: 'prompt', raw };

  const name = (raw.slice(1).split(/\s+/)[0] || '').toLowerCase();
  if (!TUI_COMMANDS.includes(name)) return { kind: 'slash', name, raw };

  let args;
  try {
    args = parseSlashTag(raw).args;
  } catch {
    args = raw.slice(1 + name.length).trim().split(/\s+/).filter(Boolean);
  }
  return { kind: 'local', name, args, raw };
}

export { TUI_COMMANDS, classify };
