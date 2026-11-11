import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The wording is the approved mock's (en-US), filled in the same way the app fills it.
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const en = (await import("../../../../../i18n/en-US/chat")).default as unknown as {
        botAsk: Record<string, string>;
        brick: { closeCard: string };
    };
    const botAsk = Object.fromEntries(
        Object.entries(en.botAsk).map(([key, text]) => [
            key,
            (values: Record<string, string | number> = {}) =>
                text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name])),
        ])
    );
    const brick = { closeCard: () => en.brick.closeCard };
    return { default: readable({ chat: { botAsk, brick } }), locale: readable("en-US") };
});

import type { BotAsk } from "../../../Bots/BotAsk";
import { i18nObject } from "../../../../../i18n/i18n-util";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { brickIdeasCard, brickStartersCard } from "../../../Bricks/BrickHello";
import BotAskCard from "../BotAskCard.svelte";

const NOW = 1_000_000;
const ask = (over: Partial<BotAsk> = {}): BotAsk => ({
    id: "act_1",
    revision: 3,
    title: "Create a Linear issue",
    actsAs: "Sara's Linear",
    lines: [
        { label: "Team", text: "WEB" },
        { label: "Title", text: "Login button does nothing" },
        { label: "Description", text: "Tapping Log in on Safari does nothing at all" },
        { label: "Priority", text: "High" },
        { label: "Labels", text: "bug, login" },
    ],
    options: [
        { id: "approve", label: "Create issue" },
        { id: "approveAndRemember", label: "Create, and allow more WEB issues in this chat" },
        { id: "decline", label: "Don't create" },
    ],
    expiresAt: NOW + 600_000,
    waitMinutes: 10,
    ...over,
});

describe("the card a bot shows before it changes something", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void; $set: (props: Record<string, unknown>) => void } | undefined;
    const onTap = vi.fn();

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.clearAllMocks();
        onTap.mockResolvedValue(true);
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    async function show(value: BotAsk, props: Record<string, unknown> = {}) {
        shown = new BotAskCard({ target, props: { ask: value, botName: "Linear SH", now: NOW, onTap, ...props } });
        await tick();
    }
    const text = () => target.textContent?.replace(/\s+/g, " ") ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = async (element: HTMLElement | null) => {
        element?.click();
        await tick();
    };

    it("says what will happen, whose account does it, and offers the three ways to answer", async () => {
        await show(ask(), { docked: true, position: { at: 1, total: 1 } });
        expect(text()).toContain("Linear SH needs your answer");
        expect(text()).toContain("Create a Linear issue");
        expect(text()).toContain("Uses Sara's Linear account");
        expect(text()).not.toContain("Only you see this");
        const options = [...target.querySelectorAll('[data-testid="botAskOption"]')];
        expect(options.map((option) => option.textContent?.trim())).toEqual([
            "Create issue",
            "Create, and allow more WEB issues in this chat",
            "Don't create",
        ]);
    });

    it("sends only the card and the option when Create issue is tapped", async () => {
        await show(ask(), { docked: true });
        await click(target.querySelector('[data-option="approve"]'));
        expect(onTap).toHaveBeenCalledTimes(1);
        expect(onTap.mock.calls[0][0].id).toBe("act_1");
        expect(onTap.mock.calls[0][1]).toEqual({ action: "decide", option: "approve" });
    });

    it("ignores a second tap while the first is on its way", async () => {
        let finish: (sent: boolean) => void = () => undefined;
        onTap.mockReturnValue(
            new Promise<boolean>((resolve) => {
                finish = resolve;
            })
        );
        await show(ask(), { docked: true });
        await click(target.querySelector('[data-option="approve"]'));
        await click(target.querySelector('[data-option="decline"]'));
        expect(onTap).toHaveBeenCalledTimes(1);
        finish(false);
        await tick();
        await tick();
        expect(byId("botAskSendFailed")).not.toBeNull();
        await click(target.querySelector('[data-option="decline"]'));
        expect(onTap).toHaveBeenCalledTimes(2);
    });

    it("lets the person try again when the bot server never answers a sent tap", async () => {
        vi.useFakeTimers();
        try {
            await show(ask(), { docked: true });
            await click(target.querySelector('[data-option="approve"]'));
            await vi.advanceTimersByTimeAsync(1);
            expect((target.querySelector('[data-option="decline"]') as HTMLButtonElement).disabled).toBe(true);
            await vi.advanceTimersByTimeAsync(10_000);
            await tick();
            expect((target.querySelector('[data-option="decline"]') as HTMLButtonElement).disabled).toBe(false);
            expect(byId("botAskSendFailed")).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("says so when Review again could not be sent on a card that already ended", async () => {
        onTap.mockResolvedValue(false);
        await show(ask({ answer: { closed: true } }));
        await click(byId("botAskReviewAgain"));
        await tick();
        expect(byId("botAskSendFailed")).not.toBeNull();
        expect((byId("botAskReviewAgain") as HTMLButtonElement).disabled).toBe(false);
    });

    it("makes the whole details box the button, folded to start", async () => {
        await show(ask(), { docked: true });
        const box = byId("botAskDetails") as HTMLButtonElement;
        expect(box.tagName).toBe("BUTTON");
        expect(box.getAttribute("aria-expanded")).toBe("false");
        expect(box.textContent).toContain("Show all 5 details");
        expect(box.textContent).not.toContain("Priority");
        await click(box);
        expect(box.getAttribute("aria-expanded")).toBe("true");
        expect(box.textContent).toContain("Priority");
        expect(box.textContent).toContain("Show less");
        await click(box);
        expect(box.textContent).toContain("Show all 5 details");
    });

    it("shows a short card's details without a button", async () => {
        await show(ask({ lines: [{ label: "Team", text: "WEB" }] }), { docked: true });
        expect(byId("botAskDetails")?.tagName).toBe("DIV");
    });

    it("pages between waiting cards and warns about one that closes soon", async () => {
        const onNext = vi.fn();
        const onShowQueued = vi.fn();
        await show(ask(), {
            docked: true,
            position: { at: 1, total: 2 },
            queuedClosingSoon: { at: 2, total: 2 },
            onNext,
            onShowQueued,
        });
        expect(text()).toContain("1 of 2");
        expect((byId("botAskPrevious") as HTMLButtonElement).disabled).toBe(true);
        await click(byId("botAskNext"));
        expect(onNext).toHaveBeenCalled();
        expect(text()).toContain("Card 2 of 2 closes in 1 min");
        await click(byId("botAskShowQueued"));
        expect(onShowQueued).toHaveBeenCalled();
    });

    it("closes quietly with X", async () => {
        await show(ask(), { docked: true });
        await click(byId("botAskClose"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "close" });
    });

    it("warns a minute before it closes and offers more time", async () => {
        await show(ask({ expiresAt: NOW + 90_000 }), { docked: true });
        expect(byId("botAskMoreTime")).toBeNull();
        shown?.$destroy();
        await show(ask({ expiresAt: NOW + 45_000 }), { docked: true });
        expect(text()).toContain("This card closes in 1 min");
        await click(byId("botAskMoreTime"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "moreTime" });
    });

    it("turns into a slim bar with Open on a short chat", async () => {
        const onOpen = vi.fn();
        await show(ask(), { docked: true, compact: true, position: { at: 1, total: 2 }, onOpen });
        expect(byId("botAskBar")).not.toBeNull();
        expect(byId("botAskCard")).toBeNull();
        expect(text()).toContain("1 of 2");
        await click(byId("botAskOpen"));
        expect(onOpen).toHaveBeenCalled();
    });

    it("says it asks every time for deletes and sends", async () => {
        await show(ask({ everyTime: true, options: [ask().options[0], ask().options[2]] }), { docked: true });
        expect(text()).toContain("Uses Sara's Linear account · Linear SH asks every time for this");
        expect(target.querySelectorAll('[data-testid="botAskOption"]')).toHaveLength(2);
    });

    it("tells a manager that nobody has confirmed the tool yet", async () => {
        await show(ask({ notReviewed: true }), { docked: true });
        expect(text()).toContain(
            "Nobody has confirmed this tool yet, so only people who manage Linear SH can use the tool for now."
        );
    });

    describe("once it ended, in the chat", () => {
        it("tells what was picked and what the bot got back", async () => {
            await show(ask({ answer: { option: "approve", result: "Created WEB-412." } }));
            expect(text()).toContain("You picked Create issue");
            expect(text()).toContain("Created WEB-412.");
            expect(byId("botAskOption")).toBeNull();
        });

        it("says how long allow more lasts and offers Ask me again", async () => {
            await show(
                ask({
                    answer: {
                        option: "approveAndRemember",
                        allowedMore: "Until 1 hour without your messages, 8 hours at most",
                    },
                })
            );
            expect(text()).toContain("Until 1 hour without your messages, 8 hours at most");
            await click(byId("botAskAskAgain"));
            expect(onTap.mock.calls[0][1]).toEqual({ action: "askAgain" });
        });

        it("says nothing was done after Don't create", async () => {
            await show(ask({ answer: { option: "decline", result: "Linear SH didn't create anything." } }));
            expect(text()).toContain("You picked Don't create");
            expect(text()).toContain("Linear SH didn't create anything.");
        });

        it("says when the app gave no answer and never retries by itself", async () => {
            await show(
                ask({
                    answer: { option: "approve", unknown: true },
                    checkAt: { label: "Linear", url: "https://linear.app/team/WEB" },
                })
            );
            expect(text()).toContain(
                "Linear gave no answer, so Linear SH can't tell if “Create a Linear issue” worked. Check Linear before trying again."
            );
            const link = target.querySelector("a") as HTMLAnchorElement;
            expect(link.textContent?.trim()).toBe("Open Linear");
            expect(link.getAttribute("href")).toBe("https://linear.app/team/WEB");
            expect(link.getAttribute("rel")).toContain("noopener");
        });

        it("says the person typed something else", async () => {
            await show(ask({ answer: { typed: true } }));
            expect(text()).toContain("You typed something else, so nothing was done");
        });

        it("says the person closed it, with Review again", async () => {
            await show(ask({ answer: { closed: true } }));
            expect(text()).toContain("You closed this card, so nothing was done");
            await click(byId("botAskReviewAgain"));
            expect(onTap.mock.calls[0][1]).toEqual({ action: "reviewAgain" });
        });

        it("says nobody answered, even before the bot server says so", async () => {
            await show(ask({ expiresAt: NOW - 1 }));
            expect(text()).toContain("No answer in 10 min, so nothing was done");
            expect(byId("botAskReviewAgain")).not.toBeNull();
            expect(byId("botAskOption")).toBeNull();
        });
    });

    it("says only the person who asked sees a card that came to them alone in nearby chat, while it waits (#1658)", async () => {
        await show(ask({ private: true }), { docked: true });
        expect(byId("botAskPrivate")?.textContent).toContain("Only you see this card");
    });

    it("shows no such line on a card in a direct message", async () => {
        await show(ask(), { docked: true });
        expect(byId("botAskPrivate")).toBeNull();
    });

    it("drops the line once the card ended, and says 'said' where the person may have spoken", async () => {
        await show(ask({ private: true, answer: { typed: true } }));
        expect(byId("botAskPrivate")).toBeNull();
        expect(text()).toContain("You said something else, so nothing was done");
    });

    it("keeps 'typed' in a direct message", async () => {
        await show(ask({ answer: { typed: true } }));
        expect(text()).toContain("You typed something else, so nothing was done");
    });
});

describe("the question card a bot shows before a big job (#1661)", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void; $set: (props: Record<string, unknown>) => void } | undefined;
    const onTap = vi.fn();

    const question = (over: Partial<BotAsk> = {}, multiple = false): BotAsk => ({
        id: "q-1",
        revision: 1,
        title: "What should the launch party sound like?",
        lines: [],
        options: [],
        question: {
            multiple,
            choices: [
                { id: "c1", label: "Upbeat pop", line: "3 tracks, about 3 minutes each" },
                { id: "c2", label: "Lo-fi background", line: "One 20-minute mix to talk over" },
                { id: "c3", label: "Arabic house" },
            ],
        },
        expiresAt: NOW + 600_000,
        waitMinutes: 10,
        ...over,
    });

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.clearAllMocks();
        onTap.mockResolvedValue(true);
    });
    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    async function show(value: BotAsk, props: Record<string, unknown> = {}) {
        shown = new BotAskCard({ target, props: { ask: value, botName: "Melody", now: NOW, onTap, ...props } });
        await tick();
    }
    const text = () => target.textContent?.replace(/\s+/g, " ") ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const choices = () => [...target.querySelectorAll<HTMLButtonElement>('[data-testid="botAskChoice"]')];
    const click = async (element: HTMLElement | null) => {
        element?.click();
        await tick();
    };

    it("asks the question with equal choices, each with its short line, and none marked", async () => {
        await show(question(), { docked: true, position: { at: 1, total: 1 } });
        expect(text()).toContain("Melody needs your answer");
        expect(text()).toContain("What should the launch party sound like?");
        expect(choices().map((choice) => choice.textContent?.replace(/\s+/g, " ").trim())).toEqual([
            "Upbeat pop 3 tracks, about 3 minutes each",
            "Lo-fi background One 20-minute mix to talk over",
            "Arabic house",
        ]);
        // No approval options, no details box, no marked choice
        expect(byId("botAskOption")).toBeNull();
        expect(byId("botAskDetails")).toBeNull();
        expect(target.querySelector(".main")).toBeNull();
        expect(byId("botAskContinue")).toBeNull();
    });

    it("is answered by one tap, which sends only the card and the id of the choice", async () => {
        await show(question(), { docked: true });
        await click(choices()[1]);
        expect(onTap).toHaveBeenCalledTimes(1);
        expect(onTap.mock.calls[0][0].id).toBe("q-1");
        expect(onTap.mock.calls[0][1]).toEqual({ action: "pick", choices: ["c2"] });
    });

    it("ignores a second tap while the first is on its way", async () => {
        onTap.mockReturnValue(
            new Promise<boolean>(() => {
                // never answers
            })
        );
        await show(question(), { docked: true });
        await click(choices()[0]);
        await click(choices()[1]);
        expect(onTap).toHaveBeenCalledTimes(1);
    });

    it("ticks choices when more than one is allowed, and Continue with N sends them in the order shown", async () => {
        await show(question({}, true), { docked: true });
        const continueButton = byId("botAskContinue") as HTMLButtonElement;
        expect(continueButton.textContent?.trim()).toBe("Continue with 0");
        expect(continueButton.disabled).toBe(true);
        await click(choices()[2]);
        await click(choices()[0]);
        expect(onTap).not.toHaveBeenCalled();
        expect(choices().map((choice) => choice.getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
        expect((byId("botAskContinue") as HTMLButtonElement).textContent?.trim()).toBe("Continue with 2");
        expect((byId("botAskContinue") as HTMLButtonElement).disabled).toBe(false);
        await click(byId("botAskContinue"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "pick", choices: ["c1", "c3"] });
    });

    it("unticks a choice tapped twice", async () => {
        await show(question({}, true), { docked: true });
        await click(choices()[0]);
        await click(choices()[0]);
        expect(choices()[0].getAttribute("aria-checked")).toBe("false");
        expect((byId("botAskContinue") as HTMLButtonElement).disabled).toBe(true);
    });

    it("starts with nothing ticked again when the bot server changes the card", async () => {
        await show(question({}, true), { docked: true });
        await click(choices()[0]);
        shown?.$set({ ask: question({ revision: 2 }, true) });
        await tick();
        expect(choices().every((choice) => choice.getAttribute("aria-checked") === "false")).toBe(true);
    });

    it("says which choice was picked once answered, in the chat", async () => {
        await show(question({ answer: { picked: ["c1"] } }));
        expect(text()).toContain("What should the launch party sound like?");
        expect(byId("botAskPicked")?.textContent).toContain("You picked Upbeat pop");
        expect(choices()).toHaveLength(0);
    });

    it("lists more than one picked choice in words", async () => {
        await show(question({ answer: { picked: ["c1", "c3"] } }, true));
        expect(byId("botAskPicked")?.textContent).toContain("You picked Upbeat pop and Arabic house");
    });

    it("says when the answer was typed or said out loud", async () => {
        await show(question({ answer: { typed: true } }));
        expect(byId("botAskAnswered")?.textContent).toBe("You answered by typing");
        shown?.$destroy();
        await show(question({ answer: { spoken: true } }));
        expect(byId("botAskAnswered")?.textContent).toBe("You answered out loud");
        // Not the approval card's "nothing was done": a question only picks a direction
        expect(text()).not.toContain("nothing was done");
    });

    it("says no answer in time, with a way to ask again", async () => {
        await show(question({ expiresAt: NOW - 1 }));
        expect(text()).toContain("No answer in 10 min, so nothing was done");
        await click(byId("botAskReviewAgain"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "reviewAgain" });
    });

    it("closes with X and offers more time a minute before the end, like every card", async () => {
        await show(question({ expiresAt: NOW + 45_000 }), { docked: true });
        expect(text()).toContain("This card closes in 1 min");
        await click(byId("botAskMoreTime"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "moreTime" });
        shown?.$destroy();
        await show(question(), { docked: true });
        await click(byId("botAskClose"));
        expect(onTap.mock.calls[1][1]).toEqual({ action: "close" });
    });

    it("is a slim bar with Open on a short chat, with the question on it", async () => {
        await show(question(), { docked: true, compact: true });
        expect(byId("botAskBar")?.textContent).toContain("What should the launch party sound like?");
        expect(choices()).toHaveLength(0);
    });

    it("tells the person in nearby chat that only they see it, as every nearby card does", async () => {
        await show(question({ private: true }), { docked: true });
        expect(byId("botAskPrivate")?.textContent).toContain("Only you see this card");
    });
});

describe("a Brick's own suggestions on the question card (#1995)", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    const onTap = vi.fn();
    loadLocale("en-US");
    const LL = i18nObject("en-US");

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.clearAllMocks();
        onTap.mockResolvedValue(true);
    });
    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    async function show(value: BotAsk, props: Record<string, unknown> = {}) {
        shown = new BotAskCard({
            target,
            props: {
                ask: value,
                botName: "Brick",
                headLine: LL.chat.brick.suggests({ name: "Brick" }),
                docked: true,
                // A day later: the game's own card never runs out
                now: Date.now() + 24 * 3600 * 1000,
                onTap,
                ...props,
            },
        });
        await tick();
    }
    const text = () => target.textContent?.replace(/\s+/g, " ") ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const choices = () => [...target.querySelectorAll<HTMLButtonElement>('[data-testid="botAskChoice"]')];
    const click = async (element: HTMLElement | null) => {
        element?.click();
        await tick();
    };

    it("offers the one way to start under the hello, as the Brick's suggestion and not as something it needs", async () => {
        await show(brickStartersCard(LL));
        expect(text()).toContain("Brick suggests");
        expect(text()).not.toContain("needs your answer");
        expect(text()).toContain("Where shall we start?");
        expect(choices().map((choice) => choice.textContent?.replace(/\s+/g, " ").trim())).toEqual([
            "See what I can do A few ideas to start with",
        ]);
        // Nothing to approve, and no clock on it
        expect(byId("botAskOption")).toBeNull();
        expect(byId("botAskMoreTime")).toBeNull();
        expect(text()).not.toContain("closes in");
    });

    it("sends only the starter's id on a tap: the chat sends the person's words", async () => {
        const card = brickStartersCard(LL);
        await show(card);
        await click(choices()[0]);
        expect(onTap).toHaveBeenCalledTimes(1);
        expect(onTap.mock.calls[0][0]).toBe(card);
        expect(onTap.mock.calls[0][1]).toEqual({ action: "pick", choices: ["ideas"] });
    });

    it("lists the four ideas under the Brick's answer, and a tap picks one", async () => {
        await show(brickIdeasCard(LL));
        expect(text()).toContain("Brick suggests");
        expect(text()).toContain("What shall I take on?");
        expect(choices().map((choice) => choice.dataset.choice)).toEqual(["write", "web", "file", "think"]);
        await click(choices()[2]);
        expect(onTap.mock.calls[0][1]).toEqual({ action: "pick", choices: ["file"] });
    });

    it("closes with X, which is named plainly", async () => {
        await show(brickStartersCard(LL));
        expect(byId("botAskClose")?.getAttribute("aria-label")).toBe("Close");
        await click(byId("botAskClose"));
        expect(onTap.mock.calls[0][1]).toEqual({ action: "close" });
    });

    it("is a slim bar on a short chat, in the Brick's name, with the question on it", async () => {
        await show(brickStartersCard(LL), { compact: true });
        expect(byId("botAskBar")?.textContent).toContain("Where shall we start?");
        expect(text()).toContain("Brick suggests");
        expect(text()).not.toContain("needs your answer");
        expect(choices()).toHaveLength(0);
    });
});
