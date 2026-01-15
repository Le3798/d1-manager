// src/routes/api/upload-r2/+server.js
import { json } from '@sveltejs/kit';

export async function POST({ request, platform }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const filename = formData.get('filename');
    const folderPath = formData.get('folderPath'); // New parameter

    if (!file || !filename || !folderPath) {
      return json({ error: 'Missing parameters' }, { status: 400 });
    }

    if (!platform?.env?.MY_BUCKET) {
      return json({ error: 'R2 Bucket not configured' }, { status: 500 });
    }

    // Combine path + filename directly
    // Example: "MAD/Love Trouble/Band 01" + "/" + "page_001_de.jpg"
    const fullPath = `${folderPath}/${filename}`;
    
    await platform.env.MY_BUCKET.put(fullPath, file);

    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}
