# SeekDeep

A P2P-enabled desktop application that interfaces with a local LLM (Ollama) using Pear Runtime, Hyperswarm, and Hypercore.

## Features

- Clean, minimalist UI for interacting with local LLMs
- P2P networking via Hyperswarm for decentralized connections
- Direct P2P communication protocol for sharing LLM capabilities
- Streaming responses from LLM for real-time feedback
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
- Routes LLM requests through available peer connections
- Falls back to local Ollama when no peers are available

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

## License

Apache-2.0

---

Note: This is a proof-of-concept application. In a production environment, you would want to add proper error handling, security measures, and more robust P2P connection management. 