// Template: stack.sh copies it to STATE_DIR with __GAME_DIR__ / __STATE_DIR__ filled in, because Vite only
// rewrites __dirname in the repo config when that config is imported statically.
// Wraps GAME_DIR/play/vite.config.mts for the local safety-net stack. Only changes:
//  - the HMR client connects straight to this dev server (the repo config expects Traefik on port 80)
//  - the dependency pre-bundle cache goes to STATE_DIR instead of play/node_modules/.vite
import repoConfig from "__GAME_DIR__/play/vite.config.mts";

const GAME_DIR = "__GAME_DIR__";
const STATE_DIR = "__STATE_DIR__";
const PORT = 8080;

export default async (env: { mode: string; command: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolved: any = typeof repoConfig === "function" ? await (repoConfig as any)(env) : repoConfig;
    return {
        ...resolved,
        root: GAME_DIR + "/play",
        cacheDir: STATE_DIR + "/vite-cache-front",
        clearScreen: false,
        server: {
            ...resolved.server,
            host: "127.0.0.1",
            port: PORT,
            strictPort: true,
            hmr: { clientPort: PORT },
            fs: { ...(resolved.server?.fs ?? {}), allow: [GAME_DIR, STATE_DIR] },
        },
    };
};
