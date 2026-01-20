<script lang="ts">
  import JSZip from "jszip";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { themeChange } from "theme-change"; // Import theme-change

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

  // --- THEMES LIST (Same as main page) ---
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
    
    // Initialize Theme Changer
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

  // --- MAIN DROP HANDLER (Logic Unchanged) ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (!basePath || basePath.trim() === "") {
      return alert("⚠️ Please type the Series Base Path first!\nExample: MAD/One Piece");
    }
    const cleanBasePath = basePath.replace(/\/$/, "");
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
      updateItem(queueIndex, { status: 'scanning', message: 'Scanning files...' });

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

  // --- WORKER HANDLERS ---
  async function processDirectoryEntry(entry: FileSystemDirectoryEntry, basePath: string, qIdx: number) {
    const targetPath = `${basePath}/${entry.name}`;
    const files = await readAllDirectoryEntries(entry);
    const validImages = files
      .filter((f) => !f.name.startsWith(".") && IMAGE_EXT_RE.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (validImages.length === 0) throw new Error("No images found");
    updateItem(qIdx, { status: 'uploading', total: validImages.length, message: 'Uploading...' });

    for (let i = 0; i < validImages.length; i++) {
      const fileEntry = validImages[i];
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      const ext = (file.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      updateItem(qIdx, { progress: i + 1, message: `Uploading ${newName}...` });
      await uploadFile(newName, file, targetPath);
    }
  }

  async function processFileEntry(file: File, basePath: string, qIdx: number) {
    const name = file.name.toLowerCase();
    const folderName = file.name.replace(/\.[^/.]+$/, ""); 
    const targetPath = `${basePath}/${folderName}`;

    if (name.endsWith(".cbz")) await processCBZ(file, targetPath, qIdx);
    else if (name.endsWith(".cbr")) {
      if (!unrarReady) throw new Error("CBR engine not ready");
      await processCBR(file, targetPath, qIdx);
    } else throw new Error("Ignored (Not a .cbz/.cbr file)");
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

<div class="container mx-auto p-4 max-w-4xl font-sans text-base-content pb-20"> <!-- Added pb-20 for safe scroll space -->
  
  <!-- HEADER: Title + Theme Selector -->
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold text-center flex-1">Series Upload Tool</h1>
    <div class="form-control">
      <select class="select select-bordered select-sm w-full max-w-xs" data-choose-theme>
        <option disabled selected>Theme</option>
        {#each themes as th}
          <option value={th}>{th}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- INPUT SECTION: Uses DaisyUI Card + Inputs -->
  <div class="card bg-base-100 shadow-xl mb-6">
    <div class="card-body">
      <div class="form-control">
        <label class="label">
          <span class="label-text font-bold text-lg">Series Base Path</span>
        </label>
        <input
          type="text"
          bind:value={basePath}
          placeholder="e.g. MAD/One Piece"
          class="input input-bordered w-full bg-base-200 focus:input-primary"
        />
        <label class="label">
          <span class="label-text-alt text-base-content/70">
            Files will land in: <code>{basePath || "..."}/Band XX/page_001_de.jpg</code>
          </span>
        </label>
      </div>
    </div>
  </div>

  <!-- DROP ZONE: Adapts to theme colors -->
  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    class="border-4 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer text-base-content
           {isProcessing ? 'border-primary bg-primary/10 opacity-70 pointer-events-none' : 'border-base-300 bg-base-200 hover:border-primary hover:bg-base-300'}"
  >
    <h2 class="text-2xl font-semibold mb-2">
      {isProcessing ? "Processing..." : "📂 Drag Band Folders or Archives Here"}
    </h2>
    <p class="text-base-content/60">
      {unrarReady ? "Ready to upload" : "Initializing unrar..."}
    </p>
  </div>

  <!-- VIEWPORT: Fixed Height + Scroll -->
  {#if uploadQueue.length > 0}
    <div class="card bg-base-100 shadow-xl mt-6 overflow-hidden border border-base-200">
      <div class="card-header p-4 bg-base-200 font-bold border-b border-base-300">
        Upload Queue
      </div>
      <!-- ADDED: max-h-[50vh] and overflow-y-auto ensure scrolling works properly -->
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
              <span>{job.progress} / {job.total} pages</span>
              <span class="uppercase font-bold tracking-wider">{job.status}</span>
            </div>

          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
