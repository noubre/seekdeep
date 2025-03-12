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
   git clone https://github.com/holepunchto/seekdeep.git
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

### Collaboration Modes

SeekDeep offers two collaboration modes when interacting with peers:

- **Collaborative Mode**: When a peer sends a query to the host's LLM, both the message and response are visible to everyone in the chat. All peers see all conversations.
- **Individual Mode**: When a peer sends a query, the message and response are only visible to that peer, keeping each user's conversation private. (Not tested fully yet)

Only the host can switch between modes using the dropdown in the UI. As a host, when you change modes, all connected peers chat modes be updated automatically.

### Keyboard Shortcuts (Not tested)

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
   |                               |     | - Mode management         |      |                          |
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
    |                              |      | - broadcastToPeers()     |      |                          |
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
                           +------------+------------+
                           |                         |
                           |    Mode Selection       |
                           |                         |
                           +--------------------------+
                                        |
                  +-------------------+--------------------+
                  |                                        |
       +----------v----------+              +-------------v--------------+
       |                     |              |                            |
       | Collaborative Mode  |              |        Private Mode        |
       | (All peers see all  |              |   (Each peer only sees     |
       |  messages)          |              |    their own messages)     |
       +---------------------+              +----------------------------+
```

### Multi-Peer Communication Flow

```
                      +---------------------+
                      |                     |
                      |        Host         |
                      |                     |
                      +-----+-------+-------+
                            |       |
               +------------+       +------------+
               |                                 |
     +---------v----------+             +--------v-----------+
     |                    |             |                    |
     |      Peer 1        |             |      Peer 2        |
     |                    |             |                    |
     +--------------------+             +--------------------+
               |                                 |
               |           Collaborative         |
               |            Mode Only            |
               +--------------->-----------------+
```

### Connection and Message Routing

```
                   +----------------------+
                   |                      |
                   |  Hyperswarm Network  |
                   |                      |
                   +----^--------------^--+
                        |              |
            +-----------+              +-----------+
            |                                      |
 +----------v-----------+              +-----------v----------+
 |                      |              |                      |
 |  Host Connection     |              |  Peer Connection     |
 |  Management          |              |  Management          |
 |                      |              |                      |
 +----------+-----------+              +-----------+----------+
            |                                      |
 +----------v-----------+              +-----------v----------+
 |                      |              |                      |
 |  Message Handling    +<------------>+  Message Handling    |
 |  & Routing           |              |  & Routing           |
 |                      |              |                      |
 +----------+-----------+              +-----------+----------+
            |                                      |
            |                                      |
 +----------v-----------+              +-----------v----------+
 |                      |              |                      |
 |  Local LLM           |              |  UI Display          |
 |  Integration         |              |  & Chat History      |
 |                      |              |                      |
 +----------------------+              +----------------------+
```

## P2P Networking Architecture

SeekDeep uses a direct P2P approach that's compatible with Pear Runtime's Bare environment:

### Server Side (server.js)
- Uses Hyperswarm to make your server discoverable on the P2P network
- Generates a public key for identification
- Handles incoming P2P connections and routes LLM queries to Ollama
- Streams responses back to clients

### Client Side (app.js)
- Uses Hyperswarm to discover available peers
- Implements a message protocol for P2P communication with proper routing
- Host processes LLM queries locally, joiners route through the host
- Supports both collaborative and private chat modes with appropriate message visibility
- Handles peer connection management including connection establishment and teardown

## P2P Protocol for LLM Capability Sharing

The application implements a custom message-based protocol over Hyperswarm connections to enable seamless LLM capability sharing between peers:

### Message Types

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| `handshake` | Bidirectional | Establishes initial connection and exchanges peer information |
| `mode_update` | Host → Peers | Informs peers about collaborative/private mode changes |
| `query` | Peer → Host | Forwards LLM query from peer to host for processing |
| `response` | Host → Peer | Returns LLM response to the originating peer |
| `peer_message` | Any → All | Broadcasts user messages and LLM responses in collaborative mode |

### Protocol Flow

1. **Connection Establishment**
   ```
   Peer                                  Host
    |                                     |
    |------- connection established ----→|
    |                                     |
    |---------- handshake --------------→|
    |                                     |
    |←--------- handshake_ack -----------|
    |                                     |
    |←--------- mode_update -------------|
    |                                     |
   ```

2. **LLM Query Processing**
   ```
   Peer                                  Host                               Ollama API
    |                                     |                                     |
    |---------- query ------------------→|                                     |
    |                                     |---------- LLM request -----------→|
    |                                     |                                     |
    |                                     |←--------- LLM response -----------|
    |                                     |                                     |
    |←--------- response -----------------|                                     |
    |            or                       |                                     |
    |←- peer_message (in collab. mode) --|--→ other peers (in collab. mode)    |
    |                                     |                                     |
   ```

### Message Structure

All messages use JSON serialization and share a common structure:

```json
{
  "type": "[message_type]",   // One of the message types listed above
  "requestId": "1234567890",  // Unique ID to correlate requests and responses
  ... message-specific fields ...
}
```

#### Handshake Message
```json
{
  "type": "handshake",
  "clientId": "a1b2c3d4...",    // Public key of the peer
  "displayName": "You",         // How the peer identifies itself
  "timestamp": 1621234567890    // Connection time
}
```

#### Mode Update Message
```json
{
  "type": "mode_update",
  "isCollaborativeMode": true   // Whether collaborative mode is enabled
}
```

#### Query Message
```json
{
  "type": "query",
  "requestId": "1621234567890",
  "model": "deepseek-r1:1.5b",  // LLM model to use
  "prompt": "User's query text",
  "fromPeerId": "a1b2c3d4..."   // Sender's public key
}
```

#### Response Message
```json
{
  "type": "response",
  "requestId": "1621234567890",
  "data": "LLM response text",
  "isComplete": true,           // Whether this is the final chunk of response
  "isJson": false,              // Whether data is raw JSON or parsed text
  "isPrivate": false,           // Whether response is private to requestor
  "fromPeerId": "a1b2c3d4..."   // Original requestor's public key
}
```

#### Peer Message
```json
{
  "type": "peer_message",
  "messageType": "user",        // "user" or "assistant"
  "content": "Message content",
  "fromPeer": "Peer1",          // Display name of originating peer
  "requestId": "1621234567890",
  "isComplete": false           // For streaming responses
}
```

### Mode-Specific Behavior

#### Collaborative Mode
- All peer queries and responses are broadcast to all connected peers
- Each peer sees all conversations with the LLM
- Messages include peer identification for UI attribution

#### Private Mode
- Queries and responses are only exchanged between the requesting peer and host
- The `isPrivate` flag is set to `true` in responses
- Peers only see their own interactions with the LLM

### Error Handling

The protocol implements several error-handling mechanisms:

- **Connection Errors**: Connections are re-established automatically when disrupted
- **Query Errors**: Error responses include descriptive messages for debugging
- **Timeouts**: Queries without responses are eventually abandoned
- **Deduplication**: Multiple identical messages are filtered out

### Protocol Extensions

The protocol is designed to be extensible for future features:

- **Streaming Responses**: Chunked delivery with the `isComplete` flag
- **Message Filtering**: Support for content moderation and filtering
- **Capability Discovery**: Mechanism for peers to announce supported models

## Key Features Explained

### Markdown Rendering
The application uses the marked.js library to parse and render Markdown in LLM responses. This provides:
- Formatted text with headers, bold, italic, etc.
- Code blocks with proper formatting
- Lists, tables, and other structured content
- Links and images

### Peer Identification
Each user in the system is identified as:
- The current user sees themselves as "You"
- Other peers are labeled as "Peer1", "Peer2", etc.
- Each peer is assigned a unique color for easy visual identification

## Compatibility with Pear Runtime

// ... existing compatibility documentation ... 