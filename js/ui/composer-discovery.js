import { listSlashTags } from '../slash/registry.js';

function formatCommandList(commands) {
  if (commands.length < 2) return commands[0] || '';
  if (commands.length === 2) return `${commands[0]} or ${commands[1]}`;
  return `${commands.slice(0, -1).join(', ')}, or ${commands.at(-1)}`;
}

function composerHint(tags = listSlashTags()) {
  const helpTag = tags.find(({ name }) => name === 'p2p');
  const helpCommand = helpTag ? `/${helpTag.name} help` : '/p2p help';
  const statusCommands = tags
    .filter(({ implemented, name, usage }) => (
      implemented && name !== 'p2p' && usage.includes('status')
    ))
    .map(({ name }) => `/${name} status`);
  const upcomingCommands = tags
    .filter(({ implemented }) => !implemented)
    .map(({ name }) => `/${name}`);

  return `Try ${formatCommandList(statusCommands)}. Help inserts ${helpCommand}. Upcoming resource commands: ${formatCommandList(upcomingCommands)}.`;
}

function initializeComposerDiscovery(root = document) {
  const prompt = root.querySelector('textarea[name="prompt"]');
  const helpButton = root.getElementById('slash-help-button');
  const hint = root.getElementById('slash-command-hint');

  if (hint) hint.textContent = composerHint();
  if (!prompt || !helpButton || helpButton.dataset.slashHelpReady === 'true') return;

  helpButton.dataset.slashHelpReady = 'true';
  helpButton.addEventListener('click', () => {
    prompt.value = '/p2p help';
    prompt.focus();
  });
}

export { composerHint, initializeComposerDiscovery };
