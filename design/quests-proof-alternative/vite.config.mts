import { defineConfig } from "../../play/node_modules/vite/dist/node/index.js";
import {
  svelte,
  vitePreprocess,
} from "../../play/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
  resolve: {
    alias: {
      svelte: fileURLToPath(
        new URL("../../play/node_modules/svelte/src/runtime", import.meta.url)
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
