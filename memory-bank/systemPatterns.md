# System Patterns: SeekDeep

**Last Updated:** November 15, 2025

## Architecture Overview
SeekDeep follows a modular hybrid client-server and peer-to-peer architecture with clear separation of concerns across ES6 modules:

```mermaid
graph TD
    Main[js/main.js] --> UI[UI Modules]
    Main --> LLM[LLM Modules]
    Main --> Network[Network Modules]
    Main --> Session[Session Modules]
    Main --> Messages[Message Modules]
    
    UI --> Elements[ui/elements.js]
    UI --> Events[ui/events.js]
    UI --> Rendering[ui/rendering.js]
    
    LLM --> Provider[llm/provider.js]
    LLM --> Ollama[llm/ollama.js]
    LLM --> LMStudio[llm/lmstudio.js]
    LLM --> Models[llm/models.js]
    
    Network --> Hyperswarm[network/hyperswarm.js]
    Network --> Messaging[network/messaging.js]
    
    Session --> Modes[session/modes.js]
    Session --> Peers[session/peers.js]
    
    Messages --> Formatting[messages/formatting.js]
    Messages --> History[messages/history.js]
    
    Provider --> Ollama
    Provider --> LMStudio
    
    subgraph "Host Capabilities"
        ModelSharing[Model Sharing]
        ModeManagement[Mode Management]
        QueryProcessing[Multi-Provider Query Processing]
    end
    
    Provider --> ModelSharing
    Modes --> ModeManagement
    Provider --> QueryProcessing
```

## Key Components

### Modular Architecture (js/ directory)
The application is organized into focused modules with clear responsibilities:

#### Core Bootstrap (js/main.js)
- **Application Initialization**: Bootstraps all modules in correct order
- **Module Coordination**: Manages inter-module communication
- **Event System**: Sets up global event listeners and dispatchers


#### LLM Modules (js/llm/)
- **provider.js**: Provider abstraction layer and auto-detection
- **ollama.js**: Ollama-specific API integration
- **lmstudio.js**: LM Studio-specific API integration
- **models.js**: Model management and fetching across providers

#### Network Modules (js/network/)
- **hyperswarm.js**: P2P networking and connection management
- **messaging.js**: Message protocol implementation and handling

#### UI Modules (js/ui/)
- **elements.js**: DOM element creation and management
- **events.js**: Event handler setup and user interaction management
- **rendering.js**: Display rendering and UI updates
- **history-browser.js**: Session history sidebar interface

#### Message Modules (js/messages/)
- **formatting.js**: Message formatting and markdown processing
- **history.js**: Chat history management and persistence
- **persistence.js**: Hyperbee/Hypercore persistence implementation (disabled)
- **persistence-manager.js**: High-level persistence coordination

#### Session Modules (js/session/)
- **modes.js**: Chat mode management (collaborative/private)
- **peers.js**: Peer connection and state management
- **storage.js**: localStorage-based session storage system

### Server Component (server.js)
- **HTTP Server**: Provides API endpoints for local access
- **Multi-Provider Proxy**: Routes requests to Ollama or LM Studio
- **P2P Server**: Enables remote connections to LLM providers

### Provider System
- **Abstraction Layer**: Unified interface for all LLM providers
- **Auto-Detection**: Automatic discovery of available providers
- **Runtime Switching**: Dynamic provider selection and switching
- **Health Monitoring**: Provider availability and status checking

## Design Patterns

### Module Pattern (ES6)
- **Encapsulation**: Each module encapsulates specific functionality
- **Explicit Dependencies**: Clear import/export statements
- **Separation of Concerns**: Focused responsibilities per module
- **Testability**: Isolated modules enable targeted testing

### Provider Pattern
- **Abstraction**: Common interface for all LLM providers
- **Strategy**: Runtime selection of provider implementation
- **Auto-Detection**: Automatic discovery and availability checking
- **Fallback**: Graceful degradation when providers unavailable

### Host-Peer Pattern
- **Host Role**: 
  - Initiates a session with a unique topic
  - Processes LLM queries for all peers using selected provider
  - Controls chat mode (collaborative vs. private)
  - Shares available models from active provider with peers
- **Peer Role**:
  - Joins an existing session using a topic key
  - Sends queries to the host for processing
  - Receives responses from the host's provider
  - Uses the host's available models and provider

### Message Handling Pattern
- **Message Types**: Structured message objects with type field
- **Type-Based Routing**: Handler functions based on message type
- **Request-Response Flow**: Unique request IDs for tracking
- **Streaming Pattern**: Chunked responses with completion flags
- **Provider Context**: Messages include provider information

### Mode Management Pattern
- **Centralized Control**: Only host can change modes
- **Propagation**: Mode changes broadcast to all peers
- **Validation**: Peers verify mode updates come from host
- **Default Safety**: System starts in private mode

### Model Sharing Pattern
- **Provider-Aware Discovery**: Host shares models from active provider
- **On-Demand Updates**: Peers can request refreshed model list
- **UI Integration**: Peer UI shows host's provider and models
- **Provider Switching**: Model list updates when host changes provider

### Persistence Pattern
- **localStorage-based Storage**: Browser localStorage for session persistence
- **Session Registry**: Central registry tracking all saved sessions
- **Metadata Tracking**: Session metadata (id, name, timestamp, messages, model, provider)
- **Export/Import**: JSON file export/import for portability
- **History Browser**: Sidebar UI for browsing and managing saved sessions

### Storage Architecture Pattern
- **Three-Layer Design**: 
  1. Storage module (session/storage.js) - Low-level localStorage operations
  2. Persistence manager (messages/persistence-manager.js) - Coordination layer
  3. History browser (ui/history-browser.js) - UI presentation layer
- **Registry Pattern**: Centralized session registry for quick metadata access
- **CRUD Operations**: Full create, read, update, delete for session management
- **Search Capability**: Real-time search across session metadata

## Data Flow Patterns

### Session Persistence Flow
```mermaid
sequenceDiagram
    participant User
    participant UI
    participant PersistenceManager
    participant Storage
    participant localStorage
    
    User->>UI: Click "Export" button
    UI->>PersistenceManager: exportSession()
    PersistenceManager->>History: getChatHistory()
    PersistenceManager->>Storage: saveSession(data)
    Storage->>localStorage: Save session data
    Storage->>localStorage: Update registry
    Storage-->>PersistenceManager: Session metadata
    PersistenceManager->>User: Download JSON file
    
    User->>UI: Click "History" button
    UI->>HistoryBrowser: toggleHistoryBrowser()
    HistoryBrowser->>Storage: listSessions()
    Storage->>localStorage: Get registry
    Storage-->>HistoryBrowser: Session list
    HistoryBrowser->>UI: Render session list
    
    User->>UI: Select session to load
    HistoryBrowser->>Storage: loadSession(id)
    Storage->>localStorage: Get session data
    Storage-->>HistoryBrowser: Session data
    HistoryBrowser->>History: Load messages
    HistoryBrowser-->>User: Session loaded
```

### Multi-Provider Query Flow
```mermaid
sequenceDiagram
    participant Peer
    participant Host
    participant Provider
    participant Ollama
    participant LMStudio
    
    Peer->>Host: query (model, prompt, requestId)
    Host->>Provider: ask(model, prompt)
    
    alt Ollama Provider
        Provider->>Ollama: POST /api/generate
        Ollama-->>Provider: Stream response chunks
    else LM Studio Provider
        Provider->>LMStudio: POST /v1/chat/completions
        LMStudio-->>Provider: Stream response chunks
    end
    
    loop For each chunk
        Provider-->>Host: response chunk
        Host-->>Peer: response (chunk, requestId, provider)
    end
    Host-->>Peer: response (isComplete=true)
```

### Provider Auto-Detection Flow
```mermaid
sequenceDiagram
    participant Main
    participant Provider
    participant Ollama
    participant LMStudio
    
    Main->>Provider: autoSelectProvider()
    Provider->>Ollama: GET /api/tags (with timeout)
    Provider->>LMStudio: GET /api/v0/models (with timeout)
    
    alt Ollama Available
        Ollama-->>Provider: 200 OK
        Provider-->>Main: "ollama"
    else LM Studio Available
        LMStudio-->>Provider: 200 OK
        Provider-->>Main: "lmstudio"
    else Both Available
        Provider-->>Main: Current or preferred provider
    else None Available
        Provider-->>Main: Current provider (with warning)
    end
```

### Collaborative Mode Flow
```mermaid
sequenceDiagram
    participant Peer1
    participant Host
    participant Peer2
    participant Ollama
    
    Peer1->>Host: query (prompt, requestId)
    Host->>Peer2: peer_message (user, prompt, fromPeer)
    Host->>Ollama: POST /api/generate
    Ollama-->>Host: Stream response chunks
    loop For each chunk
        Host-->>Peer1: response (chunk, requestId)
        Host-->>Peer2: peer_message (assistant, chunk)
    end
    Host-->>Peer1: response (isComplete=true)
    Host-->>Peer2: peer_message (isComplete=true)
```

### Private Mode Flow
```mermaid
sequenceDiagram
    participant Peer1
    participant Host
    participant Peer2
    participant Ollama
    
    Peer1->>Host: query (prompt, requestId)
    Host->>Ollama: POST /api/generate
    Ollama-->>Host: Stream response chunks
    loop For each chunk
        Host-->>Peer1: response (chunk, requestId)
    end
    Host-->>Peer1: response (isComplete=true)
    
    Peer2->>Host: query (different prompt, requestId2)
    Host->>Ollama: POST /api/generate
    Ollama-->>Host: Stream response chunks
    loop For each chunk
        Host-->>Peer2: response (chunk, requestId2)
    end
    Host-->>Peer2: response (isComplete=true)
```

## Error Handling Patterns
- **Provider Failures**: Automatic fallback to available providers
- **Connection Errors**: Automatic reconnection attempts with exponential backoff
- **LLM Errors**: Graceful degradation with provider-specific error messages
- **Message Parsing**: Try-catch blocks for JSON parsing with detailed logging
- **API Failures**: Provider switching and fallback mechanisms
- **Module Loading**: Graceful handling of missing or failed module imports

## Testing Patterns
- **Modular Unit Tests**: Individual module testing with isolated dependencies
- **Integration Tests**: Cross-module interaction testing
- **Provider Tests**: Multi-provider scenario testing
- **Persistence Tests**: localStorage operations and session management testing
- **Mock Objects**: Simulation of external dependencies, providers, and storage
- **Test Fixtures**: Predefined test data and environments
- **Module Mocking**: ES6 module mocking for isolated testing
- **Storage Mocking**: localStorage mock for testing persistence without browser environment