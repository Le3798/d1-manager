<!-- src/routes/upload/+page.svelte -->
<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';
  
  let status = "Waiting for file...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  let unrarReady = false;
  let createExtractorFromData = null;

  onMount(async () => {
    try {
      // Load the WASM binary first
      const wasmResponse = await fetch('https://unpkg.com/node-unrar-js@2.0.2/esm/js/unrar.wasm');
      const wasmBinary = await wasmResponse.arrayBuffer();
      
      // Import the extractor module
      const module = await import('https://unpkg.com/node-unrar-js@2.0.2/esm/js/ExtractorData.js');
      
      // Create a wrapper that includes the WASM binary
      createExtractorFromData = async (options) => {
        return await module.default({ ...options, wasmBinary });
      };
      
      unrarReady = true;
      status = "Ready! Drag a .CBZ or .CBR file here.";
    } catch (err) {
      console.error('Failed to load unrar module:', err);
      status = "Ready! (CBR support unavailable - CBZ only)";
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

    if (isCBR && !unrarReady) {
      alert("CBR support is not available. Please use CBZ files.");
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

      status = `Uploading ${filesToUpload.length} pages to ${cleanPath}...`;
      
      for (const item of filesToUpload) {
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
      if (!fileData.dir && !fileName.startsWith('__MACOSX')) {
        const blob = await fileData.async('blob');
        const ext = fileName.split('.').pop();
        
        const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
        filesToUpload.push({ name: newName, blob });
        pageIndex++;
      }
    }

    return filesToUpload;
  }

  async function extractCBR(file) {
    const arrayBuffer = await file.arrayBuffer();
    const extractor = await createExtractorFromData({ data: arrayBuffer });
    
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];

    const filesToUpload = [];
    let pageIndex = 1;

    // Sort files by name
    const sortedFiles = fileHeaders.sort((a, b) => 
      a.name.localeCompare(b.name)
    );

    for (const fileHeader of sortedFiles) {
      // Skip directories and macOS metadata files
      if (fileHeader.flags.directory || fileHeader.name.startsWith('__MACOSX')) {
        continue;
      }

      const extracted = extractor.extract({ files: [fileHeader.name] });
      const files = [...extracted.files];
      
      if (files.length > 0 && files[0].extraction) {
        const ext = fileHeader.name.split('.').pop();
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
       const err = await res.json();
       throw new Error(err.error || 'Upload failed');
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
    style="border: 3px dashed #ccc; padding: 50px; text-align: center; border-radius: 10px; background: #f9f9f9;"
  >
    <h2>{isUploading ? '⏳ Processing...' : '📂 Drag .CBZ or .CBR File Here'}</h2>
    <p>{status}</p>
  </div>
</div>
