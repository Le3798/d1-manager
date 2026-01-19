<script lang="ts">
  import JSZip from "jszip";
  import { onMount } from "svelte";
  import { browser } from "$app/environment";

  // --- STATE ---
  let status = "Initializing...";
  let isUploading = false;
  // NOTE: This is now the BASE path for the series (e.g. "MAD/Naruto")
  let basePath = "MAD/Naruto";

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
      // 1. Dynamic import node-unrar-js (client-side only)
      const unrar = await import("node-unrar-js");
      createExtractorFromData = unrar.createExtractorFromData;

      // 2. Fetch WASM
      const wasmMod = await import("node-unrar-js/esm/js/unrar.wasm?url");
      const unrarWasmUrl = wasmMod.default as string;

      const res = await fetch(unrarWasmUrl);
      if (!res.ok) throw new Error(`Failed to load WASM: ${res.status}`);
      wasmBinary = await res.arrayBuffer();

      unrarReady = true;
      status = "Ready. Drag folders (Band 01, Band 02...) or archive files here.";
    } catch (e) {
      console.error("Unrar loading failed:", e);
      unrarReady = false;
      status = "Warning: CBR support failed (CBZ/Folders only). Check console.";
    }
  });

  // --- MAIN DROP HANDLER ---
  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (isUploading) return;

    if (!basePath) return alert("Please type the Series Base Path first!");
    const cleanBasePath = basePath.replace(/\/$/, "");

    // Use 'items' to support directories
    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) return alert("Please upload files/folders.");

    isUploading = true;
    status = "Scanning dropped items...";

    try {
      // Process all dropped items sequentially
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }

      // Sort entries so Band 01 processes before Band 02
      entries.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

      let count = 0;
      for (const entry of entries) {
        count++;
        status = `Processing item ${count}/${entries.length}: ${entry.name}...`;

        if (entry.isDirectory) {
          // It's a folder (e.g. "Band 01") -> Upload to basePath/Band 01
          await processDirectoryEntry(entry as FileSystemDirectoryEntry, cleanBasePath);
        } else if (entry.isFile) {
          // It's a file -> Check if it's CBZ/CBR
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject)
          );
          await processFileEntry(file, cleanBasePath);
        }
      }

      status = "✅ Success! All items uploaded.";
    } catch (err: any) {
      console.error(err);
      status = "❌ Error: " + (err?.message ?? String(err));
    } finally {
      isUploading = false;
    }
  }

  // --- HANDLERS ---

  // 1. FOLDER HANDLER
  async function processDirectoryEntry(entry: FileSystemDirectoryEntry, basePath: string) {
    // Target Path = MAD/Naruto + / + Band 01
    const targetPath = `${basePath}/${entry.name}`;
    
    // Read all files in the directory
    const files = await readAllDirectoryEntries(entry);
    
    // Filter for images and sort
    const validImages = files
      .filter((f) => !f.name.startsWith(".") && IMAGE_EXT_RE.test(f.name))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

    if (validImages.length === 0) {
      console.warn(`Skipping empty/non-image folder: ${entry.name}`);
      return;
    }

    // Upload Loop
    for (let i = 0; i < validImages.length; i++) {
      const fileEntry = validImages[i];
      const file = await new Promise<File>((resolve, reject) =>
        fileEntry.file(resolve, reject)
      );

      const ext = (file.name.split(".").pop() || "").toLowerCase() || "jpg";
      // Renaming: page_001_de.jpg
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      
      status = `[${entry.name}] Uploading ${i + 1}/${validImages.length}: ${newName}...`;
      
      await uploadFile(newName, file, targetPath);
    }
  }

  // 2. ARCHIVE HANDLER (CBZ/CBR)
  async function processFileEntry(file: File, basePath: string) {
    const name = file.name.toLowerCase();
    
    // Determine Folder Name from filename (e.g. "Band 01.cbz" -> "Band 01")
    const folderName = file.name.replace(/\.[^/.]+$/, ""); 
    const targetPath = `${basePath}/${folderName}`;

    if (name.endsWith(".cbz")) {
      await processCBZ(file, targetPath);
    } else if (name.endsWith(".cbr")) {
      if (!unrarReady) throw new Error("CBR engine not ready.");
      await processCBR(file, targetPath);
    } 
    // Ignore loose images dropped at root level to keep things clean
  }

  // --- PROCESSING LOGIC (Reused/Adapted) ---

  async function processCBZ(file: File, targetPath: string) {
    status = `Reading ${file.name}...`;
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

    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      const ext = (item.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
      
      status = `[${file.name}] Uploading ${i + 1}/${images.length}...`;
      const blob = await item.entry.async("blob");
      await uploadFile(newName, blob, targetPath);
    }
  }

  async function processCBR(file: File, targetPath: string) {
    const arrayBuffer = await file.arrayBuffer();
    const extractor = await createExtractorFromData!({ data: arrayBuffer, wasmBinary });
    
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders]; // Iterate
    
    const imageHeaders = fileHeaders
      .filter((h: any) => h.name && !h.name.startsWith("__MACOSX") && !h.name.startsWith(".") && IMAGE_EXT_RE.test(h.name))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    for (let i = 0; i < imageHeaders.length; i++) {
      const header = imageHeaders[i];
      const ext = (header.name.split(".").pop() || "").toLowerCase() || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;

      status = `[${file.name}] Extracting ${i + 1}/${imageHeaders.length}...`;
      
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

  // --- UTILS ---
  
  // Helper to read all files in a directory (recursively or flat)
  async function readAllDirectoryEntries(directoryReader: FileSystemDirectoryEntry) {
    const reader = directoryReader.createReader();
    let entries: FileSystemEntry[] = [];
    
    // readEntries only returns ~100 items at a time, loop until empty
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
    
    // We only want files for now (ignore nested subfolders inside Band 01 for simplicity)
    // If you need deep recursion, you'd add it here.
    return entries.filter(e => e.isFile) as FileSystemFileEntry[];
  }
</script>

<div style="padding: 2rem; max-width: 600px; margin: 0 auto; font-family: sans-serif;">
  <h1>Series Upload Tool</h1>

  <div style="margin-bottom: 20px;">
    <label for="basePathInput" style="display:block; font-weight:bold;">Series Base Path:</label>
    <input
      id="basePathInput"
      type="text"
      bind:value={basePath}
      placeholder="e.g. MAD/Naruto"
      style="width: 100%; padding: 10px; margin-top:5px;"
    />
    <small style="color: #666;">
      Drag "Band 01", "Band 02"... -> Uploads to <code>{basePath || "..."}/Band 01/page_001_de.jpg</code>
    </small>
  </div>

  <div
    role="button"
    tabindex="0"
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    style="border: 3px dashed #ccc; padding: 50px; text-align: center; border-radius: 10px; background: #f9f9f9; transition: background 0.2s;"
    class:uploading={isUploading}
  >
    <h2>{isUploading ? "Processing..." : "📂 Drag Folders (Band 01...) or Archives Here"}</h2>
    <p style="white-space: pre-wrap;">{status}</p>
  </div>
</div>

<style>
  .uploading {
    background: #e6f7ff !important;
    border-color: #1890ff !important;
  }
</style>
