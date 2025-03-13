/** @typedef {import('pear-interface')} */
/* global Pear, marked */
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

// DOM elements
const form = document.querySelector('form');
const chatMessagesEl = document.getElementById('chat-messages');
const activeUsersEl = document.getElementById('active-users');
const promptArea = document.querySelector('textarea[name="prompt"]');
const topicKeyInput = document.getElementById('topic-key');
const joinButton = document.getElementById('join-button');
const chatModeSelect = document.getElementById('chat-mode');
const modelSelect = document.getElementById('model-select');
const refreshModelsButton = document.getElementById('refresh-models');

// Default models list - these are common Ollama models
const DEFAULT_MODELS = [
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek 1.5b' },
  { id: 'llama2:7b', name: 'Llama 2 7B' },
  { id: 'mistral:7b', name: 'Mistral 7B' },
  { id: 'phi:2.7b', name: 'Phi-2 2.7B' },
  { id: 'gemma:7b', name: 'Gemma 7B' }
];

// Default model to use
let currentModel = 'deepseek-r1:1.5b';

// Configure marked.js for secure Markdown rendering
marked.setOptions({
  renderer: new marked.Renderer(),
  highlight: function(code, lang) {
    return code;
  },
  pedantic: false,
  gfm: true,
  breaks: true,
  sanitize: true,
  smartypants: false,
  xhtml: false
});

// Peer colors - used for visual distinction between different peers
const PEER_COLORS = [
  { class: 'peer-color-1', name: 'Blue' },
  { class: 'peer-color-2', name: 'Teal' },
  { class: 'peer-color-3', name: 'Purple' },
  { class: 'peer-color-4', name: 'Red' },
  { class: 'peer-color-5', name: 'Green' }
];

// Get the Ollama base URL (from Pear.links or fallback to default)
const getOllamaBaseUrl = () => {
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
};

/**
 * Parse the Ollama response to extract the text content
 * 
 * @param {string|object} text - The raw response from Ollama API
 * @returns {string} The extracted text content
 */
function parseOllamaResponse(text) {
  // Handle null or undefined input
  if (!text) {
    return '';
  }
  
  // If the input is not a string, convert it to a string
  if (typeof text !== 'string') {
    return text && typeof text === 'object' ? JSON.stringify(text) : String(text || '');
  }
  
  // Try to parse as a JSON object first
  try {
    // For streaming responses, Ollama may return multiple JSON objects
    // Split by newlines and attempt to parse each line
    const lines = text.split('\n').filter(line => line.trim());
    let lastValidResponse = '';
    
    // If there are multiple lines, try to parse each one
    if (lines.length > 0) {
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          // If we have a valid Ollama response with a text field, use it
          if (json && typeof json.response === 'string') {
            lastValidResponse = json.response;
          }
        } catch (innerErr) {
          // If a line can't be parsed as JSON, ignore it
          console.log("Couldn't parse line as JSON:", line);
        }
      }
      
      // If we found at least one valid response, return it
      if (lastValidResponse) {
        return removeThinkingContent(lastValidResponse);
      }
    }
    
    // If we didn't find any valid responses in lines, try parsing the entire text
    const json = JSON.parse(text);
    
    // Handle the Ollama API response format
    if (json.response) {
      return removeThinkingContent(json.response);
    } else if (json.message) {
      return removeThinkingContent(json.message);
    } else {
      // If we can't find the response field, return an empty string
      // instead of the raw JSON which would be confusing to display
      console.warn("Unknown JSON response format:", json);
      return '';
    }
  } catch (e) {
    // If it's not valid JSON at all, return the raw text
    // This handles cases where the API might return plain text
    return removeThinkingContent(text);
  }
}

// Preserve content inside <think> tags, but clearly mark it as thinking content
// Skip empty thinking sections that only contain newlines
function removeThinkingContent(text) {
  // Handle non-string input
  if (typeof text !== 'string') {
    return text;
  }
  
  // Check if there are any thinking tags
  if (!text.includes('<think>') || !text.includes('</think>')) {
    return text;
  }
  
  // Process thinking tags with a regular expression
  return text.replace(/<think>([\s\S]*?)<\/think>/g, (match, thinkContent) => {
    // If thinking content only contains whitespace/newlines, remove it completely
    if (!thinkContent.trim()) {
      return '';
    }
    // Format thinking content with special styling for rendering in the UI
    return `<div class="thinking-content"><span class="thinking-label">Thinking:</span>${thinkContent}</div>`;
  });
}

// Initialize Hyperswarm
const swarm = new Hyperswarm();
let topic; // Will store current topic
let topicHex; // Will store hex representation of topic
const conns = [];

// Track users/peers in the chat
const activePeers = new Map(); // Maps peer IDs to their info (name, color, etc.)
let nextPeerColorIndex = 0;
let isSessionHost = false; // Track whether user is a host (created session) or joiner (joined via swarm key)
let isCollaborativeMode = true; // Track whether we're in collaborative mode (shared chat) or private mode (separate chats)

// Maintain chat history to show user and LLM messages
let chatHistory = [];
let activeRequests = new Map(); // Map to store all active request IDs and their metadata
let activeRequestId = null; // Store the ID of our current request

// To track active LLM responses and prevent duplicates
// Keep track of peer message handlers
const peerHandlers = new Map();

// Get the next peer color in rotation
function getNextPeerColor() {
  const color = PEER_COLORS[nextPeerColorIndex];
  nextPeerColorIndex = (nextPeerColorIndex + 1) % PEER_COLORS.length;
  return color;
}

// Add or update a peer in the active peers list
function updateActivePeer(peerId, peerInfo) {
  // If peer already exists, update their info
  if (activePeers.has(peerId)) {
    const existingInfo = activePeers.get(peerId);
    activePeers.set(peerId, { ...existingInfo, ...peerInfo });
  } else {
    // If new peer, assign a color and add them
    const color = getNextPeerColor();
    // Find the next available peer number
    let peerNumber = activePeers.size + 1; // Start from Peer1
    // Ensure we're not reusing numbers
    const usedNumbers = new Set();
    activePeers.forEach(p => {
      if (p.peerNumber) usedNumbers.add(p.peerNumber);
    });
    while (usedNumbers.has(peerNumber)) {
      peerNumber++;
    }
    
    activePeers.set(peerId, { 
      id: peerId,
      displayName: peerInfo.displayName || `Peer${peerNumber}`,
      peerNumber: peerNumber,
      colorClass: color.class,
      colorName: color.name,
      ...peerInfo 
    });
  }
  
  // Update the active users display
  updateActiveUsersDisplay();
}

// Remove a peer from the active list
function removePeer(peerId) {
  activePeers.delete(peerId);
  updateActiveUsersDisplay();
}

// Update the active users display in the UI
function updateActiveUsersDisplay() {
  // Clear current display
  activeUsersEl.innerHTML = '';
  
  // Add yourself
  const youChip = document.createElement('div');
  youChip.className = 'user-chip';
  youChip.style.backgroundColor = '#4A6BBF';
  youChip.textContent = 'You';
  activeUsersEl.appendChild(youChip);
  
  // Add each peer
  activePeers.forEach(peer => {
    const peerChip = document.createElement('div');
    peerChip.className = 'user-chip';
    // Get the background color from the peer's color class
    const colorClass = document.createElement('div');
    colorClass.className = peer.colorClass;
    document.body.appendChild(colorClass);
    const computedStyle = window.getComputedStyle(colorClass);
    peerChip.style.backgroundColor = computedStyle.backgroundColor;
    document.body.removeChild(colorClass);
    
    peerChip.textContent = peer.displayName;
    activeUsersEl.appendChild(peerChip);
  });
}

// Function to initialize a new chat session with our own topic
function initializeNewChat() {
  // Generate a new random topic
  topic = crypto.randomBytes(32);
  topicHex = b4a.toString(topic, 'hex');
  
  // Clear existing connections
  leaveExistingChat();
  
  // Clear chat history
  chatHistory.length = 0;
  
  // Reset peer color index
  nextPeerColorIndex = 0;
  
  // Set as session host
  isSessionHost = true;
  
  // Enable the chat mode select dropdown (only host can change mode)
  chatModeSelect.disabled = false;
  
  // Get the current mode from the UI
  isCollaborativeMode = chatModeSelect.value === 'collaborative';
  
  // Log connection status
  console.log('Starting new chat session with topic:', topicHex);
  console.log('Chat mode:', isCollaborativeMode ? 'Collaborative' : 'Private');
  
  // Add initial system message
  addToChatHistory({
    type: 'system',
    content: `Connected to Hyperswarm. Waiting for peers...\n\nP2P Topic: ${topicHex}\n\nShare this topic with others to let them join your chat session.\n\nChat mode: ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'}`
  });
  
  // Join swarm with our topic
  swarm.join(topic, { server: true, client: true });
}

// Function to join an existing chat with provided topic
function joinExistingChat(topicKeyHex) {
  try {
    // Validate the topic key format
    if (!topicKeyHex || topicKeyHex.length !== 64 || !/^[0-9a-f]+$/i.test(topicKeyHex)) {
      throw new Error('Invalid topic key format. It should be a 64-character hexadecimal string.');
    }
    
    // Convert hex string to Buffer
    topic = b4a.from(topicKeyHex, 'hex');
    topicHex = topicKeyHex;
    
    // Clear existing connections
    leaveExistingChat();
    
    // Clear chat history
    chatHistory.length = 0;
    
    // Reset peer color index
    nextPeerColorIndex = 0;
    
    // Set as joiner (not host)
    isSessionHost = false;
    
    // Disable the chat mode select dropdown (only host can change mode)
    chatModeSelect.disabled = true;
    
    // As a joiner, we'll get the mode from the host later
    // but we'll start with our preferred mode from the UI
    isCollaborativeMode = chatModeSelect.value === 'collaborative';
    
    // Log connection status
    console.log('Joining existing chat session with topic:', topicHex);
    console.log('Chat mode (will be updated from host):', isCollaborativeMode ? 'Collaborative' : 'Private');
    
    // Add initial system message
    addToChatHistory({
      type: 'system',
      content: `Joining existing chat session with topic: ${topicHex}\n\nWaiting for peers...\n\nYour preferred chat mode: ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'} (will be updated from host)`
    });
    
    // Join the swarm with the provided topic
    swarm.join(topic, { server: true, client: true });
    
    return true;
  } catch (error) {
    console.error('Error joining chat:', error);
    addToChatHistory({
      type: 'system',
      content: `Error joining chat: ${error.message}`
    });
    return false;
  }
}

// Function to leave the current chat
function leaveExistingChat() {
  // Leave the current topic if it exists
  if (topic) {
    try {
      swarm.leave(topic);
    } catch (err) {
      console.warn('Error leaving topic:', err);
    }
  }
  
  // Disconnect all existing connections
  for (const conn of conns) {
    try {
      conn.destroy();
    } catch (err) {
      console.warn('Error destroying connection:', err);
    }
  }
  
  // Clear connections array
  conns.length = 0;
  
  // Clear active peers
  activePeers.clear();
  
  // Reset host status (will be set again when creating/joining a new chat)
  isSessionHost = false;
  
  // Clear peer handlers
  peerHandlers.clear();
  
  // When leaving a chat, we're not in any session, so enable the dropdown
  // It will be properly set again when joining or creating a new session
  chatModeSelect.disabled = false;
}

// Initialize a new chat session by default
initializeNewChat();

// Fetch available models from Ollama (only if we're not trying to join an existing session)
if (!window.location.hash) {
  fetchAvailableModels();
}

// Add event listener for the refresh models button
refreshModelsButton.addEventListener('click', () => {
  // Add a visual indication that refresh is happening
  refreshModelsButton.classList.add('refreshing');
  refreshModelsButton.disabled = true;
  
  // Show a system message in the chat
  addToChatHistory({
    type: 'system',
    content: 'Refreshing available models...'
  });
  
  // If we're connected as a peer to a host, we should request models from the host
  if (!isSessionHost && conns.length > 0) {
    // Request models from the host
    if (requestModelsFromHost()) {
      // The actual refresh will happen when we receive the models from the host
      return;
    }
  }
  
  // Fetch the models
  fetchAvailableModels()
    .then(() => {
      // Add success message
      addToChatHistory({
        type: 'system',
        content: 'Model list refreshed successfully!'
      });
    })
    .catch(error => {
      // Add error message
      addToChatHistory({
        type: 'system',
        content: `Error refreshing models: ${error.message}`
      });
    })
    .finally(() => {
      // Remove visual indication
      refreshModelsButton.classList.remove('refreshing');
      refreshModelsButton.disabled = false;
    });
});

// Handle new connections
swarm.on('connection', conn => {
  const remotePublicKey = b4a.toString(conn.remotePublicKey, 'hex');
  console.log('New peer connected:', remotePublicKey);
  
  // Add to chat history and update display
  addToChatHistory({
    type: 'system',
    content: `New peer connected: ${remotePublicKey.slice(0, 8)}...`
  });
  
  // Add to connections list
  conns.push(conn);
  
  // Add the peer to our active list with a default name before handshake
  updateActivePeer(remotePublicKey, {
    id: remotePublicKey,
    displayName: `Peer${remotePublicKey.slice(0, 6)}`,
    clientId: remotePublicKey,
    connectionTime: new Date()
  });
  
  // Set up message handler for this connection
  const messageHandler = setupPeerMessageHandler(conn, remotePublicKey);
  peerHandlers.set(remotePublicKey, messageHandler);
  
  // Handle incoming data
  conn.on('data', data => {
    try {
      console.log(`[PEER] Received data from peer: ${remotePublicKey.slice(0, 8)}... (${data.length} bytes)`);
      messageHandler(data);
    } catch (err) {
      console.error('Error handling peer message:', err);
    }
  });
  
  // Send initial handshake with our info
  conn.write(JSON.stringify({
    type: 'handshake',
    clientId: b4a.toString(swarm.keyPair.publicKey, 'hex'),
    displayName: 'You', // This will be displayed as "You" on our side but as Peer1, Peer2, etc. on the peer's side
    timestamp: Date.now()
  }));
  
  conn.on('close', () => {
    console.log('Peer disconnected:', remotePublicKey);
    
    // Add to chat history and update display
    addToChatHistory({
      type: 'system',
      content: `Peer disconnected: ${remotePublicKey.slice(0, 8)}...`
    });
    
    // Remove from connections list
    const index = conns.indexOf(conn);
    if (index > -1) conns.splice(index, 1);
    
    // Remove from active peers
    removePeer(remotePublicKey);
    
    // Remove from peer handlers
    peerHandlers.delete(remotePublicKey);
  });
});

// Create a message element to add to the chat
function createMessageElement(message) {
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');
  
  console.log("Creating message element for:", message);
  
  // We'll now process the content differently based on message type
  let messageContent = '';
  
  if (message.type === 'assistant') {
    // For assistant messages, always use the raw content if available
    // This ensures thinking content is properly rendered
    if (message.rawContent) {
      // Process the raw content to properly format thinking tags
      messageContent = removeThinkingContent(message.rawContent);
    } else {
      // If no raw content, fall back to regular content
      messageContent = message.content || '';
    }
  } else {
    // For non-assistant messages, just use the content
    messageContent = message.content || '';
  }
  
  switch (message.type) {
    case 'user': {
      messageEl.classList.add('user-message');
      
      let sender = 'You';
      if (message.fromPeer) {
        sender = message.fromPeer;
        if (sender !== 'Host' && sender !== 'You') {
          messageEl.classList.add('peer-message');
          
          // Find the peer color class
          for (const [peerId, peerInfo] of activePeers.entries()) {
            if (peerInfo.displayName === sender) {
              const colorIndex = PEER_COLORS.indexOf(peerInfo.color);
              if (colorIndex >= 0) {
                messageEl.classList.add(`peer-color-${colorIndex + 1}`);
              }
              // Store peer info for response attribution
              messageEl.dataset.peerName = sender;
              messageEl.dataset.peerColor = peerInfo.color;
              break;
            }
          }
        }
      }
      
      // Create header
      const userHeader = document.createElement('div');
      userHeader.classList.add('message-header');
      userHeader.textContent = sender;
      messageEl.appendChild(userHeader);
      
      // Create body
      const userBody = document.createElement('div');
      userBody.classList.add('message-body');
      userBody.textContent = messageContent;
      messageEl.appendChild(userBody);
      break;
    }
    
    case 'assistant': {
      messageEl.classList.add('assistant-message');
      
      // Find which user message this is responding to
      let respondingTo = null;
      let respondingColor = null;
      
      // Try to find the matching request ID in chat history
      if (message.requestId) {
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          const historyMsg = chatHistory[i];
          if (historyMsg.type === 'user' && historyMsg.requestId === message.requestId) {
            respondingTo = historyMsg.fromPeer || 'You';
            break;
          }
        }
      }
      
      // Create header
      const assistantHeader = document.createElement('div');
      assistantHeader.classList.add('message-header');
      
      // Get model name
      const modelInfo = DEFAULT_MODELS.find(m => m.id === currentModel) || { name: 'AI Assistant' };
      assistantHeader.textContent = modelInfo.name;
      
      // Add responding-to attribution if available
      if (respondingTo) {
        const respondingEl = document.createElement('span');
        respondingEl.classList.add('responding-to');
        respondingEl.textContent = `to ${respondingTo}`;
        
        // Add color dot if we have a peer color
        if (respondingTo !== 'You' && respondingTo !== 'Host') {
          for (const [peerId, peerInfo] of activePeers.entries()) {
            if (peerInfo.displayName === respondingTo) {
              const colorDot = document.createElement('span');
              colorDot.classList.add('color-dot');
              colorDot.style.backgroundColor = peerInfo.color;
              respondingEl.prepend(colorDot);
              break;
            }
          }
        }
        
        assistantHeader.appendChild(respondingEl);
      }
      
      messageEl.appendChild(assistantHeader);
      
      // Create body with Markdown rendering
      const assistantBody = document.createElement('div');
      assistantBody.classList.add('message-body');
      
      // Render Markdown if content seems to contain it
      if (containsMarkdown(messageContent) || messageContent.includes('<div class="thinking-content">')) {
        assistantBody.innerHTML = renderMarkdown(messageContent);
      } else {
        assistantBody.innerHTML = messageContent.replace(/\n/g, '<br>');
      }
      
      messageEl.appendChild(assistantBody);
      break;
    }
    
    case 'system':
      messageEl.classList.add('message-system');
      messageEl.textContent = messageContent;
      break;
      
    case 'thinking':
      messageEl.classList.add('message-thinking');
      messageEl.textContent = messageContent;
      break;
      
    default:
      messageEl.textContent = JSON.stringify(message);
  }
  
  // Store request ID for later reference
  if (message.requestId) {
    messageEl.dataset.requestId = message.requestId;
  }
  
  return messageEl;
}

// Add message to chat history and update display
function addToChatHistory(message) {
  // Generate requestId if not present and it's a user message
  if (message.type === 'user' && !message.requestId) {
    message.requestId = crypto.randomBytes(8).toString('hex');
  }
  
  chatHistory.push(message);
  
  // Keep chat history at a reasonable size
  if (chatHistory.length > 100) {
    chatHistory.shift();
  }
  
  updateChatDisplay();
}

// Update the chat display from the history
function updateChatDisplay() {
  // Clear current display
  chatMessagesEl.innerHTML = '';
  
  // Keep track of the last message type to avoid duplicates
  let lastMessageType = null;
  let lastMessageContent = null;
  
  for (const message of chatHistory) {
    // Skip duplicate consecutive assistant messages
    if (message.type === 'assistant' && lastMessageType === 'assistant' && message.content === lastMessageContent) {
      console.log("Skipping duplicate consecutive message in display");
      continue;
    }
    
    // Create and append message element
    const messageEl = createMessageElement(message);
    chatMessagesEl.appendChild(messageEl);
    
    lastMessageType = message.type;
    lastMessageContent = message.content;
  }
  
  // Scroll to the bottom
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Add a function to broadcast messages to all peers
function broadcastToPeers(message, targetPeerId = null) {
  // If the message is an assistant response, use the streamToPeers function
  if (message.messageType === 'assistant') {
    streamToPeers(
      message.content, 
      message.requestId, 
      message.isComplete || false, 
      message.fromPeer || 'Host'
    );
    return;
  }
  
  // For non-assistant messages, broadcast as usual
  if (conns.length > 0) {
    // In collaborative mode, send to all peers
    // In private mode, only send to the specific peer if targetPeerId is provided
    if (isCollaborativeMode) {
      // Broadcast to all connected peers
      for (const conn of conns) {
        conn.write(JSON.stringify(message));
      }
    } else if (targetPeerId) {
      // In private mode, only send to the specified peer
      for (const conn of conns) {
        const peerId = b4a.toString(conn.remotePublicKey, 'hex');
        if (peerId === targetPeerId) {
          conn.write(JSON.stringify(message));
          break;
        }
      }
    }
  }
}

// Update the ask function to broadcast host's queries and responses
async function ask(model, prompt) {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  // Add user message to chat
  const userMessage = {
    type: 'user',
    content: prompt,
    requestId: requestId,
    fromPeer: isSessionHost ? 'Host' : 'You' // Explicitly mark host messages
  };
  
  addToChatHistory(userMessage);
  
  // If host is submitting, broadcast the user message to peers
  if (isSessionHost && isCollaborativeMode) {
    broadcastToPeers({
      type: 'peer_message',
      messageType: 'user',
      content: prompt,
      fromPeer: 'Host',
      requestId: requestId
    });
  }
  
  // Add thinking message
  addToChatHistory({
    type: 'thinking',
    content: 'Thinking...',
    requestId: requestId
  });
  
  try {
    if (isSessionHost) {
      // If we're the host, query our local Ollama
      const baseUrl = getOllamaBaseUrl();
      const url = new URL('/api/generate', baseUrl);
      
      console.log('Querying LLM at URL:', url.toString());
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: true
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const reader = response.body.getReader();
      let decoder = new TextDecoder();
      let responseText = '';
      
      // Remove the thinking message
      chatHistory.pop();
      
      // Create a temporary thinking message to show progress
      const thinkingMessage = {
        type: 'thinking',
        content: 'Generating response...',
        requestId: requestId
      };
      addToChatHistory(thinkingMessage);
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        console.log("Raw chunk from Ollama:", chunk);
        
        try {
          // For streaming responses, each chunk should be a JSON object
          const json = JSON.parse(chunk);
          
          // Extract just the response text from the JSON
          const responseChunk = json.response || '';
          console.log("Extracted response chunk:", responseChunk);
          
          // Add the response chunk to our full response text
          responseText += responseChunk;
          
          // Update the thinking message to show progress
          thinkingMessage.content = `Generating response... (${Math.round(responseText.length / 10)} tokens)`;
          updateChatDisplay();
          
          // Broadcast our own responses to connected peers in collaborative mode
          if (isCollaborativeMode) {
            streamToPeers(responseChunk, requestId);
          }
        } catch (parseError) {
          console.warn("Error parsing chunk as JSON:", parseError);
          // If not valid JSON, use the parseOllamaResponse as a fallback
          const fallbackResponse = parseOllamaResponse(chunk);
          if (fallbackResponse) {
            responseText += fallbackResponse;
            
            // Update the thinking message to show progress
            thinkingMessage.content = `Generating response... (${Math.round(responseText.length / 10)} tokens)`;
            updateChatDisplay();
            
            if (isCollaborativeMode) {
              streamToPeers(fallbackResponse, requestId);
            }
          }
        }
      }
      
      // Remove the thinking message
      chatHistory.pop();
      
      console.log("Creating final message with content:", responseText);
      console.log("Contains thinking tags:", responseText.includes("<think>"));
      
      const assistantMessage = {
        type: 'assistant',
        content: removeThinkingContent(responseText), // Process thinking content just like peer messages
        rawContent: responseText, // Store raw content with thinking tags
        requestId: requestId,
        fromPeer: 'Host', // Explicitly mark as from host for attribution
        isComplete: true
      };
      
      // Log the processed content
      console.log("Processed content:", assistantMessage.content);
      console.log("Contains thinking HTML:", assistantMessage.content.includes("thinking-content"));
      
      addToChatHistory(assistantMessage);
      updateChatDisplay();
      
      // Send the isComplete signal to peers
      if (isCollaborativeMode) {
        streamToPeers("", requestId, true);
      }
      
      // Store this requestId as our activeRequestId
      activeRequestId = requestId;
      // Add to our activeRequests tracking map
      activeRequests.set(requestId, {
        timestamp: Date.now(),
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${requestId}`);
      console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
      
      // Return the full response for any further processing
      return responseText;
    } else {
      // If we're not the host, we need to send the query to the host
      // Find the host connection (the first peer we connected to)
      const hostConn = conns[0];
      
      if (!hostConn) {
        throw new Error('Not connected to a host');
      }
      
      // Store the requestId as our activeRequestId so we can track responses
      activeRequestId = requestId;
      // Also store in our activeRequests map with timestamp
      activeRequests.set(requestId, {
        timestamp: Date.now(),
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${activeRequestId} for our peer query`);
      console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
      
      // Send the query to the host
      hostConn.write(JSON.stringify({
        type: 'query',
        model,
        prompt,
        requestId,
        fromPeerId: b4a.toString(swarm.keyPair.publicKey, 'hex')
      }));
      
      // The response will come back asynchronously via the message handler
      console.log('Query sent to host, awaiting response');
      return null;
    }
  } catch (error) {
    console.error('Error in ask:', error);
    
    // Remove the thinking message
    chatHistory.pop();
    
    // Add error message
    addToChatHistory({
      type: 'system',
      content: `Error: ${error.message}`,
      requestId: requestId
    });
    
    return null;
  }
}

// Update the message handler to handle peer messages
function setupPeerMessageHandler(conn, peerId) {
  return function handleMessage(data) {
    const message = JSON.parse(data.toString());
    console.log(`[PEER] Message from ${peerId.slice(0, 8)}... - Type: ${message.type}`, message);
    
    switch (message.type) {
      case 'handshake':
        // When a peer says they're "You", we need to give them a proper peer number
        let displayName = message.displayName;
        if (displayName === 'You') {
          // Assign a peer number instead of showing "You"
          let peerNumber = activePeers.size + 1; // Start from Peer1
          // Ensure we're not reusing numbers
          const usedNumbers = new Set();
          activePeers.forEach(p => {
            if (p.peerNumber) usedNumbers.add(p.peerNumber);
          });
          while (usedNumbers.has(peerNumber)) {
            peerNumber++;
          }
          
          displayName = `Peer${peerNumber}`;
        }
        
        // Update peer information with their details
        updateActivePeer(peerId, {
          displayName: displayName || `Peer${peerId.slice(0, 6)}`,
          clientId: message.clientId,
          metadata: message.metadata
        });
        
        // Share our current mode with the peer
        conn.write(JSON.stringify({
          type: 'mode_update',
          isCollaborativeMode: isCollaborativeMode
        }));

        // If we're the host, share our models with the peer
        if (isSessionHost) {
          // Get models from our local instance to share with peer
          fetchAvailableModels(true).then(models => {
            // Transform the models to match the format expected by updateModelSelect
            const formattedModels = models.map(model => ({
              name: model.name,
              id: model.name,
              modified_at: model.modified_at
            }));
            
            conn.write(JSON.stringify({
              type: 'models_update',
              models: formattedModels
            }));
          }).catch(err => {
            console.error('Error fetching models to share with peer:', err);
          });
        }
        
        addToChatHistory({
          type: 'system',
          content: `Peer ${peerId.slice(0, 8)}... identified as ${displayName || message.clientId.slice(0, 8)}...`
        });
        break;
        
      case 'handshake_ack':
        // Server has acknowledged our handshake
        console.log('Server acknowledged handshake:', message);
        
        // Update the peer information with server ID if available
        if (message.serverId) {
          updateActivePeer(peerId, {
            displayName: 'Server',
            serverId: message.serverId,
            isServer: true
          });
          
          addToChatHistory({
            type: 'system',
            content: `Connected to server ${message.serverId.slice(0, 8)}...`
          });
        }
        break;
        
      case 'mode_update':
        // Received update about the host's collaborative/private mode
        console.log(`Host chat mode is set to: ${message.isCollaborativeMode ? 'Collaborative' : 'Private'}`);
        // If we're a joiner, update our local mode setting to match the host
        if (!isSessionHost) {
          isCollaborativeMode = message.isCollaborativeMode;
          // Update the UI to reflect the host's setting
          chatModeSelect.value = isCollaborativeMode ? 'collaborative' : 'private';
          // Ensure the dropdown remains disabled for peers
          chatModeSelect.disabled = true;
          
          addToChatHistory({
            type: 'system',
            content: `Chat mode set to ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'}.`
          });
        }
        break;
        
      case 'models_update':
        // Received models list from the host
        console.log(`[PEER] Received ${message.models ? message.models.length : 0} models from host:`, 
          message.models ? message.models.map(m => m.name).join(', ') : 'No models');
        
        if (!isSessionHost && message.models && Array.isArray(message.models)) {
          // Update our models dropdown with the host's models
          updateModelSelect(message.models);
          
          // Store the flag that we're using host models to avoid local fetching
          window.usingHostModels = true;
          
          // Remove refresh indication if it was from a refresh button click
          refreshModelsButton.classList.remove('refreshing');
          refreshModelsButton.disabled = false;
          
          // Update timestamp on refresh button
          refreshModelsButton.setAttribute('title', `Last refreshed from host: ${new Date().toLocaleTimeString()}`);
          
          addToChatHistory({
            type: 'system',
            content: `Received ${message.models.length} models from host. Using host's models.`
          });
        }
        break;
        
      case 'query':
        // Handle LLM query from a peer
        console.log(`Received query from peer with ID: ${peerId.slice(0, 8)}...`, message);
        
        // Track this request ID for the peer
        if (message.requestId) {
          activeRequests.set(message.requestId, {
            timestamp: Date.now(),
            prompt: message.prompt,
            model: message.model,
            fromPeer: peerId,
            peerName: activePeers.has(peerId) ? activePeers.get(peerId).displayName : `Peer${peerId.slice(0, 6)}`
          });
          console.log(`Added peer request to tracking: ${message.requestId}`);
          console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
        }
        
        handlePeerQuery(conn, message);
        
        // Only add peer's query to our chat history if we're in collaborative mode
        if (isCollaborativeMode) {
          addToChatHistory({
            type: 'user',
            content: message.prompt,
            fromPeer: activePeers.has(peerId) ? activePeers.get(peerId).displayName : `Peer${peerId.slice(0, 6)}`,
            peerId: peerId,
            requestId: message.requestId
          });
        }
        break;
        
      case 'model_request':
        // Peer is requesting our models
        console.log('Peer requested models');
        
        // Only respond if we're the host
        if (isSessionHost) {
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
            
            console.log('Sent models to peer in response to request');
          }).catch(err => {
            console.error('Error fetching models for peer request:', err);
          });
        }
        break;
        
      case 'response':
        // Handle response messages from host or other peers
        console.log("Received response message:", message);
        console.log("Current activeRequestId:", activeRequestId);
        console.log("All active requests:", Array.from(activeRequests.keys()));
        
        // Check if this is one of our active requests
        const isActiveRequest = !message.requestId || 
          message.requestId === activeRequestId || 
          activeRequests.has(message.requestId);
        
        if (isActiveRequest) {
          console.log("Processing response for matching request ID:", message.requestId);
          let responseContent = '';
          if (message.isJson) {
            // Parse the JSON response if it's from Ollama
            responseContent = parseOllamaResponse(message.data);
          } else {
            responseContent = message.data;
          }
          
          console.log("Processed response content:", responseContent);
          
          // Make sure responseContent is a string
          if (responseContent && typeof responseContent !== 'string') {
            responseContent = JSON.stringify(responseContent);
          }
          
          // In private mode (message.isPrivate === true), the response should only be shown 
          // if it's for the current user's active request.
          // In collaborative mode (message.isPrivate === false), show all responses.
          const shouldShowResponse = responseContent && 
            responseContent.trim() && 
            (isCollaborativeMode || isActiveRequest);
            
          if (shouldShowResponse) {
            console.log("Adding response to chat history");
            // Add to existing assistant message or create new one
            const lastMessage = chatHistory[chatHistory.length - 1];
            if (lastMessage && lastMessage.type === 'assistant') {
              // Update existing message instead of creating a new one
              lastMessage.content = removeThinkingContent(lastMessage.content + responseContent);
              lastMessage.rawContent = (lastMessage.rawContent || lastMessage.content) + responseContent;
            } else {
              // Create a new assistant message
              addToChatHistory({
                type: 'assistant',
                content: removeThinkingContent(responseContent),
                rawContent: responseContent,
                requestId: message.requestId
              });
            }
            updateChatDisplay();
          } else {
            console.log("Skipping response display - conditions not met:", {
              hasContent: Boolean(responseContent && responseContent.trim()),
              isCollaborative: isCollaborativeMode,
              isActiveRequest: isActiveRequest
            });
          }
          
          // If this is the last message, clean up request tracking
          if (message.requestId) {
            console.log(`Removing requestId ${message.requestId} from active requests`);
            activeRequests.delete(message.requestId);
          }
          if (message.requestId === activeRequestId) {
            console.log(`Clearing activeRequestId: ${activeRequestId}`);
            activeRequestId = null;
          }
        } else {
          console.log("Ignoring response from untracked request. Current active:", activeRequestId, "Got:", message.requestId);
        }
        break;
        
      case 'peer_message':
        // Handle messages from peers (queries and responses)
        if (isCollaborativeMode) {
          // In collaborative mode, show all peer messages
          switch (message.messageType) {
            case 'user':
              // Add the peer's query to chat history
              addToChatHistory({
                type: 'user',
                content: message.content,
                fromPeer: message.fromPeer,
                peerId: peerId,
                requestId: message.requestId
              });
              break;
              
            case 'assistant':
              // Process assistant message from peer
              const lastMessage = chatHistory[chatHistory.length - 1];
              // Check if this should be a new message or continue an existing one
              const isNewMessage = message.isNewMessage === true;
              
              // Keep track of the current request ID we're handling
              const currentRequestId = message.requestId;
              console.log(`Processing assistant message for requestId: ${currentRequestId}, isNewMessage: ${isNewMessage}`);
              
              // Storage for tracking streamed content without being overly strict on duplicates
              if (!setupPeerMessageHandler.streamedContent) {
                setupPeerMessageHandler.streamedContent = new Map();
              }
              
              // Find the last message with the same requestId
              let matchingLastMessage = null;
              for (let i = chatHistory.length - 1; i >= 0; i--) {
                if (chatHistory[i].requestId === currentRequestId && chatHistory[i].type === 'assistant') {
                  matchingLastMessage = chatHistory[i];
                  break;
                }
              }
              
              // Process the message based on whether it's new or appending to existing
              if (isNewMessage) {
                // Create a brand new assistant message
                console.log(`Creating new assistant message from ${message.fromPeer} with requestId: ${currentRequestId}`);
                
                // Create a new message in the chat history
                const newAssistantMessage = {
                  type: 'assistant',
                  content: removeThinkingContent(message.content),
                  rawContent: message.content, // Store the raw content with thinking tags
                  timestamp: Date.now(),
                  fromPeer: message.fromPeer,
                  requestId: currentRequestId
                };
                
                // Add to chat history
                chatHistory.push(newAssistantMessage);
                // Update display
                updateChatDisplay();
              } else if (matchingLastMessage) {
                // We found an existing message to append to
                console.log(`Appending to existing assistant message for requestId: ${currentRequestId}`);
                
                // Get the current raw content and append the new content
                if (!matchingLastMessage.rawContent) {
                  matchingLastMessage.rawContent = matchingLastMessage.content;
                }
                
                // Add the new content to the raw content
                matchingLastMessage.rawContent += message.content;
                
                // Update the displayed content with thinking tags properly formatted
                matchingLastMessage.content = removeThinkingContent(matchingLastMessage.rawContent);
                
                // Update display
                updateChatDisplay();
              } else {
                // No matching message found, create a new one anyway
                console.log(`No matching message found for requestId: ${currentRequestId}, creating new`);
                
                const newAssistantMessage = {
                  type: 'assistant',
                  content: removeThinkingContent(message.content),
                  rawContent: message.content,
                  timestamp: Date.now(),
                  fromPeer: message.fromPeer,
                  requestId: currentRequestId
                };
                
                chatHistory.push(newAssistantMessage);
                updateChatDisplay();
              }
              break;
          }
        }
        // In private mode, we don't process or display peer messages from other peers
        break;
        
      default:
        console.warn('Unknown message type:', message.type);
    }
  };
}

// Handle a query from a peer
async function handlePeerQuery(conn, message) {
  try {
    // Get the peer ID from the connection or the message
    const peerId = message.fromPeerId || b4a.toString(conn.remotePublicKey, 'hex');
    
    // Get peer display name
    const peerName = activePeers.has(peerId) ? 
      activePeers.get(peerId).displayName : 
      `Peer${peerId.slice(0, 6)}`;
    
    // Store the active request ID to properly track this request
    const requestId = message.requestId;
    console.log(`Handling peer query with requestId: ${requestId} from peer: ${peerName}`);
    
    // In collaborative mode, show the thinking message and the query to the host
    // In private mode, only process the query but don't show it in the host's chat
    if (isCollaborativeMode) {
      addToChatHistory({
        type: 'thinking',
        content: `Received query from peer: ${message.prompt}\nThinking...`,
        requestId: requestId  // Add requestId to thinking message for tracking
      });
      
      // Also broadcast this peer's query to all other peers
      for (const peerConn of conns) {
        // Skip the original sender
        if (peerConn === conn) continue;
        
        peerConn.write(JSON.stringify({
          type: 'peer_message',
          messageType: 'user',
          content: message.prompt,
          fromPeer: peerName,
          requestId: requestId
        }));
      }
    }
    
    // Query the local LLM directly
    const result = await queryLocalLLM(message.model, message.prompt);
    console.log("Raw result from Ollama for peer query:", result);
    
    // Parse the result to get clean text
    const parsedResult = parseOllamaResponse(result);
    console.log("Parsed result for peer query:", parsedResult);
    
    // Add metadata to the response to indicate whether it should be shown only to the peer
    const isPrivate = !isCollaborativeMode;
    
    // In private mode, ensure the response goes only to the peer who sent the query
    if (isPrivate) {
      // Find the connection for this specific peer
      for (const peerConn of conns) {
        const connPeerId = b4a.toString(peerConn.remotePublicKey, 'hex');
        if (connPeerId === peerId) {
          // Send the response directly to the requesting peer
          peerConn.write(JSON.stringify({
            type: 'response',
            requestId: requestId,
            data: parsedResult,
            isComplete: true,
            isJson: false,
            isPrivate: true,
            fromPeerId: peerId
          }));
          break;
        }
      }
    } else {
      // In collaborative mode, we respond to the peer and also broadcast to all other peers
      console.log(`Sending response to peer with ID: ${peerId} for requestId: ${requestId}`);
      
      // First, respond to the peer who sent the query
      // Using the original connection to respond
      conn.write(JSON.stringify({
        type: 'response', // Use 'response' type for direct responses to queries
        requestId: requestId,
        data: parsedResult,
        isComplete: true,
        isJson: false,
        isPrivate: false,
        fromPeerId: peerId
      }));
      
      // Then, broadcast the response to all other peers
      for (const peerConn of conns) {
        // Skip the original sender
        if (peerConn === conn) continue;
        
        // Broadcast to other peers using our streamToPeers function
        // We pass true for isComplete since this is the full response
        streamToPeers(parsedResult, requestId, true, peerName);
      }
    }
    
    // Only add the response to our chat history if we're in collaborative mode
    if (isCollaborativeMode) {
      addToChatHistory({
        type: 'assistant',
        content: parsedResult,
        requestId: requestId,
        fromPeer: peerName
      });
    }
  } catch (error) {
    console.error('Error handling peer query:', error);
    conn.write(JSON.stringify({
      type: 'response',
      requestId: requestId,
      error: error.message,
      isComplete: true,
      isPrivate: !isCollaborativeMode,
      fromPeerId: message.fromPeerId || b4a.toString(conn.remotePublicKey, 'hex')
    }));
    
    // Only add the error message to our chat history if we're in collaborative mode
    if (isCollaborativeMode) {
      addToChatHistory({
        type: 'system',
        content: `Error responding to peer: ${error.message}`
      });
    }
  }
}

// Query the local LLM directly
async function queryLocalLLM(model, prompt) {
  try {
    const baseUrl = getOllamaBaseUrl();
    const url = new URL('/api/generate', baseUrl);
    
    console.log('Querying LLM at URL:', url.toString());
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false // No streaming for peer queries to simplify the implementation
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const text = await response.text();
    return text;
  } catch (error) {
    console.error('Error querying local LLM:', error);
    throw error;
  }
}

// Function to handle streaming responses to peers
function streamToPeers(content, requestId, isComplete = false, fromPeer = 'Host') {
  if (isCollaborativeMode && conns.length > 0) {
    // For streaming responses, we need to track whether this is the first chunk
    // Use static property to maintain state across function calls
    if (!streamToPeers.activeRequests) {
      streamToPeers.activeRequests = new Map();
    }
    
    // Check if this is the first chunk for this request
    const isFirstChunk = !streamToPeers.activeRequests.has(requestId);
    
    // If first chunk, mark this request as active
    if (isFirstChunk) {
      streamToPeers.activeRequests.set(requestId, true);
      console.log(`Starting stream to peers for requestId: ${requestId}`);
    }
    
    // If this is the final chunk, remove from active requests
    if (isComplete) {
      streamToPeers.activeRequests.delete(requestId);
      console.log(`Completing stream to peers for requestId: ${requestId}`);
    }
    
    // Send to all connected peers
    for (const conn of conns) {
      conn.write(JSON.stringify({
        type: 'peer_message',
        messageType: 'assistant',
        content: content,
        rawContent: content, // Send the original content with thinking tags intact
        fromPeer: fromPeer,
        requestId: requestId,
        isComplete: isComplete,
        isNewMessage: isFirstChunk
      }));
    }
  }
}

// Join button click event handler
joinButton.addEventListener('click', () => {
  const topicKeyHex = topicKeyInput.value.trim();
  if (topicKeyHex) {
    joinExistingChat(topicKeyHex);
    // Clear the input after joining
    topicKeyInput.value = '';
  } else {
    addToChatHistory({
      type: 'system',
      content: 'Please enter a valid topic key to join a chat session.'
    });
  }
});

// Add Enter key handler for topic key input
topicKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    joinButton.click();
  }
});

// Form submission handler
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  
  const formData = new FormData(form);
  const prompt = formData.get('prompt').trim();
  // Get the selected model from the selector
  const model = formData.get('model');
  currentModel = model; // Update the current model
  
  if (prompt.length === 0) {
    return;
  }
  
  // Clear the prompt area
  promptArea.value = '';
  
  const requestId = crypto.randomBytes(8).toString('hex');
  
  // Add user message to chat
  const userMessage = {
    type: 'user',
    content: prompt,
    requestId: requestId,
    fromPeer: isSessionHost ? 'Host' : 'You' // Explicitly mark host messages
  };
  
  addToChatHistory(userMessage);
  
  // If host is submitting, broadcast the user message to peers
  if (isSessionHost && isCollaborativeMode) {
    broadcastToPeers({
      type: 'peer_message',
      messageType: 'user',
      content: prompt,
      fromPeer: 'Host',
      requestId: requestId
    });
  }
  
  // Add thinking message
  addToChatHistory({
    type: 'thinking',
    content: 'Thinking...',
    requestId: requestId
  });
  
  try {
    if (isSessionHost) {
      // If we're the host, query our local Ollama
      const baseUrl = getOllamaBaseUrl();
      const url = new URL('/api/generate', baseUrl);
      
      console.log('Querying LLM at URL:', url.toString());
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: true
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const reader = response.body.getReader();
      let decoder = new TextDecoder();
      let responseText = '';
      
      // Remove the thinking message
      chatHistory.pop();
      
      // Create a temporary thinking message to show progress
      const thinkingMessage = {
        type: 'thinking',
        content: 'Generating response...',
        requestId: requestId
      };
      addToChatHistory(thinkingMessage);
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        console.log("Raw chunk from Ollama:", chunk);
        
        try {
          // For streaming responses, each chunk should be a JSON object
          const json = JSON.parse(chunk);
          
          // Extract just the response text from the JSON
          const responseChunk = json.response || '';
          console.log("Extracted response chunk:", responseChunk);
          
          // Add the response chunk to our full response text
          responseText += responseChunk;
          
          // Update the thinking message to show progress
          thinkingMessage.content = `Generating response... (${Math.round(responseText.length / 10)} tokens)`;
          updateChatDisplay();
          
          // Broadcast our own responses to connected peers in collaborative mode
          if (isCollaborativeMode) {
            streamToPeers(responseChunk, requestId);
          }
        } catch (parseError) {
          console.warn("Error parsing chunk as JSON:", parseError);
          // If not valid JSON, use the parseOllamaResponse as a fallback
          const fallbackResponse = parseOllamaResponse(chunk);
          if (fallbackResponse) {
            responseText += fallbackResponse;
            
            // Update the thinking message to show progress
            thinkingMessage.content = `Generating response... (${Math.round(responseText.length / 10)} tokens)`;
            updateChatDisplay();
            
            if (isCollaborativeMode) {
              streamToPeers(fallbackResponse, requestId);
            }
          }
        }
      }
      
      // Remove the thinking message
      chatHistory.pop();
      
      console.log("Creating final message with content:", responseText);
      console.log("Contains thinking tags:", responseText.includes("<think>"));
      
      const assistantMessage = {
        type: 'assistant',
        content: removeThinkingContent(responseText), // Process thinking content just like peer messages
        rawContent: responseText, // Store raw content with thinking tags
        requestId: requestId,
        fromPeer: 'Host', // Explicitly mark as from host for attribution
        isComplete: true
      };
      
      // Log the processed content
      console.log("Processed content:", assistantMessage.content);
      console.log("Contains thinking HTML:", assistantMessage.content.includes("thinking-content"));
      
      addToChatHistory(assistantMessage);
      updateChatDisplay();
      
      // Send the isComplete signal to peers
      if (isCollaborativeMode) {
        streamToPeers("", requestId, true);
      }
      
      // Store this requestId as our activeRequestId
      activeRequestId = requestId;
      // Add to our activeRequests tracking map
      activeRequests.set(requestId, {
        timestamp: Date.now(),
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${requestId}`);
      console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
      
      // Return the full response for any further processing
      return responseText;
    } else {
      // If we're not the host, we need to send the query to the host
      // Find the host connection (the first peer we connected to)
      const hostConn = conns[0];
      
      if (!hostConn) {
        throw new Error('Not connected to a host');
      }
      
      // Store the requestId as our activeRequestId so we can track responses
      activeRequestId = requestId;
      // Also store in our activeRequests map with timestamp
      activeRequests.set(requestId, {
        timestamp: Date.now(),
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${activeRequestId} for our peer query`);
      console.log(`Active requests: ${Array.from(activeRequests.keys()).join(', ')}`);
      
      // Send the query to the host
      hostConn.write(JSON.stringify({
        type: 'query',
        model,
        prompt,
        requestId,
        fromPeerId: b4a.toString(swarm.keyPair.publicKey, 'hex')
      }));
      
      // The response will come back asynchronously via the message handler
      console.log('Query sent to host, awaiting response');
      return null;
    }
  } catch (error) {
    console.error('Error in ask:', error);
    
    // Remove the thinking message
    chatHistory.pop();
    
    // Add error message
    addToChatHistory({
      type: 'system',
      content: `Error: ${error.message}`,
      requestId: requestId
    });
    
    return null;
  }
});

// Enable CTRL+Enter to submit and Enter to submit
promptArea.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    form.dispatchEvent(new Event('submit'));
  } else if (event.key === 'Enter' && !event.shiftKey) {
    // Allow Shift+Enter for new lines
    event.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
});

// Add event listener for chat mode toggle
chatModeSelect.addEventListener('change', function() {
  const newMode = this.value === 'collaborative';
  if (newMode !== isCollaborativeMode) {
    isCollaborativeMode = newMode;
    
    addToChatHistory({
      type: 'system',
      content: `Chat mode set to ${isCollaborativeMode ? 'Collaborative (shared chat)' : 'Private (separate chats)'}.`
    });
    
    // If we're the host, notify all connected peers about the mode change
    if (isSessionHost && conns.length > 0) {
      for (const conn of conns) {
        conn.write(JSON.stringify({
          type: 'mode_update',
          isCollaborativeMode: isCollaborativeMode
        }));
      }
    }
  }
}); 

// Function to fetch available models from Ollama
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
      
      // Clear existing options
      modelSelect.innerHTML = '';
      
      // Sort models alphabetically
      const sortedModels = data.models.sort((a, b) => a.name.localeCompare(b.name));
      
      // Add fetched models as options
      sortedModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = formatModelName(model.name);
        
        // Select current model if it matches
        if (model.name === currentModel) {
          option.selected = true;
        }
        
        modelSelect.appendChild(option);
      });
      
      // Update timestamp on refresh button
      refreshModelsButton.setAttribute('title', `Last refreshed: ${new Date().toLocaleTimeString()}`);
      
      console.log(`Loaded ${data.models.length} models from Ollama`);
      
      // Also return the models if requested
      if (returnModelsOnly) {
        return data.models;
      }
    } else {
      // If no models were returned, fall back to default models
      populateDefaultModels();
      console.log('No models returned from Ollama, using defaults');
      
      // Return default models if requested
      if (returnModelsOnly) {
        return DEFAULT_MODELS;
      }
    }
  } catch (error) {
    console.error('Error fetching models from Ollama:', error);
    // Fall back to default models on error
    populateDefaultModels();
    
    // Return default models if requested
    if (returnModelsOnly) {
      return DEFAULT_MODELS;
    }
    
    throw error;
  }
}

// Format model name for better display
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

// Populate the model select with default models
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
  refreshModelsButton.setAttribute('title', 'Failed to load models from Ollama. Using defaults.');
}

// Update the model select with new models
function updateModelSelect(models) {
  // Clear existing options
  modelSelect.innerHTML = '';
  
  // Sort models alphabetically
  const sortedModels = models.sort((a, b) => a.name.localeCompare(b.name));
  
  // Add fetched models as options
  sortedModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = formatModelName(model.name);
    
    // Select current model if it matches
    if (model.name === currentModel) {
      option.selected = true;
    }
    
    modelSelect.appendChild(option);
  });
}

// Add function to request models from the host
function requestModelsFromHost() {
  // Only proceed if we're connected to a host and not the host ourselves
  if (!isSessionHost && conns.length > 0) {
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

// Check if text appears to contain Markdown
function containsMarkdown(text) {
  // Look for common Markdown patterns
  const markdownPatterns = [
    /^#+\s+.+$/m,                   // Headers
    /\[.+\]\(.+\)/,                 // Links
    /\*\*.+\*\*/,                   // Bold
    /\*.+\*/,                       // Italic
    /^>\s+.+$/m,                    // Blockquotes
    /^-\s+.+$/m,                    // Unordered lists
    /^[0-9]+\.\s+.+$/m,             // Ordered lists
    /^```[\s\S]*?```$/m,            // Code blocks
    /`[^`\n]+`/,                    // Inline code
    /^---+$/m,                      // Horizontal rules
    /!\[.+\]\(.+\)/,                // Images
    /^(\|[^\|]+\|)+$/m,             // Tables
    /^[^\|]+\|[^\|]+$/m             // Simple tables
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

// Render Markdown into HTML safely
function renderMarkdown(text) {
  try {
    // Check if the text contains Markdown
    if (!containsMarkdown(text)) {
      return text.replace(/\n/g, '<br>');
    }
    
    // Handle fenced code blocks before rendering (to preserve them)
    const codeBlocks = [];
    
    // Replace code blocks with placeholders
    const textWithPlaceholders = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push(match);
      return placeholder;
    });
    
    // Render Markdown
    let rendered = marked.parse(textWithPlaceholders);
    
    // Replace placeholders with actual code blocks
    codeBlocks.forEach((block, index) => {
      const placeholder = `___CODE_BLOCK_${index}___`;
      rendered = rendered.replace(
        placeholder, 
        marked.parse(block)
      );
    });
    
    return rendered;
  } catch (error) {
    console.error('Error rendering Markdown:', error);
    return text.replace(/\n/g, '<br>');
  }
}