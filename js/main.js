/**
 * Main entry point for the SeekDeep application
 * Initializes all modules and bootstraps the application
 */
import * as ui from './ui/elements.js';
// import * as rendering from './ui/rendering.js';
import * as events from './ui/events.js';
import * as hyperswarm from './network/hyperswarm.js';
// import * as messaging from './network/messaging.js';
// import * as ollama from './llm/ollama.js';
import * as models from './llm/models.js';
// import * as history from './messages/history.js';
// import * as formatting from './messages/formatting.js';
import * as modes from './session/modes.js';
// import * as peers from './session/peers.js';

// Initialize the application
function initializeApp() {
  console.log('Initializing SeekDeep application...');
  
  // Initialize UI elements
  ui.initializeElements();
  
  // Initialize network
  hyperswarm.initializeSwarm();
  
  // Initialize LLM
  models.fetchAvailableModels();
  
  // Initialize session
  modes.initializeChatMode();
  
  // Start a new chat session by default
  hyperswarm.initializeNewChat();
  
  // Set up event listeners
  events.setupEventListeners();
  
  console.log('SeekDeep application initialized successfully');
}

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Export functions that need to be accessed globally
export {
  initializeApp
};
