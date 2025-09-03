/**
 * LLM LM Studio module
 * Contains functions for interacting with the LM Studio API
 */
import { getLMStudioBaseUrl } from './models.js';
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
 * Ask the LLM a question using LM Studio API
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
    fromPeer: isSessionHost() ? 'Host' : 'You'
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
      // If we're the host, query our local LM Studio
      const baseUrl = getLMStudioBaseUrl();
      const url = new URL('/api/v0/chat/completions', baseUrl);

      console.log('Querying LM Studio at URL:', url.toString());

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          stream: true,
          temperature: 0.7,
          max_tokens: -1
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body.getReader();
      let decoder = new TextDecoder();
      let responseText = '';

      // Remove the thinking message
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
        fromPeer: 'Host',
        isComplete: false
      };

      // Add the initial empty message to the chat history
      addToChatHistory(assistantMessage);

      let lastAssistantMessage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        console.log("Raw chunk from LM Studio:", chunk);

        // Handle Server-Sent Events format
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix
            
            if (data === '[DONE]') {
              console.log("LM Studio stream completed");
              break;
            }

            try {
              const json = JSON.parse(data);
              
              // Extract content from LM Studio's response format
              const delta = json.choices?.[0]?.delta;
              const responseChunk = delta?.content || '';
              
              if (responseChunk) {
                console.log("Extracted response chunk from LM Studio:", responseChunk);
                
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
              }
            } catch (parseError) {
              console.warn("Error parsing LM Studio chunk as JSON:", parseError);
            }
          }
        }
      }

      // Mark the message as complete
      assistantMessage.isComplete = true;

      // Log the final state
      console.log("Final LM Studio message content:", assistantMessage.rawContent);
      console.log("Contains thinking tags:", assistantMessage.rawContent.includes("<think>"));
      console.log("Processed content:", assistantMessage.content);

      // Find the last assistant message with this request ID
      lastAssistantMessage = findLastMessageByRequestId(requestId, 'assistant');

      if (lastAssistantMessage) {
        // Update the existing message one last time to ensure final state is rendered
        lastAssistantMessage.isComplete = true;
        updateChatDisplay(); // Trigger UI update
      }

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
      // If we're not the host, use gossip protocol to send to random peers
      function calculateK(n) {
        if (n <= 1) return n;
        return Math.max(1, Math.min(n, Math.ceil(Math.log(n + 1) / Math.log(2))));
      }

      const n = conns.length;
      const k = calculateK(n);

      // Shuffle the array and select the first k peers
      const shuffled = conns.slice().sort(() => 0.5 - Math.random());
      const randomConns = shuffled.slice(0, k);

      console.log(`Total peers: ${n}`);
      console.log(`Selected k: ${k}`);
      console.log(`Peers to propagate to: ${randomConns.length}`);

      // Store the requestId as our activeRequestId so we can track responses
      setActiveRequestId(requestId);
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
          fromPeerId: conn.remotePublicKey.toString('hex'),
          provider: 'lmstudio' // Indicate this is for LM Studio
        }));
      }

      console.log('Query sent to random conns, awaiting eventual response from the host');
      return null;
    }
  } catch (error) {
    console.error('Error in LM Studio ask:', error);

    // Remove the thinking message
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
 * Handle a query from a peer using LM Studio
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
    console.log(`Handling peer query with requestId: ${requestId} from peer: ${peerName} using LM Studio`);

    // In collaborative mode, show the thinking message and the query to the host
    if (getCollaborativeMode()) {
      addToChatHistory({
        type: 'thinking',
        content: `Received query from peer: ${message.prompt}\nThinking...`,
        requestId: requestId
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

    // Stream the response directly to the peer as it comes from LM Studio
    const fullResponse = await streamResponseToPeer(conn, message.model, message.prompt, requestId, peerId);

    // Only add the response to our chat history if we're in collaborative mode
    if (getCollaborativeMode() && fullResponse) {
      addToChatHistory({
        type: 'assistant',
        content: formatThinkingContent(fullResponse),
        rawContent: fullResponse,
        requestId: requestId,
        fromPeer: peerName
      });

      console.log("Added LM Studio response to host's chat history with thinking content:", {
        hasThinkingTags: fullResponse.includes("<think>"),
        hasThinkingHTML: formatThinkingContent(fullResponse).includes("thinking-content")
      });
    }
  } catch (error) {
    console.error('Error handling peer query with LM Studio:', error);
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
 * Stream response to a peer in real-time using LM Studio
 * @param {Object} conn - The connection object
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @param {string} requestId - The request ID
 * @param {string} peerId - The ID of the peer
 * @returns {Promise<string>} A promise that resolves to the complete response text
 */
async function streamResponseToPeer(conn, model, prompt, requestId, peerId) {
  try {
    const baseUrl = getLMStudioBaseUrl();
    const url = new URL('/api/v0/chat/completions', baseUrl);

    console.log('Streaming LM Studio response to peer - querying at URL:', url.toString());

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: -1
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
      console.log("Raw chunk from LM Studio for peer streaming:", chunk);

      // Handle Server-Sent Events format
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix
          
          if (data === '[DONE]') {
            console.log("LM Studio peer stream completed");
            break;
          }

          try {
            const json = JSON.parse(data);
            
            // Extract content from LM Studio's response format
            const delta = json.choices?.[0]?.delta;
            const responseChunk = delta?.content || '';
            
            if (responseChunk) {
              console.log("Extracted response chunk for LM Studio peer streaming:", responseChunk);

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
                    isComplete: false,
                    isJson: false,
                    isPrivate: isPrivate,
                    fromPeerId: peerId
                  }));
                  console.log("Sent LM Studio streaming chunk to peer:", JSON.stringify(responseChunk));
                  break;
                }
              }
            }
          } catch (parseError) {
            console.warn("Error parsing LM Studio chunk as JSON:", parseError);
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
          data: '',
          isComplete: true,
          isJson: false,
          isPrivate: isPrivate,
          fromPeerId: peerId
        }));
        console.log("Sent LM Studio completion signal to peer for requestId:", requestId);
        break;
      }
    }

    console.log("Complete streamed response text from LM Studio for peer:", fullResponseText);
    return fullResponseText;
  } catch (error) {
    console.error('Error streaming LM Studio response to peer:', error);
    
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
 * Query the local LM Studio directly
 * @param {string} model - The model to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} A promise that resolves to the response text
 */
async function queryLocalLLM(model, prompt) {
  try {
    const baseUrl = getLMStudioBaseUrl();
    const url = new URL('/api/v0/chat/completions', baseUrl);

    console.log('Querying LM Studio at URL:', url.toString());

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: -1
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
      console.log("Raw chunk from LM Studio for peer query:", chunk);

      // Handle Server-Sent Events format
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix
          
          if (data === '[DONE]') {
            console.log("LM Studio query stream completed");
            break;
          }

          try {
            const json = JSON.parse(data);
            
            // Extract content from LM Studio's response format
            const delta = json.choices?.[0]?.delta;
            const responseChunk = delta?.content || '';
            
            if (responseChunk) {
              console.log("Extracted response chunk for LM Studio peer query:", responseChunk);
              responseText += responseChunk;
            }
          } catch (parseError) {
            console.warn("Error parsing LM Studio chunk as JSON:", parseError);
          }
        }
      }
    }

    console.log("Complete response text for LM Studio peer query:", responseText);
    const formattedResponseText = formatThinkingContent(responseText);
    console.log("Contains thinking tags:", formattedResponseText.includes("<think>"));

    return responseText;
  } catch (error) {
    console.error('Error querying local LM Studio:', error);
    throw error;
  }
}

/**
 * Find the index of a thinking message with a specific request ID
 * @param {string} requestId - The request ID to search for
 * @returns {number} The index of the thinking message or -1 if not found
 */
function findThinkingMessageIndex(requestId) {
  // This is a simplified version - in a real implementation, we would get this from the history module
  return -1;
}

/**
 * Remove a thinking message at a specific index
 * @param {number} index - The index of the thinking message to remove
 */
function removeThinkingMessage(index) {
  // This is a simplified version - in a real implementation, we would get this from the history module
}

// Export functions
export {
  ask,
  handlePeerQuery,
  queryLocalLLM,
  streamResponseToPeer
};
