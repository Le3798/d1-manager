/// <reference types="@cloudflare/workers-types" />

declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            db: Record<string, D1Database>;
        }
        // interface PageData {}
        interface Platform {
            env: {
                SHOW_INTERNAL_TABLES?: string;
                OPENAI_API_KEY?: string;
                AI?: unknown;
                
                // Add your databases here so TS knows they are D1Databases
                Manga: D1Database;
                // (Add your other library DB name here too if you want)
                
            } & Record<string, D1Database | Fetcher | string>; // Updated to include D1Database
        }
    }
}
export {};


