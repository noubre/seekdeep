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

This implementation is specifically designed to work with Pear Runtime's Bare environment:

- Avoids using Node.js native modules that aren't supported in Bare
- Uses a direct P2P implementation with Hyperswarm instead of relying on third-party proxying libraries
- Implements a custom messaging protocol over the raw P2P connections
- Efficiently manages peer connections and message routing

## Deployment Considerations

When deploying this application in production environments, consider:

- **Network Requirements**: Ensure firewalls and NATs are configured to allow P2P connections
- **Resource Allocation**: The host machine should have sufficient resources to handle the expected number of concurrent peers
- **Scaling Strategy**: For larger deployments, consider implementing a federation approach with multiple host instances
- **Security**: By default, all peers can join with the topic key; consider implementing authentication if needed

## Development

- Modify the UI by editing `index.html`
- Adjust P2P networking and LLM interaction logic in `app.js`
- Run tests with `npm test`

## Troubleshooting

- **Connection Issues**: Make sure your firewall allows P2P connections
- **LLM Errors**: Verify Ollama is running on port 11434
- **Bare Compatibility**: If you encounter errors about missing Node.js native modules, ensure you're using only Bare-compatible APIs
- **Markdown Rendering Issues**: Check that the text contains valid Markdown syntax

## License

Apache-2.0

---

Note: This is a proof-of-concept application. In a production environment, you would want to add proper error handling, security measures, and more robust P2P connection management.

## System Components in Detail

This section provides detailed documentation of all major system components to help contributors understand the architecture and codebase.

### Core Data Structures

#### Chat History Management
```javascript
// Main data structure for tracking all messages
const chatHistory = [];

// Structure of a message object
{
  type: 'user' | 'assistant' | 'system' | 'thinking',  // Message type
  content: String,                                     // Message content
  fromPeer: String,                                    // Peer name (optional)
  peerId: String,                                      // Peer ID (optional)
  requestId: String,                                   // For tracking queries/responses
  timestamp: Number                                    // Message creation time
}
```

#### Peer Management
```javascript
// Tracks all connected peers
const activePeers = new Map();  // Maps peer IDs to peer info objects

// Structure of a peer info object
{
  id: String,                 // Peer public key
  displayName: String,        // Human-readable name (Peer1, Peer2, etc.)
  peerNumber: Number,         // Unique identifier for this peer
  colorClass: String,         // CSS class for peer color
  colorName: String,          // Human-readable color name
  clientId: String,           // Client identifier
  connectionTime: Date,       // When the peer connected
  metadata: Object            // Additional peer metadata
}
```

#### Connection Management
```javascript
// Array of all active connections
const conns = [];  

// Map of peer handlers for message processing
const peerHandlers = new Map();  // Maps peer IDs to message handler functions
```

### UI Component Architecture

The user interface is built using standard web technologies with these major components:

#### 1. Chat Display
- **HTML Structure**: A container with dynamically created message elements
- **Implementation**: `createMessageElement()` generates DOM elements for each message type
- **Styling**: Different styles for user, assistant, system, and thinking messages
- **Peer Attribution**: Messages from peers are color-coded and labeled with peer names

#### 2. Input Interface
- **Prompt Area**: Multi-line text input with autofocus and keyboard shortcuts
- **Model Selector**: Dropdown for selecting which LLM model to use
- **Submit Button**: Submits the current prompt to the LLM
- **Event Handling**: Keyboard shortcuts (Ctrl+Enter, Shift+Enter) for improved UX

#### 3. Connection Panel
- **Topic Key Display**: Shows the current session's topic key for sharing
- **Join Interface**: Input field and button for joining existing sessions
- **Mode Selector**: Dropdown to toggle between collaborative and private modes
- **Active Users Display**: Visual representation of all connected peers with colors

#### 4. UI State Management
- **DOM Updates**: The UI is updated through direct DOM manipulation
- **Event Flow**: User interactions trigger events that are processed by event handlers
- **Display Refresh**: `updateChatDisplay()` synchronizes the UI with the chat history
- **Peer Updates**: `updateActiveUsersDisplay()` refreshes the active peers display

### LLM Integration Details

The application interfaces with Ollama using a standard HTTP API:

#### Query Execution Path
1. User input is captured from the form
2. The `ask()` function is called with model and prompt parameters
3. If the user is the host:
   - Direct Ollama API call to `/api/generate` with streaming enabled
   - Response chunks are processed as they arrive
   - Updating UI in real-time as response streams in
4. If the user is a peer:
   - Query is forwarded to the host via the P2P network
   - Host processes the query through its local Ollama
   - Response is streamed back to the peer

#### Response Processing
- **Streaming**: Responses are streamed for real-time feedback
- **Markdown Detection**: `containsMarkdown()` identifies markdown content
- **Rendering**: `renderMarkdown()` converts markdown to HTML
- **Formatting**: Code blocks, tables, and other elements are styled appropriately
- **Thinking Content**: Special handling for model "thinking" output

### File Structure and Organization

```
seekdeep/
├── index.html          # Main application HTML interface
├── app.js              # Core application logic for the client
├── server.js           # Optional server for P2P-enabled LLM access
├── styles.css          # Application styling
├── package.json        # Project dependencies and scripts
├── lib/                # Third-party libraries
│   └── marked.min.js   # Markdown rendering library
└── assets/             # Static assets for the application
```

#### Key Files and Their Responsibilities

1. **app.js**: Core application logic
   - P2P networking via Hyperswarm
   - UI management and event handling
   - Chat history and peer tracking
   - LLM integration when running as host

2. **server.js**: Standalone LLM server
   - Makes local Ollama accessible over P2P
   - Handles incoming queries from remote peers
   - Streams responses back to clients

3. **index.html**: User interface
   - Defines the application layout
   - Loads required scripts and styles
   - Contains all UI elements

### Server-Client Interaction

The application can operate in two primary modes:

#### 1. Standalone Mode
- User runs both app.js and Ollama locally
- No server.js required
- All LLM processing happens on the local machine
- Can still connect to other peers and share LLM capabilities

#### 2. Server-Client Mode
- Server.js runs on a machine with Ollama installed
- App.js connects to the server via P2P
- Server processes LLM queries and returns results
- Multiple clients can connect to the same server

The interaction between these components follows this pattern:

```
+---------------+      P2P Network      +---------------+      HTTP API      +---------------+
|               |                       |               |                    |               |
|    app.js     |<--------------------->|   server.js   |<------------------>|     Ollama    |
|  (Client)     |                       |   (Server)    |                    |     API       |
|               |                       |               |                    |               |
+---------------+                       +---------------+                    +---------------+
       ^                                                                             ^
       |                                                                             |
       |                                    Direct API call when running locally     |
       +----------------------------------------------------------------------------+
```

### Security Implementation

#### 1. Connection Security
- All P2P connections are secured using Hyperswarm's built-in encryption
- Communication uses Noise protocol for encrypted channels
- Public key cryptography for peer identification

#### 2. Authentication
- Basic topic-based authentication (must know the topic key)
- No additional authentication layer in the base implementation
- Can be extended with custom authentication as needed

#### 3. Content Security
- Markdown rendering with sanitization to prevent XSS
- No automatic execution of code in responses
- Input validation for all user-provided data

### Testing and Quality Assurance

The codebase includes several approaches to testing:

#### 1. Manual Testing Procedures
- Connection establishment between peers
- Message delivery in different network conditions
- UI responsiveness with many messages
- Error handling and recovery

#### 2. Testing Utilities
- Console logging throughout the code for debugging
- Error reporting for P2P and LLM interactions
- State inspection tools for debugging

## Development Guidelines

For contributors looking to extend or modify the codebase:

### Adding New Features

1. **UI Extensions**
   - Modify `index.html` for new UI elements
   - Add event handlers in `app.js`
   - Update `styles.css` for proper styling

2. **Protocol Extensions**
   - Add new message types to the P2P protocol
   - Implement handlers in `setupPeerMessageHandler()`
   - Update documentation to reflect new message types

3. **LLM Integration Enhancements**
   - Modify the `ask()` function for new capabilities
   - Extend `parseOllamaResponse()` for different response formats
   - Add model-specific handling as needed

### Debugging Techniques

1. **P2P Connection Issues**
   - Check console logs for connection events
   - Verify topic keys match between peers
   - Test with local peers before remote peers

2. **LLM Integration Problems**
   - Verify Ollama is running and accessible
   - Check model availability with direct API calls
   - Test with simple prompts before complex ones

3. **UI Rendering Issues**
   - Inspect DOM elements for proper structure
   - Check chat history for correct message objects
   - Verify markdown parsing with simple examples

### Code Style and Conventions

- Standard JavaScript ES6+ syntax
- Descriptive function and variable names
- JSDoc-style comments for functions
- Clear separation of concerns between components

## Compatibility with Pear Runtime

// ... existing compatibility documentation ... 