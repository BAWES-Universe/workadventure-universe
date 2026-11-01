import { writable } from "svelte/store";
import type { BannerEvent } from "./../Api/Events/Ui/BannerEvent";

export const userMovingStore = writable(false);

// This store is used to determine whether the user is currently in the personal area or has left before loading the business card.
export const canRequestVisitCardsStore = writable(false);
export const requestVisitCardsStore = writable<string | null>(null);

// The "admin" tag (what the admin chip and the upgrade warning follow)
export const userIsAdminStore = writable(false);
// Each of these follows one of the player's permissions
export const userIsEditorStore = writable(false); // Edit maps
export const userCanModerateCallsStore = writable(false); // Moderate calls
export const userCanSendMessagesStore = writable(false); // Send messages and voice notes

export const limitMapStore = writable(false);

export const bannerStore = writable<BannerEvent | null>(null);

export const selectedChatIDRemotePlayerStore = writable<string | null>(null);
