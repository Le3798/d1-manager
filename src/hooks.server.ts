import { extend } from "$lib/log";
import { DBMS } from "$lib/server/db/dbms";
import type { Handle, HandleServerError } from "@sveltejs/kit";
import { locale, waitLocale } from "svelte-i18n";

export const handle: Handle = async ({ event, resolve }) => {
	const lang = event.request.headers.get("accept-language")?.split(",")[0] || "en";
	locale.set(lang);
	await waitLocale(lang);

	const env = event.platform?.env || {};

// 1. Let the auto-discovery try its best
const detectedDBs = DBMS(env);

// 2. Manually inject your new DB to guarantee it shows up
// The key "Manga DB" is what will appear in your dropdown menu.
if (env.Manga) {
    detectedDBs["Manga Library"] = env.Manga;
}

// 3. Assign to locals
event.locals.db = detectedDBs;

	const result = await resolve(event);
	return result;
};

const elog = extend("server-error");
elog.enabled = true;

export const handleError: HandleServerError = async ({ error }) => {
	elog(error);

	if (error instanceof Error && error.message.startsWith("D1_")) {
		return {
			code: 400,
			message: error.message,
		};
	}

	return {
		code: 500,
		message: "Internal Server Error",
	};
};
