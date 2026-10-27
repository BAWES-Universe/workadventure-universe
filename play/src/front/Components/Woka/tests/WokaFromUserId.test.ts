import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run Svelte's server build, where onMount does nothing; the screens need the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const pictures = vi.hoisted(() => new Map<number, { set: (src: string) => void }>());

vi.mock("../../../Phaser/Game/WhenGameScene", async () => {
    const { writable } = await import("svelte/store");
    const stores = new Map<number, ReturnType<typeof writable<string | undefined>>>();
    const store = (id: number) => {
        let found = stores.get(id);
        if (!found) {
            found = writable<string | undefined>(undefined);
            stores.set(id, found);
            pictures.set(id, found);
        }
        return found;
    };
    const scene = {
        CurrentPlayer: { pictureStore: store(-1) },
        MapPlayersByKey: {
            getNestedStore: (id: number) => store(id),
            [Symbol.iterator]: () => [][Symbol.iterator](),
        },
    };
    return { whenGameScene: (run: (s: unknown) => (() => void) | void) => run(scene) ?? (() => undefined) };
});

import WokaFromUserId from "../WokaFromUserId.svelte";
import { settle } from "./i18nStub";

describe("WokaFromUserId", () => {
    let target: HTMLElement;
    let component: WokaFromUserId | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    const shown = () => target.querySelector("img")?.getAttribute("src");

    it("shows the new person's Woka when the card turns to someone else", async () => {
        component = new WokaFromUserId({
            target,
            props: { userId: 5, placeholderSrc: "/ph.png", customWidth: "4rem" },
        });
        pictures.get(5)?.set("/melon.png");
        await settle();
        expect(shown()).toBe("/melon.png");

        component.$set({ userId: 6 });
        await settle();
        expect(shown()).toBe("/ph.png");

        pictures.get(6)?.set("/mishari.png");
        await settle();
        expect(shown()).toBe("/mishari.png");

        // The first person's picture changing later no longer reaches this card.
        pictures.get(5)?.set("/melon-new.png");
        await settle();
        expect(shown()).toBe("/mishari.png");
    });

    it("shows your own Woka for your own card", async () => {
        component = new WokaFromUserId({
            target,
            props: { userId: 5, placeholderSrc: "/ph.png", customWidth: "4rem" },
        });
        pictures.get(-1)?.set("/me.png");
        component.$set({ userId: -1 });
        await settle();
        expect(shown()).toBe("/me.png");
    });
});
