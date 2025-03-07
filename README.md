# SeekDeep

A P2P-enabled desktop application that interfaces with a local LLM (Ollama) using Pear Runtime, Hyperswarm, and Hypercore.

## Features

- Clean, minimalist UI for interacting with local LLMs
- P2P networking via Hyperswarm for decentralized connections
- Direct P2P communication protocol for sharing LLM capabilities
- Streaming responses from LLM for real-time feedback
- **Markdown rendering** for rich, formatted LLM responses
- **Collaborative and private chat modes** for flexible peer interactions
- Display of "thinking" content from LLMs that expose it
- Built with Pear Runtime for cross-platform desktop support

## Prerequisites

Before running SeekDeep, make sure you have:

1. **Node.js** (v18 or later) and npm installed
2. **Pear Runtime** installed (from [Pears.com](https://pears.com) or the Holepunch equivalent)
3. **Ollama** installed and running with the DeepSeek model
   - Download from [ollama.ai](https://ollama.ai)
   - Run: `ollama pull deepseek-r1:1.5b`

## Installation

1. Clone this repository:
   ```bash
   git clone https://your-repo-url/seekdeep.git
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

1. Make sure Ollama is running with the DeepSeek model (if you want to use your local model).

2. Launch the app in development mode:
   ```bash
   npm run dev
   ```

3. The app window will open, and you can start entering prompts in the text area and clicking "Seek" (or pressing Ctrl+Enter) to get responses.

4. The app will automatically discover and connect to peers on the P2P network using Hyperswarm.

### Collaboration Modes

SeekDeep offers two collaboration modes when interacting with peers:

- **Collaborative Mode (default)**: All users see all messages and responses. Good for group discussions or demonstrations.
- **Private Mode**: Users only see their own conversations with the AI. Good for individual exploration without distracting others.

You can switch between modes using the dropdown in the UI. As a host, when you change modes, all connected peers will be updated automatically.

## Application Architecture

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
    |                              |      |                          |      |                          |
    +------------------------------+      +--------------------------+      +--------------------------+
```

### Data Flow Architecture

```
+----------------+          +----------------+          +----------------+
|                |  Query   |                |  Query   |                |
|    Joiner      +--------->+     Host      +--------->+    Ollama      |
|                |          |                |          |     API        |
+--------^-------+          +-------+--------+          +-------+--------+
         |                          |                           |
         |                          |                           |
         |       Response           |        Response           |
         +--------------------------|---------------------------+
                                    |
                                    v
                           +--------+--------+
                           |                 |
                           | Mode Selection  |
                           |                 |
                           +-----------------+
                                    |
                  +----------------+----------------+
                  |                                 |
       +----------v----------+         +-----------v-----------+
       |                     |         |                       |
       | Collaborative Mode  |         |    Private Mode       |
       | (Shared Chat)       |         |    (Separate Chats)   |
       |                     |         |                       |
       +---------------------+         +-----------------------+
```

### Operational Flow

```
Host:                                Peer:
+-------------------+                +-------------------+
| Start Application |                | Start Application |
+--------+----------+                +--------+----------+
         |                                    |
+--------v----------+                +--------v----------+
| Initialize New    |                | Join Existing     |
| Chat with Topic   |                | Chat with Key     |
+--------+----------+                +--------+----------+
         |                                    |
+--------v----------+                +--------v----------+
| Wait for Peers    |<---------------+ Connect to Host   |
+--------+----------+                +--------+----------+
         |                                    |
+--------v----------+                +--------v----------+
| Set Chat Mode     +--------------->+ Receive Chat Mode |
+--------+----------+                +--------+----------+
         |                                    |
+--------v----------+                +--------v----------+
| Process User or   |<---------------+ Send Query to     |
| Peer Queries      +--------------->+ Host              |
+--------+----------+                +--------+----------+
         |                                    |
+--------v----------+                +--------v----------+
| Query Local LLM   |                | Display Response  |
+--------+----------+                +-------------------+
         |
+--------v----------+
| Send Response to  |
| Peer (if needed)  |
+-------------------+
```

### Component Relationships

```
                        +-----------------------------------+
                        |            User Interface         |
                        +-----------------------------------+
                                        ^
                                        |
                                        v
+----------------+    +----------------+    +----------------+    +----------------+
|                |    |                |    |                |    |                |
|  Chat History  |<-->| Message Display|<-->|  Active Users  |<-->|  Input Form    |
|                |    |                |    |                |    |                |
+----------------+    +----------------+    +----------------+    +----------------+
                                ^
                                |
                                v
+----------------+    +----------------+    +----------------+
|                |    |                |    |                |
|  Peer Network  |<-->| Message Router |<-->|  LLM Client    |
|                |    |                |    |                |
+----------------+    +----------------+    +----------------+
        ^                      ^                     ^
        |                      |                     |
        v                      v                     v
+----------------+    +----------------+    +----------------+
|                |    |                |    |                |
| Connection Mgmt|    | Mode Selection |    |  Response      |
|                |    |                |    |  Processing    |
+----------------+    +----------------+    +----------------+
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
- Implements a simple message protocol for P2P communication
- Host uses their own local AI, joiners use the host's AI via P2P
- Supports both collaborative and private chat modes

## Key Features Explained

### Markdown Rendering
The application uses the marked.js library to parse and render Markdown in LLM responses. This provides:
- Formatted text with headers, bold, italic, etc.
- Code blocks with proper formatting
- Lists, tables, and other structured content
- Links and images

### Collaboration Modes
- **Collaborative Mode**: When a peer sends a query to the host's LLM, both the message and response are visible to everyone in the chat.
- **Private Mode**: When a peer sends a query, the message and response are only visible to that peer, keeping each user's conversation separate.

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