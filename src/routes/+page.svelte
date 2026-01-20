<script lang="ts">
  import { t, locales, locale } from "svelte-i18n";
  import { onMount } from "svelte";
  import { themeChange } from "theme-change";

    const themes = [
    "light",
    "dark",
    "cupcake",
    "bumblebee",
    "emerald",
    "corporate",
    "synthwave",
    "retro",
    "cyberpunk",
    "valentine",
    "halloween",
    "garden",
    "forest",
    "aqua",
    "lofi",
    "pastel",
    "fantasy",
    "wireframe",
    "black",
    "luxury",
    "dracula",
    "cmyk",
    "autumn",
    "business",
    "acid",
    "lemonade",
    "night",
    "coffee",
    "winter",
    "dim",
    "nord",
    "sunset",
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

      <!-- Theme Selector -->
      <div class="form-control w-full max-w-xs mx-auto">
        <label class="label">
          <span class="label-text">{$t("theme")}</span>
        </label>
        <select class="select select-bordered w-full" data-choose-theme>
          <option disabled selected>Select Theme</option>
          {#each themes as theme}
            <option value={theme}>{theme}</option>
          {/each}
        </select>
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
