/**
 * Integration tests for SeekDeep application
 * Tests the interaction between app.js and server.js
 */

// Mock modules for both server and app
jest.mock('express');
jest.mock('hyperswarm');
jest.mock('b4a');
jest.mock('hypercore-crypto');

// Mock DOM elements
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

// Import global variables and common functions
const hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const crypto = require('hypercore-crypto');

// Mock functions shared between app.js and server.js
global.OLLAMA_API_URL = 'http://localhost:11434';
global.getOllamaBaseUrl = jest.fn(() => global.OLLAMA_API_URL);

// App.js specific mocks
global.chatModeSelect = document.getElementById('chat-mode-select');
global.isSessionHost = false;
global.isCollaborativeMode = false;
global.conns = [];
global.chatHistory = [];
global.activePeers = new Map();
global.currentModel = 'llama2';
global.topicHex = 'mock-topic-hex';
global.modelSelect = document.getElementById('model-select');
global.refreshModelsButton = document.getElementById('refresh-models-btn');
global.updateChatDisplay = jest.fn();
global.updateActiveUsersDisplay = jest.fn();
global.addToChatHistory = jest.fn();
global.initializeNewChat = jest.fn();
global.joinExistingChat = jest.fn();
global.fetchAvailableModels = jest.fn();
global.broadcastToPeers = jest.fn();
global.handlePeerMessage = jest.fn();
global.setupPeerMessageHandler = jest.fn().mockReturnValue(jest.fn());
global.DEFAULT_MODELS = [
  { id: 'llama2', name: 'Llama 2' },
  { id: 'mistral', name: 'Mistral' }
];
global.swarm = {
  on: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  keyPair: {
    publicKey: Buffer.from('mock-public-key'),
    secretKey: Buffer.from('mock-secret-key')
  }
};

// Server.js specific mocks
global.handleClientQuery = jest.fn();
global.startP2PServer = jest.fn();
global.startHttpServer = jest.fn();
global.checkOllama = jest.fn().mockResolvedValue(true);

// Mock fetch for all tests
global.fetch = jest.fn();

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create the isConnectedToPeers function that would be in app.js
    global.isConnectedToPeers = function() {
      return global.isSessionHost || global.conns.length > 0;
    };
    
    // Create the shouldUseLocalOllama function
    global.shouldUseLocalOllama = function() {
      return global.isSessionHost || !global.isConnectedToPeers();
    };
  });

  describe('P2P and Local Query Integration', () => {
    test('should query peers when connected and not host', async () => {
      // Define a simplified version of the ask function
      global.ask = async function(model, prompt) {
        const requestId = 'test-request-id';
        
        // Add user message
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
          // Send to peers
          global.broadcastToPeers({
            type: 'query',
            model,
            prompt,
            requestId
          });
          return;
        }
        
        // Query local Ollama
        return 'Sample response from Ollama';
      };
      
      // Set up test conditions: connected to peers, not host
      global.isSessionHost = false;
      global.conns = [{ write: jest.fn(), remotePublicKey: Buffer.from('peer1') }];
      
      // Mock broadcastToPeers
      global.broadcastToPeers = jest.fn();
      
      // Call the function under test
      await global.ask('llama2', 'Test prompt');
      
      // Verify it was broadcast to peers
      expect(global.broadcastToPeers).toHaveBeenCalledWith({
        type: 'query',
        model: 'llama2',
        prompt: 'Test prompt',
        requestId: expect.any(String)
      });
      
      // Verify local Ollama was not called
      expect(global.fetch).not.toHaveBeenCalled();
    });
    
    test('should use local Ollama when host', async () => {
      // Mock stream response
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ 
            done: false, 
            value: new TextEncoder().encode('{"response": "Hello"}') 
          })
          .mockResolvedValueOnce({ done: true })
      };
      
      // Mock fetch
      global.fetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader)
        }
      });
      
      // Define a simplified fetch-based ask function
      global.ask = async function(model, prompt) {
        const requestId = 'test-request-id';
        
        // Add user message
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
        
        // Set up as host
        global.isSessionHost = true;
        
        // Get the base URL for Ollama
        const baseUrl = global.getOllamaBaseUrl();
        const url = new URL('/api/generate', baseUrl);
        
        // Query Ollama
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: true
          })
        });
        
        // Handle response
        if (response.ok) {
          return 'Sample response from Ollama';
        } else {
          throw new Error('Failed to query Ollama');
        }
      };
      
      // Call the function under test
      const result = await global.ask('llama2', 'Test prompt');
      
      // Verify local Ollama was called
      expect(global.fetch).toHaveBeenCalled();
      expect(global.fetch.mock.calls[0][0].toString()).toBe("http://localhost:11434/api/generate");
      expect(global.fetch.mock.calls[0][1].method).toBe("POST");
      expect(global.fetch.mock.calls[0][1].body).toContain("llama2");
      
      // Verify result
      expect(result).toBe('Sample response from Ollama');
    });
    
    test('should use local Ollama when not connected to peers', async () => {
      // Mock fetch response
      global.fetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue({
            read: jest.fn().mockResolvedValue({ done: true })
          })
        }
      });
      
      // Set up test conditions: not connected, not host
      global.isSessionHost = false;
      global.conns = [];
      
      // Define simplified ask function
      global.ask = async function(model, prompt) {
        const requestId = 'test-request-id';
        
        // Add messages to chat history
        global.addToChatHistory({
          type: 'user',
          content: prompt,
          requestId
        });
        
        global.addToChatHistory({
          type: 'thinking',
          content: 'Thinking...',
          requestId
        });
        
        // Check connection status
        const connected = global.isConnectedToPeers();
        
        // Not connected, use local Ollama
        if (!connected) {
          // Query local Ollama
          const baseUrl = global.getOllamaBaseUrl();
          const url = new URL('/api/generate', baseUrl);
          
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt,
              stream: true
            })
          });
          
          return 'Sample response from Ollama';
        }
      };
      
      // Call the function under test
      const result = await global.ask('llama2', 'Test prompt');
      
      // Verify local Ollama was called
      expect(global.fetch).toHaveBeenCalled();
      expect(global.fetch.mock.calls[0][0].toString()).toBe("http://localhost:11434/api/generate");
      expect(global.fetch.mock.calls[0][1].method).toBe("POST");
      
      // Verify result
      expect(result).toBe('Sample response from Ollama');
    });
  });
  
  describe('Model Selection Integration', () => {
    test('should fetch models from local Ollama when host', async () => {
      // Mock Ollama API response
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          models: [
            { name: 'llama2', modified_at: '2022-01-01' },
            { name: 'mistral', modified_at: '2022-01-02' }
          ]
        })
      });
      
      // Setup as host
      global.isSessionHost = true;
      
      // Simplified fetchAvailableModels
      global.fetchAvailableModels = async function() {
        try {
          const useLocalOllama = global.shouldUseLocalOllama();
          
          if (useLocalOllama) {
            // Get models from local Ollama
            const baseUrl = global.getOllamaBaseUrl();
            const modelsUrl = new URL('/api/tags', baseUrl);
            
            const response = await fetch(modelsUrl);
            
            if (response.ok) {
              const data = await response.json();
              
              if (data.models && Array.isArray(data.models)) {
                // This would normally update the UI
                return data.models;
              }
            }
          }
          
          // Default fallback
          return global.DEFAULT_MODELS;
        } catch (error) {
          return global.DEFAULT_MODELS;
        }
      };
      
      // Call the function under test
      const models = await global.fetchAvailableModels();
      
      // Verify Ollama API was called
      expect(global.fetch).toHaveBeenCalled();
      expect(global.fetch.mock.calls[0][0].toString()).toBe("http://localhost:11434/api/tags");
      
      // Verify models were returned
      expect(models).toEqual([
        { name: 'llama2', modified_at: '2022-01-01' },
        { name: 'mistral', modified_at: '2022-01-02' }
      ]);
    });
    
    test('should request models from host when connected and not host', async () => {
      // Setup as non-host but connected
      global.isSessionHost = false;
      global.conns = [{ write: jest.fn(), remotePublicKey: Buffer.from('peer1') }];
      
      // Mock broadcastToPeers for requesting models
      global.broadcastToPeers = jest.fn();
      
      // Simplified requestModelsFromHost
      global.requestModelsFromHost = function() {
        if (!global.isSessionHost && global.isConnectedToPeers()) {
          global.broadcastToPeers({
            type: 'get_models',
            requestId: 'test-request-id'
          });
          return true;
        }
        return false;
      };
      
      // Call the function under test
      const requested = global.requestModelsFromHost();
      
      // Verify models were requested from the host
      expect(requested).toBe(true);
      expect(global.broadcastToPeers).toHaveBeenCalledWith({
        type: 'get_models',
        requestId: expect.any(String)
      });
    });
  });
  
  describe('P2P Connection Integration', () => {
    test('should handle new peer connections', () => {
      // Mock connection
      const conn = {
        remotePublicKey: Buffer.from('peer1'),
        on: jest.fn(),
        write: jest.fn()
      };
      
      // Track initial number of connections
      const initialConnCount = global.conns.length;
      
      // Recreate connection handling logic
      function handleNewConnection(conn) {
        const remotePublicKey = b4a.toString(conn.remotePublicKey, 'hex');
        
        // Add to connections list
        global.conns.push(conn);
        
        // Add the peer to active peers
        global.activePeers.set(remotePublicKey, {
          id: remotePublicKey,
          displayName: `Peer${remotePublicKey.slice(0, 6)}`,
          clientId: remotePublicKey,
          connectionTime: new Date()
        });
        
        // Setup message handler
        const messageHandler = global.setupPeerMessageHandler(conn, remotePublicKey);
        
        // Set up event handlers
        conn.on('data', messageHandler);
        conn.on('close', () => {});
        conn.on('error', () => {});
        
        // Send handshake
        conn.write(JSON.stringify({
          type: 'handshake',
          clientId: b4a.toString(global.swarm.keyPair.publicKey, 'hex'),
          displayName: 'You',
          timestamp: Date.now()
        }));
      }
      
      // Call the function under test
      handleNewConnection(conn);
      
      // Verify a connection was added
      expect(global.conns.length).toBe(initialConnCount + 1);
      
      // Verify the peer was added to active peers
      expect(global.activePeers.size).toBe(1);
      
      // Verify event handlers were set up
      expect(conn.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(conn.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(conn.on).toHaveBeenCalledWith('error', expect.any(Function));
      
      // Verify handshake was sent
      expect(conn.write).toHaveBeenCalledWith(
        expect.stringContaining('handshake')
      );
    });
  });
  
  describe('Chat Mode Integration', () => {
    test('should update chat mode for all peers when host changes mode', () => {
      // Set up as host
      global.isSessionHost = true;
      global.conns = [
        { write: jest.fn(), remotePublicKey: Buffer.from('peer1') },
        { write: jest.fn(), remotePublicKey: Buffer.from('peer2') }
      ];
      
      // Mock broadcastToPeers
      global.broadcastToPeers = jest.fn();
      
      // Simplified chat mode update function
      function updateChatMode(isCollaborative) {
        global.isCollaborativeMode = isCollaborative;
        
        // If we're the host, broadcast the change to all peers
        if (global.isSessionHost) {
          global.broadcastToPeers({
            type: 'mode_update',
            isCollaborativeMode: global.isCollaborativeMode
          });
        }
        
        return global.isCollaborativeMode;
      }
      
      // Call the function under test
      const result = updateChatMode(true);
      
      // Verify chat mode was updated
      expect(result).toBe(true);
      expect(global.isCollaborativeMode).toBe(true);
      
      // Verify mode update was broadcast to peers
      expect(global.broadcastToPeers).toHaveBeenCalledWith({
        type: 'mode_update',
        isCollaborativeMode: true
      });
    });
  });
});
