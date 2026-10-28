import { get, writable } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHistory, type ChatHistory } from "../ChatHistory";

/** A tab's history, small enough to see through. Moving through it is asynchronous, with a popstate, like a browser. */
function makeWindow() {
    const target = new EventTarget();
    const entries: unknown[] = ["room"];
    let index = 0;
    function traverse(delta: number) {
        const next = index + delta;
        if (next < 0 || next >= entries.length) return;
        setTimeout(() => {
            index = next;
            target.dispatchEvent(Object.assign(new Event("popstate"), { state: entries[index] }));
        }, 0);
    }
    const history = {
        get state() {
            return entries[index];
        },
        pushState: vi.fn((state: unknown) => {
            entries.splice(index + 1);
            entries.push(state);
            index = entries.length - 1;
        }),
        go: vi.fn((delta: number) => traverse(delta)),
        back: vi.fn(() => traverse(-1)),
    };
    const win = {
        history,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
    } as unknown as Window;
    return {
        win,
        history,
        entries,
        get index() {
            return index;
        },
        /** The user presses Back. */
        pressBack: () => traverse(-1),
        /** The user presses Forward. */
        pressForward: () => traverse(1),
    };
}

const settle = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 5);
    });

let chatHistory: ChatHistory | undefined;
afterEach(() => chatHistory?.destroy());

function setup() {
    const tab = makeWindow();
    const depth = writable(0);
    const orbitHolds = writable(false);
    const closeLevel = vi.fn(() => depth.update((value) => Math.max(0, value - 1)));
    let n = 0;
    chatHistory = createChatHistory(depth, closeLevel, tab.win, () => `step-${++n}`, orbitHolds);
    return { tab, depth, closeLevel, orbitHolds };
}

describe("chat history", () => {
    it("adds one step per open level", async () => {
        const { tab, depth } = setup();
        depth.set(1);
        await settle();
        depth.set(3);
        await settle();
        expect(tab.entries).toHaveLength(4);
        expect(tab.history.state).toEqual({ universeChat: true, chatStep: "step-3" });
    });

    it("Back closes one level, then the next, then lands on all chats", async () => {
        const { tab, depth, closeLevel } = setup();
        depth.set(2);
        await settle();
        tab.pressBack();
        await settle();
        expect(closeLevel).toHaveBeenCalledTimes(1);
        expect(get(depth)).toBe(1);
        tab.pressBack();
        await settle();
        expect(closeLevel).toHaveBeenCalledTimes(2);
        expect(get(depth)).toBe(0);
        expect(tab.index).toBe(0);
        // Nothing was added back while closing.
        expect(tab.history.pushState).toHaveBeenCalledTimes(2);
    });

    it("closing in the chat walks back over the steps", async () => {
        const { tab, depth, closeLevel } = setup();
        depth.set(3);
        await settle();
        depth.set(1);
        await settle();
        expect(tab.history.go).toHaveBeenCalledWith(-2);
        expect(tab.index).toBe(1);
        expect(closeLevel).not.toHaveBeenCalled();
        depth.set(0);
        await settle();
        expect(tab.index).toBe(0);
    });

    it("one chat to another keeps its single step", async () => {
        const { tab, depth } = setup();
        depth.set(1);
        await settle();
        // The old timeline goes and the new one comes in the same update.
        depth.set(0);
        depth.set(1);
        await settle();
        expect(tab.history.pushState).toHaveBeenCalledTimes(1);
        expect(tab.history.go).not.toHaveBeenCalled();
    });

    it("opening right after closing waits for the walk back", async () => {
        const { tab, depth } = setup();
        depth.set(2);
        await settle();
        depth.set(0);
        await Promise.resolve();
        await Promise.resolve();
        depth.set(1);
        await settle();
        await settle();
        expect(tab.index).toBe(1);
        expect(tab.entries).toHaveLength(2);
    });

    it("leaves Orbit's entry on top alone, and steps over what it left behind", async () => {
        const { tab, depth, closeLevel } = setup();
        depth.set(1);
        await settle();
        tab.history.pushState({ orbit: true, orbitVisit: "o" });
        // The chat closes under Orbit (a room change): Orbit's entry is not walked back.
        depth.set(0);
        await settle();
        expect(tab.history.go).not.toHaveBeenCalled();
        // Back out of Orbit lands on the old step, which is stepped over to the room.
        tab.pressBack();
        await settle();
        await settle();
        expect(tab.index).toBe(0);
        expect(closeLevel).not.toHaveBeenCalled();
    });

    it("Back on Orbit's entry is Orbit's", async () => {
        const { tab, depth, closeLevel } = setup();
        depth.set(1);
        await settle();
        tab.history.pushState({ orbit: true, orbitVisit: "o" });
        tab.history.pushState({ orbit: true, orbitVisit: "o", page: 2 });
        tab.pressBack();
        await settle();
        expect(closeLevel).not.toHaveBeenCalled();
        expect(get(depth)).toBe(1);
    });

    it("adds no steps while Orbit holds the history, and adds them once it lets go", async () => {
        const { tab, depth, orbitHolds } = setup();
        orbitHolds.set(true);
        tab.history.pushState({ orbit: true, orbitVisit: "o" });
        // Message from Orbit: the chat opens while Orbit's step is still being walked back.
        depth.set(1);
        await settle();
        expect(tab.history.pushState).toHaveBeenCalledTimes(1);
        tab.pressBack();
        await settle();
        orbitHolds.set(false);
        await settle();
        expect(tab.history.state).toEqual({ universeChat: true, chatStep: "step-1" });
        expect(tab.entries).toEqual(["room", { universeChat: true, chatStep: "step-1" }]);
    });

    it("a level opened over a step Orbit left behind closes on Back onto it", async () => {
        const { tab, depth, closeLevel } = setup();
        tab.history.pushState({ orbit: true, orbitVisit: "left-behind" });
        depth.set(2);
        await settle();
        tab.pressBack();
        await settle();
        expect(closeLevel).toHaveBeenCalledTimes(1);
        tab.pressBack();
        await settle();
        expect(closeLevel).toHaveBeenCalledTimes(2);
        expect(get(depth)).toBe(0);
    });

    it("Forward onto a closed level leaves it closed and goes back to where the chat is", async () => {
        const { tab, depth, closeLevel } = setup();
        depth.set(2);
        await settle();
        tab.pressBack();
        await settle();
        expect(get(depth)).toBe(1);
        tab.pressForward();
        await settle();
        await settle();
        expect(get(depth)).toBe(1);
        expect(tab.index).toBe(1);
        expect(closeLevel).toHaveBeenCalledTimes(1);
        // The next Back closes the chat at once.
        tab.pressBack();
        await settle();
        expect(get(depth)).toBe(0);
    });

    it("Back onto a step from before a reload closes the chat and walks past it", async () => {
        const { tab, depth, closeLevel } = setup();
        tab.history.pushState({ universeChat: true, chatStep: "before-reload" });
        depth.set(1);
        await settle();
        tab.pressBack();
        await settle();
        await settle();
        expect(closeLevel).toHaveBeenCalledTimes(1);
        expect(get(depth)).toBe(0);
        expect(tab.index).toBe(0);
    });
});
