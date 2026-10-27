import { describe, expect, it } from "vitest";
import { parseBotReplyLimit, readBotReplyLimit, replyLimitCardKind, replyLimitTime } from "../BotReplyLimit";

const BOT_ID = "0b7c1d2e-1111-4222-8333-944455556666";
const BOT_CHAT_ID = `@bot_${BOT_ID}:matrix.bawes.net`;
const LIMIT = { limit: "universe-ai", resetsAt: "2026-10-27T20:20:00.000Z", who: "member" };
const notice = (limit: unknown, msgtype = "m.notice") => ({ msgtype, body: "…", "universe.reply_limit": limit });

describe("readBotReplyLimit", () => {
    it("reads the limit a bot's notice carries, with the bot it is about", () => {
        expect(readBotReplyLimit(BOT_CHAT_ID, notice(LIMIT), "Nora")).toEqual({
            ...LIMIT,
            botId: BOT_ID,
            botName: "Nora",
        });
    });

    it("ignores it from a person, or on anything but a notice", () => {
        expect(readBotReplyLimit("@sara:matrix.bawes.net", notice(LIMIT), "Sara")).toBeUndefined();
        expect(readBotReplyLimit(BOT_CHAT_ID, notice(LIMIT, "m.text"), "Nora")).toBeUndefined();
    });

    it("ignores a limit it does not know, or one without a real time", () => {
        expect(parseBotReplyLimit({ ...LIMIT, limit: "money" }, BOT_ID, "Nora")).toBeUndefined();
        expect(parseBotReplyLimit({ ...LIMIT, who: "stranger" }, BOT_ID, "Nora")).toBeUndefined();
        expect(parseBotReplyLimit({ ...LIMIT, resetsAt: "later" }, BOT_ID, "Nora")).toBeUndefined();
        expect(parseBotReplyLimit(null, BOT_ID, "Nora")).toBeUndefined();
    });
});

describe("replyLimitCardKind", () => {
    it("gives each person the one way out that fits them", () => {
        expect(replyLimitCardKind({ limit: "universe-ai", who: "member" })).toBe("member");
        expect(replyLimitCardKind({ limit: "universe-ai", who: "maker" })).toBe("maker");
        expect(replyLimitCardKind({ limit: "guest", who: "guest" })).toBe("guest");
        // The bot's guests used their shared replies: the guest still gets Sign in
        expect(replyLimitCardKind({ limit: "guests", who: "guest" })).toBe("guest");
    });

    it("offers nothing but the time at the bot's own limit, whoever reached it", () => {
        expect(replyLimitCardKind({ limit: "bot", who: "maker" })).toBe("bot");
        expect(replyLimitCardKind({ limit: "bot", who: "guest" })).toBe("bot");
    });
});

describe("replyLimitTime", () => {
    it("shows the time in the viewer's own clock, with the day when it is not today", () => {
        const now = new Date(2026, 9, 27, 18, 20);
        expect(replyLimitTime(new Date(2026, 9, 27, 23, 20).toISOString(), "en-US", now)).toBe("11:20 PM");
        expect(replyLimitTime(new Date(2026, 9, 28, 9, 5).toISOString(), "en-US", now)).toBe("Wed 9:05 AM");
    });
});
