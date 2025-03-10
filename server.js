import http from 'http';
import { spawn } from 'child_process';
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

// Default Ollama API URL
const OLLAMA_API_URL = 'http://localhost:11434';

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SeekDeep Local Server</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>SeekDeep Local Test Server</h1>
        <p>This server is running and allows P2P access to Ollama API (port 11434).</p>
        <p>Status: <strong>Running</strong></p>
        <h2>Usage with curl:</h2>
        <pre>curl -X POST http://localhost:5000/api/generate -H "Content-Type: application/json" -d '{"model": "deepseek-r1:1.5b", "prompt": "Hello, how are you?"}'</pre>
      </body>
      </html>
    `);
  } else if (req.url.startsWith('/api/')) {
    // Proxy to Ollama
    proxyToOllama(req, res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

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

// Parse Ollama response chunk
function parseOllamaResponse(text) {
  try {
    // Try to parse as JSON
    const lines = text.split('\n').filter(line => line.trim());
    
    let responseText = '';
    
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        
        // Skip thinking tags and extract only the response
        if (json.response && 
            !json.response.includes('<think>') && 
            !json.response.includes('</think>')) {
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
    
    return responseText;
  } catch (err) {
    console.error('Error parsing Ollama response:', err);
    return text; // Return original text on error
  }
}

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
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
      
      conn.on('data', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('Received message:', message.type);
          
          switch (message.type) {
            case 'handshake':
              // Respond to handshake
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
              
            default:
              console.warn('Unknown message type:', message.type);
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

// Handle a query from a client
async function handleClientQuery(conn, message) {
  const { requestId, model, prompt } = message;
  console.log(`Processing query from client: ${prompt.slice(0, 30)}...`);
  
  try {
    // Query the local Ollama API
    const url = `${OLLAMA_API_URL}/api/generate`;
    
    console.log(`Sending request to Ollama API at: ${url}`);
    
    // In Bare environments, use global fetch if available
    const fetchFn = typeof fetch !== 'undefined' ? fetch : 
                   (typeof global !== 'undefined' && global.fetch) ? global.fetch : 
                   null;
    
    if (!fetchFn) {
      throw new Error('No fetch implementation available');
    }
    
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // Stream the response back to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Send the raw JSON to the client (client will parse it)
      try {
        conn.write(JSON.stringify({
          type: 'response',
          requestId,
          data: buffer,
          isComplete: false,
          isJson: true
        }));
        
        // Clear buffer after sending
        buffer = '';
      } catch (err) {
        console.error('Error sending response chunk:', err);
        break;
      }
      
      // Small delay to avoid overwhelming the connection
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Send completion message
    if (buffer.trim()) {
      conn.write(JSON.stringify({
        type: 'response',
        requestId,
        data: buffer,
        isComplete: false,
        isJson: true
      }));
    }
    
    conn.write(JSON.stringify({
      type: 'response',
      requestId,
      data: '',
      isComplete: true,
      isJson: true
    }));
    
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

// Check if Ollama is running
checkOllama();

console.log('HTTP server is running on http://localhost:5000');
console.log('Press Ctrl+C to stop the server'); 