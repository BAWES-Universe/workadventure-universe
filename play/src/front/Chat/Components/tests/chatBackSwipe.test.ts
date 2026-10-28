import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../Connection/Matrix/MatrixSecurity", () => ({ matrixSecurity: {} }));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ ENABLE_CHAT: true }));

import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { selectedRoomStore } from "../../Stores/SelectRoomStore";
import { openRoomDetailsIdStore } from "../../Stores/ChatDetailsStore";
import type { ChatRoom } from "../../Connection/ChatConnection";
import { chatBackPeekStore, leaveChat } from "../../ChatBack";
import { chatBackSwipe } from "../chatBackSwipe";

const room = { id: "!room", isEncrypted: { subscribe: (run: (value: boolean) => void) => (run(false), () => {}) } };
const WIDTH = 300;

function touchEvent(type: string, x: number, y: number) {
    const touch = { identifier: 1, clientX: x, clientY: y };
    return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        touches: type === "touchend" ? [] : [touch],
        changedTouches: [touch],
    });
}

function makeChat(layers: string[]) {
    const node = document.createElement("div");
    node.getBoundingClientRect = () =>
        ({ left: 0, right: WIDTH, top: 0, bottom: 600, width: WIDTH, height: 600 } as DOMRect);
    Object.defineProperty(node, "clientWidth", { value: WIDTH });
    for (const layer of layers) {
        const element = document.createElement("div");
        element.dataset.chatLayer = layer;
        node.appendChild(element);
    }
    document.body.appendChild(node);
    return node;
}

/** A finger from (x, y), through the moves, then lifted. */
function swipe(node: HTMLElement, from: [number, number], moves: [number, number][]) {
    const target = node.lastElementChild ?? node;
    target.dispatchEvent(touchEvent("touchstart", ...from));
    const seen: (string | undefined)[] = [];
    for (const move of moves) {
        target.dispatchEvent(touchEvent("touchmove", ...move));
        seen.push(get(chatBackPeekStore));
    }
    target.dispatchEvent(touchEvent("touchend", ...(moves[moves.length - 1] ?? from)));
    return seen;
}

const settled = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 350);
    });

describe("chatBackSwipe", () => {
    let node: HTMLElement;
    let action: ReturnType<typeof chatBackSwipe> | undefined;

    beforeEach(() => {
        leaveChat();
        chatVisibilityStore.set(true);
        selectedRoomStore.set(room as unknown as ChatRoom);
    });
    afterEach(() => {
        action?.destroy?.();
        node?.remove();
    });

    it("from the edge, slides the conversation away to all chats", async () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: false });
        const thread = node.querySelector<HTMLElement>('[data-chat-layer="thread"]');
        const seen = swipe(
            node,
            [10, 300],
            [
                [30, 302],
                [80, 304],
                [160, 305],
            ]
        );
        // All chats are drawn under it while it moves.
        expect(seen).toContain("list");
        expect(thread?.style.transform).toBe(`translateX(${WIDTH}px)`);
        await settled();
        expect(get(selectedRoomStore)).toBeUndefined();
        expect(get(chatBackPeekStore)).toBeUndefined();
    });

    it("lets go early and the conversation slides back", async () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: false });
        const target = node.lastElementChild as HTMLElement;
        target.dispatchEvent(touchEvent("touchstart", 10, 300));
        target.dispatchEvent(touchEvent("touchmove", 30, 300));
        // Slow: no flick.
        await new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
        target.dispatchEvent(touchEvent("touchmove", 60, 300));
        target.dispatchEvent(touchEvent("touchend", 60, 300));
        await settled();
        expect(get(selectedRoomStore)).toBe(room);
        expect(get(chatBackPeekStore)).toBeUndefined();
        expect(target.style.transform).toBe("");
    });

    it("leaves a swipe that starts further in to the message under it", async () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: false });
        const seen = swipe(
            node,
            [80, 300],
            [
                [120, 300],
                [250, 300],
            ]
        );
        expect(seen).toEqual([undefined, undefined]);
        await settled();
        expect(get(selectedRoomStore)).toBe(room);
    });

    it("leaves an up-and-down drag to scrolling", async () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: false });
        const seen = swipe(
            node,
            [10, 300],
            [
                [14, 340],
                [60, 420],
            ]
        );
        expect(seen).toEqual([undefined, undefined]);
        await settled();
        expect(get(selectedRoomStore)).toBe(room);
    });

    it("keeps the edge's touch from the message under it", () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: false });
        const onMessage = vi.fn();
        const message = node.lastElementChild as HTMLElement;
        message.addEventListener("pointerdown", onMessage);
        const down = (x: number) =>
            message.dispatchEvent(
                Object.assign(new Event("pointerdown", { bubbles: true }), { pointerType: "touch", clientX: x })
            );
        down(10);
        expect(onMessage).not.toHaveBeenCalled();
        down(100);
        expect(onMessage).toHaveBeenCalledTimes(1);
        message.removeEventListener("pointerdown", onMessage);
    });

    it("goes back from details to the conversation, uncovering it", async () => {
        openRoomDetailsIdStore.set("!room");
        node = makeChat(["thread", "panel"]);
        action = chatBackSwipe(node, { listBeside: false });
        const seen = swipe(
            node,
            [5, 300],
            [
                [40, 300],
                [200, 300],
            ]
        );
        expect(seen).toContain("conversation");
        await settled();
        expect(get(openRoomDetailsIdStore)).toBeUndefined();
        expect(get(selectedRoomStore)).toBe(room);
    });

    it("doesn't swipe the conversation away when all chats are beside it", async () => {
        node = makeChat(["thread"]);
        action = chatBackSwipe(node, { listBeside: true });
        const seen = swipe(
            node,
            [5, 300],
            [
                [40, 300],
                [200, 300],
            ]
        );
        expect(seen).toEqual([undefined, undefined]);
        await settled();
        expect(get(selectedRoomStore)).toBe(room);
    });
});
