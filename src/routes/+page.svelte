<script lang="ts">
  import { t, locales, locale } from "svelte-i18n";
  import { onMount } from "svelte";
  import { themeChange } from "theme-change";

  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter",
  ];

  onMount(() => {
    // Initialize theme-change listener
    themeChange(false);
  });
</script>

<div class="hero min-h-[80vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">Welcome Back</h1>
      <p class="py-6">Manage your databases, upload files, and process text with OCR all in one place.</p>
      
      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-8">
        <a href="/upload" class="btn btn-primary">Go to Upload Tool</a>
        <a href="/ocr" class="btn btn-secondary">Go to OCR Tool</a>
      </div>
      
      <div class="divider">Appearance</div>

      <div class="grid grid-cols-1 gap-4 items-center justify-items-center">
              
            <!-- Theme Selector (Custom Dropdown) -->
      <div class="form-control w-full max-w-xs">
        <label class="label">
          <span class="label-text">{$t("theme")}</span>
        </label>

        <div class="dropdown dropdown-end w-full">
          <!-- Button acts as the "Select" box -->
          <div tabindex="0" role="button" class="btn btn-outline border-base-content/20 w-full justify-between font-normal bg-base-100">
            Theme
            <svg class="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
          
          <!-- The Scrollable List -->
          <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full max-h-60 overflow-y-auto flex-nowrap block">
            {#each themes as theme}
              <li>
                <!-- data-set-theme applies the theme when clicked -->
                <button class="w-full text-left" data-set-theme={theme} data-act-class="active">
                  {theme}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      </div>

        <!-- Language Selector -->
        <div class="form-control w-full max-w-xs">
          <label class="label"><span class="label-text">{$t("language")}</span></label>
          <select class="select select-bordered w-full" bind:value={$locale}>
            {#each $locales as lang}
              <option value={lang}>{$t(`lang.${lang}`)}</option>
            {/each}
          </select>
        </div>
      </div>

    </div>
  </div>
</div>
