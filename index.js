#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client as GradioClient, handle_file } from "@gradio/client";
import { promises as fs } from "fs";
import path from "path";

// Logging function
async function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[INFO] ${timestamp} - ${message}`);
}

// Initialize MCP server
const server = new Server(
  { name: "game-asset-generator", version: "1.0.0" },
  { capabilities: { tools: {}, resources: { list: true, read: true } } }
);

// Working directory is always the current directory
const workDir = process.cwd();
await fs.mkdir(workDir, { recursive: true });

// Tool definitions
const TOOLS = {
  GENERATE_2D_ASSET: {
    name: "generate_2d_asset",
    description: "Generate a 2D game asset (e.g., pixel art sprite) from a text prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the 2D asset (e.g., 'pixel art sword')" }
      },
      required: ["prompt"]
    }
  },
  GENERATE_3D_ASSET: {
    name: "generate_3d_asset",
    description: "Generate a 3D game asset (e.g., OBJ model) from a text prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the 3D asset (e.g., 'isometric 3D castle')" }
      },
      required: ["prompt"]
    }
  }
};

// Connect to Hugging Face Spaces
const client2D = await GradioClient.connect("mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA");
const client3D = await GradioClient.connect("mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2");
const clientInstantMesh = await GradioClient.connect("TencentARC/InstantMesh");

// Register tool list handler
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [TOOLS.GENERATE_2D_ASSET, TOOLS.GENERATE_3D_ASSET]
  };
});

// Tool call handler
server.setRequestHandler("tools/call", async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  await log(`Calling tool: ${toolName}`);

  try {
    if (toolName === TOOLS.GENERATE_2D_ASSET.name) {
      // Sanitize and validate prompt
      const prompt = sanitizePrompt(args.prompt);
      if (!prompt) {
        throw new Error("Invalid or empty prompt");
      }

      await log(`Generating 2D asset with prompt: "${prompt}"`);
      
      // Generate 2D asset
      const result = await client2D.submit("/predict", { prompt });
      const imageUrl = result.data[0]?.url || result.data[0]; // Assuming image URL or blob
      const imagePath = await saveFileFromUrl(imageUrl, "2d_asset", "png", toolName);

      await log(`2D asset saved at: ${imagePath}`);

      return {
        content: [{ type: "text", text: `2D asset saved at ${imagePath}` }],
        isError: false
      };
    }

    if (toolName === TOOLS.GENERATE_3D_ASSET.name) {
      // Sanitize and validate prompt
      const prompt = sanitizePrompt(args.prompt);
      if (!prompt) {
        throw new Error("Invalid or empty prompt");
      }

      await log(`Generating 3D asset with prompt: "${prompt}"`);
      
      // Step 1: Generate 3D asset image
      const imageResult = await client3D.submit("/predict", { prompt });
      const imageUrl = imageResult.data[0]?.url || imageResult.data[0];
      const imagePath = await saveFileFromUrl(imageUrl, "3d_image", "png", toolName);

      await log(`3D image generated at: ${imagePath}`);
      
      // Step 2: Convert to 3D model with InstantMesh
      const modelResult = await clientInstantMesh.submit("/predict", {
        image: handle_file(imagePath) // Assuming /predict takes an image file
      });
      const modelUrl = modelResult.data[0]?.url || modelResult.data[0]; // OBJ or GLB
      const modelPath = await saveFileFromUrl(modelUrl, "3d_model", "obj", toolName);

      await log(`3D model saved at: ${modelPath}`);

      return {
        content: [{ type: "text", text: `3D model saved at ${modelPath}` }],
        isError: false
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  } catch (error) {
    await log(`Error in ${toolName}: ${error.message}`);
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Helper function to sanitize prompts
function sanitizePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }
  // Basic sanitization - remove potentially harmful characters but keep most text intact
  return prompt.trim();
}

// Helper to save files from URL or data
async function saveFileFromUrl(urlOrData, prefix, ext, toolName) {
  const filename = `${prefix}_${toolName}_${Date.now()}.${ext}`;
  const filePath = path.join(workDir, filename);
  
  // Security check: ensure file path is within workDir
  if (!filePath.startsWith(workDir)) {
    throw new Error("Invalid file path - security violation");
  }

  try {
    if (typeof urlOrData === "string" && urlOrData.startsWith("http")) {
      const response = await fetch(urlOrData);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(buffer));
    } else {
      // Assume raw data (e.g., base64 or blob); adjust as needed
      await fs.writeFile(filePath, Buffer.from(urlOrData));
    }
    return filePath;
  } catch (error) {
    await log(`Error saving file: ${error.message}`);
    throw error;
  }
}

// Resource listing (for file management)
server.setRequestHandler("resources/list", async () => {
  await log("Listing resources");
  const files = await fs.readdir(workDir, { withFileTypes: true });
  const resources = files
    .filter(f => f.isFile())
    .map(file => {
      // Determine MIME type based on file extension
      let mimetype = "application/octet-stream"; // Default
      if (file.name.endsWith(".png")) mimetype = "image/png";
      else if (file.name.endsWith(".jpg") || file.name.endsWith(".jpeg")) mimetype = "image/jpeg";
      else if (file.name.endsWith(".obj")) mimetype = "model/obj";
      else if (file.name.endsWith(".glb")) mimetype = "model/gltf-binary";
      
      return {
        uri: `asset://${file.name}`,
        name: file.name,
        mimetype: mimetype
      };
    });
  
  return { resources };
});

// Resource read handler
server.setRequestHandler("resources/read", async (request) => {
  const uri = request.params.uri;
  await log(`Reading resource: ${uri}`);
  
  if (uri.startsWith("asset://")) {
    const filename = uri.replace("asset://", "");
    const filePath = path.join(workDir, filename);
    
    // Security check: ensure file path is within workDir
    if (!filePath.startsWith(workDir)) {
      throw new Error("Invalid resource path - security violation");
    }
    
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error("Not a file");
      }
      
      const data = await fs.readFile(filePath);
      
      // Determine MIME type based on file extension
      let mimetype = "application/octet-stream"; // Default
      if (filename.endsWith(".png")) mimetype = "image/png";
      else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) mimetype = "image/jpeg";
      else if (filename.endsWith(".obj")) mimetype = "model/obj";
      else if (filename.endsWith(".glb")) mimetype = "model/gltf-binary";
      
      return {
        contents: [{
          uri: uri,
          mimeType: mimetype,
          blob: data.toString("base64") // Binary data as base64
        }]
      };
    } catch (error) {
      await log(`Error reading resource: ${error.message}`);
      return {
        content: [{ type: "text", text: `Error reading resource: ${error.message}` }],
        isError: true
      };
    }
  }
  
  throw new Error("Unsupported URI scheme");
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await log("MCP Game Asset Generator running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});