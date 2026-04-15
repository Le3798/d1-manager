// src/routes/api/upload-r2/+server.js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { json } from "@sveltejs/kit";

export async function POST({ request, platform }) {
	try {
		const formData = await request.formData();
		const file = formData.get("file");
		const filename = formData.get("filename");
		const folderPath = formData.get("folderPath");
		const destination = formData.get("destination") || "r2"; // Default to r2

		if (!file || !filename || !folderPath) {
			return json({ error: "Missing parameters" }, { status: 400 });
		}

		// Combine path + filename directly
		const fullPath = `${folderPath}/${filename}`;

		if (destination === "b2") {
			// --- BACKBLAZE B2 UPLOAD ---
			if (!platform?.env?.B2_KEY_ID || !platform?.env?.B2_APP_KEY) {
				return json({ error: "B2 Credentials not configured" }, { status: 500 });
			}

			// Initialize client here so it has access to platform.env
			const b2Client = new S3Client({
				endpoint: platform.env.B2_ENDPOINT, // e.g. "https://s3.us-west-004.backblazeb2.com"
				region: platform.env.B2_REGION, // e.g. "us-west-004"
				credentials: {
					accessKeyId: platform.env.B2_KEY_ID,
					secretAccessKey: platform.env.B2_APP_KEY,
				},
			});

			// Convert the File/Blob to a Uint8Array, which the AWS SDK needs in a Cloudflare Worker environment
			const arrayBuffer = await file.arrayBuffer();
			const buffer = new Uint8Array(arrayBuffer);

			await b2Client.send(
				new PutObjectCommand({
					Bucket: platform.env.B2_BUCKET_NAME,
					Key: fullPath,
					Body: buffer,
					ContentType: file.type || "application/octet-stream",
				}),
			);
		} else {
			// --- CLOUDFLARE R2 UPLOAD ---
			if (!platform?.env?.MY_BUCKET) {
				return json({ error: "R2 Bucket not configured" }, { status: 500 });
			}
			await platform.env.MY_BUCKET.put(fullPath, file);
		}

		return json({ success: true });
	} catch (err) {
		console.error("Upload error:", err);
		return json({ error: err.message }, { status: 500 });
	}
}
