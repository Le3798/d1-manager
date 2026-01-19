<script>
  import JSZip from 'jszip';
  import { onMount } from 'svelte';

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";
  
  // State for LibArchive
  let libarchiveReady = false;
  let Archive = null; // We will load the class into here

  onMount(async () => {
    try {
      // 1. Dynamic Import for the main library (Modern ES Module)
      // Note: We use the 'main.js' entry point which exports { Archive }
      const module = await import('https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/main.js');
      Archive = module.Archive;

      // 2. Define CDN URLs
      const cdnBase = 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist';
      const workerUrl = `${cdnBase}/worker-bundle.js`;
      const wasmUrl = `${cdnBase}/libarchive.wasm`;

      // 3. Create a Blob Worker to bypass Cross-Origin Worker restrictions
      // We also inject 'Module.locateFile' so the worker finds the WASM file correctly
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

      // 4. Initialize LibArchive with our local blob worker
      Archive.init({
        workerUrl: localWorkerUrl
      });

      libarchiveReady = true;
      status = "Ready! Drag a .CBZ or .CBR file here.";

    } catch (e) {
      console.error("LibArchive loading failed:", e);
      status = "Warning: CBR support failed (Network/CSP Error). CBZ only.";
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
      alert("CBR support failed to load. Please check console for network errors.");
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
    
    // Natural sort (1, 2, 10 instead of 1, 10, 2)
    const fileNames = Object.keys(content.files).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let pageIndex = 1;

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
    // Use the Archive class we loaded dynamically
    const archive = await Archive.open(file);
    let extractedObj = null;

    try {
        extractedObj = await archive.extractFiles();
    } catch (e) {
        throw new Error("Failed to extract CBR. File might be corrupted or encrypted.");
    }
    
    const filesToUpload = [];
    
    // Natural sort for correct page ordering
    const sortedFilenames = Object.keys(extractedObj).sort((a, b) => 
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let pageIndex = 1;

    for (const fileName of sortedFilenames) {
      if (fileName.startsWith('__MACOSX') || fileName.includes('/.') || fileName.includes('.DS_Store')) continue;
      
      const lowerName = fileName.toLowerCase();
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
