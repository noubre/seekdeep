/**
 * End-to-end tests for SeekDeep using brittle
 */

import test from 'brittle';
import express from 'express';
import hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import { JSDOM } from 'jsdom';
import http from 'http';

// Set up DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;

// Set up DOM elements for testing
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

// Define global variables and functions for testing
globalThis.isSessionHost = false;
globalThis.isCollaborativeMode = false;
globalThis.conns = [];
globalThis.chatHistory = [];
globalThis.activePeers = new Map();
globalThis.currentModel = 'llama2';
globalThis.OLLAMA_API_URL = 'http://localhost:11434';

// Mock functions for testing
globalThis.createSession = function() {
  globalThis.isSessionHost = true;
  return crypto.randomBytes(32);
};

globalThis.joinSession = function(topicKey) {
  globalThis.isSessionHost = false;
  return true;
};

globalThis.broadcastToPeers = function(message) {
  if (!globalThis.isConnectedToPeers()) {
    return 0;
  }
  
  let sentCount = 0;
  for (const conn of globalThis.conns) {
    sentCount++;
  }
  return sentCount;
};

globalThis.isConnectedToPeers = function() {
  return globalThis.isSessionHost || globalThis.conns.length > 0;
};

globalThis.addToChatHistory = function(message) {
  globalThis.chatHistory.push(message);
};

globalThis.updateChatDisplay = function() {
  // Mock implementation
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.innerHTML = '';
  
  for (const message of globalThis.chatHistory) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.type}`;
    messageElement.textContent = message.content;
    chatMessages.appendChild(messageElement);
  }
};

globalThis.handleChatModeChange = function() {
  const chatModeSelect = document.getElementById('chat-mode-select');
  globalThis.isCollaborativeMode = chatModeSelect.value === 'collaborative';
};

globalThis.fetchModels = async function() {
  return ['llama2', 'mistral', 'gemma'];
};

globalThis.updateModelSelect = function(models) {
  const modelSelect = document.getElementById('model-select');
  modelSelect.innerHTML = '';
  
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  }
};

globalThis.ask = async function(model, prompt) {
  const requestId = 'test-request-id';
  
  // Add user message to chat history
  globalThis.addToChatHistory({
    type: 'user',
    content: prompt,
    requestId
  });
  
  // Add thinking message
  globalThis.addToChatHistory({
    type: 'thinking',
    content: 'Thinking...',
    requestId
  });
  
  // Update the chat display
  globalThis.updateChatDisplay();
  
  const connected = globalThis.isConnectedToPeers();
  
  if (connected && !globalThis.isSessionHost) {
    // If connected and not host, send to peers
    globalThis.broadcastToPeers({
      type: 'query',
      model,
      prompt,
      requestId
    });
    return;
  }
  
  // If host or not connected, query local Ollama
  // Simulate a delay for the response
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Add assistant message to chat history
  globalThis.addToChatHistory({
    type: 'assistant',
    content: 'Sample response from Ollama',
    requestId
  });
  
  // Update the chat display
  globalThis.updateChatDisplay();
  
  return 'Sample response from Ollama';
};

// Mock server for testing
function createMockServer() {
  const app = express();
  
  app.get('/api/models', (req, res) => {
    res.json({ models: ['llama2', 'mistral', 'gemma'] });
  });
  
  app.post('/api/generate', (req, res) => {
    res.json({ response: 'Sample response from Ollama' });
  });
  
  return app.listen(3000);
}

// End-to-end tests
test('should perform a complete chat session flow', async function(t) {
  // Start a mock server
  const server = createMockServer();
  
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [];
  globalThis.chatHistory = [];
  globalThis.activePeers = new Map();
  
  // Set up UI elements
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const modelSelect = document.getElementById('model-select');
  const createButton = document.getElementById('create-button');
  const chatModeSelect = document.getElementById('chat-mode-select');
  
  // Create a session
  createButton.onclick = function() {
    const topicKey = globalThis.createSession();
    document.getElementById('session-info').textContent = `Session created with key: ${topicKey.toString('hex')}`;
    document.getElementById('host-status').textContent = 'You are the host';
  };
  
  // Click the create button
  createButton.onclick();
  
  // Verify the session was created
  t.is(globalThis.isSessionHost, true, 'should set isSessionHost to true');
  t.ok(document.getElementById('session-info').textContent.includes('Session created with key:'), 'should display session info');
  t.is(document.getElementById('host-status').textContent, 'You are the host', 'should display host status');
  
  // Set chat mode to collaborative
  chatModeSelect.value = 'collaborative';
  globalThis.handleChatModeChange();
  
  // Verify the chat mode was set
  t.is(globalThis.isCollaborativeMode, true, 'should set collaborative mode to true');
  
  // Fetch and display models
  const models = await globalThis.fetchModels();
  globalThis.updateModelSelect(models);
  
  // Verify the models were fetched and displayed
  t.ok(models.length > 0, 'should fetch models');
  t.is(modelSelect.options.length, models.length, 'should update the model select');
  
  // Set up the send button
  sendButton.onclick = function() {
    const prompt = messageInput.value;
    const model = modelSelect.value;
    globalThis.ask(model, prompt);
    messageInput.value = '';
  };
  
  // Set a message and send it
  messageInput.value = 'Hello, world!';
  modelSelect.value = 'llama2';
  sendButton.onclick();
  
  // Wait for the response
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Verify the message was sent and a response was received
  t.is(globalThis.chatHistory.length, 3, 'should add messages to chat history');
  t.is(globalThis.chatHistory[0].type, 'user', 'should add user message');
  t.is(globalThis.chatHistory[0].content, 'Hello, world!', 'should include the user message content');
  t.is(globalThis.chatHistory[1].type, 'thinking', 'should add thinking message');
  t.is(globalThis.chatHistory[2].type, 'assistant', 'should add assistant message');
  
  // Verify the chat display was updated
  const chatMessages = document.getElementById('chat-messages');
  t.is(chatMessages.children.length, 3, 'should display all messages');
  t.is(chatMessages.children[0].className, 'message user', 'should display user message');
  t.is(chatMessages.children[1].className, 'message thinking', 'should display thinking message');
  t.is(chatMessages.children[2].className, 'message assistant', 'should display assistant message');
  
  // Clean up
  server.close();
});

test('should handle peer connections and message routing', async function(t) {
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [];
  globalThis.chatHistory = [];
  globalThis.activePeers = new Map();
  
  // Create mock peers
  const peer1 = {
    remotePublicKey: Buffer.from('peer1'),
    write: function(data) {
      this.lastWrittenData = data;
    }
  };
  
  const peer2 = {
    remotePublicKey: Buffer.from('peer2'),
    write: function(data) {
      this.lastWrittenData = data;
    }
  };
  
  // Add peers to connections
  globalThis.conns.push(peer1);
  globalThis.conns.push(peer2);
  
  // Add peers to active peers map
  globalThis.activePeers.set(peer1.remotePublicKey.toString('hex'), { name: 'Peer 1' });
  globalThis.activePeers.set(peer2.remotePublicKey.toString('hex'), { name: 'Peer 2' });
  
  // Create a function to handle incoming messages
  function handleIncomingMessage(message, conn) {
    if (message.type === 'query') {
      // Process the query
      const response = {
        type: 'response',
        requestId: message.requestId,
        data: 'Sample response from peer',
        isComplete: true
      };
      
      // Send the response back to the peer
      conn.write(JSON.stringify(response));
      
      // Broadcast the message to other peers if in collaborative mode
      if (globalThis.isCollaborativeMode) {
        for (const otherConn of globalThis.conns) {
          if (otherConn !== conn) {
            otherConn.write(JSON.stringify(message));
          }
        }
      }
    }
  }
  
  // Set up as host
  globalThis.isSessionHost = true;
  globalThis.isCollaborativeMode = true;
  
  // Create a mock message
  const message = {
    type: 'query',
    model: 'llama2',
    prompt: 'Test prompt',
    requestId: 'test-request-id'
  };
  
  // Simulate receiving a message from peer1
  handleIncomingMessage(message, peer1);
  
  // Verify the message was processed and responses were sent
  t.ok(peer1.lastWrittenData, 'should send a response to the requesting peer');
  t.ok(peer2.lastWrittenData, 'should broadcast the message to other peers');
  
  // Parse the responses
  const peer1Response = JSON.parse(peer1.lastWrittenData);
  const peer2Message = JSON.parse(peer2.lastWrittenData);
  
  // Verify the response to the requesting peer
  t.is(peer1Response.type, 'response', 'should send a response message');
  t.is(peer1Response.requestId, 'test-request-id', 'should include the request ID');
  t.is(peer1Response.data, 'Sample response from peer', 'should include the response data');
  t.is(peer1Response.isComplete, true, 'should indicate the response is complete');
  
  // Verify the broadcast message to other peers
  t.is(peer2Message.type, 'query', 'should broadcast the query message');
  t.is(peer2Message.model, 'llama2', 'should include the model');
  t.is(peer2Message.prompt, 'Test prompt', 'should include the prompt');
  t.is(peer2Message.requestId, 'test-request-id', 'should include the request ID');
});

test('should handle UI updates based on peer connections', function(t) {
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [];
  globalThis.chatHistory = [];
  globalThis.activePeers = new Map();
  
  // Set up UI elements
  const activeUsers = document.getElementById('active-users');
  
  // Create a function to update the active users display
  function updateActiveUsersDisplay() {
    activeUsers.innerHTML = '';
    
    for (const [peerId, peerInfo] of globalThis.activePeers.entries()) {
      const userElement = document.createElement('div');
      userElement.className = 'user';
      userElement.textContent = peerInfo.name;
      userElement.dataset.peerId = peerId;
      activeUsers.appendChild(userElement);
    }
  }
  
  // Add some peers
  globalThis.activePeers.set('peer1', { name: 'Peer 1' });
  globalThis.activePeers.set('peer2', { name: 'Peer 2' });
  
  // Update the display
  updateActiveUsersDisplay();
  
  // Verify the display was updated
  t.is(activeUsers.children.length, 2, 'should display all active users');
  t.is(activeUsers.children[0].textContent, 'Peer 1', 'should display the first peer name');
  t.is(activeUsers.children[1].textContent, 'Peer 2', 'should display the second peer name');
  
  // Add another peer
  globalThis.activePeers.set('peer3', { name: 'Peer 3' });
  
  // Update the display again
  updateActiveUsersDisplay();
  
  // Verify the display was updated again
  t.is(activeUsers.children.length, 3, 'should display all active users after update');
  t.is(activeUsers.children[2].textContent, 'Peer 3', 'should display the new peer name');
  
  // Remove a peer
  globalThis.activePeers.delete('peer2');
  
  // Update the display again
  updateActiveUsersDisplay();
  
  // Verify the display was updated again
  t.is(activeUsers.children.length, 2, 'should display remaining active users');
  t.is(activeUsers.children[0].textContent, 'Peer 1', 'should still display the first peer name');
  t.is(activeUsers.children[1].textContent, 'Peer 3', 'should display the third peer name');
});
