/**
 * Model metadata helpers shared by the worker (fallback list) and renderer
 * (display formatting). Pure: no DOM, no network, no UI imports.
 */

// Offline fallback used when no provider is reachable. One source of truth;
// the headless server and worker both reuse it.
const DEFAULT_MODELS = Object.freeze([
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek 1.5b' },
  { id: 'llama2:7b', name: 'Llama 2 7B' },
  { id: 'mistral:7b', name: 'Mistral 7B' },
  { id: 'phi:2.7b', name: 'Phi-2 2.7B' },
  { id: 'gemma:7b', name: 'Gemma 7B' }
]);

function getDefaultModels() {
  return DEFAULT_MODELS.map((model) => ({ ...model }));
}

/**
 * Format a model id into a friendlier display name (e.g. `llama2:7b` → `Llama2 (7b)`).
 * @param {string} modelId
 * @returns {string}
 */
function formatModelName(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'Unknown Model';
  const parts = modelId.split(':');
  const baseName = parts[0]
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return parts.length > 1 ? `${baseName} (${parts[1]})` : baseName;
}

export { DEFAULT_MODELS, getDefaultModels, formatModelName };