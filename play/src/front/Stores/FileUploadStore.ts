import { writable } from "svelte/store";

export const draggingFile = writable(false);
/** Where a file dragged over the map in edit mode would land, in CSS pixels of the window. */
export const draggingFilePosition = writable<{ x: number; y: number } | undefined>(undefined);
