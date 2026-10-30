import { describe, expect, it } from "vitest";
import { get, writable, type Readable, type Subscriber } from "svelte/store";
import type { ChatMessage } from "../../Connection/ChatConnection";
import type { BotSteps } from "../BotSteps";
import { typingExceptWorkingBots, workingBotIds } from "../BotTyping";

const BOT = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.bawes.net";
const SPACE_BOT = "bot-space-user-id";
const steps = (state: BotSteps["state"]): BotSteps => ({ state, line: "Reading", startedAt: 0, steps: [] });

function stepsLine(sender: { chatId?: string; spaceUserId?: string }, value: BotSteps | undefined) {
    const store = writable<BotSteps | undefined>(value);
    return { message: { sender, steps: store } as unknown as ChatMessage, store };
}
const text = (sender: { chatId?: string }) =>
    ({ sender, steps: writable<BotSteps | undefined>(undefined) } as unknown as ChatMessage);
const member = (id: string) => ({ id, name: id, pictureStore: writable(undefined) });

// A chat's messages: an array that is also a store (SearchableArrayStore).
class ArrayStore<T> extends Array<T> implements Readable<T[]> {
    private readonly store = writable<T[]>(this);
    subscribe(run: Subscriber<T[]>) {
        return this.store.subscribe(run);
    }
    add(...items: T[]) {
        this.push(...items);
        this.store.set(this);
    }
}

describe("workingBotIds", () => {
    it("reads a chat's messages that are an array and a store at once", () => {
        const line = stepsLine({ chatId: BOT }, steps("working"));
        const messages = new ArrayStore<ChatMessage>();
        messages.add(text({ chatId: "@sara:matrix.bawes.net" }), line.message);
        expect(get(workingBotIds(messages)).has(BOT)).toBe(true);
    });

    it("names a bot whose steps line is working, and not once it is done", () => {
        const line = stepsLine({ chatId: BOT }, steps("working"));
        const working = workingBotIds(writable([line.message]));
        expect(get(working).has(BOT)).toBe(true);
        line.store.set(steps("done"));
        expect(get(working).has(BOT)).toBe(false);
    });

    it("keeps a bot working through its other messages, like a line it said between tools", () => {
        const line = stepsLine({ chatId: BOT }, steps("working"));
        const working = workingBotIds(writable([line.message, text({ chatId: BOT })]));
        expect(get(working).has(BOT)).toBe(true);
    });

    it("follows the bot's newest steps line", () => {
        const old = stepsLine({ chatId: BOT }, steps("working"));
        const now = stepsLine({ chatId: BOT }, steps("done"));
        expect(get(workingBotIds(writable([old.message, now.message]))).has(BOT)).toBe(false);
    });

    it("knows a bot of the nearby chat by its space user", () => {
        const line = stepsLine({ chatId: "chat-id", spaceUserId: SPACE_BOT }, steps("working"));
        const working = get(workingBotIds(writable([line.message])));
        expect(working.has(SPACE_BOT)).toBe(true);
    });

    it("names nobody when no steps line is working", () => {
        expect(get(workingBotIds(writable([text({ chatId: BOT })]))).size).toBe(0);
    });
});

describe("typingExceptWorkingBots", () => {
    it("hides a bot while its steps line works and shows it again after", () => {
        const line = stepsLine({ chatId: BOT }, steps("working"));
        const typing = writable([member(BOT), member("@sara:matrix.bawes.net")]);
        const shown = typingExceptWorkingBots(typing, workingBotIds(writable([line.message])));
        expect(get(shown).map((m) => m.id)).toEqual(["@sara:matrix.bawes.net"]);
        line.store.set(steps("done"));
        expect(get(shown).map((m) => m.id)).toEqual([BOT, "@sara:matrix.bawes.net"]);
    });

    it("shows a bot that has no steps line at all", () => {
        const shown = typingExceptWorkingBots(writable([member(BOT)]), workingBotIds(writable([])));
        expect(get(shown).map((m) => m.id)).toEqual([BOT]);
    });
});
