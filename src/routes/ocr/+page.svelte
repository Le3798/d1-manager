<script>
  import { createWorker } from 'tesseract.js';
  import { onDestroy } from 'svelte';

  let fileInput;
  let imagePreview = null;
  let status = "Ready";
  let progress = 0;
  let resultText = "";
  let confidence = 0;
  let isProcessing = false;
  let worker = null;

  // Cleanup worker when page closes to save memory
  onDestroy(async () => {
    if (worker) {
      await worker.terminate();
    }
  });

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      // Create a fake URL to preview the image immediately
      imagePreview = URL.createObjectURL(file);
      resultText = "";
      confidence = 0;
      progress = 0;
      status = "Image loaded. Click 'Scan' to start.";
    }
  }

  async function startOCR() {
    if (!imagePreview) return;

    isProcessing = true;
    resultText = "";
    
    try {
      // 1. Create the worker
      // We use 'deu' (German) as the language. You can change to 'eng' or 'jpn'.
      worker = await createWorker('deu', 1, {
        logger: m => {
          // Update progress bar
          if (m.status === 'recognizing text') {
            progress = Math.round(m.progress * 100);
            status = `Scanning... ${progress}%`;
          } else {
            status = m.status;
          }
        }
      });

      // 2. Recognize text
      const ret = await worker.recognize(imagePreview);
      
      // 3. Get results
      resultText = ret.data.text;
      confidence = ret.data.confidence;
      status = "✅ Done!";
      
    } catch (err) {
      console.error(err);
      status = "❌ Error: " + err.message;
    } finally {
      isProcessing = false;
      // We keep the worker alive for speed, or terminate it here if you want to save RAM
      // await worker.terminate(); 
    }
  }
</script>

<div style="padding: 2rem; max-width: 800px; margin: 0 auto; font-family: sans-serif;">
  <h1>🕵️‍♂️ Manga OCR Test</h1>
  <p>Upload a German manga page to test Tesseract.js</p>

  <!-- File Input -->
  <div style="margin-bottom: 20px; border: 2px dashed #ccc; padding: 20px; border-radius: 8px;">
    <input 
      type="file" 
      accept="image/*" 
      on:change={handleFileSelect} 
      bind:this={fileInput}
    />
  </div>

  <div style="display: flex; gap: 20px; flex-wrap: wrap;">
    
    <!-- Left Column: Image -->
    <div style="flex: 1; min-width: 300px;">
      {#if imagePreview}
        <img 
          src={imagePreview} 
          alt="Preview" 
          style="width: 100%; border-radius: 8px; border: 1px solid #ddd;"
        />
        
        <button 
          on:click={startOCR} 
          disabled={isProcessing}
          style="
            margin-top: 10px; 
            width: 100%; 
            padding: 10px; 
            background: {isProcessing ? '#ccc' : '#007bff'}; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
            font-size: 16px;"
        >
          {isProcessing ? '⏳ Scanning...' : '🔍 Scan Text'}
        </button>
      {/if}
    </div>

    <!-- Right Column: Results -->
    <div style="flex: 1; min-width: 300px;">
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; height: 100%;">
        <h3>Results</h3>
        <p><strong>Status:</strong> {status}</p>
        
        {#if progress > 0 && progress < 100}
          <div style="width: 100%; background: #ddd; height: 10px; border-radius: 5px; margin-bottom: 10px;">
            <div style="width: {progress}%; background: #28a745; height: 100%; border-radius: 5px; transition: width 0.2s;"></div>
          </div>
        {/if}

        {#if confidence > 0}
           <p><strong>Confidence:</strong> {confidence}%</p>
        {/if}

        <textarea 
          value={resultText} 
          readonly
          style="width: 100%; height: 300px; padding: 10px; border-color: #ddd;"
          placeholder="Extracted text will appear here..."
        ></textarea>
      </div>
    </div>

  </div>
</div>
