import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";

// Which chip is on is all the chips need from the chat stores
vi.mock("../../Stores/ChatStore", () => ({ peopleViewStore: writable("everyone") }));

// Every text is the path it was asked by, with the count it was given
vi.mock("../../../../i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy(() => path.join("."), {
            get: (_target, key) => text([...path, String(key)]),
            apply: (_target, _this, args: { count?: number }[]) =>
                args[0]?.count === undefined ? path.join(".") : `${path.join(".")}:${args[0].count}`,
        });
    return { default: readable(text([])), LL: readable(text([])) };
});

import { peopleViewStore } from "../../Stores/ChatStore";
import PeopleChips from "./PeopleChips.svelte";

describe("the Friends chip", () => {
    let target: HTMLElement;
    let component: PeopleChips | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function show(props: { onlineFriendsCount: number; incomingCount?: number; showRequests?: boolean }) {
        component = new PeopleChips({ target, props: { incomingCount: 0, showRequests: false, ...props } });
        await tick();
    }

    const count = (view: string) => target.querySelector(`[data-testid="peopleChipCount-${view}"]`);
    const text = (view: string) => target.querySelector(`[data-testid="peopleChipCountText-${view}"]`);

    it("shows how many friends are online, not how many friends there are", async () => {
        await show({ onlineFriendsCount: 2 });
        expect(count("friends")?.textContent).toBe("2");
        // The numeral is for the eyes; screen readers get the sentence as text
        expect(count("friends")?.getAttribute("aria-hidden")).toBe("true");
        expect(text("friends")?.textContent).toBe("chat.friends.friendsOnline:2");
    });

    it("hides only the badge when nobody is online: the Friends tab stays, and opens", async () => {
        await show({ onlineFriendsCount: 0 });
        expect(count("friends")).toBeNull();
        expect(text("friends")).toBeNull();
        const tab = target.querySelector<HTMLElement>('[data-testid="peopleChip-friends"]');
        expect(tab).not.toBeNull();
        expect(tab?.textContent).toContain("chat.friends.friends");
        tab?.click();
        await tick();
        expect(get(peopleViewStore)).toBe("friends");
    });

    it("moves as friends go on and offline", async () => {
        await show({ onlineFriendsCount: 1 });
        expect(count("friends")?.textContent).toBe("1");
        component?.$set({ onlineFriendsCount: 3 });
        await tick();
        expect(count("friends")?.textContent).toBe("3");
        component?.$set({ onlineFriendsCount: 0 });
        await tick();
        expect(count("friends")).toBeNull();
        expect(target.querySelector('[data-testid="peopleChip-friends"]')).not.toBeNull();
    });

    it("keeps the gold count of friend requests waiting", async () => {
        await show({ onlineFriendsCount: 0, incomingCount: 2, showRequests: true });
        expect(target.querySelector('[data-testid="peopleChip-requests"]')?.textContent).toContain("2");
    });
});
