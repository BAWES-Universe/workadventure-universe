import { get } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    identityChanged: [] as Array<() => void>,
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<(category?: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getMyUsage: game.getMyUsage,
        askForMoreUsage: game.askForMoreUsage,
        onIdentityChange: (listener: () => void) => {
            game.identityChanged.push(listener);
            return () => undefined;
        },
    },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});

import { userIsConnected } from "../../../Stores/MenuStore";
import { askMyUsageForMore, forgetMyUsage, loadMyUsage, myUsageStore } from "../UsageStore";

const connected = userIsConnected as unknown as Writable<boolean>;
const answer = (left: number) => ({
    chat: { left, words: "plenty", fullAgainAt: null },
    computer: null,
    storage: null,
    extra: null,
});
const left = () => (get(myUsageStore) as { chat?: { left?: number } } | undefined)?.chat?.left;

describe("the usage follows the real account", () => {
    beforeEach(() => {
        forgetMyUsage();
        connected.set(true);
        game.getMyUsage.mockReset();
        game.askForMoreUsage.mockReset();
    });

    it("forgets what was read when the game moves to another account or Orbit in place", async () => {
        game.getMyUsage.mockResolvedValue(answer(1));
        await loadMyUsage();
        expect(left()).toBe(1);
        // The game initialises again for another account: nothing of the first one stays on show
        for (const listener of game.identityChanged) listener();
        expect(get(myUsageStore)).toBeUndefined();
    });

    it("never lets a read that was on its way for the account before fill in the one now", async () => {
        let late: (value: unknown) => void = () => undefined;
        game.getMyUsage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    late = resolve;
                })
        );
        const reading = loadMyUsage();
        for (const listener of game.identityChanged) listener();
        late(answer(5));
        await reading;
        expect(get(myUsageStore)).toBeUndefined();
    });

    it("forgets what was read when the person signs out", async () => {
        game.getMyUsage.mockResolvedValue(answer(1));
        await loadMyUsage();
        expect(left()).toBe(1);
        connected.set(false);
        expect(get(myUsageStore)).toBeUndefined();
    });

    it("does not mark the new account's usage as asked for when the old account's 'Ask for more' answers late", async () => {
        game.getMyUsage.mockResolvedValue({
            ...answer(1),
            computer: {
                left: 0.5,
                words: "plenty",
                startsAgainAt: "2026-12-01T12:00:00",
                unlimited: false,
                asked: false,
                canAskForMore: true,
            },
        });
        await loadMyUsage();
        let taken: (value: unknown) => void = () => undefined;
        game.askForMoreUsage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    taken = resolve;
                })
        );
        const asking = askMyUsageForMore("computer");
        // Another account signs in and its usage is read, while the first one's ask is still out
        for (const listener of game.identityChanged) listener();
        await loadMyUsage();
        taken(undefined);
        expect(await asking).toBe(true);
        const computerNow = (get(myUsageStore) as { computer?: { asked?: boolean } } | undefined)?.computer;
        expect(computerNow?.asked).toBe(false);
    });
});
