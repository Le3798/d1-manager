<script lang="ts">
  import JSZip from "jszip";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { themeChange } from "theme-change";

  // --- TYPES ---
  interface QueueItem {
    id: string;
    name: string;
    type: 'file' | 'folder';
    status: 'pending' | 'scanning' | 'uploading' | 'done' | 'error';
    progress: number;
    total: number;
    message: string;
  }

  // --- STATE ---
  let basePath = "";
  let uploadQueue: QueueItem[] = [];
  let isProcessing = false;
  
  // Inputs
  let fileInput: HTMLInputElement; 
  let folderInput: HTMLInputElement;
  let uploadMode: 'files' | 'folder' = 'files';
  // Delete Modal State
  let deleteModal: HTMLDialogElement;
  let jobToDeleteId: string | null = null;
  // --- QUEUE MANAGEMENT ---
  let executionQueue = Promise.resolve();
  function addToQueue(task: () => Promise<void>) {
    executionQueue = executionQueue.then(() => task()).catch(err => {
        console.error("Queue processing error:", err);
    });
  }

  // --- THEMES ---
  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter", "dim", "nord", "sunset",
  ];
  // --- UNRAR / WASM ---
  let unrarReady = false;
  let wasmBinary: ArrayBuffer | null = null;
  let createExtractorFromData: null | ((opts: any) => Promise<any>) = null;

  const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"
  };
  onMount(async () => {
    if (!browser) return;
    themeChange(false);
    try {
      const unrar = await import("node-unrar-js");
      createExtractorFromData = unrar.createExtractorFromData;
      const wasmMod = await import("node-unrar-js/esm/js/unrar.wasm?url");
      const res = await fetch(wasmMod.default as string);
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

  // --- CLICK HANDLER ---
  function openFileBrowser() {
    uploadMode === 'folder' ?
    folderInput.click() : fileInput.click();
  }

  // --- DELETE HANDLERS ---
  function promptDelete(id: string) {
    jobToDeleteId = id;
    deleteModal.showModal();
  }

  function confirmDelete() {
    if (jobToDeleteId) {
      // Remove from UI
      uploadQueue = uploadQueue.filter(item => item.id !== jobToDeleteId);
    }
    // Close manually
    deleteModal.close();
  }

  function cancelDelete() {
    deleteModal.close();
  }

  // Helper to check if job was deleted during processing
  function isJobAlive(id: string): boolean {
    return uploadQueue.some(item => item.id === id);
  }

  // --- INPUT CHANGE HANDLER ---
  function handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const files = Array.from(input.files);
    const isFolderUpload = input.webkitdirectory;
    if (isFolderUpload) {
        // GROUP BY FOLDER
        const folders = new Map<string, File[]>();
        files.forEach(f => {
            const path = f.webkitRelativePath || f.name;
            const rootFolder = path.split('/')[0];
            if (!folders.has(rootFolder)) folders.set(rootFolder, []);
            folders.get(rootFolder)!.push(f);
        });
        const newItems: QueueItem[] = Array.from(folders.keys()).map(folderName => ({
            id: crypto.randomUUID(),
            name: folderName,
            type: 'folder',
            status: 'pending',
            progress: 0,
            total: folders.get(folderName)!.length,
            message: 'Waiting...'
   
        }));
        
        const startIndex = uploadQueue.length;
        uploadQueue = [...uploadQueue, ...newItems];
        // Queue folders
        Array.from(folders.keys()).forEach((folderName, i) => {
            const jobId = uploadQueue[startIndex + i].id;
            const folderFiles = folders.get(folderName)!;
            addToQueue(() => processBatch(jobId, folderFiles, basePath));
        });
    } else {
        // FILES
        const newItems: QueueItem[] = files.map(f => ({
            id: crypto.randomUUID(),
            name: f.name,
            type: 'file',
            status: 'pending',
            progress: 0,
          
            total: 1,
            message: 'Waiting...'
        }));
        const startIndex = uploadQueue.length;
        uploadQueue = [...uploadQueue, ...newItems];

        // Queue files
        files.forEach((f, i) => {
            const jobId = uploadQueue[startIndex + i].id;
            addToQueue(() => processSingleFile(jobId, f, basePath));
        });
    }
    input.value = '';
  }

  // --- DRAG & DROP HANDLER ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    const items = event.dataTransfer?.items;
    if (!items) return;

    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
    }
    
    // Create Jobs
    const newItems: QueueItem[] = entries.map(e => ({
        id: crypto.randomUUID(),
        name: e.name,
        type: e.isDirectory ? 'folder' : 'file',
        status: 'pending',
        progress: 0,
        total: 0, 
        message: 'Waiting...'
    }));
    const startIndex = uploadQueue.length;
    uploadQueue = [...uploadQueue, ...newItems];

    // Queue Jobs
    entries.forEach((entry, i) => {
        const jobId = uploadQueue[startIndex + i].id;
        
        addToQueue(async () => {
             // Check if deleted before starting
             if (!isJobAlive(jobId)) return;

             if (entry.isDirectory) {
   
               await processDirectoryEntry(jobId, entry as FileSystemDirectoryEntry, basePath);
            } else {
                const file = await new Promise<File>((resolve, reject) => {
                    (entry as FileSystemFileEntry).file(resolve, reject);
                });
     
               await processSingleFile(jobId, file, basePath);
            }
        });
    });
  }

  // --- LOGIC: PROCESS BATCH ---
  async function processBatch(jobId: string, files: File[], basePath: string) {
    if (!isJobAlive(jobId)) return;
    // Abort if deleted

    updateItem(jobId, { status: 'uploading', total: files.length, message: 'Starting...' });
    for (let i = 0; i < files.length; i++) {
        if (!isJobAlive(jobId)) return;
        // Stop loop if deleted

        const f = files[i];
        updateItem(jobId, { progress: i + 1, message: `Uploading ${f.name}...` });
        try {
            const relPath = f.webkitRelativePath || f.name;
            let targetPath = basePath;
            let finalName = f.name;

            // MANGA MODE LOGIC
            if (isMangaMode(basePath)) {
                 const parts = relPath.split('/');
                 const folderName = parts.length > 1 ? parts.slice(0, -1).join('/') : "";
                 targetPath = `${basePath}/${folderName}`;
                 if (IMAGE_EXT_RE.test(f.name)) {
                     const ext = (f.name.split(".").pop() || "").toLowerCase() ||
                     "jpg";
                     finalName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
                 }
            } else {
                // BOOK MODE
                const fullPath = basePath ?
                `${basePath}/${relPath}` : relPath;
                const lastSlash = fullPath.lastIndexOf('/');
                targetPath = lastSlash !== -1 ? fullPath.substring(0, lastSlash) : "";
                finalName = f.name;
            }

            await uploadFile(finalName, f, targetPath);
        } catch (e: any) {
            console.error(e);
        }
    }
    if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
  }

  // --- LOGIC: PROCESS SINGLE FILE ---
  async function processSingleFile(jobId: string, file: File, basePath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { status: 'uploading', total: 1, message: 'Processing...' });
    try {
        const name = file.name.toLowerCase();
        let targetPath = basePath;
        
        if (isMangaMode(basePath)) {
            const folderName = file.name.replace(/\.[^/.]+$/, "");
            targetPath = `${basePath}/${folderName}`;
            
            if (name.endsWith(".cbz")) {
                await processCBZ(jobId, file, targetPath);
                return;
            } else if (name.endsWith(".cbr")) {
                if (!unrarReady) throw new Error("CBR engine not ready");
                await processCBR(jobId, file, targetPath);
                return;
            }
            throw new Error("Manga Mode: Single files must be .cbz/.cbr");
        } 
        
        await uploadFile(file.name, file, basePath);
        if (isJobAlive(jobId)) updateItem(jobId, { progress: 1, status: 'done', message: 'Done' });
    } catch (e: any) {
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'error', message: e.message });
    }
  }

  // --- LOGIC: DIRECTORY ENTRY ---
  async function processDirectoryEntry(jobId: string, entry: FileSystemDirectoryEntry, basePath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Scanning directory...' });
    
    const entries = await readAllDirectoryEntries(entry);
    const files: File[] = [];
    for (const e of entries) {
        const f = await new Promise<File>((resolve) => e.file(resolve));
        Object.defineProperty(f, 'webkitRelativePath', {
            value: e.fullPath.substring(1) 
        });
        files.push(f);
    }
    
    await processBatch(jobId, files, basePath);
  }

  // --- CBZ HANDLER ---
  async function processCBZ(jobId: string, file: File, targetPath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Unzipping...' });
    
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const files = Object.values(content.files).filter(e => !e.dir && IMAGE_EXT_RE.test(e.name));
    
    if (isJobAlive(jobId)) updateItem(jobId, { total: files.length, message: 'Uploading...' });
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (let i = 0; i < files.length; i++) {
        if (!isJobAlive(jobId)) return;
        // Stop if deleted

        const entry = files[i];
        const blob = await entry.async("blob");
        const ext = entry.name.split('.').pop() || 'jpg';
        const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
        updateItem(jobId, { progress: i + 1, message: `Uploading ${i+1}/${files.length}` });
        await uploadFile(newName, blob, targetPath);
    }
    if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
  }

  // --- CBR HANDLER ---
  async function processCBR(jobId: string, file: File, targetPath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Unrar...' });
    
    try {
        const ab = await file.arrayBuffer();
        const extractor = await createExtractorFromData!({ data: ab, wasmBinary });
        
        const listObj = extractor.getFileList();
        const allHeaders = [...listObj.fileHeaders];
        const list = allHeaders.filter((h: any) => 
            !h.flags.directory && IMAGE_EXT_RE.test(h.name)
        );
        if (list.length === 0) throw new Error("No valid images found in CBR");
        if (isJobAlive(jobId)) updateItem(jobId, { total: list.length, message: 'Uploading...' });
        
        list.sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (let i = 0; i < list.length; i++) {
            if (!isJobAlive(jobId)) return;
            // Stop if deleted

            const h = list[i];
            const extracted = extractor.extract({ files: [h.name] });
            const [arc] = [...extracted.files];
            if (arc && arc.extraction) {
                const ext = h.name.split('.').pop() ||
                'jpg';
                const blob = new Blob([arc.extraction], { type: mimeByExt[ext] || 'image/jpeg' });
                const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
                updateItem(jobId, { progress: i + 1, message: `Uploading ${i+1}/${list.length}` });
                await uploadFile(newName, blob, targetPath);
            }
        }
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
    } catch (err: any) {
        console.error("CBR Error:", err);
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'error', message: "Failed: " + (err.message || "Invalid CBR") });
    }
  }

  // --- HELPERS ---
  function updateItem(id: string, updates: Partial<QueueItem>) {
    // Only update if it still exists
    if (!isJobAlive(id)) return;
    uploadQueue = uploadQueue.map(item => item.id === id ? { ...item, ...updates } : item);
  }

  async function uploadFile(filename: string, blob: Blob | File, path: string) {
    const fd = new FormData();
    fd.append("file", blob);
    fd.append("filename", filename);
    fd.append("folderPath", path);
    const res = await fetch("/api/upload-r2", { method: "POST", body: fd });
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
    for (const entry of entries) {
        if (entry.isDirectory) {
            const subEntries = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry);
            entries = entries.concat(subEntries);
        }
    }
    return entries.filter(e => e.isFile) as FileSystemFileEntry[];
  }
</script>

<div class="container mx-auto p-4 max-w-4xl font-sans text-base-content pb-20">
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

  <div class="card bg-base-100 shadow-xl mb-6">
    <div class="card-body">
      <div class="form-control">
        <label class="label pb-3">
          <span class="label-text font-bold text-lg">Series Base Path / Target Folder</span>
        </label>
        <input
          type="text"
          bind:value={basePath}
          placeholder="e.g. MAD/One Piece OR Books/History (leave blank for root)"
          class="input input-bordered w-full bg-base-200 focus:input-primary"
    
        />
        <label class="label pt-3">
          <span class="label-text-alt text-base-content/70 whitespace-normal break-words">
            {#if isMangaMode(basePath)}
              <b>Manga Mode:</b> Files renamed to <code>page_001_de.jpg</code> inside <code>{basePath}/[FolderName]</code>
            {:else if basePath}
              <b>Book Mode:</b> Files uploaded directly to <code>{basePath}/</code> with original names
 
            {:else}
              Enter a path to see the upload mode, or leave blank to upload to root folder.
            {/if}
          </span>
        </label>
      </div>
    </div>
  </div>

  <div class="flex justify-center mb-4">
    <div class="join">
      <button 
        class="join-item btn btn-sm {uploadMode === 'files' ? 'btn-primary' : 'btn-ghost'}"
        on:click={() => uploadMode = 'files'}>
        Files
      </button>
      <button 
   
        class="join-item btn btn-sm {uploadMode === 'folder' ? 'btn-primary' : 'btn-ghost'}"
        on:click={() => uploadMode = 'folder'}>
        Folder
      </button>
    </div>
  </div>

  <input type="file" bind:this={fileInput} on:change={handleFileInputChange} multiple class="hidden" />
  <input type="file" bind:this={folderInput} on:change={handleFileInputChange} webkitdirectory mozdirectory class="hidden" />

  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    on:click={openFileBrowser}
    on:keydown={(e) => e.key === 'Enter' && openFileBrowser()}
   
    class="border-4 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer text-base-content relative
           {isProcessing ?
           'border-primary bg-primary/10 opacity-70 pointer-events-none' : 'border-base-300 bg-base-200 hover:border-primary hover:bg-base-300'}"
  >
    <h2 class="text-2xl font-semibold mb-2">
      {isProcessing ? "Processing..." : `Drag or Click to Upload ${uploadMode === 'folder' ? 'Folder' : 'Files'}`}
    </h2>
    <p class="text-base-content/60 mb-2">
      {unrarReady ? "Supports CBZ, PDF, MP3, ZIP, & more" : "Initializing unrar..."}
    </p>
    
    <span class="badge badge-ghost text-xs">
      Mode: {uploadMode === 'folder' ? 'Folder Upload' : 'Multi-File Upload'}
    </span>
 
  </div>

  {#if uploadQueue.length > 0}
    <div class="card bg-base-100 shadow-xl mt-6 overflow-hidden border border-base-200">
      <div class="card-header p-4 bg-base-200 font-bold border-b border-base-300">
        Upload Queue
      </div>
      <div class="max-h-[50vh] overflow-y-auto p-0 scrollbar-thin">
        {#each uploadQueue as job (job.id)}
          <div class="p-4 border-b border-base-200 last:border-none hover:bg-base-200/50 transition-colors flex items-center gap-4">
            
   
            <div class="flex-1 min-w-0">
                <div class="flex justify-between mb-2">
                    <span class="font-medium truncate pr-4">{job.name}</span>
                    <span class="text-sm opacity-70" class:text-error={job.status==='error'} class:text-success={job.status==='done'}>{job.message}</span>
                </div>
       
                <div class="w-full bg-base-300 rounded-full h-2.5 mb-2">
                    <div class="h-2.5 rounded-full transition-all duration-300" 
                    class:bg-primary={job.status !== 'error' && job.status !== 'done'}
                    class:bg-success={job.status === 'done'}
             
                    class:bg-error={job.status === 'error'}
                    style="width: {job.total ?
                    (job.progress / job.total) * 100 : 0}%"
                    ></div>
                </div>
                <div class="flex justify-between text-xs text-base-content/60">
                    <span>{job.progress} / {job.total} files</span>
               
                    <span class="uppercase font-bold tracking-wider">{job.status}</span>
                </div>
            </div>

            <div>
                <button 
                  class="btn btn-square btn-sm btn-ghost text-error hover:bg-error/10"
            
                  on:click|stopPropagation={() => promptDelete(job.id)}
                  title="Remove"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
  
                  </svg>
                </button>
            </div>

          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<dialog bind:this={deleteModal} class="modal modal-bottom sm:modal-middle" on:close={() => jobToDeleteId = null}>
  <div class="modal-box">
    <h3 class="font-bold text-lg text-error">Delete Task</h3>
    <p class="py-4">Are you sure you want to remove this upload task?
    This action cannot be undone.</p>
    
    <div class="modal-action">
        <button type="button" class="btn" on:click={cancelDelete}>Cancel</button>
        <button type="button" class="btn btn-error" on:click={confirmDelete}>Yes, Delete</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
      <button>close</button>
  </form>
</dialog>