import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import {
    BOT_ASK_ANSWER_EVENT,
    askBarFits,
    botAskAnswerContent,
    chatAsks,
    closesSoon,
    endedAsk,
    isWaiting,
    nextAskChange,
    readBotAsk,
    type BotAsk,
} from "../BotAsk";

const BOT_CHAT_ID = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.bawes.net";
const FIELD = {
    v: 1,
    kind: "approval",
    id: "act_1",
    revision: 3,
    title: "Create a Linear issue",
    actsAs: "Sara's Linear",
    lines: [
        { label: "Team", text: "WEB" },
        { label: "Title", text: "Login button does nothing" },
    ],
    options: [
        { id: "approve", label: "Create issue" },
        { id: "approveAndRemember", label: "Create, and allow more WEB issues in this chat" },
        { id: "decline", label: "Don't create" },
    ],
    now: 1_000_000,
    expiresAt: 1_000_000 + 600_000,
    waitMinutes: 10,
};
const notice = (field: unknown) => ({ msgtype: "m.notice", body: "Create a Linear issue?", "universe.ask": field });

describe("readBotAsk", () => {
    it("reads the card a bot's notice carries and counts its time from when this device got it", () => {
        const ask = readBotAsk(BOT_CHAT_ID, notice(FIELD), 50_000);
        expect(ask).toMatchObject({
            id: "act_1",
            revision: 3,
            title: "Create a Linear issue",
            actsAs: "Sara's Linear",
            waitMinutes: 10,
            expiresAt: 50_000 + 600_000,
        });
        expect(ask?.lines).toEqual([
            { label: "Team", text: "WEB" },
            { label: "Title", text: "Login button does nothing" },
        ]);
        expect(ask?.options.map((option) => option.id)).toEqual(["approve", "approveAndRemember", "decline"]);
        expect(ask?.answer).toBeUndefined();
    });

    it("ignores a card from anyone but a bot, outside a notice, or that it does not understand", () => {
        expect(readBotAsk("@sara:matrix.bawes.net", notice(FIELD), 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, { ...notice(FIELD), msgtype: "m.text" }, 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, v: 2 }), 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, kind: "question" }), 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, id: "" }), 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, revision: -1 }), 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, expiresAt: "soon" }), 0)).toBeUndefined();
        expect(
            readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, options: [{ id: "run", label: "Run" }] }), 0)
        ).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, { msgtype: "m.notice", body: "Hello" }, 0)).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, undefined, 0)).toBeUndefined();
    });

    it("never offers allow more where the bot asks every time", () => {
        const ask = readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, everyTime: true }), 0);
        expect(ask?.everyTime).toBe(true);
        expect(ask?.options.map((option) => option.id)).toEqual(["approve", "decline"]);
    });

    it("keeps how a card ended, and only opens a web page from a link", () => {
        const ended = readBotAsk(
            BOT_CHAT_ID,
            notice({
                ...FIELD,
                answer: { option: "approve", unknown: true },
                checkAt: { label: "Linear", url: "https://linear.app/team/WEB" },
            }),
            0
        );
        expect(ended?.answer).toEqual({ option: "approve", unknown: true });
        expect(ended?.checkAt).toEqual({ label: "Linear", url: "https://linear.app/team/WEB" });
        const unsafe = readBotAsk(
            BOT_CHAT_ID,
            notice({ ...FIELD, checkAt: { label: "Linear", url: "javascript:alert(1)" } }),
            0
        );
        expect(unsafe?.checkAt).toBeUndefined();
    });

    it("keeps a long card within bounds", () => {
        const lines = Array.from({ length: 40 }, (_, i) => ({ text: `line ${i} ${"x".repeat(5000)}` }));
        const ask = readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, lines }), 0);
        expect(ask?.lines).toHaveLength(20);
        expect(ask?.lines[0].text.length).toBeLessThanOrEqual(2000);
    });
});

describe("when a card waits and when it closes", () => {
    const ask = readBotAsk(BOT_CHAT_ID, notice(FIELD), 0) as BotAsk;

    it("waits until it is answered or its time is up", () => {
        expect(isWaiting(ask, 1000)).toBe(true);
        expect(isWaiting(ask, ask.expiresAt)).toBe(false);
        expect(isWaiting({ ...ask, answer: { closed: true } }, 1000)).toBe(false);
    });

    it("warns a minute before it closes, once it still waits", () => {
        expect(closesSoon(ask, ask.expiresAt - 61_000)).toBe(false);
        expect(closesSoon(ask, ask.expiresAt - 60_000)).toBe(true);
        expect(closesSoon(ask, ask.expiresAt + 1)).toBe(false);
    });

    it("reads a card nobody answered in time as closed for lack of an answer", () => {
        expect(endedAsk(ask, 1000)).toBe(ask);
        expect(endedAsk(ask, ask.expiresAt + 1).answer).toEqual({ expired: true });
        const answered = { ...ask, answer: { option: "decline" as const } };
        expect(endedAsk(answered, ask.expiresAt + 1)).toBe(answered);
    });

    it("tells when the cards next change by themselves", () => {
        const later = { ...ask, expiresAt: ask.expiresAt + 100_000 };
        expect(nextAskChange([ask, later], 0)).toBe(ask.expiresAt - 60_000);
        expect(nextAskChange([ask, later], ask.expiresAt - 60_000)).toBe(ask.expiresAt);
        expect(nextAskChange([{ ...ask, answer: { closed: true } }], 0)).toBeUndefined();
        expect(nextAskChange([], 0)).toBeUndefined();
    });
});

describe("the slim bar on a phone", () => {
    it("shows only on a chat sheet that does not cover the screen", () => {
        expect(askBarFits(true, "half")).toBe(true);
        expect(askBarFits(true, "peek")).toBe(true);
        expect(askBarFits(true, 0.6)).toBe(true);
        expect(askBarFits(true, "full")).toBe(false);
        expect(askBarFits(true, 0.95)).toBe(false);
        expect(askBarFits(false, "half")).toBe(false);
    });
});

describe("what a tap sends", () => {
    it("names only the card, its revision and what was tapped", () => {
        expect(BOT_ASK_ANSWER_EVENT).toBe("universe.ask.answer");
        expect(botAskAnswerContent({ id: "act_1", revision: 3 }, { action: "decide", option: "approve" })).toEqual({
            v: 1,
            ask: "act_1",
            revision: 3,
            action: "decide",
            option: "approve",
        });
        expect(botAskAnswerContent({ id: "act_1", revision: 3 }, { action: "moreTime" })).toEqual({
            v: 1,
            ask: "act_1",
            revision: 3,
            action: "moreTime",
        });
    });
});

describe("chatAsks", () => {
    it("lists the cards in the chat, oldest first, and follows the bot server's edits", () => {
        const first = writable<BotAsk | undefined>(readBotAsk(BOT_CHAT_ID, notice(FIELD), 0));
        const second = writable<BotAsk | undefined>(readBotAsk(BOT_CHAT_ID, notice({ ...FIELD, id: "act_2" }), 0));
        const messages = writable([{ id: "m1", ask: first }, { id: "m2" }, { id: "m3", ask: second }]);
        const asks = chatAsks(messages);
        expect(get(asks).map((entry) => [entry.message.id, entry.ask.id])).toEqual([
            ["m1", "act_1"],
            ["m3", "act_2"],
        ]);
        first.set({ ...(get(first) as BotAsk), answer: { closed: true } });
        expect(get(asks)[0].ask.answer).toEqual({ closed: true });
        messages.set([]);
        expect(get(asks)).toEqual([]);
    });
});
