<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  
  let unrarReady = false;
  let createExtractorFromData = null;
  let wasmBinary = null;

  onMount(async () => {
    try {
      // 1. Import the ESM version of the library
      const unrarModule = await import('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/index.js');
      createExtractorFromData = unrarModule.createExtractorFromData;
      
      // 2. Load the WASM binary from the CORRECT path (directly in /esm/)
      const wasmResponse = await fetch('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/unrar.wasm');
      
      if (!wasmResponse.ok) {
        throw new Error(`Failed to load WASM: ${wasmResponse.statusText}`);
      }
      
      wasmBinary = await wasmResponse.arrayBuffer();
      
      unrarReady = true;
      status = "Ready! Drag a .CBZ or .CBR file here.";

    } catch (e) {
      console.error("Unrar loading failed:", e);
      status = "⚠️ Warning: CBR support failed. Check console for details. (CBZ only)";
    }
  });

  async function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    
    if (!file) return alert("Please upload a file!");
    
    const fileName = file.name.toLowerCase();
    const isCBZ = fileName.endsWith('.cbz');
    const isCBR = fileName.endsWith('.cbr');

    if (!isCBZ && !isCBR) return alert("Please upload a .cbz or .cbr file!");
    if (isCBR && !unrarReady) return alert("CBR support is not ready. Reload the page.");
    if (!folderPath) return alert("Please type the target folder path first!");

    const cleanPath = folderPath.replace(/\/$/, "");
    isUploading = true;

    try {
      if (isCBZ) {
        await processCBZ(file, cleanPath);
      } else if (isCBR) {
        await processCBR(file, cleanPath);
      }

      status = "✅ Success! All pages uploaded.";

    } catch (err) {
      console.error(err);
      status = "❌ Error: " + err.message;
    } finally {
      isUploading = false;
    }
  }

  async function processCBZ(file, cleanPath) {
    status = "Reading CBZ file...";
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    
    const fileNames = Object.keys(content.files).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let pageIndex = 1;
    const imagesToUpload = [];

    // Filter valid images first
    for (const fileName of fileNames) {
      const fileData = content.files[fileName];
      if (!fileData.dir && !fileName.startsWith('__MACOSX') && !fileName.includes('/.') && fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
          imagesToUpload.push({ fileName, fileData });
      }
    }

    if (imagesToUpload.length === 0) throw new Error("No valid images found!");
    status = `Found ${imagesToUpload.length} pages. Starting upload...`;

    // Upload sequentially
    for (let i = 0; i < imagesToUpload.length; i++) {
        const item = imagesToUpload[i];
        const ext = item.fileName.split('.').pop();
        const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
        
        status = `Uploading ${pageIndex}/${imagesToUpload.length}: ${newName}...`;
        
        const blob = await item.fileData.async('blob');
        await uploadFile(newName, blob, cleanPath);
        pageIndex++;
    }
  }

  async function processCBR(file, cleanPath) {
    status = "Reading CBR file...";
    const arrayBuffer = await file.arrayBuffer();
    
    status = "Creating extractor...";
    const extractor = await createExtractorFromData({
      data: arrayBuffer,
      wasmBinary: wasmBinary
    });
    
    status = "Scanning file list...";
    const list = extractor.getFileList();
    
    // Check for password protection
    if (list.arcHeader && list.arcHeader.flags && list.arcHeader.flags.password) {
        throw new Error("This CBR file is password protected. Cannot extract.");
    }

    const fileHeaders = [...list.fileHeaders];
    
    // Filter for images
    const imageHeaders = fileHeaders.filter(header => {
      const name = header.name;
      return name && 
             !name.startsWith('__MACOSX') && 
             !name.startsWith('.') &&
             name.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    });

    if (imageHeaders.length === 0) throw new Error("No valid images found!");

    // Natural sort the headers
    imageHeaders.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    status = `Found ${imageHeaders.length} pages. Starting sequential extract...`;

    // Process files sequentially to save memory
    for (let i = 0; i < imageHeaders.length; i++) {
      const header = imageHeaders[i];
      const ext = header.name.split('.').pop();
      const newName = `page_${String(i + 1).padStart(3, '0')}_de.${ext}`;

      status = `Processing ${i + 1}/${imageHeaders.length}: ${newName}...`;

      // Extract ONLY the current file
      const extracted = extractor.extract({ files: [header.name] });
      
      // Spread the iterator to force extraction and cleanup
      const files = [...extracted.files];

      if (files.length > 0 && files[0].extraction) {
          const fileData = files[0];
          const blob = new Blob([fileData.extraction], { 
            type: `image/${ext === 'jpg' ? 'jpeg' : ext}` 
          });

          await uploadFile(newName, blob, cleanPath);
      } else {
          console.warn(`Failed to extract: ${header.name}`);
      }
    }
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
    <small style="color: #666;">Files will be saved to: <code>{folderPath || '...'}/page_001_de.jpg</code></small>
  </div>

  <div 
    on:drop={handleDrop} 
    on:dragover={(e) => e.preventDefault()}
    style="border: 3px dashed #ccc; padding: 50px; text-align: center; border-radius: 10px; background: #f9f9f9; transition: background 0.2s;"
    class:uploading={isUploading}
  >
    <h2>{isUploading ? '⏳ Processing...' : '📂 Drag .CBZ or .CBR File Here'}</h2>
    <p style="white-space: pre-wrap;">{status}</p>
  </div>
</div>

<style>
  .uploading {
    background: #e6f7ff !important;
    border-color: #1890ff !important;
  }
</style>