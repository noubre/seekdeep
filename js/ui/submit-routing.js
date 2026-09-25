/**
 * Route a composer submission without giving slash handlers access to LLM state.
 * Dependencies are injected to keep the privacy boundary directly testable.
 */
async function routePromptSubmission(prompt, {
  dispatchSlashTag,
  emitEphemeral,
  services = {},
  getSelectedModel,
  clearPromptArea = () => {},
  ask
}) {
  const handled = await dispatchSlashTag(prompt, { emitEphemeral }, services);
  if (handled) {
    clearPromptArea();
    return 'slash';
  }

  const model = getSelectedModel();
  clearPromptArea();
  await ask(model, prompt);
  return 'llm';
}

export { routePromptSubmission };
