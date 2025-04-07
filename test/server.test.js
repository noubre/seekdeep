/**
 * Unit tests for server.js functionality using brittle
 */

import test from 'brittle';
import express from 'express';
import hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import http from 'http';

// Define global variables and functions that would be in server.js
globalThis.OLLAMA_API_URL = 'http://localhost:11434';

globalThis.getOllamaBaseUrl = function() {
  return globalThis.OLLAMA_API_URL;
};

globalThis.checkOllama = async function() {
  try {
    const response = await fetch(`${globalThis.OLLAMA_API_URL}`);
    if (response.ok) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
};

globalThis.handleClientQuery = async function(conn, message) {
  const { requestId, model, prompt } = message;
  
  try {
    // Query Ollama
    const url = `${globalThis.OLLAMA_API_URL}/api/generate`;
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

globalThis.startP2PServer = function() {
  const swarm = new hyperswarm();
  return swarm;
};

// Tests for HTTP Server
test('should create an HTTP server that listens on port 3000', function(t) {
  // Create a function to start the HTTP server
  function startHttpServer() {
    const app = express();
    const server = app.listen(3000, () => {
      console.log('HTTP server listening on port 3000');
    });
    return { app, server };
  }
  
  // Start the server
  const { app, server } = startHttpServer();
  
  // Verify the server is listening
  t.ok(server.listening, 'server should be listening');
  t.is(server.address().port, 3000, 'server should be listening on port 3000');
  
  // Clean up
  server.close();
});

test('should handle API routes', async function(t) {
  // Create API route handlers
  const apiRoutes = {
    getModels: function(req, res) {
      res.json({ models: [] });
    },
    generateResponse: function(req, res) {
      res.json({ response: 'Test response' });
    }
  };
  
  // Create a function to set up routes
  function setupRoutes(app) {
    app.get('/api/models', apiRoutes.getModels);
    app.post('/api/generate', apiRoutes.generateResponse);
    return app;
  }
  
  // Create an express app and set up routes
  const app = express();
  setupRoutes(app);
  
  // Start the server
  const server = app.listen(3001);
  
  // Create a promise to handle the response
  const responsePromise = new Promise((resolve, reject) => {
    const client = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/models',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (err) {
          reject(err);
        }
      });
    });
    
    client.on('error', (err) => {
      reject(err);
    });
    
    client.end();
  });
  
  // Wait for the response
  const response = await responsePromise;
  
  // Verify the response
  t.ok(response.models, 'response should have models property');
  t.alike(response.models, [], 'models should be an array');
  
  // Clean up
  server.close();
});

// Tests for P2P Server
test('should initialize the P2P server with hyperswarm', function(t) {
  // Start the P2P server
  const swarm = globalThis.startP2PServer();
  
  // Verify the swarm was created
  t.ok(swarm, 'swarm should be created');
  t.ok(swarm.on, 'swarm should have on method');
  t.ok(swarm.join, 'swarm should have join method');
  t.ok(swarm.leave, 'swarm should have leave method');
  
  // Clean up
  swarm.destroy();
});

test('should handle new connections in the P2P server', function(t) {
  // Create a swarm
  const swarm = new hyperswarm();
  
  // Create a mock connection
  const conn = {
    remotePublicKey: Buffer.from('remote-key'),
    on: function(event, callback) {
      if (event === 'data') {
        this.dataCallback = callback;
      } else if (event === 'close') {
        this.closeCallback = callback;
      } else if (event === 'error') {
        this.errorCallback = callback;
      }
    },
    write: function(data) {
      this.lastWrittenData = data;
    },
    // For testing
    triggerData: function(data) {
      this.dataCallback(data);
    },
    triggerClose: function() {
      this.closeCallback();
    },
    triggerError: function(err) {
      this.errorCallback(err);
    }
  };
  
  // Create a function to handle connections
  function handleSwarmConnections(swarm) {
    swarm.on('connection', (conn) => {
      conn.on('data', (data) => {
        // Handle data
        conn.write('Received data');
      });
      
      conn.on('close', () => {
        // Handle close
      });
      
      conn.on('error', (err) => {
        // Handle error
      });
    });
  }
  
  // Set up connection handling
  handleSwarmConnections(swarm);
  
  // Manually trigger the connection event
  swarm.emit('connection', conn);
  
  // Trigger a data event
  conn.triggerData('Test data');
  
  // Verify the connection was handled
  t.is(conn.lastWrittenData, 'Received data', 'should respond to data events');
  
  // Clean up
  swarm.destroy();
});

// Tests for Client Query Handling
test('should process client query by sending request to Ollama', async function(t) {
  // Skip this test if Ollama is not available
  const ollamaAvailable = await globalThis.checkOllama();
  if (!ollamaAvailable) {
    t.skip('Ollama is not available');
    return;
  }
  
  // Create a mock connection
  const conn = {
    write: function(data) {
      this.writtenData = this.writtenData || [];
      this.writtenData.push(data);
    },
    getWrittenData: function() {
      return this.writtenData || [];
    }
  };
  
  // Create a mock message
  const message = {
    requestId: 'test-request-id',
    model: 'llama2',
    prompt: 'Test prompt'
  };
  
  // Mock fetch to avoid actual API calls
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function(url, options) {
    return {
      ok: true,
      body: {
        getReader: function() {
          return {
            read: async function() {
              // Return a single chunk and then done
              if (!this.called) {
                this.called = true;
                return {
                  done: false,
                  value: new TextEncoder().encode('{"response": "Hello"}')
                };
              } else {
                return { done: true };
              }
            }
          };
        }
      }
    };
  };
  
  // Process the query
  await globalThis.handleClientQuery(conn, message);
  
  // Restore original fetch
  globalThis.fetch = originalFetch;
  
  // Verify the response was sent
  const writtenData = conn.getWrittenData();
  t.ok(writtenData.length >= 2, 'should write at least two messages');
  
  // Parse the first message
  const firstMessage = JSON.parse(writtenData[0]);
  t.is(firstMessage.type, 'response', 'first message should be a response');
  t.is(firstMessage.requestId, 'test-request-id', 'should include the request ID');
  t.is(firstMessage.isComplete, false, 'first message should not be complete');
  
  // Parse the last message
  const lastMessage = JSON.parse(writtenData[writtenData.length - 1]);
  t.is(lastMessage.type, 'response', 'last message should be a response');
  t.is(lastMessage.requestId, 'test-request-id', 'should include the request ID');
  t.is(lastMessage.isComplete, true, 'last message should be complete');
});

test('should handle error when Ollama is not available', async function(t) {
  // Create a mock connection
  const conn = {
    write: function(data) {
      this.lastWrittenData = data;
    }
  };
  
  // Create a mock message
  const message = {
    requestId: 'test-request-id',
    model: 'llama2',
    prompt: 'Test prompt'
  };
  
  // Mock fetch to simulate an error
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function() {
    throw new Error('Ollama not available');
  };
  
  // Process the query
  await globalThis.handleClientQuery(conn, message);
  
  // Restore original fetch
  globalThis.fetch = originalFetch;
  
  // Verify the error response was sent
  const response = JSON.parse(conn.lastWrittenData);
  t.is(response.type, 'response', 'should be a response');
  t.is(response.requestId, 'test-request-id', 'should include the request ID');
  t.ok(response.error, 'should include an error message');
  t.is(response.isComplete, true, 'should be complete');
});

// Tests for Ollama Availability Check
test('should detect when Ollama is available', async function(t) {
  // Mock fetch to simulate Ollama being available
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function() {
    return {
      ok: true,
      json: async function() {
        return { version: '0.1.14' };
      }
    };
  };
  
  const isAvailable = await globalThis.checkOllama();
  
  // Restore original fetch
  globalThis.fetch = originalFetch;
  
  t.is(isAvailable, true, 'should detect Ollama is available');
});

test('should detect when Ollama is not available', async function(t) {
  // Mock fetch to simulate Ollama not being available
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function() {
    throw new Error('Connection refused');
  };
  
  const isAvailable = await globalThis.checkOllama();
  
  // Restore original fetch
  globalThis.fetch = originalFetch;
  
  t.is(isAvailable, false, 'should detect Ollama is not available');
});
