<script>
  import { createWorker } from 'tesseract.js';
  import { pipeline } from '@xenova/transformers';
  import { onDestroy, onMount } from 'svelte';

  let fileInput;
  let statusMsg = "Ready"; // Renamed from 'status'
  let resultText = "";
  let confidence = 0;
  let isProcessing = false;
  let worker = null;

  // Translation variables
  let translator = null;
  let isTranslatorLoading = false;
  let translation = "";

  // Canvas variables
  let canvas;
  let ctx;
  let imgObj = null;
  let isDragging = false;
  let startX, startY, currentX, currentY;
  let selection = null;

  onMount(() => {
    if (canvas) {
        ctx = canvas.getContext('2d');
    }
  });

  onDestroy(async () => {
    if (worker) await worker.terminate();
  });

  // --- Translation Loader ---
  async function loadTranslator() {
    if (translator) return;
    isTranslatorLoading = true;
    statusMsg = "Downloading translation model (happens once)...";
    
    try {
      translator = await pipeline('translation', 'Xenova/opus-mt-de-en');
      statusMsg = "Translator ready!";
    } catch (err) {
      console.error(err);
      statusMsg = "❌ Failed to load translator";
    } finally {
      isTranslatorLoading = false;
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      
      imgObj = new Image();
      imgObj.onload = () => {
        canvas.width = imgObj.width;
        canvas.height = imgObj.height;
        ctx = canvas.getContext('2d');
        drawCanvas();
        statusMsg = "Image loaded. Drag a box around text to scan.";
      };
      imgObj.src = url;
      
      resultText = "";
      translation = "";
      confidence = 0;
      selection = null;
    }
  }

  function onMouseDown(e) {
    if (!imgObj) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;
    isDragging = true;
    selection = null;
    drawCanvas();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    currentX = (e.clientX - rect.left) * scaleX;
    currentY = (e.clientY - rect.top) * scaleY;
    drawCanvas();
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    const w = currentX - startX;
    const h = currentY - startY;

    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      selection = {
        x: w > 0 ? startX : currentX,
        y: h > 0 ? startY : currentY,
        w: Math.abs(w),
        h: Math.abs(h)
      };
      drawCanvas();
      scanSelection();
    }
  }

  function drawCanvas() {
    if (!ctx || !imgObj) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgObj, 0, 0);

    let box = selection;
    if (isDragging) {
      box = { x: startX, y: startY, w: currentX - startX, h: currentY - startY };
    }

    if (box) {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 5;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, canvas.width, box.y);
      ctx.fillRect(0, box.y + box.h, canvas.width, canvas.height - (box.y + box.h));
      ctx.fillRect(0, box.y, box.x, box.h);
      ctx.fillRect(box.x + box.w, box.y, canvas.width - (box.x + box.w), box.h);
    }
  }

  async function scanSelection() {
    if (!selection) return;
    isProcessing = true;
    
    // Auto-load translator if needed
    if (!translator && !isTranslatorLoading) {
        await loadTranslator();
    }

    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = selection.w;
      tempCanvas.height = selection.h;
      const tCtx = tempCanvas.getContext('2d');
      
      tCtx.drawImage(imgObj, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
      
      // Binarize
      const imageData = tCtx.getImageData(0, 0, selection.w, selection.h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const color = avg > 140 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = color;
      }
      tCtx.putImageData(imageData, 0, 0);

      const cropUrl = tempCanvas.toDataURL();

      if (!worker) {
        statusMsg = "Loading German OCR model...";
        worker = await createWorker('deu');
      }

      statusMsg = "Reading text...";
      const ret = await worker.recognize(cropUrl);
      
      resultText = ret.data.text.trim();
      confidence = ret.data.confidence;

      // Translate
      if (resultText && translator) {
        statusMsg = "Translating...";
        const output = await translator(resultText, {
          src_lang: 'deu',
          tgt_lang: 'eng'
        });
        translation = output[0].translation_text;
        statusMsg = "✅ Done!";
      } else {
        statusMsg = "✅ OCR Done (Waiting for translator...)";
      }
      
    } catch (err) {
      console.error(err);
      statusMsg = "❌ Error: " + err.message;
    } finally {
      isProcessing = false;
    }
  }
</script>

<div style="padding: 2rem; max-width: 1200px; margin: 0 auto; font-family: sans-serif;">
  <h1>🔪 Crop & Scan & Translate</h1>
  <p>Draw a box around a German speech bubble to translate it.</p>

  <input type="file" accept="image/*" on:change={handleFileSelect} bind:this={fileInput} style="margin-bottom: 10px;" />

  <div style="display: flex; gap: 20px; align-items: flex-start;">
    
    <!-- Left: Canvas Area -->
    <div style="flex: 2; border: 1px solid #ccc; overflow: auto; max-height: 80vh; position: relative;">
      <canvas 
        bind:this={canvas}
        on:mousedown={onMouseDown}
        on:mousemove={onMouseMove}
        on:mouseup={onMouseUp}
        on:mouseleave={onMouseUp}
        style="cursor: crosshair; display: block; max-width: 100%;"
      ></canvas>
      
      {#if !imgObj}
        <div style="padding: 50px; text-align: center; color: #888;">
          Select an image to start
        </div>
      {/if}
    </div>

    <!-- Right: Results -->
    <div style="flex: 1; background: #f9f9f9; padding: 20px; border-radius: 8px; min-width: 300px;">
      <h3>Status</h3>
      <p style="color: #666; font-size: 0.9em;">{statusMsg}</p>
      
      <h3>Detected Text (German)</h3>
      <div style="background: white; padding: 10px; border: 1px solid #ddd; min-height: 50px; margin-bottom: 20px; white-space: pre-wrap;">
        {resultText || "..."}
      </div>

      <h3>Translation (English)</h3>
      <div style="background: #eef; padding: 10px; border: 1px solid #aaf; min-height: 50px; margin-bottom: 20px;">
        {translation || "..."}
      </div>

      {#if confidence > 0}
        <small>Confidence: {confidence}%</small>
      {/if}
    </div>

  </div>
</div>
