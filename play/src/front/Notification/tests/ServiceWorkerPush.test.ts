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

/** Runs the worker file with fake browser parts and delivers one push carrying `body`. */
async function push(body: string | undefined, { userAgent = CHROME, showing = [] as Showing[] } = {}) {
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
    new Function("self", "clients", "BroadcastChannel", workerSource)(fakeSelf, { claim: vi.fn() }, class {});

    let done: Promise<unknown> = Promise.resolve();
    listeners.get("push")?.({
        data: body === undefined ? null : { json: () => JSON.parse(body) as unknown },
        waitUntil: (promise: Promise<unknown>) => {
            done = promise;
        },
    });
    await done;
    return registration;
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
});
