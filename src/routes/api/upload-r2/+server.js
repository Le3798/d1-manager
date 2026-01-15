// src/routes/api/upload-r2/+server.js
import { json } from '@sveltejs/kit';

export async function POST({ request, platform }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const filename = formData.get('filename');
    const folderName = formData.get('folder');

    if (!file || !filename || !folderName) {
      return json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Check if R2 is bound
    if (!platform?.env?.MY_BUCKET) {
      // If developing locally, this might be missing.
      // But on Cloudflare Pages, it will work if you configured the binding.
      return json({ error: 'R2 Bucket not configured in Cloudflare Pages settings' }, { status: 500 });
    }

    const fullPath = `MAD/One Piece/${folderName}/${filename}`;
    
    await platform.env.MY_BUCKET.put(fullPath, file);

    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}
