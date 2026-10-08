// Template: stack.sh copies it to STATE_DIR with __GAME_DIR__ / __STATE_DIR__ filled in.
// Wraps GAME_DIR/play/iframe-api.vite.config.mts: same build, output in STATE_DIR (served by gateway.mjs).
import repoConfig from "__GAME_DIR__/play/iframe-api.vite.config.mts";

export default {
    ...repoConfig,
    root: "__GAME_DIR__/play",
    cacheDir: "__STATE_DIR__/vite-cache-iframe-api",
    clearScreen: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: { ...(repoConfig as any).build, outDir: "__STATE_DIR__/iframe-api", emptyOutDir: false },
};
