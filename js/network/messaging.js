/**
 * Network Messaging module
 * Contains functions for handling peer messages and communication
 */
import { addToChatHistory } from '../messages/history.js';
import { updateActivePeer, getPeerDisplayName, isPeerHost } from '../session/peers.js';
import { isSessionHost, getCollaborativeMode } from '../session/modes.js';
import { updateModelSelect, shareModelsWithPeer } from '../llm/models.js';
import { handlePeerQuery } from '../llm/provider.js';
import { conns, findHostConnection } from './hyperswarm.js';
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
        // Mode updates are no longer needed since we're always in private mode
        console.log('Ignoring mode update message - always in private mode');
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
        // Peer messages are no longer processed since we're always in private mode
        console.log('Ignoring peer message - always in private mode');
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
    // Import the UI functions to clear loading state
    import('../ui/elements.js').then(({ setRefreshModelsLoading, updateRefreshModelsTooltip }) => {
      // Clear the loading state for the refresh button
      setRefreshModelsLoading(false);
      updateRefreshModelsTooltip(`Last refreshed: ${new Date().toLocaleTimeString()}`);
    });
    
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
    console.log('Received query message but we are not the host, forwarding directly to host');

    // Find the host connection and forward the query
    const hostConn = findHostConnection();
    
    if (hostConn) {
      // Forward the query directly to the host
      hostConn.write(JSON.stringify({
        type: 'query',
        model: message.model,
        prompt: message.prompt,
        requestId: message.requestId,
        fromPeerId: message.fromPeerId
      }));
      
      console.log('Query forwarded directly to host');
    } else {
      console.warn('No host connection found to forward query');
    }
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
    console.log("Contains thinking tags:", responseContent && responseContent.includes("<think>"));
    
    // Make sure responseContent is a string
    if (responseContent && typeof responseContent !== 'string') {
      responseContent = JSON.stringify(responseContent);
    }
    
    // Ensure responseContent is always a string (empty string if undefined/null)
    if (!responseContent || typeof responseContent !== 'string') {
      responseContent = '';
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
        // Properly maintain rawContent and format content from the complete raw content
        lastMessage.rawContent = (lastMessage.rawContent || '') + responseContent;
        lastMessage.content = formatThinkingContent(lastMessage.rawContent);
        
        console.log("Updated existing message with thinking content:", {
          hasThinkingTags: lastMessage.rawContent.includes("<think>"),
          hasThinkingHTML: lastMessage.content.includes("thinking-content"),
          rawContentLength: lastMessage.rawContent.length,
          contentLength: lastMessage.content.length
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
        console.log(`Removing requestId ${message.requestId} from active requests - isComplete`);
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

// Export functions
export {
  setupPeerMessageHandler,
  broadcastToPeers,
  peerHandlers
};
