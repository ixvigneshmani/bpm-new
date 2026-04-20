import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Override via env var when the default :3001 is taken by
        // another worktree's API. Defaults to the standard dev port.
        target: process.env.VITE_API_PROXY ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
