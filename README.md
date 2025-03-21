# Game Asset Generator using MCP and Hugging Face Spaces

This project is an innovative tool that simplifies game asset creation by harnessing AI-powered generation. Whether you're a game developer needing quick prototypes or an AI enthusiast exploring generative models, this tool lets you create 2D and 3D game assets from text prompts with ease. It integrates three AI models from Hugging Face Spaces—powered by "gokaygokay/Flux-2D-Game-Assets-LoRA," "gokaygokay/Flux-Game-Assets-LoRA-v2," and either "tencentARC/InstantMesh" or "tencent/Hunyuan3D-2" (which you'll need to duplicate to your account)—and uses the Model Context Protocol (MCP) for seamless interaction with AI assistants like Claude Desktop.

<p align="center">
  <a href="https://pay.ziina.com/MubarakHAlketbi">
    <img src="https://img.shields.io/badge/Support_Me-Donate-9626ff?style=for-the-badge&logo=https%3A%2F%2Fimgur.com%2FvwC39JY" alt="Support Me - Donate">
  </a>
  <a href="https://github.com/RooVetGit/Roo-Code">
    <img src="https://img.shields.io/badge/Built_With-Roo_Code-412894?style=for-the-badge" alt="Built With - Roo Code">
  </a>
  <br>
  <a href="https://glama.ai/mcp/servers/@MubarakHAlketbi/game-asset-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@MubarakHAlketbi/game-asset-mcp/badge" />
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
The **Game Asset Generator** (version 0.2.0) is an innovative tool that simplifies game asset creation by harnessing AI-powered generation. Whether you're a game developer needing quick prototypes or an AI enthusiast exploring generative models, this tool lets you create 2D and 3D game assets from text prompts with ease. It integrates AI models from Hugging Face—powered by "gokaygokay/Flux-2D-Game-Assets-LoRA," "gokaygokay/Flux-Game-Assets-LoRA-v2," and either "tencentARC/InstantMesh" or "tencent/Hunyuan3D-2" (which you'll need to duplicate to your account)—and uses the Model Context Protocol (MCP) for seamless interaction with AI assistants like Claude Desktop. This release integrates with MCP using the TypeScript SDK version 1.7.0 and supports both 2D and 3D asset generation with improved Hunyuan3D integration.

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
   - **2D Assets**: Uses the Hugging Face Inference API with "gokaygokay/Flux-2D-Game-Assets-LoRA" model.
   - **3D Assets**:
     - First generates an image using the Hugging Face Inference API with "gokaygokay/Flux-Game-Assets-LoRA-v2" model.
     - Then converts the image to a 3D model using either:
       - **InstantMesh**: A multi-step process with preprocessing (/preprocess), multi-view generation (/generate_mvs), and 3D model creation (/make3d).
       - **Hunyuan3D-2**: A streamlined process using the /generation_all endpoint for direct 3D model generation with optimized parameters (20 steps instead of 50).
4. **File Output**: Saves the asset (image for 2D, OBJ and GLB files for 3D) locally in the assets directory.
5. **Response**: Returns the resource URI (e.g., `asset://3d_model/filename.glb`) for immediate use.

Here's a visual overview:

```
User Prompt → MCP Server → AI Model(s) → Local File → Resource URI Response
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
   git clone https://github.com/yourusername/game-asset-mcp.git
   cd game-asset-mcp
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
  - **Output**: Saves a file like `2d_asset_generate_2d_asset_1698765432.png` and returns its resource URI.
  - **Enhancement**: The system automatically enhances your prompt with "high detailed, complete object, not cut off, white solid background" for better results.

- **Generate a 3D Asset**:
  - **Purpose**: Produces 3D models (both OBJ and GLB formats) from a text prompt.
  - **Command**: `generate_3d_asset prompt:"isometric 3D castle"`
  - **Process**:
    - First generates a 2D image from your prompt
    - Then converts it to 3D using either InstantMesh or Hunyuan3D-2 (based on your MODEL_SPACE setting)
    - For long-running operations, provides immediate feedback with operation ID and status updates
  - **Output**: Saves multiple files (including the intermediate 2D image, processed image, and final 3D models) and returns their resource URIs.
  - **Enhancement**: The system automatically enhances your prompt and uses optimized parameters for better results.

You can also use prompts for more natural interaction:
- `generate_2d_sprite prompt:"pixel art sword"`
- `generate_3d_model prompt:"isometric 3D castle"`

With Claude Desktop, type these commands directly in the interface after configuration (see below).

---

## Configuration

Customize the server with these options:

- **Working Directory**: Set a custom save location:
  ```bash
  node index.js /path/to/directory
  ```

- **Hugging Face Authentication and Model Space**: Required for API access, edit `.env`:
  ```plaintext
  # Required for all API access
  HF_TOKEN=your_hf_token

  # Choose which 3D model space to use (must be duplicated to your account)
  MODEL_SPACE=your-username/InstantMesh
  # OR
  MODEL_SPACE=your-username/Hunyuan3D-2
  
  # Optional: Port for SSE transport (default: 3000)
  PORT=3000
  ```
  
  The server uses HF token authentication for all Hugging Face services, including:
  - Hugging Face Inference API for 2D and 3D image generation
  - Your duplicated space (InstantMesh or Hunyuan3D-2) for 3D model conversion
  
  **IMPORTANT**: You must duplicate one of the following spaces to your Hugging Face account:
  - Option 1: [InstantMesh Space](https://huggingface.co/spaces/tencentARC/InstantMesh)
  - Option 2: [Hunyuan3D-2 Space](https://huggingface.co/spaces/tencent/Hunyuan3D-2)
  
  The application will automatically detect which space you've duplicated based on the available endpoints.

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

### API Endpoints and Integration
The server interacts with these Hugging Face services:

- **2D Asset Generation**: Uses the Hugging Face Inference API with model `gokaygokay/Flux-2D-Game-Assets-LoRA` with 50 inference steps
- **3D Asset Image Generation**: Uses the Hugging Face Inference API with model `gokaygokay/Flux-Game-Assets-LoRA-v2` with 50 inference steps
- **3D Model Conversion**: Uses one of two options based on your MODEL_SPACE setting:
  - **InstantMesh**: Uses a multi-step process with these endpoints:
    - `/check_input_image`: Validates the input image
    - `/preprocess`: Removes background and prepares the image
    - `/generate_mvs`: Creates multi-view images with 75 sample steps and seed value 42
    - `/make3d`: Generates the final 3D models (OBJ and GLB)
  - **Hunyuan3D-2**: Uses a streamlined process with:
    - `/generation_all`: Directly generates 3D models from the input image
    - Uses optimized parameters (20 steps, guidance_scale 5.5, seed 1234, octree_resolution "256", and background removal) for faster processing without quality loss

### Versioning
The Game Asset Generator follows semantic versioning (SemVer):
- **Current Version**: 0.2.0 (Hunyuan3D Integration)
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
- **index.js**: Core server logic and tool definitions
- **Dependencies**:
  - `@gradio/client`: For Hugging Face Spaces interaction
  - `@huggingface/inference`: For direct model inference
  - `@modelcontextprotocol/sdk`: For MCP server implementation
  - `zod`: For schema validation and input sanitization
  - `express`: For SSE transport
  - `dotenv`: For environment variable loading
- **Security**: Zod validation, path traversal prevention, HTTPS support, rate limiting
- **Performance**: Asynchronous processing, retry mechanism with exponential backoff, GPU quota handling

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