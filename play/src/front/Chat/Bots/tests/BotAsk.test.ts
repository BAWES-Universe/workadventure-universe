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
    readNearbyBotAsk,
    botAskTapJson,
    shownAskPosition,
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

describe("which waiting card is on show", () => {
    it("is the oldest unless the person paged to another that still waits", () => {
        expect(shownAskPosition(["a", "b", "c"], undefined)).toBe(0);
        expect(shownAskPosition(["a", "b", "c"], "b")).toBe(1);
        // The card paged to ended: back to the oldest, and a card that arrives later does not take its place
        expect(shownAskPosition(["a", "c"], "b")).toBe(0);
        expect(shownAskPosition(["a", "c", "d"], "b")).toBe(0);
        expect(shownAskPosition([], "b")).toBe(0);
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

describe("the card a bot shows one person in nearby chat (#1658)", () => {
    it("reads the same card a direct message's notice carries, as theirs alone", () => {
        const ask = readNearbyBotAsk(JSON.stringify(FIELD), 5_000_000);
        expect(ask).toMatchObject({ id: "act_1", revision: 3, title: "Create a Linear issue", private: true });
        // The time is counted from when this device got it
        expect(ask?.expiresAt).toBe(5_000_000 + 600_000);
    });

    it("a card in a direct message is not marked as private", () => {
        expect(readBotAsk(BOT_CHAT_ID, notice(FIELD), 5_000_000)?.private).toBeUndefined();
    });

    it("ignores what is not a card", () => {
        expect(readNearbyBotAsk("not json", 0)).toBeUndefined();
        expect(readNearbyBotAsk("null", 0)).toBeUndefined();
        expect(readNearbyBotAsk(JSON.stringify({ ...FIELD, kind: "question" }), 0)).toBeUndefined();
        expect(readNearbyBotAsk(JSON.stringify({ ...FIELD, options: [] }), 0)).toBeUndefined();
    });

    it("sends a tap as the same words, as JSON", () => {
        expect(JSON.parse(botAskTapJson({ action: "decide", option: "approve" }))).toEqual({
            action: "decide",
            option: "approve",
        });
    });
});

describe("a question card (#1661)", () => {
    const QUESTION = {
        v: 1,
        kind: "question",
        id: "q-1",
        revision: 1,
        title: "What should the launch party sound like?",
        choices: [
            { id: "c1", label: "Upbeat pop", line: "3 tracks, about 3 minutes each" },
            { id: "c2", label: "Lo-fi background" },
        ],
        now: 1_000_000,
        expiresAt: 1_000_000 + 600_000,
        waitMinutes: 10,
    };

    it("reads the question and its choices, with no options and no lines", () => {
        const ask = readBotAsk(BOT_CHAT_ID, notice(QUESTION), 50_000);
        expect(ask).toMatchObject({
            id: "q-1",
            title: "What should the launch party sound like?",
            options: [],
            lines: [],
            expiresAt: 650_000,
        });
        expect(ask?.question).toEqual({
            multiple: false,
            choices: [
                { id: "c1", label: "Upbeat pop", line: "3 tracks, about 3 minutes each" },
                { id: "c2", label: "Lo-fi background" },
            ],
        });
    });

    it("lets more than one choice tick only when the card says so", () => {
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, multiple: true }), 0)?.question?.multiple).toBe(true);
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, multiple: "yes" }), 0)?.question?.multiple).toBe(false);
    });

    it("is not a card with fewer than 2 choices, nor a choice with no name, and keeps at most 4", () => {
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, choices: [QUESTION.choices[0]] }), 0)).toBeUndefined();
        expect(
            readBotAsk(
                BOT_CHAT_ID,
                notice({ ...QUESTION, choices: [QUESTION.choices[0], { id: "c2", label: " " }] }),
                0
            )
        ).toBeUndefined();
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, choices: undefined }), 0)).toBeUndefined();
        const five = ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id, label: `Choice ${id}` }));
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, choices: five }), 0)?.question?.choices).toHaveLength(4);
    });

    it("ignores choices that repeat an id", () => {
        const ask = readBotAsk(
            BOT_CHAT_ID,
            notice({ ...QUESTION, choices: [...QUESTION.choices, { id: "c1", label: "Again" }] }),
            0
        );
        expect(ask?.question?.choices.map((choice) => choice.id)).toEqual(["c1", "c2"]);
    });

    it("reads how it ended: picked, typed, said out loud", () => {
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, answer: { picked: ["c2"] } }), 0)?.answer).toEqual({
            picked: ["c2"],
        });
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, answer: { typed: true } }), 0)?.answer).toEqual({
            typed: true,
        });
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, answer: { spoken: true } }), 0)?.answer).toEqual({
            spoken: true,
        });
        expect(readBotAsk(BOT_CHAT_ID, notice({ ...QUESTION, answer: { picked: [] } }), 0)?.answer).toEqual({});
    });

    it("comes to the person in nearby chat as a private card", () => {
        expect(readNearbyBotAsk(JSON.stringify(QUESTION), 0)).toMatchObject({ id: "q-1", private: true });
    });

    it("sends a pick as only the card, its revision and the ids", () => {
        expect(botAskAnswerContent({ id: "q-1", revision: 1 }, { action: "pick", choices: ["c1", "c2"] })).toEqual({
            v: 1,
            ask: "q-1",
            revision: 1,
            action: "pick",
            choices: ["c1", "c2"],
        });
        expect(JSON.parse(botAskTapJson({ action: "pick", choices: ["c2"] }))).toEqual({
            action: "pick",
            choices: ["c2"],
        });
    });

    it("waits and ends like any card, so the chat pins it and the clock runs", () => {
        const ask = readBotAsk(BOT_CHAT_ID, notice(QUESTION), 0)!;
        expect(isWaiting(ask, 1000)).toBe(true);
        expect(endedAsk(ask, 700_000).answer).toEqual({ expired: true });
    });
});
