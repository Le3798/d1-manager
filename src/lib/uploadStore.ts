// src/lib/uploadStore.ts
import { writable, derived, get } from 'svelte/store';
import JSZip from 'jszip';
import { browser } from '$app/environment';

// --- TYPES ---
export interface QueueItem {
    id: string;
    name: string;
    type: 'file' | 'folder';
    status: 'pending' | 'scanning' | 'uploading' | 'done' | 'error';
    progress: number;
    total: number;
    message: string;
}

// --- GLOBAL STATE ---
// These stores persist as long as the tab is open
export const uploadQueue = writable<QueueItem[]>([]);
export const basePath = writable<string>(""); // Persist the text input too
export const isProcessing = writable(false);

// Derived helpers for the UI
export const activeQueueCount = derived(uploadQueue, $q => $q.filter(i => i.status !== 'done').length);
export const hasFinishedTasks = derived(uploadQueue, $q => $q.some(i => i.status === 'done'));

// --- INTERNAL ENGINE STATE ---
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;
const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"
};

let unrarReady = false;
let wasmBinary: ArrayBuffer | null = null;
let createExtractorFromData: any = null;
let executionQueue = Promise.resolve();

// --- INITIALIZATION ---
export async function initUnrar() {
    if (!browser || unrarReady) return;
    try {
        const unrar = await import("node-unrar-js");
        createExtractorFromData = unrar.createExtractorFromData;
        const wasmMod = await import("node-unrar-js/esm/js/unrar.wasm?url");
        const res = await fetch(wasmMod.default as string);
        if (!res.ok) throw new Error(`Failed to load WASM: ${res.status}`);
        wasmBinary = await res.arrayBuffer();
        unrarReady = true;
        console.log("Unrar Engine Ready");
    } catch (e) {
        console.error("Unrar loading failed:", e);
    }
}

// --- QUEUE MANAGEMENT ---
export function clearFinished() {
    uploadQueue.update(q => q.filter(item => item.status !== 'done'));
}

export function removeJob(id: string) {
    uploadQueue.update(q => q.filter(item => item.id !== id));
}

export function updateItem(id: string, updates: Partial<QueueItem>) {
    uploadQueue.update(q => q.map(item => item.id === id ? { ...item, ...updates } : item));
}

function addToQueueChain(task: () => Promise<void>) {
    executionQueue = executionQueue.then(() => task()).catch(err => {
        console.error("Queue processing error:", err);
    });
}

function isJobAlive(id: string): boolean {
    // Check if the job is still in the global store
    const q = get(uploadQueue);
    return q.some(item => item.id === id);
}

// --- FILE HANDLING LOGIC ---
export function naturalSort(a: { name: string }, b: { name: string }) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function isMangaMode(path: string): boolean {
    return path.startsWith("MAD/");
}

// --- ADDING FILES ---
export function handleFiles(files: File[]) {
    const currentPath = get(basePath);
    files.sort(naturalSort);
    
    const newItems: QueueItem[] = files.map(f => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: 'file',
        status: 'pending',
        progress: 0,
        total: 1,
        message: 'Waiting...'
    }));

    // Update Store
    uploadQueue.update(q => [...q, ...newItems]);

    // Trigger Logic
    newItems.forEach(item => {
        const file = files.find(f => f.name === item.name);
        if (file) addToQueueChain(() => processSingleFile(item.id, file, currentPath));
    });
}

export function handleFolders(folders: Map<string, File[]>) {
    const currentPath = get(basePath);
    const folderNames = Array.from(folders.keys()).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
    
    const newItems: QueueItem[] = folderNames.map(folderName => ({
        id: crypto.randomUUID(),
        name: folderName,
        type: 'folder',
        status: 'pending',
        progress: 0,
        total: folders.get(folderName)!.length,
        message: 'Waiting...'
    }));

    uploadQueue.update(q => [...q, ...newItems]);

    newItems.forEach(item => {
        const folderFiles = folders.get(item.name)!;
        folderFiles.sort(naturalSort);
        addToQueueChain(() => processBatch(item.id, folderFiles, currentPath));
    });
}

// --- DRAG AND DROP HELPER ---
export async function handleDropEntries(rawEntries: FileSystemEntry[]) {
    const currentPath = get(basePath);
    rawEntries.sort(naturalSort);

    const newItems: QueueItem[] = rawEntries.map(e => ({
        id: crypto.randomUUID(),
        name: e.name,
        type: e.isDirectory ? 'folder' : 'file',
        status: 'pending',
        progress: 0,
        total: 0,
        message: 'Waiting...'
    }));

    uploadQueue.update(q => [...q, ...newItems]);

    newItems.forEach((item, i) => {
        const entry = rawEntries[i];
        addToQueueChain(async () => {
             if (!isJobAlive(item.id)) return;
             if (entry.isDirectory) {
               await processDirectoryEntry(item.id, entry as FileSystemDirectoryEntry, currentPath);
            } else {
                const file = await new Promise<File>((resolve, reject) => {
                    (entry as FileSystemFileEntry).file(resolve, reject);
                });
               await processSingleFile(item.id, file, currentPath);
            }
        });
    });
}

// --- PROCESSING ENGINES ---
async function uploadFile(filename: string, blob: Blob | File, path: string) {
    const fd = new FormData();
    fd.append("file", blob);
    fd.append("filename", filename);
    fd.append("folderPath", path);
    const res = await fetch("/api/upload-r2", { method: "POST", body: fd });
    if (!res.ok) throw new Error("Upload failed");
}

async function processBatch(jobId: string, files: File[], path: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { status: 'uploading', total: files.length, message: 'Starting...' });
    
    for (let i = 0; i < files.length; i++) {
        if (!isJobAlive(jobId)) return;
        const f = files[i];
        updateItem(jobId, { progress: i + 1, message: `Uploading ${f.name}...` });
        try {
            const relPath = f.webkitRelativePath || f.name;
            let targetPath = path;
            let finalName = f.name;

            if (isMangaMode(path)) {
                 const parts = relPath.split('/');
                 const folderName = parts.length > 1 ? parts.slice(0, -1).join('/') : "";
                 targetPath = `${path}/${folderName}`;
                 if (IMAGE_EXT_RE.test(f.name)) {
                     const ext = (f.name.split(".").pop() || "").toLowerCase() || "jpg";
                     finalName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
                 }
            } else {
                const fullPath = path ? `${path}/${relPath}` : relPath;
                const lastSlash = fullPath.lastIndexOf('/');
                targetPath = lastSlash !== -1 ? fullPath.substring(0, lastSlash) : "";
                finalName = f.name;
            }
            await uploadFile(finalName, f, targetPath);
        } catch (e: any) { console.error(e); }
    }
    if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
}

async function processSingleFile(jobId: string, file: File, path: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { status: 'uploading', total: 1, message: 'Processing...' });
    try {
        const name = file.name.toLowerCase();
        let targetPath = path;
        
        if (isMangaMode(path)) {
            const folderName = file.name.replace(/\.[^/.]+$/, "");
            targetPath = `${path}/${folderName}`;
            if (name.endsWith(".cbz")) { await processCBZ(jobId, file, targetPath); return; }
            else if (name.endsWith(".cbr")) {
                if (!unrarReady) throw new Error("CBR engine not ready");
                await processCBR(jobId, file, targetPath); return;
            }
            throw new Error("Manga Mode: Single files must be .cbz/.cbr");
        } 
        await uploadFile(file.name, file, path);
        if (isJobAlive(jobId)) updateItem(jobId, { progress: 1, status: 'done', message: 'Done' });
    } catch (e: any) { 
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'error', message: e.message });
    }
}

async function processCBZ(jobId: string, file: File, targetPath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Unzipping...' });
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const files = Object.values(content.files).filter(e => !e.dir && IMAGE_EXT_RE.test(e.name));
    
    if (isJobAlive(jobId)) updateItem(jobId, { total: files.length, message: 'Uploading...' });
    files.sort(naturalSort);
    
    for (let i = 0; i < files.length; i++) {
        if (!isJobAlive(jobId)) return;
        const entry = files[i];
        const blob = await entry.async("blob");
        const ext = entry.name.split('.').pop() || 'jpg';
        const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
        
        updateItem(jobId, { progress: i + 1, message: `Uploading ${i+1}/${files.length}` });
        await uploadFile(newName, blob, targetPath);
    }
    if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
}

async function processCBR(jobId: string, file: File, targetPath: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Unrar...' });
    try {
        const ab = await file.arrayBuffer();
        const extractor = await createExtractorFromData!({ data: ab, wasmBinary });
        const listObj = extractor.getFileList();
        const list = [...listObj.fileHeaders].filter((h: any) => !h.flags.directory && IMAGE_EXT_RE.test(h.name));
        
        if (list.length === 0) throw new Error("No valid images found in CBR");
        if (isJobAlive(jobId)) updateItem(jobId, { total: list.length, message: 'Uploading...' });
        list.sort(naturalSort);
        
        for (let i = 0; i < list.length; i++) {
            if (!isJobAlive(jobId)) return;
            const h = list[i];
            const extracted = extractor.extract({ files: [h.name] });
            const [arc] = [...extracted.files];
            if (arc && arc.extraction) {
                const ext = h.name.split('.').pop() || 'jpg';
                const blob = new Blob([arc.extraction], { type: mimeByExt[ext] || 'image/jpeg' });
                const newName = `page_${String(i + 1).padStart(3, "0")}_de.${ext}`;
                updateItem(jobId, { progress: i + 1, message: `Uploading ${i+1}/${list.length}` });
                await uploadFile(newName, blob, targetPath);
            }
        }
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'done', message: 'Completed' });
    } catch (err: any) {
        if (isJobAlive(jobId)) updateItem(jobId, { status: 'error', message: "Failed: " + (err.message || "Invalid CBR") });
    }
}

async function processDirectoryEntry(jobId: string, entry: FileSystemDirectoryEntry, path: string) {
    if (!isJobAlive(jobId)) return;
    updateItem(jobId, { message: 'Scanning directory...' });
    const entries = await readAllDirectoryEntries(entry);
    const files: File[] = [];
    for (const e of entries) {
        const f = await new Promise<File>((resolve) => e.file(resolve));
        Object.defineProperty(f, 'webkitRelativePath', { value: e.fullPath.substring(1) });
        files.push(f);
    }
    await processBatch(jobId, files, path);
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