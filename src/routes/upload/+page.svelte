<!-- src/routes/upload/+page.svelte -->
<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Loading libraries...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01"; // Default path

  // Holds our unrar capabilities once loaded
  let unrar = null; // { createExtractorFromData, wasmBinary }

  onMount(async () => {
    try {
      status = "Loading Unrar WASM...";
      
      // 1. Fetch the WASM binary directly
      const wasmRes = await fetch('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/unrar.wasm');
      if (!wasmRes.ok) throw new Error("Failed to download unrar.wasm");
      const wasmBinary = await wasmRes.arrayBuffer();

      // 2. Import the main ESM entry point
      // Note: We use the '/index.js' entry which properly exports createExtractorFromData
      const mod = await import('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/index.js');
      
      if (typeof mod.createExtractorFromData !== 'function') {
         throw new Error("Module does not export createExtractorFromData");
      }

      // Store them for use in extractCBR
      unrar = { 
        createExtractorFromData: mod.createExtractorFromData, 
        wasmBinary 
      };

      status = "Ready! Drag a .CBZ or .CBR file here.";
    } catch (err) {
      console.error("Failed to load CBR support:", err);
      status = "Ready (CBZ only - CBR support failed to load).";
    }
  });

  async function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    
    if (!file) {
      alert("Please upload a file!");
      return;
    }

    const fileName = file.name.toLowerCase();
    const isCBZ = fileName.endsWith('.cbz');
    const isCBR = fileName.endsWith('.cbr');

    if (!isCBZ && !isCBR) {
      alert("Please upload a .cbz or .cbr file!");
      return;
    }

    if (isCBR && !unrar) {
      alert("CBR support is not available (module failed to load). Please use CBZ.");
      return;
    }

    if (!folderPath) {
      alert("Please type the target folder path first!");
      return;
    }

    // Remove trailing slash if user added one
    const cleanPath = folderPath.replace(/\/$/, "");

    isUploading = true;
    status = `Extracting ${isCBZ ? 'CBZ' : 'CBR'} file locally...`;

    try {
      let filesToUpload = [];

      if (isCBZ) {
        filesToUpload = await extractCBZ(file);
      } else if (isCBR) {
        filesToUpload = await extractCBR(file);
      }

      if (filesToUpload.length === 0) {
        throw new Error("No valid images found in archive!");
      }

      status = `Uploading ${filesToUpload.length} pages to ${cleanPath}...`;
      
      for (let i = 0; i < filesToUpload.length; i++) {
        const item = filesToUpload[i];
        status = `Uploading ${i + 1}/${filesToUpload.length}: ${item.name}...`;
        await uploadFile(item.name, item.blob, cleanPath);
      }

      status = "✅ Success! All pages uploaded.";

    } catch (err) {
      console.error(err);
      status = "❌ Error: " + err.message;
    } finally {
      isUploading = false;
    }
  }

  async function extractCBZ(file) {
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const filesToUpload = [];
    let pageIndex = 1;
    
    // Sort file names to ensure correct page order
    const fileNames = Object.keys(content.files).sort();

    for (const fileName of fileNames) {
      const fileData = content.files[fileName];
      
      // Skip directories and Mac metadata
      if (!fileData.dir && !fileName.startsWith('__MACOSX') && !fileName.includes('/.')) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
          const blob = await fileData.async('blob');
          const ext = fileName.split('.').pop();
          
          // Rename: page_001_de.jpg
          const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
          filesToUpload.push({ name: newName, blob });
          pageIndex++;
        }
      }
    }
    return filesToUpload;
  }

  async function extractCBR(file) {
    // 1. Read file as ArrayBuffer
    const data = await file.arrayBuffer();

    // 2. Create the extractor using the loaded module and WASM binary
    const extractor = await unrar.createExtractorFromData({ 
      data: data,
      wasmBinary: unrar.wasmBinary 
    });

    // 3. Get file list
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders]; // Iterate to get all headers

    const filesToUpload = [];
    let pageIndex = 1;

    // 4. Sort headers naturally to ensure page order
    const sortedHeaders = fileHeaders.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    // 5. Extract files one by one
    for (const header of sortedHeaders) {
      if (header.flags.directory || header.name.startsWith('__MACOSX')) continue;
      
      const lowerName = header.name.toLowerCase();
      if (!lowerName.match(/\.(jpg|jpeg|png|webp|gif)$/)) continue;

      // Extract specific file
      const extracted = extractor.extract({ files: [header.name] });
      const files = [...extracted.files]; // Iterate to get content
      
      if (files[0] && files[0].extraction) {
        const ext = header.name.split('.').pop();
        const blob = new Blob([files[0].extraction]);
        
        const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
        filesToUpload.push({ name: newName, blob });
        pageIndex++;
      }
    }

    return filesToUpload;
  }

  async function uploadFile(filename, blob, path) {
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('filename', filename);
    formData.append('folderPath', path);

    const res = await fetch('/api/upload-r2', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
        // Try to parse error message safely
        let errorMsg = 'Upload failed';
        try {
            const err = await res.json();
            errorMsg = err.error || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
    }
  }
</script>

<div style="padding: 2rem; max-width: 600px; margin: 0 auto; font-family: sans-serif;">
  <h1>Manga Upload Tool</h1>
  
  <div style="margin-bottom: 20px;">
    <label style="display:block; font-weight:bold;">Target Folder Path:</label>
    <input 
      type="text" 
      bind:value={folderPath} 
      placeholder="e.g. MAD/Love Trouble/Band 01"
      style="width: 100%; padding: 10px; margin-top:5px;"
    />
    <small style="color: #666;">Files will be saved to: de>{folderPath || '...'}/page_001_de.jpg</code></small>
  </div>

  <div 
    on:drop={handleDrop} 
    on:dragover={(e) => e.preventDefault()}
    style="border: 3px dashed #ccc; padding: 50px; text-align: center; border-radius: 10px; background: #f9f9f9; transition: background 0.2s;"
    class:uploading={isUploading}
  >
    <h2>{isUploading ? '⏳ Processing...' : '📂 Drag .CBZ or .CBR File Here'}</h2>
    <p>{status}</p>
  </div>
</div>

<style>
    .uploading {
        background: #e6f7ff !important;
        border-color: #1890ff !important;
    }
</style>
