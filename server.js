import http from 'http';
import { spawn } from 'child_process';
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';
import express from 'express';

// Default Ollama API URL
const OLLAMA_API_URL = 'http://localhost:11434';

// Default models to suggest if model list can't be fetched
const DEFAULT_MODELS = [
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek 1.5b' },
  { id: 'llama2:7b', name: 'Llama 2 7B' },
  { id: 'mistral:7b', name: 'Mistral 7B' },
  { id: 'phi:2.7b', name: 'Phi-2 2.7B' },
  { id: 'gemma:7b', name: 'Gemma 7B' }
];

// Store available models
let availableModels = [];

// Create an Express app
const app = express();

// Create a simple HTTP server
const server = http.createServer(app);

// CORS middleware for allowing cross-origin requests
function setupCORS(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.end();
  }
  
  next();
}

// Proxy Ollama API requests 
app.use('/api/tags', setupCORS, async (req, res) => {
  try {
    // Fetch available models from Ollama
    const models = await getAvailableModels();
    res.json({ models });
  } catch (error) {
    console.error('Error fetching Ollama models:', error);
    res.status(500).json({ error: 'Failed to fetch models from Ollama' });
  }
});

app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SeekDeep Local Server</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
        .model-list { margin-top: 20px; }
        .model-item { margin-bottom: 10px; padding: 10px; background: #eef; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>SeekDeep Local Test Server</h1>
      <p>This server is running and allows P2P access to Ollama API (port 11434).</p>
      <p>Status: <strong>Running</strong></p>
      <h2>Usage with curl:</h2>
      <pre>curl -X POST http://localhost:3000/api/generate -H "Content-Type: application/json" -d '{"model": "deepseek-r1:1.5b", "prompt": "Hello, how are you?"}'</pre>
      
      <div class="model-list">
        <h2>Available Models</h2>
        ${renderAvailableModels()}
      </div>
    </body>
    </html>
  `);
});

app.get('/api/models', async (req, res) => {
  // Endpoint to get available models
  getAvailableModels()
    .then(models => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    })
    .catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
});

app.use('/api', (req, res) => {
  // Proxy to Ollama
  proxyToOllama(req, res);
});

app.use((req, res) => {
  res.writeHead(404);
  res.end('Not found');
});

// Render available models as HTML
function renderAvailableModels() {
  if (!availableModels.length) {
    return '<p>Loading models information...</p>';
  }
  
  return `
    <div>
      ${availableModels.map(model => `
        <div class="model-item">
          <h3>${model.name || model.id}</h3>
          <p>ID: ${model.id}</p>
          ${model.description ? `<p>${model.description}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// Proxy a request to the Ollama API
function proxyToOllama(req, res) {
  try {
    const options = {
      hostname: 'localhost',
      port: 11434,
      path: req.url.replace('/api', ''),
      method: req.method,
      headers: req.headers
    };

    console.log(`Proxying request to Ollama: ${req.method} ${options.path}`);

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error('Proxy error:', e);
      res.writeHead(500);
      res.end('Proxy error: ' + e.message);
    });

    req.pipe(proxyReq);
  } catch (err) {
    console.error('Error proxying to Ollama:', err);
    res.writeHead(500);
    res.end('Internal server error: ' + err.message);
  }
}

// Handle a query from a client
async function handleClientQuery(conn, message) {
  const { requestId, model, prompt } = message;
  console.log(`Processing query from client: ${prompt.slice(0, 30)}...`);
  
  try {
    // Query the local Ollama API
    const url = `${OLLAMA_API_URL}/api/generate`;
    
    console.log(`Sending request to Ollama API at: ${url}`);
    console.log(`Using model: ${model}`);
    
    // Using native Node.js fetch API
    const fetchFn = typeof fetch === 'function' ? fetch : 
                   (typeof global !== 'undefined' && global.fetch) ? global.fetch : 
                   null;
    
    if (!fetchFn) {
      throw new Error('Fetch API not available');
    }
    
    // Make the request to Ollama
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, prompt, stream: true })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API returned status ${response.status}`);
    }
    
    // Stream the response from Ollama, but accumulate for a single response to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completeResponse = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Process the buffer to extract text from the JSON responses
      const lines = buffer.split('\n').filter(line => line.trim());
      let newResponseText = '';
      let leftoverBuffer = '';
      
      // Process each line
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            newResponseText += json.response;
          }
        } catch (parseErr) {
          // Keep non-parseable lines in the buffer
          leftoverBuffer += line + '\n';
        }
      }
      
      // Update buffer with leftover content
      buffer = leftoverBuffer;
      
      // Add new text to the complete response
      completeResponse += newResponseText;
      
      // Provide progress indication to the client (optional)
      if (newResponseText) {
        conn.write(JSON.stringify({
          type: 'progress',
          requestId,
          percentComplete: Math.floor(Math.random() * 100), // Just a placeholder
          isComplete: false
        }));
      }
    }
    
    // Process any remaining buffer content
    if (buffer.trim()) {
      const lines = buffer.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            completeResponse += json.response;
          }
        } catch (parseErr) {
          // Ignore invalid JSON
        }
      }
    }
    
    // Format the complete response with thinking content
    const formattedResponse = formatThinkingContent(completeResponse);
    
    // Send the single complete formatted response
    conn.write(JSON.stringify({
      type: 'response',
      requestId,
      data: formattedResponse,
      isComplete: true,
      isJson: false
    }));
    
    console.log(`Sent complete response for request ${requestId}`);
    
  } catch (error) {
    console.error('Error handling client query:', error);
    
    // Send error response
    try {
      conn.write(JSON.stringify({
        type: 'response',
        requestId,
        error: error.message,
        isComplete: true
      }));
    } catch (sendErr) {
      console.error('Failed to send error response:', sendErr);
    }
  }
}

// Handle model list request from client
function handleModelRequest(conn) {
  try {
    // Fetch available models from Ollama
    getAvailableModels()
      .then(models => {
        console.log('Sending model list to client:', models.length, 'models');
        conn.write(JSON.stringify({
          type: 'models_update',
          models
        }));
      })
      .catch(error => {
        console.error('Error fetching models for client:', error);
        conn.write(JSON.stringify({
          type: 'error',
          error: 'Failed to fetch models'
        }));
      });
  } catch (error) {
    console.error('Error handling model request:', error);
    conn.write(JSON.stringify({
      type: 'error',
      error: error.message
    }));
  }
}

// Handle peer message
function handlePeerMessage(conn, message) {
  try {
    const senderKey = b4a.toString(conn.remotePublicKey, 'hex');
    console.log(`Handling peer message from ${senderKey.slice(0, 8)}... (${message.messageType})`);
    
    // Broadcast the message to all other connections
    for (const connection of swarm.connections) {
      // Skip the sender
      const connectionKey = b4a.toString(connection.remotePublicKey, 'hex');
      if (connectionKey === senderKey) {
        continue;
      }
      
      // Forward the message
      console.log(`Forwarding message to ${connectionKey.slice(0, 8)}...`);
      connection.write(JSON.stringify(message));
    }
  } catch (error) {
    console.error('Error handling peer message:', error);
  }
}

// Helper function to check if Ollama is running
function checkOllama() {
  try {
    // Use different fetch approaches depending on the environment
    const fetchFn = typeof fetch !== 'undefined' ? fetch : 
                   (typeof global !== 'undefined' && global.fetch) ? global.fetch : 
                   null;
    
    if (!fetchFn) {
      console.error('No fetch implementation available');
      startOllama();
      return;
    }
    
    fetchFn(`${OLLAMA_API_URL}/api/version`)
      .then(res => {
        if (res.ok) {
          console.log('✅ Ollama is running');
          // Only start the P2P server if Ollama is running
          const publicKeyHex = startP2PServer();
          console.log(`
==============================================
🚀 Your SeekDeep server is up and running!
📡 P2P Public Key: ${publicKeyHex}
==============================================
          `);
        } else {
          console.warn('⚠️ Ollama is responding but returned status code:', res.status);
        }
      })
      .catch(err => {
        console.error('❌ Ollama is not running or not accessible:', err.message);
        startOllama();
      });
  } catch (error) {
    console.error('Error checking Ollama:', error);
    startOllama();
  }
}

// Helper function to start Ollama
function startOllama() {
  try {
    console.log('Attempting to start Ollama...');
    const ollamaProcess = spawn('ollama', ['run', 'deepseek-r1:1.5b']);
    
    ollamaProcess.stdout.on('data', (data) => {
      console.log('Ollama output:', data.toString().trim());
    });
    
    ollamaProcess.stderr.on('data', (data) => {
      console.error('Ollama error:', data.toString().trim());
    });
    
    ollamaProcess.on('close', (code) => {
      console.log('Ollama process exited with code:', code);
      if (code !== 0) {
        console.log('If Ollama is not installed, please install it from https://ollama.ai and try again.');
      }
    });
    
    // Check if Ollama starts successfully after a short delay
    setTimeout(checkOllama, 5000);
  } catch (error) {
    console.error('Failed to start Ollama:', error.message);
    console.log('Please install Ollama from https://ollama.ai and try again.');
  }
}

// Start the server, 5000 is usually already taken
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server public key: ${b4a.toString(keyPair.publicKey, 'hex')}`);
  console.log('Sharing this public key will allow others to connect to this server via the P2P network');
});

// Log when server is closed
server.on('close', () => {
  console.log('Server closed');
  swarm.destroy();
});

// Initialize Hyperswarm
const swarm = new Hyperswarm();
// Generate or use a fixed key pair for consistency
const keyPair = crypto.keyPair();
const publicKey = keyPair.publicKey;
const topic = publicKey; // Use our public key as the discovery topic

// Cache for pending requests
const pendingRequests = new Map();

// Start the P2P server
function startP2PServer() {
  try {
    console.log('P2P Server public key:', b4a.toString(publicKey, 'hex'));
    
    // Join the swarm with our public key as the topic
    swarm.join(topic, { server: true });
    console.log('Joined Hyperswarm for P2P discovery');
    
    // Handle new connections
    swarm.on('connection', (conn) => {
      console.log('New peer connected:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...');
      
      // Send mode update message to the newly connected peer
      conn.write(JSON.stringify({
        type: 'mode_update',
        isCollaborativeMode: false // Server is always in private mode
      }));
      
      conn.on('data', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('Received message:', message.type);
          
          switch (message.type) {
            case 'handshake':
              // Respond to handshake
              console.log('Processing handshake from client:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...');
              conn.write(JSON.stringify({
                type: 'handshake_ack',
                serverId: b4a.toString(publicKey, 'hex'),
                timestamp: Date.now()
              }));
              break;
              
            case 'query':
              // Handle LLM query from a client
              handleClientQuery(conn, message);
              break;
              
            case 'model_request':
              // Handle model list request from client
              console.log('Client requested models list:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...');
              handleModelRequest(conn);
              break;
              
            case 'peer_message':
              // Handle forwarding of peer messages (chat messages between peers)
              console.log('Forwarding peer message:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...', message.messageType);
              handlePeerMessage(conn, message);
              break;
              
            case 'response':
              // Handle forwarding response from one peer to others
              console.log('Forwarding response from:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...');
              handlePeerMessage(conn, message); // Reuse the same broadcast mechanism
              break;
              
            default:
              console.warn('Unknown message type:', message.type, 'Full message:', JSON.stringify(message));
          }
        } catch (err) {
          console.error('Error processing message:', err);
          try {
            // Try to send an error response
            conn.write(JSON.stringify({
              type: 'error',
              error: err.message
            }));
          } catch (sendErr) {
            console.error('Failed to send error message:', sendErr);
          }
        }
      });
      
      conn.on('close', () => {
        console.log('Peer disconnected:', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8) + '...');
      });
      
      conn.on('error', (err) => {
        console.error('Connection error:', err);
      });
    });
    
    return b4a.toString(publicKey, 'hex');
  } catch (error) {
    console.error('Failed to start P2P server:', error);
    throw error;
  }
}

// Check if Ollama is running
checkOllama();

// Fetch available models on startup
getAvailableModels()
  .then(models => {
    console.log(`Found ${models.length} available models:`);
    models.forEach(model => console.log(` - ${model.name} (${model.id})`));
  })
  .catch(error => {
    console.error('Error getting available models:', error);
  });

console.log('HTTP server is running on http://localhost:3000');
console.log('Press Ctrl+C to stop the server'); 

// Helper function to get available models from Ollama
async function getAvailableModels() {
  try {
    console.log('Fetching available models from Ollama API');
    const url = `${OLLAMA_API_URL}/api/tags`;
    
    // Use Node.js fetch API
    const fetchFn = typeof fetch === 'function' ? fetch : 
                   (typeof global !== 'undefined' && global.fetch) ? global.fetch : 
                   null;
    
    if (!fetchFn) {
      throw new Error('Fetch API not available');
    }
    
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Ollama API returned status ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.models ? data.models.length : 0} models from Ollama`);
    
    // Format models to match the client's expected format
    return data.models.map(model => ({
      name: model.name,
      id: model.name,
      modified_at: model.modified_at
    }));
  } catch (error) {
    console.error('Error fetching models from Ollama:', error);
    return [];
  }
}

// Format thinking content with HTML for client-side rendering
function formatThinkingContent(text) {
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