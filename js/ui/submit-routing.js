/**
 * Route a composer submission without giving slash handlers access to LLM state.
 * Dependencies are injected to keep the privacy boundary directly testable.
 *
 * Slash commands are dispatched in the Bare worker harness; their output arrives
 * on the `harness.event` stream, so this function only decides the route.
 */
async function routePromptSubmission(prompt, {
  dispatchSlash,
  getSelectedModel,
  clearPromptArea = () => {},
  ask
}) {
  const handled = await dispatchSlash(prompt);
  if (handled) {
    clearPromptArea();
    return 'slash';
  }

  const model = getSelectedModel();
  if (!model) throw new Error('Select a model before sending a message.');
  await ask(model, prompt);
  clearPromptArea();
  return 'llm';
}

export { routePromptSubmission };
