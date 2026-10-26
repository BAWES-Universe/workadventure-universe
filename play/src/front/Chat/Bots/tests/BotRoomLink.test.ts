import { describe, expect, it } from "vitest";
import { readBotRoomLink } from "../BotRoomLink";

const BOT_CHAT_ID = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.bawes.net";
const GAME = "https://play.example";
const LINK = { url: "https://play.example/@/bawes/hq/lobby", room: "Lobby", world: "BAWES HQ", universe: "BAWES" };
const reply = (link: unknown) => ({ msgtype: "m.text", body: "I live in the Lobby.", "universe.room_link": link });

describe("readBotRoomLink", () => {
    it("reads the room a bot's reply names", () => {
        expect(readBotRoomLink(BOT_CHAT_ID, reply(LINK), GAME)).toEqual(LINK);
    });

    it("ignores a link sent by a person, or on anything but a text reply", () => {
        expect(readBotRoomLink("@alice:matrix.bawes.net", reply(LINK), GAME)).toBeUndefined();
        expect(readBotRoomLink(BOT_CHAT_ID, { ...reply(LINK), msgtype: "m.notice" }, GAME)).toBeUndefined();
        expect(readBotRoomLink(BOT_CHAT_ID, { msgtype: "m.text", body: "hi" }, GAME)).toBeUndefined();
    });

    it("ignores a link that would leave this game or isn't a room", () => {
        expect(
            readBotRoomLink(BOT_CHAT_ID, reply({ ...LINK, url: "https://evil.example/@/bawes/hq/lobby" }), GAME)
        ).toBeUndefined();
        expect(
            readBotRoomLink(BOT_CHAT_ID, reply({ ...LINK, url: "https://play.example/admin" }), GAME)
        ).toBeUndefined();
        expect(readBotRoomLink(BOT_CHAT_ID, reply({ ...LINK, url: "javascript:alert(1)" }), GAME)).toBeUndefined();
        expect(readBotRoomLink(BOT_CHAT_ID, reply({ ...LINK, room: " " }), GAME)).toBeUndefined();
    });

    it("keeps a missing world or universe as empty, as from an older bot server", () => {
        expect(readBotRoomLink(BOT_CHAT_ID, reply({ url: LINK.url, room: "Lobby" }), GAME)).toEqual({
            ...LINK,
            world: "",
            universe: "",
        });
    });
});
