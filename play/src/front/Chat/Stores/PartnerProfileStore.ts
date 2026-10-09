import { writable } from "svelte/store";

/** The direct chat whose profile panel is open over the conversation, if any. */
export const openProfileRoomIdStore = writable<string | undefined>(undefined);
