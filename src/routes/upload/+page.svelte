<!-- src/routes/upload/+page.svelte -->
<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Loading libraries...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  
  // This will hold the unrar function and binary once loaded from CDN
  let unrar = null; 

  onMount(async () => {
    try {
      status = "Initializing Unrar...";
      
      // 1. Fetch the WASM binary from jsDelivr
      const wasmRes = await fetch('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/unrar.wasm');
      if (!wasmRes.ok) throw new Error("Failed to load WASM binary");
      const wasmBinary = await wasmRes.arrayBuffer();

      // 2. Import the library from jsDelivr
      // We import the specific ESM index to ensure we get the named export
      const mod = await import('https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/index.js');
      
      if (!mod.createExtractorFromData) {
        throw new Error("Library export 'createExtractorFromData' not found");
      }

      // 3. Store for use
      unrar = { 
        createExtractorFromData: mod.createExtractorFromData, 
        wasmBinary 
      };

      status = "Ready! Drag a .CBZ or .CBR file here.";
    } catch (err) {
      console.error("CBR init failed:", err);
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
      alert("CBR support is not available. Please use CBZ.");
      return;
    }

    if (!folderPath) {
      alert("Please type the target folder path first!");
      return;
    }

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
    const fileNames = Object.keys(content.files).sort();

    for (const fileName of fileNames) {
      const fileData = content.files[fileName];
      if (!fileData.dir && !fileName.startsWith('__MACOSX') && !fileName.includes('/.')) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
          const blob = await fileData.async('blob');
          const ext = fileName.split('.').pop();
          const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
          filesToUpload.push({ name: newName, blob });
          pageIndex++;
        }
      }
    }
    return filesToUpload;
  }

  async function extractCBR(file) {
    const data = await file.arrayBuffer();
    
    // Create extractor with the WASM binary we loaded manually
    const extractor = await unrar.createExtractorFromData({ 
      data: data,
      wasmBinary: unrar.wasmBinary 
    });

    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];

    const filesToUpload = [];
    let pageIndex = 1;

    // Sort files naturally (1, 2, 10 instead of 1, 10, 2)
    const sortedHeaders = fileHeaders.sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    for (const header of sortedHeaders) {
      if (header.flags.directory || header.name.startsWith('__MACOSX')) continue;
      
      const lowerName = header.name.toLowerCase();
      if (!lowerName.match(/\.(jpg|jpeg|png|webp|gif)$/)) continue;

      const extracted = extractor.extract({ files: [header.name] });
      const files = [...extracted.files];
      
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
        let errorMsg = 'Upload failed';
        try { const err = await res.json(); errorMsg = err.error || errorMsg; } catch (e) {}
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
    <p>{status}</p>
  </div>
</div>

<style>
    .uploading {
        background: #e6f7ff !important;
        border-color: #1890ff !important;
    }
</style>
