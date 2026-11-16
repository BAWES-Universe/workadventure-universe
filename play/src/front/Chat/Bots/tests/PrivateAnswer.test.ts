import { describe, expect, it } from "vitest";
import { ANSWERED_NEARBY_KEY, continuePrivatelyTapJson, readAnsweredNearby } from "../PrivateAnswer";

const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

describe("an answer from nearby chat, in the bot's direct messages (#1993)", () => {
    it("is the bot's own notice that carries the field", () => {
        expect(
            readAnsweredNearby(BOT, { msgtype: "m.notice", body: "It is at 10.", [ANSWERED_NEARBY_KEY]: true })
        ).toBe(true);
    });

    it("is never a person's message, whatever it carries", () => {
        expect(
            readAnsweredNearby("@sara:matrix.test", { msgtype: "m.notice", body: "x", [ANSWERED_NEARBY_KEY]: true })
        ).toBe(false);
        expect(readAnsweredNearby(undefined, { msgtype: "m.notice", [ANSWERED_NEARBY_KEY]: true })).toBe(false);
        expect(readAnsweredNearby(null, { msgtype: "m.notice", [ANSWERED_NEARBY_KEY]: true })).toBe(false);
    });

    it("is not an ordinary reply of the bot, or a notice without the field, or a field that is not plainly true", () => {
        expect(readAnsweredNearby(BOT, { msgtype: "m.text", body: "x", [ANSWERED_NEARBY_KEY]: true })).toBe(false);
        expect(readAnsweredNearby(BOT, { msgtype: "m.notice", body: "x" })).toBe(false);
        expect(readAnsweredNearby(BOT, { msgtype: "m.notice", body: "x", [ANSWERED_NEARBY_KEY]: "true" })).toBe(false);
        expect(readAnsweredNearby(BOT, { msgtype: "m.notice", body: "x", [ANSWERED_NEARBY_KEY]: 1 })).toBe(false);
    });

    it("tells the bot only that the person carried on, and in which room", () => {
        expect(JSON.parse(continuePrivatelyTapJson("!dm:matrix.test"))).toEqual({
            action: "continue",
            room: "!dm:matrix.test",
        });
    });
});
