<script>
  import JSZip from "jszip";
  import { onMount } from "svelte";

  let status = "Initializing...";
  let isUploading = false;
  let folderPath = "MAD/Love Trouble/Band 01";

  let unrarReady = false;
  let createExtractorFromData = null;
  let wasmBinary = null;

  const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;

  const mimeByExt = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif"
  };

  onMount(async () => {
    try {
      // Load ESM module
      const unrarModule = await import(
        "https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/index.js"
      );
      createExtractorFromData = unrarModule.createExtractorFromData;

      // Load WASM from the correct path
      const wasmUrl =
        "https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/unrar.wasm";
      const wasmResponse = await fetch(wasmUrl);

      if (!wasmResponse.ok) {
        throw new Error(
          `Failed to load WASM: ${wasmResponse.status} ${wasmResponse.statusText}`
        );
      }

      wasmBinary = await wasmResponse.arrayBuffer();

      unrarReady = true;
      status = "Ready. Drag a .CBZ or .CBR file here.";
    } catch (e) {
      console.error("Unrar loading failed:", e);
      unrarReady = false;
      status = "Warning: CBR support failed (CBZ only). Check console for details.";
    }
  });

  async function handleDrop(event) {
    event.preventDefault();
    if (isUploading) return;

    const file = event.dataTransfer?.files?.[0];
    if (!file) return alert("Please upload a file.");

    const fileName = (file.name || "").toLowerCase();
    const isCBZ = fileName.endsWith(".cbz");
    const isCBR = fileName.endsWith(".cbr");

    if (!isCBZ && !isCBR) return alert("Please upload a .cbz or .cbr file.");
    if (isCBR && !unrarReady) return alert("CBR support is not ready. Reload the page.");
    if (!folderPath) return alert("Please type the target folder path first.");

    const cleanPath = folderPath.replace(/\/$/, "");
    isUploading = true;

    try {
      if (isCBZ) await processCBZ(file, cleanPath);
      else await processCBR(file, cleanPath);

      status = "Success. All pages uploaded.";
    } catch (err) {
      console.error(err);
      status = "Error: " + (err?.message ?? String(err));
    } finally {
      isUploading = false;
    }
  }

  async function processCBZ(file, cleanPath) {
    status = "Reading CBZ file...";
    const zip = new JSZip();
    const content = await zip.loadAsync(file);

    const fileNames = Object.keys(content.files).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const imagesToUpload = [];
    for (const name of fileNames) {
      const entry = content.files[name];
      if (
        !entry.dir &&
        !name.startsWith("__MACOSX") &&
        !name.includes("/.") &&
        IMAGE_EXT_RE.test(name)
      ) {
        imagesToUpload.push({ fileName: name, fileData: entry });
      }
    }

    if (imagesToUpload.length === 0) throw new Error("No valid images found.");
    status = `Found ${imagesToUpload.length} pages. Starting upload...`;

    for (let i = 0; i < imagesToUpload.length; i++) {
      const item = imagesToUpload[i];
      const ext = (item.fileName.split(".").pop() || "").toLowerCase();
      const safeExt = ext || "jpg";

      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${safeExt}`;
      status = `Uploading ${i + 1}/${imagesToUpload.length}: ${newName}...`;

      const blob = await item.fileData.async("blob");
      await uploadFile(newName, blob, cleanPath);
    }
  }

  async function processCBR(file, cleanPath) {
    if (!createExtractorFromData || !wasmBinary) {
      throw new Error("CBR engine not initialized.");
    }

    status = "Reading CBR file...";
    const arrayBuffer = await file.arrayBuffer();

    status = "Creating extractor...";
    const extractor = await createExtractorFromData({
      data: arrayBuffer,
      wasmBinary
    });

    status = "Scanning file list...";
    const list = extractor.getFileList();

    // Force iterator evaluation for headers
    const fileHeaders = [...list.fileHeaders];

    // Encryption detection
    const archiveEncrypted = !!list.arcHeader?.flags?.headerEncrypted;
    const anyFileEncrypted = fileHeaders.some((h) => !!h?.flags?.encrypted);
    if (archiveEncrypted || anyFileEncrypted) {
      throw new Error("This CBR/RAR is encrypted/password-protected. Cannot extract.");
    }

    // Filter to images
    const imageHeaders = fileHeaders
      .filter((header) => {
        const name = header?.name;
        return (
          name &&
          !name.startsWith("__MACOSX") &&
          !name.startsWith(".") &&
          IMAGE_EXT_RE.test(name)
        );
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

    if (imageHeaders.length === 0) throw new Error("No valid images found.");

    status = `Found ${imageHeaders.length} pages. Starting extraction...`;

    for (let i = 0; i < imageHeaders.length; i++) {
      const header = imageHeaders[i];
      const ext = (header.name.split(".").pop() || "").toLowerCase();
      const safeExt = ext || "jpg";
      const newName = `page_${String(i + 1).padStart(3, "0")}_de.${safeExt}`;

      status = `Processing ${i + 1}/${imageHeaders.length}: ${newName}...`;

      // Extract only this file
      const extracted = extractor.extract({ files: [header.name] });
      const [arcFile] = [...extracted.files];

      if (!arcFile?.extraction) {
        throw new Error(`Failed to extract: ${header.name}`);
      }

      const blob = new Blob([arcFile.extraction], {
        type: mimeByExt[safeExt] ?? "application/octet-stream"
      });

      await uploadFile(newName, blob, cleanPath);
    }
  }

  async function uploadFile(filename, blob, path) {
    const formData = new FormData();
    formData.append("file", blob);
    formData.append("filename", filename);
    formData.append("folderPath", path);

    const res = await fetch("/api/upload-r2", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      let errorMsg = "Upload failed";
      try {
        const err = await res.json();
        errorMsg = err?.error || errorMsg;
      } catch (_) {}
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
    <small style="color: #666;">
      Files will be saved to: <code>{folderPath || "..."} /page_001_de.jpg</code>
    </small>
  </div>

  <div
    on:drop={handleDrop}
    on:dragover={(e) => e.preventDefault()}
    style="border: 3px dashed #ccc; padding: 50px; text-align: center; border-radius: 10px; background: #f9f9f9; transition: background 0.2s;"
    class:uploading={isUploading}
  >
    <h2>{isUploading ? "Processing..." : "Drag .CBZ or .CBR File Here"}</h2>
    <p style="white-space: pre-wrap;">{status}</p>
  </div>
</div>

<style>
  .uploading {
    background: #e6f7ff !important;
    border-color: #1890ff !important;
  }
</style>
