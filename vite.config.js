import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    // In development the API runs separately; proxy keeps everything same-origin.
    proxy: {
      "/api": "http://localhost:3001",
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
  test: { root: ".", include: ["test/**/*.test.js"], environment: "node", env: { SCRYPT_COST: "1024" } },
});
