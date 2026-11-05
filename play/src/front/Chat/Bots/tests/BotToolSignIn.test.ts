import { describe, expect, it } from "vitest";
import {
    BOT_TOOL_SIGNIN_KEY,
    closeToolSignIn,
    isToolSignInClosed,
    parseBotToolSignIn,
    parseNearbyToolSignIn,
    readBotToolSignIn,
    stillLost,
    toolSignInSince,
} from "../BotToolSignIn";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const lost = { serverId: "srv-1", name: "Tavily", since: "2026-11-05T09:54:00.000Z", kind: "oauth" as const };

describe("a tool sign-in card a bot sends (#1819)", () => {
    it("reads the connections that need signing in again, for that bot", () => {
        expect(parseBotToolSignIn({ lost: [lost] }, BOT, "Tavily Researcher")).toEqual({
            botId: BOT,
            botName: "Tavily Researcher",
            lost: [lost],
        });
    });

    it("reads an empty list as the bot taking the card back", () => {
        expect(parseBotToolSignIn({ lost: [] }, BOT, "Nora")?.lost).toEqual([]);
    });

    it("leaves out a connection with a missing or unknown part, and keeps the rest", () => {
        const card = parseBotToolSignIn(
            {
                lost: [
                    lost,
                    { ...lost, serverId: "" },
                    { ...lost, name: "  " },
                    { ...lost, since: "yesterday" },
                    { ...lost, kind: "magic" },
                    "nope",
                ],
            },
            BOT,
            "Nora"
        );
        expect(card?.lost).toEqual([lost]);
    });

    it("is nothing without a bot, a list, or an object", () => {
        expect(parseBotToolSignIn({ lost: [lost] }, "", "Nora")).toBeUndefined();
        expect(parseBotToolSignIn({}, BOT, "Nora")).toBeUndefined();
        expect(parseBotToolSignIn(null, BOT, "Nora")).toBeUndefined();
        expect(parseBotToolSignIn("lost", BOT, "Nora")).toBeUndefined();
    });

    it("keeps a name that is a person's text short", () => {
        const card = parseBotToolSignIn({ lost: [{ ...lost, name: "x".repeat(500) }] }, BOT, "y".repeat(500));
        expect(card?.lost[0].name).toHaveLength(120);
        expect(card?.botName).toHaveLength(120);
    });

    it("reads a bubble's card from its JSON body, and nothing from a body that is not JSON", () => {
        expect(parseNearbyToolSignIn(JSON.stringify({ lost: [lost] }), BOT, "Nora")?.lost).toEqual([lost]);
        expect(parseNearbyToolSignIn("{not json", BOT, "Nora")).toBeUndefined();
    });
});

describe("the card in a direct message", () => {
    const sender = `@bot_${BOT}:matrix.test`;
    const notice = (extra: Record<string, unknown> = {}) => ({
        msgtype: "m.notice",
        body: "Tavily needs signing in again.",
        [BOT_TOOL_SIGNIN_KEY]: { lost: [lost] },
        ...extra,
    });

    it("is read from the bot's notice", () => {
        expect(readBotToolSignIn(sender, notice(), "Nora")?.lost).toEqual([lost]);
    });

    it("is not read from a person, or from a message that is not a notice", () => {
        expect(readBotToolSignIn("@sara:matrix.test", notice(), "Sara")).toBeUndefined();
        expect(readBotToolSignIn(sender, notice({ msgtype: "m.text" }), "Nora")).toBeUndefined();
    });

    it("is not drawn when it lists nothing", () => {
        expect(readBotToolSignIn(sender, notice({ [BOT_TOOL_SIGNIN_KEY]: { lost: [] } }), "Nora")).toBeUndefined();
    });
});

describe("what Orbit says now", () => {
    it("keeps only the connections Orbit still marks lost, and drops those fixed or removed", () => {
        const two = [
            lost,
            { ...lost, serverId: "srv-2", name: "Attio" },
            { ...lost, serverId: "srv-3", name: "Linear" },
        ];
        const servers = [
            { id: "srv-1", signInLostAt: "2026-11-05T09:54:00.000Z" },
            { id: "srv-2", signInLostAt: null },
        ];
        expect(stillLost(two, servers).map((one) => one.name)).toEqual(["Tavily"]);
    });
});

describe("since when", () => {
    it("is the time today, and the day with it when it is another day", () => {
        const now = new Date("2026-11-05T12:00:00.000Z");
        const today = toolSignInSince("2026-11-05T09:54:00.000Z", "en-US", now);
        const older = toolSignInSince("2026-11-03T09:54:00.000Z", "en-US", now);
        expect(today).toMatch(/\d{1,2}:\d{2}/);
        expect(today).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
        expect(older).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    });
});

describe("closing", () => {
    it("remembers a card the person closed", () => {
        expect(isToolSignInClosed("m-1")).toBe(false);
        closeToolSignIn("m-1");
        expect(isToolSignInClosed("m-1")).toBe(true);
        expect(isToolSignInClosed("m-2")).toBe(false);
    });
});
