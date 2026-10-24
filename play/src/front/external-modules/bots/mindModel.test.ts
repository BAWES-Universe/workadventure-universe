import { describe, expect, it } from "vitest";
import type { BotAiOptions } from "./types";
import { aiLogoUrl, canPick, cardIcon, isOwnKeyRef, mindBriefName, newBotRef, runsOnCards } from "./mindModel";

const key = (id: string, over: Partial<BotAiOptions["keys"][number]> = {}): BotAiOptions["keys"][number] => ({
    id,
    name: `Key ${id}`,
    kind: "deepseek",
    kindLabel: "DeepSeek",
    group: "hosted",
    universeName: "Sandbox Universe",
    status: "working",
    ifDown: "universe-ai",
    ...over,
});

const options = (over: Partial<BotAiOptions> = {}): BotAiOptions => ({
    current: "universe-ai",
    universeAi: { available: true },
    maker: { id: "me", name: "Mishari" },
    viewerIsMaker: true,
    keys: [],
    currentKey: null,
    providers: null,
    ...over,
});

describe("runsOnCards", () => {
    it("a maker's bot on Universe AI: Universe AI first and picked, then their keys", () => {
        const cards = runsOnCards(
            options({ keys: [key("key-1"), key("key-2", { group: "own-computer", status: "down" })] }),
            "universe-ai"
        );
        expect(cards.map((card) => [card.kind, card.id, card.picked])).toEqual([
            ["universe-ai", "universe-ai", true],
            ["mine", "key-1", false],
            ["mine", "key-2", false],
        ]);
    });

    it("a maker's bot on one of their keys: that key picked", () => {
        const cards = runsOnCards(options({ current: "key-2", keys: [key("key-1"), key("key-2")] }), "key-2");
        expect(cards.map((card) => card.picked)).toEqual([false, false, true]);
    });

    it("someone else's key is shown as what the bot is on, picked, never selectable, with Universe AI to switch to", () => {
        const cards = runsOnCards(
            options({
                current: "key-9",
                viewerIsMaker: false,
                maker: { id: "mishari", name: "Mishari" },
                currentKey: {
                    id: "key-9",
                    name: "Mishari’s Claude",
                    ownerName: "Mishari",
                    mine: false,
                    status: "working",
                    ifDown: "universe-ai",
                },
            }),
            "key-9"
        );
        expect(cards).toEqual([
            {
                kind: "theirs",
                id: "key-9",
                title: "Mishari’s Claude",
                owner: "Mishari",
                picked: true,
                selectable: false,
                status: "working",
                ifDown: "universe-ai",
                logo: null,
                plainIcon: null,
            },
            { kind: "universe-ai", id: "universe-ai", picked: false, selectable: true, available: true },
        ]);
    });

    it("a key that is down says what its bots do meanwhile, for someone else's key too", () => {
        const down = (ifDown: "universe-ai" | "stop") =>
            runsOnCards(
                options({
                    current: "key-9",
                    viewerIsMaker: false,
                    currentKey: {
                        id: "key-9",
                        name: "Their Claude",
                        ownerName: "Mishari",
                        mine: false,
                        status: "down",
                        ifDown,
                    },
                }),
                "key-9"
            )[0];
        expect(down("stop")).toMatchObject({ kind: "theirs", status: "down", ifDown: "stop" });
        expect(down("universe-ai")).toMatchObject({ kind: "theirs", status: "down", ifDown: "universe-ai" });
    });

    it("a bot pinned to a server provider is shown by name, picked, not selectable; the pinned name falls back to the id", () => {
        const names = new Map([["deepseek-flash", "DeepSeek V4 Flash"]]);
        expect(runsOnCards(options({ current: "deepseek-flash" }), "deepseek-flash", names)[0]).toEqual({
            kind: "pinned",
            id: "deepseek-flash",
            title: "DeepSeek V4 Flash",
            picked: true,
            selectable: false,
        });
        expect(runsOnCards(options({ current: "mystery" }), "mystery")[0]).toMatchObject({
            kind: "pinned",
            title: "mystery",
        });
    });

    it("a personal key Orbit no longer knows is said to be gone, never shown as its raw id; Universe AI is still the way off it", () => {
        const cards = runsOnCards(options({ current: "key-deleted" }), "key-deleted");
        expect(cards[0]).toEqual({ kind: "gone", id: "key-deleted", picked: true, selectable: false });
        expect(cards[1]).toMatchObject({ kind: "universe-ai", picked: false, selectable: true });
        expect(canPick(options({ current: "key-deleted" }), cards[1])).toBe(true);
        expect(mindBriefName(options(), "key-deleted")).toEqual({ kind: "gone" });
    });

    it("matches a pinned provider's id without caring about case, as the old dropdown did", () => {
        const names = new Map([["lmstudio-local", "LM Studio Local"]]);
        expect(runsOnCards(options({ current: "LMStudio-Local" }), "LMStudio-Local", names)[0]).toMatchObject({
            title: "LM Studio Local",
        });
    });

    it("Universe AI cannot be chosen when it isn't set up, but is still shown", () => {
        const [card] = runsOnCards(options({ universeAi: { available: false }, current: null }), null);
        expect(card).toMatchObject({ kind: "universe-ai", selectable: false, available: false, picked: false });
    });

    it("the maker's own key that is no longer lent here is shown as it is", () => {
        const [first] = runsOnCards(
            options({
                current: "key-5",
                currentKey: {
                    id: "key-5",
                    name: "Old key",
                    ownerName: "Mishari",
                    mine: true,
                    status: "working",
                    ifDown: "universe-ai",
                },
            }),
            "key-5"
        );
        expect(first).toMatchObject({ kind: "theirs", title: "Old key", owner: null, selectable: false });
    });

    it("shows a key's Down state and what the bot does meanwhile", () => {
        const [, , down] = runsOnCards(
            options({ keys: [key("key-1"), key("key-2", { status: "down", ifDown: "stop" })] }),
            "universe-ai"
        );
        expect(down).toMatchObject({ status: "down", ifDown: "stop" });
    });
});

describe("canPick", () => {
    it("lets the maker pick their own keys and Universe AI", () => {
        const o = options({ keys: [key("key-1")] });
        const [uai, mine] = runsOnCards({ ...o, current: "key-1" }, "key-1");
        expect(canPick(o, uai)).toBe(true);
        expect(canPick(o, mine)).toBe(false); // already picked
        const [, other] = runsOnCards(o, "universe-ai");
        expect(canPick(o, other)).toBe(true);
    });

    it("lets a manager who isn't the maker move the bot to Universe AI only", () => {
        const o = options({
            viewerIsMaker: false,
            current: "key-9",
            currentKey: {
                id: "key-9",
                name: "Their key",
                ownerName: "Mishari",
                mine: false,
                status: "working",
                ifDown: "universe-ai",
            },
        });
        const [theirs, uai] = runsOnCards(o, "key-9");
        expect(canPick(o, theirs)).toBe(false);
        expect(canPick(o, uai)).toBe(true);
    });

    it("never lets a manager pick a key that was somehow in the list but isn't theirs to put on", () => {
        const o = options({ viewerIsMaker: false, keys: [key("key-1")] });
        const [, mine] = runsOnCards(o, "universe-ai");
        expect(canPick(o, mine)).toBe(false);
    });

    it("does not offer Universe AI when it isn't set up", () => {
        const o = options({ universeAi: { available: false }, current: "key-1", keys: [key("key-1")] });
        const [uai] = runsOnCards(o, "key-1");
        expect(canPick(o, uai)).toBe(false);
    });
});

describe("mindBriefName", () => {
    it("says none, Universe AI, the key's name or the provider", () => {
        expect(mindBriefName(options({ current: null }), null)).toEqual({ kind: "none" });
        expect(mindBriefName(options(), "universe-ai")).toEqual({ kind: "universe-ai" });
        expect(mindBriefName(options({ keys: [key("key-1", { name: "My DeepSeek" })] }), "key-1")).toEqual({
            kind: "key",
            name: "My DeepSeek",
        });
        expect(
            mindBriefName(
                options({
                    currentKey: {
                        id: "key-9",
                        name: "Mishari’s Claude",
                        ownerName: "Mishari",
                        mine: false,
                        status: "working",
                        ifDown: "universe-ai",
                    },
                }),
                "key-9"
            )
        ).toEqual({ kind: "key", name: "Mishari’s Claude" });
        expect(mindBriefName(options(), "deepseek-flash", new Map([["deepseek-flash", "DeepSeek V4 Flash"]]))).toEqual({
            kind: "provider",
            ref: "deepseek-flash",
            name: "DeepSeek V4 Flash",
        });
        expect(mindBriefName(options(), "mystery")).toEqual({ kind: "provider", ref: "mystery", name: null });
    });
});

describe("newBotRef", () => {
    it("starts a new bot on Universe AI when Orbit says it is ready, and decides nothing otherwise", () => {
        expect(newBotRef(options())).toBe("universe-ai");
        expect(newBotRef(options({ universeAi: { available: false } }))).toBeUndefined();
        expect(newBotRef(null)).toBeUndefined();
    });
});

describe("isOwnKeyRef", () => {
    it("only Orbit's key- ids are personal keys", () => {
        expect(isOwnKeyRef("key-1b2c")).toBe(true);
        expect(isOwnKeyRef("deepseek-flash")).toBe(false);
        expect(isOwnKeyRef("universe-ai")).toBe(false);
        expect(isOwnKeyRef(undefined)).toBe(false);
    });
});

describe("cardIcon", () => {
    const iconOf = (over: Partial<BotAiOptions["keys"][number]>) =>
        cardIcon(runsOnCards(options({ keys: [key("key-1", over)] }), "universe-ai")[1]);

    it("a key of a known provider shows its logo", () => {
        expect(iconOf({ logo: "deepseek", plainIcon: null })).toEqual({
            kind: "logo",
            url: "/static/ai-providers/deepseek.svg",
        });
    });

    it("a key with no logo shows a plug for any server, else a chip", () => {
        expect(iconOf({ logo: null, plainIcon: "plug" })).toEqual({ kind: "plug" });
        expect(iconOf({ logo: null, plainIcon: "chip" })).toEqual({ kind: "chip" });
    });

    it("an older Orbit that says nothing keeps the key icon every card had", () => {
        expect(iconOf({})).toEqual({ kind: "key" });
    });

    it("the key a bot is on, when it is someone else's, shows its logo too", () => {
        const cards = runsOnCards(
            options({
                current: "key-9",
                viewerIsMaker: false,
                currentKey: {
                    id: "key-9",
                    name: "Mishari’s Claude",
                    ownerName: "Mishari",
                    mine: false,
                    status: "working",
                    ifDown: "universe-ai",
                    logo: "anthropic",
                    plainIcon: null,
                },
            }),
            "key-9"
        );
        expect(cardIcon(cards[0])).toEqual({ kind: "logo", url: "/static/ai-providers/anthropic.svg" });
    });

    it("Universe AI keeps its own icon, and a pinned server provider the key", () => {
        const names = new Map([["openai-prod", "OpenAI"]]);
        const cards = runsOnCards(options({ current: "openai-prod" }), "openai-prod", names);
        expect(cards.map((card) => [card.kind, cardIcon(card)])).toEqual([
            ["pinned", { kind: "key" }],
            ["universe-ai", null],
        ]);
    });

    it("only a plain file name becomes an address, so Orbit's word can't reach into the style", () => {
        expect(aiLogoUrl("fireworks-ai")).toBe("/static/ai-providers/fireworks-ai.svg");
        for (const bad of ["", null, undefined, "../x", "a/b", "a.svg", "x);y", "A", "a b"]) {
            expect(aiLogoUrl(bad as string | null | undefined)).toBeNull();
        }
    });
});
