# Game Asset Generator using MCP and Hugging Face Spaces

This project is an innovative tool that simplifies game asset creation by harnessing AI-powered generation. Whether you're a game developer needing quick prototypes or an AI enthusiast exploring generative models, this tool lets you create 2D and 3D game assets from text prompts with ease. It integrates three AI models from Hugging Face Spaces—powered by "gokaygokay/Flux-2D-Game-Assets-LoRA," "gokaygokay/Flux-Game-Assets-LoRA-v2," and "TencentARC/InstantMesh"—and uses the Model Context Protocol (MCP) for seamless interaction with AI assistants like Claude Desktop.

<p align="center">
  <a href="https://pay.ziina.com/MubarakHAlketbi">
    <img src="https://img.shields.io/badge/Support_Me-Donate-9626ff?style=for-the-badge&logo=https%3A%2F%2Fimgur.com%2FvwC39JY" alt="Support Me - Donate">
  </a>
  <a href="https://github.com/RooVetGit/Roo-Code">
    <img src="https://img.shields.io/badge/Built_With-Roo_Code-412894?style=for-the-badge" alt="Built With - Roo Code">
  </a>
</p>

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [How It Works](#how-it-works)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Usage](#usage)
7. [Configuration](#configuration)
8. [File Management](#file-management)
9. [MCP Integration](#mcp-integration)
10. [Troubleshooting](#troubleshooting)
11. [Advanced](#advanced)
12. [Contributing](#contributing)
13. [License](#license)

---

## Project Overview

The **Game Asset Generator** (version 0.1.0) is an innovative tool that simplifies game asset creation by harnessing AI-powered generation. Whether you're a game developer needing quick prototypes or an AI enthusiast exploring generative models, this tool lets you create 2D and 3D game assets from text prompts with ease. It integrates three AI models from Hugging Face Spaces—powered by "gokaygokay/Flux-2D-Game-Assets-LoRA," "gokaygokay/Flux-Game-Assets-LoRA-v2," and "TencentARC/InstantMesh"—and uses the Model Context Protocol (MCP) for seamless interaction with AI assistants like Claude Desktop. This initial release integrates with MCP using the TypeScript SDK version 1.7.0 and supports both 2D and 3D asset generation.

---

## Features

- **2D Asset Generation**: Create pixel art, sprites, or other 2D assets from text prompts (e.g., "pixel art sword").
- **3D Asset Generation**: Generate 3D models (e.g., OBJ or GLB files) from text descriptions, with automatic image-to-model conversion.
- **MCP Integration**: Interact effortlessly with the tool via MCP-compatible clients like Claude Desktop.
- **File Management**: Automatically saves and organizes generated assets in your local filesystem for easy access and integration into projects.
- **Resource Templates**: Filter and access assets using dynamic URIs (e.g., `asset://{type}/{id}`) for efficient resource management.
- **Robust Input Validation**: Ensures secure and reliable processing with Zod schema validation.
- **Multi-Client Support**: Handles multiple simultaneous connections via enhanced SSE transport.
- **Secure Remote Access**: Offers optional HTTPS for safe communication with remote clients.
- **Extensible Backend**: Designed modularly for easy expansion to new models or features.
- **Cross-Platform**: Runs on Windows, macOS, and Linux with Node.js support.

---

## How It Works

The Game Asset Generator transforms text prompts into game-ready assets through an automated pipeline:

1. **User Input**: Provide a text prompt (e.g., "pixel art sword" or "isometric 3D castle").
2. **MCP Server**: Routes the prompt to the appropriate tool (`generate_2d_asset` or `generate_3d_asset`).
3. **AI Model Interaction**: 
   - 2D assets use "gokaygokay/Flux-2D-Game-Assets-LoRA."
   - 3D assets use "gokaygokay/Flux-Game-Assets-LoRA-v2" for images, then "TencentARC/InstantMesh" for 3D conversion.
4. **File Output**: Saves the asset (image for 2D, model file for 3D) locally.
5. **Response**: Returns the file path for immediate use.

Here's a visual overview:

```
User Prompt → MCP Server → AI Model(s) → Local File → File Path Response
```

---

## Prerequisites

- **Node.js**: Version 16 or higher (includes `npm`).
- **Git**: For cloning the repository.
- **Internet Access**: Needed to connect to Hugging Face Spaces APIs.
- **Hugging Face Account**: Required for API access; get your token from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
- **NPM Packages**:
  - `@gradio/client`: Interacts with Hugging Face Spaces.
  - `@modelcontextprotocol/sdk`: Implements the MCP server.
  - `dotenv`: Loads environment variables.
  - `express`: Enables SSE transport for remote access.
- **Optional**: Claude Desktop (or another MCP client) for enhanced interaction.

---

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/yourusername/game-asset-generator.git
   cd game-asset-generator
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Authentication (Required)**:
   ```bash
   cp .env.example .env
   # Edit .env with your Hugging Face API token and credentials
   ```

4. **Run the Server**:
   ```bash
   # Default (stdio transport)
   npm start
   # Custom working directory
   node index.js /path/to/directory
   # Remote access (SSE transport)
   node index.js --sse
   ```

> **Note**: This project uses ES modules (`"type": "module"` in `package.json`). If you encounter module-related errors, ensure you're using Node.js 16+ and that your environment supports ES modules. Run `node --version` to check.

---

## Usage

Interact with the server via an MCP client (e.g., Claude Desktop) or programmatically. Here are the main tools:

- **Generate a 2D Asset**:
  - **Purpose**: Creates a 2D image (e.g., PNG) from a text prompt.
  - **Command**: `generate_2d_asset prompt:"pixel art sword"`
  - **Output**: Saves a file like `2d_asset_generate_2d_asset_1698765432.png` and returns its path.

- **Generate a 3D Asset**:
  - **Purpose**: Produces a 3D model (e.g., OBJ/GLB) from a text prompt via a two-step process (image generation + conversion).
  - **Command**: `generate_3d_asset prompt:"isometric 3D castle"`
  - **Output**: Saves files like `3d_model_generate_3d_asset_1698765432.obj` and returns their paths.

With Claude Desktop, type these commands directly in the interface after configuration (see below).

---

## Configuration

Customize the server with these options:

- **Working Directory**: Set a custom save location:
  ```bash
  node index.js /path/to/directory
  ```

- **Hugging Face Authentication**: Required for API access, edit `.env`:
  ```plaintext
  HF_TOKEN=your_hf_token
  GRADIO_USERNAME=your_username
  GRADIO_PASSWORD=your_password
  ```

- **Transport Mode**:
  - **Stdio (default)**: Local use (e.g., with Claude Desktop).
  - **SSE**: Remote access:
    ```bash
    node index.js --sse  # HTTP
    node index.js --sse --https  # HTTPS (requires ssl/key.pem and ssl/cert.pem)
    ```

- **Claude Desktop Setup**: 
  1. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (MacOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
  2. Add:
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
  3. Restart Claude Desktop.

For detailed setup, see the [Claude Desktop MCP Guide](https://modelcontextprotocol.io/quickstart/user).

---

## File Management

- **Storage Location**: Assets are saved in `./assets` within the working directory by default.
- **Naming Convention**: Files use a prefix and timestamp (e.g., `2d_asset_generate_2d_asset_1698765432.png`).
- **Customization**: Change the storage location by setting a custom working directory:
  ```bash
  node index.js /path/to/custom/directory
  ```
- **Resource Access**: List and read assets via MCP with URIs like `asset://{type}/{id}`.

---

## MCP Integration

The Model Context Protocol (MCP) lets this tool act as a server for AI clients. MCP is a standard for connecting applications to AI models securely. Key features:
- **Tools**: `generate_2d_asset` and `generate_3d_asset`.
- **Resources**: Managed via `asset://` URIs.
- **Compatibility**: Works with Claude Desktop and other MCP clients.

---

## Troubleshooting

- **API Errors**: Check network or rate limits; see logs in `./logs/server.log`.
- **Authentication Issues**: Verify `.env` credentials.
- **ES Modules Error**: Use Node.js 16+ (`node --version`).
- **Logs**: View detailed logs:
  ```bash
  tail -f ./logs/server.log
  ```

---

## Advanced

### API Endpoints
The server interacts with these Hugging Face Spaces APIs (abstracted via MCP):

- **2D Asset Generation**: `mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA/predict`
- **3D Asset Image Generation**: `mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2/predict`
- **3D Model Conversion**: `TencentARC/InstantMesh/predict`

### Versioning
The Game Asset Generator follows semantic versioning (SemVer):
- **Current Version**: 0.1.0 (Initial Release)
- **MCP SDK Version**: 1.7.0
- **Version Format**: MAJOR.MINOR.PATCH
  - MAJOR: Breaking changes
  - MINOR: New features, backward compatible
  - PATCH: Bug fixes, backward compatible

The version is specified in:
- `package.json`: Project metadata
- `index.js`: MCP server initialization
- Health check endpoints: Both SSE and stdio transports

### Backend Architecture
Built with Node.js and ES modules:
- **index.js**: Core server logic and tool definitions.
- **Dependencies**: `@gradio/client`, `@modelcontextprotocol/sdk`, `zod`, `express`.
- **Security**: Zod validation, path traversal prevention, HTTPS support.

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