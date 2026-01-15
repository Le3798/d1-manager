<!-- src/routes/upload/+page.svelte -->
<script>
  import JSZip from 'jszip';
  
  let status = "Waiting for file...";
  let isUploading = false;
  // Change default to empty or a helpful hint
  let folderPath = "MAD/Love Trouble/Band 01"; 

  async function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    
    if (!file || !file.name.endsWith('.cbz')) {
      alert("Please upload a .cbz file!");
      return;
    }

    if (!folderPath) {
      alert("Please type the target folder path first!");
      return;
    }

    // Remove trailing slash if user added one
    const cleanPath = folderPath.replace(/\/$/, "");

    isUploading = true;
    status = "Unzipping file locally...";

    try {
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
          
          // Rename: page_001_de.jpg
          const newName = `page_${String(pageIndex).padStart(3, '0')}_de.${ext}`;
          filesToUpload.push({ name: newName, blob });
          pageIndex++;
        }
      }

      status = `Uploading ${filesToUpload.length} pages to ${cleanPath}...`;
      
      for (const item of filesToUpload) {
        // Pass the CLEAN path
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

  async function uploadFile(filename, blob, path) {
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('filename', filename);
    formData.append('folderPath', path); // Send the full path

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
    <h2>{isUploading ? '⏳ Processing...' : '📂 Drag .CBZ File Here'}</h2>
    <p>{status}</p>
  </div>
</div>
