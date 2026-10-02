import { writable } from "svelte/store";
import type { ModalEvent } from "../Api/Events/ModalEvent";

export const showLimitRoomModalStore = writable(false);

export const modalIframeStore = writable<ModalEvent | null>(null);
export const modalIframeWindowStore = writable<Window | null>(null);
export const modalVisibilityStore = writable(false);
/** Whether the modal fills the window (its full-screen view) rather than its usual place. Reset when it closes. */
export const modalFullScreenStore = writable(false);
/** How wide the open side window is on screen (0 when none is open): what sits beside it moves over by as much. */
export const modalPanelWidthStore = writable(0);

export const showModalGlobalComminucationVisibilityStore = writable(false);

export const roomListVisibilityStore = writable<boolean>(false);
