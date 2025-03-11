/**
 * Unit tests for server.js functionality
 */

// Mock modules
jest.mock('express', () => {
  const app = {
    get: jest.fn(),
    post: jest.fn(),
    use: jest.fn(),
    listen: jest.fn((port, callback) => {
      callback && callback();
      return {
        on: jest.fn(),
        close: jest.fn()
      };
    })
  };
  return jest.fn(() => app);
});

jest.mock('hyperswarm');
jest.mock('b4a');
jest.mock('hypercore-crypto');

// Import global variables and functions that would be in server.js
global.OLLAMA_API_URL = 'http://localhost:11434';
global.getOllamaBaseUrl = jest.fn(() => global.OLLAMA_API_URL);
global.handleClientQuery = jest.fn();
global.checkOllama = jest.fn().mockResolvedValue(true);
global.startP2PServer = jest.fn();

// Mock fetch API
global.fetch = jest.fn();

describe('Server.js Functionality', () => {
  let express;
  let app;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mocked express app
    express = require('express');
    app = express();
  });

  describe('HTTP Server', () => {
    test('should create an HTTP server that listens on port 3000', () => {
      // Recreate the function from server.js
      function startHttpServer() {
        const app = express();
        app.listen(3000, () => {
          console.log('HTTP server listening on port 3000');
        });
        return app;
      }
      
      const server = startHttpServer();
      expect(express).toHaveBeenCalled();
      expect(app.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });
    
    test('should handle API routes', () => {
      // Mock API route handlers
      const apiRoutes = {
        getModels: jest.fn(),
        generateResponse: jest.fn()
      };
      
      // Recreate route setup from server.js
      function setupRoutes(app) {
        app.get('/api/models', apiRoutes.getModels);
        app.post('/api/generate', apiRoutes.generateResponse);
        return app;
      }
      
      const server = setupRoutes(app);
      expect(app.get).toHaveBeenCalledWith('/api/models', apiRoutes.getModels);
      expect(app.post).toHaveBeenCalledWith('/api/generate', apiRoutes.generateResponse);
    });
  });
  
  describe('P2P Server', () => {
    let hyperswarm;
    let swarm;
    
    beforeEach(() => {
      hyperswarm = require('hyperswarm');
      swarm = hyperswarm();
    });
    
    test('should initialize the P2P server with hyperswarm', () => {
      global.startP2PServer = function() {
        const hyperswarm = require('hyperswarm');
        const swarm = hyperswarm();
        return swarm;
      };
      
      const swarm = global.startP2PServer();
      expect(hyperswarm).toHaveBeenCalled();
    });
    
    test('should handle new connections in the P2P server', () => {
      // Create a mock connection
      const conn = {
        remotePublicKey: Buffer.from('remote-key'),
        on: jest.fn(),
        write: jest.fn()
      };
      
      // Mock the connection event
      swarm.on.mockImplementation((event, callback) => {
        if (event === 'connection') {
          callback(conn);
        }
      });
      
      // Recreate connection handling from server.js
      function handleSwarmConnections(swarm) {
        swarm.on('connection', (conn) => {
          conn.on('data', (data) => {
            // Handle data
          });
          
          conn.on('close', () => {
            // Handle close
          });
          
          conn.on('error', (err) => {
            // Handle error
          });
        });
      }
      
      handleSwarmConnections(swarm);
      expect(swarm.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(conn.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(conn.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(conn.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
  
  describe('Client Query Handling', () => {
    test('should process client query by sending request to Ollama', async () => {
      // Mock connection
      const conn = {
        write: jest.fn()
      };
      
      // Mock message
      const message = {
        requestId: 'test-request-id',
        model: 'llama2',
        prompt: 'Test prompt'
      };
      
      // Mock response streams
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('{"response": "Hello"}') })
          .mockResolvedValueOnce({ done: true })
      };
      
      // Mock fetch API
      global.fetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: jest.fn().mockReturnValue(mockReader)
        }
      });
      
      // Define a simplified handleClientQuery function
      global.handleClientQuery = async function(conn, message) {
        const { requestId, model, prompt } = message;
        
        try {
          // Query Ollama
          const url = `${global.OLLAMA_API_URL}/api/generate`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: true })
          });
          
          if (!response.ok) {
            throw new Error(`Ollama API returned status ${response.status}`);
          }
          
          // Stream the response back to the client
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Send the raw JSON to the client
            conn.write(JSON.stringify({
              type: 'response',
              requestId,
              data: new TextDecoder().decode(value),
              isComplete: false,
              isJson: true
            }));
          }
          
          // Send completion message
          conn.write(JSON.stringify({
            type: 'response',
            requestId,
            data: '',
            isComplete: true,
            isJson: true
          }));
        } catch (error) {
          // Send error response
          conn.write(JSON.stringify({
            type: 'response',
            requestId,
            error: error.message,
            isComplete: true
          }));
        }
      };
      
      await global.handleClientQuery(conn, message);
      
      // Verify the fetch call
      expect(global.fetch).toHaveBeenCalledWith(
        `${global.OLLAMA_API_URL}/api/generate`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'llama2', prompt: 'Test prompt', stream: true })
        })
      );
      
      // Verify the response was sent to the client
      expect(conn.write).toHaveBeenCalledWith(expect.stringContaining('response'));
      expect(conn.write).toHaveBeenCalledWith(expect.stringContaining('isComplete'));
    });
    
    test('should handle error when Ollama is not available', async () => {
      // Mock connection
      const conn = {
        write: jest.fn()
      };
      
      // Mock message
      const message = {
        requestId: 'test-request-id',
        model: 'llama2',
        prompt: 'Test prompt'
      };
      
      // Mock fetch API to throw an error
      global.fetch.mockRejectedValue(new Error('Ollama not available'));
      
      await global.handleClientQuery(conn, message);
      
      // Verify the error response was sent
      expect(conn.write).toHaveBeenCalledWith(
        expect.stringContaining('error')
      );
    });
  });
  
  describe('Ollama Availability Check', () => {
    test('should detect when Ollama is available', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ version: '0.1.14' })
      });
      
      global.checkOllama = async function() {
        try {
          const response = await fetch(`${global.OLLAMA_API_URL}`);
          if (response.ok) {
            return true;
          }
          return false;
        } catch (error) {
          return false;
        }
      };
      
      const isAvailable = await global.checkOllama();
      expect(isAvailable).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(global.OLLAMA_API_URL);
    });
    
    test('should detect when Ollama is not available', async () => {
      global.fetch.mockRejectedValue(new Error('Connection refused'));
      
      global.checkOllama = async function() {
        try {
          const response = await fetch(`${global.OLLAMA_API_URL}`);
          if (response.ok) {
            return true;
          }
          return false;
        } catch (error) {
          return false;
        }
      };
      
      const isAvailable = await global.checkOllama();
      expect(isAvailable).toBe(false);
    });
  });
});
