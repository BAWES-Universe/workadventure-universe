import { get, readable } from "svelte/store";
import type { Readable } from "svelte/store";

/**
 * Each open chat level is one step in the tab's history, so Back (Android's button or gesture, the browser's) goes
 * back one level, as it does out of Orbit (#1553). Not on an iPhone or iPad: there, a step to go back to hands the
 * screen's left edge to Safari, which slides the whole page, game included; the chat's own swipe goes back instead.
 *
 * Closing a level any other way (the ‹ arrow, the swipe, a room change) walks back over its step. A step left behind
 * (Orbit was open over it when the chat closed, or the page reloaded) is stepped over, never reopened. While Orbit
 * holds the top of the history (open, or its steps still being walked back), the chat adds no steps; they follow
 * once Orbit lets go.
 */

interface ChatStepState {
    universeChat: true;
    chatStep: string;
}

function isChatStepState(state: unknown): state is ChatStepState {
    return (
        !!state &&
        typeof state === "object" &&
        (state as { universeChat?: unknown }).universeChat === true &&
        typeof (state as { chatStep?: unknown }).chatStep === "string"
    );
}

function isOrbitState(state: unknown): boolean {
    return !!state && typeof state === "object" && (state as { orbit?: unknown }).orbit === true;
}

/** How long to wait for the Back this module asked for before carrying on without it. */
const OWN_TRAVERSAL_TIMEOUT_MS = 1000;

export interface ChatHistory {
    destroy(): void;
}

export function createChatHistory(
    depthStore: Readable<number>,
    closeLevel: () => void,
    win: Window = window,
    newId: () => string = () => crypto.randomUUID(),
    orbitHolds: Readable<boolean> = readable(false)
): ChatHistory {
    const history = win.history;
    // Our steps, oldest first: one per open level.
    const steps: string[] = [];
    // Our steps that Back walked past, lowest first: Forward can land on them again.
    let ahead: string[] = [];
    // Where our steps start being above a step Orbit left behind (added once Orbit had let go), if they do.
    let firstAboveOrbit: number | undefined;
    let waitingForOwnTraversal = false;
    let traversalTimer: ReturnType<typeof setTimeout> | undefined;
    let syncQueued = false;

    function queueSync() {
        if (syncQueued) return;
        syncQueued = true;
        // A level closing and the next opening (one chat to another) settle before the history follows.
        queueMicrotask(() => {
            syncQueued = false;
            sync();
        });
    }

    function sync() {
        if (waitingForOwnTraversal || get(orbitHolds)) return;
        const depth = get(depthStore);
        if (depth > steps.length) {
            try {
                while (steps.length < depth) {
                    if (firstAboveOrbit === undefined && isOrbitState(history.state)) firstAboveOrbit = steps.length;
                    const id = newId();
                    history.pushState({ universeChat: true, chatStep: id } satisfies ChatStepState, "");
                    steps.push(id);
                    // A new step drops everything Forward could reach.
                    ahead = [];
                }
            } catch (error) {
                console.warn("Could not add the chat to the history", error);
            }
        } else if (depth < steps.length) {
            const top = steps[steps.length - 1];
            const extra = steps.length - depth;
            const passed = steps.splice(depth);
            if (firstAboveOrbit !== undefined && firstAboveOrbit >= depth) firstAboveOrbit = undefined;
            // Something else is on top (Orbit): leave the steps, they are stepped over later.
            if (!isChatStepState(history.state) || history.state.chatStep !== top) return;
            ahead = [...passed, ...ahead];
            waitingForOwnTraversal = true;
            traversalTimer = setTimeout(endOwnTraversal, OWN_TRAVERSAL_TIMEOUT_MS);
            history.go(-extra);
        }
    }

    function endOwnTraversal() {
        waitingForOwnTraversal = false;
        if (traversalTimer !== undefined) clearTimeout(traversalTimer);
        traversalTimer = undefined;
        queueSync();
    }

    function onPopState(event: PopStateEvent) {
        if (waitingForOwnTraversal) {
            endOwnTraversal();
            return;
        }
        const state: unknown = event.state;
        let index = isChatStepState(state) ? steps.indexOf(state.chatStep) : -1;
        if (isOrbitState(state)) {
            // Orbit's steps are Orbit's, unless one it left behind is under ours: Back onto it leaves those levels.
            if (get(orbitHolds) || firstAboveOrbit === undefined) return;
            index = firstAboveOrbit - 1;
        }
        if (isChatStepState(state) && index === -1) {
            const forward = ahead.indexOf(state.chatStep);
            if (forward !== -1) {
                // Forward onto a level already closed: it stays closed, and the history goes back to where the chat is.
                waitingForOwnTraversal = true;
                traversalTimer = setTimeout(endOwnTraversal, OWN_TRAVERSAL_TIMEOUT_MS);
                history.go(-(forward + 1));
                return;
            }
            // A step from before (the page reloaded), under ours: those levels close, and it is walked past.
            const toClose = steps.length;
            ahead = [];
            steps.length = 0;
            firstAboveOrbit = undefined;
            for (let i = 0; i < toClose; i++) closeLevel();
            history.back();
            return;
        }
        // Back onto one of our steps keeps the levels up to it; onto anything else, all chats.
        const keep = index + 1;
        if (keep >= steps.length) return;
        const toClose = steps.length - keep;
        ahead = [...steps.splice(keep), ...ahead];
        if (firstAboveOrbit !== undefined && firstAboveOrbit >= keep) firstAboveOrbit = undefined;
        for (let i = 0; i < toClose; i++) closeLevel();
    }

    const unsubscribe = depthStore.subscribe(() => queueSync());
    const unsubscribeOrbit = orbitHolds.subscribe(() => queueSync());
    win.addEventListener("popstate", onPopState);

    return {
        destroy() {
            unsubscribe();
            unsubscribeOrbit();
            win.removeEventListener("popstate", onPopState);
            if (traversalTimer !== undefined) clearTimeout(traversalTimer);
        },
    };
}

let installed: ChatHistory | undefined;

/** Once per page, from the chat. Does nothing on an iPhone or iPad (see above). */
export function installChatHistory(
    isAppleTouch: boolean,
    depthStore: Readable<number>,
    closeLevel: () => void,
    orbitHolds: Readable<boolean>
): void {
    if (installed || isAppleTouch) return;
    installed = createChatHistory(depthStore, closeLevel, window, () => crypto.randomUUID(), orbitHolds);
}
