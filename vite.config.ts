import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  // Relative asset paths: the UI is served at "/" in development and under
  // Home Assistant's Ingress prefix (/api/hassio_ingress/<token>/) in the app.
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:8099" } },
});
