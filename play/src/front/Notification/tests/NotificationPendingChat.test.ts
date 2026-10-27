import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gameSceneIsLoadedStore = writable(false);
const selectedRoomStore = { subscribe: writable(undefined).subscribe, set: vi.fn() };
const openChat = vi.fn();
const room = { id: "!dm:chat" };

vi.mock("../../Components/ActionBar/AvailabilityStatus/statusChanger", () => ({ statusChanger: {} }));
vi.mock("../../Connection/LocalUserStore", () => ({ localUserStore: {} }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { getChatConnection: () => Promise.resolve({}) } }));
vi.mock("../../Chat/Stores/SelectRoomStore", () => ({ selectedRoomStore }));
vi.mock("../../Stores/MyMediaStore", () => ({ proximityMeetingStore: writable(false) }));
vi.mock("../../Chat/openChat", () => ({ openChat }));
vi.mock("../../Stores/GameSceneStore", () => ({ gameSceneIsLoadedStore }));
vi.mock("../findChatRoom", () => ({ findChatRoom: () => Promise.resolve(room) }));

let workerListener: ((event: MessageEvent) => void) | undefined;

/** Loads the page's manager afresh, as a new page in the same tab would. */
async function loadPage() {
    vi.resetModules();
    await import("../NotificationManager");
}

const settle = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

describe("a tapped chat that goes through sign-in first", () => {
    beforeEach(() => {
        sessionStorage.clear();
        gameSceneIsLoadedStore.set(false);
        vi.clearAllMocks();
        Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: {
                addEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
                    (workerListener = listener),
                startMessages: vi.fn(),
            },
        });
    });

    it("still opens the chat when the page comes back from sign-in", async () => {
        await loadPage();
        // The new window gets the tap, then leaves for sign-in before its room is in.
        workerListener?.(new MessageEvent("message", { data: { type: "openChat", data: { chatRoomId: room.id } } }));
        await settle();
        expect(openChat).not.toHaveBeenCalled();

        // Back from sign-in: a new page in the same tab.
        await loadPage();
        gameSceneIsLoadedStore.set(true);
        await settle();
        await settle();
        expect(openChat).toHaveBeenCalledWith("notification");
        expect(selectedRoomStore.set).toHaveBeenCalledWith(room);
        expect(sessionStorage.length).toBe(0);
    });

    it("does not open a tap older than ten minutes, or a nearby chat", async () => {
        const { readPendingChat, PENDING_CHAT_MAX_AGE_MS } = await import("../NotificationManager");
        sessionStorage.setItem("notificationPendingChat", JSON.stringify({ chatRoomId: room.id, at: 1000 }));
        expect(readPendingChat(1000 + PENDING_CHAT_MAX_AGE_MS)).toBe(room.id);
        expect(readPendingChat(1001 + PENDING_CHAT_MAX_AGE_MS)).toBeUndefined();
        expect(sessionStorage.length).toBe(0);

        await loadPage();
        workerListener?.(
            new MessageEvent("message", { data: { type: "openChat", data: { chatRoomId: "proximity" } } })
        );
        expect(sessionStorage.length).toBe(0);
    });
});
