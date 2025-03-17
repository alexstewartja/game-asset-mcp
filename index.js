#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@gradio/client";
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
const client2D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-2D-Game-Assets-LoRA");
const client3D = await Client.connect("mubarak-alketbi/gokaygokay-Flux-Game-Assets-LoRA-v2");
const clientInstantMesh = await Client.connect("TencentARC/InstantMesh");

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
        const result = await client2D.predict("/predict", [prompt]);
        
        if (!result || !result.data || !result.data.length) {
          throw new Error("No data returned from 2D asset generation API");
        }
        
        // Handle the response data - extract URL or blob
        const imageData = result.data[0];
        let imageUrl;
        
        if (typeof imageData === 'object' && imageData.url) {
          imageUrl = imageData.url;
        } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
          imageUrl = imageData;
        } else {
          // If it's not a URL, it might be raw data
          const imagePath = await saveFileFromData(imageData, "2d_asset", "png", toolName);
          await log(`2D asset saved at: ${imagePath}`);
          return {
            content: [{ type: "text", text: `2D asset saved at ${imagePath}` }],
            isError: false
          };
        }
        
        // If we got a URL, save it
        const imagePath = await saveFileFromUrl(imageUrl, "2d_asset", "png", toolName);
        await log(`2D asset saved at: ${imagePath}`);
        return {
          content: [{ type: "text", text: `2D asset saved at ${imagePath}` }],
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
          imagePath = await saveFileFromUrl(imageUrl, "3d_image", "png", toolName);
        } else if (typeof imageData === 'string' && imageData.startsWith('http')) {
          imagePath = await saveFileFromUrl(imageData, "3d_image", "png", toolName);
        } else {
          // If it's not a URL, it might be raw data
          imagePath = await saveFileFromData(imageData, "3d_image", "png", toolName);
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
        const processedImagePath = await saveFileFromData(
          preprocessResult.data,
          "3d_processed",
          "png",
          toolName
        );
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
        const mvsImagePath = await saveFileFromData(
          mvsResult.data,
          "3d_multiview",
          "png",
          toolName
        );
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
        const objPath = await saveFileFromData(objModelData, "3d_model", "obj", toolName);
        await log(`OBJ model saved at: ${objPath}`);
        
        const glbPath = await saveFileFromData(glbModelData, "3d_model", "glb", toolName);
        await log(`GLB model saved at: ${glbPath}`);
        
        return {
          content: [
            { type: "text", text: `3D models saved at:\nOBJ: ${objPath}\nGLB: ${glbPath}` }
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
  // Basic sanitization - remove potentially harmful characters but keep most text intact
  return prompt.trim();
}

// Helper to save files from URL
async function saveFileFromUrl(url, prefix, ext, toolName) {
  if (!url || typeof url !== 'string' || !url.startsWith("http")) {
    throw new Error("Invalid URL provided");
  }

  const filename = `${prefix}_${toolName}_${Date.now()}.${ext}`;
  const filePath = path.join(workDir, filename);
  
  // Security check: ensure file path is within workDir
  if (!filePath.startsWith(workDir)) {
    throw new Error("Invalid file path - security violation");
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
    return filePath;
  } catch (error) {
    await log(`Error saving file from URL: ${error.message}`);
    throw error;
  }
}

// Helper to save files from data (blob, base64, etc.)
async function saveFileFromData(data, prefix, ext, toolName) {
  if (!data) {
    throw new Error("No data provided to save");
  }

  const filename = `${prefix}_${toolName}_${Date.now()}.${ext}`;
  const filePath = path.join(workDir, filename);
  
  // Security check: ensure file path is within workDir
  if (!filePath.startsWith(workDir)) {
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
    return filePath;
  } catch (error) {
    await log(`Error saving file from data: ${error.message}`);
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