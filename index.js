#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@gradio/client";
import { promises as fs } from "fs";
import path from "path";
import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { z } from "zod";
import https from "https";

// Load environment variables from .env file
dotenv.config();

// Allow working directory to be specified via command-line argument
const workDir = process.argv[2] || process.cwd();

// Logging function with file output
async function log(level = 'INFO', message) {
  // If only one parameter is provided, assume it's the message
  if (!message) {
    message = level;
    level = 'INFO';
  }
  
  const timestamp = new Date().toISOString();
  const logMessage = `[${level.toUpperCase()}] ${timestamp} - ${message}\n`;
  
  // Log to console
  console.error(logMessage.trim());
  
  // Log to file
  try {
    const logDir = path.join(workDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, 'server.log');
    await fs.appendFile(logFile, logMessage);
  } catch (err) {
    console.error(`Failed to write to log file: ${err}`);
  }
}

// Initialize MCP server
const server = new Server(
  { name: "game-asset-generator", version: "1.0.0" },
  {
    capabilities: {
      tools: { list: true, call: true },
      resources: { list: true, read: true },
      prompts: { list: true, get: true }
    }
  }
);
// Create working directory if it doesn't exist
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

// Define Zod schemas for input validation
const schema2D = z.object({
  prompt: z.string().min(1).max(500).transform(val => sanitizePrompt(val))
});

const schema3D = z.object({
  prompt: z.string().min(1).max(500).transform(val => sanitizePrompt(val))
});

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
  await log('INFO', "Connecting to 2D asset generation API...");
  client2D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA", authOptions);
  await log('INFO', "Successfully connected to 2D asset generation API");
} catch (error) {
  await log('ERROR', `Error connecting to 2D asset generation API: ${error.message}`);
  throw new Error("Failed to connect to 2D asset generation API. Check your credentials and network connection.");
}

try {
  await log('INFO', "Connecting to 3D asset generation API...");
  client3D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2", authOptions);
  await log('INFO', "Successfully connected to 3D asset generation API");
} catch (error) {
  await log('ERROR', `Error connecting to 3D asset generation API: ${error.message}`);
  throw new Error("Failed to connect to 3D asset generation API. Check your credentials and network connection.");
}

try {
  await log('INFO', "Connecting to InstantMesh API...");
  clientInstantMesh = await Client.connect("TencentARC/InstantMesh", authOptions);
  await log('INFO', "Successfully connected to InstantMesh API");
} catch (error) {
  await log('ERROR', `Error connecting to InstantMesh API: ${error.message}`);
  throw new Error("Failed to connect to InstantMesh API. Check your credentials and network connection.");
}

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [TOOLS.GENERATE_2D_ASSET, TOOLS.GENERATE_3D_ASSET]
  };
});

// Tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  await log('INFO', `Calling tool: ${toolName}`);

  try {
    if (toolName === TOOLS.GENERATE_2D_ASSET.name) {
      const { prompt } = schema2D.parse(args);
      if (!prompt) {
        throw new Error("Invalid or empty prompt");
      }
      await log('INFO', `Generating 2D asset with prompt: "${prompt}"`);
      
      const apiResult = await client2D.predict("/predict", [prompt]);
      if (!apiResult || !apiResult.data || !apiResult.data.length) {
        throw new Error("No data returned from 2D asset generation API");
      }
      
      const imageData = apiResult.data[0];
      let imageUrl;
      if (typeof imageData === 'object' && imageData.url) {
        imageUrl = imageData.url;
      } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
        imageUrl = imageData;
      } else {
        const saveResult = await saveFileFromData(imageData, "2d_asset", "png", toolName);
        await log('INFO', `2D asset saved at: ${saveResult.filePath}`);
        return {
          content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
          isError: false
        };
      }
      
      const saveResult = await saveFileFromUrl(imageUrl, "2d_asset", "png", toolName);
      await log('INFO', `2D asset saved at: ${saveResult.filePath}`);
      return {
        content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
        isError: false
      };
    }

    if (toolName === TOOLS.GENERATE_3D_ASSET.name) {
      const { prompt } = schema3D.parse(args);
      if (!prompt) {
        throw new Error("Invalid or empty prompt");
      }
      await log('INFO', `Generating 3D asset with prompt: "${prompt}"`);
      
      const imageResult = await client3D.predict("/predict", [prompt]);
      if (!imageResult || !imageResult.data || !imageResult.data.length) {
        throw new Error("No data returned from 3D image generation API");
      }
      
      const imageData = imageResult.data[0];
      let imagePath;
      if (typeof imageData === 'object' && imageData.url) {
        const saveResult = await saveFileFromUrl(imageData.url, "3d_image", "png", toolName);
        imagePath = saveResult.filePath;
      } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
        const saveResult = await saveFileFromUrl(imageData, "3d_image", "png", toolName);
        imagePath = saveResult.filePath;
      } else {
        const saveResult = await saveFileFromData(imageData, "3d_image", "png", toolName);
        imagePath = saveResult.filePath;
      }
      await log('INFO', `3D image generated at: ${imagePath}`);
      
      // Step 2: Process the image with InstantMesh using the correct multi-step process
      
      // 2.1: Check if the image is valid
      await log('DEBUG', "Validating image for 3D conversion...");
      const imageFile = await fs.readFile(imagePath);
      const checkResult = await clientInstantMesh.predict("/check_input_image", [
        new File([imageFile], path.basename(imagePath), { type: "image/png" })
      ]);
      
      // 2.2: Preprocess the image (with background removal)
      await log('DEBUG', "Preprocessing image...");
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
      await log('INFO', `Preprocessed image saved at: ${processedImagePath}`);
      
      // 2.3: Generate multi-views
      await log('DEBUG', "Generating multi-views...");
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
      await log('INFO', `Multi-view image saved at: ${mvsImagePath}`);
      
      // 2.4: Generate 3D models (OBJ and GLB)
      await log('DEBUG', "Generating 3D models...");
      const modelResult = await clientInstantMesh.predict("/make3d", []);
      
      if (!modelResult || !modelResult.data || !modelResult.data.length) {
        throw new Error("3D model generation failed");
      }
      
      // The API returns both OBJ and GLB formats
      const objModelData = modelResult.data[0];
      const glbModelData = modelResult.data[1];
      
      // Save both model formats
      const objResult = await saveFileFromData(objModelData, "3d_model", "obj", toolName);
      await log('INFO', `OBJ model saved at: ${objResult.filePath}`);
      
      const glbResult = await saveFileFromData(glbModelData, "3d_model", "glb", toolName);
      await log('INFO', `GLB model saved at: ${glbResult.filePath}`);
      
      return {
        content: [
          { type: "text", text: `3D models available at:\nOBJ: ${objResult.resourceUri}\nGLB: ${glbResult.resourceUri}` }
        ],
        isError: false
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  } catch (error) {
    await log('ERROR', `Error in ${toolName}: ${error.message}`);
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

// Parse resource URI templates
function parseResourceUri(uri) {
  // Support for templated URIs like asset://{type}/{id}
  const match = uri.match(/^asset:\/\/(?:([^\/]+)\/)?(.+)$/);
  if (!match) return null;
  
  const [, type, id] = match;
  return { type, id };
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
    await log('ERROR', `Error saving file from URL: ${error.message}`);
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
    await log('ERROR', `Error saving file from data: ${error.message}`);
    throw new Error("Failed to save file from data");
  }
}

// Resource listing (for file management)
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  await log('INFO', "Listing resources");
  
  try {
    // Check if there's a filter in the request
    const uriTemplate = request.params?.uriTemplate;
    let typeFilter = null;
    
    if (uriTemplate) {
      const templateMatch = uriTemplate.match(/^asset:\/\/([^\/]+)\/.*$/);
      if (templateMatch) {
        typeFilter = templateMatch[1];
        await log('INFO', `Filtering resources by type: ${typeFilter}`);
      }
    }
    
    const files = await fs.readdir(assetsDir, { withFileTypes: true });
    const resources = await Promise.all(
      files
        .filter(f => f.isFile())
        .map(async (file) => {
          const filePath = path.join(assetsDir, file.name);
          const stats = await fs.stat(filePath);
          const filenameParts = file.name.split('_');
          const assetType = filenameParts[0] || 'unknown';
          const toolOrigin = filenameParts[1] || 'unknown';
          
          // Create a structured URI that includes the type
          const uri = `asset://${assetType}/${file.name}`;
          
          return {
            uri,
            name: file.name,
            mimetype: getMimeType(file.name),
            created: stats.ctime.toISOString(),
            size: stats.size,
            toolOrigin,
            assetType
          };
        })
    );
    
    // Apply type filter if specified
    const filteredResources = typeFilter
      ? resources.filter(r => r.assetType === typeFilter)
      : resources;
    
    return { resources: filteredResources };
  } catch (error) {
    await log('ERROR', `Error listing resources: ${error.message}`);
    return { resources: [] };
  }
});

// Resource read handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  await log('INFO', `Reading resource: ${uri}`);
  
  if (uri.startsWith("asset://")) {
    // Parse the URI to handle templated URIs
    const parsedUri = parseResourceUri(uri);
    
    if (!parsedUri) {
      throw new Error("Invalid resource URI format");
    }
    
    // For templated URIs like asset://{type}/{id}, the filename is in the id part
    // For traditional URIs like asset://filename, the id is the filename
    const filename = parsedUri.type && parsedUri.id.includes('/')
      ? parsedUri.id
      : (parsedUri.type ? `${parsedUri.type}/${parsedUri.id}` : parsedUri.id);
    
    // Remove any type prefix if it exists
    const actualFilename = filename.includes('/') ? filename.split('/').pop() : filename;
    const filePath = path.join(assetsDir, actualFilename);
    
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
      const mimetype = getMimeType(actualFilename);
      
      return {
        contents: [{
          uri: uri,
          mimeType: mimetype,
          blob: data.toString("base64") // Binary data as base64
        }]
      };
    } catch (error) {
      await log('ERROR', `Error reading resource: ${error.message}`);
      return {
        content: [{ type: "text", text: "Error reading resource" }],
        isError: true
      };
    }
  }
  
  throw new Error("Unsupported URI scheme");
});

// Resource templates handler
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    templates: [
      {
        uriTemplate: "asset://{type}/{id}",
        name: "Generated Asset",
        description: "Filter assets by type and ID"
      }
    ]
  };
});

// Prompt handlers
server.setRequestHandler(ListPromptsRequestSchema, async () => {
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

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
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
  const useHttps = process.argv.includes("--https");
  
  if (useSSE) {
    // Setup Express server for SSE transport
    const app = express();
    const port = process.env.PORT || 3000;
    
    // Store transports by client ID for multi-connection support
    const transports = new Map();
    
    app.get("/sse", async (req, res) => {
      const clientId = req.query.clientId || crypto.randomUUID();
      await log('INFO', `SSE connection established for client: ${clientId}`);
      
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Create a new transport for this client
      const transport = new SSEServerTransport("/messages", res);
      transports.set(clientId, transport);
      
      // Handle client disconnect
      req.on('close', () => {
        transports.delete(clientId);
        log('INFO', `Client ${clientId} disconnected`);
      });
      
      await server.connect(transport);
      
      // Send initial connection confirmation
      res.write(`data: ${JSON.stringify({ connected: true, clientId })}\n\n`);
    });
    
    app.post("/messages", express.json(), async (req, res) => {
      const clientId = req.headers['x-client-id'] || 'anonymous';
      
      // Apply rate limiting
      if (!checkRateLimit(clientId)) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      
      // Get the transport for this client
      const transport = transports.get(clientId);
      if (!transport) {
        res.status(404).json({ error: "Client not connected" });
        return;
      }
      
      await transport.handlePostMessage(req, res);
    });
    
    // Use HTTPS if requested
    if (useHttps) {
      try {
        // Check for SSL certificate files
        const sslDir = path.join(process.cwd(), 'ssl');
        const keyPath = path.join(sslDir, 'key.pem');
        const certPath = path.join(sslDir, 'cert.pem');
        
        // Create ssl directory if it doesn't exist
        await fs.mkdir(sslDir, { recursive: true });
        
        // Check if SSL files exist, if not, generate self-signed certificate
        let key, cert;
        try {
          key = await fs.readFile(keyPath);
          cert = await fs.readFile(certPath);
          await log('INFO', "Using existing SSL certificates");
        } catch (error) {
          await log('WARN', "SSL certificates not found, please create them manually");
          await log('INFO', "You can generate self-signed certificates with:");
          await log('INFO', "openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes");
          throw new Error("SSL certificates required for HTTPS");
        }
        
        const httpsServer = https.createServer({ key, cert }, app);
        httpsServer.listen(port, () => {
          log('INFO', `MCP Game Asset Generator running with HTTPS SSE transport on port ${port}`);
        });
      } catch (error) {
        await log('ERROR', `HTTPS setup failed: ${error.message}`);
        await log('WARN', "Falling back to HTTP");
        app.listen(port, () => {
          log('INFO', `MCP Game Asset Generator running with HTTP SSE transport on port ${port}`);
        });
      }
    } else {
      // Standard HTTP server
      app.listen(port, () => {
        log('INFO', `MCP Game Asset Generator running with HTTP SSE transport on port ${port}`);
      });
    }
  } else {
    // Use stdio transport for local access (e.g., Claude Desktop)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await log('INFO', "MCP Game Asset Generator running with stdio transport");
  }
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});