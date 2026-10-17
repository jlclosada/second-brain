import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// En desarrollo, /api se redirige al backend (uvicorn en el puerto 8000).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, proxy: { "/api": "http://localhost:8000" } },
});
