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

// Parse Ollama response chunk
function parseOllamaResponse(text) {
  try {
    // Print raw response to console for debugging
    console.log("Raw LLM response:", text);
    
    // Try to parse as JSON
    const lines = text.split('\n').filter(line => line.trim());
    
    let responseText = '';
    
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        console.log("Parsed JSON line:", json);
        
        if (json.response) {
          // Skip empty responses
          if (json.response.trim() === '') {
            continue;
          }
          
          // Add the response text as is, preserving think tags
          responseText += json.response;
        }
        
        // Handle completion
        if (json.done) {
          console.log('LLM response complete:', json.done_reason || 'unknown reason');
        }
      } catch (parseErr) {
        console.warn('Failed to parse JSON line:', line, parseErr);
        // If it's not valid JSON, just include the raw text
        responseText += line;
      }
    }
    
    console.log("Final parsed response text:", responseText);
    return responseText;
  } catch (err) {
    console.error('Error parsing Ollama response:', err);
    return text; // Return original text on error
  }
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
const chatHistory = [];

// To track active LLM responses and prevent duplicates
let activeRequestId = null;

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
  messageEl.className = 'message';
  
  switch (message.type) {
    case 'system':
      messageEl.className += ' message-system';
      messageEl.textContent = message.content;
      break;
      
    case 'user':
      messageEl.className += ' message-current-peer';
      
      if (message.fromPeer) {
        // This is a message from a peer
        messageEl.className = messageEl.className.replace('message-current-peer', 'message-peer');
        
        // Add the peer's color class if available
        if (message.peerId && activePeers.has(message.peerId)) {
          const peerInfo = activePeers.get(message.peerId);
          messageEl.className += ` ${peerInfo.colorClass}`;
        }
        
        // Add header with peer name
        const header = document.createElement('div');
        header.className = 'message-header';
        
        if (message.peerId && activePeers.has(message.peerId)) {
          header.textContent = activePeers.get(message.peerId).displayName;
        } else {
          header.textContent = message.fromPeer;
        }
        
        messageEl.appendChild(header);
      } else {
        // This is a message from the current user
        const header = document.createElement('div');
        header.className = 'message-header';
        header.textContent = 'You';
        messageEl.appendChild(header);
      }
      
      const content = document.createElement('div');
      content.textContent = message.content;
      messageEl.appendChild(content);
      break;
      
    case 'assistant':
      messageEl.className += ' message-assistant';
      
      // Add header for assistant
      const assistantHeader = document.createElement('div');
      assistantHeader.className = 'message-header';
      assistantHeader.textContent = 'DeepSeek';
      messageEl.appendChild(assistantHeader);
      
      // Extract thinking sections
      let formattedContent = message.content;
      
      // Replace think tags with formatted HTML
      formattedContent = formattedContent.replace(/<think>([\s\S]*?)<\/think>/g, function(match, thinkContent) {
        return `<div class="thinking-section"><div class="thinking-header">Thinking</div>${thinkContent}</div>`;
      });
      
      // Create content container
      const assistantContent = document.createElement('div');
      assistantContent.className = 'markdown-content';
      
      // Render Markdown content
      assistantContent.innerHTML = renderMarkdown(formattedContent);
      
      messageEl.appendChild(assistantContent);
      break;
      
    case 'thinking':
      messageEl.className += ' message-thinking';
      messageEl.textContent = message.content;
      break;
      
    default:
      messageEl.textContent = JSON.stringify(message);
  }
  
  return messageEl;
}

// Add message to chat history and update display
function addToChatHistory(message) {
  // Prevent duplicate assistant messages that have the same content
  if (message.type === 'assistant') {
    const lastMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
    if (lastMessage && lastMessage.type === 'assistant' && lastMessage.content === message.content) {
      console.log("Skipping duplicate assistant message");
      return;
    }
  }
  
  chatHistory.push(message);
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
  try {
    // Generate a unique request ID
    const requestId = Date.now().toString();
    activeRequestId = requestId;
    
    // Add user message to history
    addToChatHistory({
      type: 'user',
      content: prompt
    });
    
    // Check if we need to send the query to a specific peer (when joining)
    let targetPeerId = null;
    if (!isSessionHost && !isCollaborativeMode && conns.length > 0) {
      // In private mode, when we're a joiner, we need to track which peer we're sending to
      const conn = conns[0]; // Typically this would be the host
      targetPeerId = b4a.toString(conn.remotePublicKey, 'hex');
    }
    
    // In collaborative mode, broadcast the user's query to all peers
    // In private mode, the host won't broadcast
    if (isSessionHost && isCollaborativeMode) {
      broadcastToPeers({
        type: 'peer_message',
        messageType: 'user',
        content: prompt,
        fromPeer: 'Host',
        requestId
      });
    }
    
    // Add thinking message
    const thinkingIndex = chatHistory.length;
    addToChatHistory({
      type: 'thinking',
      content: 'Thinking...'
    });
    
    // If we're the host, use our local AI. If we're a joiner, send through P2P.
    if (isSessionHost) {
      // Host uses their own local AI
      chatHistory[thinkingIndex].content = 'Using local Ollama for LLM query...';
      updateChatDisplay();
      
      // Get the base URL for Ollama
      const baseUrl = getOllamaBaseUrl();
      const url = new URL('/api/generate', baseUrl);
      
      console.log('Querying local LLM at URL:', url.toString());
      
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
      
      // Remove the thinking message
      chatHistory.pop();
      
      // Create a new assistant message that we'll update
      let assistantMessage = {
        type: 'assistant',
        content: '',
        requestId // Add the request ID to the message for tracking
      };
      chatHistory.push(assistantMessage);
      
      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completeResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        console.log("Raw chunk:", chunk);
        buffer += chunk;
        
        // Process buffer to extract complete JSON objects
        let lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last potentially incomplete line in the buffer
        
        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const json = JSON.parse(line);
            if (json.response) {
              // Skip newlines at the beginning if the content is empty
              if (assistantMessage.content === '' && json.response.trim() === '') {
                continue;
              }
              
              // Add the response text as is, preserving think tags
              assistantMessage.content += json.response;
              completeResponse += json.response;
              
              // Only in collaborative mode, broadcast the response chunk to all peers
              if (isCollaborativeMode) {
                broadcastToPeers({
                  type: 'peer_message',
                  messageType: 'assistant',
                  content: json.response,
                  fromPeer: 'Host',
                  requestId,
                  isComplete: false
                });
              }
              
              updateChatDisplay();
            }
            
            if (json.done) {
              console.log("Response complete:", json.done_reason);
              // Reset active request ID when done
              if (activeRequestId === requestId) {
                activeRequestId = null;
              }
              
              // Only in collaborative mode, send completion message to peers
              if (isCollaborativeMode) {
                broadcastToPeers({
                  type: 'peer_message',
                  messageType: 'assistant',
                  content: '',
                  fromPeer: 'Host',
                  requestId,
                  isComplete: true
                });
              }
            }
          } catch (err) {
            console.warn("Error parsing JSON line:", line, err);
          }
        }
      }
      
      console.log("Complete response:", completeResponse);
      return completeResponse;
    } else {
      // We're a joiner - send the query through a peer
      // Check if we have connected peers
      if (conns.length === 0) {
        throw new Error("No peers connected. Cannot send query.");
      }
      
      // Choose a peer to send the query to (ideally the host)
      // For simplicity, we'll just use the first connected peer
      const peer = conns[0];
      const peerId = b4a.toString(peer.remotePublicKey, 'hex');
      const peerName = activePeers.has(peerId) ? 
        activePeers.get(peerId).displayName : 
        `Peer${peerId.slice(0, 6)}`;
      
      // Update the thinking message
      chatHistory[thinkingIndex].content = `Sending query to ${peerName}...`;
      updateChatDisplay();
      
      // Send the query to the peer
      peer.write(JSON.stringify({
        type: 'query',
        requestId,
        model,
        prompt,
        fromPeerId: b4a.toString(publicKey, 'hex') // Add our own ID so the host knows who to respond to
      }));
      
      // Response will be handled by the connection's data event handler
      return;
    }
  } catch (error) {
    console.error('Error asking LLM:', error);
    
    // Reset active request ID on error
    activeRequestId = null;
    
    // Add error message to chat
    addToChatHistory({
      type: 'system',
      content: `Error: ${error.message}`
    });
    
    return null;
  }
}

// Update the message handler to handle peer messages
function setupPeerMessageHandler(conn, peerId) {
  return function handleMessage(data) {
    const message = JSON.parse(data.toString());
    console.log('Received message from peer:', message);
    
    switch (message.type) {
      case 'handshake':
        // When a peer says they're "You", we need to give them a proper peer number
        let displayName = message.displayName;
        if (displayName === 'You') {
          // Assign a peer number instead of showing "You"
          let peerNumber = activePeers.size + 1;
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
        
        addToChatHistory({
          type: 'system',
          content: `Peer ${peerId.slice(0, 8)}... identified as ${displayName || message.clientId.slice(0, 8)}...`
        });
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
        
      case 'query':
        // Handle LLM query from a peer
        handlePeerQuery(conn, message);
        
        // Only add peer's query to our chat history if we're in collaborative mode
        if (isCollaborativeMode) {
          addToChatHistory({
            type: 'user',
            content: message.prompt,
            fromPeer: activePeers.has(peerId) ? activePeers.get(peerId).displayName : `Peer${peerId.slice(0, 6)}`,
            peerId: peerId
          });
        }
        break;
        
      case 'response':
        // Only process if this is our active request or if no active request
        if (!message.requestId || message.requestId === activeRequestId) {
          let responseContent = '';
          if (message.isJson) {
            // Parse the JSON response if it's from Ollama
            responseContent = parseOllamaResponse(message.data);
          } else {
            responseContent = message.data;
          }
          
          // In private mode (message.isPrivate === true), the response should only be shown 
          // if it's for the current user's active request.
          // In collaborative mode (message.isPrivate === false), show all responses.
          if (responseContent.trim() && (isCollaborativeMode || message.requestId === activeRequestId)) {
            // Add to existing assistant message or create new one
            const lastMessage = chatHistory[chatHistory.length - 1];
            if (lastMessage && lastMessage.type === 'assistant' && !message.isComplete) {
              // Update existing message instead of creating a new one
              lastMessage.content += responseContent;
            } else if (lastMessage && lastMessage.type === 'thinking') {
              // Replace thinking message with assistant message
              chatHistory.pop();
              addToChatHistory({
                type: 'assistant',
                content: responseContent,
                requestId: message.requestId
              });
            } else if (!lastMessage || lastMessage.type !== 'assistant') {
              // Create new assistant message
              addToChatHistory({
                type: 'assistant',
                content: responseContent,
                requestId: message.requestId
              });
            }
            updateChatDisplay();
          }
          
          // If this is the last message, clear the active request ID
          if (message.isComplete) {
            activeRequestId = null;
          }
        } else {
          console.log("Ignoring response from different request:", message.requestId);
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
              // Handle assistant response from peer
              const lastMessage = chatHistory[chatHistory.length - 1];
              if (lastMessage && lastMessage.type === 'assistant' && !message.isComplete) {
                // Update existing message
                lastMessage.content += message.content;
              } else if (lastMessage && lastMessage.type === 'thinking') {
                // Replace thinking message with assistant message
                chatHistory.pop();
                addToChatHistory({
                  type: 'assistant',
                  content: message.content,
                  requestId: message.requestId
                });
              } else if (!lastMessage || lastMessage.type !== 'assistant') {
                // Create new assistant message
                addToChatHistory({
                  type: 'assistant',
                  content: message.content,
                  requestId: message.requestId
                });
              }
              updateChatDisplay();
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
    
    // In collaborative mode, show the thinking message and the query to the host
    // In private mode, only process the query but don't show it in the host's chat
    if (isCollaborativeMode) {
      addToChatHistory({
        type: 'thinking',
        content: `Received query from peer: ${message.prompt}\nThinking...`
      });
    }
    
    // Query the local Ollama
    const result = await queryLocalLLM(message.model, message.prompt);
    
    // Parse the result to get clean text
    const parsedResult = parseOllamaResponse(result);
    
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
            requestId: message.requestId,
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
      // In collaborative mode, we can just respond through the same connection
      conn.write(JSON.stringify({
        type: 'response',
        requestId: message.requestId,
        data: parsedResult,
        isComplete: true,
        isJson: false,
        isPrivate: false,
        fromPeerId: peerId
      }));
    }
    
    // Only add the response to our chat history if we're in collaborative mode
    if (isCollaborativeMode) {
      addToChatHistory({
        type: 'assistant',
        content: parsedResult
      });
    }
  } catch (error) {
    console.error('Error handling peer query:', error);
    conn.write(JSON.stringify({
      type: 'response',
      requestId: message.requestId,
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
  const model = formData.get('model');
  const prompt = formData.get('prompt');
  
  if (!prompt.trim()) return;
  
  // Clear prompt area
  promptArea.value = '';
  
  // Ask LLM
  await ask(model, prompt);
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