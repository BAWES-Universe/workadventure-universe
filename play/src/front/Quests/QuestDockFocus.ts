import type { QuestSurface } from "./QuestModel";
import { dispatchQuest } from "./QuestStore";

/**
 * Where keyboard focus goes as quest surfaces open and close. A surface opened from the keyboard takes focus on its
 * close button; one opened with a tap or a click takes none (walking stays as it was). Closing gives focus back to
 * the control that opened it.
 */
let pendingFocus: QuestSurface | null = null;
let logOpener: HTMLElement | null = null;

/** The next time `surface` renders, focus its close button. */
export function requestQuestFocus(surface: QuestSurface): void {
    pendingFocus = surface;
}

/** True once if `surface` should take focus now. */
export function takeQuestFocus(surface: QuestSurface): boolean {
    if (pendingFocus !== surface) return false;
    pendingFocus = null;
    return true;
}

/** Opens the log; `opener` gets focus back when it closes (the profile menu's trigger, or the pill). */
export function openQuestLog(opener: HTMLElement | null, keyboard: boolean): void {
    logOpener = opener;
    if (keyboard) requestQuestFocus("log");
    dispatchQuest({ type: "open-log" });
}

export function takeQuestLogOpener(): HTMLElement | null {
    const opener = logOpener;
    logOpener = null;
    return opener;
}

/** The profile menu's trigger: where focus goes when the surface holding it disappears. */
export function profileMenuTrigger(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="action-user"] button');
}
