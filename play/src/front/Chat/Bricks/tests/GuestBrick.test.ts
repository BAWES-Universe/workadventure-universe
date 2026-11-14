import { beforeAll, describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { readGuestChat, type GuestChatLine } from "../Brick";
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
    carriedPart,
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

    it("brings along what was said and when, each line named, and nothing else", () => {
        let chat = newGuestChat(GUEST, 1);
        chat = withLine(chat, { from: "guest", text: "hi", at: 2 });
        chat = withLine(chat, { from: "brick", text: "Sign in.", at: 3, needsAccount: true });
        expect(carriedPart(chat, 0)).toEqual({
            from: 0,
            to: 2,
            last: true,
            lines: [
                { id: "1.0", from: "guest", text: "hi", at: 2 },
                { id: "1.1", from: "brick", text: "Sign in.", at: 3 },
            ],
        });
    });

    it("brings a long chat in parts, every line in order and none left behind, each part within one message", () => {
        let chat = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 300; at++) chat = withLine(chat, { from: "guest", text: `line ${at}`, at });
        const first = carriedPart(chat, 0);
        expect(first).toMatchObject({ from: 0, last: false });
        expect(first.lines.length).toBeLessThanOrEqual(CARRIED_LINES_MAX);
        const all = [first];
        while (!all[all.length - 1].last) all.push(carriedPart(chat, all[all.length - 1].to));
        expect(all.flatMap((part) => part.lines).map((line) => line.at)).toEqual(
            Array.from({ length: 300 }, (_, i) => i + 1)
        );
        // The same chat and start make the same part: a part asked again is the same part
        expect(carriedPart(chat, first.to)).toEqual(all[1]);

        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 40; at++) long = withLine(long, { from: "brick", text: "é".repeat(5000), at });
        const parts = [];
        for (let from = 0; from < long.lines.length; ) {
            const part = carriedPart(long, from);
            parts.push(part);
            from = part.to;
        }
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.flatMap((part) => part.lines).map((line) => line.at)).toEqual(
            Array.from({ length: 40 }, (_, i) => i + 1)
        );
        for (const part of parts) {
            expect(part.lines.every((line) => line.text.length === CARRIED_LINE_CHARS)).toBe(true);
            const bytes = part.lines.reduce(
                (all, line) => all + 2 * new TextEncoder().encode(JSON.stringify(line)).length,
                0
            );
            expect(bytes).toBeLessThanOrEqual(CARRIED_BYTES_MAX);
        }
    });

    it("counts a line the way the bot server does, and cuts a line that alone would not fit rather than leave it behind", () => {
        let slashes = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 10; at++) slashes = withLine(slashes, { from: "guest", text: "\\".repeat(2000), at });
        // Escaped and sent twice, a line takes about 8,000 of the 20,000: two fit in a part
        expect(carriedPart(slashes, 0)).toMatchObject({ from: 0, to: 2 });

        let wide = newGuestChat(GUEST, 1);
        wide = withLine(wide, { from: "guest", text: "\u0001".repeat(2000), at: 1 });
        wide = withLine(wide, { from: "guest", text: "\u0001".repeat(2000), at: 2 });
        const part = carriedPart(wide, 0);
        expect(part.lines).toHaveLength(1);
        expect(2 * new TextEncoder().encode(JSON.stringify(part.lines[0])).length).toBeLessThanOrEqual(
            CARRIED_BYTES_MAX
        );
        expect(part.lines[0].text.length).toBeGreaterThan(0);
    });

    it("keeps a line of many items with long names within one message, written as the bot server keeps them", () => {
        // As the bot server measures a line: twice, JSON-escaped, receipts left out, and 400 for each item's copy
        const serverBytes = (line: GuestChatLine) =>
            2 *
                new TextEncoder().encode(
                    JSON.stringify({ ...line, media: line.media?.map(({ receipt: _receipt, ...rest }) => rest) })
                ).length +
            (line.media?.length ?? 0) * 400;
        let chat = newGuestChat(GUEST, 1);
        chat = withLine(chat, {
            from: "guest",
            text: "",
            at: 2,
            media: Array.from({ length: 12 }, (_, n) => ({
                kind: "file" as const,
                name: `${"é".repeat(600)}${n}`,
                type: "x".repeat(600),
                url: `https://up.test/upload-file/${n}`,
                receipt: `r.${n}`,
            })),
        });
        chat = withLine(chat, { from: "brick", text: "Got them.", at: 3 });
        chat = withLine(chat, {
            from: "guest",
            text: "",
            at: 4,
            media: [{ kind: "note", name: "  ", type: "", url: "https://up.test/upload-file/n", receipt: "r.n" }],
        });
        const first = carriedPart(chat, 0);
        // The line goes, and so does every line after it
        expect(first.lines.length).toBeGreaterThan(0);
        expect(serverBytes(first.lines[0])).toBeLessThanOrEqual(CARRIED_BYTES_MAX);
        expect(first.lines[0].media!.length).toBeLessThanOrEqual(10);
        const all = [first];
        while (!all[all.length - 1].last) all.push(carriedPart(chat, all[all.length - 1].to));
        expect(all.flatMap((part) => part.lines).map((line) => line.at)).toEqual([2, 3, 4]);
        for (const part of all)
            expect(part.lines.reduce((sum, line) => sum + serverBytes(line), 0)).toBeLessThanOrEqual(CARRIED_BYTES_MAX);
        // A blank name and type are counted as the bot server writes them
        expect(all.flatMap((part) => part.lines).at(-1)!.media![0]).toMatchObject({
            name: "voice message",
            type: "application/octet-stream",
        });
    });

    it("holds a part already on its way to the lines it was sent with", () => {
        let chat = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 3; at++) chat = withLine(chat, { from: "guest", text: `line ${at}`, at });
        expect(carriedPart(chat, 0, 2)).toMatchObject({ from: 0, to: 2, last: false });
    });

    it("brings along a guest's pictures and notes with their receipts, never their links, and at most 20 in a part", () => {
        let chat = newGuestChat(GUEST, 1);
        chat = withLine(chat, {
            from: "guest",
            text: "(sent a picture: cat.png)",
            at: 2,
            label: true,
            media: [
                {
                    kind: "file",
                    name: "cat.png",
                    type: "image/png",
                    url: "https://up.test/upload-file/a",
                    receipt: "r.a",
                    size: 10,
                },
            ],
        });
        chat = withLine(chat, {
            from: "guest",
            text: "",
            at: 3,
            media: [
                {
                    kind: "note",
                    name: "note.ogg",
                    type: "audio/ogg",
                    url: "https://up.test/upload-file/b",
                    receipt: "r.b",
                    duration: 4,
                    heard: "where is the coffee",
                },
            ],
        });
        expect(carriedPart(chat, 0).lines).toEqual([
            {
                id: "1.0",
                from: "guest",
                text: "(sent a picture: cat.png)",
                at: 2,
                label: true,
                media: [{ kind: "file", name: "cat.png", type: "image/png", size: 10, receipt: "r.a" }],
            },
            {
                id: "1.1",
                from: "guest",
                text: "",
                at: 3,
                media: [
                    {
                        kind: "note",
                        name: "note.ogg",
                        type: "audio/ogg",
                        duration: 4,
                        heard: "where is the coffee",
                        receipt: "r.b",
                    },
                ],
            },
        ]);

        let many = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 25; at++)
            many = withLine(many, {
                from: "guest",
                text: "",
                at,
                media: [
                    {
                        kind: "file",
                        name: `p${at}.png`,
                        type: "image/png",
                        url: "https://up.test/x",
                        receipt: `r${at}`,
                    },
                ],
            });
        const first = carriedPart(many, 0);
        expect(first).toMatchObject({ to: 20, last: false });
        expect(carriedPart(many, 20)).toMatchObject({ to: 25, last: true });
        // Links never go along: the bot server copies each by its receipt
        expect(JSON.stringify(first)).not.toContain("up.test");
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

    it("reads a guest's pictures and notes as copied links or as gone, never anything else", () => {
        const content = {
            msgtype: "m.text",
            "universe.guest_chat": [
                {
                    from: "guest",
                    text: "(sent a picture: cat.png)",
                    at: 1,
                    label: true,
                    media: [
                        { kind: "file", name: "cat.png", type: "image/png", url: "https://media.test/cat.png" },
                        { kind: "file", name: "old.pdf", type: "application/pdf", gone: true },
                        { kind: "file", name: "x", type: "image/png", url: "javascript:alert(1)" },
                        { kind: "other", name: "y", type: "image/png", url: "https://media.test/y" },
                    ],
                },
                {
                    from: "brick",
                    text: "",
                    at: 2,
                    media: [{ kind: "file", name: "z", type: "image/png", url: "https://a.test/z" }],
                },
            ],
        };
        expect(readGuestChat(BOT, content)).toEqual([
            {
                from: "guest",
                text: "(sent a picture: cat.png)",
                at: 1,
                label: true,
                media: [
                    { kind: "file", name: "cat.png", type: "image/png", url: "https://media.test/cat.png" },
                    { kind: "file", name: "old.pdf", type: "application/pdf", gone: true },
                ],
            },
        ]);
    });
});
