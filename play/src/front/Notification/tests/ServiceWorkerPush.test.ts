import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(resolve(__dirname, "../../../../public/service-worker.js"), "utf8");

const ORIGIN = "https://play.example.com";
const SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

type Showing = { tag: string; close: ReturnType<typeof vi.fn> };

/** What an open Universe window answers when the worker asks whether it rang for the chat; "frozen" never answers. */
type WindowAnswer = boolean | "frozen";

/** A MessageChannel whose second port answers the first, as a page's reply reaches the worker. */
class FakeMessageChannel {
    port1: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
    port2 = {
        postMessage: (data: unknown) => {
            queueMicrotask(() => this.port1.onmessage?.({ data }));
        },
    };
}

/** Runs the worker file with fake browser parts and delivers one push carrying `body`. */
async function push(
    body: string | undefined,
    { userAgent = CHROME, showing = [] as Showing[], windows = [] as WindowAnswer[] } = {}
) {
    const asked: unknown[] = [];
    const windowClients = windows.map((answer) => ({
        postMessage: (message: unknown, [port]: FakeMessageChannel["port2"][]) => {
            asked.push(message);
            if (answer !== "frozen") port.postMessage(answer);
        },
    }));
    const listeners = new Map<string, (event: unknown) => void>();
    const registration = {
        scope: `${ORIGIN}/`,
        showNotification: vi.fn().mockResolvedValue(undefined),
        getNotifications: vi.fn(({ tag }: { tag: string }) =>
            Promise.resolve(showing.filter((notification) => notification.tag === tag))
        ),
    };
    const fakeSelf = {
        location: { origin: ORIGIN },
        navigator: { userAgent },
        registration,
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        skipWaiting: vi.fn(),
    };
    // The real worker file, run with the fake browser parts in place of its globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("self", "clients", "BroadcastChannel", "MessageChannel", workerSource)(
        fakeSelf,
        { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue(windowClients) },
        class {},
        FakeMessageChannel
    );

    let done: Promise<unknown> = Promise.resolve();
    listeners.get("push")?.({
        data: body === undefined ? null : { json: () => JSON.parse(body) as unknown },
        waitUntil: (promise: Promise<unknown>) => {
            done = promise;
        },
    });
    await done;
    return Object.assign(registration, { asked });
}

function shown(registration: Awaited<ReturnType<typeof push>>): { title: string } & Record<string, unknown> {
    const [title, options] = registration.showNotification.mock.calls[0] as [string, Record<string, unknown>];
    return { title, ...options };
}

describe("service worker: a notification Orbit sends", () => {
    it("shows its title and line, and a tap opens its chat in its room", async () => {
        const registration = await push(
            JSON.stringify({
                title: "Sara",
                body: "Are you coming to the standup?",
                chatRoomId: "!dm:chat",
                url: `${ORIGIN}/@/universe/world/room`,
            })
        );

        expect(shown(registration)).toMatchObject({
            title: "Sara",
            body: "Are you coming to the standup?",
            tag: "chat:!dm:chat",
            data: { chatRoomId: "!dm:chat", tabUrl: `${ORIGIN}/@/universe/world/room` },
        });
    });

    it("keeps the tag Orbit gives a notification that is not about a chat", async () => {
        const registration = await push(JSON.stringify({ title: "Friend request", tag: "friend-request:abc" }));

        expect(shown(registration)).toMatchObject({ tag: "friend-request:abc", data: { chatRoomId: undefined } });
    });

    it.each([undefined, "not json", JSON.stringify({ body: "no title" })])(
        "still shows a notification when the push cannot be read (%s)",
        async (body) => {
            const registration = await push(body);

            expect(registration.showNotification).toHaveBeenCalledTimes(1);
            expect(shown(registration).title).toBe("Universe");
        }
    );

    it("lets the browser replace the chat's notification in place outside Safari", async () => {
        const older: Showing = { tag: "chat:!dm:chat", close: vi.fn() };
        const registration = await push(JSON.stringify({ title: "Sara", chatRoomId: "!dm:chat" }), {
            showing: [older],
        });

        expect(registration.getNotifications).not.toHaveBeenCalled();
        expect(older.close).not.toHaveBeenCalled();
        expect(shown(registration).tag).toBe("chat:!dm:chat");
    });

    it("closes the chat's older notification first in Safari, and leaves other chats alone", async () => {
        const older: Showing = { tag: "chat:!dm:chat", close: vi.fn() };
        const otherChat: Showing = { tag: "chat:!other:chat", close: vi.fn() };
        const registration = await push(JSON.stringify({ title: "Sara", chatRoomId: "!dm:chat" }), {
            userAgent: SAFARI,
            showing: [older, otherChat],
        });

        expect(older.close).toHaveBeenCalled();
        expect(otherChat.close).not.toHaveBeenCalled();
        expect(registration.showNotification).toHaveBeenCalledTimes(1);
    });

    describe("the sound of a chat's notification (#1493)", () => {
        const chatPush = JSON.stringify({ title: "Bot", body: "Here you go", chatRoomId: "!dm:chat" });

        it("rings when Universe is not open here", async () => {
            const registration = await push(chatPush);

            expect(shown(registration)).toMatchObject({ silent: false, renotify: true });
        });

        it("stays quiet when an open Universe window played its own chat sound for it", async () => {
            const registration = await push(chatPush, { windows: [true] });

            expect(registration.asked).toEqual([{ type: "chatSoundCheck", chatRoomId: "!dm:chat" }]);
            expect(shown(registration)).toMatchObject({ silent: true, renotify: false, tag: "chat:!dm:chat" });
        });

        it("stays quiet when any one of several windows played it", async () => {
            const registration = await push(chatPush, { windows: [false, true] });

            expect(shown(registration)).toMatchObject({ silent: true });
        });

        it("rings when the open windows played no sound for it (chat sounds off, busy)", async () => {
            const registration = await push(chatPush, { windows: [false, false] });

            expect(shown(registration)).toMatchObject({ silent: false, renotify: true });
        });

        it("rings, a moment later, when the open window is frozen in the background and never answers", async () => {
            vi.useFakeTimers();
            try {
                const pending = push(chatPush, { windows: ["frozen"] });
                await vi.advanceTimersByTimeAsync(2000);
                const registration = await pending;

                expect(shown(registration)).toMatchObject({ silent: false, renotify: true });
            } finally {
                vi.useRealTimers();
            }
        });

        it("never asks for a notification that is not about a chat: it keeps its sound", async () => {
            const registration = await push(JSON.stringify({ title: "Friend request", tag: "friend-request:abc" }), {
                windows: [true],
            });

            expect(registration.asked).toEqual([]);
            expect(shown(registration)).toMatchObject({ silent: false, renotify: true });
        });
    });
});
