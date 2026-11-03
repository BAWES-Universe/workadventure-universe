import { describe, expect, it } from "vitest";
import { isVoiceBotUser, voiceBotCount } from "../TwoVoiceBots";

const person = (id: string) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [] as string[] });
const voiceBot = (id: string) => ({ spaceUserId: id, uuid: `bot-${id}`, tags: ["bot", "voice-bot"] });
const textBot = (id: string) => ({ spaceUserId: id, uuid: `bot-${id}`, tags: ["bot"] });

describe("two voice bots in one bubble (#1670)", () => {
    it("knows a voice bot by the bot tag together with the voice bot tag", () => {
        expect(isVoiceBotUser(voiceBot("a"))).toBe(true);
        expect(isVoiceBotUser(textBot("a"))).toBe(false);
        expect(isVoiceBotUser(person("a"))).toBe(false);
        // A person cannot pass for one with the tag alone
        expect(isVoiceBotUser({ spaceUserId: "x", uuid: "uuid-x", tags: ["voice-bot"] })).toBe(false);
        // The uuid a bot's token gives it counts as a bot, as everywhere else
        expect(isVoiceBotUser({ spaceUserId: "x", uuid: "bot-x", tags: ["voice-bot"] })).toBe(true);
    });

    it("counts the voice bots in a space, not people, text bots or the one who asks", () => {
        const users = [person("me"), person("sara"), voiceBot("a"), textBot("b"), voiceBot("c")];
        expect(voiceBotCount(users, "me")).toBe(2);
        expect(voiceBotCount(users, "me", "c")).toBe(1);
        expect(voiceBotCount([person("me"), voiceBot("a")], "me")).toBe(1);
        expect(voiceBotCount([], "me")).toBe(0);
    });
});
