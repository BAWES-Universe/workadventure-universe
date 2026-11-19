import { describe, expect, it } from "vitest";
import { holdsKeys, isBotPartner, uploadAvailability } from "../ComposerRules";

describe("holdsKeys", () => {
    it("holds keys in a chat with a Brick that is not on the map (isBot false, bot chat id)", () => {
        expect(holdsKeys({ isBot: false, chatId: "@bot_abc123:matrix.example" }, false)).toBe(true);
    });
    it("holds keys for a bot that is known as one", () => {
        expect(holdsKeys({ isBot: true, chatId: undefined }, false)).toBe(true);
    });
    it("holds keys in the Brick for guests", () => {
        expect(holdsKeys(undefined, true)).toBe(true);
    });
    it("does not hold keys for a person, or for a chat id that only looks alike", () => {
        expect(holdsKeys({ isBot: false, chatId: "@anna:matrix.example" }, false)).toBe(false);
        expect(holdsKeys({ isBot: false, chatId: "@robot_x:matrix.example" }, false)).toBe(false);
        expect(holdsKeys(undefined, false)).toBe(false);
        expect(isBotPartner({ chatId: null })).toBe(false);
    });
});

describe("uploadAvailability", () => {
    it("keeps the mic when voice notes are taken but files are not (text only)", () => {
        expect(uploadAvailability(true, true, true)).toEqual({ files: false, voice: true });
    });
    it("allows both when files are allowed", () => {
        expect(uploadAvailability(false, true, true)).toEqual({ files: true, voice: true });
    });
    it("allows neither when the uploader is not set up or the room does not upload", () => {
        expect(uploadAvailability(false, true, false)).toEqual({ files: false, voice: false });
        expect(uploadAvailability(false, false, true)).toEqual({ files: false, voice: false });
    });
});
