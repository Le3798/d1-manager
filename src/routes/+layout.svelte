<script lang="ts">
  import "../app.css"; // Ensure global styles are loaded
  import { t } from "svelte-i18n";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  
  export let data; // Comes from layout.server.ts (contains dbms list)

  // Function to handle database selection change
  function handleDbChange(event) {
    const db = event.target.value;
    if (db) {
      goto(`/db/${db}`);
    }
  }
</script>

<div class="h-full overflow-y-auto bg-base-200 flex flex-col font-sans text-base-content">
  <!-- NAVBAR -->
  <div class="navbar bg-base-100 shadow-md px-4">
    <div class="navbar-start">
      <div class="dropdown">
        <label tabindex="0" class="btn btn-ghost lg:hidden">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" /></svg>
        </label>
        <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
           <li><a href="/" class:active={$page.url.pathname === '/'}>Home</a></li>
           <li><a href="/upload" class:active={$page.url.pathname.startsWith('/upload')}>Upload</a></li>
           <li><a href="/ocr" class:active={$page.url.pathname.startsWith('/ocr')}>OCR</a></li>
        </ul>
      </div>
      <a href="/" class="btn btn-ghost normal-case text-xl">D1 Manager</a>
    </div>

    <div class="navbar-center hidden lg:flex">
      <ul class="menu menu-horizontal px-1 gap-2">
        <li><a href="/" class:active={$page.url.pathname === '/'}>Home</a></li>
        <li><a href="/upload" class:active={$page.url.pathname.startsWith('/upload')}>Upload Tool</a></li>
        <li><a href="/ocr" class:active={$page.url.pathname.startsWith('/ocr')}>OCR Tool</a></li>
      </ul>
    </div>

    <div class="navbar-end gap-2">
      <!-- DATABASE SELECTOR (Existing Feature) -->
      <select class="select select-bordered select-sm max-w-xs" on:change={handleDbChange}>
        <option disabled selected>{$t("select-database")}</option>
        {#each data.dbms as db}
          <option value={db}>{db}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- MAIN CONTENT -->
  <main class="flex-grow p-4 container mx-auto">
    <slot />
  </main>

  <!-- FOOTER -->
  <footer class="footer p-4 bg-neutral text-neutral-content mt-auto">
    <div class="items-center grid-flow-col">
      <p>Custom D1 Manager © {new Date().getFullYear()}</p>
    </div>
  </footer>
</div>

<style>
  /* Optional: Active link styling if DaisyUI isn't catching it perfectly */
  .menu .active {
    background-color: hsl(var(--p)) !important;
    color: hsl(var(--pc)) !important;
  }
</style>
