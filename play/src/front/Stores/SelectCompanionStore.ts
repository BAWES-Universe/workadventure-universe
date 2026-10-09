import { writable } from "svelte/store";
import type { CompanionTextureCollection } from "@workadventure/messages";

export const selectCompanionSceneVisibleStore = writable(false);

/**
 * The room's companion catalog for the companion screen, undefined while it loads. The screen opens before the
 * catalog arrives, so it waits on this instead of reading the scene once.
 */
export const companionCollectionsStore = writable<CompanionTextureCollection[] | undefined>(undefined);
