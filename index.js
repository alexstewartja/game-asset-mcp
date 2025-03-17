#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client as GradioClient, handle_file } from "@gradio/client";
import { promises as fs } from "fs";
import path from "path";

// Initialize MCP server
const server = new Server(
  { name: "game-asset-generator", version: "1.0.0" },
  { capabilities: { tools: {}, prompts: {}, resources: { list: true } } }
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

  try {
    if (toolName === TOOLS.GENERATE_2D_ASSET.name) {
      const prompt = args.prompt;

      // Generate 2D asset
      const result = await client2D.submit("/predict", { prompt });
      const imageUrl = result.data[0]?.url || result.data[0]; // Assuming image URL or blob
      const imagePath = await saveFileFromUrl(imageUrl, "2d_asset", "png", toolName);

      return {
        content: [{ type: "text", text: `2D asset saved at ${imagePath}` }],
        isError: false
      };
    }

    if (toolName === TOOLS.GENERATE_3D_ASSET.name) {
      const prompt = args.prompt;

      // Step 1: Generate 3D asset image
      const imageResult = await client3D.submit("/predict", { prompt });
      const imageUrl = imageResult.data[0]?.url || imageResult.data[0];
      const imagePath = await saveFileFromUrl(imageUrl, "3d_image", "png", toolName);

      // Step 2: Convert to 3D model with InstantMesh
      const modelResult = await clientInstantMesh.submit("/predict", {
        image: handle_file(imagePath) // Assuming /predict takes an image file
      });
      const modelUrl = modelResult.data[0]?.url || modelResult.data[0]; // OBJ or GLB
      const modelPath = await saveFileFromUrl(modelUrl, "3d_model", "obj", toolName);

      return {
        content: [{ type: "text", text: `3D model saved at ${modelPath}` }],
        isError: false
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Helper to save files from URL or data
async function saveFileFromUrl(urlOrData: string, prefix: string, ext: string, toolName: string): Promise<string> {
  const filename = `${prefix}_${toolName}_${Date.now()}.${ext}`;
  const filePath = path.join(workDir, filename);

  if (typeof urlOrData === "string" && urlOrData.startsWith("http")) {
    const response = await fetch(urlOrData);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
  } else {
    // Assume raw data (e.g., base64 or blob); adjust as needed
    await fs.writeFile(filePath, Buffer.from(urlOrData));
  }

  return filePath;
}

// Resource listing (optional, for file management)
server.setRequestHandler("resources/list", async () => {
  const files = await fs.readdir(workDir, { withFileTypes: true });
  const resources = await Promise.all(
    files.filter(f => f.isFile()).map(async (file) => ({
      uri: `file://${file.name}`,
      name: file.name,
      mimetype: file.name.endsWith(".png") ? "image/png" : "model/obj" // Simple MIME type guess
    }))
  );
  return { resources };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MCP Game Asset Generator running...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});