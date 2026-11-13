import { beforeAll, describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { readGuestChat } from "../Brick";
import {
    GUEST_BRICK_ID,
    GUEST_KEEP_CARD,
    GUEST_STARTERS_CARD,
    REQUEST_LINES_MAX,
    REQUEST_LINE_CHARS,
    REQUEST_MESSAGE_CHARS,
    requestMessage,
    CARRIED_BYTES_MAX,
    CARRIED_LINES_MAX,
    CARRIED_LINE_CHARS,
    carriedLines,
    guestBrickCard,
    guestKeepCard,
    guestStarterWords,
    guestStartersCard,
    historyExcept,
    isGuestId,
    newGuestChat,
    parseGuestAnswer,
    parseGuestChat,
    serializeGuestChat,
    withLine,
} from "../GuestBrick";

const GUEST = "4f1d2c3b-aaaa-4bbb-8ccc-0123456789ab";
const HOUR = 60 * 60 * 1000;

describe("the Brick for guests: the chat a guest's device keeps (#1997)", () => {
    beforeAll(() => {
        loadLocale("en-US");
    });

    it("knows a guest's id from an account's: a guest is a uuid, an account is an email or another id", () => {
        expect(isGuestId(GUEST)).toBe(true);
        for (const other of ["khalid@bawes.net", "12345", "", undefined, null, 7]) expect(isGuestId(other)).toBe(false);
    });

    it("keeps a chat and reads it back as it was saved, for the same guest", () => {
        let chat = newGuestChat(GUEST, 1000);
        chat = withLine(chat, { from: "guest", text: "Where's the coffee?", at: 2000 });
        chat = withLine(chat, { from: "brick", text: "Second row.", at: 3000 });
        const read = parseGuestChat(serializeGuestChat(chat), GUEST, 4000, HOUR);
        expect(read).toEqual({ ...chat, savedAt: 3000 });
        expect(read?.lines.map((line) => line.text)).toEqual(["Where's the coffee?", "Second row."]);
    });

    it("does not give a chat to anyone but the guest it was kept for", () => {
        const chat = withLine(newGuestChat(GUEST, 1), { from: "guest", text: "hi", at: 2 });
        expect(
            parseGuestChat(serializeGuestChat(chat), "9d9d9d9d-aaaa-4bbb-8ccc-0123456789ab", 3, HOUR)
        ).toBeUndefined();
        // Where a person who signed in picks it up, whose guest it was is for Orbit to say
        expect(parseGuestChat(serializeGuestChat(chat), null, 3)?.guestId).toBe(GUEST);
    });

    it("lets a chat go once it was last touched longer ago than the device keeps one", () => {
        const chat = withLine(newGuestChat(GUEST, 1), { from: "guest", text: "hi", at: 1000 });
        const raw = serializeGuestChat(chat);
        expect(parseGuestChat(raw, GUEST, 1000 + HOUR, HOUR)).toBeDefined();
        expect(parseGuestChat(raw, GUEST, 1001 + HOUR, HOUR)).toBeUndefined();
        // Without a limit (after signing in) it is not the device's to age out
        expect(parseGuestChat(raw, GUEST, 1001 + 40 * HOUR)).toBeDefined();
    });

    it("reads nothing from what is not a saved chat, and keeps only the lines that are lines", () => {
        for (const raw of [null, "", "nope", "[]", "null", "{}", JSON.stringify({ guestId: GUEST, lines: [] })]) {
            expect(parseGuestChat(raw, GUEST, 1, HOUR)).toBeUndefined();
        }
        const raw = JSON.stringify({
            guestId: GUEST,
            startedAt: 1,
            savedAt: 5,
            saidNeedsAccount: false,
            lines: [
                { from: "guest", text: "ok", at: 2 },
                { from: "someone", text: "x", at: 3 },
                { from: "brick", text: "  ", at: 4 },
                { from: "brick", text: "fine", at: "late" },
                { from: "guest", text: "needs", at: 5, needsAccount: true },
                { from: "brick", text: "keep", at: 6, needsAccount: true },
            ],
        });
        const read = parseGuestChat(raw, GUEST, 6, HOUR);
        // Only a Brick's own answer can say something needs an account
        expect(read?.lines).toEqual([
            { from: "guest", text: "ok", at: 2 },
            { from: "guest", text: "needs", at: 5 },
            { from: "brick", text: "keep", at: 6, needsAccount: true },
        ]);
    });

    it("remembers that the Brick said something needs an account, once it did", () => {
        let chat = newGuestChat(GUEST, 1);
        chat = withLine(chat, { from: "brick", text: "Sign in for that.", at: 2, needsAccount: true });
        expect(chat.saidNeedsAccount).toBe(true);
        chat = withLine(chat, { from: "brick", text: "More help.", at: 3 });
        expect(chat.saidNeedsAccount).toBe(true);
    });

    it("sends the chat so far without the message being answered or the ones still waiting, and never more than a request can carry", () => {
        const lines = Array.from({ length: REQUEST_LINES_MAX + 20 }, (_, index) => ({
            from: index % 2 ? ("brick" as const) : ("guest" as const),
            text: `line ${index}`,
            at: index + 1,
        }));
        const before = historyExcept(lines, new Set([lines.length - 1]));
        expect(before).toHaveLength(REQUEST_LINES_MAX);
        expect(before[before.length - 1]).toEqual({
            from: lines[lines.length - 2].from,
            text: `line ${lines.length - 2}`,
        });
        // Only who said it and what: when it was said and what it marked stay on the device
        expect(Object.keys(before[0]).sort()).toEqual(["from", "text"]);
        expect(historyExcept(lines.slice(0, 3), new Set([0, 1, 2]))).toEqual([]);
        expect(historyExcept(lines.slice(0, 3), new Set([1]))).toEqual([
            { from: "guest", text: "line 0" },
            { from: "guest", text: "line 2" },
        ]);
    });

    it("keeps a request under what the bot server takes in, however long the chat or the message is", () => {
        const long = "é\n".repeat(20000);
        const lines = Array.from({ length: REQUEST_LINES_MAX }, (_, index) => ({
            from: index % 2 ? ("brick" as const) : ("guest" as const),
            text: `${index} ${long}`,
            at: index + 1,
        }));
        const history = historyExcept(lines, new Set());
        const body = JSON.stringify({ message: requestMessage(long), history });
        expect(new TextEncoder().encode(body).length).toBeLessThan(100 * 1024);
        // The newest lines are the ones kept, each cut
        expect(history.length).toBeGreaterThan(0);
        expect(history[history.length - 1].text.startsWith(`${REQUEST_LINES_MAX - 1} `)).toBe(true);
        expect(history.every((line) => line.text.length <= REQUEST_LINE_CHARS)).toBe(true);
        expect(requestMessage(long)).toHaveLength(REQUEST_MESSAGE_CHARS);
    });

    it("reads an answer as the bot server says it, and anything else as a failure", () => {
        expect(parseGuestAnswer({ kind: "reply", text: " Hi ", needsAccount: true })).toEqual({
            kind: "reply",
            text: "Hi",
            needsAccount: true,
        });
        expect(parseGuestAnswer({ kind: "reply", text: "Hi" })).toEqual({
            kind: "reply",
            text: "Hi",
            needsAccount: false,
        });
        expect(parseGuestAnswer({ kind: "limit", limit: "guest", resetsAt: "2026-11-12T20:00:00Z" })).toEqual({
            kind: "limit",
            limit: "guest",
            resetsAt: "2026-11-12T20:00:00Z",
        });
        expect(parseGuestAnswer({ kind: "limit", limit: "universe", resetsAt: "2026-11-12T20:00:00Z" }).kind).toBe(
            "limit"
        );
        expect(parseGuestAnswer({ kind: "busy" })).toEqual({ kind: "busy" });
        for (const odd of [
            null,
            undefined,
            "reply",
            3,
            {},
            { kind: "reply", text: "  " },
            { kind: "limit", limit: "host", resetsAt: "2026-11-12T20:00:00Z" },
            { kind: "limit", limit: "guest", resetsAt: "soon" },
        ]) {
            expect(parseGuestAnswer(odd)).toEqual({ kind: "failed" });
        }
    });

    it("is Universe's own Brick: one look, one name, never a bot of anyone's", () => {
        const card = guestBrickCard(i18nObject("en-US"), 0);
        expect(card).toMatchObject({
            id: GUEST_BRICK_ID,
            name: "Brick",
            characterTextureId: "brick-orange",
            enabled: true,
            isDefault: false,
        });
        expect(GUEST_BRICK_ID).not.toMatch(/^@/);
    });

    it("offers two ways to start under its hello, and only what it can do for a guest", () => {
        const card = guestStartersCard(i18nObject("en-US"));
        expect(card.id).toBe(GUEST_STARTERS_CARD);
        expect(card.title).toBe("Where shall we start?");
        expect(card.question?.choices).toEqual([
            { id: "place", label: "What is this place?", line: "A quick look around" },
            { id: "brick", label: "What can a Brick do?", line: "And what changes when I'm yours" },
        ]);
        expect(guestStarterWords("place", i18nObject("en-US"))).toBe("What is this place?");
        expect(guestStarterWords("brick", i18nObject("en-US"))).toBe("What can a Brick do?");
        expect(guestStarterWords("make", i18nObject("en-US"))).toBeUndefined();
    });

    it("asks 'Keep Brick?' after an answer that says something needs an account: sign in, or not now", () => {
        const card = guestKeepCard(i18nObject("en-US"));
        expect(card.id).toBe(GUEST_KEEP_CARD);
        expect(card.title).toBe("Keep Brick?");
        expect(card.question?.choices).toEqual([
            { id: "yes", label: "Make Brick mine", line: "Sign in. It's free, and this chat comes along" },
            { id: "no", label: "Not now", line: "I'll still help while you're here" },
        ]);
    });

    it("brings along what was said and when, and nothing else", () => {
        let chat = newGuestChat(GUEST, 1);
        chat = withLine(chat, { from: "guest", text: "hi", at: 2 });
        chat = withLine(chat, { from: "brick", text: "Sign in.", at: 3, needsAccount: true });
        expect(carriedLines(chat)).toEqual([
            { from: "guest", text: "hi", at: 2 },
            { from: "brick", text: "Sign in.", at: 3 },
        ]);
    });

    it("brings along only the newest lines that fit in one message, each cut, so a long chat never makes a message too big", () => {
        let chat = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 300; at++) chat = withLine(chat, { from: "guest", text: `line ${at}`, at });
        const few = carriedLines(chat);
        expect(few).toHaveLength(CARRIED_LINES_MAX);
        expect(few[few.length - 1].at).toBe(300);
        expect(few[0].at).toBe(101);

        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 40; at++) long = withLine(long, { from: "brick", text: "é".repeat(5000), at });
        const cut = carriedLines(long);
        expect(cut.every((line) => line.text.length === CARRIED_LINE_CHARS)).toBe(true);
        expect(cut.reduce((all, line) => all + new TextEncoder().encode(line.text).length, 0)).toBeLessThanOrEqual(
            CARRIED_BYTES_MAX
        );
        expect(cut.length).toBeGreaterThan(0);
        expect(cut[cut.length - 1].at).toBe(40);
    });

    it("counts a line the way the bot server does, so the server never cuts more than the device already did", () => {
        let slashes = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 10; at++) slashes = withLine(slashes, { from: "guest", text: "\\".repeat(2000), at });
        const kept = carriedLines(slashes);
        // Escaped and sent twice, a line takes about 8,000 of the 20,000: two fit, and they are the newest
        expect(kept.map((line) => line.at)).toEqual([9, 10]);
    });
});

describe("the chat a guest brought along, as the Brick's message carries it (#1997)", () => {
    const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test";

    it("is read from a Brick's own plain message only", () => {
        const lines = [
            { from: "guest", text: " Where's the coffee? ", at: 1000 },
            { from: "brick", text: "Second row.", at: 2000 },
        ];
        const content = { msgtype: "m.text", body: "x", "universe.guest_chat": lines };
        expect(readGuestChat(BOT, content)).toEqual([
            { from: "guest", text: "Where's the coffee?", at: 1000 },
            { from: "brick", text: "Second row.", at: 2000 },
        ]);
        // A person cannot put a guest's chat in a message: only a bot's message carries one
        expect(readGuestChat("@omar:chat.test", content)).toEqual([]);
        expect(readGuestChat(BOT, { ...content, msgtype: "m.notice" })).toEqual([]);
    });

    it("keeps only the lines that are lines, and gives a missing time as none", () => {
        const content = {
            msgtype: "m.text",
            "universe.guest_chat": [
                { from: "guest", text: "ok" },
                { from: "x", text: "no" },
                "no",
                null,
                { from: "brick", text: "", at: 5 },
            ],
        };
        expect(readGuestChat(BOT, content)).toEqual([{ from: "guest", text: "ok", at: 0 }]);
        expect(readGuestChat(BOT, { msgtype: "m.text", "universe.guest_chat": "nope" })).toEqual([]);
    });
});
