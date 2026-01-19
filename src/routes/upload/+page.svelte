<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  
  // State for LibArchive
  let libarchiveReady = false;
  let Archive = null; 

  onMount(async () => {
    try {
      // 1. Dynamic Import
      const module = await import('https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/main.js');
      Archive = module.Archive;

      // 2. Define CDN URLs
      const cdnBase = 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist';
      const workerUrl = `${cdnBase}/worker-bundle.js`;
      const wasmUrl = `${cdnBase}/libarchive.wasm`;

      // 3. Blob Proxy (Fixes "CBR support not ready" / CORS issues)
      const blobCode = `
        self.Module = {
            locateFile: function(path) {
                if (path.endsWith('.wasm')) return '${wasmUrl}';
                return path;
            }
        };
        importScripts('${workerUrl}');
      `;
      const blob = new Blob([blobCode], { type: 'application/javascript' });
      const localWorkerUrl = URL.createObjectURL(blob);

      // 4. Initialize
      Archive.init({ workerUrl: localWorkerUrl });

      libarchiveReady = true;
      status = "Ready! Drag a .CBZ or .CBR file here.";

    } catch (e) {
      console.error("LibArchive loading failed:", e);
      status = "Warning: CBR support failed (Network Error). CBZ only.";
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
    if (isCBR && !libarchiveReady) return alert("CBR support is not ready yet.");
    if (!folderPath) return alert("Please type the target folder path first!");

    const cleanPath = folderPath.replace(/\/$/, "");
    isUploading = true;
    status = `Scanning ${isCBZ ? 'CBZ' : 'CBR'} structure...`;

    try {
      // Step 1: Get the LIST of files (fast), do not extract content yet
      let entryList = [];

      if (isCBZ) {
        entryList = await scanCBZ(file);
      } else if (isCBR) {
        entryList = await scanCBR(file);
      }

      if (entryList.length === 0) throw new Error("No valid images found!");

      status = `Found ${entryList.length} pages. Starting upload...`;
      
      // Step 2: Extract and Upload ONE BY ONE (prevents memory crash)
      for (let i = 0; i < entryList.length; i++) {
        const item = entryList[i];
        status = `Processing ${i + 1}/${entryList.length}: ${item.newName}...`;
        
        // Extract ONLY this file now
        const blob = await extractEntry(item);
        
        // Upload
        await uploadFile(item.newName, blob, cleanPath);
      }

      status = "✅ Success! All pages uploaded.";

    } catch (err) {
      console.error(err);
      status = "❌ Error: " + err.message;
    } finally {
      isUploading = false;
    }
  }

  // --- CBZ Scanner (JSZip) ---
  async function scanCBZ(file) {
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    
    // Natural Sort
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
            type: 'cbz',
            data: fileData, // Store reference, not blob
            newName: `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`
          });
          pageIndex++;
        }
      }
    }
    return entries;
  }

  // --- CBR Scanner (LibArchive) ---
  async function scanCBR(file) {
    const archive = await Archive.open(file);
    
    // key fix: getFilesArray() only reads headers, doesn't extract data
    const fileArray = await archive.getFilesArray(); 
    
    // Filter for images
    const imageFiles = fileArray.filter(item => {
        const name = item.file.name;
        return name && !name.startsWith('__MACOSX') && name.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    });

    // Natural Sort
    imageFiles.sort((a, b) => 
      a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    const entries = [];
    let pageIndex = 1;

    for (const item of imageFiles) {
      const ext = item.file.name.split('.').pop();
      entries.push({
        type: 'cbr',
        data: item.file, // This is a CompressedFile object
        newName: `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`
      });
      pageIndex++;
    }
    
    return entries;
  }

  // --- Unified Extractor ---
  async function extractEntry(entry) {
    if (entry.type === 'cbz') {
      return await entry.data.async('blob');
    } else {
      return await entry.data.extract(); // Extracts single file from CBR
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
    <p style="white-space: pre-wrap;">{status}</p>
  </div>
</div>

<style>
    .uploading {
        background: #e6f7ff !important;
        border-color: #1890ff !important;
    }
</style>
