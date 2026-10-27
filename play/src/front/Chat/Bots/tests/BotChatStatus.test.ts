import { describe, expect, it } from "vitest";
import {
    availabilityFromNote,
    botChatClosed,
    botHeaderState,
    botIdFromChatId,
    followsPresence,
    readBotStatusNote,
    showsBotDmIntro,
} from "../BotChatStatus";

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

describe("showsBotDmIntro", () => {
    it("opens a direct message with a bot by its chat ID, whether or not the bot is on a map", () => {
        expect(showsBotDmIntro(BOT_CHAT_ID, false, false)).toBe(true);
        expect(showsBotDmIntro("@alice:matrix.bawes.net", false, false)).toBe(false);
        expect(showsBotDmIntro(undefined, false, false)).toBe(false);
    });

    it("waits until nothing older is left to load", () => {
        expect(showsBotDmIntro(BOT_CHAT_ID, true, false)).toBe(false);
        expect(showsBotDmIntro(BOT_CHAT_ID, false, true)).toBe(false);
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

describe("availabilityFromNote", () => {
    it("reads the bot's state from notes about the bot, not from notes about one message or one person", () => {
        expect(availabilityFromNote("resting")).toBe("resting");
        expect(availabilityFromNote("unready")).toBe("unready");
        expect(availabilityFromNote("gone")).toBe("gone");
        expect(availabilityFromNote("trouble")).toBeUndefined();
        expect(availabilityFromNote("no_access")).toBeUndefined();
    });
});

describe("followsPresence", () => {
    it("follows people's presence, never a bot's", () => {
        expect(followsPresence("@alice:matrix.bawes.net")).toBe(true);
        expect(followsPresence(undefined)).toBe(true);
        expect(followsPresence(BOT_CHAT_ID)).toBe(false);
    });
});

describe("botChatClosed", () => {
    it("closes a chat only for a bot the bot server says is gone", () => {
        expect(botChatClosed("gone")).toBe(true);
        // A bot that declined the invite because it rests, or is not ready, or the person had no access: not deleted.
        for (const state of ["online", "resting", "unready", undefined] as const) {
            expect(botChatClosed(state)).toBe(false);
        }
    });
});

describe("botHeaderState", () => {
    it("shows the bot's state, and stays quiet under a 'Can't chat' note unless the bot is gone", () => {
        expect(botHeaderState("online", undefined)).toBe("online");
        expect(botHeaderState("resting", "resting")).toBe("resting");
        expect(botHeaderState("online", "no_access")).toBeUndefined();
        expect(botHeaderState(undefined, "no_access")).toBeUndefined();
        expect(botHeaderState("gone", "no_access")).toBe("gone");
    });
});
