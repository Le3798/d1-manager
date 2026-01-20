<script lang="ts">
  import JSZip from "jszip";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";

  // --- TYPES ---
  interface QueueItem {
    id: string;
    name: string;
    status: 'pending' | 'scanning' | 'uploading' | 'done' | 'error';
    progress: number; // Current page count
    total: number;    // Total pages (0 until scanned)
    message: string;  // Detailed text (e.g. "Extracting...")
  }

  // --- STATE ---
  let basePath = ""; // e.g. "MAD/Naruto"
  let uploadQueue: QueueItem[] = [];
  let isProcessing = false;

  // --- UNRAR / WASM SETUP ---
  let unrarReady = false;
  let wasmBinary: ArrayBuffer | null = null;
  let createExtractorFromData: null | ((opts: any) => Promise<any>) = null;

  const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };

  onMount(async () => {
    if (!browser) return;

    try {
      const unrar = await import("node-unrar-js");
      createExtractorFromData = unrar.createExtractorFromData;

      const wasmMod = await import("node-unrar-js/esm/js/unrar.wasm?url");
      const unrarWasmUrl = wasmMod.default as string;

      const res = await fetch(unrarWasmUrl);
      if (!res.ok) throw new Error(`Failed to load WASM: ${res.status}`);
      wasmBinary = await res.arrayBuffer();

      unrarReady = true;
    } catch (e) {
      console.error("Unrar loading failed:", e);
      // We don't block the UI, just warn in logs
    }
  });

  // --- MAIN DROP HANDLER ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    if (!basePath || basePath.trim() === "") {
      return alert("⚠️ Please type the Series Base Path first!\nExample: MAD/One Piece");
    }
    const cleanBasePath = basePath.replace(/\/$/, "");

    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) return alert("Please upload files/folders.");

    // 1. Convert DropList to Array
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    // 2. Sort (Band 01, Band 02...)
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );

    // 3. Add to Queue
    const newItems: QueueItem[] = entries.map((entry) => ({
      id: crypto.randomUUID(),
      name: entry.name,
      status: 'pending',
      progress: 0,
      total: 0,
      message: 'Waiting...'
    }));

    uploadQueue = [...uploadQueue, ...newItems];

    // 4. Start Processing (if not already running)
    if (!isProcessing) {
      processQueue(cleanBasePath, entries);
    }
  }

  // --- QUEUE PROCESSOR ---
  async function processQueue(basePath: string, entries: FileSystemEntry[]) {
    isProcessing = true;

    // We loop through the NEW entries (mapped by index to the end of the queue)
    // Note: This logic assumes we process the batch that was just dropped.
    // Ideally, a true queue system would pull from the top, but this works for sequential drops.
    const startIndex = uploadQueue.length - entries.length;

    for (let i = 0; i < entries.length; i++) {
      const queueIndex = startIndex + i;
      const entry = entries[i];
      const item = uploadQueue[queueIndex];

      // Update UI: Starting
      updateItem(queueIndex, { status: 'scanning', message: 'Scanning files...' });

      try {
        if (entry.isDirectory) {
          await processDirectoryEntry(entry as FileSystemDirectoryEntry, basePath, queueIndex);
        } else if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject)
          );
          await processFileEntry(file, basePath, queueIndex);
        }
        
        // Update UI: Done
        updateItem(queueIndex, { status: 'done', message: 'Completed' });
      } catch (err: any) {
        console.error(err);
        updateItem(queueIndex, { status: 'error', message: err.message || 'Failed' });
      }
    }

    isProcessing = false;
  }

  //Helper to trigger Svelte reactivity
  function updateItem(index: number, updates: Partial<QueueItem>) {
    uploadQueue[index] = { ...uploadQueue[index], ...updates };
  }

  // --- HANDLERS (With Progress Updates) ---

  async function processDirectoryEntry(entry: FileSystemDirectoryEntry, basePath: string, qIdx: number) {
    const targetPath = `${basePath}/${entry.name}`;
    
    // Read files
    const files = await readAllDirectoryEntries(entry);
    const validImages = files
      .filter((f) => !f.name.startsWith(".") && IMAGE_EXT_RE.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (validImages.length === 0) throw new Error("No images found");

    // Set Total
    updateItem(qIdx, { status: 'uploading', total: validImages.length, message: 'Uploading...' });

    for (let i = 0; i < validImages.length; i++) {
      const fileEntry = validImages[i];
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));

      const ext = (file.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      
      // Update Progress
      updateItem(qIdx, { progress: i + 1, message: `Uploading ${newName}...` });
      
      await uploadFile(newName, file, targetPath);
    }
  }

  async function processFileEntry(file: File, basePath: string, qIdx: number) {
    const name = file.name.toLowerCase();
    const folderName = file.name.replace(/\.[^/.]+$/, ""); 
    const targetPath = `${basePath}/${folderName}`;

    if (name.endsWith(".cbz")) {
      await processCBZ(file, targetPath, qIdx);
    } else if (name.endsWith(".cbr")) {
      if (!unrarReady) throw new Error("CBR engine not ready (wasm missing)");
      await processCBR(file, targetPath, qIdx);
    } else {
      throw new Error("Ignored (Not a .cbz/.cbr file)");
    }
  }

  // --- ARCHIVE LOGIC ---

  async function processCBZ(file: File, targetPath: string, qIdx: number) {
    updateItem(qIdx, { message: 'Reading Zip...' });
    const zip = new JSZip();
    const content = await zip.loadAsync(file);

    const fileNames = Object.keys(content.files).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const images = [];
    for (const name of fileNames) {
      const entry = content.files[name];
      if (!entry.dir && !name.startsWith("__MACOSX") && !name.includes("/.") && IMAGE_EXT_RE.test(name)) {
        images.push({ name, entry });
      }
    }

    if (images.length === 0) throw new Error("No images in Zip");

    updateItem(qIdx, { status: 'uploading', total: images.length, message: 'Starting upload...' });

    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      const ext = (item.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      
      updateItem(qIdx, { progress: i + 1, message: `Uploading ${i + 1}/${images.length}` });
      
      const blob = await item.entry.async("blob");
      await uploadFile(newName, blob, targetPath);
    }
  }

  async function processCBR(file: File, targetPath: string, qIdx: number) {
    updateItem(qIdx, { message: 'Initializing Unrar...' });
    const arrayBuffer = await file.arrayBuffer();
    const extractor = await createExtractorFromData!({ data: arrayBuffer, wasmBinary });
    
    updateItem(qIdx, { message: 'Scanning RAR headers...' });
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];
    
    const imageHeaders = fileHeaders
      .filter((h: any) => h.name && !h.name.startsWith("__MACOSX") && !h.name.startsWith(".") && IMAGE_EXT_RE.test(h.name))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (imageHeaders.length === 0) throw new Error("No images in RAR");

    updateItem(qIdx, { status: 'uploading', total: imageHeaders.length, message: 'Extracting & Uploading...' });

    for (let i = 0; i < imageHeaders.length; i++) {
      const header = imageHeaders[i];
      const ext = (header.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;

      updateItem(qIdx, { progress: i + 1, message: `Processing ${i+1}/${imageHeaders.length}` });
      
      const extracted = extractor.extract({ files: [header.name] });
      const [arcFile] = [...extracted.files];
      
      if (arcFile?.extraction) {
        const blob = new Blob([arcFile.extraction], { type: mimeByExt[ext] ?? "application/octet-stream" });
        await uploadFile(newName, blob, targetPath);
      }
    }
  }

  async function uploadFile(filename: string, blob: Blob | File, path: string) {
    const formData = new FormData();
    formData.append("file", blob);
    formData.append("filename", filename);
    formData.append("folderPath", path);

    const res = await fetch("/api/upload-r2", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Upload failed");
    }
  }

  async function readAllDirectoryEntries(directoryReader: FileSystemDirectoryEntry) {
    const reader = directoryReader.createReader();
    let entries: FileSystemEntry[] = [];
    const readBatch = async () => {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => 
        reader.readEntries(resolve, reject)
      );
      if (batch.length > 0) {
        entries = entries.concat(batch);
        await readBatch();
      }
    };
    await readBatch();
    return entries.filter(e => e.isFile) as FileSystemFileEntry[];
  }
</script>

<div class="container">
  <h1>Series Upload Tool</h1>

  <!-- INPUT SECTION -->
  <div class="input-section">
    <label for="basePathInput">Series Base Path</label>
    <input
      id="basePathInput"
      type="text"
      bind:value={basePath}
      placeholder="e.g. MAD/One Piece"
    />
    <p class="help-text">
      Destination: <code>{basePath || "..."}/Band XX/page_001_de.jpg</code>
    </p>
  </div>

  <!-- DROP ZONE -->
  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    class="drop-zone"
    class:processing={isProcessing}
  >
    <h2>{isProcessing ? "Processing..." : "📂 Drag Band Folders or Archives Here"}</h2>
    <p>{unrarReady ? "Ready to upload" : "Loading unrar..."}</p>
  </div>

  <!-- VIEWPORT (Progress List) -->
  {#if uploadQueue.length > 0}
    <div class="viewport">
      <h3>Upload Queue</h3>
      <div class="job-list">
        {#each uploadQueue as job (job.id)}
          <div class="job-item" class:error={job.status === 'error'} class:done={job.status === 'done'}>
            <div class="job-header">
              <span class="job-name">{job.name}</span>
              <span class="job-status">{job.message}</span>
            </div>
            
            <div class="progress-track">
              <div 
                class="progress-fill" 
                style="width: {job.total ? (job.progress / job.total) * 100 : 0}%"
              ></div>
            </div>
            
            <div class="job-meta">
              <span>{job.progress} / {job.total} pages</span>
              <span>{job.status.toUpperCase()}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  /* --- LAYOUT --- */
  .container {
    padding: 2rem;
    max-width: 800px; /* Wider for the viewport */
    margin: 0 auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  /* --- INPUTS --- */
  .input-section {
    margin-bottom: 20px;
    background: #fff;
    padding: 15px;
    border: 1px solid #eee;
    border-radius: 8px;
  }
  
  label {
    display: block;
    font-weight: 700;
    margin-bottom: 5px;
    color: #333;
  }

  input[type="text"] {
    width: 100%;
    padding: 12px;
    font-size: 16px;
    border: 2px solid #ddd;
    border-radius: 6px;
    transition: border-color 0.2s;
  }

  input[type="text"]:focus {
    border-color: #1890ff;
    outline: none;
  }

  .help-text {
    font-size: 0.85rem;
    color: #666;
    margin-top: 5px;
  }

  /* --- DROP ZONE --- */
  .drop-zone {
    border: 3px dashed #ccc;
    padding: 40px;
    text-align: center;
    border-radius: 12px;
    background: #fafafa;
    transition: all 0.2s;
    cursor: pointer;
    margin-bottom: 30px;
  }

  .drop-zone:hover {
    border-color: #1890ff;
    background: #f0f7ff;
  }

  .drop-zone.processing {
    background: #e6f7ff;
    border-color: #1890ff;
    opacity: 0.8;
    pointer-events: none;
  }

  /* --- VIEWPORT (Progress) --- */
  .viewport {
    background: #fff;
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  }

  .viewport h3 {
    margin: 0;
    padding: 15px;
    background: #f4f6f8;
    border-bottom: 1px solid #e1e4e8;
    font-size: 1rem;
    color: #24292e;
  }

  .job-list {
    max-height: 400px;
    overflow-y: auto;
  }

  .job-item {
    padding: 15px;
    border-bottom: 1px solid #eee;
    animation: fadeIn 0.3s ease;
  }

  .job-item:last-child {
    border-bottom: none;
  }

  .job-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-weight: 500;
  }

  .job-status {
    font-size: 0.9rem;
    color: #666;
  }

  /* Progress Bar */
  .progress-track {
    height: 8px;
    background: #eee;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-fill {
    height: 100%;
    background: #1890ff;
    transition: width 0.3s ease;
  }

  /* Status Colors */
  .job-item.done .progress-fill { background: #52c41a; }
  .job-item.error .progress-fill { background: #ff4d4f; }
  
  .job-item.done .job-status { color: #52c41a; }
  .job-item.error .job-status { color: #ff4d4f; }

  .job-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #999;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
