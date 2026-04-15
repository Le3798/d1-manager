import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { json } from "@sveltejs/kit";

// 1. Declare the client OUTSIDE the POST function so it can be reused
let b2Client = null;

export async function POST({ request, platform }) {
	try {
		const formData = await request.formData();
		const file = formData.get("file");
		const filename = formData.get("filename");
		const folderPath = formData.get("folderPath");
		const destination = formData.get("destination") || "r2";

		if (!file || !filename || !folderPath) {
			return json({ error: "Missing parameters" }, { status: 400 });
		}

		const fullPath = `${folderPath}/${filename}`;

		if (destination === "b2") {
			if (!platform?.env?.B2_KEY_ID || !platform?.env?.B2_APP_KEY) {
				return json({ error: "B2 Credentials not configured" }, { status: 500 });
			}

			// 2. Only initialize the client if it hasn't been created yet!
			if (!b2Client) {
				b2Client = new S3Client({
					endpoint: platform.env.B2_ENDPOINT,
					region: platform.env.B2_REGION,
					credentials: {
						accessKeyId: platform.env.B2_KEY_ID,
						secretAccessKey: platform.env.B2_APP_KEY,
					},
				});
			}

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
