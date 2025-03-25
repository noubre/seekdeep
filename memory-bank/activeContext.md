# Active Context: SeekDeep

## Current Focus
The SeekDeep project is a P2P-enabled desktop application that interfaces with local LLMs through Ollama. The application allows users to collaborate in real-time, sharing access to LLM capabilities across a peer-to-peer network.

## Key Components in Development

### Desktop Application (app.js)
- Provides the main user interface for interacting with LLMs
- Handles P2P networking through Hyperswarm
- Manages different chat modes (collaborative vs. private)
- Implements model sharing between peers

### Server Component (server.js)
- Optional standalone server for headless environments
- Proxies requests to Ollama API
- Enables P2P access to a remote Ollama instance

### User Interface (index.html)
- Clean, minimalist chat interface
- Support for markdown rendering
- Display of "thinking" content from LLMs
- Model selection and chat mode controls

## Current Decisions

### Architecture Decisions
1. **Hybrid Client-Server and P2P**: The application functions both as a standalone desktop app and as part of a P2P network
2. **Host-Peer Model**: Clear distinction between host (initiates session) and peers (join session)
3. **Centralized Mode Control**: Only the host can change chat modes
4. **Model Sharing**: Host shares available models with peers

### Technical Decisions
1. **Vanilla JavaScript**: Using standard JavaScript without frameworks for simplicity
2. **Pear Runtime**: Leveraging Pear for cross-platform desktop capabilities
3. **Hyperswarm/Hypercore**: Using Holepunch stack for P2P networking
4. **Ollama Integration**: Direct integration with Ollama API for LLM access

### UX Decisions
1. **Dual Chat Modes**: Supporting both collaborative and private chat modes
2. **Markdown Rendering**: Rich formatting for LLM responses
3. **Thinking Content Display**: Showing the LLM's reasoning process
4. **Streaming Responses**: Real-time display of LLM outputs

## Active Considerations

### Current Challenges
1. **P2P Scalability**: Ensuring performance with multiple concurrent peers
2. **Model Compatibility**: Handling different Ollama model availability across peers
3. **Network Reliability**: Managing connection issues in P2P environment
4. **UI Responsiveness**: Maintaining smooth experience during LLM processing

### Open Questions
1. **Persistence**: Should chat history be saved between sessions?
2. **Authentication**: Is peer authentication needed for more secure sessions?
3. **Offline Support**: How should the application behave when Ollama is unavailable?
4. **Mobile Support**: Should the application be extended to mobile platforms?

## Recent Changes
- Implemented model sharing between host and peers
- Added support for "thinking" content display
- Enhanced chat mode management with validation
- Improved error handling for network and API failures
- Updated README.md with detailed project structure, known issues, and roadmap

## Next Steps
1. Enhance testing coverage for P2P functionality
2. Improve documentation for deployment and usage
3. Consider adding persistence for chat history
4. Explore options for peer authentication
5. Optimize performance for larger peer groups
