# Product Context: SeekDeep

**Last Updated:** November 15, 2025

## Problem Statement
Users of local LLMs often face challenges in collaborating and sharing insights. Traditional LLM interfaces lack P2P capabilities, making it difficult for teams to work together with AI assistance. Additionally, local LLM deployments typically don't support real-time collaboration or sharing of model capabilities across different machines.

## Solution
SeekDeep provides a specialized desktop application that combines local LLM capabilities with P2P networking. It enables users to:
- Connect directly with peers without central servers
- Share access to local LLM models with peers who may not have them installed
- Collaborate in real-time with shared or private chat modes
- View rich, formatted responses with markdown rendering
- See the LLM's "thinking" process when available

## User Experience Goals
- **Simplicity**: Clean, minimalist UI that focuses on the conversation
- **Flexibility**: Support for both collaborative and private chat modes
- **Transparency**: Visibility into the LLM's thinking process
- **Richness**: Proper rendering of markdown for formatted responses
- **Responsiveness**: Real-time streaming of LLM responses
- **Connectivity**: Seamless P2P connections without complex configuration

## Key Features
1. **P2P Networking**: Decentralized connections via Hyperswarm
2. **Multi-Provider LLM Integration**: Support for both Ollama and LM Studio with automatic detection
3. **Dual Chat Modes**: 
   - Collaborative mode where all peers see all messages
   - Private mode where each peer has a separate conversation
4. **Model Sharing**: Host shares available models with connected peers
5. **Markdown Rendering**: Rich formatting of LLM responses
6. **Thinking Content Display**: Visibility into the LLM's reasoning process
7. **Response Streaming**: Real-time display of LLM responses as they're generated
8. **Session Persistence**: Save and load chat sessions with full history
9. **Export/Import**: Download chats as JSON files and import previous sessions
10. **History Browser**: Browse, search, and manage saved sessions through sidebar interface

## User Workflows
1. **Host Session**: User starts a new session and shares the topic key with peers
2. **Join Session**: Peers join an existing session using the topic key
3. **Provider Selection**: User selects between Ollama and LM Studio (if both available)
4. **Model Selection**: Users select from available models (local or from host)
5. **Chat Mode Selection**: Host toggles between collaborative and private modes
6. **Query Submission**: Users submit prompts to the LLM
7. **Response Viewing**: Users see formatted responses with thinking content
8. **Session Export**: User exports current chat to JSON file (automatically saved to history)
9. **Session Import**: User imports a previously exported chat from JSON file
10. **History Browsing**: User opens history sidebar to browse saved sessions
11. **Session Search**: User searches through saved sessions by name or content
12. **Session Loading**: User loads a previous session to continue or review
13. **Session Management**: User deletes old or unwanted sessions

## Value Proposition
SeekDeep transforms how teams interact with local LLMs by making the experience collaborative, transparent, flexible, and persistent. It bridges the gap between powerful local LLM deployments and the need for team collaboration, without sacrificing privacy or requiring cloud services. With full session persistence, users never lose their valuable conversations and can easily share insights by exporting and importing chat sessions.

## Persistence Benefits
- **Never Lose Conversations**: All chats automatically saved to localStorage
- **Easy Sharing**: Export sessions as portable JSON files
- **Session History**: Browse and search through all past conversations
- **Quick Access**: Load previous sessions with a single click
- **Metadata Tracking**: See when sessions were created, message counts, and models used
- **Storage Management**: Monitor storage usage and manage saved sessions
- **No Cloud Required**: All persistence is local, maintaining privacy