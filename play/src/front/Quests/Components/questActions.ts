import type { ActionReturn } from "svelte/action";
import { gameManager } from "../../Phaser/Game/GameManager";
import { popupJustClosed } from "../../Phaser/Game/Say/SayManager";
import { questInputFocusStore } from "../QuestInputFocusStore";

/**
 * Escape on this surface (focus inside it) runs `handler`. Bound to the surface itself, never to the window, and the
 * event goes on as usual: nothing else loses its Escape.
 */
export function escapeKey(node: HTMLElement, handler: () => void): ActionReturn<() => void> {
    let current = handler;
    const onKeydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") current();
    };
    node.addEventListener("keydown", onKeydown);
    return {
        update(next) {
            current = next;
        },
        destroy() {
            node.removeEventListener("keydown", onKeydown);
        },
    };
}

let focusedSurfaces = 0;
/** Keys that just pressed a quest control and have not come back up yet. */
let heldKeys = 0;

function syncInputFocus(): void {
    questInputFocusStore.set(focusedSurfaces > 0 || heldKeys > 0);
}

/** Focus that came from the keyboard (or was moved there after a key), not from a click or a tap. */
function isKeyboardFocus(target: EventTarget | null): boolean {
    try {
        return target instanceof Element && target.matches(":focus-visible");
    } catch {
        return false;
    }
}

/**
 * While keyboard focus is inside this surface, the game stops reading movement keys (arrows and letters act on the
 * panel) and anything held is released. Walking comes back when focus leaves. A click or a tap on a button focuses
 * it too, but leaves walking alone: only keyboard focus counts.
 */
export function questKeyboardFocus(node: HTMLElement): ActionReturn {
    let inside = false;
    const enter = () => {
        if (inside) return;
        inside = true;
        focusedSurfaces += 1;
        gameManager.tryGetCurrentGameScene()?.userInputManager?.clearHeldMovement();
        syncInputFocus();
    };
    const leave = () => {
        if (!inside) return;
        inside = false;
        focusedSurfaces = Math.max(0, focusedSurfaces - 1);
        syncInputFocus();
    };
    const onFocusIn = (event: FocusEvent) => {
        if (isKeyboardFocus(event.target)) enter();
    };
    const onFocusOut = (event: FocusEvent) => {
        if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
        leave();
    };
    node.addEventListener("focusin", onFocusIn);
    node.addEventListener("focusout", onFocusOut);
    return {
        destroy() {
            node.removeEventListener("focusin", onFocusIn);
            node.removeEventListener("focusout", onFocusOut);
            leave();
        },
    };
}

/** How long a key that pressed a quest control keeps the game from reading it, if its keyup never reaches us. */
export const KEY_HOLD_MS = 600;
/** After the keyup: a few of Phaser's frames. */
const KEY_RELEASE_MS = 100;

/**
 * Keeps quest controls from getting in the game's way (on every surface root):
 * - A click or a tap leaves no focus behind, so the next Space (interact) and Enter (say) go to the game, as they
 *   did before the click. Keyboard activation (detail 0) keeps focus where it is.
 * - Enter or Space that presses a quest control is that control's, not the game's: Express does not open on its
 *   keyup and nothing nearby is activated, even when the press closed the surface (focus is gone by keyup).
 */
export function questControls(node: HTMLElement): ActionReturn {
    const controlOf = (target: EventTarget | null): HTMLElement | null => {
        const control = target instanceof Element ? target.closest<HTMLElement>("button, [role='button']") : null;
        return control && node.contains(control) ? control : null;
    };

    const onClick = (event: MouseEvent) => {
        if (event.detail === 0) return;
        const control = controlOf(event.target);
        if (control && document.activeElement === control) control.blur();
    };

    let holding: string | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = undefined;
        if (holding === undefined) return;
        holding = undefined;
        heldKeys = Math.max(0, heldKeys - 1);
        syncInputFocus();
    };
    const onKeydown = (event: KeyboardEvent) => {
        if ((event.key !== "Enter" && event.key !== " ") || event.repeat || !controlOf(event.target)) return;
        if (event.key === "Enter") popupJustClosed();
        if (holding === undefined) {
            heldKeys += 1;
            syncInputFocus();
        }
        holding = event.key;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(release, KEY_HOLD_MS);
    };
    // Phaser reads its queued key events on its next frame: let go only once that frame has seen this keyup.
    const onKeyup = (event: KeyboardEvent) => {
        if (event.key !== holding) return;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(release, KEY_RELEASE_MS);
    };

    node.addEventListener("click", onClick);
    node.addEventListener("keydown", onKeydown);
    node.addEventListener("keyup", onKeyup);
    return {
        destroy() {
            node.removeEventListener("click", onClick);
            node.removeEventListener("keydown", onKeydown);
            node.removeEventListener("keyup", onKeyup);
            // A key that closed this surface is still down: its keyup lands elsewhere, the timer lets it go.
        },
    };
}
