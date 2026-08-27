import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plugin order matters: tailwind and path resolution first, then the router
// plugin (owns file-based route codegen), then viteReact last so it
// transforms everything the plugins above generate.
export default defineConfig({
  css: {
    // lightningcss handles the oklch() colour tokens in styles.css
    transformer: "lightningcss",
  },
  resolve: {
    // Vite 8 resolves the "@/*" paths mapping from tsconfig.json natively,
    // which replaces the vite-tsconfig-paths plugin.
    tsconfigPaths: true,
    // A second copy of React or the query client breaks hooks and the cache.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [tailwindcss(), tanstackRouter({ target: "react" }), viteReact()],
});
