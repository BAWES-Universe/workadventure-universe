import { gameSceneIsLoadedStore } from "../../Stores/GameSceneStore";
import type { GameScene } from "./GameScene";
import { gameManager } from "./GameManager";

/**
 * Runs `run` with the current map, now if there is one, or as soon as the next one has loaded (a reconnect or a map
 * change swaps it, and for a moment there is none). Asking for the map in that moment throws, and a throw inside a
 * store or a Svelte update stops the whole interface updating; waiting instead lets the picture or listener fill in
 * by itself once the map is back.
 *
 * Returns a function that stops waiting and undoes what `run` set up (its return value).
 */
export function whenGameScene(run: (scene: GameScene) => (() => void) | void): () => void {
    let cleanup: (() => void) | void;
    let stopWaiting: (() => void) | undefined;
    const scene = gameManager.tryGetCurrentGameScene();
    if (scene) {
        cleanup = run(scene);
    } else {
        let ran = false;
        stopWaiting = gameSceneIsLoadedStore.subscribe((loaded) => {
            if (ran || !loaded) return;
            const loadedScene = gameManager.tryGetCurrentGameScene();
            if (!loadedScene) return;
            ran = true;
            cleanup = run(loadedScene);
        });
    }
    return () => {
        stopWaiting?.();
        cleanup?.();
    };
}

/** The current map, now if there is one, or once the next one has loaded. */
export function waitForGameScene(): Promise<GameScene> {
    return new Promise((resolve) => {
        let resolved = false;
        let stop: (() => void) | undefined = undefined;
        stop = whenGameScene((scene) => {
            resolved = true;
            resolve(scene);
            stop?.();
        });
        if (resolved) stop();
    });
}
