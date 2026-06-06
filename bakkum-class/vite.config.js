import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Built assets are served by the Cloudflare Worker (see wrangler.toml [assets]).
// During `vite dev` the worker is not running, so the app falls back to a
// localStorage-backed data layer (see src/api.ts).
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist",
        sourcemap: false,
    },
    server: {
        port: 5173,
    },
});
