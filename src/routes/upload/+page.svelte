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

  // --- HELPER: CHECK MODE ---
  function isMangaMode(path: string): boolean {
    return path.startsWith("MAD/");
  }

  // --- MAIN DROP HANDLER ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (!basePath || basePath.trim() === "") {
      return alert("⚠️ Please type the Series Base Path first!\nExample: MAD/One Piece (Manga) OR Books/History (Books)");
    }
    const cleanBasePath = basePath.replace(/\/$/, "");
    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) return alert("Please upload files/folders.");

    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    
    // Sort: Folders first, then files (alphabetical)
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

  // --- DIRECTORY PROCESSING ---
  async function processDirectoryEntry(entry: FileSystemDirectoryEntry, basePath: string, qIdx: number) {
    const isManga = isMangaMode(basePath);
    // Manga Mode: Target is basePath/FolderName (e.g., MAD/One Piece/Band 01)
    // Book Mode: Target is basePath (e.g. Books/SciFi) - we keep folder structure inside readAllDirectoryEntries if needed, 
    // OR simply: Book Mode usually implies dragging a folder "Chapter 1" to "Books/Title". 
    // Let's assume standard behavior: Upload folder content INTO basePath/FolderName.
    
    const targetPath = `${basePath}/${entry.name}`;
    const files = await readAllDirectoryEntries(entry);
    
    let validFiles: FileSystemFileEntry[];

    if (isManga) {
        // MANGA FILTER: Only images, ignore dots
        validFiles = files
            .filter((f) => !f.name.startsWith(".") && IMAGE_EXT_RE.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    } else {
        // BOOK FILTER: Everything except hidden system files
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
          // RENAME logic for Manga
          const ext = (file.name.split(".").pop() || "").toLowerCase() || "jpg";
          finalName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      } else {
          // KEEP ORIGINAL NAME for Books
          // If the file was deep inside the dragged folder, fileEntry.fullPath might be helpful, 
          // but readAllDirectoryEntries flattens unless we change it. 
          // For now, let's keep it simple: Upload flatly into the folder, OR preserve relative path if possible.
          // Since readAllDirectoryEntries flattens, we use file.name. 
          finalName = file.name;
      }

      updateItem(qIdx, { progress: i + 1, message: `Uploading ${finalName}...` });
      await uploadFile(finalName, file, targetPath);
    }
  }

  // --- FILE PROCESSING ---
  async function processFileEntry(file: File, basePath: string, qIdx: number) {
    const isManga = isMangaMode(basePath);
    const name = file.name.toLowerCase();

    // 1. MANGA MODE: CBZ/CBR Handling
    if (isManga) {
        const folderName = file.name.replace(/\.[^/.]+$/, ""); 
        const targetPath = `${basePath}/${folderName}`;
        
        if (name.endsWith(".cbz")) {
            await processCBZ(file, targetPath, qIdx);
            return;
        } else if (name.endsWith(".cbr")) {
            if (!unrarReady) throw new Error("CBR engine not ready");
            await processCBR(file, targetPath, qIdx);
            return;
        }
        // If it's a loose image file in Manga mode, maybe upload it directly?
        // Let's allow loose images to go into a folder named after the file? Or just reject?
        // Current logic rejected non-archives. Let's keep it strict or allow single image upload.
        // Assuming strict for now as per original code, unless it's a folder.
        throw new Error("Manga Mode: Only Folders, .cbz, or .cbr allowed.");
    } 

    // 2. BOOK MODE: Upload Anything
    // Target: Directly into basePath (e.g. Books/History/book.pdf)
    updateItem(qIdx, { status: 'uploading', total: 1, message: 'Uploading single file...' });
    await uploadFile(file.name, file, basePath);
    updateItem(qIdx, { progress: 1, message: 'Uploaded' });
  }

  // --- CBZ/CBR HANDLERS (Unchanged, only used in Manga Mode) ---
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
    const imageHeaders = [...list.fileHeaders]
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
    if (!res.ok) throw new Error("Upload failed");
  }

  // --- RECURSIVE DIRECTORY READER ---
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
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold text-center flex-1">Universal Upload Tool</h1>
    <div class="form-control">
      <select class="select select-bordered select-sm w-full max-w-xs" data-choose-theme>
        <option disabled selected>Theme</option>
        {#each themes as th}
          <option value={th}>{th}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- INPUT SECTION -->
  <div class="card bg-base-100 shadow-xl mb-6">
    <div class="card-body">
      <div class="form-control">
        <label class="label">
          <span class="label-text font-bold text-lg">Series Base Path / Target Folder</span>
        </label>
        <input
          type="text"
          bind:value={basePath}
          placeholder="e.g. MAD/One Piece OR Books/History"
          class="input input-bordered w-full bg-base-200 focus:input-primary"
        />
        <label class="label">
          <span class="label-text-alt text-base-content/70">
            {#if isMangaMode(basePath)}
              🔵 <b>Manga Mode:</b> Files renamed to <code>page_001_de.jpg</code> inside <code>{basePath}/[FolderName]</code>
            {:else if basePath}
              🟢 <b>Book Mode:</b> Files keep original names inside <code>{basePath}/[FolderName or File]</code>
            {:else}
              Enter a path to see the upload mode.
            {/if}
          </span>
        </label>
      </div>
    </div>
  </div>

  <!-- DROP ZONE -->
  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    class="border-4 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer text-base-content
           {isProcessing ? 'border-primary bg-primary/10 opacity-70 pointer-events-none' : 'border-base-300 bg-base-200 hover:border-primary hover:bg-base-300'}"
  >
    <h2 class="text-2xl font-semibold mb-2">
      {isProcessing ? "Processing..." : "📂 Drag Files, Folders, CBZ, PDF, MP3..."}
    </h2>
    <p class="text-base-content/60">
      {unrarReady ? "Ready to upload" : "Initializing unrar..."}
    </p>
  </div>

  <!-- UPLOAD QUEUE -->
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
              <span class="text-sm opacity-70" class:text-error={job.status==='error'} class:text-success={job.status==='done'}>
                {job.message}
              </span>
            </div>
            
            <div class="w-full bg-base-300 rounded-full h-2.5 mb-2">
              <div 
                class="h-2.5 rounded-full transition-all duration-300" 
                class:bg-primary={job.status !== 'error' && job.status !== 'done'}
                class:bg-success={job.status === 'done'}
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
