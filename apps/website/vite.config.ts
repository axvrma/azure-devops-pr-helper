import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { seoPlugin } from "./scripts/seo.ts";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), seoPlugin(env.VITE_SITE_URL || env.URL)],
    build: { target: "es2022", chunkSizeWarningLimit: 400 },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
