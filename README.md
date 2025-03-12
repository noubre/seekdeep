# SeekDeep

A P2P-enabled desktop application that interfaces with a local LLM (Ollama) using Pear Runtime, Hyperswarm, and Hypercore crypto, Node, and b4a.

## Features

- Clean, minimalist UI for interacting with local LLMs
- P2P networking via Hyperswarm for decentralized connections
- Direct P2P communication protocol for sharing LLM capabilities
- Streaming responses from LLM for real-time feedback
- **Markdown rendering** for rich, formatted LLM responses
- **Collaborative and individual chat modes** for flexible peer interactions
- Display of "thinking" content from LLMs that expose it
- Built with Pear Runtime for cross-platform desktop support
- Keyboard shortcuts for improved productivity (Ctrl/Cmd + Enter to submit) (Not tested)
- Supports multiple concurrent peers in both collaborative and individual modes

## Prerequisites

Before running SeekDeep, make sure you have:

1. **Node.js** (v18 or later) and npm installed
2. **Pear Runtime** installed (from [Pears.com](https://pears.com) or the Holepunch equivalent)
3. **Ollama** installed and running with the DeepSeek model
   - Download from [ollama.ai](https://ollama.ai)
   - Run: `ollama pull deepseek-r1:1.5b` (Haven't tested other models yet.)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/noubre/seekdeep.git
   cd seekdeep
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Running the Server

The server component makes your local Ollama instance accessible over P2P:

1. Make sure Ollama is running with the DeepSeek model:
   ```bash
   ollama run deepseek-r1:1.5b
   ```

2. Start the server:
   ```bash
   node server.js
   ```

3. Note the public key displayed in the terminal – this is your server's unique identifier on the P2P network.

### Running the Desktop App

1. Make sure Ollama is running with the DeepSeek model.

2. Launch the app in development mode:
   ```bash
   cd seekdeep
   pear run --dev .
   
   // To run more instances:
   pear run --dev path/to/seekeep

   ```

3. The app window will open, and you can start entering prompts in the text area and clicking "Seek" (or pressing Ctrl+Enter) to get responses.

4. The app will automatically discover and connect to peers on the P2P network using Hyperswarm.

### Model Selection

SeekDeep now supports switching between different LLM models:

1. A model selector dropdown is available in the chat interface.
2. By default, SeekDeep will fetch the list of available models from your local Ollama installation.
3. If you don't have specific models installed, you can install them with Ollama:
   ```bash
   # Install additional models
   ollama pull llama2:7b
   ollama pull mistral:7b
   ollama pull phi:2.7b
   ollama pull gemma:7b
   ```
4. The model selection is used for all subsequent queries until changed.
5. The host's model selection determines which model processes queries for all connected peers.

### Model Sharing Between Host and Peers

When using SeekDeep in a peer-to-peer setup:

1. **Host Models**: The host's available Ollama models are automatically shared with connected peers during the connection handshake.
2. **Peer UI**: Connected peers will see the host's models in their model dropdown instead of their local models.
3. **Model Refresh**: Peers can click the refresh button next to the model dropdown to request the latest models from the host.
4. **No Local Models**: When connected to a host, peers will not fetch or use their local Ollama models, ensuring consistency across the session.
5. **Visual Indication**: A system message informs peers when they're using models from the host.

This ensures that all peers have access to the same models available on the host machine, regardless of what models they have installed locally.

## Collaboration Modes

SeekDeep offers two collaboration modes when interacting with peers:

- **Collaborative Mode**: When a peer sends a query to the host's LLM, both the message and response are visible to everyone in the chat. All peers see all conversations.
- **Individual Mode**: When a peer sends a query, the message and response are only visible to that peer, keeping each user's conversation private.

Only the host can switch between modes using the dropdown in the UI. As a host, when you change modes, all connected peers' chat modes are updated automatically.

### Collaboration Flow

1. **Host Sets Mode**: The host selects either collaborative or private mode using the dropdown
2. **Mode Broadcast**: The selection is automatically broadcast to all connected peers
3. **UI Update**: All peers receive a system message confirming the current mode
4. **Message Routing**: 
   - In collaborative mode: all messages and responses are shared with all peers
   - In private mode: each peer only sees their own messages and responses

### User Experience 

In collaborative mode, the application creates a shared workspace where:
- All users can see queries from other users
- All users can see responses to any query
- Messages are color-coded and labeled with the sender's name
- The chat history becomes a collective resource

In private mode:
- Each peer has a private conversation with the LLM
- The host still processes all queries but doesn't share responses
- The UI clearly indicates that conversations are private

## Keyboard Shortcuts

- **Ctrl/Cmd + Enter**: Submit the current prompt
- **Enter**: Submit the current prompt (unless Shift is held)
- **Shift + Enter**: New line in prompt (for multi-line prompts)
- **Enter** (in topic key field): Join an existing chat without clicking the Join button

## Scalability

### Peer Capacity
- The system is designed to handle small to medium-sized collaborative sessions (5-20 peers)
- Performance will vary depending on network conditions and host machine capabilities
- The host bears the primary processing load as all LLM queries are processed through their Ollama instance

### Scalability Factors
- **Host Resources**: The host's CPU, RAM, and GPU capabilities directly impact response times as peer count increases
- **Network Bandwidth**: In collaborative mode, each message is broadcast to all peers, increasing network usage with each additional peer
- **UI Performance**: The chat display must render all messages from all peers, which can become resource-intensive with many active users

### Performance Optimization
- **Private Mode**: For larger groups, using private mode reduces message broadcasting overhead
- **Query Throttling**: The system naturally throttles queries as they are processed sequentially
- **Host Selection**: For optimal performance, the peer with the strongest hardware and network connection should act as host

### Limitations
- No built-in load balancing across multiple peers with Ollama
- No clustering or sharding of conversations
- No persistence of chat history between sessions

## Troubleshooting

### Common Issues

1. **Unknown Message Type**
   - **Symptom**: Console errors showing "Unknown message type" 
   - **Solution**: Ensure both host and peers are running the same version of the application. Refresh browser windows to load the latest code.

2. **Model Dropdown Not Updating**
   - **Symptom**: Peer's model dropdown doesn't show host's models
   - **Solution**: Click the refresh button next to the model dropdown to request models from the host

3. **Ollama Connection Errors**
   - **Symptom**: "Failed to fetch" errors in console
   - **Solution**: Make sure Ollama is running on port 11434 and you have the requested models installed

## Compatibility with Pear Runtime

This implementation is specifically designed to work with Pear Runtime's Bare environment:

- Avoids using Node.js native modules that aren't supported in Bare
- Uses a direct P2P implementation with Hyperswarm instead of relying on third-party proxying libraries
- Implements a custom messaging protocol over the raw P2P connections
- Efficiently manages peer connections and message routing

## System Architecture

### High-Level Components

```
+-------------------------------------------------------------------------------------------------------------+
|                                             SEEKDEEP APPLICATION                                             |
+-------------------------------------------------------------------------------------------------------------+
                                                      |
                  +-----------------------------------|-----------------------------------+
                  |                                   |                                   |
       +----------v-----------+            +---------v----------+             +----------v-----------+
       |                      |            |                    |             |                      |
       |   User Interface     |            |   P2P Network     |             |   LLM Integration    |
       |                      |            |                    |             |                      |
       +----------+-----------+            +---------+----------+             +----------+-----------+
                  |                                  |                                   |
                  |                                  |                                   |
   +--------------+----------------+     +-----------+---------------+      +------------+-------------+
   |                               |     |                           |      |                          |
   | Components:                   |     | Components:               |      | Components:              |
   | - Chat display                |     | - Hyperswarm connection   |      | - Ollama API client     |
   | - User input form             |     | - Peer connections        |      | - Markdown parser       |
   | - Mode toggle                 |     | - Message handlers        |      | - Response formatter    |
   | - Active user list            |     | - Data serialization      |      | - Query processor       |
   | - Model selector              |     | - Mode management         |      | - Model sharing         |
   | - Refresh models button       |     | - Model distribution      |      |                          |
   |                               |     |                           |      |                          |
   +-------------------------------+     +---------------------------+      +--------------------------+
                  |                                  |                                   |
                  |                                  |                                   |
    +-------------+----------------+      +----------+---------------+      +------------+-------------+
    |                              |      |                          |      |                          |
    | Key Functions:               |      | Key Functions:           |      | Key Functions:           |
    | - createMessageElement()     |      | - initializeNewChat()    |      | - ask()                  |
    | - addToChatHistory()         |      | - joinExistingChat()     |      | - queryLocalLLM()       |
    | - updateChatDisplay()        |      | - setupPeerMessageHandler|      | - handlePeerQuery()     |
    | - renderMarkdown()           |      | - handleMessage()        |      | - parseOllamaResponse() |
    | - updateActiveUsersDisplay() |      | - leaveExistingChat()    |      | - containsMarkdown()    |
    | - updateModelSelect()        |      | - broadcastToPeers()     |      | - fetchAvailableModels()|
    | - requestModelsFromHost()    |      | - handleModelRequest()   |      | - getAvailableModels()  |
    |                              |      |                          |      |                          |
    +------------------------------+      +--------------------------+      +--------------------------+
```

### Data Flow Architecture

```
+--------------------+          +--------------------+          +--------------------+
|                    |  Query   |                    |  Query   |                    |
|       Peer         +--------->+       Host         +--------->+      Ollama        |
|                    |          |                    |          |        API         |
+--------^-----------+          +-------+------------+          +-------+------------+
         |                              |                               |
         |                              |                               |
         |       Response               |        Response               |
         +------------------------------|-------------------------------+
                                        |
                                        v
                 +-------------------+--+-----------------+------------------+
                 |                   |                    |                  |
      +----------v----------+  +----v---------------+ +--v------------------+
      |                     |  |                    | |                     |
      |   Models Sharing    |  |   Mode Selection   | |   Message Relay     |
      | (Host -> Peers)     |  |                    | | (Peers <-> Peers)   |
      +----------+----------+  +----+---------------+ +--+------------------+
                 |                  |                    |
                 v                  v                    v
      +----------+----------+  +----+---------------+ +--+------------------+
      |                     |  |                    | |                     |
      | Refresh On Demand   |  | Collaborative Mode | | Private Mode        |
      | (Peer -> Host)      |  | (All peers see all | | (Each peer only sees|
      |                     |  |  messages)         | |  their own messages)|
      +---------------------+  +--------------------+ +---------------------+
```

### Message Flow Between Components

```
+------------------+                   +------------------+                  +------------------+
|                  |  1. model_request |                  | 2. Query Ollama  |                  |
|      Peer        +------------------>+      Host        +----------------->+     Ollama API   |
|                  |                   |                  |                  |                  |
+--------^---------+                   +--------^---------+                  +--------+---------+
         |                                      |                                     |
         | 4. Update UI                         | 3. models_update                    |
         |                                      |                                     |
         +--------------------------------------+-------------------------------------+
                                                
+------------------+                   +------------------+                  +------------------+
|                  |  1. peer_message  |                  | 2. Forward       |                  |
|      Peer A      +------------------>+      Server      +----------------->+     Peer B       |
|                  |                   |                  |                  |                  |
+------------------+                   +------------------+                  +------------------+
```

## Implementation Details

### Model Sharing Protocol

The model sharing protocol consists of these key message types:

1. **handshake**: When a peer connects, host automatically shares available models
2. **model_request**: Peer can request models from host (triggered by refresh button)
3. **models_update**: Host sends available models to peers (response to handshake or model_request)

When a peer connects to a host:
1. The host fetches its local Ollama models 
2. The host sends models to the peer using the models_update message
3. The peer updates its UI to show the host's models
4. The peer sets a flag to prevent fetching local models

Peers can also request updated models by clicking the refresh button, which:
1. Sends a model_request message to the host
2. Host fetches current models and sends a models_update response
3. Peer updates the UI with the latest models

### Message Types

| Message Type    | Purpose                                   | Direction        |
|-----------------|-------------------------------------------|------------------|
| handshake       | Initialize connection                     | Peer → Host      |
| handshake_ack   | Acknowledge connection                    | Host → Peer      |
| models_update   | Share available models                    | Host → Peer      |
| model_request   | Request available models                  | Peer → Host      |
| query           | Send LLM query                            | Peer → Host      |
| response        | Stream LLM response                       | Host → Peer      |
| mode_update     | Change collaboration mode                 | Host → Peer      |
| peer_message    | Relay messages between peers              | Peer ↔ Peer      |

### Message Examples

Below are examples of the actual JSON message structures used in the P2P communication:

#### Handshake Message (Peer → Host)
```json
{
  "type": "handshake",
  "clientId": "a1b2c3d4e5f6...",
  "displayName": "Peer1"
}
```

#### Handshake Acknowledgment (Host → Peer)
```json
{
  "type": "handshake_ack",
  "status": "connected",
  "hostId": "z9y8x7w6v5u...",
  "isCollaborativeMode": true
}
```

#### Models Update Message (Host → Peer)
```json
{
  "type": "models_update",
  "models": [
    {
      "name": "llama2:7b",
      "modified_at": "2025-03-01T10:30:45.000Z",
      "size": 4200000000,
      "digest": "sha256:a1b2c3..."
    },
    {
      "name": "deepseek-coder:6.7b",
      "modified_at": "2025-03-05T14:22:10.000Z",
      "size": 3800000000,
      "digest": "sha256:d4e5f6..."
    }
  ]
}
```

#### Model Request Message (Peer → Host)
```json
{
  "type": "model_request"
}
```

#### Query Message (Peer → Host)
```json
{
  "type": "query",
  "model": "llama2:7b",
  "prompt": "Explain quantum computing in simple terms",
  "requestId": "req_1234567890",
  "fromPeerId": "a1b2c3d4e5f6..."
}
```

#### Response Message (Host → Peer)
```json
{
  "type": "response",
  "data": "Quantum computing uses quantum bits or qubits...",
  "requestId": "req_1234567890",
  "isComplete": false,
  "fromPeerId": "a1b2c3d4e5f6..."
}
```

#### Mode Update Message (Host → Peer)
```json
{
  "type": "mode_update",
  "isCollaborativeMode": true
}
```

#### Peer Message (Peer → Server → Other Peers)
```json
{
  "type": "peer_message",
  "content": {
    "type": "user",
    "fromPeer": "Peer1",
    "message": "Hello, can someone help me understand transformers?",
    "timestamp": 1647382941253
  }
}