import { promises as fs } from "fs";
import path from "path";
import { log } from "../logger.js";
import { saveFileFromData } from "../utils.js";

/**
 * Workflow for Hunyuan3D-2mini-Turbo space
 */
export async function processHunyuan3dMiniTurbo({
  modelClient,
  imageFile,
  imagePath,
  // Removed processedImagePath as it's set internally
  prompt,
  operationId,
  toolName,
  assetsDir,
  hfToken,
  modelSpace,
  workDir,
  config,
  retryWithBackoff,
  notifyResourceListChanged
}) {
  const { 
    model3dSteps, 
    model3dGuidanceScale, 
    model3dSeed, 
    model3dOctreeResolution, 
    model3dRemoveBackground,
    model3dTurboMode,
    validTurboModes
  } = config;
  
  await log('INFO', "Using Hunyuan3D-2mini-Turbo space", workDir);
  
  // Hunyuan3D-2mini-Turbo doesn't have a check_input_image endpoint, so we skip that step
  await log('INFO', `Using Hunyuan3D-2mini-Turbo space - skipping image validation step`, workDir);
  
  // Hunyuan3D-2mini-Turbo doesn't have a preprocess endpoint, but has built-in background removal
  await log('INFO', `Using Hunyuan3D-2mini-Turbo space - using built-in background removal`, workDir);
  
  // Save the original image as the processed image
  const processedResult = await saveFileFromData(
    imageFile,
    "3d_processed",
    "png",
    toolName,
    assetsDir,
    hfToken,
    modelSpace,
    workDir
  );
  const processedImagePath = processedResult.filePath;
  await log('INFO', `Preprocessed image saved at: ${processedImagePath}`, workDir);
  
  // Notify clients that a new resource is available
  await notifyResourceListChanged();
  
  // Generate 3D model in one step with generation_all
  await log('DEBUG', "Generating 3D model with Hunyuan3D-2mini-Turbo...", workDir);
  const processedImageFile = await fs.readFile(processedImagePath);
  
  // Determine default steps based on the selected mode
  let defaultSteps;
  if (model3dTurboMode === "Turbo") {
    defaultSteps = 5; // Default for Turbo mode
  } else if (model3dTurboMode === "Fast") {
    defaultSteps = 10; // Default for Fast mode
  } else { // Standard mode
    defaultSteps = 20; // Default for Standard mode
  }
  
  // Hunyuan3D-2mini-Turbo steps range: 1-100
  let steps = model3dSteps !== null ? model3dSteps : defaultSteps;
  steps = Math.max(1, Math.min(100, steps));
  
  // Guidance scale already validated (0.0-100.0)
  const guidanceScale = model3dGuidanceScale !== null ? model3dGuidanceScale : 5.0; // Default: 5.0
  
  // Seed already validated (0-10000000)
  const seed = model3dSeed !== null ? model3dSeed : 1234; // Default: 1234
  
  // Validate octree resolution (range: 16-512)
  let octreeResolution = model3dOctreeResolution !== null ? parseInt(model3dOctreeResolution) : 256; // Default: 256
  octreeResolution = Math.max(16, Math.min(512, octreeResolution));
  
  // Validate num_chunks (range: 1000-5000000)
  const numChunks = 8000; // Default value
  
  await log('INFO', `Hunyuan3D-2mini-Turbo parameters - mode: ${model3dTurboMode}, steps: ${steps}, guidance_scale: ${guidanceScale}, seed: ${seed}, octree_resolution: ${octreeResolution}, remove_background: ${model3dRemoveBackground}, num_chunks: ${numChunks}`, workDir);
  
  // First, set the generation mode if specified
  if (model3dTurboMode) {
    try {
      await modelClient.predict("/on_gen_mode_change", [model3dTurboMode]);
      await log('INFO', `Set generation mode to ${model3dTurboMode}`, workDir);
    } catch (error) {
      await log('WARN', `Failed to set generation mode: ${error.message}`, workDir);
      // Continue with the generation even if setting the mode fails
    }
  }
  
  // Use generation_all endpoint
  await log('INFO', "Using Hunyuan3D-2mini-Turbo space - using generation_all endpoint", workDir);
  
  // Hunyuan3D-2mini-Turbo has different parameters than Hunyuan3D-2
  const modelResult = await retryWithBackoff(async () => {
    return await modelClient.predict("/generation_all", [
      prompt, // caption
      new File([processedImageFile], path.basename(processedImagePath), { type: "image/png" }),
      null, null, null, null, // Multi-view images (front, back, left, right)
      steps,
      guidanceScale,
      seed,
      octreeResolution,
      model3dRemoveBackground,
      numChunks, // num_chunks with validation
      true // randomize_seed
    ]);
  }, operationId, 5); // More retries for this critical step
  
  if (!modelResult || !modelResult.data || !modelResult.data.length) {
    throw new Error("3D model generation failed");
  }
  
  await log('DEBUG', "Successfully generated 3D model with Hunyuan3D-2mini-Turbo", workDir);
  
  // Save debug information for troubleshooting
  const modelDebugFilename = path.join(assetsDir, `model_data_${Date.now()}.json`);
  await fs.writeFile(modelDebugFilename, JSON.stringify(modelResult, null, 2));
  await log('DEBUG', `Model data saved as JSON at: ${modelDebugFilename}`, workDir);
  
  // According to ground_truth.md, Hunyuan3D-2mini-Turbo returns:
  // 1. White Mesh (File): result.data[0].value.url
  // 2. Textured Mesh (File): result.data[1].value.url
  // 3. HTML Output: result.data[2]
  // 4. Model Information (JSON): result.data[3]
  // 5. Seed Value (Number): result.data[4]
  
  // Declare variables outside the if/else block for proper scope
  let objModelData, glbModelData;
  
  // For Hunyuan3D-2mini-Turbo, the textured mesh URL is at result.data[1].value.url
  if (!modelResult.data[1] || !modelResult.data[1].value || !modelResult.data[1].value.url) {
    await log('WARN', `Textured mesh not found in result.data[1].value.url, falling back to white mesh`, workDir);
    // Fallback to white mesh if textured mesh is not available
    if (!modelResult.data[0] || !modelResult.data[0].value || !modelResult.data[0].value.url) {
      throw new Error("No valid mesh found in the response");
    }
    // Use white mesh for both OBJ and GLB
    objModelData = modelResult.data[0].value;
    glbModelData = modelResult.data[0].value;
    await log('DEBUG', `Hunyuan3D-2mini-Turbo: Using white mesh from modelResult.data[0].value for both OBJ and GLB`, workDir);
  } else {
    // Use textured mesh for both OBJ and GLB
    objModelData = modelResult.data[1].value; // Textured mesh
    glbModelData = modelResult.data[1].value; // Textured mesh
    await log('DEBUG', `Hunyuan3D-2mini-Turbo: Using textured mesh from modelResult.data[1].value for both OBJ and GLB`, workDir);
  }
  
  // Save both model formats and notify clients of resource changes
  const objResult = await saveFileFromData(
    objModelData, 
    "3d_model", 
    "obj", 
    toolName, 
    assetsDir, 
    hfToken, 
    modelSpace, 
    workDir
  );
  await log('INFO', `OBJ model saved at: ${objResult.filePath}`, workDir);
  
  // Notify clients that a new resource is available
  await notifyResourceListChanged();
  
  const glbResult = await saveFileFromData(
    glbModelData, 
    "3d_model", 
    "glb", 
    toolName, 
    assetsDir, 
    hfToken, 
    modelSpace, 
    workDir
  );
  await log('INFO', `GLB model saved at: ${glbResult.filePath}`, workDir);
  
  // Notify clients that a new resource is available
  await notifyResourceListChanged();
  
  return {
    objResult,
    glbResult
  };
}