<script>
  import { createWorker } from 'tesseract.js';
  import { onDestroy, onMount } from 'svelte';

  let fileInput;
  let status = "Ready";
  let resultText = "";
  let confidence = 0;
  let isProcessing = false;
  let worker = null;

  // Canvas variables
  let canvas;
  let ctx;
  let imgObj = null;
  let isDragging = false;
  let startX, startY, currentX, currentY;
  let selection = null;

  onMount(() => {
    // Initialize context once mounted
    if (canvas) {
        ctx = canvas.getContext('2d');
    }
  });

  onDestroy(async () => {
    if (worker) await worker.terminate();
  });

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      
      imgObj = new Image();
      imgObj.onload = () => {
        // 1. Set canvas size to match image EXACTLY
        canvas.width = imgObj.width;
        canvas.height = imgObj.height;
        
        // 2. IMPORTANT: Get context again after resizing (some browsers reset it)
        ctx = canvas.getContext('2d');
        
        // 3. Draw immediately
        drawCanvas();
        
        status = "Image loaded. Drag a box around text to scan.";
      };
      imgObj.src = url;
      
      resultText = "";
      confidence = 0;
      selection = null;
    }
  }

  // --- Mouse Events for Drawing the Box ---

  function onMouseDown(e) {
    if (!imgObj) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;
    isDragging = true;
    selection = null; // Clear old selection
    drawCanvas();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    currentX = (e.clientX - rect.left) * scaleX;
    currentY = (e.clientY - rect.top) * scaleY;
    drawCanvas(); // Re-draw image + red box
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;

    // Calculate final box
    const w = currentX - startX;
    const h = currentY - startY;

    // Only scan if box is big enough (avoid accidental clicks)
    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      selection = {
        x: w > 0 ? startX : currentX,
        y: h > 0 ? startY : currentY,
        w: Math.abs(w),
        h: Math.abs(h)
      };
      drawCanvas(); // Draw final red box
      scanSelection(); // Auto-start OCR
    }
  }

  function drawCanvas() {
    if (!ctx || !imgObj) return;
    
    // 1. Clear & Draw Image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgObj, 0, 0);

    // 2. Draw Selection Box (Red)
    let box = selection;
    
    // If we are currently dragging, calculate temporary box
    if (isDragging) {
      box = {
        x: startX,
        y: startY,
        w: currentX - startX,
        h: currentY - startY
      };
    }

    if (box) {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 4;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      
      // Dim the rest of the image
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, canvas.width, box.y); // Top
      ctx.fillRect(0, box.y + box.h, canvas.width, canvas.height - (box.y + box.h)); // Bottom
      ctx.fillRect(0, box.y, box.x, box.h); // Left
      ctx.fillRect(box.x + box.w, box.y, canvas.width - (box.x + box.w), box.h); // Right
    }
  }

  async function scanSelection() {
    if (!selection) return;
    isProcessing = true;
    status = "Processing selection...";

    try {
      // 1. Crop image via a temporary canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = selection.w;
      tempCanvas.height = selection.h;
      const tCtx = tempCanvas.getContext('2d');
      
      // Draw ONLY the selected part
      tCtx.drawImage(
        imgObj, 
        selection.x, selection.y, selection.w, selection.h, // Source
        0, 0, selection.w, selection.h // Destination
      );
      
      // 2. Pre-process (Binarize for better OCR)
      const imageData = tCtx.getImageData(0, 0, selection.w, selection.h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const color = avg > 160 ? 255 : 0; // Threshold
        data[i] = data[i + 1] = data[i + 2] = color;
      }
      tCtx.putImageData(imageData, 0, 0);

      const cropUrl = tempCanvas.toDataURL();

      // 3. Initialize Worker if needed
      if (!worker) {
        status = "Loading AI model...";
        worker = await createWorker('deu');
      }

      // 4. Run OCR
      status = "Reading text...";
      const ret = await worker.recognize(cropUrl);
      
      resultText = ret.data.text.trim();
      confidence = ret.data.confidence;
      status = "✅ Found text!";
      
    } catch (err) {
      console.error(err);
      status = "❌ Error: " + err.message;
    } finally {
      isProcessing = false;
    }
  }
</script>

<div style="padding: 2rem; max-width: 1200px; margin: 0 auto; font-family: sans-serif;">
  <h1>🔪 Crop & Scan</h1>
  <p>Draw a box around a German speech bubble to translate it.</p>

  <input type="file" accept="image/*" on:change={handleFileSelect} bind:this={fileInput} style="margin-bottom: 10px;" />

  <div style="display: flex; gap: 20px; align-items: flex-start;">
    
    <!-- Left: Canvas Area -->
    <div style="flex: 2; border: 1px solid #ccc; overflow: auto; max-height: 80vh; position: relative;">
      <!-- Canvas needs to bind to variable 'canvas' -->
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
      <h3>Detected Text</h3>
      <p style="color: #666; font-size: 0.9em;">{status}</p>
      
      <div style="background: white; padding: 10px; border: 1px solid #ddd; min-height: 100px; margin-bottom: 20px; white-space: pre-wrap;">
        {resultText || "(No text selected)"}
      </div>

      {#if confidence > 0}
        <small>Confidence: {confidence}%</small>
      {/if}
    </div>

  </div>
</div>
