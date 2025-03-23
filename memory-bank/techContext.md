# Technical Context: SeekDeep

## Technology Stack

### Core Technologies
- **Node.js**: Runtime environment for JavaScript
- **Pear Runtime**: Cross-platform desktop application framework
- **Hyperswarm**: P2P networking library for peer discovery and connection
- **Hypercore-crypto**: Cryptographic primitives for secure P2P communication
- **b4a**: Buffer utilities for binary data handling
- **Express**: Web server framework for the server component

### Frontend
- **HTML/CSS**: Standard web technologies for UI structure and styling
- **Vanilla JavaScript**: Core language for application logic
- **Marked.js**: Library for Markdown parsing and rendering

### Backend
- **Ollama API**: Interface to local LLM models
- **HTTP/Fetch API**: For communication with Ollama
- **Child Process**: For spawning Ollama if not running

### Testing
- **Jest**: JavaScript testing framework
- **Testing Library**: DOM testing utilities
- **Mock-socket**: For mocking WebSocket connections
- **Fetch-mock**: For mocking HTTP requests

## Development Environment

### Prerequisites
- Node.js v18 or later
- npm package manager
- Pear Runtime
- Ollama with at least one model installed

### Project Structure
```
seekdeep/
├── app.js                 # Main desktop application logic
├── index.html             # Main UI structure and styling
├── server.js              # Optional standalone server component
├── package.json           # Project configuration and dependencies
├── lib/                   # External libraries
│   └── marked.min.js      # Markdown parser
├── test/                  # Test files
│   ├── app.test.js        # Unit tests for app.js
│   ├── server.test.js     # Unit tests for server.js
│   ├── integration.test.js # Integration tests
│   ├── e2e.test.js        # End-to-end tests
│   └── setupTests.js      # Test configuration
└── screenshots/           # Application screenshots
    ├── desktop.jpeg       # Desktop UI screenshot
    └── server.jpeg        # Server UI screenshot
```

## Key Technical Concepts

### P2P Networking
- **Topic-Based Discovery**: Peers discover each other using a shared topic
- **Public Key Identification**: Each peer has a unique public key identifier
- **Connection Handling**: Bidirectional connections between peers
- **Message Serialization**: JSON-based message format

### LLM Integration
- **API Proxying**: Server component proxies requests to Ollama
- **Response Streaming**: Chunked responses for real-time feedback
- **Model Discovery**: Fetching available models from Ollama
- **Thinking Content**: Special handling for LLM thinking process

### UI Architecture
- **Chat Interface**: Message display and input components
- **User Management**: Tracking active peers and their status
- **Mode Controls**: UI for switching between collaborative and private modes
- **Model Selection**: Dropdown for selecting LLM models

## Technical Constraints

### Ollama Dependency
- Requires Ollama to be installed and running
- Limited to models supported by Ollama
- Performance depends on local hardware capabilities

### P2P Limitations
- No central discovery server (pure P2P)
- Requires direct network connectivity between peers
- No persistent storage of chat history between sessions
- Limited to small/medium group sizes (5-20 peers)

### Desktop Application Constraints
- Requires Pear Runtime to be installed
- Limited to platforms supported by Pear Runtime
- UI constrained to single window with fixed dimensions

## Integration Points

### Ollama API Integration
- `/api/generate`: For generating LLM responses
- `/api/tags`: For listing available models
- Response format handling for streaming and thinking content

### P2P Message Protocol
- Structured JSON messages with type field
- Request IDs for tracking queries and responses
- Special message types for handshake, mode updates, and model sharing

### Desktop Integration
- Pear Runtime for window management
- System tray integration
- Keyboard shortcuts

## Performance Considerations

### LLM Performance
- Response time depends on model size and local hardware
- Streaming responses improve perceived performance
- Model selection affects quality and speed tradeoff

### Network Performance
- Message size optimization for efficient P2P communication
- Handling network latency in UI feedback
- Scalability considerations for larger peer groups

### UI Performance
- Efficient DOM updates for streaming responses
- Markdown rendering optimization
- Chat history management for long sessions
