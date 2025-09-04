/**
 * LLM Provider abstraction layer
 * Manages switching between different LLM providers (Ollama, LM Studio)
 */
import * as ollama from './ollama.js';
import * as lmstudio from './lmstudio.js';

// Available providers
const PROVIDERS = {
  OLLAMA: 'ollama',
  LMSTUDIO: 'lmstudio'
};

// Current provider state
let currentProvider = PROVIDERS.LMSTUDIO; // Default to LM Studio

/**
 * Get the current provider
 * @returns {string} The current provider name
 */
function getCurrentProvider() {
  return currentProvider;
}

/**
 * Set the current provider
 * @param {string} provider - The provider to set ('ollama' or 'lmstudio')
 */
function setCurrentProvider(provider) {
  if (!Object.values(PROVIDERS).includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Must be one of: ${Object.values(PROVIDERS).join(', ')}`);
  }
  
  const oldProvider = currentProvider;
  currentProvider = provider;
  
  console.log(`Provider switched from ${oldProvider} to ${provider}`);
  
  // Dispatch a custom event to notify other parts of the application
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('providerChanged', {
      detail: { oldProvider, newProvider: provider }
    }));
  }
}

/**
 * Get the provider module for the current provider
 * @returns {Object} The provider module
 */
function getProviderModule() {
  switch (currentProvider) {
    case PROVIDERS.OLLAMA:
      return ollama;
    case PROVIDERS.LMSTUDIO:
      return lmstudio;
    default:
      throw new Error(`Unknown provider: ${currentProvider}`);
  }
}

/**
 * Ask the LLM a question using the current provider
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string|null>} A promise that resolves to the response text or null
 */
async function ask(model, prompt) {
  const provider = getProviderModule();
  console.log(`Using provider ${currentProvider} for ask request`);
  return await provider.ask(model, prompt);
}

/**
 * Handle a query from a peer using the current provider
 * @param {Object} conn - The connection object
 * @param {Object} message - The query message
 * @param {string} peerId - The ID of the peer
 */
async function handlePeerQuery(conn, message, peerId) {
  // Check if the message specifies a provider
  const messageProvider = message.provider || currentProvider;
  
  let provider;
  switch (messageProvider) {
    case PROVIDERS.OLLAMA:
      provider = ollama;
      break;
    case PROVIDERS.LMSTUDIO:
      provider = lmstudio;
      break;
    default:
      // Fall back to current provider if unknown
      provider = getProviderModule();
      break;
  }
  
  console.log(`Using provider ${messageProvider} for peer query from ${peerId}`);
  return await provider.handlePeerQuery(conn, message, peerId);
}

/**
 * Query the local LLM directly using the current provider
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} A promise that resolves to the response text
 */
async function queryLocalLLM(model, prompt) {
  const provider = getProviderModule();
  console.log(`Using provider ${currentProvider} for local LLM query`);
  return await provider.queryLocalLLM(model, prompt);
}

/**
 * Stream response to a peer using the current provider
 * @param {Object} conn - The connection object
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @param {string} requestId - The request ID
 * @param {string} peerId - The ID of the peer
 * @returns {Promise<string>} A promise that resolves to the complete response text
 */
async function streamResponseToPeer(conn, model, prompt, requestId, peerId) {
  const provider = getProviderModule();
  console.log(`Using provider ${currentProvider} for streaming response to peer ${peerId}`);
  return await provider.streamResponseToPeer(conn, model, prompt, requestId, peerId);
}

/**
 * Check if a provider is available by testing its connection
 * @param {string} providerName - The provider to check ('ollama' or 'lmstudio')
 * @returns {Promise<boolean>} True if the provider is available, false otherwise
 */
async function isProviderAvailable(providerName) {
  try {
    let baseUrl;
    let endpoint;
    
    switch (providerName) {
      case PROVIDERS.OLLAMA:
        // Import the function dynamically to avoid circular dependencies
        const { getOllamaBaseUrl } = await import('./models.js');
        baseUrl = getOllamaBaseUrl();
        endpoint = '/api/tags';
        break;
      case PROVIDERS.LMSTUDIO:
        // Import the function dynamically to avoid circular dependencies
        const { getLMStudioBaseUrl } = await import('./models.js');
        baseUrl = getLMStudioBaseUrl();
        endpoint = '/api/v0/models';
        break;
      default:
        return false;
    }
    
    const url = new URL(endpoint, baseUrl);
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    return response.ok;
  } catch (error) {
    console.log(`Provider ${providerName} is not available:`, error.message);
    return false;
  }
}

/**
 * Get all available providers
 * @returns {Promise<Array>} Array of available provider names
 */
async function getAvailableProviders() {
  const providers = Object.values(PROVIDERS);
  const availabilityChecks = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      available: await isProviderAvailable(provider)
    }))
  );
  
  return availabilityChecks
    .filter(check => check.available)
    .map(check => check.provider);
}

/**
 * Auto-detect and set the best available provider
 * @returns {Promise<string>} The selected provider name
 */
async function autoSelectProvider() {
  const availableProviders = await getAvailableProviders();
  
  if (availableProviders.length === 0) {
    console.warn('No LLM providers are available');
    return currentProvider; // Keep current provider even if not available
  }
  
  // Prefer the current provider if it's available
  if (availableProviders.includes(currentProvider)) {
    console.log(`Current provider ${currentProvider} is available`);
    return currentProvider;
  }
  
  // Otherwise, select the first available provider
  const selectedProvider = availableProviders[0];
  console.log(`Auto-selecting provider: ${selectedProvider}`);
  setCurrentProvider(selectedProvider);
  
  return selectedProvider;
}

/**
 * Get provider display name for UI
 * @param {string} providerName - The provider name
 * @returns {string} The display name
 */
function getProviderDisplayName(providerName) {
  switch (providerName) {
    case PROVIDERS.OLLAMA:
      return 'Ollama';
    case PROVIDERS.LMSTUDIO:
      return 'LM Studio';
    default:
      return providerName;
  }
}

/**
 * Get provider connection info for debugging
 * @param {string} providerName - The provider name
 * @returns {Object} Connection info
 */
async function getProviderInfo(providerName) {
  try {
    let baseUrl;
    let defaultPort;
    
    switch (providerName) {
      case PROVIDERS.OLLAMA:
        const { getOllamaBaseUrl } = await import('./models.js');
        baseUrl = getOllamaBaseUrl();
        defaultPort = 11434;
        break;
      case PROVIDERS.LMSTUDIO:
        const { getLMStudioBaseUrl } = await import('./models.js');
        baseUrl = getLMStudioBaseUrl();
        defaultPort = 1234;
        break;
      default:
        return null;
    }
    
    const available = await isProviderAvailable(providerName);
    
    return {
      name: providerName,
      displayName: getProviderDisplayName(providerName),
      baseUrl,
      defaultPort,
      available
    };
  } catch (error) {
    return {
      name: providerName,
      displayName: getProviderDisplayName(providerName),
      baseUrl: 'Unknown',
      defaultPort: 'Unknown',
      available: false,
      error: error.message
    };
  }
}

// Export constants and functions
export {
  PROVIDERS,
  getCurrentProvider,
  setCurrentProvider,
  ask,
  handlePeerQuery,
  queryLocalLLM,
  streamResponseToPeer,
  isProviderAvailable,
  getAvailableProviders,
  autoSelectProvider,
  getProviderDisplayName,
  getProviderInfo
};
