import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable, type Writable } from "svelte/store";

// The wording is the approved mock's, word for word.
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            chat: {
                botAsk: {
                    onlyYouSeeReply: () => "Only you see this reply",
                    continuePrivately: () => "Continue privately",
                },
            },
        }),
    };
});

const state = vi.hoisted(() => ({
    signedIn: undefined as unknown as Writable<boolean>,
    mayMessage: new Map<string, Writable<boolean>>(),
}));

vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    state.signedIn = writable(false);
    return { userIsConnected: state.signedIn };
});

vi.mock("../BotStatusStore", () => ({
    botDmAccessCache: {
        store: (botId: string) => {
            let store = state.mayMessage.get(botId);
            if (!store) state.mayMessage.set(botId, (store = writable(false)));
            return store;
        },
    },
}));

import PrivateReplyNote from "../PrivateReplyNote.svelte";

const BOT_ID = "0b7c1d2e-1111-4222-8333-944455556666";
const BOT_CHAT_ID = `@bot_${BOT_ID}:matrix.test`;

describe("under a reply a bot wrote for this person alone (#1993)", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    const onContinue = vi.fn();
    const note = () => target.querySelector("[data-testid=botPrivateReplyNote]");
    const button = () => target.querySelector<HTMLButtonElement>("[data-testid=botContinuePrivately]");
    const show = async (botChatId: string | undefined = BOT_CHAT_ID) => {
        shown = new PrivateReplyNote({ target, props: { botChatId, onContinue } });
        await tick();
    };

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        onContinue.mockClear();
        state.signedIn.set(false);
        state.mayMessage.clear();
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    it("always says only they see it, in the mock's words", async () => {
        await show();
        expect(note()?.textContent?.trim()).toBe("Only you see this reply");
    });

    it('offers "Continue privately" to someone signed in who may message this bot, and one tap carries on', async () => {
        state.signedIn.set(true);
        await show();
        expect(button()).toBeNull();

        state.mayMessage.get(BOT_ID)!.set(true);
        await tick();
        expect(button()?.textContent).toBe("Continue privately");
        // Big enough to tap on a phone, as drawn
        expect(button()?.className).toContain("min-h-[32px]");

        button()!.click();
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it("offers nothing to a guest: a guest has no direct messages", async () => {
        await show();
        state.mayMessage.get(BOT_ID)!.set(true);
        await tick();
        expect(button()).toBeNull();
        expect(note()?.textContent?.trim()).toBe("Only you see this reply");
    });

    it("offers nothing when the bot has no chat address to carry on at", async () => {
        state.signedIn.set(true);
        await show(undefined);
        expect(button()).toBeNull();
        await show("@sara:matrix.test");
        expect(target.querySelectorAll("[data-testid=botContinuePrivately]")).toHaveLength(0);
    });
});
