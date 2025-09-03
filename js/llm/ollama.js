/**
 * LLM Ollama module
 * Contains functions for interacting with the Ollama API
 */
import { getOllamaBaseUrl } from './models.js';
import { addToChatHistory, findLastMessageByRequestId } from '../messages/history.js';
import {
  generateRequestId,
  setActiveRequestId,
  addActiveRequest
} from '../messages/history.js';
import { parseOllamaResponse, formatThinkingContent } from '../messages/formatting.js';
import { isSessionHost, getCollaborativeMode } from '../session/modes.js';
import { broadcastToPeers } from '../network/messaging.js';
import { conns } from '../network/hyperswarm.js';
import { getPeerDisplayName } from '../session/peers.js';
import { updateChatDisplay } from '../ui/rendering.js';


/**
 * Ask the LLM a question
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string|null>} A promise that resolves to the response text or null
 */
async function ask(model, prompt) {
  const requestId = generateRequestId();

  // Add user message to chat
  const userMessage = {
    type: 'user',
    content: prompt,
    requestId: requestId,
    fromPeer: isSessionHost() ? 'Host' : 'You' // Explicitly mark host messages
  };

  addToChatHistory(userMessage);

  // If host is submitting, broadcast the user message to peers
  if (isSessionHost() && getCollaborativeMode()) {
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
    if (isSessionHost()) {
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
      // Find the last thinking message with this requestId and remove it
      const thinkingIndex = findThinkingMessageIndex(requestId);
      if (thinkingIndex !== -1) {
        removeThinkingMessage(thinkingIndex);
      }

      // Create an assistant message that we'll update incrementally
      const assistantMessage = {
        type: 'assistant',
        content: '',
        rawContent: '',
        requestId: requestId,
        fromPeer: 'Host', // Explicitly mark as from host for attribution
        isComplete: false
      };

      // Add the initial empty message to the chat history
      addToChatHistory(assistantMessage);

      let lastAssistantMessage = null;

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
          // console.log("Response chunk length:", responseChunk.length);
          // console.log("First 5 chars:", JSON.stringify(responseChunk.substring(0, 5)));
          // console.log("Last 5 chars:", JSON.stringify(responseChunk.substring(responseChunk.length - 5)));

          // Add the response chunk to our full response text
          responseText += responseChunk;

          // Update our assistant message with the new chunk
          assistantMessage.rawContent += responseChunk;
          assistantMessage.content = formatThinkingContent(assistantMessage.rawContent);

          // Find the last assistant message with this request ID
          lastAssistantMessage = findLastMessageByRequestId(requestId, 'assistant');

          if (lastAssistantMessage) {
            // Update the existing message
            lastAssistantMessage.rawContent = assistantMessage.rawContent;
            lastAssistantMessage.content = assistantMessage.content;
            updateChatDisplay(); // Trigger UI update
          }

          // In private mode, we don't broadcast responses to peers
        } catch (parseError) {
          console.warn("Error parsing chunk as JSON:", parseError);
          // If not valid JSON, use the parseOllamaResponse as a fallback
          const fallbackResponse = parseOllamaResponse(chunk);
          if (fallbackResponse) {
            responseText += fallbackResponse;

            // Update our assistant message with the new chunk
            assistantMessage.rawContent += fallbackResponse;
            assistantMessage.content = formatThinkingContent(assistantMessage.rawContent);

            // Find the last assistant message with this request ID
            lastAssistantMessage = findLastMessageByRequestId(requestId, 'assistant');

            if (lastAssistantMessage) {
              // Update the existing message
              lastAssistantMessage.rawContent = assistantMessage.rawContent;
              lastAssistantMessage.content = assistantMessage.content;
              updateChatDisplay(); // Trigger UI update
            }

            // In private mode, we don't broadcast responses to peers
          }
        }
      }

      // Mark the message as complete
      assistantMessage.isComplete = true;

      // Log the final state
      console.log("Final message content:", assistantMessage.rawContent);
      console.log("Contains thinking tags:", assistantMessage.rawContent.includes("<think>"));
      console.log("Processed content:", assistantMessage.content);
      console.log("Contains thinking HTML:", assistantMessage.content.includes("thinking-content"));

      // Find the last assistant message with this request ID
      lastAssistantMessage = findLastMessageByRequestId(requestId, 'assistant');

      if (lastAssistantMessage) {
        // Update the existing message one last time to ensure final state is rendered
        lastAssistantMessage.isComplete = true;
        updateChatDisplay(); // Trigger UI update
      }

      // In private mode, we don't send completion signals to peers

      // Store this requestId as our activeRequestId
      setActiveRequestId(requestId);
      // Add to our activeRequests tracking map
      addActiveRequest(requestId, {
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${requestId}`);

      // Return the full response for any further processing
      return responseText;
    } else {
      // If we're not the host, we will select random subset of peers to send message to for gossip protocol.
      // Function to calculate k based on the total number of peers

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

      // const hostConn = conns[0];

      // if (!hostConn) {
      //   throw new Error('Not connected to a host');
      // }

      // Store the requestId as our activeRequestId so we can track responses
      setActiveRequestId(requestId);
      // Also store in our activeRequests map with timestamp
      addActiveRequest(requestId, {
        prompt: prompt,
        model: model,
        fromPeer: 'You'
      });
      console.log(`Setting activeRequestId to: ${requestId} for our peer query`);

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
      return null;
    }
  } catch (error) {
    console.error('Error in ask:', error);

    // Remove the thinking message
    // Find the last thinking message with this requestId and remove it
    const thinkingIndex = findThinkingMessageIndex(requestId);
    if (thinkingIndex !== -1) {
      removeThinkingMessage(thinkingIndex);
    }

    // Add error message
    addToChatHistory({
      type: 'system',
      content: `Error: ${error.message}`,
      requestId: requestId
    });

    return null;
  }
}

/**
 * Find the index of a thinking message with a specific request ID
 * @param {string} requestId - The request ID to search for
 * @returns {number} The index of the thinking message or -1 if not found
 */
// Remove
function findThinkingMessageIndex(requestId) {
  // This is a simplified version - in a real implementation, we would get this from the history module
  return -1;
}

/**
 * Remove a thinking message at a specific index
 * @param {number} index - The index of the thinking message to remove
 */
//REmove
function removeThinkingMessage(index) {
  // This is a simplified version - in a real implementation, we would get this from the history module
}

/**
 * Update a thinking message
 * @param {Object} message - The thinking message to update
 */
// Remove
function updateThinkingMessage(message) {
  // This is a simplified version - in a real implementation, we would get this from the history module
}

/**
 * Handle a query from a peer
 * @param {Object} conn - The connection object
 * @param {Object} message - The query message
 * @param {string} peerId - The ID of the peer
 */
async function handlePeerQuery(conn, message, peerId) {
  try {
    // Get the peer display name
    const peerName = getPeerDisplayName(peerId);

    // Store the active request ID to properly track this request
    const requestId = message.requestId;
    console.log(`Handling peer query with requestId: ${requestId} from peer: ${peerName}`);

    // In collaborative mode, show the thinking message and the query to the host
    // In private mode, only process the query but don't show it in the host's chat
    if (getCollaborativeMode()) {
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

    // Stream the response directly to the peer as it comes from Ollama
    const fullResponse = await streamResponseToPeer(conn, message.model, message.prompt, requestId, peerId);

    // Only add the response to our chat history if we're in collaborative mode
    if (getCollaborativeMode() && fullResponse) {
      addToChatHistory({
        type: 'assistant',
        content: formatThinkingContent(fullResponse), // Process thinking content
        rawContent: fullResponse, // Store raw content with thinking tags
        requestId: requestId,
        fromPeer: peerName
      });

      console.log("Added response to host's chat history with thinking content:", {
        hasThinkingTags: fullResponse.includes("<think>"),
        hasThinkingHTML: formatThinkingContent(fullResponse).includes("thinking-content")
      });
    }
  } catch (error) {
    console.error('Error handling peer query:', error);
    conn.write(JSON.stringify({
      type: 'response',
      requestId: message.requestId,
      error: error.message,
      isComplete: true,
      isPrivate: !getCollaborativeMode(),
      fromPeerId: message.fromPeerId || peerId
    }));

    // Only add the error message to our chat history if we're in collaborative mode
    if (getCollaborativeMode()) {
      addToChatHistory({
        type: 'system',
        content: `Error responding to peer: ${error.message}`
      });
    }
  }
}

/**
 * Stream response to a peer in real-time, just like the host does locally
 * @param {Object} conn - The connection object
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @param {string} requestId - The request ID
 * @param {string} peerId - The ID of the peer
 * @returns {Promise<string>} A promise that resolves to the complete response text
 */
async function streamResponseToPeer(conn, model, prompt, requestId, peerId) {
  try {
    const baseUrl = getOllamaBaseUrl();
    const url = new URL('/api/generate', baseUrl);

    console.log('Streaming response to peer - querying LLM at URL:', url.toString());

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true // Use streaming to get real-time chunks
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    let decoder = new TextDecoder();
    let fullResponseText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      console.log("Raw chunk from Ollama for peer streaming:", chunk);

      try {
        // For streaming responses, each chunk should be a JSON object
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);

            // Extract just the response text from the JSON
            const responseChunk = json.response || '';
            console.log("Extracted response chunk for peer streaming:", responseChunk);

            if (responseChunk) {
              // Add the response chunk to our full response text
              fullResponseText += responseChunk;

              // Send this chunk immediately to the peer for real-time streaming
              const isPrivate = !getCollaborativeMode();
              
              // Find the connection for this specific peer and send the chunk
              for (const peerConn of conns) {
                const connPeerId = peerConn.remotePublicKey.toString('hex');
                if (connPeerId === peerId) {
                  peerConn.write(JSON.stringify({
                    type: 'response',
                    requestId: requestId,
                    data: responseChunk,
                    isComplete: false, // Not complete yet, more chunks coming
                    isJson: false,
                    isPrivate: isPrivate,
                    fromPeerId: peerId
                  }));
                  console.log("Sent streaming chunk to peer:", JSON.stringify(responseChunk));
                  break;
                }
              }
            }
          } catch (innerErr) {
            // If a line can't be parsed as JSON, ignore it
            console.log("Couldn't parse line as JSON:", line);
          }
        }
      } catch (parseError) {
        console.warn("Error parsing chunk as JSON:", parseError);
        // If not valid JSON, use the parseOllamaResponse as a fallback
        const fallbackResponse = parseOllamaResponse(chunk);
        if (fallbackResponse) {
          fullResponseText += fallbackResponse;

          // Send fallback response chunk to peer
          const isPrivate = !getCollaborativeMode();
          
          for (const peerConn of conns) {
            const connPeerId = peerConn.remotePublicKey.toString('hex');
            if (connPeerId === peerId) {
              peerConn.write(JSON.stringify({
                type: 'response',
                requestId: requestId,
                data: fallbackResponse,
                isComplete: false,
                isJson: false,
                isPrivate: isPrivate,
                fromPeerId: peerId
              }));
              console.log("Sent fallback streaming chunk to peer:", JSON.stringify(fallbackResponse));
              break;
            }
          }
        }
      }
    }

    // Send completion message to peer
    const isPrivate = !getCollaborativeMode();
    
    for (const peerConn of conns) {
      const connPeerId = peerConn.remotePublicKey.toString('hex');
      if (connPeerId === peerId) {
        peerConn.write(JSON.stringify({
          type: 'response',
          requestId: requestId,
          data: '', // Empty data for completion signal
          isComplete: true, // Mark as complete
          isJson: false,
          isPrivate: isPrivate,
          fromPeerId: peerId
        }));
        console.log("Sent completion signal to peer for requestId:", requestId);
        break;
      }
    }

    console.log("Complete streamed response text for peer:", fullResponseText);
    return fullResponseText;
  } catch (error) {
    console.error('Error streaming response to peer:', error);
    
    // Send error message to peer
    const isPrivate = !getCollaborativeMode();
    
    for (const peerConn of conns) {
      const connPeerId = peerConn.remotePublicKey.toString('hex');
      if (connPeerId === peerId) {
        peerConn.write(JSON.stringify({
          type: 'response',
          requestId: requestId,
          error: error.message,
          isComplete: true,
          isPrivate: isPrivate,
          fromPeerId: peerId
        }));
        break;
      }
    }
    
    throw error;
  }
}

/**
 * Query the local LLM directly
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} A promise that resolves to the response text
 */
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
        stream: true // Use streaming to properly capture thinking content
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    let decoder = new TextDecoder();
    let responseText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      console.log("Raw chunk from Ollama for peer query:", chunk);

      try {
        // For streaming responses, each chunk should be a JSON object
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);

            // Extract just the response text from the JSON
            const responseChunk = json.response || '';
            console.log("Extracted response chunk for peer query:", responseChunk);

            // Add the response chunk to our full response text
            responseText += responseChunk;
          } catch (innerErr) {
            // If a line can't be parsed as JSON, ignore it
            console.log("Couldn't parse line as JSON:", line);
          }
        }
      } catch (parseError) {
        console.warn("Error parsing chunk as JSON:", parseError);
        // If not valid JSON, use the parseOllamaResponse as a fallback
        const fallbackResponse = parseOllamaResponse(chunk);
        if (fallbackResponse) {
          responseText += fallbackResponse;
        }
      }
    }

    console.log("Complete response text for peer query:", responseText);
    const formattedResponseText = formatThinkingContent(responseText);
    console.log("Contains thinking tags:", formattedResponseText.includes("<think>"));

    return responseText;
  } catch (error) {
    console.error('Error querying local LLM:', error);
    throw error;
  }
}

// Export functions
export {
  ask,
  handlePeerQuery,
  queryLocalLLM,
  streamResponseToPeer
};
