import { get, readable, writable } from "svelte/store";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable<string | undefined>("/static/images/bricks/brick-orange.png") };
});

import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import type { ChatMessage } from "../../Connection/ChatConnection";
import { guestBrickCard } from "../GuestBrick";
import { drawnGuestChats, expandGuestChats, guestBrickSender, localMessage } from "../GuestBrickMessages";

const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test";

function carrier(lines: { from: "guest" | "brick"; text: string; at: number }[]): ChatMessage {
    const brick = guestBrickCard(i18nObject("en-US"), 0);
    return {
        ...localMessage({
            id: "$carrier",
            sender: { ...guestBrickSender(brick), chatId: BOT },
            mine: false,
            text: "x",
            at: new Date(5000),
        }),
        local: undefined,
        guestChat: lines,
    };
}
const bodies = (messages: readonly ChatMessage[]) => messages.map((message) => get(message.content).body);

describe("the chat a guest brought along, drawn in the Brick's chat (#1997)", () => {
    beforeAll(() => {
        loadLocale("en-US");
    });

    it("draws a removed carrier as the one removed message, with no lines and no welcome", () => {
        const message = carrier([{ from: "guest", text: "Where's the coffee here?", at: 1000 }]);
        message.isDeleted = readable(true);
        const drawn = expandGuestChats([message], i18nObject("en-US"), "Khalid");
        expect(drawn).toEqual([message]);
    });

    it("draws a carrier removed while the chat is open as the one removed message, with its lines and welcome gone", () => {
        const message = carrier([{ from: "guest", text: "Where's the coffee here?", at: 1000 }]);
        const isDeleted = writable(false);
        message.isDeleted = isDeleted;
        const drawn = drawnGuestChats(readable([message]), readable(i18nObject("en-US")), () => "Khalid");
        const seen: number[] = [];
        const stop = drawn.subscribe((list) => seen.push(list.length));
        // Its lines and the welcome are drawn while it stands
        expect(get(drawn)).toHaveLength(2);
        isDeleted.set(true);
        expect(get(drawn)).toEqual([message]);
        stop();
        expect(seen).toEqual([2, 1]);
    });

    it("draws each line as it was said, then the Brick's welcome to the person by name", () => {
        const message = carrier([
            { from: "guest", text: "Where's the coffee here?", at: 1000 },
            { from: "brick", text: "Second row.", at: 2000 },
        ]);
        const drawn = expandGuestChats([message], i18nObject("en-US"), "Khalid");
        expect(bodies(drawn)).toEqual([
            "Where's the coffee here?",
            "Second row.",
            "Welcome, Khalid. I'm yours now, and this chat came with me. What shall we do next?",
        ]);
        expect(drawn.map((one) => one.isMyMessage)).toEqual([true, false, false]);
        // The Brick's lines are the Brick's own, in its own chat
        expect(drawn[1].sender?.chatId).toBe(BOT);
        expect(drawn[2].sender?.chatId).toBe(BOT);
        expect(drawn[0].sender).toBeUndefined();
        expect(drawn[0].date?.getTime()).toBe(1000);
        // The welcome has the time the Brick left it
        expect(drawn[2].date?.getTime()).toBe(5000);
    });

    it("draws a guest's carried pictures and notes in the same bubbles as every chat, and a file that was gone as gone", () => {
        const message = {
            ...carrier([]),
            guestChat: [
                {
                    from: "guest" as const,
                    text: "(sent a picture: cat.png)",
                    at: 1000,
                    label: true as const,
                    media: [
                        {
                            kind: "file" as const,
                            name: "cat.png",
                            type: "image/png",
                            url: "https://media.test/cat.png",
                        },
                        { kind: "file" as const, name: "old.pdf", type: "application/pdf", gone: true as const },
                    ],
                },
                {
                    from: "guest" as const,
                    text: "",
                    at: 2000,
                    media: [
                        {
                            kind: "note" as const,
                            name: "note.ogg",
                            type: "audio/ogg",
                            url: "https://media.test/n.ogg",
                            duration: 3,
                            heard: "coffee?",
                        },
                    ],
                },
            ],
        };
        const drawn = expandGuestChats([message], i18nObject("en-US"), "Khalid");
        expect(drawn.map((one) => one.type)).toEqual(["image", "file", "audio", "text"]);
        expect(drawn.slice(0, 3).every((one) => one.isMyMessage)).toBe(true);
        const [picture, gone, note] = drawn.map((one) => get(one.content));
        expect(picture.url).toBe("https://media.test/cat.png");
        expect(gone.url).toBeUndefined();
        expect(gone.mediaGone).toBe(true);
        expect(note.isVoice).toBe(true);
        expect(note.transcript).toEqual({ state: "heard", text: "coffee?" });
        // The stand-in words of a picture line are not drawn, and every drawn id stays the same each time
        expect(bodies(drawn)).not.toContain("(sent a picture: cat.png)");
        expect(drawn.map((one) => one.id)).toEqual(
            expandGuestChats([message], i18nObject("en-US"), "Khalid").map((one) => one.id)
        );
    });

    it("draws a chat carried in parts as one chat: each line once, in order, and one welcome after the last part", () => {
        const part = (id: string, lines: { id: string; text: string; at: number }[]) => ({
            ...carrier([]),
            id,
            guestChat: lines.map((line) => ({ ...line, from: "guest" as const })),
        });
        const first = part("$p1", [
            { id: "7.0", text: "one", at: 1 },
            { id: "7.1", text: "two", at: 2 },
        ]);
        // The first part sent again (its answer was lost), then the second
        const again = part("$p1b", [
            { id: "7.0", text: "one", at: 1 },
            { id: "7.1", text: "two", at: 2 },
        ]);
        const second = part("$p2", [{ id: "7.2", text: "three", at: 3 }]);
        const drawn = expandGuestChats([first, again, second], i18nObject("en-US"), "Khalid");
        expect(bodies(drawn)).toEqual([
            "one",
            "two",
            "three",
            "Welcome, Khalid. I'm yours now, and this chat came with me. What shall we do next?",
        ]);
        // While only the first part is here, it ends with the welcome
        expect(bodies(expandGuestChats([first], i18nObject("en-US"), "Khalid")).at(-1)).toContain("Welcome");
    });

    it("welcomes without a name when the game has none", () => {
        const drawn = expandGuestChats([carrier([{ from: "guest", text: "hi", at: 1 }])], i18nObject("en-US"), null);
        expect(bodies(drawn)[1]).toBe("Welcome. I'm yours now, and this chat came with me. What shall we do next?");
    });

    it("gives every drawn message the same id each time, and none the id of the one that carries them", () => {
        const message = carrier([
            { from: "guest", text: "a", at: 1 },
            { from: "brick", text: "b", at: 2 },
        ]);
        const first = expandGuestChats([message], i18nObject("en-US"), "Khalid").map((one) => one.id);
        const again = expandGuestChats([message], i18nObject("en-US"), "Khalid").map((one) => one.id);
        expect(first).toEqual(again);
        expect(new Set(first).size).toBe(3);
        expect(first).not.toContain("$carrier");
    });

    it("leaves every other message as it is, in its place, and returns the same list when none carries a chat", () => {
        const plain = localMessage({ id: "plain", sender: undefined, mine: true, text: "hello", at: new Date(1) });
        const list = [plain];
        expect(expandGuestChats(list, i18nObject("en-US"), "Khalid")).toBe(list);
        const message = carrier([{ from: "guest", text: "hi", at: 1 }]);
        const mixed = expandGuestChats([plain, message, plain], i18nObject("en-US"), "Khalid");
        expect(mixed.map((one) => one.id)).toEqual(["plain", "$carrier:line:0", "$carrier:welcome", "plain"]);
    });

    it("draws what the game made itself with nothing to react to, reply to, edit or delete", () => {
        const [mine] = expandGuestChats([carrier([{ from: "guest", text: "hi", at: 1 }])], i18nObject("en-US"), "K");
        expect(mine.local).toBe(true);
        expect(get(mine.canReact) || get(mine.canReply) || get(mine.canDelete)).toBe(false);
        expect(get(readable(mine.isDeleted))).toBeDefined();
    });
});
