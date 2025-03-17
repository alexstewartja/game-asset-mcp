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
import { InferenceClient } from "@huggingface/inference";
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

// Enhanced logging with operation ID for tracking long-running operations
let operationCounter = 0;
// Global object to store operation updates that can be accessed by clients
global.operationUpdates = {};

// Function to notify clients that the resource list has changed
async function notifyResourceListChanged() {
  await log('DEBUG', "Notifying clients of resource list change");
  await server.notification({ method: "notifications/resources/list_changed" });
  
  // For SSE transport, notify all connected clients
  if (global.transports && global.transports.size > 0) {
    for (const [clientId, transport] of global.transports) {
      try {
        await transport.sendNotification({ method: "notifications/resources/list_changed" });
        await log('DEBUG', `Sent resource list change notification to client ${clientId}`);
      } catch (error) {
        await log('ERROR', `Failed to send notification to client ${clientId}: ${error.message}`);
      }
    }
  }
}

async function logOperation(toolName, operationId, status, details = {}) {
  const level = status === 'ERROR' ? 'ERROR' : 'INFO';
  const detailsStr = Object.entries(details)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  
  const logMessage = `Operation ${operationId} [${toolName}] - ${status}${detailsStr ? ' - ' + detailsStr : ''}`;
  await log(level, logMessage);
  
  // Store the update in the global object for potential client access
  if (!global.operationUpdates[operationId]) {
    global.operationUpdates[operationId] = [];
  }
  
  global.operationUpdates[operationId].push({
    status: status,
    details: details,
    timestamp: new Date().toISOString(),
    message: logMessage
  });
  
  // Limit the size of the updates array to prevent memory issues
  if (global.operationUpdates[operationId].length > 100) {
    global.operationUpdates[operationId].shift(); // Remove the oldest update
  }
}

// Retry function with exponential backoff
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 5000) {
  let retries = 0;
  let delay = initialDelay;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      
      // Check if we've exceeded the maximum number of retries
      if (retries > maxRetries) {
        throw error;
      }
      
      // Check if the error is due to GPU quota
      const gpuQuotaMatch = error.message?.match(/exceeded your GPU quota.*Please retry in (\d+):(\d+):(\d+)/);
      if (gpuQuotaMatch) {
        const hours = parseInt(gpuQuotaMatch[1]) || 0;
        const minutes = parseInt(gpuQuotaMatch[2]) || 0;
        const seconds = parseInt(gpuQuotaMatch[3]) || 0;
        const waitTime = (hours * 3600 + minutes * 60 + seconds) * 1000;
        
        const waitTimeSeconds = Math.ceil(waitTime/1000);
        const waitMessage = `GPU quota exceeded. Waiting for ${waitTimeSeconds} seconds before retry ${retries}/${maxRetries}`;
        await log('WARN', waitMessage);
        
        // If this is part of a 3D asset generation operation, we could update the client here
        // This would require a mechanism to send updates to the client
        if (global.operationUpdates && global.operationUpdates[operationId]) {
          global.operationUpdates[operationId].push({
            status: "WAITING",
            message: waitMessage,
            retryCount: retries,
            maxRetries: maxRetries,
            waitTime: waitTimeSeconds,
            timestamp: new Date().toISOString()
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000)); // Add 1 second buffer
      } else {
        // For other errors, use exponential backoff
        await log('WARN', `Operation failed: ${error.message}. Retrying in ${delay/1000} seconds (${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }
}

// Define MCP Error Codes
const MCP_ERROR_CODES = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ParseError: -32700
};

// Initialize MCP server
const server = new Server(
  { name: "game-asset-generator", version: "0.1.0" }, // Updated to version 0.1.0
  {
    capabilities: {
      tools: { list: true, call: true },
      resources: { list: true, read: true, listChanged: true }, // Added listChanged capability
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
const hfToken = process.env.HF_TOKEN;

// Authentication options for Gradio
const authOptions = gradioUsername && gradioPassword
  ? { auth: [gradioUsername, gradioPassword] }
  : {};

// Connect to Hugging Face Spaces and Inference API
let clientInstantMesh;
let inferenceClient;

// Initialize Hugging Face Inference Client for 2D and 3D asset generation
if (!hfToken) {
  await log('ERROR', "HF_TOKEN is required in the .env file for 2D and 3D asset generation");
  throw new Error("HF_TOKEN is required in the .env file for 2D and 3D asset generation");
}

try {
  await log('INFO', "Initializing Hugging Face Inference Client...");
  inferenceClient = new InferenceClient(hfToken);
  await log('INFO', "Successfully initialized Hugging Face Inference Client");
} catch (error) {
  await log('ERROR', `Error initializing Hugging Face Inference Client: ${error.message}`);
  throw new Error("Failed to initialize Hugging Face Inference Client. Check your HF_TOKEN.");
}

// Connect to InstantMesh API using Gradio client (this one works correctly)
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
      
      // Use the Hugging Face Inference API to generate the image
      await log('DEBUG', "Calling Hugging Face Inference API for 2D asset generation...");
      // Enhance the prompt to specify high detail, complete object, and white background
      const enhancedPrompt = `${prompt}, high detailed, complete object, not cut off, white solid background`;
      await log('DEBUG', `Enhanced 2D prompt: "${enhancedPrompt}"`);
      
      const image = await inferenceClient.textToImage({
        model: "gokaygokay/Flux-2D-Game-Assets-LoRA",
        inputs: enhancedPrompt,
        parameters: { num_inference_steps: 50 },
        provider: "hf-inference",
      });
      
      if (!image) {
        throw new Error("No image returned from 2D asset generation API");
      }
      
      // Save the image (which is a Blob) and notify clients of resource change
      const saveResult = await saveFileFromData(image, "2d_asset", "png", toolName);
      await log('INFO', `2D asset saved at: ${saveResult.filePath}`);
      
      // Notify clients that a new resource is available
      await notifyResourceListChanged();
      
      return {
        content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
        isError: false
      };
    }

    if (toolName === TOOLS.GENERATE_3D_ASSET.name) {
      const operationId = `3D-${++operationCounter}`;
      await logOperation(toolName, operationId, 'STARTED');
      
      try {
        const { prompt } = schema3D.parse(args);
        if (!prompt) {
          throw new Error("Invalid or empty prompt");
        }
        await log('INFO', `Generating 3D asset with prompt: "${prompt}"`);
        await logOperation(toolName, operationId, 'PROCESSING', { step: 'Parsing prompt', prompt });
        
        // Initial response to prevent timeout with more detailed information
        const initialResponse = {
          content: [
            {
              type: "text",
              text: `Starting 3D asset generation (Operation ID: ${operationId})...\n\n` +
                    `This process involves several steps:\n` +
                    `1. Generating initial 3D image from prompt\n` +
                    `2. Validating image for 3D conversion\n` +
                    `3. Preprocessing image (removing background)\n` +
                    `4. Generating multi-view images\n` +
                    `5. Creating 3D models (OBJ and GLB)\n\n` +
                    `This may take several minutes. The process will continue in the background.\n` +
                    `You'll see status updates here for any significant events (like GPU quota limits).\n` +
                    `The final 3D models will be available when the process completes.`
            }
          ],
          isError: false,
          metadata: {
            operationId: operationId,
            status: "STARTED",
            startTime: new Date().toISOString(),
            prompt: prompt
          }
        };
        
        // Start the 3D asset generation process in the background
        (async () => {
          try {
            // Step 1: Generate the initial image using the Inference API
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Generating initial image' });
            await log('DEBUG', "Calling Hugging Face Inference API for 3D asset generation...");
            
            // Use retry mechanism for the image generation
            // Enhance the prompt to specify high detail, complete object, and white background
            const enhancedPrompt = `${prompt}, high detailed, complete object, not cut off, white solid background`;
            await log('DEBUG', `Enhanced 3D prompt: "${enhancedPrompt}"`);
            
            const image = await retryWithBackoff(async () => {
              return await inferenceClient.textToImage({
                model: "gokaygokay/Flux-Game-Assets-LoRA-v2",
                inputs: enhancedPrompt,
                parameters: { num_inference_steps: 50 },
                provider: "hf-inference",
              });
            });
            
            if (!image) {
              throw new Error("No image returned from 3D image generation API");
            }
            
            // Save the image (which is a Blob)
            const saveResult = await saveFileFromData(image, "3d_image", "png", toolName);
            const imagePath = saveResult.filePath;
            await log('INFO', `3D image generated at: ${imagePath}`);
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Initial image generated', path: imagePath });
            
            // Step 2: Process the image with InstantMesh using the correct multi-step process
            
            // 2.1: Check if the image is valid
            await log('DEBUG', "Validating image for 3D conversion...");
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Validating image' });
            const imageFile = await fs.readFile(imagePath);
            const checkResult = await retryWithBackoff(async () => {
              return await clientInstantMesh.predict("/check_input_image", [
                new File([imageFile], path.basename(imagePath), { type: "image/png" })
              ]);
            });
            
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Image validation complete' });
            
            // 2.2: Preprocess the image (with background removal)
            await log('DEBUG', "Preprocessing image...");
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Preprocessing image' });
            const preprocessResult = await retryWithBackoff(async () => {
              return await clientInstantMesh.predict("/preprocess", [
                new File([imageFile], path.basename(imagePath), { type: "image/png" }),
                true // Remove background
              ]);
            });
            
            if (!preprocessResult || !preprocessResult.data) {
              throw new Error("Image preprocessing failed");
            }
            
            await log('DEBUG', "Successfully preprocessed image with InstantMesh");
            await log('DEBUG', "Preprocessed data type: " + typeof preprocessResult.data);
            
            // Save the preprocessed image and notify clients of resource change
            // Save the preprocessed image
            const processedResult = await saveFileFromData(
              preprocessResult.data,
              "3d_processed",
              "png",
              toolName
            );
            const processedImagePath = processedResult.filePath;
            await log('INFO', `Preprocessed image saved at: ${processedImagePath}`);
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Preprocessing complete', path: processedImagePath });
            
            // Notify clients that a new resource is available
            await notifyResourceListChanged();
            
            // 2.3: Generate multi-views
            await log('DEBUG', "Generating multi-views...");
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Generating multi-views' });
            const processedImageFile = await fs.readFile(processedImagePath);
            const mvsResult = await retryWithBackoff(async () => {
              return await clientInstantMesh.predict("/generate_mvs", [
                new File([processedImageFile], path.basename(processedImagePath), { type: "image/png" }),
                75, // Sample steps (between 30 and 75)
                42  // Seed value
              ]);
            });
            
            if (!mvsResult || !mvsResult.data) {
              throw new Error("Multi-view generation failed");
            }
            
            await log('DEBUG', "Successfully generated multi-view image");
            await log('DEBUG', "Multi-view data type: " + typeof mvsResult.data);
            
            // Save the multi-view image and notify clients of resource change
            // Save the multi-view image
            const mvsResult2 = await saveFileFromData(
              mvsResult.data,
              "3d_multiview",
              "png",
              toolName
            );
            const mvsImagePath = mvsResult2.filePath;
            await log('INFO', `Multi-view image saved at: ${mvsImagePath}`);
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Multi-view generation complete', path: mvsImagePath });
            
            // Notify clients that a new resource is available
            await notifyResourceListChanged();
            
            // 2.4: Generate 3D models (OBJ and GLB)
            await log('DEBUG', "Generating 3D models...");
            await logOperation(toolName, operationId, 'PROCESSING', { step: 'Generating 3D models' });
            
            // This step is particularly prone to GPU quota errors, so use retry with backoff
            const modelResult = await retryWithBackoff(async () => {
              return await clientInstantMesh.predict("/make3d", []);
            }, 5); // More retries for this critical step
            
            if (!modelResult || !modelResult.data || !modelResult.data.length) {
              throw new Error("3D model generation failed");
            }
            
            await log('DEBUG', "Successfully generated 3D models");
            await log('DEBUG', "Model data type: " + typeof modelResult.data);
            
            // Save debug information for troubleshooting
            const modelDebugFilename = generateUniqueFilename("model_data", "json");
            const modelDebugPath = path.join(assetsDir, modelDebugFilename);
            await fs.writeFile(modelDebugPath, JSON.stringify(modelResult, null, 2));
            await log('DEBUG', `Model data saved as JSON at: ${modelDebugPath}`);
            
            // The API returns both OBJ and GLB formats
            const objModelData = modelResult.data[0];
            const glbModelData = modelResult.data[1];
            
            // Save both model formats
            // Save both model formats
            // Save both model formats and notify clients of resource changes
            const objResult = await saveFileFromData(objModelData, "3d_model", "obj", toolName);
            await log('INFO', `OBJ model saved at: ${objResult.filePath}`);
            
            // Notify clients that a new resource is available
            await notifyResourceListChanged();
            
            const glbResult = await saveFileFromData(glbModelData, "3d_model", "glb", toolName);
            await log('INFO', `GLB model saved at: ${glbResult.filePath}`);
            
            // Notify clients that a new resource is available
            await notifyResourceListChanged();
            
            // Create a completion message with detailed information
            const completionMessage = `3D asset generation complete (Operation ID: ${operationId}).\n\n` +
                                     `Process completed in ${Math.round((Date.now() - new Date(global.operationUpdates[operationId][0].timestamp).getTime()) / 1000)} seconds.\n\n` +
                                     `3D models available at:\n` +
                                     `- OBJ: ${objResult.resourceUri}\n` +
                                     `- GLB: ${glbResult.resourceUri}\n\n` +
                                     `You can view these models in any 3D viewer that supports OBJ or GLB formats.`;
            
            await logOperation(toolName, operationId, 'COMPLETED', {
              objPath: objResult.filePath,
              glbPath: glbResult.filePath,
              objUri: objResult.resourceUri,
              glbUri: glbResult.resourceUri,
              processingTime: `${Math.round((Date.now() - new Date(global.operationUpdates[operationId][0].timestamp).getTime()) / 1000)} seconds`
            });
            
            // Here you would typically send the final response to the client
            // Since we're already returning the initial response, we'll log the completion
            await log('INFO', `Operation ${operationId} completed successfully. Final response ready.`);
            
            // In a real-world scenario, you would send this completion message to the client
            // For example, through a WebSocket connection or by updating a status endpoint
            // For now, we'll just log it
            await log('INFO', `Completion message for client:\n${completionMessage}`);
            
          } catch (error) {
            const errorMessage = `Error in 3D asset generation (Operation ID: ${operationId}):\n${error.message}\n\nThe operation has been terminated. Please try again later or with a different prompt.`;
            
            await log('ERROR', `Error in background processing for operation ${operationId}: ${error.message}`);
            await logOperation(toolName, operationId, 'ERROR', {
              error: error.message,
              stack: error.stack,
              phase: global.operationUpdates[operationId] ?
                     global.operationUpdates[operationId][global.operationUpdates[operationId].length - 1].status :
                     'UNKNOWN'
            });
            
            // Here you would typically send an error response to the client
            // Since we're already returning the initial response, we'll log the error
            await log('ERROR', `Operation ${operationId} failed: ${error.message}`);
            
            // In a real-world scenario, you would send this error message to the client
            // For example, through a WebSocket connection or by updating a status endpoint
            // For now, we'll just log it
            await log('INFO', `Error message for client:\n${errorMessage}`);
          }
        })();
        
        // Return the initial response immediately to prevent timeout
        return initialResponse;
      } catch (error) {
        await log('ERROR', `Error starting operation ${operationId}: ${error.message}`);
        await logOperation(toolName, operationId, 'ERROR', { error: error.message });
        return {
          content: [{ type: "text", text: `Error starting 3D asset generation: ${error.message}` }],
          isError: true
        };
      }
    }

    throw {
      code: MCP_ERROR_CODES.MethodNotFound,
      message: `Unknown tool: ${toolName}`
    };
  } catch (error) {
    // Handle different types of errors with appropriate MCP error codes
    let errorCode = MCP_ERROR_CODES.InternalError;
    let errorMessage = error.message || "Unknown error";
    
    if (error.code) {
      // If the error already has a code, use it
      errorCode = error.code;
      errorMessage = error.message;
    } else if (error instanceof z.ZodError) {
      // Validation errors
      errorCode = MCP_ERROR_CODES.InvalidParams;
      errorMessage = `Invalid parameters: ${error.errors.map(e => e.message).join(", ")}`;
    }
    
    await log('ERROR', `Error in ${toolName}: ${errorMessage} (Code: ${errorCode})`);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
      errorCode: errorCode
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
      await log('DEBUG', "Saving data as Blob/File");
      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    } else if (typeof data === 'string') {
      // Check if it's base64 encoded
      if (data.match(/^data:[^;]+;base64,/)) {
        await log('DEBUG', "Saving data as base64 string");
        const base64Data = data.split(',')[1];
        await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
      } else {
        await log('DEBUG', "Saving data as regular string");
        await fs.writeFile(filePath, data);
      }
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      await log('DEBUG', "Saving data as ArrayBuffer");
      await fs.writeFile(filePath, Buffer.from(data));
    } else if (Array.isArray(data) && data.length > 0) {
      // Handle array of file data (common in InstantMesh API responses)
      await log('DEBUG', "Data is an array with " + data.length + " items");
      const fileData = data[0];
      
      if (fileData.url) {
        await log('DEBUG', "Found URL in data: " + fileData.url);
        // Fetch the file from the URL
        const response = await fetch(fileData.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        await fs.writeFile(filePath, Buffer.from(buffer));
        await log('DEBUG', "Successfully saved file from URL");
      } else {
        await log('DEBUG', "No URL found in array data, saving as JSON");
        await fs.writeFile(filePath, JSON.stringify(data));
      }
    } else if (typeof data === 'object' && data.url) {
      // Handle object with URL property
      await log('DEBUG', "Data is an object with URL: " + data.url);
      const response = await fetch(data.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      await fs.writeFile(filePath, Buffer.from(buffer));
      await log('DEBUG', "Successfully saved file from URL");
    } else if (typeof data === 'object') {
      // JSON or other object
      await log('DEBUG', "Saving data as JSON object");
      await fs.writeFile(filePath, JSON.stringify(data));
    } else {
      // Fallback
      await log('DEBUG', "Saving data using fallback method");
      await fs.writeFile(filePath, Buffer.from(String(data)));
    }
    
    // Return both the file path and the resource URI
    return {
      filePath,
      resourceUri: `asset://${filename}`
    };
  } catch (error) {
    await log('ERROR', `Error saving file from data: ${error.message}`);
    
    // Save debug information for troubleshooting
    try {
      const debugFilename = generateUniqueFilename("debug_data", "json");
      const debugPath = path.join(assetsDir, debugFilename);
      let debugData;
      
      if (typeof data === 'object') {
        debugData = JSON.stringify(data, null, 2);
      } else {
        debugData = String(data);
      }
      
      await fs.writeFile(debugPath, debugData);
      await log('INFO', `Debug data saved at: ${debugPath}`);
    } catch (debugError) {
      await log('ERROR', `Failed to save debug data: ${debugError.message}`);
    }
    
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

// Define Zod schemas for prompt argument validation
const promptSchema2D = z.object({
  prompt: z.string().min(1).max(500).transform(val => sanitizePrompt(val))
});

const promptSchema3D = z.object({
  prompt: z.string().min(1).max(500).transform(val => sanitizePrompt(val))
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name;
  const args = request.params.arguments;
  
  try {
    if (promptName === "generate_2d_sprite") {
      // Validate arguments using Zod schema
      const { prompt } = promptSchema2D.parse(args);
      
      return {
        description: "Generate a 2D sprite",
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Generate a 2D sprite: ${prompt}, high detailed, complete object, not cut off, white solid background` }
          }
        ]
      };
    }
    
    if (promptName === "generate_3d_model") {
      // Validate arguments using Zod schema
      const { prompt } = promptSchema3D.parse(args);
      
      return {
        description: "Generate a 3D model",
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Generate a 3D model: ${prompt}, high detailed, complete object, not cut off, white solid background` }
          }
        ]
      };
    }
    
    // If prompt not found, throw an error with MCP error code
    throw {
      code: MCP_ERROR_CODES.MethodNotFound,
      message: `Prompt not found: ${promptName}`
    };
  } catch (error) {
    // Handle different types of errors
    if (error.code) {
      // If the error already has a code, rethrow it
      throw error;
    } else if (error instanceof z.ZodError) {
      // Validation errors
      throw {
        code: MCP_ERROR_CODES.InvalidParams,
        message: `Invalid arguments: ${error.errors.map(e => e.message).join(", ")}`
      };
    } else {
      // Other errors
      throw {
        code: MCP_ERROR_CODES.InternalError,
        message: `Internal error: ${error.message}`
      };
    }
  }
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
    global.transports = new Map();
    
    // Add health check endpoint
    app.get("/health", (req, res) => {
      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "0.1.0", // Updated to version 0.1.0
        uptime: process.uptime()
      });
    });
    
    app.get("/sse", async (req, res) => {
      const clientId = req.query.clientId || crypto.randomUUID();
      await log('INFO', `SSE connection established for client: ${clientId}`);
      
      // Set headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Create a new transport for this client
      const transport = new SSEServerTransport("/messages", res);
      global.transports.set(clientId, transport);
      
      // Handle client disconnect
      req.on('close', () => {
        global.transports.delete(clientId);
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
      const transport = global.transports.get(clientId);
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
    
    // Add health check handler for stdio transport
    server.setRequestHandler(z.object({ method: z.literal("health/check") }), async () => {
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "0.1.0", // Updated to version 0.1.0
        uptime: process.uptime()
      };
    });
  }
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});