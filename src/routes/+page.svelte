<script lang="ts">
  import { t, locales, locale } from "svelte-i18n";
  import { themeChange } from "theme-change";
  import { onMount } from "svelte";

  // Available DaisyUI themes
  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter",
  ];

  onMount(() => {
    themeChange(false);
  });
</script>

<div class="hero min-h-[50vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">Welcome Back</h1>
      <p class="py-6">Manage your databases, upload files, and process text with OCR all in one place.</p>
      
      <div class="flex flex-col gap-4">
        <a href="/upload" class="btn btn-primary">Go to Upload Tool</a>
        <a href="/ocr" class="btn btn-secondary">Go to OCR Tool</a>
      </div>
      
      <div class="divider">Settings</div>

      <!-- THEME & LANG SETTINGS (Preserved from your original file) -->
      <div class="flex flex-col gap-4 items-center">
        <!-- Theme Selector -->
        <div class="form-control w-full max-w-xs">
          <label class="label"><span class="label-text">{$t("theme")}</span></label>
          <select class="select select-bordered" data-choose-theme>
            {#each themes as th}
              <option value={th}>{th}</option>
            {/each}
          </select>
        </div>

        <!-- Language Selector -->
        <div class="form-control w-full max-w-xs">
          <label class="label"><span class="label-text">{$t("language")}</span></label>
          <select class="select select-bordered" bind:value={$locale}>
            {#each $locales as lang}
              <option value={lang}>{$t(`lang.${lang}`)}</option>
            {/each}
          </select>
        </div>
      </div>

    </div>
  </div>
</div>
