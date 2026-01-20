<script lang="ts">
  import JSZip from "jszip";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { themeChange } from "theme-change";

  // --- TYPES ---
  interface QueueItem {
    id: string;
    name: string;
    status: 'pending' | 'scanning' | 'uploading' | 'done' | 'error';
    progress: number;
    total: number;
    message: string;
  }

  // --- STATE ---
  let basePath = "";
  let uploadQueue: QueueItem[] = [];
  let isProcessing = false;
  
  // NEW: Inputs for toggle
  let fileInput: HTMLInputElement; 
  let folderInput: HTMLInputElement;
  let uploadMode: 'files' | 'folder' = 'files'; 

  // --- THEMES LIST ---
  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter", "dim", "nord", "sunset",
  ];

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
    themeChange(false);

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
    }
  });

  function isMangaMode(path: string): boolean {
    return path.startsWith("MAD/");
  }

  // --- CLICK HANDLER (FIXED) ---
  function openFileBrowser() {
    if (uploadMode === 'folder') {
      if (folderInput) folderInput.click();
    } else {
      if (fileInput) fileInput.click();
    }
  }

  // --- FILE INPUT HANDLER (FIXED) ---
  // This handles BOTH file and folder inputs
  function handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    
    if (!files || files.length === 0) return;

    const cleanBasePath = basePath.trim().replace(/\/$/, "");
    const fileArray = Array.from(files); // Convert FileList to Array
    
    // Create initial queue items
    const newItems: QueueItem[] = fileArray.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name, // Note: folders via input might lose structure here, see processFileListQueue
      status: 'pending',
      progress: 0,
      total: 0,
      message: 'Waiting...'
    }));
    uploadQueue = [...uploadQueue, ...newItems];

    if (!isProcessing) processFileListQueue(cleanBasePath, fileArray);
    
    // IMPORTANT: Reset input value to allow selecting same files again
    input.value = ''; 
  }

  // --- PROCESS FILE LIST (Use webkitRelativePath for Folders) ---
  async function processFileListQueue(basePath: string, files: File[]) {
    isProcessing = true;
    const startIndex = uploadQueue.length - files.length;

    for (let i = 0; i < files.length; i++) {
      const queueIndex = startIndex + i;
      const file = files[i];
      updateItem(queueIndex, { status: 'scanning', message: 'Processing...' });

      try {
        // Handle "Manga Mode" pathing
        if (isMangaMode(basePath)) {
             // For files uploaded via folder input, use webkitRelativePath if available
             // webkitRelativePath looks like: "FolderName/file.jpg"
             const relPath = file.webkitRelativePath || file.name;
             const pathParts = relPath.split('/');
             
             // If deep structure (Folder/File), we need the parent folder name
             let folderName = "";
             if (pathParts.length > 1) {
                folderName = pathParts[0]; // Top-level folder
             } else {
                folderName = file.name.replace(/\.[^/.]+$/, ""); // Fallback for root files
             }

             const targetPath = `${basePath}/${folderName}`;
             
             // Check extensions
             const name = file.name.toLowerCase();
             if (name.endsWith(".cbz")) {
                 await processCBZ(file, targetPath, queueIndex);
             } else if (name.endsWith(".cbr")) {
                 if (!unrarReady) throw new Error("CBR engine not ready");
                 await processCBR(file, targetPath, queueIndex);
             } else if (IMAGE_EXT_RE.test(name)) {
                 // It's an image in a folder (Manga Mode)
                 // We need to rename it to page_XXX
                 // ISSUE: In bulk upload, 'i' is the global index. 
                 // We probably want per-folder indexing, but that's complex in linear queue.
                 // Simple Fix: Rename using its original name or a timestamp to avoid collision, 
                 // OR stick to page_XXX if we assume 1 folder = 1 chapter.
                 
                 // Let's assume standard behavior: Rename to page_XXX based on file list order
                 const ext = (name.split(".").pop() || "").toLowerCase() || "jpg";
                 // Using 'i+1' here might rename across multiple chapters if uploaded together.
                 // For safety in this specific "Universal" tool, let's keep original name if ambiguous, 
                 // OR force page_XXX. 
                 // Let's force page_XXX for now as requested.
                 const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
                 await uploadFile(newName, file, targetPath);
             } else {
                 throw new Error("Manga Mode: Ignored non-image/archive");
             }

        } else {
             // BOOK MODE: Simple Upload
             // Use webkitRelativePath to preserve folder structure if it exists
             // e.g. "MyBook/Chapter1/text.txt" -> uploads to "BasePath/MyBook/Chapter1/text.txt"
             
             const relPath = file.webkitRelativePath || file.name;
             // If basePath is set, prepend it. If not, use relPath directly.
             const finalPath = basePath ? `${basePath}/${relPath}` : relPath;
             
             // We need to separate filename from path for the uploadFile function
             // uploadFile takes (filename, blob, folderPath)
             const lastSlash = finalPath.lastIndexOf('/');
             const folderPath = lastSlash !== -1 ? finalPath.substring(0, lastSlash) : "";
             const fileName = lastSlash !== -1 ? finalPath.substring(lastSlash + 1) : finalPath;

             await uploadFile(fileName, file, folderPath);
        }

        updateItem(queueIndex, { status: 'done', message: 'Completed' });
      } catch (err: any) {
        console.error(err);
        updateItem(queueIndex, { status: 'error', message: err.message || 'Failed' });
      }
    }
    isProcessing = false;
  }

  // --- DRAG & DROP HANDLERS (Unchanged - they work) ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    const cleanBasePath = basePath.trim().replace(/\/$/, "");
    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) return alert("Please upload files/folders.");

    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    const newItems: QueueItem[] = entries.map((entry) => ({
      id: crypto.randomUUID(),
      name: entry.name,
      status: 'pending',
      progress: 0,
      total: 0,
      message: 'Waiting...'
    }));
    uploadQueue = [...uploadQueue, ...newItems];

    if (!isProcessing) processQueue(cleanBasePath, entries);
  }

  async function processQueue(basePath: string, entries: FileSystemEntry[]) {
    isProcessing = true;
    const startIndex = uploadQueue.length - entries.length;

    for (let i = 0; i < entries.length; i++) {
      const queueIndex = startIndex + i;
      const entry = entries[i];
      updateItem(queueIndex, { status: 'scanning', message: 'Scanning...' });

      try {
        if (entry.isDirectory) {
          await processDirectoryEntry(entry as FileSystemDirectoryEntry, basePath, queueIndex);
        } else if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
          await processFileEntry(file, basePath, queueIndex);
        }
        updateItem(queueIndex, { status: 'done', message: 'Completed' });
      } catch (err: any) {
        console.error(err);
        updateItem(queueIndex, { status: 'error', message: err.message || 'Failed' });
      }
    }
    isProcessing = false;
  }

  function updateItem(index: number, updates: Partial<QueueItem>) {
    uploadQueue[index] = { ...uploadQueue[index], ...updates };
  }

  // --- WORKER HANDLERS (Used by Drag & Drop) ---
  async function processDirectoryEntry(entry: FileSystemDirectoryEntry, basePath: string, qIdx: number) {
    const isManga = isMangaMode(basePath);
    const targetPath = basePath ? basePath : entry.name; // Keep structure
    const files = await readAllDirectoryEntries(entry);
    
    let validFiles: FileSystemFileEntry[];
    if (isManga) {
        validFiles = files
            .filter((f) => !f.name.startsWith(".") && IMAGE_EXT_RE.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    } else {
        validFiles = files
            .filter((f) => !f.name.startsWith("."))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    }

    if (validFiles.length === 0) throw new Error("No valid files found in folder");
    updateItem(qIdx, { status: 'uploading', total: validFiles.length, message: 'Uploading...' });

    for (let i = 0; i < validFiles.length; i++) {
      const fileEntry = validFiles[i];
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      
      let finalName: string;
      if (isManga) {
         const ext = (file.name.split(".").pop() || "").toLowerCase() || "jpg";
         finalName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      } else {
         finalName = file.name;
      }
      
      updateItem(qIdx, { progress: i + 1, message: `Uploading ${finalName}...` });
      await uploadFile(finalName, file, targetPath);
    }
  }

  // Used by Drag & Drop (Single File)
  async function processFileEntry(file: File, basePath: string, qIdx: number) {
    const isManga = isMangaMode(basePath);
    const name = file.name.toLowerCase();

    if (isManga) {
        const folderName = file.name.replace(/\.[^/.]+$/, ""); 
        const targetPath = `${basePath}/${folderName}`;
        if (name.endsWith(".cbz")) { await processCBZ(file, targetPath, qIdx); return; }
        else if (name.endsWith(".cbr")) { if (!unrarReady) throw new Error("CBR engine not ready"); await processCBR(file, targetPath, qIdx); return; }
        throw new Error("Manga Mode: Only Folders, .cbz, or .cbr allowed.");
    } 

    const targetPath = basePath || "";
    updateItem(qIdx, { status: 'uploading', total: 1, message: 'Uploading single file...' });
    await uploadFile(file.name, file, targetPath);
    updateItem(qIdx, { progress: 1, message: 'Uploaded' });
  }

  async function processCBZ(file: File, targetPath: string, qIdx: number) {
    updateItem(qIdx, { message: 'Reading Zip...' });
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const fileNames = Object.keys(content.files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    const images = [];
    for (const name of fileNames) {
      const entry = content.files[name];
      if (!entry.dir && !name.startsWith("__MACOSX") && !name.includes("/.") && IMAGE_EXT_RE.test(name)) images.push({ name, entry });
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
    const imageHeaders = [...list.fileHeaders].filter((h: any) => h.name && !h.name.startsWith("__MACOSX") && !h.name.startsWith(".") && IMAGE_EXT_RE.test(h.name)).sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
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
    if (!res.ok) throw new Error("Upload failed");
  }

  async function readAllDirectoryEntries(directoryReader: FileSystemDirectoryEntry) {
    const reader = directoryReader.createReader();
    let entries: FileSystemEntry[] = [];
    const readBatch = async () => {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length > 0) { entries = entries.concat(batch); await readBatch(); }
    };
    await readBatch();
    return entries.filter(e => e.isFile) as FileSystemFileEntry[];
  }
</script>

<div class="container mx-auto p-4 max-w-4xl font-sans text-base-content pb-20">
  <!-- HEADER -->
  <div class="flex items-center mb-6 gap-4">
    <div class="flex-1"></div>
    <h1 class="text-3xl font-bold text-center">Universal Upload Tool</h1>
    <div class="flex-1 flex justify-end">
      <select class="select select-bordered select-sm w-full max-w-xs" data-choose-theme>
        <option disabled selected>Theme</option>
        {#each themes as th} <option value={th}>{th}</option> {/each}
      </select>
    </div>
  </div>

  <!-- INPUT SECTION -->
  <div class="card bg-base-100 shadow-xl mb-6">
    <div class="card-body">
      <div class="form-control">
        <label class="label pb-3">
          <span class="label-text font-bold text-lg">Series Base Path / Target Folder</span>
        </label>
        <input
          type="text"
          bind:value={basePath}
          placeholder="e.g. MAD/One Piece OR Immobilienkaufleute Band 1 2022 (or leave blank for root)"
          class="input input-bordered w-full bg-base-200 focus:input-primary"
        />
        <label class="label pt-3">
          <span class="label-text-alt text-base-content/70 whitespace-normal break-words">
            {#if isMangaMode(basePath)}
              🔵 <b>Manga Mode:</b> Files renamed to <code>page_001_de.jpg</code> inside <code>{basePath}/[FolderName]</code>
            {:else if basePath}
              🟢 <b>Book Mode:</b> Files uploaded directly to <code>{basePath}/</code> with original names
            {:else}
              💡 Enter a path to see the upload mode, or leave blank to upload to root folder.
            {/if}
          </span>
        </label>
      </div>
    </div>
  </div>

  <!-- TOGGLE SWITCH -->
  <div class="flex justify-center mb-4">
    <div class="join">
      <button 
        class="join-item btn btn-sm {uploadMode === 'files' ? 'btn-primary' : 'btn-ghost'}"
        on:click={() => uploadMode = 'files'}>
        📄 Files
      </button>
      <button 
        class="join-item btn btn-sm {uploadMode === 'folder' ? 'btn-primary' : 'btn-ghost'}"
        on:click={() => uploadMode = 'folder'}>
        📂 Folder
      </button>
    </div>
  </div>

  <!-- HIDDEN INPUTS (Fixed bindings) -->
  <input type="file" bind:this={fileInput} on:change={handleFileInputChange} multiple class="hidden" />
  <!-- Folder input needs webkitdirectory for Chrome/Safari desktop -->
  <input type="file" bind:this={folderInput} on:change={handleFileInputChange} webkitdirectory mozdirectory class="hidden" />

  <!-- DROP ZONE -->
  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    on:click={openFileBrowser}
    on:keydown={(e) => e.key === 'Enter' && openFileBrowser()}
    class="border-4 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer text-base-content relative
           {isProcessing ? 'border-primary bg-primary/10 opacity-70 pointer-events-none' : 'border-base-300 bg-base-200 hover:border-primary hover:bg-base-300'}"
  >
    <h2 class="text-2xl font-semibold mb-2">
      {isProcessing ? "Processing..." : `📂 Drag or Click to Upload ${uploadMode === 'folder' ? 'Folder' : 'Files'}`}
    </h2>
    <p class="text-base-content/60 mb-2">
      {unrarReady ? "Supports CBZ, PDF, MP3, ZIP, & more" : "Initializing unrar..."}
    </p>
    
    <span class="badge badge-ghost text-xs">
      Mode: {uploadMode === 'folder' ? 'Folder Upload' : 'Multi-File Upload'}
    </span>
  </div>

  <!-- QUEUE -->
  {#if uploadQueue.length > 0}
    <div class="card bg-base-100 shadow-xl mt-6 overflow-hidden border border-base-200">
      <div class="card-header p-4 bg-base-200 font-bold border-b border-base-300">
        Upload Queue
      </div>
      <div class="max-h-[50vh] overflow-y-auto p-0 scrollbar-thin">
        {#each uploadQueue as job (job.id)}
          <div class="p-4 border-b border-base-200 last:border-none hover:bg-base-200/50 transition-colors">
            <div class="flex justify-between mb-2">
              <span class="font-medium truncate pr-4">{job.name}</span>
              <span class="text-sm opacity-70" class:text-error={job.status==='error'} class:text-success={job.status==='done'}>{job.message}</span>
            </div>
            <div class="w-full bg-base-300 rounded-full h-2.5 mb-2">
              <div class="h-2.5 rounded-full transition-all duration-300" 
                class:bg-primary={job.status !== 'error' && job.status !== 'done'}\n                class:bg-success={job.status === 'done'}
                class:bg-error={job.status === 'error'}
                style="width: {job.total ? (job.progress / job.total) * 100 : 0}%"
              ></div>
            </div>
            <div class="flex justify-between text-xs text-base-content/60">
              <span>{job.progress} / {job.total} files</span>
              <span class="uppercase font-bold tracking-wider">{job.status}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
