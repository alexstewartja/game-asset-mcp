import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log, logOperation } from "./logger.js";
import { retryWithBackoff, sanitizePrompt, saveFileFromData, detectImageFormat } from "./utils.js";
import { MCP_ERROR_CODES } from "./validation.js";
import { SPACE_TYPE } from "./spaceTypes.js";
import { promises as fs } from "fs";
import path from "path";
import { process3dAsset } from "./workflows/index.js";

const schema2D = z.object({ prompt: z.string().min(1).max(500).transform(sanitizePrompt) });
const schema3D = z.object({ prompt: z.string().min(1).max(500).transform(sanitizePrompt) });

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
    },
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
    },
  },
};

export function registerToolHandlers(server, config, clients, notifyResourceListChanged) {
  const { inferenceClient, modelClient, modelSpace, spaceType } = clients;
  const {
    assetsDir,
    workDir,
    hfToken,
    model3dSteps,
    model3dGuidanceScale,
    model3dOctreeResolution,
    model3dSeed,
    model3dRemoveBackground,
    model3dTurboMode,
    validTurboModes
  } = config;
  
  let operationCounter = 0;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOLS.GENERATE_2D_ASSET, TOOLS.GENERATE_3D_ASSET],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    await log("INFO", `Calling tool: ${name}`, workDir);

    try {
      if (name === TOOLS.GENERATE_2D_ASSET.name) {
        const { prompt } = schema2D.parse(args);
        if (!prompt) {
          throw new Error("Invalid or empty prompt");
        }
        await log('INFO', `Generating 2D asset with prompt: "${prompt}"`, workDir);
        
        // Use the Hugging Face Inference API to generate the image
        await log('DEBUG', "Calling Hugging Face Inference API for 2D asset generation...", workDir);
        // Enhance the prompt to specify high detail, complete object, and white background
        const enhancedPrompt = `${prompt}, high detailed, complete object, not cut off, white solid background`;
        await log('DEBUG', `Enhanced 2D prompt: "${enhancedPrompt}"`, workDir);
        
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
        // Detect the actual image format (JPEG or PNG)
        const imageBuffer = await image.arrayBuffer();
        const format = detectImageFormat(Buffer.from(imageBuffer));
        const extension = format === "JPEG" ? "jpg" : "png";
        
        await log('DEBUG', `Detected 2D image format: ${format}, using extension: ${extension}`, workDir);
        const saveResult = await saveFileFromData(image, "2d_asset", extension, name, assetsDir, hfToken, modelSpace, workDir);
        await log('INFO', `2D asset saved at: ${saveResult.filePath}`, workDir);
        
        // Notify clients that a new resource is available
        await notifyResourceListChanged();
        
        return {
          content: [{ type: "text", text: `2D asset available at ${saveResult.resourceUri}` }],
          isError: false
        };
      }

      if (name === TOOLS.GENERATE_3D_ASSET.name) {
        const operationId = `3D-${++operationCounter}`;
        await logOperation(name, operationId, 'STARTED', {}, workDir);
        
        try {
          const { prompt } = schema3D.parse(args);
          if (!prompt) {
            throw new Error("Invalid or empty prompt");
          }
          await log('INFO', `Generating 3D asset with prompt: "${prompt}"`, workDir);
          await logOperation(name, operationId, 'PROCESSING', { step: 'Parsing prompt', prompt }, workDir);
          
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
              await logOperation(name, operationId, 'PROCESSING', { step: 'Generating initial image' }, workDir);
              await log('DEBUG', "Calling Hugging Face Inference API for 3D asset generation...", workDir);
              
              // Use retry mechanism for the image generation
              // Enhance the prompt to specify high detail, complete object, and white background
              const enhancedPrompt = `${prompt}, high detailed, complete object, not cut off, white solid background`;
              await log('DEBUG', `Enhanced 3D prompt: "${enhancedPrompt}"`, workDir);
              
              const image = await retryWithBackoff(async () => {
                return await inferenceClient.textToImage({
                  model: "gokaygokay/Flux-Game-Assets-LoRA-v2",
                  inputs: enhancedPrompt,
                  parameters: { num_inference_steps: 50 },
                  provider: "hf-inference",
                });
              }, operationId);
              
              if (!image) {
                throw new Error("No image returned from 3D image generation API");
              }
              
              // Save the image (which is a Blob)
              // Detect the actual image format (JPEG or PNG)
              const imageBuffer = await image.arrayBuffer();
              const format = detectImageFormat(Buffer.from(imageBuffer));
              const extension = format === "JPEG" ? "jpg" : "png";
              
              await log('DEBUG', `Detected 3D image format: ${format}, using extension: ${extension}`, workDir);
              const saveResult = await saveFileFromData(image, "3d_image", extension, name, assetsDir, hfToken, modelSpace, workDir);
              const imagePath = saveResult.filePath;
              await log('INFO', `3D image generated at: ${imagePath}`, workDir);
              await logOperation(name, operationId, 'PROCESSING', { step: 'Initial image generated', path: imagePath }, workDir);
              
              // Read the image file for processing
              const imageFile = await fs.readFile(imagePath);
              
              // Process the 3D asset based on the space type
              await logOperation(name, operationId, 'PROCESSING', { step: 'Processing with workflow', spaceType }, workDir);
              
              const result = await process3dAsset({
                spaceType,
                modelClient,
                imageFile,
                imagePath,
                processedImagePath: null, // Will be created by the workflow
                prompt,
                operationId,
                toolName: name,
                assetsDir,
                hfToken,
                modelSpace,
                workDir,
                config,
                retryWithBackoff,
                notifyResourceListChanged
              });
              
              // Create a completion message with detailed information
              const completionMessage = `3D asset generation complete (Operation ID: ${operationId}).\n\n` +
                                       `Process completed in ${Math.round((Date.now() - new Date(global.operationUpdates[operationId][0].timestamp).getTime()) / 1000)} seconds.\n\n` +
                                       `3D models available at:\n` +
                                       `- OBJ: ${result.objResult.resourceUri}\n` +
                                       `- GLB: ${result.glbResult.resourceUri}\n\n` +
                                       `You can view these models in any 3D viewer that supports OBJ or GLB formats.`;
              
              await logOperation(name, operationId, 'COMPLETED', {
                objPath: result.objResult.filePath,
                glbPath: result.glbResult.filePath,
                objUri: result.objResult.resourceUri,
                glbUri: result.glbResult.resourceUri,
                processingTime: `${Math.round((Date.now() - new Date(global.operationUpdates[operationId][0].timestamp).getTime()) / 1000)} seconds`
              }, workDir);
              
              // Log the completion
              await log('INFO', `Operation ${operationId} completed successfully. Final response ready.`, workDir);
              await log('INFO', `Completion message for client:\n${completionMessage}`, workDir);
              
            } catch (error) {
              const errorMessage = `Error in 3D asset generation (Operation ID: ${operationId}):\n${error.message}\n\nThe operation has been terminated. Please try again later or with a different prompt.`;
              
              await log('ERROR', `Error in background processing for operation ${operationId}: ${error.message}`, workDir);
              await logOperation(name, operationId, 'ERROR', {
                error: error.message,
                stack: error.stack,
                phase: global.operationUpdates[operationId] ?
                       global.operationUpdates[operationId][global.operationUpdates[operationId].length - 1].status :
                       'UNKNOWN'
              }, workDir);
              
              // Log the error
              await log('ERROR', `Operation ${operationId} failed: ${error.message}`, workDir);
              await log('INFO', `Error message for client:\n${errorMessage}`, workDir);
            }
          })();
          
          // Return the initial response immediately to prevent timeout
          return initialResponse;
        } catch (error) {
          await log('ERROR', `Error starting operation ${operationId}: ${error.message}`, workDir);
          await logOperation(name, operationId, 'ERROR', { error: error.message }, workDir);
          return {
            content: [{ type: "text", text: `Error starting 3D asset generation: ${error.message}` }],
            isError: true
          };
        }
      }
  
      throw {
        code: MCP_ERROR_CODES.MethodNotFound,
        message: `Unknown tool: ${name}`
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
      
      await log('ERROR', `Error in ${name}: ${errorMessage} (Code: ${errorCode})`, workDir);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
        errorCode: errorCode
      };
    }
  });
}