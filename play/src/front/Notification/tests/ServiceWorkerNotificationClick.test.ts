import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(resolve(__dirname, "../../../../public/service-worker.js"), "utf8");

const ORIGIN = "https://play.example.com";
const ROOM = `${ORIGIN}/@/universe/world/room`;

type FakeWindow = {
    url: string;
    focus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
};

function fakeWindow(url: string): FakeWindow {
    const client: FakeWindow = { url, focus: vi.fn(), postMessage: vi.fn() };
    client.focus.mockResolvedValue(client);
    return client;
}

/** Runs the worker file with fake browser parts and taps a notification carrying `data`. */
async function tap(windows: FakeWindow[], data: unknown, opened: FakeWindow | null = fakeWindow(ROOM)) {
    const listeners = new Map<string, (event: unknown) => void>();
    const fakeSelf = {
        location: { origin: ORIGIN },
        registration: { scope: `${ORIGIN}/` },
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        skipWaiting: vi.fn(),
    };
    const broadcasts: unknown[] = [];
    class FakeBroadcastChannel {
        constructor(readonly name: string) {}
        postMessage(message: unknown) {
            broadcasts.push({ channel: this.name, message });
        }
    }
    const fakeClients = {
        matchAll: vi.fn().mockResolvedValue(windows),
        openWindow: vi.fn().mockResolvedValue(opened),
        claim: vi.fn(),
    };
    // The real worker file, run with the fake browser parts in place of its globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("self", "clients", "BroadcastChannel", workerSource)(fakeSelf, fakeClients, FakeBroadcastChannel);

    let done: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.get("notificationclick")?.({
        notification: { close, data },
        waitUntil: (promise: Promise<unknown>) => {
            done = promise;
        },
    });
    await done;
    return { close, openWindow: fakeClients.openWindow, broadcasts };
}

const openChat = (chatRoomId: string) => ({ type: "openChat", data: { chatRoomId } });

describe("service worker: tapping a chat notification", () => {
    it("opens Universe on the notification's room when no window is open, and asks it to open the chat", async () => {
        const opened = fakeWindow(ROOM);
        const { close, openWindow } = await tap([], { chatRoomId: "!dm:chat", tabUrl: ROOM }, opened);

        expect(close).toHaveBeenCalled();
        expect(openWindow).toHaveBeenCalledWith(ROOM);
        expect(opened.postMessage).toHaveBeenCalledWith(openChat("!dm:chat"));
    });

    it("opens the chat only in the window it brings forward when two are open", async () => {
        const other = fakeWindow(`${ORIGIN}/@/universe/world/other`);
        const same = fakeWindow(ROOM);
        const { openWindow } = await tap([other, same], { chatRoomId: "!dm:chat", tabUrl: ROOM });

        expect(openWindow).not.toHaveBeenCalled();
        expect(same.focus).toHaveBeenCalled();
        expect(same.postMessage).toHaveBeenCalledWith(openChat("!dm:chat"));
        expect(other.focus).not.toHaveBeenCalled();
        expect(other.postMessage).not.toHaveBeenCalled();
    });

    it("also tells windows still on the previous release, which listen on the old channel until they reload", async () => {
        const { broadcasts } = await tap([fakeWindow(ROOM)], { chatRoomId: "!dm:chat", tabUrl: ROOM });

        expect(broadcasts).toEqual([{ channel: "message", message: openChat("!dm:chat") }]);
    });

    it("tells no one on the old channel about a window it opens, which is always on this release", async () => {
        const { broadcasts } = await tap([], { chatRoomId: "!dm:chat", tabUrl: ROOM });

        expect(broadcasts).toEqual([]);
    });

    it("brings the first window forward when none shows the notification's room", async () => {
        const first = fakeWindow(`${ORIGIN}/@/universe/world/a`);
        const second = fakeWindow(`${ORIGIN}/@/universe/world/b`);
        await tap([first, second], { chatRoomId: "!dm:chat", tabUrl: ROOM });

        expect(first.postMessage).toHaveBeenCalledWith(openChat("!dm:chat"));
        expect(second.postMessage).not.toHaveBeenCalled();
    });

    it("still opens the chat when the browser refuses to bring the window forward", async () => {
        const same = fakeWindow(ROOM);
        same.focus.mockRejectedValue(new Error("Not allowed to focus a window."));
        await tap([same], { chatRoomId: "!dm:chat", tabUrl: ROOM });

        expect(same.postMessage).toHaveBeenCalledWith(openChat("!dm:chat"));
    });

    it("does not ask a new window for a nearby chat, which ended with the window that showed it", async () => {
        const opened = fakeWindow(ROOM);
        const { openWindow } = await tap([], { chatRoomId: "proximity", tabUrl: ROOM }, opened);

        expect(openWindow).toHaveBeenCalledWith(ROOM);
        expect(opened.postMessage).not.toHaveBeenCalled();
    });

    it("opens only this site: another site's address opens Universe's start", async () => {
        const { openWindow } = await tap([], { chatRoomId: "!dm:chat", tabUrl: "https://elsewhere.example/phish" });

        expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    });

    it("opens Universe's start for a notification without data", async () => {
        const { openWindow } = await tap([], undefined);

        expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    });
});
