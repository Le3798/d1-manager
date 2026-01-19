<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  
  // State for unrar
  let unrarReady = false;
  let unrarModule = null;

  onMount(async () => {
    try {
      // CORRECT: Load from /esm path and fetch WASM separately
      const module = await import('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/dist/js/unrar.js');
      
      // Fetch WASM binary
      const wasmResponse = await fetch('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/dist/js/unrar.wasm');
      const wasmBinary = await wasmResponse.arrayBuffer();
      
      unrarModule = { ...module, wasmBinary };
      unrarReady = true;
      status = "Ready! Drag a .CBZ or .CBR file here.";

    } catch (e) {
      console.error("Unrar loading failed:", e);
      status = "Warning: CBR support failed. CBZ only.";
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
    if (isCBR && !unrarReady) return alert("CBR support is not ready yet.");
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

  // --- CBZ Processing ---
  async function processCBZ(file, cleanPath) {
    status = "Reading CBZ file...";
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    
    const fileNames = Object.keys(content.files).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    const entries = [];
    let pageIndex = 1;

    for (const fileName of fileNames) {
      const fileData = content.files[fileName];
      if (!fileData.dir && !fileName.startsWith('__MACOSX') && !fileName.includes('/.')) {
        if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
          const ext = fileName.split('.').pop();
          entries.push({
            data: fileData,
            newName: `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`
          });
          pageIndex++;
        }
      }
    }

    if (entries.length === 0) throw new Error("No valid images found!");
    status = `Found ${entries.length} pages. Starting upload...`;

    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      status = `Uploading ${i + 1}/${entries.length}: ${item.newName}...`;
      const blob = await item.data.async('blob');
      await uploadFile(item.newName, blob, cleanPath);
    }
  }

  // --- CBR Processing (node-unrar-js) ---
  async function processCBR(file, cleanPath) {
    status = "Reading CBR file...";
    
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    status = "Extracting CBR archive...";
    
    // Create extractor with WASM binary
    const extractor = await unrarModule.createExtractorFromData({
      data: arrayBuffer,
      wasmBinary: unrarModule.wasmBinary
    });
    
    // Get file list
    const list = extractor.getFileList();
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

    // Natural sort
    imageHeaders.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    status = `Found ${imageHeaders.length} pages. Extracting...`;

    // Extract all files at once
    const extracted = extractor.extract({ 
      files: imageHeaders.map(h => h.name) 
    });
    
    const files = [...extracted.files];
    
    status = `Uploading ${files.length} pages...`;

    // Upload extracted files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.fileHeader.name.split('.').pop();
      const newName = `page_${String(i + 1).padStart(3, '0')}_de.${ext}`;
      
      status = `Uploading ${i + 1}/${files.length}: ${newName}...`;
      
      // Convert Uint8Array to Blob
      const blob = new Blob([file.extraction], { 
        type: `image/${ext === 'jpg' ? 'jpeg' : ext}` 
      });
      
      await uploadFile(newName, blob, cleanPath);
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
