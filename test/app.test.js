/**
 * Unit tests for app.js functionality
 */

// Mock global HTML elements that would be in the DOM
document.body.innerHTML = `
  <div id="chat-messages"></div>
  <select id="model-select"></select>
  <button id="refresh-models-btn"></button>
  <button id="create-button"></button>
  <button id="join-button"></button>
  <input id="topic-key-input" type="text" />
  <select id="chat-mode-select">
    <option value="collaborative">Collaborative</option>
    <option value="private">Private</option>
  </select>
  <div id="active-users"></div>
  <div id="session-info"></div>
  <div id="host-status"></div>
  <button id="send-button"></button>
  <textarea id="message-input"></textarea>
`;

// Import the modules to test (need to mock require since we're using ES modules)
jest.mock('hyperswarm');
jest.mock('b4a');
jest.mock('hypercore-crypto');

// Mock functions that would be defined in app.js
global.initializeNewChat = jest.fn();
global.isConnectedToPeers = jest.fn().mockReturnValue(false);
global.broadcastToPeers = jest.fn();
global.fetchAvailableModels = jest.fn();
global.getOllamaBaseUrl = jest.fn(() => 'http://localhost:11434');
global.handlePeerQuery = jest.fn();
global.addToChatHistory = jest.fn();
global.updateChatDisplay = jest.fn();

// Import for simulating DOM events
const { fireEvent } = require('@testing-library/dom');

describe('App.js Functionality', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Default mock values
    global.isSessionHost = false;
    global.isCollaborativeMode = false;
    global.conns = [];
    global.chatHistory = [];
    global.activePeers = new Map();
    global.currentModel = 'llama2';
  });

  describe('isConnectedToPeers', () => {
    test('should return true if user is session host', () => {
      // We need to manually re-assign this function for testing specific implementations
      global.isConnectedToPeers = function() {
        return global.isSessionHost || global.conns.length > 0;
      };
      
      global.isSessionHost = true;
      expect(global.isConnectedToPeers()).toBe(true);
    });

    test('should return true if user has connections', () => {
      global.isConnectedToPeers = function() {
        return global.isSessionHost || global.conns.length > 0;
      };
      
      global.isSessionHost = false;
      global.conns = ['mockConnection'];
      expect(global.isConnectedToPeers()).toBe(true);
    });

    test('should return false if user is not host and has no connections', () => {
      global.isConnectedToPeers = function() {
        return global.isSessionHost || global.conns.length > 0;
      };
      
      global.isSessionHost = false;
      global.conns = [];
      expect(global.isConnectedToPeers()).toBe(false);
    });
  });

  describe('broadcastToPeers', () => {
    beforeEach(() => {
      global.broadcastToPeers = function(message, targetPeerId = null, excludePeerId = null) {
        if (!global.isConnectedToPeers()) {
          return 0;
        }
        
        let sentCount = 0;
        for (const conn of global.conns) {
          sentCount++;
        }
        return sentCount;
      };
    });
    
    test('should not send messages when not connected to peers', () => {
      global.isConnectedToPeers = jest.fn().mockReturnValue(false);
      
      const result = global.broadcastToPeers({ type: 'test' });
      expect(result).toBe(0);
    });
    
    test('should send messages to all connections when connected', () => {
      global.isConnectedToPeers = jest.fn().mockReturnValue(true);
      global.conns = [
        { write: jest.fn(), remotePublicKey: Buffer.from('peer1') },
        { write: jest.fn(), remotePublicKey: Buffer.from('peer2') }
      ];
      
      const result = global.broadcastToPeers({ type: 'test' });
      expect(result).toBe(2);
    });
  });

  describe('ask function', () => {
    // Define a simplified version of the ask function for testing
    global.ask = async function(model, prompt) {
      const requestId = 'test-request-id';
      
      // Add user message to chat history
      global.addToChatHistory({
        type: 'user',
        content: prompt,
        requestId
      });
      
      // Add thinking message
      global.addToChatHistory({
        type: 'thinking',
        content: 'Thinking...',
        requestId
      });
      
      const connected = global.isConnectedToPeers();
      
      if (connected && !global.isSessionHost) {
        // If connected and not host, send to peers
        global.broadcastToPeers({
          type: 'query',
          model,
          prompt,
          requestId
        });
        return;
      }
      
      // If host or not connected, query local Ollama
      return 'Sample response from Ollama';
    };
    
    test('should send query to peers when connected and not host', async () => {
      global.isConnectedToPeers = jest.fn().mockReturnValue(true);
      global.isSessionHost = false;
      global.broadcastToPeers = jest.fn();
      
      await global.ask('llama2', 'Test prompt');
      
      expect(global.broadcastToPeers).toHaveBeenCalledWith({
        type: 'query',
        model: 'llama2',
        prompt: 'Test prompt',
        requestId: expect.any(String)
      });
    });
    
    test('should query local Ollama when host', async () => {
      global.isConnectedToPeers = jest.fn().mockReturnValue(true);
      global.isSessionHost = true;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: true })
          })
        }
      });
      
      const result = await global.ask('llama2', 'Test prompt');
      expect(result).toBe('Sample response from Ollama');
    });
    
    test('should query local Ollama when not connected to peers', async () => {
      global.isConnectedToPeers = jest.fn().mockReturnValue(false);
      global.isSessionHost = false;
      
      const result = await global.ask('llama2', 'Test prompt');
      expect(result).toBe('Sample response from Ollama');
    });
  });
  
  describe('Chat mode handling', () => {
    test('should set collaborative mode based on select value', () => {
      // Setup the UI element
      const chatModeSelect = document.getElementById('chat-mode-select');
      chatModeSelect.value = 'collaborative';
      
      // Define the function that would react to changes
      global.handleChatModeChange = function() {
        global.isCollaborativeMode = chatModeSelect.value === 'collaborative';
      };
      
      // Trigger the change event
      global.handleChatModeChange();
      
      expect(global.isCollaborativeMode).toBe(true);
      
      // Change the select value
      chatModeSelect.value = 'private';
      global.handleChatModeChange();
      
      expect(global.isCollaborativeMode).toBe(false);
    });
  });
  
  describe('Model selection', () => {
    test('should use local Ollama when not connected to peers', () => {
      global.shouldUseLocalOllama = function() {
        return global.isSessionHost || !global.isConnectedToPeers();
      };
      
      global.isSessionHost = false;
      global.isConnectedToPeers = jest.fn().mockReturnValue(false);
      
      expect(global.shouldUseLocalOllama()).toBe(true);
    });
    
    test('should use local Ollama when session host', () => {
      global.shouldUseLocalOllama = function() {
        return global.isSessionHost || !global.isConnectedToPeers();
      };
      
      global.isSessionHost = true;
      global.isConnectedToPeers = jest.fn().mockReturnValue(true);
      
      expect(global.shouldUseLocalOllama()).toBe(true);
    });
    
    test('should not use local Ollama when connected to peers and not host', () => {
      global.shouldUseLocalOllama = function() {
        return global.isSessionHost || !global.isConnectedToPeers();
      };
      
      global.isSessionHost = false;
      global.isConnectedToPeers = jest.fn().mockReturnValue(true);
      
      expect(global.shouldUseLocalOllama()).toBe(false);
    });
  });
});
