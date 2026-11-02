import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { APPS } from "./src/apps";

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// One page for the menu, plus one page per app, so each app runs on its own
// page with only its own styles loaded (the apps were made as separate windows).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1425,
    strictPort: true,
    // Lets a phone reach the dev server during `tauri android dev`.
    host: process.env.TAURI_DEV_HOST || false,
    fs: { allow: [here("../..")] },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    rollupOptions: {
      input: Object.fromEntries([["index", here("index.html")], ...APPS.map((a) => [a.id, here(`${a.id}.html`)])]),
    },
  },
});
