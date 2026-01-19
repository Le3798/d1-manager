<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  let libarchiveReady = false;

  onMount(async () => {
    // Load LibArchive.js from CDN
    try {
      if (!window.Archive) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist/libarchive.js';
        
        script.onload = () => {
          // Initialize worker with absolute URL
          window.Archive.init({
            workerUrl: 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist/worker-bundle.js'
          });
          libarchiveReady = true;
          status = "Ready! Drag a .CBZ or .CBR file here.";
        };
        
        script.onerror = () => {
          throw new Error("Failed to load LibArchive script");
        };
        
        document.head.appendChild(script);
      } else {
        // Already loaded
        if (!libarchiveReady) {
             window.Archive.init({
                workerUrl: 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist/worker-bundle.js'
             });
        }
        libarchiveReady = true;
        status = "Ready! Drag a .CBZ or .CBR file here.";
      }
    } catch (e) {
      console.error(e);
      status = "Warning: CBR support failed to load. CBZ only.";
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

    if (isCBR && !libarchiveReady) {
      alert("CBR support is not ready. Please wait or use CBZ.");
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

  // --- CBZ Extraction (JSZip) ---
  async function extractCBZ(file) {
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const filesToUpload = [];
    
    // Sort file names naturally (e.g. 1, 2, 10 instead of 1, 10, 2)
    const fileNames = Object.keys(content.files).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let pageIndex = 1;

    for (const fileName of fileNames) {
      const fileData = content.files[fileName];
      
      // Filter out directories and MacOS hidden files
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

  // --- CBR Extraction (LibArchive) ---
  async function extractCBR(file) {
    // Open the file with LibArchive
    const archive = await window.Archive.open(file);
    let extractedObj = null;

    // extractFiles() returns an object { filename: FileObject, ... }
    try {
        extractedObj = await archive.extractFiles();
    } catch (e) {
        throw new Error("Failed to extract CBR. File might be corrupted or encrypted.");
    }
    
    const filesToUpload = [];
    
    // Get keys and sort them naturally to ensure correct page order
    const sortedFilenames = Object.keys(extractedObj).sort((a, b) => 
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let pageIndex = 1;

    for (const fileName of sortedFilenames) {
      // Ignore hidden/system files
      if (fileName.startsWith('__MACOSX') || fileName.includes('/.') || fileName.includes('.DS_Store')) continue;
      
      const lowerName = fileName.toLowerCase();
      // Check for valid image extensions
      if (!lowerName.match(/\.(jpg|jpeg|png|webp|gif)$/)) continue;

      const fileData = extractedObj[fileName]; // This is a File object (Blob)
      const ext = fileName.split('.').pop();
      const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
      
      filesToUpload.push({ name: newName, blob: fileData });
      pageIndex++;
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
