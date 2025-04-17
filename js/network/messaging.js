/**
 * Network Messaging module
 * Contains functions for handling peer messages and communication
 */
import { addToChatHistory } from '../messages/history.js';
import { updateActivePeer, getPeerDisplayName, isPeerHost } from '../session/peers.js';
import { handleModeUpdateMessage } from '../session/modes.js';
import { isSessionHost, getCollaborativeMode } from '../session/modes.js';
import { updateModelSelect, shareModelsWithPeer } from '../llm/models.js';
import { handlePeerQuery } from '../llm/ollama.js';
import { conns } from './hyperswarm.js';
import { 
  isActiveRequest, 
  findLastMessageByRequestId, 
  removeActiveRequest, 
  getActiveRequestId, 
  clearActiveRequestId 
} from '../messages/history.js';
import { parseOllamaResponse, formatThinkingContent } from '../messages/formatting.js';
import { updateChatDisplay } from '../ui/rendering.js';

// Keep track of peer message handlers
const peerHandlers = new Map();

// Keep track of active streaming requests
const activeStreamingRequests = new Map();

/**
 * Set up a message handler for a peer connection
 * @param {Object} conn - The connection object
 * @param {string} peerId - The ID of the peer
 * @returns {Function} The message handler function
 */
function setupPeerMessageHandler(conn, peerId) {
  // Create a handler function for this peer
  const handler = function(data) {
    const message = JSON.parse(data.toString());
    console.log(`[PEER] Message from ${peerId.slice(0, 8)}... - Type: ${message.type}`, message);
    
    switch (message.type) {
      case 'handshake':
        handleHandshakeMessage(conn, message, peerId);
        break;
        
      case 'handshake_ack':
        handleHandshakeAckMessage(message, peerId);
        break;
        
      case 'mode_update':
        handleModeUpdateMessage(message, peerId, isPeerHost(peerId, conns));
        break;
        
      case 'models_update':
        handleModelsUpdateMessage(message);
        break;
        
      case 'query':
        handleQueryMessage(conn, message, peerId);
        break;
        
      case 'model_request':
        handleModelRequestMessage(conn);
        break;
        
      case 'response':
        handleResponseMessage(message);
        break;
        
      case 'peer_message':
        handlePeerMessage(message, peerId);
        break;
        
      default:
        console.warn('Unknown message type:', message.type);
    }
  };
  
  // Store the handler in the map
  peerHandlers.set(peerId, handler);
  
  return handler;
}

/**
 * Handle a handshake message from a peer
 * @param {Object} conn - The connection object
 * @param {Object} message - The handshake message
 * @param {string} peerId - The ID of the peer
 */
function handleHandshakeMessage(conn, message, peerId) {
  // When a peer says they're "You", we need to give them a proper peer number
  let displayName = message.displayName;
  if (displayName === 'You') {
    // Assign a peer number instead of showing "You"
    displayName = `Peer${peerId.slice(0, 6)}`;
  }
  
  console.log(`Processing handshake from peer ${peerId.slice(0, 8)}...`, {
    displayName,
    clientId: message.clientId,
    isHost: message.isHost || false
  });
  
  // Update peer information with their details and explicit host status
  updateActivePeer(peerId, {
    displayName: displayName || `Peer${peerId.slice(0, 6)}`,
    clientId: message.clientId,
    metadata: message.metadata,
    isHost: message.isHost || false  // Add explicit host flag
  });
  
  // Share our current mode with the peer
  console.log(`Sending mode update during handshake: ${getCollaborativeMode() ? 'Collaborative' : 'Private'}`);
  conn.write(JSON.stringify({
    type: 'mode_update',
    isCollaborativeMode: getCollaborativeMode(),
    isHost: isSessionHost()  // Include our host status in the message
  }));

  // If we're the host, share our models with the peer
  if (isSessionHost()) {
    shareModelsWithPeer(conn);
  }
  
  addToChatHistory({
    type: 'system',
    content: `Peer ${peerId.slice(0, 8)}... identified as ${displayName || message.clientId.slice(0, 8)}...`
  });
}

/**
 * Handle a handshake acknowledgement message from a peer
 * @param {Object} message - The handshake ack message
 * @param {string} peerId - The ID of the peer
 */
function handleHandshakeAckMessage(message, peerId) {
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
}

/**
 * Handle a models update message from a peer
 * @param {Object} message - The models update message
 */
function handleModelsUpdateMessage(message) {
  console.log(`[PEER] Received ${message.models ? message.models.length : 0} models from host:`, 
    message.models ? message.models.map(m => m.name).join(', ') : 'No models');
  
  if (!isSessionHost() && message.models && Array.isArray(message.models)) {
    // Update our models dropdown with the host's models
    updateModelSelect(message.models);
    
    // Store the flag that we're using host models to avoid local fetching
    window.usingHostModels = true;
    
    addToChatHistory({
      type: 'system',
      content: `Received ${message.models.length} models from host. Using host's models.`
    });
  }
}

/**
 * Handle a query message from a peer
 * @param {Object} conn - The connection object
 * @param {Object} message - The query message
 * @param {string} peerId - The ID of the peer
 */
function handleQueryMessage(conn, message, peerId) {
  // Handle LLM query from a peer
  console.log(`Received query from peer with ID: ${peerId.slice(0, 8)}...`, message);
  
  // Only process if we're the host
  if (isSessionHost()) {
    handlePeerQuery(conn, message, peerId);
    
    // Only add peer's query to our chat history if we're in collaborative mode
    if (getCollaborativeMode()) {
      const peerName = getPeerDisplayName(peerId);
      addToChatHistory({
        type: 'user',
        content: message.prompt,
        fromPeer: peerName,
        peerId: peerId,
        requestId: message.requestId
      });
    }
  } else {
    console.log('Received query message but we are not the host, sending to random peers for propogation');

    function calculateK(n) {
      if (n <= 1) return n; // Handle edge cases: 0 or 1 peer
      return Math.max(1, Math.min(n, Math.ceil(Math.log(n + 1) / Math.log(2)))); // Log base 2
    }

    const n = conns.length; // Total number of peers
    const k = calculateK(n); // Dynamically calculate k

    // Shuffle the array and select the first k peers
    const shuffled = conns.slice().sort(() => 0.5 - Math.random());
    const randomConns = shuffled.slice(0, k);

    // Log the result for demonstration
    console.log(`Total peers: ${n}`);
    console.log(`Selected k: ${k}`);
    console.log(`Peers to propagate to: ${randomConns}`);

    // Send the query to the random selected conns
    for (const conn of randomConns) {
      conn.write(JSON.stringify({
        type: 'query',
        model,
        prompt,
        requestId,
        fromPeerId: conn.remotePublicKey.toString('hex')
      }));
    }
    
    // The response will come back asynchronously via the message handler
    console.log('Query sent to random conns, awaiting eventual response from the host');
  }
}

/**
 * Handle a model request message from a peer
 * @param {Object} conn - The connection object
 */
function handleModelRequestMessage(conn) {
  // Peer is requesting our models
  console.log('Peer requested models');
  
  // Only respond if we're the host
  if (isSessionHost()) {
    shareModelsWithPeer(conn);
  }
}

/**
 * Handle a response message from a peer
 * @param {Object} message - The response message
 */
function handleResponseMessage(message) {
  // Handle response messages from host or other peers
  console.log("Received response message:", message);
  console.log("Current activeRequestId:", getActiveRequestId());
  
  // Check if this is one of our active requests
  const isActiveReq = isActiveRequest(message.requestId);
  
  if (isActiveReq) {
    console.log("Processing response for matching request ID:", message.requestId);
    let responseContent = '';
    if (message.isJson) {
      // Parse the JSON response if it's from Ollama
      responseContent = parseOllamaResponse(message.data);
    } else {
      responseContent = message.data;
    }
    
    console.log("Processed response content:", responseContent);
    console.log("Contains thinking tags:", responseContent.includes("<think>"));
    
    // Make sure responseContent is a string
    if (responseContent && typeof responseContent !== 'string') {
      responseContent = JSON.stringify(responseContent);
    }
    
    // In private mode (message.isPrivate === true), the response should only be shown 
    // if it's for the current user's active request.
    // In collaborative mode (message.isPrivate === false), show all responses.
    const shouldShowResponse = responseContent && 
      responseContent.trim() && 
      (getCollaborativeMode() || isActiveReq);
      
    if (shouldShowResponse) {
      console.log("Adding response to chat history");
      console.log("Response contains thinking tags:", responseContent.includes("<think>"));
      
      // Add to existing assistant message or create new one
      const lastMessage = findLastMessageByRequestId(message.requestId, 'assistant');
      if (lastMessage) {
        // Update existing message instead of creating a new one
        lastMessage.content = formatThinkingContent(lastMessage.content + responseContent);
        lastMessage.rawContent = (lastMessage.rawContent || lastMessage.content) + responseContent;
        
        console.log("Updated existing message with thinking content:", {
          hasThinkingTags: lastMessage.rawContent.includes("<think>"),
          hasThinkingHTML: lastMessage.content.includes("thinking-content")
        });
        
        // Update display without re-adding to history
        updateChatDisplay();
      } else {
        // Create a new assistant message
        const formattedContent = formatThinkingContent(responseContent);
        console.log("Formatted content for new message:", {
          hasThinkingTags: responseContent.includes("<think>"),
          hasThinkingHTML: formattedContent.includes("thinking-content")
        });
        
        addToChatHistory({
          type: 'assistant',
          content: formattedContent,
          rawContent: responseContent,
          requestId: message.requestId
        });
      }
    } else {
      console.log("Skipping response display - conditions not met:", {
        hasContent: Boolean(responseContent && responseContent.trim()),
        isCollaborative: getCollaborativeMode(),
        isActiveRequest: isActiveReq
      });
    }
    
    // If this is the last message, clean up request tracking
    if (message.isComplete) {
      if (message.requestId) {
        console.log(`Removing requestId ${message.requestId} from active requests`);
        removeActiveRequest(message.requestId);
      }
      if (message.requestId === getActiveRequestId()) {
        clearActiveRequestId();
      }
    }
  } else {
    console.log("Ignoring response from untracked request. Current active:", getActiveRequestId(), "Got:", message.requestId);
  }
}

/**
 * Handle a peer message
 * @param {Object} message - The peer message
 * @param {string} peerId - The ID of the peer
 */
function handlePeerMessage(message, peerId) {
  // Handle messages from peers (queries and responses)
  if (getCollaborativeMode()) {
    // In collaborative mode, show all peer messages
    switch (message.messageType) {
      case 'user':
        // Add the peer's query to chat history
        const peerName = getPeerDisplayName(peerId);
        addToChatHistory({
          type: 'user',
          content: message.content,
          fromPeer: message.fromPeer || peerName,
          peerId: peerId,
          requestId: message.requestId
        });
        break;
        
      case 'assistant':
        handlePeerAssistantMessage(message, peerId);
        break;
    }
  }
  // In private mode, we don't process or display peer messages from other peers
}

/**
 * Handle an assistant message from a peer
 * @param {Object} message - The assistant message
 * @param {string} peerId - The ID of the peer
 */
function handlePeerAssistantMessage(message, peerId) {
  // Process assistant message from peer
  const isNewMessage = message.isNewMessage === true;
  
  // Keep track of the current request ID we're handling
  const currentRequestId = message.requestId;
  console.log(`Processing assistant message for requestId: ${currentRequestId}, isNewMessage: ${isNewMessage}`);
  console.log(`Peer message contains thinking tags:`, message.content.includes("<think>"));
  
  // Use rawContent if available, otherwise fall back to content
  const messageContent = message.rawContent || message.content;
  
  // Find the last message with the same requestId
  const matchingLastMessage = findLastMessageByRequestId(currentRequestId, 'assistant');
  
  // Process the message based on whether it's new or appending to existing
  if (isNewMessage) {
    // Create a brand new assistant message
    console.log(`Creating new assistant message from ${message.fromPeer} with requestId: ${currentRequestId}`);
    
    // Format the content for display
    const formattedContent = formatThinkingContent(messageContent);
    console.log(`New peer message thinking content:`, {
      hasThinkingTags: messageContent.includes("<think>"),
      hasThinkingHTML: formattedContent.includes("thinking-content")
    });
    
    // Create a new message in the chat history
    const newAssistantMessage = {
      type: 'assistant',
      content: formattedContent,
      rawContent: messageContent, // Store the raw content with thinking tags
      timestamp: Date.now(),
      fromPeer: message.fromPeer,
      requestId: currentRequestId
    };
    
    // Add to chat history
    addToChatHistory(newAssistantMessage);
  } else if (matchingLastMessage) {
    // We found an existing message to append to
    console.log(`Appending to existing assistant message for requestId: ${currentRequestId}`);
    
    // Get the current raw content and append the new content
    if (!matchingLastMessage.rawContent) {
      matchingLastMessage.rawContent = matchingLastMessage.content;
    }
    
    // Add the new content to the raw content
    matchingLastMessage.rawContent += messageContent;
    
    // Update the displayed content with thinking tags properly formatted
    matchingLastMessage.content = formatThinkingContent(matchingLastMessage.rawContent);
    
    console.log(`Updated peer message thinking content:`, {
      hasThinkingTags: matchingLastMessage.rawContent.includes("<think>"),
      hasThinkingHTML: matchingLastMessage.content.includes("thinking-content")
    });
    
    // Update the existing message in place without re-adding to history
    updateChatDisplay();
  } else {
    // No matching message found, create a new one anyway
    console.log(`No matching message found for requestId: ${currentRequestId}, creating new`);
    
    // Format the content for display
    const formattedContent = formatThinkingContent(messageContent);
    
    const newAssistantMessage = {
      type: 'assistant',
      content: formattedContent,
      rawContent: messageContent,
      timestamp: Date.now(),
      fromPeer: message.fromPeer,
      requestId: currentRequestId
    };
    
    addToChatHistory(newAssistantMessage);
  }
}

/**
 * Broadcast a message to all peers
 * @param {Object} message - The message to broadcast
 * @param {string} targetPeerId - Optional target peer ID (for private messages)
 * @param {string} excludePeerId - Optional peer ID to exclude from broadcast
 * @param {boolean} forceAll - Force broadcast to all peers regardless of mode
 * @returns {number} The number of peers the message was sent to
 */
function broadcastToPeers(message, targetPeerId = null, excludePeerId = null, forceAll = false) {
  if (conns.length === 0) {
    return 0;
  }
  
  let sentCount = 0;
  
  // If this is a mode update message, add the host status
  if (message.type === 'mode_update') {
    message.isHost = isSessionHost();
    console.log(`Broadcasting mode update with host status: ${message.isHost}, forceAll: ${forceAll}`);
  }
  
  // Determine if we should broadcast to all peers
  // Either we're in collaborative mode, or forceAll is true (for mode updates)
  const broadcastToAll = getCollaborativeMode() || forceAll;
  
  if (broadcastToAll) {
    // Broadcast to all connected peers
    for (const conn of conns) {
      const peerId = conn.remotePublicKey.toString('hex');
      
      // Skip excluded peer
      if (excludePeerId && peerId === excludePeerId) {
        continue;
      }
      
      console.log(`Sending message to peer ${peerId.slice(0, 8)}...`, message);
      conn.write(JSON.stringify(message));
      sentCount++;
    }
  } else if (targetPeerId) {
    // In private mode, only send to the specified peer
    for (const conn of conns) {
      const peerId = conn.remotePublicKey.toString('hex');
      if (peerId === targetPeerId) {
        console.log(`Sending message to specific peer ${peerId.slice(0, 8)}...`, message);
        conn.write(JSON.stringify(message));
        sentCount++;
        break;
      }
    }
  }
  
  return sentCount;
}

/**
 * Stream content to peers
 * @param {string} content - The content to stream
 * @param {string} requestId - The request ID
 * @param {boolean} isComplete - Whether this is the final chunk
 * @param {string} fromPeer - The peer the content is from
 */
function streamToPeers(content, requestId, isComplete = false, fromPeer = 'Host') {
  if (getCollaborativeMode() && conns.length > 0) {
    // Check if this is the first chunk for this request
    const isFirstChunk = !activeStreamingRequests.has(requestId);
    
    // If first chunk, mark this request as active
    if (isFirstChunk) {
      activeStreamingRequests.set(requestId, true);
      console.log(`Starting stream to peers for requestId: ${requestId}`);
    }
    
    // If this is the final chunk, remove from active requests
    if (isComplete) {
      activeStreamingRequests.delete(requestId);
      console.log(`Completing stream to peers for requestId: ${requestId}`);
    }
    
    // Create the message object
    const messageObj = {
      type: 'peer_message',
      messageType: 'assistant',
      content: content,
      rawContent: content, // Send the original content with thinking tags intact
      fromPeer: fromPeer,
      requestId: requestId,
      isComplete: isComplete,
      isNewMessage: isFirstChunk
    };

    // Send to all connected peers
    for (const conn of conns) {
      conn.write(JSON.stringify(messageObj));
    }
  }
}

// Export functions
export {
  setupPeerMessageHandler,
  broadcastToPeers,
  streamToPeers,
  peerHandlers
};
