import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { botHomeRoom } from "../BotHomeRoom";

const BOT_ID = "0b7c1d2e-1111-4222-8333-944455556666";
const BOT_CHAT_ID = `@bot_${BOT_ID}:matrix.bawes.net`;
const GAME = "https://play.example";
const LINK = { url: "https://play.example/@/bawes/hq/lobby", room: "Lobby", world: "BAWES HQ", universe: "BAWES" };

async function settle<T>(store: { subscribe: (run: (value: T) => void) => () => void }): Promise<T> {
    let value!: T;
    const stop = store.subscribe((next) => (value = next));
    await Promise.resolve();
    await Promise.resolve();
    stop();
    return value;
}

describe("botHomeRoom", () => {
    it("asks the bot server for a bot's room, by its bot id", async () => {
        const ask = vi.fn(() => Promise.resolve(LINK));
        expect(await settle(botHomeRoom(BOT_CHAT_ID, ask, GAME))).toEqual(LINK);
        expect(ask).toHaveBeenCalledWith(BOT_ID);
    });

    it("asks nothing for a person", () => {
        const ask = vi.fn(() => Promise.resolve(LINK));
        expect(get(botHomeRoom("@alice:matrix.bawes.net", ask, GAME))).toBeUndefined();
        expect(get(botHomeRoom(undefined, ask, GAME))).toBeUndefined();
        expect(ask).not.toHaveBeenCalled();
    });

    it("shows nothing when the bot server says nothing, or names a room off this game", async () => {
        expect(await settle(botHomeRoom(BOT_CHAT_ID, () => Promise.resolve(null), GAME))).toBeUndefined();
        const away = { ...LINK, url: "https://elsewhere.example/@/bawes/hq/lobby" };
        expect(await settle(botHomeRoom(BOT_CHAT_ID, () => Promise.resolve(away), GAME))).toBeUndefined();
        const failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(await settle(botHomeRoom(BOT_CHAT_ID, () => Promise.reject(new Error("down")), GAME))).toBeUndefined();
        failed.mockRestore();
    });

    it("shows the room it said last at once when the profile opens again, and keeps it when there is no answer (#1585)", async () => {
        const botId = "0b7c1d2e-2222-4222-8333-944455556666";
        const chatId = `@bot_${botId}:matrix.bawes.net`;
        await settle(botHomeRoom(chatId, () => Promise.resolve(LINK), GAME));
        const garden = { ...LINK, url: "https://play.example/@/bawes/hq/garden", room: "Garden" };
        const again = botHomeRoom(chatId, () => Promise.resolve(garden), GAME);
        expect(get(again)).toEqual(LINK);
        expect(await settle(again)).toEqual(garden);
        // No answer in time, or the bot server down: the room stays.
        expect(await settle(botHomeRoom(chatId, () => Promise.resolve(undefined), GAME))).toEqual(garden);
        // The bot server saying it has no room is an answer.
        expect(await settle(botHomeRoom(chatId, () => Promise.resolve(null), GAME))).toBeUndefined();
    });
});
