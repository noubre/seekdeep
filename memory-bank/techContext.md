# Technical Context: SeekDeep

## Technology Stack

### Core Technologies
- **Node.js**: Runtime environment for JavaScript with ES6 module support
- **Pear Runtime**: Cross-platform desktop application framework
- **Hyperswarm**: P2P networking library for peer discovery and connection
- **Hypercore-crypto**: Cryptographic primitives for secure P2P communication
- **b4a**: Buffer utilities for binary data handling
- **Express**: Web server framework for the server component

### Frontend Architecture
- **ES6 Modules**: Modern JavaScript module system with import/export
- **HTML/CSS**: Standard web technologies for UI structure and styling
- **Vanilla JavaScript**: Core language for application logic with modular organization
- **Marked.js**: Library for Markdown parsing and rendering

### LLM Provider Integration
- **Ollama API**: Interface to local LLM models (port 11434)
- **LM Studio API**: Interface to LM Studio models (port 1234)
- **HTTP/Fetch API**: For communication with multiple LLM providers
- **Provider Abstraction**: Unified interface for all LLM providers
- **Auto-Detection**: Automatic provider discovery and health checking

### Testing Framework
- **Brittle**: Modern JavaScript testing framework
- **Testing Library DOM**: DOM testing utilities
- **JSDOM**: JavaScript DOM implementation for testing
- **Supertest**: HTTP assertion library for API testing
- **Node-fetch**: Fetch API implementation for Node.js testing

## Development Environment

### Prerequisites
- Node.js v18 or later
- npm package manager
- Pear Runtime
- Ollama with at least one model installed

### Project Structure
```
seekdeep/
├── js/                    # Modular JavaScript architecture
│   ├── main.js            # Main application bootstrap
│   ├── ui/                # User interface modules
│   │   ├── elements.js    # DOM element management
│   │   ├── events.js      # Event handling
│   │   └── rendering.js   # Display rendering
│   ├── llm/               # LLM provider modules
│   │   ├── provider.js    # Provider abstraction layer
│   │   ├── ollama.js      # Ollama integration
│   │   ├── lmstudio.js    # LM Studio integration
│   │   └── models.js      # Model management
│   ├── network/           # P2P networking modules
│   │   ├── hyperswarm.js  # P2P connection management
│   │   └── messaging.js   # Message protocol
│   ├── session/           # Session management modules
│   │   ├── modes.js       # Chat mode management
│   │   └── peers.js       # Peer state management
│   └── messages/          # Message handling modules
│       ├── formatting.js  # Message formatting
│       └── history.js     # Chat history
├── index.html             # Main UI structure and styling
├── server.js              # Optional standalone server component
├── package.json           # Project configuration and dependencies
├── lib/                   # External libraries
│   └── marked.min.js      # Markdown parser
├── memory-bank/           # Project documentation
│   ├── activeContext.md   # Current development context
│   ├── productContext.md  # Product goals and context
│   ├── progress.md        # Implementation progress
│   ├── projectbrief.md    # Project overview
│   ├── systemPatterns.md  # Architecture patterns
│   └── techContext.md     # Technical details
├── test/                  # Test files
│   ├── app.test.js        # Unit tests for core app
│   ├── server.test.js     # Unit tests for server
│   ├── integration.test.js # Integration tests
│   ├── e2e.test.js        # End-to-end tests
│   ├── simple.test.js     # Simple test scenarios
│   └── direct.test.js     # Direct API tests
└── screenshots/           # Application screenshots
    ├── desktop.jpeg       # Desktop UI screenshot
    └── server.jpeg        # Server UI screenshot
```

## Key Technical Concepts

### Modular Architecture
- **ES6 Modules**: Modern import/export system for clean dependencies
- **Separation of Concerns**: Each module has focused responsibilities
- **Bootstrap Pattern**: Main.js coordinates module initialization
- **Event-Driven Communication**: Modules communicate via custom events

### Multi-Provider System
- **Provider Abstraction**: Common interface for all LLM providers
- **Auto-Detection**: Automatic discovery of available providers
- **Health Monitoring**: Continuous provider availability checking
- **Runtime Switching**: Dynamic provider selection and switching
- **Unified API**: Consistent interface regardless of underlying provider

### P2P Networking
- **Topic-Based Discovery**: Peers discover each other using a shared topic
- **Public Key Identification**: Each peer has a unique public key identifier
- **Connection Handling**: Bidirectional connections between peers
- **Message Serialization**: JSON-based message format with provider context

### LLM Integration
- **Multi-Provider Proxying**: Server component proxies requests to multiple providers
- **Response Streaming**: Chunked responses for real-time feedback across providers
- **Model Discovery**: Fetching available models from active provider
- **Thinking Content**: Special handling for LLM thinking process
- **Provider Context**: Messages include provider information for proper routing

### UI Architecture
- **Modular UI Components**: Separated element creation, event handling, and rendering
- **Chat Interface**: Message display and input components
- **User Management**: Tracking active peers and their status
- **Mode Controls**: UI for switching between collaborative and private modes
- **Provider Selection**: UI for selecting and monitoring LLM providers
- **Model Selection**: Dropdown for selecting models from active provider

## Technical Constraints

### LLM Provider Dependencies
- Requires at least one LLM provider (Ollama or LM Studio) to be installed and running
- Limited to models supported by the active provider
- Performance depends on local hardware capabilities and provider efficiency
- Provider switching requires both providers to be available simultaneously

### P2P Limitations
- No central discovery server (pure P2P)
- Requires direct network connectivity between peers
- No persistent storage of chat history between sessions
- Limited to small/medium group sizes (5-20 peers)
- Provider context must be maintained across peer connections

### Desktop Application Constraints
- Requires Pear Runtime to be installed
- Limited to platforms supported by Pear Runtime
- UI constrained to single window with fixed dimensions
- ES6 module support required (modern browser/runtime)

### Module System Constraints
- Requires ES6 module support in runtime environment
- Module loading order dependencies must be managed
- Dynamic imports may affect startup performance
- Module boundaries must be maintained for testability

## Integration Points

### Multi-Provider API Integration
#### Ollama API (Port 11434)
- `/api/generate`: For generating LLM responses
- `/api/tags`: For listing available models
- Response format handling for streaming and thinking content

#### LM Studio API (Port 1234)
- `/v1/chat/completions`: For generating LLM responses
- `/api/v0/models`: For listing available models
- OpenAI-compatible API format

### Provider Abstraction Integration
- Unified `ask()` method across all providers
- Common model fetching interface
- Standardized error handling and response formatting
- Provider health checking and auto-selection

### P2P Message Protocol
- Structured JSON messages with type field
- Request IDs for tracking queries and responses
- Provider context in messages for proper routing
- Special message types for handshake, mode updates, model sharing, and provider updates

### Module Integration
- ES6 import/export system for clean dependencies
- Event-driven communication between modules
- Centralized initialization through main.js
- Module-specific configuration and state management

### Desktop Integration
- Pear Runtime for window management
- Multi-port configuration for provider support
- System tray integration
- Keyboard shortcuts

## Performance Considerations

### Multi-Provider LLM Performance
- Response time depends on model size, provider efficiency, and local hardware
- Provider auto-detection adds startup overhead but improves reliability
- Streaming responses improve perceived performance across all providers
- Model selection affects quality and speed tradeoff per provider
- Provider switching may cause temporary delays

### Module Loading Performance
- ES6 module loading adds initial overhead but improves maintainability
- Dynamic imports can be used for lazy loading non-critical modules
- Module initialization order affects startup time
- Module boundaries enable better code splitting and caching

### Network Performance
- Message size optimization for efficient P2P communication
- Provider context in messages adds minimal overhead
- Handling network latency in UI feedback across providers
- Scalability considerations for larger peer groups with provider context

### UI Performance
- Modular UI components enable targeted updates and optimizations
- Efficient DOM updates for streaming responses from multiple providers
- Markdown rendering optimization with provider-specific formatting
- Chat history management for long sessions with provider attribution
- Provider status monitoring adds minimal UI overhead
