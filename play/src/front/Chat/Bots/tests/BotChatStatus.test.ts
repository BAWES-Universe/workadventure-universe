import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { botIdFromChatId, readBotStatusNote } from "../BotChatStatus";
import { BotStatusCache } from "../BotStatusCache";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const BOT_CHAT_ID = `@bot_${BOT}:matrix.bawes.net`;

describe("botIdFromChatId", () => {
    it("reads the bot id from a bot's chat ID and nothing else", () => {
        expect(botIdFromChatId(BOT_CHAT_ID)).toBe(BOT);
        expect(botIdFromChatId("@alice:matrix.bawes.net")).toBeUndefined();
        expect(botIdFromChatId("@robot_1:matrix.bawes.net")).toBeUndefined();
        expect(botIdFromChatId(undefined)).toBeUndefined();
    });
});

describe("readBotStatusNote", () => {
    const note = { state: "resting", title: "Resting", text: "The bot's owner turned it off for now." };

    it("reads a bot's status notice", () => {
        expect(readBotStatusNote(BOT_CHAT_ID, { msgtype: "m.notice", body: "x", "universe.bot_status": note })).toEqual(
            note
        );
    });

    it("ignores the same content from a person, as text, or with an unknown state", () => {
        expect(
            readBotStatusNote("@alice:matrix.bawes.net", { msgtype: "m.notice", "universe.bot_status": note })
        ).toBeUndefined();
        expect(readBotStatusNote(BOT_CHAT_ID, { msgtype: "m.text", "universe.bot_status": note })).toBeUndefined();
        expect(
            readBotStatusNote(BOT_CHAT_ID, { msgtype: "m.notice", "universe.bot_status": { ...note, state: "hacked" } })
        ).toBeUndefined();
        expect(readBotStatusNote(BOT_CHAT_ID, { msgtype: "m.notice", body: "plain notice" })).toBeUndefined();
    });
});

describe("BotStatusCache", () => {
    it("asks once for every bot looked at in the same moment, and keeps the answer for a minute", async () => {
        let now = 0;
        const fetchStatus = vi.fn((ids: string[]) =>
            Promise.resolve(Object.fromEntries(ids.map((id) => [id, id === "a" ? "resting" : "online"])))
        );
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const b = cache.store("b");
        const stopA = a.subscribe(() => undefined);
        const stopB = b.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(a)).toBe("resting"));
        expect(get(b)).toBe("online");
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        expect(fetchStatus).toHaveBeenCalledWith(["a", "b"]);

        stopA();
        now = 30_000;
        const again = cache.store("a").subscribe(() => undefined);
        await Promise.resolve();
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        again();

        now = 61_000;
        const later = cache.store("a").subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
        later();
        stopB();
    });

    it("shows nothing for an unknown answer and keeps what it knew when the lookup fails", async () => {
        let now = 0;
        const fetchStatus = vi.fn(
            (): Promise<Record<string, string> | null> => Promise.resolve({ a: "gone", b: "weird" })
        );
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const b = cache.store("b");
        const stop = [a.subscribe(() => undefined), b.subscribe(() => undefined)];
        await vi.waitFor(() => expect(get(a)).toBe("gone"));
        expect(get(b)).toBeUndefined();

        fetchStatus.mockResolvedValueOnce(null);
        now = 61_000;
        stop.push(cache.store("a").subscribe(() => undefined));
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
        expect(get(a)).toBe("gone");
        stop.forEach((s) => s());
    });
});
