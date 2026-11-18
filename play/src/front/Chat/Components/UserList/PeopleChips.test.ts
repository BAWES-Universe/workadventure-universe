import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

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

    it("shows how many friends are online, not how many friends there are", async () => {
        await show({ onlineFriendsCount: 2 });
        expect(count("friends")?.textContent).toBe("2");
        expect(count("friends")?.getAttribute("aria-label")).toBe("chat.friends.friendsOnline:2");
    });

    it("shows 0 when nobody is online, and the Friends chip stays", async () => {
        await show({ onlineFriendsCount: 0 });
        expect(count("friends")?.textContent).toBe("0");
        expect(target.querySelector('[data-testid="peopleChip-friends"]')).not.toBeNull();
    });

    it("moves as friends go on and offline", async () => {
        await show({ onlineFriendsCount: 1 });
        expect(count("friends")?.textContent).toBe("1");
        component?.$set({ onlineFriendsCount: 3 });
        await tick();
        expect(count("friends")?.textContent).toBe("3");
        component?.$set({ onlineFriendsCount: 0 });
        await tick();
        expect(count("friends")?.textContent).toBe("0");
    });

    it("keeps the gold count of friend requests waiting", async () => {
        await show({ onlineFriendsCount: 0, incomingCount: 2, showRequests: true });
        expect(target.querySelector('[data-testid="peopleChip-requests"]')?.textContent).toContain("2");
    });
});
