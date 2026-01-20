<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";

  export let data; 

  // --- LOGIC ---
  $: activeTable = $page.params.table;
  
  // Fix: Handle cases where 'table' might be an object { name: "users", ... } or just a string "users"
  $: tables = (data.db || []).map(t => (typeof t === 'object' ? t.name : t));

  // Fix: Display Name Override (default -> dlm)
  $: dbName = $page.params.database === 'default' ? 'dlm' : $page.params.database;
</script>

<div class="drawer lg:drawer-open">
  <input id="db-drawer" type="checkbox" class="drawer-toggle" />
  
  <!-- MAIN CONTENT AREA -->
  <div class="drawer-content flex flex-col p-6 min-h-[calc(100vh-4rem)]">
    <!-- Mobile Toggle Button -->
    <div class="flex items-center gap-2 mb-4 lg:hidden">
      <label for="db-drawer" class="btn btn-square btn-ghost">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-6 h-6 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
      </label>
      <h2 class="text-xl font-bold">{dbName}</h2>
    </div>

    <!-- Inject Page Content -->
    {#key $page.params.table}
      <slot />
    {/key}
  </div> 
  
  <!-- SIDEBAR -->
  <div class="drawer-side z-20">
    <label for="db-drawer" class="drawer-overlay"></label> 
    <ul class="menu p-4 w-72 h-full bg-base-200 text-base-content border-r border-base-300">
      <!-- HEADER -->
      <li class="mb-4 px-4">
        <div class="flex items-center gap-3 px-0 pointer-events-none">
          <div class="avatar placeholder">
            <div class="bg-neutral text-neutral-content rounded-full w-8">
              <span class="text-xs">DB</span>
            </div>
          </div>
          <span class="text-lg font-bold uppercase tracking-widest opacity-80">{dbName}</span>
        </div>
      </li>
      
      <!-- SQL EDITOR LINK -->
      <li>
        <a href="/db/{$page.params.database}/sql" class:active={$page.url.pathname.endsWith('/sql')} class="font-medium">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
          Run SQL Query
        </a>
      </li>

      <div class="divider my-2"></div>

      <!-- TABLES LIST -->
      <li class="menu-title flex flex-row justify-between items-center pr-2">
        <span>Tables ({tables.length})</span>
        <!-- Optional Refresh Button could go here -->
      </li>
      
      {#each tables as table}
        <li>
          <a 
            href="/db/{$page.params.database}/{table}" 
            class:active={activeTable === table}
            class="flex justify-between"
          >
            <span class="truncate">{table}</span>
          </a>
        </li>
      {/each}

      <div class="divider my-2"></div>
      
      <!-- TOOLS -->
      <li class="menu-title">Tools</li>
      <li>
        <a href="/db/{$page.params.database}/import">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          {$t("import")}
        </a>
      </li>
      <li>
        <a href="/db/{$page.params.database}/download">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          {$t("download")}
        </a>
      </li>
    </ul>
  </div>
</div>
