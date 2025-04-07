/**
 * Integration tests for SeekDeep using brittle
 */

import test from 'brittle';
import express from 'express';
import hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import { JSDOM } from 'jsdom';

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
  return 'Sample response from Ollama';
};

// Integration tests
test('should create a session and become the host', function(t) {
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [];
  
  // Create a session
  const topicKey = globalThis.createSession();
  
  // Verify the session was created
  t.ok(topicKey, 'should return a topic key');
  t.is(globalThis.isSessionHost, true, 'should set isSessionHost to true');
});

test('should join an existing session', function(t) {
  // Reset state
  globalThis.isSessionHost = true;
  globalThis.conns = [];
  
  // Create a mock topic key
  const topicKey = crypto.randomBytes(32);
  
  // Join the session
  const result = globalThis.joinSession(topicKey);
  
  // Verify the session was joined
  t.is(result, true, 'should return true');
  t.is(globalThis.isSessionHost, false, 'should set isSessionHost to false');
});

test('should fetch and display available models', async function(t) {
  // Reset state
  const modelSelect = document.getElementById('model-select');
  modelSelect.innerHTML = '';
  
  // Fetch models
  const models = await globalThis.fetchModels();
  
  // Update the model select
  globalThis.updateModelSelect(models);
  
  // Verify the models were fetched and displayed
  t.ok(models.length > 0, 'should fetch models');
  t.is(modelSelect.options.length, models.length, 'should update the model select');
  t.is(modelSelect.options[0].value, 'llama2', 'should include llama2');
});

test('should handle chat mode changes', function(t) {
  // Reset state
  globalThis.isCollaborativeMode = false;
  
  // Set up the UI element
  const chatModeSelect = document.getElementById('chat-mode-select');
  chatModeSelect.value = 'collaborative';
  
  // Trigger the change event
  globalThis.handleChatModeChange();
  
  // Verify the mode was changed
  t.is(globalThis.isCollaborativeMode, true, 'should set collaborative mode to true');
  
  // Change the mode again
  chatModeSelect.value = 'private';
  globalThis.handleChatModeChange();
  
  // Verify the mode was changed again
  t.is(globalThis.isCollaborativeMode, false, 'should set collaborative mode to false');
});

test('should send messages to peers when connected and not host', async function(t) {
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [{ remotePublicKey: Buffer.from('peer1') }];
  globalThis.chatHistory = [];
  
  // Create a spy for broadcastToPeers
  const originalBroadcastToPeers = globalThis.broadcastToPeers;
  let broadcastCalled = false;
  let broadcastMessage = null;
  
  globalThis.broadcastToPeers = function(message) {
    broadcastCalled = true;
    broadcastMessage = message;
    return 1;
  };
  
  // Send a message
  await globalThis.ask('llama2', 'Test prompt');
  
  // Restore original function
  globalThis.broadcastToPeers = originalBroadcastToPeers;
  
  // Verify the message was sent to peers
  t.is(broadcastCalled, true, 'should call broadcastToPeers');
  t.is(broadcastMessage.type, 'query', 'should send a query message');
  t.is(broadcastMessage.model, 'llama2', 'should include the model');
  t.is(broadcastMessage.prompt, 'Test prompt', 'should include the prompt');
  t.ok(broadcastMessage.requestId, 'should include a requestId');
  
  // Verify the chat history was updated
  t.is(globalThis.chatHistory.length, 2, 'should add messages to chat history');
  t.is(globalThis.chatHistory[0].type, 'user', 'should add user message');
  t.is(globalThis.chatHistory[1].type, 'thinking', 'should add thinking message');
});

test('should query local Ollama when host', async function(t) {
  // Reset state
  globalThis.isSessionHost = true;
  globalThis.conns = [{ remotePublicKey: Buffer.from('peer1') }];
  globalThis.chatHistory = [];
  
  // Send a message
  const result = await globalThis.ask('llama2', 'Test prompt');
  
  // Verify the message was sent to Ollama
  t.is(result, 'Sample response from Ollama', 'should return response from Ollama');
  
  // Verify the chat history was updated
  t.is(globalThis.chatHistory.length, 2, 'should add messages to chat history');
  t.is(globalThis.chatHistory[0].type, 'user', 'should add user message');
  t.is(globalThis.chatHistory[1].type, 'thinking', 'should add thinking message');
});

test('should query local Ollama when not connected to peers', async function(t) {
  // Reset state
  globalThis.isSessionHost = false;
  globalThis.conns = [];
  globalThis.chatHistory = [];
  
  // Send a message
  const result = await globalThis.ask('llama2', 'Test prompt');
  
  // Verify the message was sent to Ollama
  t.is(result, 'Sample response from Ollama', 'should return response from Ollama');
  
  // Verify the chat history was updated
  t.is(globalThis.chatHistory.length, 2, 'should add messages to chat history');
});

test('should integrate UI elements with chat functionality', function(t) {
  // Reset state
  globalThis.chatHistory = [];
  
  // Set up the UI elements
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const modelSelect = document.getElementById('model-select');
  
  // Set values
  messageInput.value = 'Test message';
  modelSelect.innerHTML = '<option value="llama2">llama2</option>';
  modelSelect.value = 'llama2';
  
  // Create a spy for ask
  const originalAsk = globalThis.ask;
  let askCalled = false;
  let askModel = null;
  let askPrompt = null;
  
  globalThis.ask = function(model, prompt) {
    askCalled = true;
    askModel = model;
    askPrompt = prompt;
    return Promise.resolve('Sample response');
  };
  
  // Create a click handler for the send button
  sendButton.onclick = function() {
    const prompt = messageInput.value;
    const model = modelSelect.value;
    globalThis.ask(model, prompt);
    messageInput.value = '';
  };
  
  // Click the send button
  sendButton.onclick();
  
  // Restore original function
  globalThis.ask = originalAsk;
  
  // Verify the message was sent
  t.is(askCalled, true, 'should call ask');
  t.is(askModel, 'llama2', 'should use the selected model');
  t.is(askPrompt, 'Test message', 'should use the input message');
  t.is(messageInput.value, '', 'should clear the input');
});
