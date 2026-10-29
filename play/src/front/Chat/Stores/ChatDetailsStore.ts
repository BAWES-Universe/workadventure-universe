import { writable } from "svelte/store";

export type SharedTab = "media" | "links" | "files";

export const SHARED_TABS: readonly SharedTab[] = ["media", "links", "files"];

/** The group whose details are open over the conversation, if any (a direct chat shows its Profile instead). */
export const openRoomDetailsIdStore = writable<string | undefined>(undefined);

/** The chat whose "Media, links and files" page is open over its details, and the tab it shows. */
export const openSharedItemsStore = writable<{ roomId: string; tab: SharedTab } | undefined>(undefined);

/** The chat whose "Artifacts" page is open over its details or profile (game #1474). */
export const openArtifactsListStore = writable<string | undefined>(undefined);
