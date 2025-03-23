import { log } from "./logger.js";

// Space types
export const SPACE_TYPE = {
  INSTANTMESH: "instantmesh",
  HUNYUAN3D: "hunyuan3d",
  HUNYUAN3D_MINI_TURBO: "hunyuan3d_mini_turbo",
  UNKNOWN: "unknown"
};

// Space detection state
export let detectedSpaceType = SPACE_TYPE.UNKNOWN;

// Validate space format
export function validateSpaceFormat(space) {
  // Check if the space follows the format "username/space-name"
  if (!space) {
    return false;
  }
  
  // Check basic format with regex
  const spaceRegex = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
  if (!spaceRegex.test(space)) {
    return false;
  }
  
  // Additional validation
  const parts = space.split('/');
  if (parts.length !== 2) {
    return false;
  }
  
  const [username, spaceName] = parts;
  // Username and space name should be at least 2 characters
  if (username.length < 2 || spaceName.length < 2) {
    return false;
  }
  
  return true;
}

// Detect which space was duplicated by checking available endpoints using view_api()
export async function detectSpaceType(client, modelSpace, workDir) {
  try {
    await log('INFO', "Detecting space type using view_api()...", workDir);
    await log('DEBUG', "========== SPACE DETECTION DEBUGGING ==========", workDir);
    await log('DEBUG', `Current modelSpace: "${modelSpace}"`, workDir);
    await log('DEBUG', `modelSpace lowercase: "${modelSpace.toLowerCase()}"`, workDir);
    await log('DEBUG', `Contains "instantmesh": ${modelSpace.toLowerCase().includes("instantmesh")}`, workDir);
    await log('DEBUG', `Contains "hunyuan3d-2mini-turbo": ${modelSpace.toLowerCase().includes("hunyuan3d-2mini-turbo")}`, workDir);
    await log('DEBUG', `Contains "hunyuan3d-2mini": ${modelSpace.toLowerCase().includes("hunyuan3d-2mini")}`, workDir);
    await log('DEBUG', `Contains "hunyuan3dmini": ${modelSpace.toLowerCase().includes("hunyuan3dmini")}`, workDir);
    await log('DEBUG', `Contains "hunyuan": ${modelSpace.toLowerCase().includes("hunyuan")}`, workDir);
    await log('DEBUG', "==============================================", workDir);
    
    // First, check if the space name contains a hint about the type
    // Check for Hunyuan3D-2mini-Turbo first (most specific match)
    if (modelSpace.toLowerCase().includes("hunyuan3d-2mini-turbo") ||
        modelSpace.toLowerCase().includes("hunyuan3d-2mini") ||
        modelSpace.toLowerCase().includes("hunyuan3dmini")) {
      detectedSpaceType = SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
      await log('INFO', `Detected space type: Hunyuan3D-2mini-Turbo (based on space name)`, workDir);
      await log('DEBUG', `Space detection result: HUNYUAN3D_MINI_TURBO (${SPACE_TYPE.HUNYUAN3D_MINI_TURBO})`, workDir);
      return SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
    }
    // Then check for regular Hunyuan3D-2
    else if (modelSpace.toLowerCase().includes("hunyuan")) {
      detectedSpaceType = SPACE_TYPE.HUNYUAN3D;
      await log('INFO', `Detected space type: Hunyuan3D-2 (based on space name)`, workDir);
      await log('DEBUG', `Space detection result: HUNYUAN3D (${SPACE_TYPE.HUNYUAN3D})`, workDir);
      return SPACE_TYPE.HUNYUAN3D;
    }
    // Finally check for InstantMesh
    else if (modelSpace.toLowerCase().includes("instantmesh")) {
      detectedSpaceType = SPACE_TYPE.INSTANTMESH;
      await log('INFO', `Detected space type: InstantMesh (based on space name)`, workDir);
      await log('DEBUG', `Space detection result: INSTANTMESH (${SPACE_TYPE.INSTANTMESH})`, workDir);
      return SPACE_TYPE.INSTANTMESH;
    }
    
    await log('DEBUG', "No space type detected from name, continuing with API endpoint detection...", workDir);
    
    // Try a direct predict call to test if the client is working
    try {
      await log('DEBUG', "Testing client with a simple predict call...", workDir);
      // Try a simple predict call with an empty API name
      const result = await client.predict("", []);
      await log('DEBUG', `Predict call result: ${JSON.stringify(result)}`, workDir);
    } catch (predictError) {
      await log('DEBUG', `Simple predict call error: ${predictError.message}`, workDir);
      // This is expected to fail, but it helps test if the client is working
    }
    
    // Add a timeout to the view_api call
    await log('DEBUG', "Creating view_api promise...", workDir);
    const apiInfoPromise = client.view_api(true); // true to show all endpoints
    
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("view_api call timed out after 30 seconds"));
      }, 30000); // 30 second timeout
    });
    
    // Race the API info promise against the timeout
    await log('DEBUG', "Starting view_api call with 30 second timeout...", workDir);
    const apiInfo = await Promise.race([apiInfoPromise, timeoutPromise]);
    
    // Log the full API info for debugging
    await log('DEBUG', `API info retrieved: ${JSON.stringify(apiInfo, null, 2)}`, workDir);
    
    // Check for InstantMesh-specific endpoints in named_endpoints
    if (apiInfo && apiInfo.named_endpoints) {
      const endpoints = Object.keys(apiInfo.named_endpoints);
      await log('DEBUG', `Available endpoints: ${endpoints.join(', ')}`, workDir);
      
      // Check for InstantMesh-specific endpoints
      if (endpoints.includes("/check_input_image") ||
          endpoints.includes("/make3d") ||
          endpoints.includes("/generate_mvs") ||
          endpoints.includes("/preprocess")) {
        detectedSpaceType = SPACE_TYPE.INSTANTMESH;
        await log('INFO', `Detected space type: InstantMesh (based on API endpoints)`, workDir);
        return SPACE_TYPE.INSTANTMESH;
      }
      
      // Check for Hunyuan3D-2mini-Turbo-specific endpoints
      if (endpoints.includes("/on_gen_mode_change") ||
          endpoints.includes("/on_decode_mode_change") ||
          endpoints.includes("/on_export_click")) {
        detectedSpaceType = SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
        await log('INFO', `Detected space type: Hunyuan3D-2mini-Turbo (based on API endpoints)`, workDir);
        return SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
      }
      
      // Check for Hunyuan3D-specific endpoints
      if (endpoints.includes("/shape_generation") ||
          endpoints.includes("/generation_all")) {
        detectedSpaceType = SPACE_TYPE.HUNYUAN3D;
        await log('INFO', `Detected space type: Hunyuan3D-2 (based on API endpoints)`, workDir);
        return SPACE_TYPE.HUNYUAN3D;
      }
    }
    
    // If we get here, we couldn't determine the space type from named_endpoints
    // Check unnamed_endpoints as well
    if (apiInfo && apiInfo.unnamed_endpoints) {
      const unnamedEndpoints = Object.keys(apiInfo.unnamed_endpoints);
      await log('DEBUG', `Available unnamed endpoints: ${unnamedEndpoints.join(', ')}`, workDir);
      
      // Check for InstantMesh-specific endpoints in unnamed_endpoints
      if (unnamedEndpoints.some(endpoint =>
          endpoint.includes("check_input_image") ||
          endpoint.includes("make3d") ||
          endpoint.includes("generate_mvs") ||
          endpoint.includes("preprocess"))) {
        detectedSpaceType = SPACE_TYPE.INSTANTMESH;
        await log('INFO', `Detected space type: InstantMesh (based on unnamed API endpoints)`, workDir);
        return SPACE_TYPE.INSTANTMESH;
      }
      
      // Check for Hunyuan3D-2mini-Turbo-specific endpoints in unnamed_endpoints
      if (unnamedEndpoints.some(endpoint =>
          endpoint.includes("on_gen_mode_change") ||
          endpoint.includes("on_decode_mode_change") ||
          endpoint.includes("on_export_click"))) {
        detectedSpaceType = SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
        await log('INFO', `Detected space type: Hunyuan3D-2mini-Turbo (based on unnamed API endpoints)`, workDir);
        return SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
      }
      
      // Check for Hunyuan3D-specific endpoints in unnamed_endpoints
      if (unnamedEndpoints.some(endpoint =>
          endpoint.includes("shape_generation") ||
          endpoint.includes("generation_all"))) {
        detectedSpaceType = SPACE_TYPE.HUNYUAN3D;
        await log('INFO', `Detected space type: Hunyuan3D-2 (based on unnamed API endpoints)`, workDir);
        return SPACE_TYPE.HUNYUAN3D;
      }
    }
    
    // If we still can't determine the space type, check the space name as a hint
    await log('DEBUG', "Fallback space detection from name...", workDir);
    // Check for Hunyuan3D-2mini-Turbo first (most specific match)
    if (modelSpace.toLowerCase().includes("hunyuan3d-2mini-turbo") ||
        modelSpace.toLowerCase().includes("hunyuan3d-2mini") ||
        modelSpace.toLowerCase().includes("hunyuan3dmini")) {
      detectedSpaceType = SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
      await log('INFO', `Detected space type: Hunyuan3D-2mini-Turbo (based on space name fallback)`, workDir);
      await log('DEBUG', `Fallback space detection result: HUNYUAN3D_MINI_TURBO (${SPACE_TYPE.HUNYUAN3D_MINI_TURBO})`, workDir);
      return SPACE_TYPE.HUNYUAN3D_MINI_TURBO;
    }
    // Then check for regular Hunyuan3D-2
    else if (modelSpace.toLowerCase().includes("hunyuan")) {
      detectedSpaceType = SPACE_TYPE.HUNYUAN3D;
      await log('INFO', `Detected space type: Hunyuan3D-2 (based on space name fallback)`, workDir);
      await log('DEBUG', `Fallback space detection result: HUNYUAN3D (${SPACE_TYPE.HUNYUAN3D})`, workDir);
      return SPACE_TYPE.HUNYUAN3D;
    }
    // Finally check for InstantMesh
    else if (modelSpace.toLowerCase().includes("instantmesh")) {
      detectedSpaceType = SPACE_TYPE.INSTANTMESH;
      await log('INFO', `Detected space type: InstantMesh (based on space name fallback)`, workDir);
      await log('DEBUG', `Fallback space detection result: INSTANTMESH (${SPACE_TYPE.INSTANTMESH})`, workDir);
      return SPACE_TYPE.INSTANTMESH;
    }
    
    // If we get here, we couldn't determine the space type
    // This is a critical error - we should not proceed without knowing the space type
    const errorMessage = `Could not determine space type after API analysis. Please ensure your MODEL_SPACE environment variable in .env file is set correctly according to .env.example. You must use one of the following options:
1. A Hunyuan3D-2 space (containing "hunyuan" in the name)
2. A Hunyuan3D-2mini-Turbo space (containing "hunyuan3d-2mini" in the name)
3. An InstantMesh space (containing "instantmesh" in the name)`;
    
    await log('ERROR', errorMessage, workDir);
    throw new Error(errorMessage);
  } catch (error) {
    await log('ERROR', `Error detecting space type: ${error.message}`, workDir);
    // Rethrow the error instead of defaulting to InstantMesh
    throw new Error(`Failed to detect space type: ${error.message}. Please check your MODEL_SPACE environment variable in .env file and ensure it follows the format specified in .env.example.`);
  }
}