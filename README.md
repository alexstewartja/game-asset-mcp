# Game Asset Generator using MCP and Hugging Face Spaces

This project is an innovative tool designed to streamline the creation of game assets by leveraging artificial intelligence. It enables users to generate both 2D and 3D game assets from simple text prompts, utilizing cutting-edge AI models hosted on Hugging Face Spaces. The backend is built as a server that integrates with the Model Context Protocol (MCP), making it compatible with AI assistants like Claude Desktop for seamless interaction. Whether you're a game developer looking to prototype assets quickly or an AI enthusiast experimenting with generative models, this project provides a robust and flexible solution.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [How It Works](#how-it-works)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Usage](#usage)
7. [Configuration](#configuration)
8. [API Endpoints](#api-endpoints)
9. [File Management](#file-management)
10. [Backend Architecture](#backend-architecture)
11. [MCP Integration](#mcp-integration)
12. [Troubleshooting](#troubleshooting)
13. [Contributing](#contributing)
14. [License](#license)

---

## Project Overview

The **Game Asset Generator** aims to simplify the process of creating game-ready assets by combining AI-powered generation with an easy-to-use interface. The project integrates three distinct AI models hosted on Hugging Face Spaces:

- **2D Asset Generation**: Uses the "gokaygokay/Flux-2D-Game-Assets-LoRA" model to create 2D images (e.g., pixel art sprites) from text prompts.
- **3D Asset Image Generation**: Employs "gokaygokay/Flux-Game-Assets-LoRA-v2" to generate images suitable for 3D modeling.
- **3D Model Conversion**: Leverages "TencentARC/InstantMesh" to transform 2D images into 3D models (e.g., OBJ or GLB formats).

The backend is implemented as an MCP server, exposing these capabilities as tools that can be invoked programmatically or through an AI assistant like Claude Desktop. Generated assets are saved locally, making them immediately accessible for use in game development workflows.

---

## Features

- **2D Asset Generation**: Create pixel art, sprites, or other 2D game assets from text descriptions.
- **3D Asset Generation**: Generate fully realized 3D models from text prompts, with automatic image-to-model conversion.
- **MCP Integration**: Seamlessly interact with the generator using MCP-compatible clients, such as Claude Desktop.
- **File Management**: Automatically save and organize generated assets in the local filesystem.
- **Extensible Backend**: Built with modularity in mind, allowing for future expansion to additional models or features.
- **Cross-Platform**: Works on any system with Node.js support (Windows, macOS, Linux).

---

## How It Works

The project operates as a pipeline that connects user inputs to AI models and delivers usable game assets. Here's a step-by-step breakdown:

1. **User Input**: The user provides a text prompt (e.g., "pixel art sword" or "isometric 3D castle").
2. **MCP Server**: The prompt is received by the MCP server, which routes it to the appropriate tool:
   - `generate_2d_asset`: For 2D asset creation.
   - `generate_3d_asset`: For 3D asset creation.
3. **AI Model Interaction**:
   - For 2D assets, the prompt is sent to "gokaygokay/Flux-2D-Game-Assets-LoRA" via its Hugging Face Space API.
   - For 3D assets, the prompt is first sent to "gokaygokay/Flux-Game-Assets-LoRA-v2" to generate an image, then the image is passed to "TencentARC/InstantMesh" for 3D conversion.
4. **File Output**: The resulting asset (image for 2D, 3D model file for 3D) is saved to the local working directory.
5. **Response**: The server returns the file path to the user or client, enabling immediate access.

This process is fully automated and abstracted behind the MCP interface, making it user-friendly and efficient.

---

## Prerequisites

Before installing the project, ensure you have the following:

- **Node.js**: Version 16 or higher (includes `npm`).
- **Git**: For cloning the repository.
- **Internet Access**: Required to interact with Hugging Face Spaces APIs.
- **NPM Packages**: The project uses the following dependencies:
  - `@gradio/client`: For interacting with Hugging Face Spaces.
  - `@modelcontextprotocol/sdk`: For MCP server implementation.
  - `dotenv`: For loading environment variables.
  - `express`: For SSE transport (remote access).
- **Optional**: Claude Desktop or another MCP-compatible client for advanced interaction.

---

## Installation

Follow these steps to set up the project locally:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/yourusername/game-asset-generator.git
   cd game-asset-generator
   ```

2. **Install Dependencies**:
   Install the required Node.js packages:
   ```bash
   npm install
   ```

3. **Install Additional Dependencies (if needed)**:
   If you've modified the package.json file or are missing dependencies:
   ```bash
   npm install dotenv express
   ```

4. **Configure Authentication (Optional)**:
   If you need to access private Hugging Face Spaces:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

5. **Run the Server**:
   Start the MCP server:
   ```bash
   # Basic usage
   npm start
   # or
   node index.js
   
   # With custom working directory
   node index.js /path/to/custom/directory
   
   # With SSE transport for remote access
   node index.js --sse
   ```

The server will start listening for MCP requests. You're now ready to generate assets!

> **Note**: This project uses ES modules (import/export syntax). The `"type": "module"` field in package.json enables this feature in Node.js.

---

## Usage

With the server running, you can interact with it via an MCP client or programmatically. Below are examples of how to use the two main tools.

### Generate a 2D Asset
- **Command**: 
  ```
  generate_2d_asset prompt:"pixel art sword"
  ```
- **Output**: A 2D image file (e.g., `generate_2d_asset_1698765432.png`) saved in the working directory.
- **Response**: The file path (e.g., `/path/to/generate_2d_asset_1698765432.png`).

### Generate a 3D Asset
- **Command**: 
  ```
  generate_3d_asset prompt:"isometric 3D castle"
  ```
- **Output**: A 3D model file (e.g., `generate_3d_asset_1698765432.obj`) saved in the working directory.
- **Response**: The file path (e.g., `/path/to/generate_3d_asset_1698765432.obj`).

### Using with Claude Desktop
If integrated with Claude Desktop (see [Configuration](#configuration)), simply type the commands above in the Claude interface, and the assets will be generated and saved.

---

## Configuration

The server offers several configuration options that can be customized to suit your needs.

### Working Directory
You can specify a custom working directory as a command-line argument:
```bash
node index.js /path/to/custom/directory
```
If not specified, the current working directory (`process.cwd()`) is used by default.

### Authentication for Hugging Face Spaces
If the Hugging Face Spaces you're connecting to require authentication, you can provide credentials via environment variables:

1. **Create a `.env` file**: Copy the provided `.env.example` file and rename it to `.env`.
2. **Set your credentials**:
   ```
   GRADIO_USERNAME=your_username_here
   GRADIO_PASSWORD=your_password_here
   ```

The server will automatically use these credentials when connecting to the Hugging Face Spaces.

### Transport Mode
The server supports two transport modes:
- **StdioServerTransport** (default): For local integration with Claude Desktop.
- **SSEServerTransport**: For remote access via HTTP.

To use SSE transport, run the server with the `--sse` flag:
```bash
node index.js --sse
```

You can also specify a custom port for the SSE server in your `.env` file:
```
PORT=3000
```

### Configuring for Claude Desktop
To integrate with Claude Desktop:

1. **Locate the Configuration File**:
   - **MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json` (if supported)

2. **Edit the Configuration**:
   Add an entry for this server:
   ```json
   {
     "mcpServers": {
       "game-asset-generator": {
         "command": "node",
         "args": ["/full/path/to/game-asset-generator/index.js"]
       }
     }
   }
   ```

3. **Restart Claude Desktop**: The server will now launch automatically when needed.

---

## API Endpoints

The backend communicates with the following Hugging Face Spaces APIs via Gradio clients:

### 2D Asset Generation
- **Space**: `mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA`
- **Endpoint**: `/predict`
- **Input**: 
  ```json
  { "prompt": "string" }
  ```
- **Output**: Image URL or binary data.

### 3D Asset Image Generation
- **Space**: `mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2`
- **Endpoint**: `/predict`
- **Input**: 
  ```json
  { "prompt": "string" }
  ```
- **Output**: Image URL or binary data.

### 3D Model Conversion
- **Space**: `TencentARC/InstantMesh`
- **Endpoint**: `/predict` (assumed based on typical Gradio setups)
- **Input**: 
  ```json
  { "image": "file_data" }
  ```
- **Output**: 3D model file (OBJ or GLB format).

These endpoints are abstracted by the MCP server, so users don't need to interact with them directly.

---

## File Management

- **Storage Location**: Files are saved in the current working directory by default.
- **Naming Convention**: Files are named with the tool prefix and a timestamp (e.g., `2d_asset_generate_2d_asset_1698765432.png`).
- **Resource Management**: The MCP server supports both listing and reading resources:
  - **Resource Listing**: Lists all generated files with metadata.
  - **Resource Reading**: Allows clients to access the contents of generated files.
- **Security**: Implements path validation to prevent directory traversal attacks.

To change the storage location, see [Configuration](#configuration).

---

## Backend Architecture

The backend is built with Node.js and JavaScript (ES modules), structured as follows:

- **index.js**: Main entry point, sets up the MCP server and defines tools.
- **Tools**:
  - `generate_2d_asset`: Handles 2D generation logic with input validation.
  - `generate_3d_asset`: Manages the 3D pipeline (image generation + conversion) with input validation.
- **Resource Handlers**:
  - `resources/list`: Lists all generated assets with proper MIME type detection.
  - `resources/read`: Allows reading the contents of generated assets.
- **Security Features**:
  - Input validation and sanitization
  - Path traversal prevention
  - Proper error handling
- **Logging**: Comprehensive logging for debugging and monitoring.
- **Dependencies**:
  - `@gradio/client`: For interacting with Hugging Face Spaces.
  - `@modelcontextprotocol/sdk`: For MCP server implementation.

The server listens for MCP requests, processes them asynchronously, and writes files to disk.

---

## MCP Integration

The Model Context Protocol (MCP) enables this project to act as a tool server for AI assistants. Key aspects:

- **Tool Definitions**: Exposed as `generate_2d_asset` and `generate_3d_asset`.
- **Resource Management**: Full support for listing and reading resources.
- **URI Scheme**: Uses `asset://` URI scheme for resources, clearly indicating they are server-managed assets.
- **Request Handling**: The server parses MCP commands, executes the appropriate tool, and returns file paths.
- **Compatibility**: Works with any MCP client, with specific support for Claude Desktop.

See [Configuration](#configuration) for setup instructions.

---

## Troubleshooting

### Common Issues
- **API Errors**:
  - **Cause**: Network issues or rate limits on Hugging Face Spaces.
  - **Solution**: Check the console logs and retry after a delay.
- **Authentication Errors**:
  - **Cause**: Incorrect credentials for private Hugging Face Spaces.
  - **Solution**: Verify your username and password in the `.env` file.
- **ES Modules Error**:
  - **Cause**: Node.js trying to run the code as CommonJS instead of ES modules.
  - **Solution**: Ensure the package.json has `"type": "module"` field.
- **File Saving Issues**:
  - **Cause**: Insufficient permissions in the working directory.
  - **Solution**: Ensure the directory is writable or specify a different working directory.
- **MCP Connection Failed**:
  - **Cause**: Misconfigured client or server not running.
  - **Solution**: Verify the server is active and the client config is correct.
- **Rate Limiting**:
  - **Cause**: Too many requests in a short period.
  - **Solution**: The server implements rate limiting to prevent abuse. Wait and try again.

### Debugging Tips
- The server includes comprehensive logging that outputs timestamps and operation details.
- Check the console output for detailed logs of each operation.
- Use the `--sse` flag to run the server with SSE transport for easier debugging with web tools.
- Test API endpoints manually using tools like `curl` or Postman.

---

## Contributing

We welcome contributions! To get involved:

1. **Fork the Repository**: Create your own copy on GitHub.
2. **Make Changes**: Implement features, fix bugs, or improve documentation.
3. **Submit a Pull Request**: Describe your changes in detail.
4. **Open Issues**: Report bugs or suggest enhancements.

Please follow standard coding conventions and include tests where applicable.

---

## License

This project is licensed under the **MIT License**. See the `LICENSE` file in the repository for full details.

---

This `README.md` provides an exhaustive overview of the Game Asset Generator project, from its core idea to detailed setup and usage instructions. It's designed to empower users and developers alike to make the most of this AI-driven toolset. Happy asset creation!