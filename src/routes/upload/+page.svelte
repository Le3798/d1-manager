<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { themeChange } from "theme-change";
  
  // Import from our new global engine
  import { 
    uploadQueue, 
    basePath, 
    isProcessing, 
    activeQueueCount,
    hasFinishedTasks,
    initUnrar,
    isMangaMode,
    naturalSort,
    handleFiles,
    handleFolders,
    handleDropEntries,
    clearFinished,
    removeJob
  } from "$lib/uploadStore";

  // --- LOCAL UI STATE ---
  // Only state that affects the UI strictly (like input references or modal visibility) stays here.
  let fileInput: HTMLInputElement; 
  let folderInput: HTMLInputElement;
  let uploadMode: 'files' | 'folder' = 'files';
  
  // Manage Mode
  let isManageMode = false;
  let selectedJobIds = new Set<string>();
  let deleteModal: HTMLDialogElement;
  let isBatchDelete = true; // tracked for the modal

  $: selectedCount = selectedJobIds.size;
  // Subscribe to store values for UI logic
  $: queueLength = $uploadQueue.length;

  // --- THEMES & INIT ---
  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter", "dim", "nord", "sunset",
  ];

  onMount(async () => {
    if (!browser) return;
    themeChange(false);
    // Initialize the engine (it checks if it's already ready internally)
    await initUnrar();
  });

  onDestroy(() => {
    // Safety close modal
    if (browser && deleteModal && deleteModal.open) {
      deleteModal.close();
    }
  });

  // --- MANAGE LOGIC ---
  function toggleManageMode() {
    isManageMode = !isManageMode;
    if (!isManageMode) {
        selectedJobIds.clear();
        selectedJobIds = selectedJobIds;
    }
  }

  function toggleSelection(id: string) {
    if (selectedJobIds.has(id)) selectedJobIds.delete(id);
    else selectedJobIds.add(id);
    selectedJobIds = selectedJobIds;
  }

  function toggleSelectAll() {
    if (selectedCount === $uploadQueue.length) selectedJobIds.clear();
    else $uploadQueue.forEach(item => selectedJobIds.add(item.id));
    selectedJobIds = selectedJobIds;
  }

  function clearFinishedUI() {
    clearFinished();
    // Re-sync selection
    const remainingIds = new Set($uploadQueue.map(i => i.id));
    selectedJobIds = new Set([...selectedJobIds].filter(id => remainingIds.has(id)));
  }

  // --- DELETE MODAL ---
  function promptDeleteBatch() {
    if (selectedCount === 0) return;
    if (deleteModal) deleteModal.showModal();
  }

  function confirmDelete() {
    // Remove from global store
    selectedJobIds.forEach(id => removeJob(id));
    selectedJobIds.clear();
    selectedJobIds = selectedJobIds;
    if (deleteModal) deleteModal.close();
  }

  function cancelDelete() {
    if (deleteModal) deleteModal.close();
  }

  // --- INPUT HANDLERS ---
  function openFileBrowser() {
    uploadMode === 'folder' ? folderInput.click() : fileInput.click();
  }

  function handleFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    let files = Array.from(input.files);
    const isFolderUpload = input.webkitdirectory;

    if (isFolderUpload) {
        const folders = new Map<string, File[]>();
        files.forEach(f => {
            const path = f.webkitRelativePath || f.name;
            const rootFolder = path.split('/')[0];
            if (!folders.has(rootFolder)) folders.set(rootFolder, []);
            folders.get(rootFolder)!.push(f);
        });
        handleFolders(folders);
    } else {
        handleFiles(files);
    }
    input.value = '';
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    const items = event.dataTransfer?.items;
    if (!items) return;

    const rawEntries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) rawEntries.push(entry);
    }
    handleDropEntries(rawEntries);
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
          bind:value={$basePath}
          placeholder="e.g. MAD/One Piece OR Books/History (leave blank for root)"
          class="input input-bordered w-full bg-base-200 focus:input-primary"
        />
        <label class="label pt-3">
          <span class="label-text-alt text-base-content/70 whitespace-normal break-words">
            {#if isMangaMode($basePath)}
              <b>Manga Mode:</b> Files renamed to <code>page_001_de.jpg</code> inside <code>{$basePath}/[FolderName]</code>
            {:else if $basePath}
              <b>Book Mode:</b> Files uploaded directly to <code>{$basePath}/</code> with original names
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
           {$isProcessing ? 'border-primary bg-primary/10 opacity-70 pointer-events-none' : 'border-base-300 bg-base-200 hover:border-primary hover:bg-base-300'}"
  >
    <h2 class="text-2xl font-semibold mb-2">
      {$isProcessing ? "Processing..." : `Drag or Click to Upload ${uploadMode === 'folder' ? 'Folder' : 'Files'}`}
    </h2>
    <p class="text-base-content/60 mb-2">
      Supports CBZ, PDF, MP3, ZIP, & more
    </p>
    <span class="badge badge-ghost text-xs">
      Mode: {uploadMode === 'folder' ? 'Folder Upload' : 'Multi-File Upload'}
    </span>
  </div>

  {#if $uploadQueue.length > 0}
    <div class="card bg-base-100 shadow-xl mt-6 border border-base-200 rounded-xl">
      
      <div class="card-header p-4 bg-base-200 font-bold border-b border-base-300 flex items-center justify-between rounded-t-xl">
        <div class="flex items-center gap-3">
            {#if isManageMode}
                <input 
                  type="checkbox" 
                  class="checkbox checkbox-sm checkbox-primary"
                  checked={$uploadQueue.length > 0 && selectedCount === $uploadQueue.length}
                  on:change={toggleSelectAll}
                />
            {/if}
            
            <span>Upload Queue ({$activeQueueCount})</span>

            {#if isManageMode && $hasFinishedTasks}
              <div class="tooltip tooltip-top" data-tip="Clear all finished tasks">
                <button 
                  class="btn btn-xs btn-ghost gap-1 text-base-content/70 hover:text-primary transition-colors"
                  on:click={clearFinishedUI}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear Finished
                </button>
              </div>
            {/if}
        </div>

        <div class="flex items-center gap-2">
          
          {#if isManageMode && selectedCount > 0}
                <button 
                    class="btn btn-sm btn-error btn-square mr-2 animate-pulse" 
                    on:click={promptDeleteBatch}
                    title="Delete Selected"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            {/if}
            
            <button 
                class="btn btn-sm {isManageMode ? 'btn-primary' : 'btn-ghost'}" 
                on:click={toggleManageMode}
            >
                {isManageMode ? 'Done' : 'Manage'}
            </button>
        </div>
      </div>

      <div class="max-h-[50vh] overflow-y-auto p-0 scrollbar-thin rounded-b-xl">
        {#each $uploadQueue as job (job.id)}
          <div 
            class="p-4 border-b border-base-200 last:border-none hover:bg-base-200/50 transition-colors flex items-center gap-4"
            class:bg-base-200={isManageMode && selectedJobIds.has(job.id)}
            role="button"
            tabindex="0"
            on:click={() => isManageMode && toggleSelection(job.id)}
            on:keydown={(e) => e.key === 'Enter' && isManageMode && toggleSelection(job.id)}
          >
            
            {#if isManageMode}
                <input 
                    type="checkbox" 
                    class="checkbox checkbox-primary" 
                    checked={selectedJobIds.has(job.id)}
                    readonly 
                />
            {/if}

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
                    style="width: {job.total ? (job.progress / job.total) * 100 : 0}%"
                    ></div>
                </div>
                <div class="flex justify-between text-xs text-base-content/60">
                    <span>{job.progress} / {job.total} files</span>
                    <span class="uppercase font-bold tracking-wider">{job.status}</span>
                </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<dialog 
    bind:this={deleteModal} 
    class="modal modal-bottom sm:modal-middle" 
    on:close={() => { isBatchDelete = true; }}
    style="z-index: 99999;"
>
  <div class="modal-box">
    <h3 class="font-bold text-lg text-error">Delete Selected Tasks</h3>
    <p class="py-4">
        Are you sure you want to remove <b>{selectedCount}</b> tasks?
        This action cannot be undone.
    </p>
    
    <div class="modal-action">
        <button type="button" class="btn" on:click={cancelDelete}>Cancel</button>
        <button type="button" class="btn btn-error" on:click={confirmDelete}>
            Yes, Delete
        </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
      <button>close</button>
  </form>
</dialog>