import { get, writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

vi.mock("../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable(undefined) };
});

import type { BrickCard } from "../Brick";
import { PendingBrickChatRoom, SETUP_WAIT_MS, type PendingHandOver, type PendingSend } from "../PendingBrickChat";

const BRICK: BrickCard = {
    id: "0b7c1d2e-1111-4222-8333-944455556666",
    name: "Brick",
    description: null,
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: true,
    createdAt: "2026-11-11T10:00:00.000Z",
    hello: null,
};

/** A screen with a clock and timers that only move when the test moves them. */
function screen(shown = true) {
    let now = 1_000_000;
    const timers: { at: number; run: () => void; id: number }[] = [];
    let ids = 0;
    const deps = {
        now: () => now,
        setTimer: vi.fn((run: () => void, ms: number) => {
            const id = ++ids;
            timers.push({ at: now + ms, run, id });
            return id;
        }),
        clearTimer: vi.fn((timer: unknown) => {
            const at = timers.findIndex((one) => one.id === timer);
            if (at >= 0) timers.splice(at, 1);
        }),
        sayStillLoading: vi.fn(),
        isShown: vi.fn(() => shown),
        retry: vi.fn(),
    };
    const room = new PendingBrickChatRoom(writable(BRICK), deps);
    return {
        room,
        deps,
        setShown: (value: boolean) => {
            shown = value;
        },
        pass: (ms: number) => {
            now += ms;
            for (const due of timers.filter((one) => one.at <= now)) {
                timers.splice(timers.indexOf(due), 1);
                due.run();
            }
        },
    };
}

const shownWords = (room: PendingBrickChatRoom) => get(room.messages).map((message) => get(message.content).body);
const stillSending = (room: PendingBrickChatRoom) => get(room.messages).map((message) => get(message.sending!));

/** The real chat, as a hand-over sees it: each send waits until the test lets it through. */
function realChat() {
    const sent: PendingSend[] = [];
    const gates: { release: () => void; fail: (error: Error) => void }[] = [];
    const into: PendingHandOver = {
        send: vi.fn(
            (send: PendingSend) =>
                new Promise<void>((resolve, reject) => {
                    gates.push({
                        release: () => {
                            sent.push(send);
                            resolve();
                        },
                        fail: reject,
                    });
                })
        ),
        carry: vi.fn(),
        showReal: vi.fn(),
    };
    return { into, sent, gates };
}
const flush = async () => {
    // A few turns of the event loop, one after the other: what each step awaits has then settled
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 10; i++) await Promise.resolve();
    /* eslint-enable no-await-in-loop */
};

describe("the screen of a Brick's chat that is still being made", () => {
    it("is the Brick's own: its name and picture, one to one, and nothing in it yet", () => {
        const { room } = screen();
        expect(get(room.name)).toBe("Brick");
        expect(room.type).toBe("direct");
        expect(room.id).toContain(BRICK.id);
        expect(get(room.messages)).toEqual([]);
        expect(get(room.hasUnreadMessages)).toBe(false);
    });

    it("shows what the person writes faded, as theirs, in the order they wrote it", () => {
        const { room } = screen();
        room.sendMessage("Can you send me a morning brief at 8?");
        room.sendMessage("  And one at 5  ");
        expect(shownWords(room)).toEqual(["Can you send me a morning brief at 8?", "And one at 5"]);
        expect(get(room.messages).every((message) => message.isMyMessage)).toBe(true);
        expect(stillSending(room)).toEqual([true, true]);
        // Nothing to react to, reply to or edit: it was not sent anywhere
        expect(get(room.messages).every((message) => message.local === true)).toBe(true);
    });

    it("keeps nothing for blank words", () => {
        const { room } = screen();
        room.sendMessage("   ");
        room.sendMessage("");
        expect(get(room.messages)).toEqual([]);
    });
});

describe("handing what was written to the real chat", () => {
    it("sends each message once and in order, the next only after the chat server has the one before", async () => {
        const { room } = screen();
        const { into, sent, gates } = realChat();
        room.sendMessage("first");
        room.sendMessage("second");
        room.sendStarter("What can you do?", "ideas");
        const done = room.handOver(into);
        await flush();
        // Only the first is out; the others wait for it
        expect(into.send).toHaveBeenCalledTimes(1);
        expect(stillSending(room)).toEqual([true, true, true]);
        gates[0].release();
        await flush();
        expect(into.send).toHaveBeenCalledTimes(2);
        // A message turns normal only once the chat server confirmed it
        expect(stillSending(room)).toEqual([false, true, true]);
        gates[1].release();
        await flush();
        gates[2].release();
        await expect(done).resolves.toBe("switched");
        expect(sent).toEqual([
            { words: "first" },
            { words: "second" },
            { words: "What can you do?", starter: "ideas" },
        ]);
        expect(stillSending(room)).toEqual([false, false, false]);
        expect(into.showReal).toHaveBeenCalledTimes(1);
    });

    it("sends what is written while it is sending, once and after the others", async () => {
        const { room } = screen();
        const { into, sent, gates } = realChat();
        room.sendMessage("one");
        const done = room.handOver(into);
        await flush();
        room.sendMessage("two");
        gates[0].release();
        await flush();
        gates[1].release();
        await expect(done).resolves.toBe("switched");
        expect(sent.map((send) => send.words)).toEqual(["one", "two"]);
        // And asking again while it runs does not send anything twice
        expect(into.send).toHaveBeenCalledTimes(2);
    });

    it("answers the same hand-over to a second ask while one runs", async () => {
        const { room } = screen();
        const { into, gates } = realChat();
        room.sendMessage("one");
        const first = room.handOver(into);
        const second = room.handOver(into);
        expect(second).toBe(first);
        await flush();
        gates[0].release();
        await first;
        expect(into.send).toHaveBeenCalledTimes(1);
    });

    it("takes the person to the real chat at once when nothing was written, carrying nothing", async () => {
        const { room } = screen();
        const { into } = realChat();
        await expect(room.handOver(into)).resolves.toBe("switched");
        expect(into.send).not.toHaveBeenCalled();
        expect(into.carry).toHaveBeenCalledWith("");
        expect(into.showReal).toHaveBeenCalledTimes(1);
    });

    it("carries what was typed and not sent to the real chat's box before it shows it", async () => {
        const { room } = screen();
        const { into } = realChat();
        room.readTypedFrom(() => "half a sentence");
        const order: string[] = [];
        (into.carry as ReturnType<typeof vi.fn>).mockImplementation(() => {
            order.push("carry");
        });
        (into.showReal as ReturnType<typeof vi.fn>).mockImplementation(() => {
            order.push("show");
        });
        await room.handOver(into);
        expect(into.carry).toHaveBeenCalledWith("half a sentence");
        expect(order).toEqual(["carry", "show"]);
    });

    it("sends what was written but leaves the person where they are when they went elsewhere", async () => {
        const { room, setShown } = screen();
        const { into, sent, gates } = realChat();
        room.sendMessage("hello there");
        setShown(false);
        const done = room.handOver(into);
        await flush();
        gates[0].release();
        await expect(done).resolves.toBe("left");
        expect(sent).toEqual([{ words: "hello there" }]);
        expect(into.showReal).not.toHaveBeenCalled();
    });

    it("puts what was not sent back into the message box when the chat server refuses, and stays", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { room, deps } = screen();
        const { into, sent, gates } = realChat();
        room.sendMessage("one");
        room.sendMessage("two");
        const done = room.handOver(into);
        await flush();
        gates[0].release();
        await flush();
        gates[1].fail(new Error("refused"));
        await expect(done).resolves.toBe("failed");
        expect(sent).toEqual([{ words: "one" }]);
        // The first is sent and stays; the second is in the box again, not dropped
        expect(shownWords(room)).toEqual(["one"]);
        expect(get(room.textBack)).toBe("two");
        expect(deps.sayStillLoading).toHaveBeenCalledTimes(1);
        expect(into.showReal).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("sends what was put back, once, when the person writes again", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { room, deps } = screen();
        const { into, gates } = realChat();
        room.sendMessage("one");
        const failing = room.handOver(into);
        await flush();
        gates[0].fail(new Error("refused"));
        await failing;
        expect(get(room.textBack)).toBe("one");
        room.clearTextBack();
        expect(get(room.textBack)).toBeUndefined();
        // They send it again: the chat is made again, and the words go once
        room.sendMessage("one");
        expect(deps.retry).toHaveBeenCalledTimes(1);
        const again = realChat();
        const second = room.handOver(again.into);
        await flush();
        again.gates[0].release();
        await expect(second).resolves.toBe("switched");
        expect(again.sent).toEqual([{ words: "one" }]);
        warn.mockRestore();
    });
});

describe("when the chat takes too long or cannot be made", () => {
    it("waits about 15 seconds, then puts the faded words back into the message box and says the chats are still loading", () => {
        const { room, deps, pass } = screen();
        room.begin();
        room.sendMessage("brief at 8?");
        room.sendMessage("and at 5");
        pass(SETUP_WAIT_MS - 1);
        expect(deps.sayStillLoading).not.toHaveBeenCalled();
        expect(shownWords(room)).toHaveLength(2);
        pass(1);
        expect(deps.sayStillLoading).toHaveBeenCalledTimes(1);
        expect(get(room.messages)).toEqual([]);
        // Nothing is dropped: both are in the box, in order, and nothing was sent
        expect(get(room.textBack)).toBe("brief at 8?\nand at 5");
        expect(room.failed).toBe(true);
    });

    it("says so once for one try, however many things report it", () => {
        const { room, deps, pass } = screen();
        room.begin();
        room.sendMessage("hi");
        room.setupFailed();
        room.setupFailed();
        pass(SETUP_WAIT_MS);
        expect(deps.sayStillLoading).toHaveBeenCalledTimes(1);
    });

    it("stays quiet when nothing was written and the person is elsewhere", () => {
        const { room, deps, setShown } = screen();
        room.begin();
        setShown(false);
        room.setupFailed();
        expect(deps.sayStillLoading).not.toHaveBeenCalled();
    });

    it("says so when the person is looking at the screen even with nothing written", () => {
        const { room, deps } = screen();
        room.begin();
        room.setupFailed();
        expect(deps.sayStillLoading).toHaveBeenCalledTimes(1);
        expect(get(room.textBack)).toBeUndefined();
    });

    it("tries again when the person writes after it failed, and the wait starts again", () => {
        const { room, deps, pass } = screen();
        room.begin();
        room.sendMessage("hi");
        pass(SETUP_WAIT_MS);
        expect(room.failed).toBe(true);
        room.clearTextBack();
        room.sendMessage("hi");
        expect(deps.retry).toHaveBeenCalledTimes(1);
        expect(room.failed).toBe(false);
        expect(shownWords(room)).toEqual(["hi"]);
        pass(SETUP_WAIT_MS);
        expect(deps.sayStillLoading).toHaveBeenCalledTimes(2);
        expect(get(room.textBack)).toBe("hi");
    });

    it("does not give up once the chat is there and its words are going", async () => {
        const { room, deps, pass } = screen();
        const { into, gates } = realChat();
        room.begin();
        room.sendMessage("hi");
        const done = room.handOver(into);
        pass(SETUP_WAIT_MS * 2);
        expect(deps.sayStillLoading).not.toHaveBeenCalled();
        await flush();
        gates[0].release();
        await expect(done).resolves.toBe("switched");
    });

    it("stays on the screen when the chat turns up late and nothing was written since it gave up", async () => {
        const { room, pass } = screen();
        const { into } = realChat();
        room.begin();
        pass(SETUP_WAIT_MS);
        await expect(room.handOver(into)).resolves.toBe("stayed");
        expect(into.showReal).not.toHaveBeenCalled();
        expect(room.failed).toBe(true);
    });
});

describe("the screen's own limits", () => {
    it("takes no files and keeps no history", async () => {
        const { room } = screen();
        await expect(room.sendFiles()).resolves.toBeUndefined();
        await expect(room.loadMorePreviousMessages()).resolves.toBeUndefined();
        expect(get(room.hasPreviousMessage)).toBe(false);
        expect(get(room.isEncrypted)).toBe(false);
    });
});
