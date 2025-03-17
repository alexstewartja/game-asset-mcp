#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Client } from "@gradio/client";
import { promises as fs } from "fs";
import path from "path";
import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Logging function
async function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[INFO] ${timestamp} - ${message}`);
}

// Initialize MCP server
const server = new Server(
  { name: "game-asset-generator", version: "1.0.0" },
  {
    capabilities: {
      tools: true,
      resources: { list: true, read: true },
      prompts: true
    }
  }
);
// Allow working directory to be specified via command-line argument
const workDir = process.argv[2] || process.cwd();
await fs.mkdir(workDir, { recursive: true });

// Create a dedicated assets directory
const assetsDir = path.join(workDir, "assets");
await fs.mkdir(assetsDir, { recursive: true });

// Simple rate limiting
const rateLimits = new Map();
function checkRateLimit(clientId, limit = 10, windowMs = 60000) {
  const now = Date.now();
  const clientKey = clientId || 'default';
  
  if (!rateLimits.has(clientKey)) {
    rateLimits.set(clientKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  const clientLimit = rateLimits.get(clientKey);
  if (now > clientLimit.resetAt) {
    clientLimit.count = 1;
    clientLimit.resetAt = now + windowMs;
    return true;
  }
  
  if (clientLimit.count >= limit) {
    return false;
  }
  
  clientLimit.count++;
  return true;
}
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
// Get authentication credentials from environment variables
const gradioUsername = process.env.GRADIO_USERNAME;
const gradioPassword = process.env.GRADIO_PASSWORD;

// Authentication options
const authOptions = gradioUsername && gradioPassword
  ? { auth: [gradioUsername, gradioPassword] }
  : {};

// Connect to Hugging Face Spaces with authentication if credentials are provided
let client2D, client3D, clientInstantMesh;

try {
  await log("Connecting to 2D asset generation API...");
  client2D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA", authOptions);
  await log("Successfully connected to 2D asset generation API");
} catch (error) {
  await log(`Error connecting to 2D asset generation API: ${error.message}`);
  throw new Error("Failed to connect to 2D asset generation API. Check your credentials and network connection.");
}

try {
  await log("Connecting to 3D asset generation API...");
  client3D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2", authOptions);
  await log("Successfully connected to 3D asset generation API");
} catch (error) {
  await log(`Error connecting to 3D asset generation API: ${error.message}`);
  throw new Error("Failed to connect to 3D asset generation API. Check your credentials and network connection.");
}

try {
  await log("Connecting to InstantMesh API...");
  clientInstantMesh = await Client.connect("TencentARC/InstantMesh", authOptions);
  await log("Successfully connected to InstantMesh API");
} catch (error) {
  await log(`Error connecting to InstantMesh API: ${error.message}`);
  throw new Error("Failed to connect to InstantMesh API. Check your credentials and network connection.");
}

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
      
      try {
        // Generate 2D asset using the correct predict method and parameters
        // Note: The API docs show null as parameter, but we're assuming prompt is needed
        // This may need adjustment based on actual API behavior
        const apiResult = await client2D.predict("/predict", [prompt]);
        
        if (!apiResult || !apiResult.data || !apiResult.data.length) {
          throw new Error("No data returned from 2D asset generation API");
        }
        
        // Handle the response data - extract URL or blob
        const imageData = apiResult.data[0];
        let imageUrl;
        
        if (typeof imageData === 'object' && imageData.url) {
          imageUrl = imageData.url;
        } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
          imageUrl = imageData;
        } else {
          // If it's not a URL, it might be raw data
          const saveResult = await saveFileFromData(imageData, "2d_asset", "png", toolName);
          await log(`2D asset saved at: ${saveResult.filePath}`);
          return {
            content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
            isError: false
          };
        }
        
        // If we got a URL, save it
        const saveResult = await saveFileFromUrl(imageUrl, "2d_asset", "png", toolName);
        await log(`2D asset saved at: ${saveResult.filePath}`);
        return {
          content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
          isError: false
        };
      } catch (error) {
        await log(`Error generating 2D asset: ${error.message}`);
        throw new Error(`2D asset generation failed: ${error.message}`);
      }
    }

    if (toolName === TOOLS.GENERATE_3D_ASSET.name) {
      // Sanitize and validate prompt
      const prompt = sanitizePrompt(args.prompt);
      if (!prompt) {
        throw new Error("Invalid or empty prompt");
      }

      await log(`Generating 3D asset with prompt: "${prompt}"`);
      
      try {
        // Step 1: Generate 3D asset image using the correct predict method
        const imageResult = await client3D.predict("/predict", [prompt]);
        
        if (!imageResult || !imageResult.data || !imageResult.data.length) {
          throw new Error("No data returned from 3D image generation API");
        }
        
        // Handle the response data - extract URL or blob
        const imageData = imageResult.data[0];
        let imagePath;
        
        if (typeof imageData === 'object' && imageData.url) {
          const imageUrl = imageData.url;
          const saveResult = await saveFileFromUrl(imageUrl, "3d_image", "png", toolName);
          imagePath = saveResult.filePath;
        } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
          const saveResult = await saveFileFromUrl(imageData, "3d_image", "png", toolName);
          imagePath = saveResult.filePath;
        } else {
          // If it's not a URL, it might be raw data
          const saveResult = await saveFileFromData(imageData, "3d_image", "png", toolName);
          imagePath = saveResult.filePath;
        }
        
        await log(`3D image generated at: ${imagePath}`);
        
        // Step 2: Process the image with InstantMesh using the correct multi-step process
        
        // 2.1: Check if the image is valid
        await log("Validating image for 3D conversion...");
        const imageFile = await fs.readFile(imagePath);
        const checkResult = await clientInstantMesh.predict("/check_input_image", [
          new File([imageFile], path.basename(imagePath), { type: "image/png" })
        ]);
        
        // 2.2: Preprocess the image (with background removal)
        await log("Preprocessing image...");
        const preprocessResult = await clientInstantMesh.predict("/preprocess", [
          new File([imageFile], path.basename(imagePath), { type: "image/png" }),
          true // Remove background
        ]);
        
        if (!preprocessResult || !preprocessResult.data) {
          throw new Error("Image preprocessing failed");
        }
        
        // Save the preprocessed image
        const processedResult = await saveFileFromData(
          preprocessResult.data,
          "3d_processed",
          "png",
          toolName
        );
        const processedImagePath = processedResult.filePath;
        await log(`Preprocessed image saved at: ${processedImagePath}`);
        
        // 2.3: Generate multi-views
        await log("Generating multi-views...");
        const processedImageFile = await fs.readFile(processedImagePath);
        const mvsResult = await clientInstantMesh.predict("/generate_mvs", [
          new File([processedImageFile], path.basename(processedImagePath), { type: "image/png" }),
          50, // Sample steps (between 30 and 75)
          42  // Seed value
        ]);
        
        if (!mvsResult || !mvsResult.data) {
          throw new Error("Multi-view generation failed");
        }
        
        // Save the multi-view image
        const mvsResult2 = await saveFileFromData(
          mvsResult.data,
          "3d_multiview",
          "png",
          toolName
        );
        const mvsImagePath = mvsResult2.filePath;
        await log(`Multi-view image saved at: ${mvsImagePath}`);
        
        // 2.4: Generate 3D models (OBJ and GLB)
        await log("Generating 3D models...");
        const modelResult = await clientInstantMesh.predict("/make3d", []);
        
        if (!modelResult || !modelResult.data || !modelResult.data.length) {
          throw new Error("3D model generation failed");
        }
        
        // The API returns both OBJ and GLB formats
        const objModelData = modelResult.data[0];
        const glbModelData = modelResult.data[1];
        
        // Save both model formats
        const objResult = await saveFileFromData(objModelData, "3d_model", "obj", toolName);
        await log(`OBJ model saved at: ${objResult.filePath}`);
        
        const glbResult = await saveFileFromData(glbModelData, "3d_model", "glb", toolName);
        await log(`GLB model saved at: ${glbResult.filePath}`);
        
        return {
          content: [
            { type: "text", text: `3D models available at:\nOBJ: ${objResult.resourceUri}\nGLB: ${glbResult.resourceUri}` }
          ],
          isError: false
        };
      } catch (error) {
        await log(`Error generating 3D asset: ${error.message}`);
        throw new Error(`3D asset generation failed: ${error.message}`);
      }
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
  
  // Enhanced sanitization:
  // 1. Trim whitespace
  // 2. Remove potentially harmful characters (keeping alphanumeric, spaces, and basic punctuation)
  // 3. Limit length to 500 characters
  return prompt.trim()
    .replace(/[^\w\s.,!?-]/g, '')
    .slice(0, 500);
}

// Generate a unique filename to prevent conflicts
function generateUniqueFilename(prefix, ext, toolName) {
  const timestamp = Date.now();
  const uniqueId = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${toolName}_${timestamp}_${uniqueId}.${ext}`;
}

// Helper to get MIME type from filename
function getMimeType(filename) {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".obj")) return "model/obj";
  if (filename.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream"; // Default
}

// Helper to save files from URL
async function saveFileFromUrl(url, prefix, ext, toolName) {
  if (!url || typeof url !== 'string' || !url.startsWith("http")) {
    throw new Error("Invalid URL provided");
  }

  const filename = generateUniqueFilename(prefix, ext, toolName);
  const filePath = path.join(assetsDir, filename);
  
  // Security check: ensure file path is within assetsDir
  if (!filePath.startsWith(assetsDir)) {
    throw new Error("Invalid file path - security violation");
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
    
    // Return both the file path and the resource URI
    return {
      filePath,
      resourceUri: `asset://${filename}`
    };
  } catch (error) {
    await log(`Error saving file from URL: ${error.message}`);
    throw new Error("Failed to save file from URL");
  }
}

// Helper to save files from data (blob, base64, etc.)
async function saveFileFromData(data, prefix, ext, toolName) {
  if (!data) {
    throw new Error("No data provided to save");
  }

  const filename = generateUniqueFilename(prefix, ext, toolName);
  const filePath = path.join(assetsDir, filename);
  
  // Security check: ensure file path is within assetsDir
  if (!filePath.startsWith(assetsDir)) {
    throw new Error("Invalid file path - security violation");
  }

  try {
    // Handle different data types
    if (data instanceof Blob || data instanceof File) {
      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    } else if (typeof data === 'string') {
      // Check if it's base64 encoded
      if (data.match(/^data:[^;]+;base64,/)) {
        const base64Data = data.split(',')[1];
        await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
      } else {
        // Regular string data
        await fs.writeFile(filePath, data);
      }
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      // ArrayBuffer or TypedArray
      await fs.writeFile(filePath, Buffer.from(data));
    } else if (typeof data === 'object') {
      // JSON or other object
      await fs.writeFile(filePath, JSON.stringify(data));
    } else {
      // Fallback
      await fs.writeFile(filePath, Buffer.from(String(data)));
    }
    
    // Return both the file path and the resource URI
    return {
      filePath,
      resourceUri: `asset://${filename}`
    };
  } catch (error) {
    await log(`Error saving file from data: ${error.message}`);
    throw new Error("Failed to save file from data");
  }
}

// Resource listing (for file management)
server.setRequestHandler("resources/list", async () => {
  await log("Listing resources");
  
  try {
    const files = await fs.readdir(assetsDir, { withFileTypes: true });
    const resources = await Promise.all(
      files
        .filter(f => f.isFile())
        .map(async (file) => {
          const filePath = path.join(assetsDir, file.name);
          const stats = await fs.stat(filePath);
          
          return {
            uri: `asset://${file.name}`,
            name: file.name,
            mimetype: getMimeType(file.name),
            created: stats.ctime.toISOString(),
            size: stats.size,
            toolOrigin: file.name.split('_')[1] || 'unknown' // Extract tool name from filename
          };
        })
    );
    
    return { resources };
  } catch (error) {
    await log(`Error listing resources: ${error.message}`);
    return { resources: [] };
  }
});

// Resource read handler
server.setRequestHandler("resources/read", async (request) => {
  const uri = request.params.uri;
  await log(`Reading resource: ${uri}`);
  
  if (uri.startsWith("asset://")) {
    const filename = uri.replace("asset://", "");
    const filePath = path.join(assetsDir, filename);
    
    // Security check: ensure file path is within assetsDir
    if (!filePath.startsWith(assetsDir)) {
      throw new Error("Invalid resource path - security violation");
    }
    
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error("Not a file");
      }
      
      const data = await fs.readFile(filePath);
      const mimetype = getMimeType(filename);
      
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
        content: [{ type: "text", text: "Error reading resource" }],
        isError: true
      };
    }
  }
  
  throw new Error("Unsupported URI scheme");
});

// Prompt handlers
server.setRequestHandler("prompts/list", async () => {
  return {
    prompts: [
      {
        name: "generate_2d_sprite",
        description: "Generate a 2D sprite from a description",
        arguments: [{ name: "prompt", description: "Sprite description", required: true }]
      },
      {
        name: "generate_3d_model",
        description: "Generate a 3D model from a description",
        arguments: [{ name: "prompt", description: "Model description", required: true }]
      }
    ]
  };
});

server.setRequestHandler("prompts/get", async (request) => {
  const promptName = request.params.name;
  
  if (promptName === "generate_2d_sprite") {
    return {
      description: "Generate a 2D sprite",
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Generate a 2D sprite: ${request.params.arguments.prompt}` }
        }
      ]
    };
  }
  
  if (promptName === "generate_3d_model") {
    return {
      description: "Generate a 3D model",
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Generate a 3D model: ${request.params.arguments.prompt}` }
        }
      ]
    };
  }
  
  throw new Error("Prompt not found");
});

// Start the server
async function main() {
  // Check if we should use SSE transport (for remote access)
  const useSSE = process.argv.includes("--sse");
  
  if (useSSE) {
    // Setup Express server for SSE transport
    const app = express();
    const port = process.env.PORT || 3000;
    
    app.get("/sse", async (req, res) => {
      await log("SSE connection established");
      const transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });
    
    app.post("/messages", express.json(), async (req, res) => {
      const clientId = req.headers['x-client-id'] || 'anonymous';
      
      // Apply rate limiting
      if (!checkRateLimit(clientId)) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      
      await transport.handlePostMessage(req, res);
    });
    
    app.listen(port, () => {
      log(`MCP Game Asset Generator running with SSE transport on port ${port}`);
    });
  } else {
    // Use stdio transport for local access (e.g., Claude Desktop)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await log("MCP Game Asset Generator running with stdio transport");
  }
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});