<script lang="ts">
  import { t, locale, locales } from "svelte-i18n";
  import { themeChange } from "theme-change";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  // FULL THEME LIST (Matches Upload Tool)
  const themes = [
    "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
    "synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
    "forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
    "luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
    "night", "coffee", "winter", "dim", "nord", "sunset",
  ];

  onMount(() => {
    themeChange(false);
  });
</script>

<div class="hero min-h-screen bg-base-200 pb-20">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">Welcome Back</h1>
      <p class="py-6">
        Manage your databases, upload files, and process text with OCR all in one place.
      </p>
      
      <div class="flex flex-col gap-4">
        <button class="btn btn-primary" on:click={() => goto('/upload')}>Go to Upload Tool</button>
        <button class="btn btn-secondary" on:click={() => goto('/ocr')}>Go to OCR Tool</button>
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
      <div class="form-control w-full max-w-xs mx-auto mt-4">
        <label class="label">
          <span class="label-text">{$t("language")}</span>
        </label>
        <select class="select select-bordered w-full" bind:value={$locale}>
          {#each $locales as lang}
            <option value={lang}>{$t(`lang.${lang}`)}</option>
          {/each}
        </select>
      </div>

    </div>
  </div>
</div>
