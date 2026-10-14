import { writable } from "svelte/store";

export const loaderVisibleStore = writable(false);

/**
 * How far the one loading screen's bar is (#981), from 0 to 1. One wait, one bar: the page creeps on its own before
 * any script runs, a scene's files move it from LOADING_STARTED on to LOADING_FILES_DONE, and each step of joining the
 * room moves it on to LOADING_JOINED. The game being up takes it to the end (BootSplash.ts). Within one load it only
 * goes forward.
 */
export const loadingProgressStore = writable(0);

export const LOADING_STARTED = 0.12;
export const LOADING_FILES_DONE = 0.75;
export const LOADING_JOINED = 0.97;

/** What the game waits for after the files, before it shows the room (GameScene). */
export type LoadingJoinStep = "connection" | "scripts" | "woka" | "map" | "chat";
const JOIN_STEPS = 5;

let joinStepsDone = new Set<LoadingJoinStep>();

function moveForward(to: number): void {
    loadingProgressStore.update((progress) => Math.max(progress, Math.min(1, to)));
}

/** A scene starts loading its files: a new load, from where the page's own creep stops. */
export function startLoading(): void {
    joinStepsDone = new Set();
    loadingProgressStore.set(LOADING_STARTED);
}

/** The scene's files, from 0 to 1. */
export function reportFilesProgress(files: number): void {
    moveForward(LOADING_STARTED + (LOADING_FILES_DONE - LOADING_STARTED) * files);
}

/** One step of joining the room is done. Each counts once, in any order. */
export function reportJoinStep(step: LoadingJoinStep): void {
    joinStepsDone.add(step);
    moveForward(LOADING_FILES_DONE + ((LOADING_JOINED - LOADING_FILES_DONE) * joinStepsDone.size) / JOIN_STEPS);
}
