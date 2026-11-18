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

    it("reads an App's connection when the card names one, and drops one that is not text", () => {
        const card = parseBotToolSignIn(
            {
                lost: [
                    { ...lost, connectionId: "conn-1" },
                    { ...lost, serverId: "srv-2", connectionId: 5 },
                ],
            },
            BOT,
            "Nora"
        );
        expect(card?.lost).toEqual([
            { ...lost, connectionId: "conn-1" },
            { ...lost, serverId: "srv-2" },
        ]);
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

    it("comes back empty when the bot takes its card back, so the chat drops the earlier one", () => {
        expect(readBotToolSignIn(sender, notice({ [BOT_TOOL_SIGNIN_KEY]: { lost: [] } }), "Nora")?.lost).toEqual([]);
    });

    it("is nothing when the list has entries that cannot be read", () => {
        expect(readBotToolSignIn(sender, notice({ [BOT_TOOL_SIGNIN_KEY]: { lost: [{ name: "x" }] } }), "Nora")).toBeUndefined();
        expect(parseBotToolSignIn({ lost: [null, 3] }, BOT, "Nora")).toBeUndefined();
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
    // Built in the local clock, so the days are the same wherever the tests run
    const now = new Date(2026, 10, 5, 12, 0);
    const at = (day: number) => new Date(2026, 10, day, 9, 54).toISOString();

    it("is the time today, the weekday with it within the week, and the date with it for anything older", () => {
        const today = toolSignInSince(at(5), "en-US", now);
        const lastWeek = toolSignInSince(at(3), "en-US", now);
        const older = toolSignInSince(new Date(2026, 9, 20, 9, 54).toISOString(), "en-US", now);
        expect(today).toMatch(/\d{1,2}:\d{2}/);
        expect(today).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
        expect(lastWeek).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
        expect(older).toMatch(/Oct 20/);
        expect(older).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
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
