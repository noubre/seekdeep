/**
 * Provider router: selects between Ollama and LM Studio and exposes a single
 * `listModels` / `ask` surface to the chat service. Pure (no DOM, no UI).
 */
import { createOllama } from './ollama.js';
import { createLMStudio } from './lmstudio.js';

const PROVIDERS = ['ollama', 'lmstudio'];
const DEFAULT_BASE_URLS = Object.freeze({
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234'
});

function createProviderRouter(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('Provider router requires a fetch implementation');
  const baseUrls = {
    ollama: options.baseUrls?.ollama || DEFAULT_BASE_URLS.ollama,
    lmstudio: options.baseUrls?.lmstudio || DEFAULT_BASE_URLS.lmstudio
  };
  const instances = {
    ollama: createOllama({ baseUrl: baseUrls.ollama, fetch: fetchImpl }),
    lmstudio: createLMStudio({ baseUrl: baseUrls.lmstudio, fetch: fetchImpl })
  };

  function resolve(provider) {
    if (typeof provider !== 'string' || !Object.hasOwn(instances, provider)) {
      throw new Error(`Unknown provider: ${String(provider)}`);
    }
    return instances[provider];
  }

  async function listModels(provider, listOptions = {}) {
    return resolve(provider).listModels(listOptions);
  }

  async function ask(provider, model, prompt, askOptions = {}) {
    return resolve(provider).ask(model, prompt, askOptions);
  }

  async function isAvailable(provider) {
    try {
      await listModels(provider, { signal: AbortSignal.timeout(5000) });
      return true;
    } catch {
      return false;
    }
  }

  async function getAvailableProviders() {
    const checks = await Promise.all(PROVIDERS.map(async (provider) => ({ provider, available: await isAvailable(provider) })));
    return checks.filter((check) => check.available).map((check) => check.provider);
  }

  async function autoSelect() {
    for (const provider of PROVIDERS) {
      if (await isAvailable(provider)) return provider;
    }
    throw new Error('No LLM providers are available');
  }

  return Object.freeze({
    providers: Object.freeze([...PROVIDERS]),
    baseUrls: Object.freeze({ ...baseUrls }),
    listModels,
    ask,
    isAvailable,
    getAvailableProviders,
    autoSelect,
    getProviderInfo(provider) {
      const instance = resolve(provider);
      return { name: provider, baseUrl: instance.baseUrl, provider: instance.provider };
    }
  });
}

export { PROVIDERS, DEFAULT_BASE_URLS, createProviderRouter };