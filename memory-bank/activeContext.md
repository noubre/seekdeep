# Active Context: SeekDeep

## Current Focus
The SeekDeep project is a P2P-enabled desktop application that interfaces with local LLMs through multiple providers (Ollama and LM Studio). The application allows users to collaborate in real-time, sharing access to LLM capabilities across a peer-to-peer network. The project has undergone a major architectural refactoring, transitioning from a monolithic structure to a well-organized modular system.

## Key Components

### Modular Architecture (js/ directory)
The application has been completely refactored into a modular ES6 structure:

#### Core Modules
- **js/main.js**: Main entry point that initializes all modules and bootstraps the application
- **js/ui/**: User interface components (elements.js, events.js, rendering.js)
- **js/llm/**: LLM integration layer (provider.js, ollama.js, lmstudio.js, models.js)
- **js/network/**: P2P networking (hyperswarm.js, messaging.js)
- **js/session/**: Session management (modes.js, peers.js)
- **js/messages/**: Message handling (formatting.js, history.js)

#### LLM Provider System
- **Multi-Provider Support**: Abstraction layer supporting both Ollama and LM Studio
- **Auto-Detection**: Automatic provider detection and selection based on availability
- **Provider Switching**: Runtime switching between different LLM providers
- **Unified API**: Common interface for all providers through provider.js

### Server Component (server.js)
- Optional standalone server for headless environments
- Proxies requests to LLM providers (Ollama/LM Studio)
- Enables P2P access to remote LLM instances
- Useful for machines where the desktop app can't be run directly

### User Interface (index.html)
- Clean, minimalist chat interface with Nord-inspired color palette
- Support for markdown rendering with proper formatting
- Display of "thinking" content from LLMs in special containers
- Model selection dropdown with refresh capability
- Provider selection and status display
- Chat mode controls (host only)
- Active users display with color-coding for easy identification

## Current Implementation

### Architecture Implementation
1. **Modular ES6 Structure**: Complete refactoring from monolithic app.js to organized module system
2. **Multi-Provider LLM Support**: Unified interface supporting both Ollama (port 11434) and LM Studio (port 1234)
3. **Provider Auto-Detection**: Automatic detection and selection of available LLM providers
4. **Host-Peer Model**: Clear distinction between host (initiates session) and peers (join session) with appropriate permissions
5. **Centralized Mode Control**: Only the host can change chat modes, with validation to prevent unauthorized changes
6. **Model Sharing**: Host automatically shares available models with peers during handshake and on-demand via refresh

### Technical Implementation
1. **ES6 Modules**: Modern JavaScript module system with proper imports/exports
2. **Provider Abstraction**: Clean abstraction layer allowing seamless switching between LLM providers
3. **Pear Runtime**: Successfully integrated with Pear for cross-platform desktop capabilities
4. **Hyperswarm/Hypercore**: Implemented P2P networking with topic-based discovery and secure connections
5. **Multi-Provider Integration**: Support for both Ollama and LM Studio APIs with unified interface

### UX Implementation
1. **Dual Chat Modes**: Both collaborative (shared chat) and private (separate chats) modes fully implemented
2. **Provider Selection**: UI for selecting and monitoring LLM provider status
3. **Markdown Rendering**: Rich formatting for LLM responses with proper handling of code blocks, lists, tables, etc.
4. **Thinking Content Display**: Special formatting for LLM "thinking" content with distinct visual styling
5. **Streaming Responses**: Real-time display of LLM outputs with token-by-token updates

## Active Considerations

### Current Challenges
1. **P2P Scalability**: Performance testing needed for larger peer groups (beyond 20 concurrent peers)
2. **Network Reliability**: Occasional connection drops in unstable networks need more robust handling
3. **Error Recovery**: Improved recovery mechanisms needed for network interruptions and API failures
4. **UI Responsiveness**: Optimizing rendering performance for long chat sessions with many messages

### Open Questions
1. **Persistence**: Implementing optional chat history persistence between sessions
2. **Authentication**: Adding peer authentication for more secure sessions
3. **Offline Support**: Developing fallback mechanisms when Ollama is unavailable
4. **Mobile Support**: Evaluating feasibility of extending to mobile platforms

## Recent Changes
- **Major Architectural Refactoring**: Complete transition from monolithic app.js to modular ES6 structure
  - Organized code into logical modules (ui/, llm/, network/, session/, messages/)
  - Implemented proper ES6 imports/exports throughout the codebase
  - Created main.js as the central bootstrap entry point
- **Multi-Provider LLM Support**: Added comprehensive support for multiple LLM providers
  - Implemented provider abstraction layer (provider.js)
  - Added LM Studio support alongside existing Ollama integration
  - Created auto-detection and selection system for available providers
  - Updated Pear configuration to support both Ollama (11434) and LM Studio (1234) ports
- **Enhanced Testing Infrastructure**: Expanded test coverage with modular testing approach
  - Updated test scripts to work with new modular structure
  - Added comprehensive test commands in package.json
  - Maintained existing test coverage while adapting to new architecture
- **Improved Code Organization**: Better separation of concerns and maintainability
  - Clear module boundaries with specific responsibilities
  - Reduced coupling between components
  - Enhanced code reusability and testability

## Next Steps (Prioritized)
1. **Testing Adaptation (Critical)**
   - Update existing tests to work with new modular structure
   - Ensure all test suites pass with refactored codebase
   - Add tests for new provider abstraction layer
   - Maintain 80%+ test coverage across all modules

2. **Provider Enhancement (High Priority)**
   - Add provider status monitoring and health checks
   - Implement provider-specific configuration options
   - Add support for additional LLM providers (OpenAI-compatible APIs)
   - Enhance provider switching UI and user experience

3. **Documentation Updates (High Priority)**
   - Update all documentation to reflect new modular structure
   - Document provider system and configuration
   - Update setup instructions for multiple provider support
   - Create developer documentation for module system

4. **Stability and Performance (Medium Priority)**
   - Implement robust connection recovery mechanisms
   - Add automatic reconnection for dropped peers
   - Optimize module loading and initialization
   - Enhance error handling across all modules

5. **Feature Development (Lower Priority)**
   - Basic chat history persistence
   - Simple peer authentication mechanism
   - Offline mode capabilities
   - Enhanced provider management features
