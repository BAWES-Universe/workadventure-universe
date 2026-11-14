import { get, readable } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable<string | undefined>("/static/images/bricks/brick-orange.png") };
});

import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import { GuestBrickChatRoom, type GuestBrickDeps, type GuestBrickRequest } from "../GuestBrickChatRoom";

const GUEST = "4f1d2c3b-aaaa-4bbb-8ccc-0123456789ab";
const HOUR = 60 * 60 * 1000;
const ROOM = "/@/bawes/universe/hq";

/** What a device holds, and what the bot server is asked, with the answers each test gives. */
function setup(over: Partial<GuestBrickDeps> = {}) {
    const device = { saved: null as string | null, clock: 1_000_000, turns: 0 };
    const asked: GuestBrickRequest[] = [];
    const answers: Array<() => Promise<unknown>> = [];
    const deps: GuestBrickDeps = {
        ll: readable<TranslationFunctions>(i18nObject("en-US")),
        guestId: () => GUEST,
        roomUrl: () => ROOM,
        ask: (request) => {
            asked.push(request);
            const answer = answers.shift();
            return answer ? answer() : Promise.reject(new Error("no answer"));
        },
        readSaved: () => device.saved,
        save: (raw) => {
            device.saved = raw;
        },
        drop: () => {
            device.saved = null;
        },
        now: () => device.clock,
        newTurnId: () => `turn-${++device.turns}`,
        keepMs: HOUR,
        ...over,
    };
    const room = new GuestBrickChatRoom(deps);
    const said = () =>
        get(room.messages).map((message) => (message.isMyMessage ? "me" : "brick") + ": " + get(message.content).body);
    /** Lets what a message set going finish. */
    const settle = async () => {
        await Array.from({ length: 10 }).reduce<Promise<void>>((turn) => turn.then(() => undefined), Promise.resolve());
    };
    return { room, device, asked, answers, said, settle, deps };
}

describe("a guest's chat with the Brick for guests (#1997)", () => {
    beforeAll(() => {
        loadLocale("en-US");
    });
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("starts empty and asks nobody: the hello is the game's own words, never a model's, and never comes first", async () => {
        const { room, asked, settle } = setup();
        await settle();
        expect(get(room.messages)).toEqual([]);
        expect(asked).toEqual([]);
    });

    it("is its own chat: no chat address, no members, nothing on any chat server", () => {
        const { room } = setup();
        expect(room.id).toBe("guest-brick");
        expect(room.id.startsWith("@")).toBe(false);
        expect("members" in room).toBe(false);
        expect(get(room.isEncrypted)).toBe(false);
        expect(get(room.name)).toBe("Brick");
    });

    it("asks once for each message the guest writes, with the chat so far, the place and one id for the try", async () => {
        const { room, asked, answers, said, settle } = setup();
        answers.push(() =>
            Promise.resolve({ kind: "reply", text: "Second row, next to Zaatar & Co.", needsAccount: false })
        );
        room.sendMessage("  Where's the coffee here?  ");
        await settle();
        expect(asked).toEqual([
            {
                turnId: "turn-1",
                roomUrl: ROOM,
                message: "Where's the coffee here?",
                history: [],
                saidNeedsAccount: false,
            },
        ]);
        expect(said()).toEqual(["me: Where's the coffee here?", "brick: Second row, next to Zaatar & Co."]);

        answers.push(() => Promise.resolve({ kind: "reply", text: "Yes.", needsAccount: false }));
        room.sendMessage("Thanks");
        await settle();
        expect(asked[1]).toMatchObject({
            turnId: "turn-2",
            message: "Thanks",
            history: [
                { from: "guest", text: "Where's the coffee here?" },
                { from: "brick", text: "Second row, next to Zaatar & Co." },
            ],
        });
        // The request names no guest and no time: the game's token says who, and what was said stays what it was
        expect(Object.keys(asked[1]).sort()).toEqual(["history", "message", "roomUrl", "saidNeedsAccount", "turnId"]);
    });

    it("sends nothing for words that are only space", async () => {
        const { room, asked, said, settle } = setup();
        room.sendMessage("   ");
        room.sendMessage("");
        await settle();
        expect(asked).toEqual([]);
        expect(said()).toEqual([]);
    });

    it("answers one message at a time: a second waits for the first and reads the chat as it stands then", async () => {
        const { room, asked, answers, said, settle } = setup();
        let finish: (value: unknown) => void = () => undefined;
        answers.push(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        answers.push(() => Promise.resolve({ kind: "reply", text: "Second answer", needsAccount: false }));
        room.sendMessage("first");
        room.sendMessage("second");
        await settle();
        // The second is on screen at once, but not asked for yet
        expect(asked).toHaveLength(1);
        expect(said()).toEqual(["me: first", "me: second"]);
        finish({ kind: "reply", text: "First answer", needsAccount: false });
        await settle();
        expect(asked).toHaveLength(2);
        expect(asked[1].history).toEqual([
            { from: "guest", text: "first" },
            { from: "brick", text: "First answer" },
        ]);
        // As they arrive: both of the guest's, then the answers in the order they were asked
        expect(said()).toEqual(["me: first", "me: second", "brick: First answer", "brick: Second answer"]);
    });

    it("shows the Brick typing while it answers, and no longer once it has", async () => {
        const { room, answers, settle } = setup();
        let finish: (value: unknown) => void = () => undefined;
        answers.push(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        room.sendMessage("hi");
        await settle();
        expect(get(room.typingMembers).map((one) => one.name)).toEqual(["Brick"]);
        finish({ kind: "reply", text: "Hello", needsAccount: false });
        await settle();
        expect(get(room.typingMembers)).toEqual([]);
    });

    it("says a thing needs an account once: the answer that does is marked for the card, and the Brick is told it was said", async () => {
        const { room, asked, answers, settle } = setup();
        answers.push(() =>
            Promise.resolve({ kind: "reply", text: "I can only remember once I'm yours.", needsAccount: true })
        );
        room.sendMessage("Remember I take it without sugar");
        await settle();
        const messages = get(room.messages);
        expect(messages[1].guestKeep).toBe(true);
        expect(messages[0].guestKeep).toBeUndefined();
        expect(room.current()?.saidNeedsAccount).toBe(true);

        answers.push(() => Promise.resolve({ kind: "reply", text: "Sure.", needsAccount: false }));
        room.sendMessage("And no milk");
        await settle();
        expect(asked[1].saidNeedsAccount).toBe(true);
        expect(get(room.messages)[3].guestKeep).toBeUndefined();
    });

    it("keeps the chat on the device only, and brings it back when the page opens again", async () => {
        const { room, device, answers, settle, deps } = setup();
        answers.push(() => Promise.resolve({ kind: "reply", text: "Second row.", needsAccount: false }));
        room.sendMessage("Where's the coffee?");
        await settle();
        expect(device.saved).not.toBeNull();
        const saved = JSON.parse(device.saved ?? "{}");
        expect(saved.guestId).toBe(GUEST);
        expect(saved.lines.map((line: { text: string }) => line.text)).toEqual(["Where's the coffee?", "Second row."]);

        device.clock += 5 * 60 * 1000;
        const again = new GuestBrickChatRoom(deps);
        expect(get(again.messages).map((message) => get(message.content).body)).toEqual([
            "Where's the coffee?",
            "Second row.",
        ]);
    });

    it("lets a chat go once it was last touched longer ago than the device keeps one, and starts a new one", async () => {
        const { room, device, answers, settle, said } = setup();
        answers.push(() => Promise.resolve({ kind: "reply", text: "Second row.", needsAccount: false }));
        room.sendMessage("Where's the coffee?");
        await settle();
        const first = room.current()?.startedAt;
        device.clock += HOUR + 1;
        room.refresh();
        expect(said()).toEqual([]);
        expect(device.saved).toBeNull();
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hi!", needsAccount: false }));
        room.sendMessage("Hello again");
        await settle();
        expect(room.current()?.startedAt).toBeGreaterThan(first ?? 0);
        expect(said()).toEqual(["me: Hello again", "brick: Hi!"]);
    });

    it("does not read a chat that was kept for another guest, and takes it off the device", () => {
        const first = setup();
        first.answers.push(() => Promise.resolve({ kind: "reply", text: "x", needsAccount: false }));
        first.room.sendMessage("mine");
        const other = setup({
            guestId: () => "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab",
            readSaved: () => first.device.saved,
            drop: first.deps.drop,
        });
        expect(get(other.room.messages)).toEqual([]);
        expect(first.device.saved).toBeNull();
    });

    it.each(["guest", "universe"] as const)(
        "tells a guest who reached the %s allowance, with the fixed card and no reply",
        async (limit) => {
            const { room, answers, said, settle } = setup();
            answers.push(() => Promise.resolve({ kind: "limit", limit, resetsAt: "2026-11-12T20:00:00.000Z" }));
            room.sendMessage("One more thing");
            await settle();
            const [mine, note] = get(room.messages);
            expect(mine.isMyMessage).toBe(true);
            expect(note.replyLimit).toEqual({
                limit: limit === "guest" ? "guest" : "guests",
                resetsAt: "2026-11-12T20:00:00.000Z",
                who: "guest",
                botId: "guest-brick",
                botName: "Brick",
            });
            // The card is the game's own: the Brick says no words of its own, and the limit is never part of the chat
            expect(said()).toEqual(["me: One more thing", "brick: "]);
            expect(room.current()?.lines).toHaveLength(1);
        }
    );

    it.each([
        ["the AI failed", () => Promise.resolve({ kind: "failed" })],
        ["the bot server was busy", () => Promise.resolve({ kind: "busy" })],
        ["nothing answered", () => Promise.reject(new Error("offline"))],
        ["it answered with something else", () => Promise.resolve({ nonsense: true })],
    ])("says it could not answer when %s, and never makes up an answer", async (_why, answer) => {
        const { room, answers, said, settle } = setup();
        answers.push(answer);
        room.sendMessage("Hello?");
        await settle();
        expect(said()).toEqual(["me: Hello?", "brick: I couldn't answer that one. Send it again in a moment."]);
        // Nothing the Brick did not say is kept: the line is the game's, so the next try reads the chat without it
        expect(room.current()?.lines).toHaveLength(1);
    });

    it("takes the game's note away when the guest writes again, and asks again for the same words", async () => {
        const { room, asked, answers, said, settle } = setup();
        answers.push(() => Promise.resolve({ kind: "failed" }));
        answers.push(() => Promise.resolve({ kind: "reply", text: "Here you go.", needsAccount: false }));
        room.sendMessage("Hello?");
        await settle();
        room.sendMessage("Hello?");
        await settle();
        expect(said()).toEqual(["me: Hello?", "me: Hello?", "brick: Here you go."]);
        expect(asked.map((request) => request.turnId)).toEqual(["turn-1", "turn-2"]);
    });

    it("drops the game's note of an earlier turn when a later queued turn gets its answer", async () => {
        const { room, answers, said, settle } = setup();
        answers.push(() => Promise.resolve({ kind: "failed" }));
        answers.push(() => Promise.resolve({ kind: "reply", text: "Here you go.", needsAccount: false }));
        room.sendMessage("first");
        room.sendMessage("second");
        await settle();
        // The failure note of the first is gone once the second is answered
        expect(said()).toEqual(["me: first", "me: second", "brick: Here you go."]);
    });

    it("cannot answer without a guest id or a place, and asks nobody then", async () => {
        const noGuest = setup({ guestId: () => null });
        noGuest.room.sendMessage("hi");
        await noGuest.settle();
        expect(noGuest.asked).toEqual([]);
        expect(noGuest.said()).toEqual(["me: hi", "brick: I couldn't answer that one. Send it again in a moment."]);
        // And what it holds is not kept: there is no guest to keep it for
        expect(noGuest.device.saved).toBeNull();

        const noPlace = setup({ roomUrl: () => null });
        noPlace.room.sendMessage("hi");
        await noPlace.settle();
        expect(noPlace.asked).toEqual([]);
    });

    it("has nothing unread or older to load", async () => {
        const { room } = setup();
        await expect(room.loadMorePreviousMessages()).resolves.toBeUndefined();
        expect(get(room.hasUnreadMessages)).toBe(false);
        expect(get(room.unreadNotificationCount)).toBe(0);
        expect(get(room.hasPreviousMessage)).toBe(false);
    });

    it("draws each message with nothing to react to, reply to, edit or delete: nothing was sent anywhere", async () => {
        const { room, answers, settle } = setup();
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hi", needsAccount: false }));
        room.sendMessage("hello");
        await settle();
        for (const message of get(room.messages)) {
            expect(message.local).toBe(true);
            expect(get(message.canReact)).toBe(false);
            expect(get(message.canReply)).toBe(false);
            expect(get(message.canDelete)).toBe(false);
        }
        const [mine, brick] = get(room.messages);
        expect(mine.sender).toBeUndefined();
        expect(brick.sender?.username).toBe("Brick");
        expect(brick.sender?.chatId).toBe("guest-brick");
    });
});

describe("pictures, files and voice notes to the Brick for guests (plan v3)", () => {
    beforeAll(() => {
        loadLocale("en-US");
    });
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    const uploaded = (name: string, type = "image/png") => ({
        location: `https://cdn.test/${name}`,
        name,
        type,
        size: 3,
        receipt: `receipt-of-${name}`,
    });
    const files = (...names: string[]) =>
        names.map((name) => new File(["abc"], name, { type: "image/png" })) as unknown as FileList;
    const withMedia = (over: Partial<GuestBrickDeps> = {}) =>
        setup({
            upload: vi.fn((file: File) => Promise.resolve(uploaded(file.name, file.type))),
            refreshReceipt: vi.fn((receipt: string) =>
                Promise.resolve({
                    receipt: `${receipt}-fresh`,
                    location: "https://cdn.test/fresh",
                })
            ),
            delivered: vi.fn(() => Promise.resolve()),
            takes: vi.fn(() => Promise.resolve({ files: true, notes: true })),
            sleep: () => Promise.resolve(),
            ...over,
        });

    it("says what it takes, for the paperclip and the mic", async () => {
        const { room, settle } = withMedia();
        await settle();
        expect(get(room.takes)).toEqual({ files: true, notes: true });
        const old = setup();
        await old.settle();
        expect(get(old.room.takes)).toEqual({ files: false, notes: false });
    });

    it("sends files and the words typed with them as one message, by their receipts, and draws them as every chat does", async () => {
        const { room, asked, answers, settle, device } = withMedia();
        answers.push(() => Promise.resolve({ kind: "reply", text: "That is the lunch menu.", needsAccount: false }));
        const sending = room.sendFiles(files("menu.png", "door.png"));
        room.sendMessage("What is this?");
        await sending;
        await settle();
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({
            message: "What is this?",
            files: ["receipt-of-menu.png", "receipt-of-door.png"],
            turnId: "turn-1",
        });
        const drawn = get(room.messages);
        expect(drawn.map((message) => message.type)).toEqual(["gallery", "text", "text"]);
        expect(get(drawn[0].content).urls).toEqual(["https://cdn.test/menu.png", "https://cdn.test/door.png"]);
        expect(get(drawn[1].content).body).toBe("What is this?");
        // Kept on the device with a version, so it loads again; a game from before still reads the line's words
        const saved = JSON.parse(device.saved ?? "{}");
        expect(saved.v).toBe(2);
        expect(saved.lines[0].media).toHaveLength(2);
    });

    it("sends a picture with no words; a later message reads it as words, never as a file again", async () => {
        const { room, asked, answers, settle } = withMedia();
        answers.push(() => Promise.resolve({ kind: "reply", text: "A cat.", needsAccount: false }));
        answers.push(() => Promise.resolve({ kind: "reply", text: "Yes.", needsAccount: false }));
        await room.sendFiles(files("cat.png"));
        await settle();
        expect(asked[0]).toMatchObject({ message: "", files: ["receipt-of-cat.png"] });
        expect(get(room.messages).map((message) => message.type)).toEqual(["image", "text"]);
        room.sendMessage("Cute?");
        await settle();
        expect(asked[1].files).toBeUndefined();
        expect(asked[1].history).toEqual([
            { from: "guest", text: "(sent a picture: cat.png)" },
            { from: "brick", text: "A cat." },
        ]);
    });

    it("says nothing of an upload that finishes after the guest changed: not the files, the words typed with them, or a note", async () => {
        let guest = GUEST;
        const waiting: Array<() => void> = [];
        const upload = vi.fn(
            (file: File) =>
                new Promise<ReturnType<typeof uploaded>>((resolve) => {
                    waiting.push(() => resolve(uploaded(file.name, file.type)));
                })
        );
        const { room, asked, settle, device } = withMedia({ upload, guestId: () => guest });
        const sending = room.sendFiles(files("menu.png"));
        room.sendMessage("What is this?");
        const noting = room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
            duration: 2,
            waveform: [0.5],
        });
        // Signed out, and someone else is the guest on this device now
        guest = "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab";
        room.refresh();
        waiting.forEach((finish) => finish());
        await sending;
        await noting;
        await settle();
        expect(asked).toEqual([]);
        expect(get(room.messages)).toEqual([]);
        expect(device.saved).toBeNull();
    });

    it("sends the new guest's words on their own while the old guest's files are still going up", async () => {
        let guest = GUEST;
        const waiting: Array<() => void> = [];
        const upload = vi.fn(
            (file: File) =>
                new Promise<ReturnType<typeof uploaded>>((resolve) => {
                    waiting.push(() => resolve(uploaded(file.name, file.type)));
                })
        );
        const { room, asked, answers, settle } = withMedia({ upload, guestId: () => guest });
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hi.", needsAccount: false }));
        const sending = room.sendFiles(files("menu.png"));
        room.sendMessage("Old words");
        // Signed out, and someone else is the guest on this device now: they write before the old files are up
        guest = "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab";
        room.refresh();
        room.sendMessage("Hello there");
        await settle();
        expect(asked).toHaveLength(1);
        expect(asked[0].message).toBe("Hello there");
        expect(asked[0].files).toBeUndefined();
        waiting.forEach((finish) => finish());
        await sending;
        await settle();
        expect(asked).toHaveLength(1);
        expect(JSON.stringify(get(room.messages))).not.toContain("Old words");
        expect(JSON.stringify(get(room.messages))).not.toContain("menu.png");
    });

    it("never writes a new guest's words into the chat the last guest had, even when it was not looked at again", async () => {
        let guest = GUEST;
        const { room, asked, answers, settle, device } = withMedia({ guestId: () => guest });
        answers.push(() => Promise.resolve({ kind: "reply", text: "Welcome back.", needsAccount: false }));
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hello.", needsAccount: false }));
        room.sendMessage("My secret plan");
        await settle();
        expect(asked).toHaveLength(1);
        // Signed out, and someone else is the guest on this device now: they write before the chat is looked at again
        guest = "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab";
        room.sendMessage("Hi");
        await settle();
        expect(asked).toHaveLength(2);
        expect(asked[1].message).toBe("Hi");
        expect(asked[1].history).toEqual([]);
        expect(JSON.stringify(get(room.messages))).not.toContain("My secret plan");
        expect(device.saved ?? "").not.toContain("My secret plan");
    });

    it("sends the new guest's words on their own even when the chat was not looked at again", async () => {
        let guest = GUEST;
        const waiting: Array<() => void> = [];
        const upload = vi.fn(
            (file: File) =>
                new Promise<ReturnType<typeof uploaded>>((resolve) => {
                    waiting.push(() => resolve(uploaded(file.name, file.type)));
                })
        );
        const { room, asked, answers, settle } = withMedia({ upload, guestId: () => guest });
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hi.", needsAccount: false }));
        const sending = room.sendFiles(files("menu.png"));
        guest = "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab";
        room.sendMessage("Hello there");
        await settle();
        expect(asked).toHaveLength(1);
        expect(asked[0].message).toBe("Hello there");
        waiting.forEach((finish) => finish());
        await sending;
        await settle();
        expect(asked).toHaveLength(1);
    });

    it("keeps the files to try again when an upload fails, and the words still go", async () => {
        const upload = vi.fn((file: File) =>
            file.name === "bad.png" ? Promise.reject(new Error("too big")) : Promise.resolve(uploaded(file.name))
        );
        const { room, asked, answers, settle } = withMedia({ upload });
        answers.push(() => Promise.resolve({ kind: "reply", text: "Hi.", needsAccount: false }));
        const sending = room.sendFiles(files("ok.png", "bad.png"));
        room.sendMessage("Look");
        await expect(sending).rejects.toThrow("too big");
        await settle();
        expect(asked).toHaveLength(1);
        expect(asked[0].files).toBeUndefined();
        expect(asked[0].message).toBe("Look");
    });

    it("hears a voice note: Listening… while it is heard, then the words in its bubble, and the device says it has the answer", async () => {
        const { room, asked, answers, settle, deps } = withMedia();
        let release: (value: unknown) => void = () => undefined;
        answers.push(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
            duration: 4,
            waveform: [0.2, 1],
        });
        await settle();
        expect(asked[0]).toMatchObject({ note: "receipt-of-voice message.oga", message: "" });
        const note = () => get(room.messages).find((message) => message.type === "audio");
        expect(get(note()!.content)).toMatchObject({
            isVoice: true,
            voiceDuration: 4,
            transcript: { state: "listening" },
        });
        // The chat draws a message once by its id and keeps reading the content it was given: that content changes
        const drawn = note()!;
        release({
            kind: "reply",
            text: "The coffee is upstairs.",
            needsAccount: false,
            heard: "where is the coffee",
            delivery: "d-1",
        });
        await settle();
        expect(note()).toBe(drawn);
        expect(get(drawn.content).transcript).toEqual({ state: "heard", text: "where is the coffee" });
        expect(deps.delivered).toHaveBeenCalledWith("d-1");
        expect(get(room.messages).at(-1) && get(get(room.messages).at(-1)!.content).body).toBe(
            "The coffee is upstairs."
        );
    });

    it("asks a note once more with the same turn when the connection drops, and gets the kept answer", async () => {
        const { room, asked, answers, settle } = withMedia();
        answers.push(() => Promise.reject(new Error("network")));
        answers.push(() =>
            Promise.resolve({ kind: "reply", text: "Upstairs.", needsAccount: false, heard: "coffee?" })
        );
        await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
            duration: 2,
            waveform: [],
        });
        await settle();
        await settle();
        expect(asked).toHaveLength(2);
        expect(asked[0].turnId).toBe(asked[1].turnId);
        expect(get(get(room.messages).at(-1)!.content).body).toBe("Upstairs.");
    });

    it("keeps waiting while the first ask of a note is still running after the connection dropped, with one sent note", async () => {
        const sleep = vi.fn((_ms: number) => Promise.resolve());
        const { room, asked, answers, settle } = withMedia({ sleep });
        answers.push(() => Promise.reject(new Error("network")));
        answers.push(() => Promise.resolve({ kind: "busy" }));
        answers.push(() => Promise.resolve({ kind: "busy" }));
        answers.push(() =>
            Promise.resolve({ kind: "reply", text: "Upstairs.", needsAccount: false, heard: "coffee?" })
        );
        await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
            duration: 2,
            waveform: [],
        });
        await settle();
        await settle();
        await settle();
        await settle();
        expect(asked).toHaveLength(4);
        expect(new Set(asked.map((one) => one.turnId)).size).toBe(1);
        // A little longer each time: 1 s after the lost connection, then 1 s and 2 s while busy
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 2000]);
        const drawn = get(room.messages);
        expect(drawn.filter((message) => message.type === "audio")).toHaveLength(1);
        expect(get(drawn.at(-1)!.content).body).toBe("Upstairs.");
        expect(drawn.map((message) => get(message.content).body)).not.toContain(
            "Couldn't listen to this note. Type it instead."
        );
    });

    it("keeps asking for a kept answer while the note can't be read just now, after the connection dropped", async () => {
        const sleep = vi.fn((_ms: number) => Promise.resolve());
        const { room, asked, answers, settle } = withMedia({ sleep });
        answers.push(() => Promise.reject(new Error("network")));
        // The uploader is down for a moment: the bot server can't read the note again, while Orbit still keeps its answer
        answers.push(() => Promise.resolve({ kind: "unheard", why: "busy" }));
        answers.push(() =>
            Promise.resolve({ kind: "reply", text: "Upstairs.", needsAccount: false, heard: "coffee?" })
        );
        await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
            duration: 2,
            waveform: [],
        });
        await settle();
        await settle();
        await settle();
        expect(asked).toHaveLength(3);
        expect(new Set(asked.map((one) => one.turnId)).size).toBe(1);
        expect(get(get(room.messages).at(-1)!.content).body).toBe("Upstairs.");
    });

    it.each([
        [{ kind: "unheard", why: "too-long", longestSeconds: 300 }, "This note is over 5 minutes. Send a shorter one."],
        [{ kind: "unheard", why: "uncertain" }, "Couldn't finish this one. Send it again."],
        [{ kind: "unheard", why: "expired" }, "This answer is no longer available. Send it again."],
    ])(
        "says in plain words why a note got no answer, and its bubble does not say it was not heard (%o)",
        async (answer, words) => {
            const { room, answers, settle } = withMedia();
            answers.push(() => Promise.resolve(answer));
            await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
                duration: 2,
                waveform: [],
            });
            await settle();
            const drawn = get(room.messages);
            expect(get(drawn.at(-1)!.content).body).toBe(words);
            expect(get(drawn.find((message) => message.type === "audio")!.content).transcript).toBeUndefined();
        }
    );

    it.each([[{ kind: "unheard", why: "failed" }], [{ kind: "unheard", why: "busy" }]])(
        "says a note was not heard in its own bubble, once (%o)",
        async (answer) => {
            const { room, answers, settle } = withMedia();
            answers.push(() => Promise.resolve(answer));
            await room.sendVoiceNote(new File(["ogg"], "voice message.oga", { type: "audio/ogg" }), {
                duration: 2,
                waveform: [],
            });
            await settle();
            const drawn = get(room.messages);
            expect(drawn).toHaveLength(1);
            expect(get(drawn[0].content).transcript).toEqual({ state: "failed", text: undefined });
        }
    );

    it("renews a receipt that ran out and sends the same message again, once", async () => {
        const { room, asked, answers, settle, deps } = withMedia();
        answers.push(() => Promise.resolve({ kind: "upload", why: "expired" }));
        answers.push(() => Promise.resolve({ kind: "reply", text: "Got it.", needsAccount: false }));
        await room.sendFiles(files("menu.png"));
        await settle();
        await settle();
        expect(deps.refreshReceipt).toHaveBeenCalledWith("receipt-of-menu.png");
        expect(asked).toHaveLength(2);
        expect(asked[1]).toMatchObject({ turnId: asked[0].turnId, files: ["receipt-of-menu.png-fresh"] });
        expect(get(get(room.messages).at(-1)!.content).body).toBe("Got it.");
    });

    it("says a file is gone when the bot server can't read it", async () => {
        const { room, answers, settle } = withMedia();
        answers.push(() => Promise.resolve({ kind: "upload", why: "refused" }));
        await room.sendFiles(files("menu.png"));
        await settle();
        expect(get(get(room.messages).at(-1)!.content).body).toBe("This file is gone. Send it again.");
    });
});
