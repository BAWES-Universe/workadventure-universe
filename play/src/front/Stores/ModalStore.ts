import { writable } from "svelte/store";
import type { ModalEvent } from "../Api/Events/ModalEvent";

export const showLimitRoomModalStore = writable(false);

export const modalIframeStore = writable<ModalEvent | null>(null);
export const modalIframeWindowStore = writable<Window | null>(null);
export const modalVisibilityStore = writable(false);
/** Whether the modal fills the window (its full-screen view) rather than its usual place. Reset when it closes. */
export const modalFullScreenStore = writable(false);

export const roomListVisibilityStore = writable<boolean>(false);
