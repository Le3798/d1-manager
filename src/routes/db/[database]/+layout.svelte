<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";

  export let data; // Contains list of tables in data.db

  // Helper to check if a table is active
  $: activeTable = $page.params.table;
</script>

<div class="drawer lg:drawer-open">
  <input id="db-drawer" type="checkbox" class="drawer-toggle" />
  
  <div class="drawer-content flex flex-col p-6">
    <!-- PAGE CONTENT SLOT -->
    <div class="flex items-center justify-between mb-4 lg:hidden">
      <label for="db-drawer" class="btn btn-square btn-ghost">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-6 h-6 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
      </label>
      <span class="font-bold text-lg">{$page.params.database}</span>
    </div>

    {#key $page.params.table}
      <slot />
    {/key}
  </div> 
  
  <div class="drawer-side z-20">
    <label for="db-drawer" class="drawer-overlay"></label> 
    <ul class="menu p-4 w-80 h-full bg-base-200 text-base-content">
      <!-- SIDEBAR HEADER -->
      <li class="menu-title text-lg font-bold uppercase tracking-widest opacity-70 mb-2">
        {$page.params.database}
      </li>
      
      <!-- ACTIONS -->
      <li class="mb-4">
        <a href="/db/{$page.params.database}/sql" class:active={$page.url.pathname.endsWith('/sql')}>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
          Run SQL Query
        </a>
      </li>

      <!-- TABLES LIST -->
      <li class="menu-title">Tables ({data.db.length})</li>
      
      {#each data.db as table}
        <li>
          <a 
            href="/db/{$page.params.database}/{table}" 
            class:active={activeTable === table}
            class="flex justify-between"
          >
            <span class="truncate">{table}</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7-6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z" /></svg>
          </a>
        </li>
      {/each}

      <div class="divider"></div>
      
      <!-- IMPORT/EXPORT (Preserving your logic) -->
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
