import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // The block editor and Excalidraw are large by nature; both are loaded lazily.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, ws: true },
      "/uploads": api,
      "/excalidraw-assets": api,
      "/pyodide": api,
      "/pdfjs": api,
    },
  },
});
