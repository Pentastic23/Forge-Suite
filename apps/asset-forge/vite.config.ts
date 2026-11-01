import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port in dev and the built files in ./dist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1423, strictPort: true },
  build: { target: "es2021", outDir: "dist" },
});
