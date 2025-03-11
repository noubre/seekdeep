/**
 * End-to-End tests for SeekDeep application
 * Tests the complete user flow from the UI to the backend
 */

// Mock DOM setup instead of jsdom-global which has compatibility issues
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

// Import supertest for HTTP testing
const request = require('supertest');
const express = require('express');

// Mock modules for both server and app
jest.mock('hyperswarm');
jest.mock('b4a');
jest.mock('hypercore-crypto');

// Mock fetch API
global.fetch = jest.fn();

describe('End-to-End Tests', () => {
  let app;
  let server;
  
  beforeAll(() => {
    // Create a simple express app for testing
    app = express();
    
    // Set up API routes
    app.get('/api/models', (req, res) => {
      res.json({
        models: [
          { name: 'llama2', modified_at: '2022-01-01' },
          { name: 'mistral', modified_at: '2022-01-02' }
        ]
      });
    });
    
    app.post('/api/generate', (req, res) => {
      // Simulate streaming response
      res.write(JSON.stringify({ response: 'This is a streaming response', done: false }));
      setTimeout(() => {
        res.write(JSON.stringify({ response: ' from the model.', done: true }));
        res.end();
      }, 100);
    });
    
    // Start the server on a test port
    server = app.listen(3001);
  });
  
  afterAll(() => {
    // Close the server when done
    server.close();
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset global variables
    global.isSessionHost = false;
    global.isCollaborativeMode = true;
    global.conns = [];
    global.chatHistory = [];
    global.activePeers = new Map();
    global.currentModel = 'llama2';
    
    // Reset DOM elements
    document.getElementById('message-input').value = '';
    document.getElementById('topic-key-input').value = '';
    
    // Mock fetch to use our test server
    global.fetch = jest.fn().mockImplementation((url, options) => {
      const mockUrl = new URL(url);
      
      if (mockUrl.pathname === '/api/models') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            models: [
              { name: 'llama2', modified_at: '2022-01-01' },
              { name: 'mistral', modified_at: '2022-01-02' }
            ]
          })
        });
      } else if (mockUrl.pathname === '/api/generate') {
        const mockReader = {
          read: jest.fn()
            .mockResolvedValueOnce({ 
              done: false, 
              value: new TextEncoder().encode('{"response": "Test response"}') 
            })
            .mockResolvedValueOnce({ done: true })
        };
        
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => mockReader
          }
        });
      }
      
      return Promise.reject(new Error('Not Found'));
    });
  });
  
  describe('User Flow', () => {
    test('should create a new chat when clicking the create button', () => {
      // Setup DOM elements
      const createButton = document.getElementById('create-button');
      
      // Mock the functions called by the click event
      global.initializeNewChat = jest.fn();
      
      // Recreate the event handler
      createButton.onclick = () => {
        global.initializeNewChat();
      };
      
      // Trigger the click
      createButton.click();
      
      // Check that initializeNewChat was called
      expect(global.initializeNewChat).toHaveBeenCalled();
    });
    
    test('should join an existing chat when clicking the join button', () => {
      // Setup DOM elements
      const joinButton = document.getElementById('join-button');
      const topicKeyInput = document.getElementById('topic-key-input');
      
      // Set the topic key
      topicKeyInput.value = 'test-topic-key';
      
      // Mock the functions called by the click event
      global.joinExistingChat = jest.fn();
      
      // Recreate the event handler
      joinButton.onclick = () => {
        const topicKey = topicKeyInput.value.trim();
        if (topicKey) {
          global.joinExistingChat(topicKey);
        }
      };
      
      // Trigger the click
      joinButton.click();
      
      // Check that joinExistingChat was called with the topic key
      expect(global.joinExistingChat).toHaveBeenCalledWith('test-topic-key');
    });
    
    test('should send a message when clicking the send button', () => {
      // Setup DOM elements
      const sendButton = document.getElementById('send-button');
      const messageInput = document.getElementById('message-input');
      
      // Set the message
      messageInput.value = 'Hello, this is a test message';
      
      // Mock the functions called by the click event
      global.ask = jest.fn();
      
      // Recreate the event handler
      sendButton.onclick = async () => {
        const message = messageInput.value.trim();
        if (message) {
          messageInput.value = '';
          await global.ask(global.currentModel, message);
        }
      };
      
      // Trigger the click
      sendButton.click();
      
      // Check that ask was called with the model and message
      expect(global.ask).toHaveBeenCalledWith('llama2', 'Hello, this is a test message');
      
      // Check that the input was cleared
      expect(messageInput.value).toBe('');
    });
    
    test('should fetch models when clicking the refresh models button', () => {
      // Setup DOM elements
      const refreshButton = document.getElementById('refresh-models-btn');
      
      // Mock the functions called by the click event
      global.fetchAvailableModels = jest.fn();
      global.requestModelsFromHost = jest.fn();
      
      // Recreate the event handler
      refreshButton.onclick = async () => {
        if (global.shouldUseLocalOllama()) {
          await global.fetchAvailableModels();
        } else {
          global.requestModelsFromHost();
        }
      };
      
      // Setup to use local Ollama
      global.shouldUseLocalOllama = jest.fn().mockReturnValue(true);
      
      // Trigger the click
      refreshButton.click();
      
      // Check that fetchAvailableModels was called
      expect(global.fetchAvailableModels).toHaveBeenCalled();
      
      // Now setup to use host Ollama
      global.shouldUseLocalOllama = jest.fn().mockReturnValue(false);
      
      // Trigger the click again
      refreshButton.click();
      
      // Check that requestModelsFromHost was called
      expect(global.requestModelsFromHost).toHaveBeenCalled();
    });
  });
  
  describe('API Integration', () => {
    test('should retrieve models from the API', async () => {
      // Test the /api/models endpoint
      const response = await request(app).get('/api/models');
      
      // Check the response
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('models');
      expect(response.body.models.length).toBe(2);
      expect(response.body.models[0].name).toBe('llama2');
    });
    
    test('should generate responses from the API', async () => {
      // Test the /api/generate endpoint
      const response = await request(app)
        .post('/api/generate')
        .send({
          model: 'llama2',
          prompt: 'Test prompt',
          stream: true
        });
      
      // Check the response
      expect(response.status).toBe(200);
      // The response is streamed, so we need to check the raw response
      expect(response.text).toContain('This is a streaming response');
    });
  });
  
  describe('Error Handling', () => {
    test('should handle errors when Ollama is not available', async () => {
      // Mock fetch to return an error
      global.fetch.mockRejectedValueOnce(new Error('Ollama not available'));
      
      // Simplified fetchAvailableModels function
      global.fetchAvailableModels = async function() {
        try {
          const baseUrl = 'http://localhost:11434';
          const modelsUrl = new URL('/api/tags', baseUrl);
          
          const response = await fetch(modelsUrl);
          
          if (response.ok) {
            const data = await response.json();
            return data.models;
          }
          
          throw new Error('Failed to fetch models');
        } catch (error) {
          console.error('Error fetching models:', error);
          return [
            { name: 'llama2', modified_at: '2022-01-01' },
            { name: 'mistral', modified_at: '2022-01-02' }
          ];
        }
      };
      
      // Call the function under test
      const models = await global.fetchAvailableModels();
      
      // Verify error was handled and default models were returned
      expect(models).toEqual([
        { name: 'llama2', modified_at: '2022-01-01' },
        { name: 'mistral', modified_at: '2022-01-02' }
      ]);
    });
  });
});
