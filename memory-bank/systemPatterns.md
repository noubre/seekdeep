# System Patterns: SeekDeep

## Architecture Overview
SeekDeep follows a hybrid client-server and peer-to-peer architecture with clear separation of concerns:

```mermaid
graph TD
    Client[Desktop App] --> LLM[LLM Integration]
    Client --> P2P[P2P Network]
    Client --> UI[User Interface]
    
    LLM --> Ollama[Ollama API]
    P2P --> Hyperswarm[Hyperswarm]
    P2P --> Crypto[Hypercore Crypto]
    
    subgraph "Host Capabilities"
        ModelSharing[Model Sharing]
        ModeManagement[Mode Management]
        QueryProcessing[Query Processing]
    end
    
    Client --> ModelSharing
    Client --> ModeManagement
    Client --> QueryProcessing
```

## Key Components

### Desktop Application (app.js)
- **User Interface**: Handles rendering and user interactions
- **P2P Networking**: Manages peer connections and message handling
- **LLM Integration**: Interfaces with Ollama API
- **Host/Peer Logic**: Implements different behaviors based on role

### Server Component (server.js)
- **HTTP Server**: Provides API endpoints for local access
- **P2P Server**: Enables remote connections to Ollama
- **Proxy Logic**: Routes requests to Ollama API

### P2P Communication
- **Connection Management**: Handles peer discovery and connections
- **Message Protocol**: Defines structured message types for different operations
- **Role-Based Logic**: Different behaviors for hosts vs. peers

## Design Patterns

### Host-Peer Pattern
- **Host Role**: 
  - Initiates a session with a unique topic
  - Processes LLM queries for all peers
  - Controls chat mode (collaborative vs. private)
  - Shares available models with peers
- **Peer Role**:
  - Joins an existing session using a topic key
  - Sends queries to the host for processing
  - Receives responses from the host
  - Uses the host's available models

### Message Handling Pattern
- **Message Types**: Structured message objects with type field
- **Type-Based Routing**: Handler functions based on message type
- **Request-Response Flow**: Unique request IDs for tracking
- **Streaming Pattern**: Chunked responses with completion flags

### Mode Management Pattern
- **Centralized Control**: Only host can change modes
- **Propagation**: Mode changes broadcast to all peers
- **Validation**: Peers verify mode updates come from host
- **Default Safety**: System starts in private mode

### Model Sharing Pattern
- **Discovery**: Host shares available models during handshake
- **On-Demand Updates**: Peers can request refreshed model list
- **UI Integration**: Peer UI shows host's available models
- **Fallback**: Default models when connection fails

## Data Flow Patterns

### Query Flow
```mermaid
sequenceDiagram
    participant Peer
    participant Host
    participant Ollama
    
    Peer->>Host: query (model, prompt, requestId)
    Host->>Ollama: POST /api/generate
    Ollama-->>Host: Stream response chunks
    loop For each chunk
        Host-->>Peer: response (chunk, requestId)
    end
    Host-->>Peer: response (isComplete=true)
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
- **Connection Errors**: Automatic reconnection attempts
- **LLM Errors**: Graceful degradation with error messages
- **Message Parsing**: Try-catch blocks for JSON parsing
- **API Failures**: Fallback to default models or local processing

## Testing Patterns
- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component interaction testing
- **Mock Objects**: Simulation of external dependencies
- **Test Fixtures**: Predefined test data and environments
