import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import Icons from "unplugin-icons/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";

const here = __dirname;
export default defineConfig({
    root: here,
    publicDir: resolve(here, "../public"),
    server: { port: 5199, fs: { allow: [resolve(here, "../..")] } },
    plugins: [
        {
            name: "stub-mind-deps",
            enforce: "pre",
            resolveId(source, importer) {
                if (!importer || !/\.svelte$/.test(importer)) return null;
                if (source.endsWith("services/BotApiService")) return resolve(here, "stubApi.ts");
                if (source.endsWith("admin-api/index")) return resolve(here, "stubOrbit.ts");
                return null;
            },
        },
        svelte({ preprocess: sveltePreprocess(), configFile: false }),
        Icons({ compiler: "svelte" }),
        tsconfigPaths({ root: resolve(here, "..") }),
    ],
});
