import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import Icons from "unplugin-icons/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";

const here = __dirname;
const stubs: Array<[RegExp, string]> = [
    [/\/services\/BotApiService$/, resolve(here, "stubs/api.ts")],
    [/\/admin-api\/index$/, resolve(here, "stubs/adminApi.ts")],
    [/\/Phaser\/Game\/GameManager$/, resolve(here, "stubs/gameManager.ts")],
    [/\/Connection\/LocalUserStore$/, resolve(here, "stubs/localUserStore.ts")],
];

export default defineConfig({
    root: here,
    publicDir: resolve(here, "../public"),
    server: { port: 5198, fs: { allow: [resolve(here, "../..")] } },
    plugins: [
        {
            name: "render-stubs",
            enforce: "pre",
            resolveId(id, importer) {
                if (importer && importer.includes("/.mock-botpage/")) return null;
                for (const [re, path] of stubs) if (re.test(id)) return path;
                return null;
            },
        },
        nodePolyfills({ include: ["events", "buffer"], globals: { Buffer: true } }),
        svelte({ preprocess: sveltePreprocess(), configFile: false, onwarn: () => {} }),
        Icons({ compiler: "svelte" }),
        tsconfigPaths({ root: resolve(here, "..") }),
    ],
    optimizeDeps: { esbuildOptions: { define: { global: "globalThis" } } },
});
