#!/usr/bin/env node

import { Client } from "@gradio/client";
import { promises as fs } from "fs";
import path from "path";
import dotenv from "dotenv";

// Main test function
async function main() {
  // Create test directory
  const testDir = path.join(process.cwd(), 'test_output');
  await fs.mkdir(testDir, { recursive: true });
  
  // Create a log file for detailed debugging
  const logFilePath = path.join(testDir, 'hunyuan_test_log.txt');
  
  // Initialize log file
  await fs.writeFile(logFilePath, `=== HUNYUAN SPACES TEST LOG STARTED AT ${new Date().toISOString()} ===\n\n`);
  
  // Helper function to log to both console and file
  async function log(message) {
    console.log(message);
    try {
      await fs.appendFile(logFilePath, message + '\n');
    } catch (error) {
      console.error(`Error writing to log file: ${error.message}`);
    }
  }
  
  try {
    await log("========== HUNYUAN SPACES TEST ==========");
    await log(`Current working directory: ${process.cwd()}`);
    
    // Load environment variables from .env file
    dotenv.config({
      path: path.join(process.cwd(), '.env'),
      override: true
    });
    
    // Get HF token from environment
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) {
      throw new Error("HF_TOKEN is not set in the .env file. Please add it and try again.");
    }
    
    await log(`HF_TOKEN length: ${hfToken.length}`);
    
    // Authentication options for Gradio
    const authOptions = {
      hf_token: hfToken
    };
    
    // Test prompt
    const testPrompt = "a cute cartoon robot";
    await log(`Using test prompt: "${testPrompt}"`);
    
    // Use existing reference image
    const referenceImagePath = path.join(testDir, "3d_reference_image_1742685015105.jpg");
    await log(`Using existing reference image: ${referenceImagePath}`);
    
    // Check if the reference image exists
    try {
      await fs.access(referenceImagePath);
      await log("Reference image exists");
    } catch (error) {
      throw new Error(`Reference image not found at ${referenceImagePath}`);
    }
    
    // Read the reference image
    const imageFile = await fs.readFile(referenceImagePath);
    const imageFileObj = new File([imageFile], path.basename(referenceImagePath), { type: "image/jpeg" });
    await log(`Reference image loaded: ${imageFile.length} bytes`);
    
    // Skip testing Hunyuan3D-2 space as we already know how to download textured models from it
    await log("\n========== SKIPPING HUNYUAN3D-2 SPACE TEST ==========");
    await log("We already know how to download textured models from Hunyuan3D-2 space.");
    await log("See ground_truth.md for details on how to download textured models from Hunyuan3D-2 space.");
    
    // Test only Hunyuan3D-2mini-Turbo space
    await log("\n========== TESTING HUNYUAN3D-2MINI-TURBO SPACE ==========");
    await log("Testing only Hunyuan3D-2mini-Turbo space to download textured models.");
    await testHunyuan3DMiniTurboSpace(hfToken, testPrompt, testDir, log, imageFileObj);
    
    await log("\n========== HUNYUAN SPACES TEST COMPLETED ==========");
    await log("Check the test_output directory for results and hunyuan_test_log.txt for detailed logs");
    
  } catch (error) {
    await log(`ERROR: ${error.message}`);
    await log(`Error stack: ${error.stack}`);
  }
}

// Test Hunyuan3D-2 space
async function testHunyuan3DSpace(hfToken, prompt, testDir, log, imageFileObj) {
  try {
    // Connect to Hunyuan3D-2 space
    const modelSpace = process.env.HUNYUAN3D_SPACE || "mubarak-alketbi/Hunyuan3D-2";
    await log(`Connecting to Hunyuan3D-2 space: ${modelSpace}`);
    
    // Authentication options
    const authOptions = { hf_token: hfToken };
    
    // Connect to the space
    const client = await Client.connect(modelSpace, authOptions);
    await log("Successfully connected to Hunyuan3D-2 space");
    
    // Add a longer delay for space startup
    await log("Waiting 45 seconds for space startup...");
    await new Promise(resolve => setTimeout(resolve, 45000));
    await log("Space startup delay completed");
    // Test generation_all endpoint to get 3D models with textures
    await log("\n--- Testing generation_all Endpoint ---");
    
    
    // Add a longer delay before generation
    await log("Waiting 45 seconds before generation to avoid GPU quota issues...");
    await new Promise(resolve => setTimeout(resolve, 45000));
    await log("Pre-generation delay completed");
    
    // Call generation_all with correct parameters to get both white and textured meshes
    await log(`Calling generation_all with prompt: "${prompt}" to get both white and textured meshes`);
    const startTime = Date.now();
    
    try {
      // Based on API analysis, Hunyuan3D-2 generation_all takes these parameters:
      const result = await client.predict("/generation_all", [
        prompt,           // caption
        imageFileObj,     // image
        20,               // steps (lower is faster)
        5.5,              // guidance_scale
        1234,             // seed
        "256",            // octree_resolution (as string)
        true              // check_box_rembg
      ]);
      
      const endTime = Date.now();
      await log(`Generation completed in ${(endTime - startTime) / 1000} seconds`);
      
      // Process result
      await log(`Generation result type: ${typeof result}`);
      await log(`Result: ${JSON.stringify(result)}`);
      
      // Extract URLs from the result structure
      let whiteMeshUrl = null;
      let texturedMeshUrl = null;
      
      if (typeof result === 'object') {
        // Check if it's a Gradio response object
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          // For Hunyuan3D-2 space, the first item should be the white mesh
          if (result.data[0] && result.data[0].url) {
            whiteMeshUrl = result.data[0].url;
            await log(`Found white mesh URL in result.data[0].url: ${whiteMeshUrl}`);
          }
          
          // For Hunyuan3D-2 space, the second item should be the textured mesh
          if (result.data[1] && result.data[1].url) {
            texturedMeshUrl = result.data[1].url;
            await log(`Found textured mesh URL in result.data[1].url: ${texturedMeshUrl}`);
          }
          
          // Log all items in the result for debugging
          await log(`Result contains ${result.data.length} items`);
          for (let i = 0; i < result.data.length; i++) {
            if (result.data[i] && typeof result.data[i] === 'object' && result.data[i].url) {
              await log(`Item ${i} has URL: ${result.data[i].url}`);
            } else if (result.data[i] && typeof result.data[i] === 'string') {
              await log(`Item ${i} is a string (likely HTML)`);
            } else {
              await log(`Item ${i} type: ${typeof result.data[i]}`);
            }
          }
        }
      }
      // Skip downloading white mesh, we only want the textured mesh
      await log(`Skipping white mesh download, focusing on textured mesh only`);
      
      // Download textured mesh if available
      if (texturedMeshUrl) {
        await log(`\n--- Handling Textured Mesh Download ---`);
        await log(`Found textured mesh URL (Downloadbutton component): ${texturedMeshUrl}`);
        
        // Determine file extension from URL
        const fileExt = texturedMeshUrl.split('.').pop() || 'glb';
        
        // Fetch the file
        const headers = { Authorization: `Bearer ${hfToken}` };
        await log(`Fetching textured mesh from URL: ${texturedMeshUrl}`);
        const response = await fetch(texturedMeshUrl, { headers });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const filePath = path.join(testDir, `hunyuan3d_textured_mesh_${Date.now()}.${fileExt}`);
          await fs.writeFile(filePath, Buffer.from(buffer));
          
          await log(`Textured mesh saved to: ${filePath}`);
          await log(`Textured mesh size: ${buffer.byteLength} bytes`);
          
          // Explain how to initiate the Downloadbutton in the UI
          await log(`\n--- Downloadbutton Component Information ---`);
          await log(`In the Hunyuan3D-2 UI, the textured mesh is available via the "Download Textured Mesh" button`);
          await log(`This is the second Downloadbutton component in the UI (index 1 in the API response)`);
          await log(`We've successfully downloaded the file programmatically from the URL: ${texturedMeshUrl}`);
          
          // Try to simulate clicking the download button via API
          try {
            await log(`\n--- Attempting to simulate Downloadbutton click via API ---`);
            // This is a direct download, not a button click simulation
            await log(`Direct download already completed. The Downloadbutton in the UI would download the same file.`);
          } catch (buttonError) {
            await log(`Note: Button click simulation not needed as we already have the file`);
          }
        } else {
          await log(`Failed to fetch textured mesh: ${response.status} ${response.statusText}`);
        }
      } else {
        await log(`No textured mesh URL found in the result`);
      }
    } catch (error) {
      await log(`Error in generation_all: ${error.message}`);
      await log(`Error stack: ${error.stack || 'No stack trace available'}`);
      await log(`This might be due to a bug in the space. Let's try to get the white mesh first and then add texture.`);
      
      // Try generation_all as fallback
      await log("\n--- Trying shape_generation as fallback ---");
      try {
        const result = await client.predict("/shape_generation", [
          prompt,           // caption
          imageFileObj,     // image
          20,               // steps (lower is faster)
          5.5,              // guidance_scale
          1234,             // seed
          "256",            // octree_resolution (as string)
          true              // check_box_rembg
        ]);
        
        const endTime = Date.now();
        await log(`Generation completed in ${(endTime - startTime) / 1000} seconds`);
        
        // Process result
        await log(`Generation result type: ${typeof result}`);
        await log(`Result: ${JSON.stringify(result)}`);
        
        // Extract URL from the result structure
        let fileUrl = null;
        
        if (typeof result === 'object') {
          // Check if it's a Gradio response object
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            // For Hunyuan3D-2 space
            if (result.data[0] && result.data[0].url) {
              fileUrl = result.data[0].url;
              await log(`Found file URL in result.data[0].url: ${fileUrl}`);
            }
            // For Hunyuan3D-2mini-Turbo space
            else if (result.data[0] && result.data[0].value && result.data[0].value.url) {
              fileUrl = result.data[0].value.url;
              await log(`Found file URL in result.data[0].value.url: ${fileUrl}`);
            }
          }
        }
        
        if (fileUrl) {
          // Determine file extension from URL
          const fileExt = fileUrl.split('.').pop() || 'glb';
          
          // Fetch the file
          const headers = { Authorization: `Bearer ${hfToken}` };
          await log(`Fetching file from URL: ${fileUrl}`);
          const response = await fetch(fileUrl, { headers });
          
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const filePath = path.join(testDir, `hunyuan3d_result_${Date.now()}.${fileExt}`);
            await fs.writeFile(filePath, Buffer.from(buffer));
            
            await log(`File saved to: ${filePath}`);
            await log(`File size: ${buffer.byteLength} bytes`);
          } else {
            await log(`Failed to fetch file: ${response.status} ${response.statusText}`);
          }
        } else {
          await log(`No file URL found in the result`);
        }
      } catch (fallbackError) {
        await log(`Error in shape_generation fallback: ${fallbackError.message}`);
      }
    }
    
    await log("Hunyuan3D-2 test completed");
    
  } catch (error) {
    await log(`Error in Hunyuan3D-2 test: ${error.message}`);
    await log(`Error stack: ${error.stack}`);
  }
}

// Test Hunyuan3D-2mini-Turbo space
async function testHunyuan3DMiniTurboSpace(hfToken, prompt, testDir, log, imageFileObj) {
  try {
    // Connect to Hunyuan3D-2mini-Turbo space
    const modelSpace = process.env.HUNYUAN3D_MINI_SPACE || "mubarak-alketbi/Hunyuan3D-2mini-Turbo";
    await log(`Connecting to Hunyuan3D-2mini-Turbo space: ${modelSpace}`);
    
    // Authentication options
    const authOptions = { hf_token: hfToken };
    
    // Connect to the space
    const client = await Client.connect(modelSpace, authOptions);
    await log("Successfully connected to Hunyuan3D-2mini-Turbo space");
    
    // Add a longer delay for space startup
    await log("Waiting 45 seconds for space startup...");
    await new Promise(resolve => setTimeout(resolve, 45000));
    await log("Space startup delay completed");
    
    // Set generation mode to Turbo
    await log("\n--- Setting Generation Mode to Turbo ---");
    const modeResult = await client.predict("/on_gen_mode_change", ["Turbo"]);
    await log(`Mode set to Turbo, result: ${JSON.stringify(modeResult)}`);
    
    // Test generation_all endpoint to get 3D models with textures
    await log("\n--- Testing generation_all Endpoint ---");
    
    // Add a longer delay before generation
    await log("Waiting 45 seconds before generation to avoid GPU quota issues...");
    await new Promise(resolve => setTimeout(resolve, 45000));
    await log("Pre-generation delay completed");
    
    // Try generation_all first to get textured mesh
    await log(`Calling generation_all with prompt: "${prompt}" to get both white and textured meshes`);
    let generationStartTime = Date.now();
    
    try {
      // Based on API analysis, Hunyuan3D-2mini-Turbo generation_all takes these parameters:
      const result = await client.predict("/generation_all", [
        prompt,           // caption
        imageFileObj,     // image
        null,             // mv_image_front
        null,             // mv_image_back
        null,             // mv_image_left
        null,             // mv_image_right
        5,                // steps (Turbo mode)
        5.0,              // guidance_scale
        1234,             // seed
        256,              // octree_resolution (as number)
        true,             // check_box_rembg
        8000,             // num_chunks
        true              // randomize_seed
      ]);
      
      const generationEndTime = Date.now();
      await log(`Generation completed in ${(generationEndTime - generationStartTime) / 1000} seconds`);
      
      // Process result
      await log(`Generation result type: ${typeof result}`);
      await log(`Result: ${JSON.stringify(result)}`);
      
      // Extract URLs from the result structure
      let whiteMeshUrl = null;
      let texturedMeshUrl = null;
      
      if (typeof result === 'object') {
        // Check if it's a Gradio response object
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          // Log all items in the result for debugging
          await log(`Result contains ${result.data.length} items`);
          for (let i = 0; i < result.data.length; i++) {
            if (result.data[i] && typeof result.data[i] === 'object') {
              if (result.data[i].url) {
                await log(`Item ${i} has URL: ${result.data[i].url}`);
              } else if (result.data[i].value && result.data[i].value.url) {
                await log(`Item ${i} has value.url: ${result.data[i].value.url}`);
              } else {
                await log(`Item ${i} is an object without URL`);
              }
            } else if (result.data[i] && typeof result.data[i] === 'string') {
              await log(`Item ${i} is a string (likely HTML)`);
            } else {
              await log(`Item ${i} type: ${typeof result.data[i]}`);
            }
          }
          
          // For Hunyuan3D-2mini-Turbo space, we're only interested in the textured mesh (second item)
          // Skip the white mesh (first item)
          await log(`Skipping white mesh extraction, focusing on textured mesh only`);
          
          // For Hunyuan3D-2mini-Turbo space, the second item should be the textured mesh
          if (result.data[1] && result.data[1].value && result.data[1].value.url) {
            texturedMeshUrl = result.data[1].value.url;
            await log(`Found textured mesh URL in result.data[1].value.url: ${texturedMeshUrl}`);
          } else if (result.data[1] && typeof result.data[1] === 'object' && result.data[1].url) {
            texturedMeshUrl = result.data[1].url;
            await log(`Found textured mesh URL in result.data[1].url: ${texturedMeshUrl}`);
          } else {
            await log(`Textured mesh URL not found in expected location. Checking all items...`);
            
            // Try to find any URL that might be the textured mesh
            for (let i = 1; i < result.data.length; i++) { // Start from index 1 to skip white mesh
              if (result.data[i] && typeof result.data[i] === 'object') {
                if (result.data[i].url && result.data[i].url.includes('textured_mesh')) {
                  texturedMeshUrl = result.data[i].url;
                  await log(`Found textured mesh URL in result.data[${i}].url: ${texturedMeshUrl}`);
                  break;
                } else if (result.data[i].value && result.data[i].value.url && result.data[i].value.url.includes('textured_mesh')) {
                  texturedMeshUrl = result.data[i].value.url;
                  await log(`Found textured mesh URL in result.data[${i}].value.url: ${texturedMeshUrl}`);
                  break;
                }
              }
            }
          }
        }
      }
      
      // Skip downloading white mesh, we only want the textured mesh
      await log(`Skipping white mesh download, focusing on textured mesh only`);
      
      // Download textured mesh if available
      if (texturedMeshUrl && generatedFile === null) {
        await log(`\n--- Handling Textured Mesh Download ---`);
        await log(`Found textured mesh URL (Downloadbutton component): ${texturedMeshUrl}`);
        
        // Determine file extension from URL
        const fileExt = texturedMeshUrl.split('.').pop() || 'glb';
        
        // Fetch the file
        const headers = { Authorization: `Bearer ${hfToken}` };
        await log(`Fetching textured mesh from URL: ${texturedMeshUrl}`);
        const response = await fetch(texturedMeshUrl, { headers });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const filePath = path.join(testDir, `hunyuan3d_mini_textured_mesh_${Date.now()}.${fileExt}`);
          await fs.writeFile(filePath, Buffer.from(buffer));
          
          await log(`Textured mesh saved to: ${filePath}`);
          await log(`Textured mesh size: ${buffer.byteLength} bytes`);
          
          // Save for export (use textured mesh instead of white mesh)
          if (buffer.byteLength > 1024) {
            generatedFile = {
              buffer: Buffer.from(buffer),
              path: filePath
            };
            await log(`Saved textured mesh for potential export`);
          }
          
          // Explain how to initiate the Downloadbutton in the UI
          await log(`\n--- Downloadbutton Component Information ---`);
          await log(`In the Hunyuan3D-2Mini UI, the textured mesh is available via the second download button`);
          await log(`This is the second Downloadbutton component in the UI (index 1 in the API response)`);
          await log(`We've successfully downloaded the file programmatically from the URL: ${texturedMeshUrl}`);
          
          // Try to simulate clicking the download button via API
          try {
            await log(`\n--- Attempting to simulate Downloadbutton click via API ---`);
            // This is a direct download, not a button click simulation
            await log(`Direct download already completed. The Downloadbutton in the UI would download the same file.`);
          } catch (buttonError) {
            await log(`Note: Button click simulation not needed as we already have the file`);
          }
        } else {
          await log(`Failed to fetch textured mesh: ${response.status} ${response.statusText}`);
        }
      } else {
        await log(`No textured mesh URL found in the result`);
      }
      
      // If we got the textured mesh, we don't need to try shape_generation
      if (texturedMeshUrl) {
        await log("Successfully got textured mesh from generation_all");
        await log("Hunyuan3D-2mini-Turbo test completed");
        return;
      } else {
        await log("Did not get textured mesh from generation_all, falling back to shape_generation");
      }
    } catch (error) {
      await log(`Error in generation_all: ${error.message}`);
      await log(`Error stack: ${error.stack || 'No stack trace available'}`);
      await log(`Falling back to shape_generation`);
    }
    
    // Add a longer delay before generation
    await log("Waiting 45 seconds before generation to avoid GPU quota issues...");
    await new Promise(resolve => setTimeout(resolve, 45000));
    await log("Pre-generation delay completed");
    
    // Initialize variable to store generated file for export
    let generatedFile = null;
    
    // First generate the white mesh using shape_generation
    await log(`Calling shape_generation with prompt: "${prompt}" to get white mesh`);
    const shapeStartTime = Date.now();
    
    try {
      // Based on API analysis, Hunyuan3D-2mini-Turbo shape_generation takes these parameters:
      // We'll use shape_generation since texture_generation doesn't exist
      await log(`Using shape_generation to get white mesh`);
      
      const result = await client.predict("/shape_generation", [
        prompt,           // caption
        imageFileObj,     // image
        null,             // mv_image_front
        null,             // mv_image_back
        null,             // mv_image_left
        null,             // mv_image_right
        5,                // steps (Turbo mode)
        5.0,              // guidance_scale
        1234,             // seed
        256,              // octree_resolution (as number)
        true,             // check_box_rembg
        8000,             // num_chunks
        true              // randomize_seed
      ]);
      
      const shapeEndTime = Date.now();
      await log(`Generation completed in ${(shapeEndTime - shapeStartTime) / 1000} seconds`);
      
      // Process result
      await log(`Generation result type: ${typeof result}`);
      await log(`Result: ${JSON.stringify(result)}`);
      
      // Extract URL from the result structure for Hunyuan3D-2mini-Turbo
      let fileUrl = null;
      
      if (typeof result === 'object') {
        // Check if it's a Gradio response object
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          // Look for textured mesh URL
          for (let i = 0; i < result.data.length; i++) {
            if (result.data[i] && typeof result.data[i] === 'object') {
              if (result.data[i].url && (result.data[i].url.includes('textured_mesh') || i === 1)) {
                fileUrl = result.data[i].url;
                await log(`Found textured mesh URL in result.data[${i}].url: ${fileUrl}`);
                break;
              } else if (result.data[i].value && result.data[i].value.url &&
                        (result.data[i].value.url.includes('textured_mesh') || i === 1)) {
                fileUrl = result.data[i].value.url;
                await log(`Found textured mesh URL in result.data[${i}].value.url: ${fileUrl}`);
                break;
              }
            }
          }
          
          // If no textured mesh found, try the second item as fallback
          if (!fileUrl && result.data[1]) {
            if (result.data[1].url) {
              fileUrl = result.data[1].url;
              await log(`Using second item URL as fallback: ${fileUrl}`);
            } else if (result.data[1].value && result.data[1].value.url) {
              fileUrl = result.data[1].value.url;
              await log(`Using second item value.url as fallback: ${fileUrl}`);
            }
          }
        }
      }
      
      if (fileUrl) {
        // Determine file extension from URL
        const fileExt = fileUrl.split('.').pop() || 'glb';
        
        // Fetch the file
        const headers = { Authorization: `Bearer ${hfToken}` };
        await log(`Fetching textured mesh from URL: ${fileUrl}`);
        const response = await fetch(fileUrl, { headers });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const filePath = path.join(testDir, `hunyuan3d_mini_textured_mesh_${Date.now()}.${fileExt}`);
          await fs.writeFile(filePath, Buffer.from(buffer));
          
          await log(`Textured mesh saved to: ${filePath}`);
          await log(`Textured mesh size: ${buffer.byteLength} bytes`);
          
          // Save for export
          if (buffer.byteLength > 1024) {
            generatedFile = {
              buffer: Buffer.from(buffer),
              path: filePath
            };
            await log(`Saved textured mesh for potential export`);
          }
        } else {
          await log(`Failed to fetch textured mesh: ${response.status} ${response.statusText}`);
        }
      } else {
        await log(`No textured mesh URL found in the result`);
      }
    } catch (error) {
      await log(`Error in generation_all: ${error.message}`);
      await log(`This might be due to a GPU quota issue. Let's try to get the white mesh first and then add texture.`);
      
      // Try generation_all as fallback
      await log("\n--- Trying shape_generation as fallback ---");
      try {
        await log("Skipping generation_all fallback");
        
        const shapeEndTime = Date.now();
        await log(`Generation completed in ${(shapeEndTime - shapeStartTime) / 1000} seconds`);
        
        // Process result
        await log(`Generation result type: ${typeof result}`);
        await log(`Result: ${JSON.stringify(result)}`);
        
        // Extract URL from the result structure
        let fileUrl = null;
        
        if (typeof result === 'object') {
          // Check if it's a Gradio response object
          if (result.data && Array.isArray(result.data) && result.data.length > 0) {
            // For Hunyuan3D-2 space
            if (result.data[0] && result.data[0].url) {
              fileUrl = result.data[0].url;
              await log(`Found file URL in result.data[0].url: ${fileUrl}`);
            }
            // For Hunyuan3D-2mini-Turbo space
            else if (result.data[0] && result.data[0].value && result.data[0].value.url) {
              fileUrl = result.data[0].value.url;
              await log(`Found file URL in result.data[0].value.url: ${fileUrl}`);
            }
          }
        }
        
        if (fileUrl) {
          // Determine file extension from URL
          const fileExt = fileUrl.split('.').pop() || 'glb';
          
          // Fetch the file
          const headers = { Authorization: `Bearer ${hfToken}` };
          await log(`Fetching textured mesh from URL: ${fileUrl}`);
          const response = await fetch(fileUrl, { headers });
          
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const filePath = path.join(testDir, `hunyuan3d_mini_textured_mesh_${Date.now()}.${fileExt}`);
            await fs.writeFile(filePath, Buffer.from(buffer));
            
            await log(`Textured mesh saved to: ${filePath}`);
            await log(`Textured mesh size: ${buffer.byteLength} bytes`);
            
            // Save for export
            if (buffer.byteLength > 1024) {
              generatedFile = {
                buffer: Buffer.from(buffer),
                path: filePath
              };
              await log(`Saved textured mesh for potential export`);
            }
          } else {
            await log(`Failed to fetch file: ${response.status} ${response.statusText}`);
          }
        } else {
          await log(`No file URL found in the result`);
        }
      } catch (fallbackError) {
        await log(`Error in shape_generation fallback: ${fallbackError.message}`);
      }
    }
    
    // Try to export the model if we have a generated file
    await log("\n--- Testing on_export_click Endpoint ---");
    if (generatedFile) {
      await log("Found generated file, attempting to export model...");
      
      // Add a delay before export
      await log("Waiting 10 seconds before export...");
      await new Promise(resolve => setTimeout(resolve, 10000));
      await log("Export delay completed");
      
      try {
        // Create file objects for export
        const fileObj1 = new File([generatedFile.buffer], path.basename(generatedFile.path), { type: "model/gltf-binary" });
        const fileObj2 = new File([generatedFile.buffer], path.basename(generatedFile.path), { type: "model/gltf-binary" });
        
        // Log the file objects
        await log(`Created file objects for export: ${fileObj1.name}, ${fileObj1.type}, ${fileObj1.size} bytes`);
        
        // Set export_texture to true to get textured mesh
        await log(`Exporting with texture enabled`);
        
        // The file_type parameter should be a string, not a path
        await log(`Using file_type="glb" instead of the file path`);
        
        const exportResult = await client.predict("/on_export_click", [
          fileObj1,
          fileObj2,
          "glb",  // file_type - use the string "glb" not the file path
          false,  // reduce_face
          true,   // export_texture - set to true to get textured mesh
          10000   // target_face_num
        ]);
        
        await log(`Export result type: ${typeof exportResult}`);
        await log(`Export result: ${JSON.stringify(exportResult)}`);
        
        // Extract URL from the export result for textured mesh
        let texturedMeshUrl = null;
        
        if (typeof exportResult === 'object') {
          // Check if it's a Gradio response object
          if (exportResult.data && Array.isArray(exportResult.data) && exportResult.data.length > 0) {
            // Look for download button URL (should be the second item)
            if (exportResult.data[1] && exportResult.data[1].url) {
              texturedMeshUrl = exportResult.data[1].url;
              await log(`Found textured mesh URL in exportResult.data[1].url: ${texturedMeshUrl}`);
            }
          }
        }
        
        // Download textured mesh if available
        if (texturedMeshUrl) {
          // Determine file extension from URL
          const fileExt = texturedMeshUrl.split('.').pop() || 'glb';
          
          // Fetch the file
          await log(`Fetching textured mesh from URL: ${texturedMeshUrl}`);
          const response = await fetch(texturedMeshUrl, { headers });
          
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const filePath = path.join(testDir, `hunyuan3d_mini_textured_mesh_${Date.now()}.${fileExt}`);
            await fs.writeFile(filePath, Buffer.from(buffer));
            
            await log(`Textured mesh saved to: ${filePath}`);
            await log(`Textured mesh size: ${buffer.byteLength} bytes`);
          } else {
            await log(`Failed to fetch textured mesh: ${response.status} ${response.statusText}`);
          }
        } else {
          await log(`No textured mesh URL found in the export result`);
        }
        
        // Extract URL from the export result
        let exportUrl = null;
        
        if (typeof exportResult === 'object') {
          // Check if it's a Gradio response object
          if (exportResult.data && Array.isArray(exportResult.data) && exportResult.data.length > 0) {
            // Look for download button URL
            for (let i = 0; i < exportResult.data.length; i++) {
              if (exportResult.data[i] && exportResult.data[i].url) {
                exportUrl = exportResult.data[i].url;
                await log(`Found export URL in result.data[${i}].url: ${exportUrl}`);
                break;
              }
            }
          }
        }
        
        if (exportUrl) {
          // Determine file extension from URL
          const fileExt = exportUrl.split('.').pop() || 'glb';
          
          // Fetch the file
          const headers = { Authorization: `Bearer ${hfToken}` };
          await log(`Fetching export file from URL: ${exportUrl}`);
          const response = await fetch(exportUrl, { headers });
          
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const filePath = path.join(testDir, `hunyuan3d_mini_export_${Date.now()}.${fileExt}`);
            await fs.writeFile(filePath, Buffer.from(buffer));
            
            await log(`Export file saved to: ${filePath}`);
            await log(`Export file size: ${buffer.byteLength} bytes`);
          } else {
            await log(`Failed to fetch export file: ${response.status} ${response.statusText}`);
          }
        } else {
          await log(`No export URL found in the result`);
        }
      } catch (error) {
        await log(`Error in export: ${error.message}`);
        await log(`Error stack: ${error.stack}`);
      }
    } else {
      await log("No generated file found for export");
    }
    
    await log("Hunyuan3D-2mini-Turbo test completed");
    
  } catch (error) {
    await log(`Error in Hunyuan3D-2mini-Turbo test: ${error.message}`);
    await log(`Error stack: ${error.stack}`);
  }
}

// Run the main function
main().then(() => {
  console.log("Hunyuan spaces test completed");
  console.log("Check the test_output directory for results and hunyuan_test_log.txt for detailed logs");
}).catch((error) => {
  console.error(`Unhandled error: ${error.message}`);
  console.error(`Error stack: ${error.stack}`);
});