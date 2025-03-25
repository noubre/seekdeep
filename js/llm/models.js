/**
 * LLM Models module
 * Contains functions for managing LLM models
 */
import { addToChatHistory } from '../messages/history.js';
import { modelSelect, setRefreshModelsLoading, updateRefreshModelsTooltip } from '../ui/elements.js';
import { isSessionHost } from '../session/modes.js';
import { conns } from '../network/hyperswarm.js';

// Default models list - these are common Ollama models
const DEFAULT_MODELS = [
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek 1.5b' },
  { id: 'llama2:7b', name: 'Llama 2 7B' },
  { id: 'mistral:7b', name: 'Mistral 7B' },
  { id: 'phi:2.7b', name: 'Phi-2 2.7B' },
  { id: 'gemma:7b', name: 'Gemma 7B' }
];

// Current model
let currentModel = 'deepseek-r1:1.5b';

// Flag to track if we're using host models
let usingHostModels = false;

/**
 * Get the Ollama base URL
 * @returns {string} The Ollama base URL
 */
function getOllamaBaseUrl() {
  try {
    // Check if Pear and Pear.links are defined and have elements
    if (typeof Pear !== 'undefined' && Pear.links && Pear.links.length > 0) {
      return Pear.links[0];
    }
  } catch (err) {
    console.warn('Could not access Pear.links, using fallback URL', err);
  }
  // Fallback to the default Ollama URL
  return 'http://localhost:11434';
}

/**
 * Fetch available models from Ollama
 * @param {boolean} returnModelsOnly - Whether to only return the models without updating the UI
 * @returns {Promise<Array>} A promise that resolves to the array of models
 */
async function fetchAvailableModels(returnModelsOnly = false) {
  try {
    // Get base URL for Ollama
    const baseUrl = getOllamaBaseUrl();
    const modelsUrl = new URL('/api/tags', baseUrl);
    
    console.log('Fetching available models directly from Ollama:', modelsUrl.toString());
    
    const response = await fetch(modelsUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.models && Array.isArray(data.models) && data.models.length > 0) {
      // If we only need to return the models, don't update the UI
      if (returnModelsOnly) {
        return data.models;
      }
      
      // Update the model select dropdown
      updateModelSelect(data.models);
      
      // Update timestamp on refresh button
      updateRefreshModelsTooltip(`Last refreshed: ${new Date().toLocaleTimeString()}`);
      
      console.log(`Loaded ${data.models.length} models from Ollama`);
      
      // Also return the models if requested
      return data.models;
    } else {
      // If no models were returned, fall back to default models
      populateDefaultModels();
      console.log('No models returned from Ollama, using defaults');
      
      // Return default models
      return DEFAULT_MODELS;
    }
  } catch (error) {
    console.error('Error fetching models from Ollama:', error);
    // Fall back to default models on error
    populateDefaultModels();
    
    // Return default models
    return DEFAULT_MODELS;
  }
}

/**
 * Populate the model select with default models
 */
function populateDefaultModels() {
  // Clear existing options
  modelSelect.innerHTML = '';
  
  // Add default models
  DEFAULT_MODELS.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    
    // Select current model if it matches
    if (model.id === currentModel) {
      option.selected = true;
    }
    
    modelSelect.appendChild(option);
  });
  
  // Update timestamp on refresh button
  updateRefreshModelsTooltip('Failed to load models from Ollama. Using defaults.');
}

/**
 * Update the model select with new models
 * @param {Array} models - The array of models to add to the select
 */
function updateModelSelect(models) {
  // Clear existing options
  modelSelect.innerHTML = '';
  
  // Sort models alphabetically
  const sortedModels = models.sort((a, b) => {
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    return nameA.localeCompare(nameB);
  });
  
  // Add fetched models as options
  sortedModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id || model.name;
    option.textContent = formatModelName(model.name || model.id);
    
    // Select current model if it matches
    if ((model.id || model.name) === currentModel) {
      option.selected = true;
    }
    
    modelSelect.appendChild(option);
  });
}

/**
 * Format model name for better display
 * @param {string} modelId - The model ID to format
 * @returns {string} The formatted model name
 */
function formatModelName(modelId) {
  try {
    // Try to create a readable name from the model ID
    if (!modelId) return 'Unknown Model';
    
    // Split by colon to separate model name and size
    const parts = modelId.split(':');
    const baseName = parts[0];
    
    // Capitalize and format the base name
    let formattedName = baseName
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Add size if available
    if (parts.length > 1) {
      formattedName += ` (${parts[1]})`;
    }
    
    return formattedName;
  } catch (error) {
    console.error('Error formatting model name:', error);
    return modelId || 'Unknown Model';
  }
}

/**
 * Request models from the host
 * @returns {boolean} True if the request was sent, false otherwise
 */
function requestModelsFromHost() {
  // Only proceed if we're connected to a host and not the host ourselves
  if (!isSessionHost() && conns.length > 0) {
    console.log('[PEER] Requesting models from host...');
    
    addToChatHistory({
      type: 'system',
      content: 'Requesting models from host...'
    });
    
    // Send a model request to the first connection (usually the host)
    const hostConn = conns[0];
    hostConn.write(JSON.stringify({
      type: 'model_request',
      timestamp: Date.now()
    }));
    
    console.log('[PEER] Model request sent to host');
    return true;
  }
  
  console.log('[PEER] Not connected to host or we are the host, skipping model request');
  return false;
}

/**
 * Share models with a peer
 * @param {Object} conn - The connection object
 */
function shareModelsWithPeer(conn) {
  // Get models from our local instance to share with peer
  fetchAvailableModels(true).then(models => {
    // Transform the models to match the format expected by updateModelSelect
    const formattedModels = models.map(model => ({
      name: model.name,
      id: model.name,
      modified_at: model.modified_at
    }));
    
    // Send models to the requesting peer
    conn.write(JSON.stringify({
      type: 'models_update',
      models: formattedModels
    }));
    
    console.log('Sent models to peer');
  }).catch(err => {
    console.error('Error fetching models for peer request:', err);
  });
}

/**
 * Set the current model
 * @param {string} modelId - The ID of the model to set as current
 */
function setCurrentModel(modelId) {
  currentModel = modelId;
}

/**
 * Get the current model
 * @returns {string} The ID of the current model
 */
function getCurrentModel() {
  return currentModel;
}

/**
 * Check if we're using host models
 * @returns {boolean} True if using host models, false otherwise
 */
function isUsingHostModels() {
  return usingHostModels;
}

/**
 * Set whether we're using host models
 * @param {boolean} using - Whether we're using host models
 */
function setUsingHostModels(using) {
  usingHostModels = using;
}

// Export functions
export {
  fetchAvailableModels,
  updateModelSelect,
  requestModelsFromHost,
  shareModelsWithPeer,
  setCurrentModel,
  getCurrentModel,
  getOllamaBaseUrl,
  isUsingHostModels,
  setUsingHostModels,
  DEFAULT_MODELS
};
