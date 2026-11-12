import { get } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: api }));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});

import { userIsConnected } from "../../../Stores/MenuStore";
import {
    askMyUsageForMore,
    forgetMyUsage,
    loadMyUsage,
    myUsageFailed,
    myUsageSettled,
    myUsageStore,
} from "../UsageStore";

const out = {
    chat: { left: 1, words: "plenty", fullAgainAt: null },
    computer: {
        left: 0,
        words: "out",
        startsAgainAt: "2026-12-01T00:00:00.000Z",
        unlimited: false,
        asked: false,
        canAskForMore: true,
    },
    storage: { bytes: 10 },
    extra: null,
};

describe("a person's usage in the game (#1999)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyUsage();
        (userIsConnected as unknown as Writable<boolean>).set(true);
        api.getMyUsage.mockResolvedValue(out);
        api.askForMoreUsage.mockResolvedValue({ asked: true, created: true });
    });

    it("is unknown until Orbit answered", async () => {
        expect(get(myUsageStore)).toBeUndefined();
        expect(get(myUsageSettled)).toBe(false);
        await loadMyUsage();
        expect(get(myUsageSettled)).toBe(true);
        expect(get(myUsageFailed)).toBe(false);
        expect(get(myUsageStore)?.computer?.canAskForMore).toBe(true);
    });

    it("asks nothing of a guest", async () => {
        (userIsConnected as unknown as Writable<boolean>).set(false);
        await loadMyUsage();
        expect(api.getMyUsage).not.toHaveBeenCalled();
    });

    it("makes one request at a time", async () => {
        await Promise.all([loadMyUsage(), loadMyUsage()]);
        expect(api.getMyUsage).toHaveBeenCalledTimes(1);
    });

    it("keeps what was known when a later read fails, and says it failed", async () => {
        await loadMyUsage();
        api.getMyUsage.mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await loadMyUsage();
        warn.mockRestore();
        expect(get(myUsageStore)?.storageBytes).toBe(10);
        expect(get(myUsageFailed)).toBe(true);
        api.getMyUsage.mockResolvedValue({ error: "nope" });
        await loadMyUsage();
        expect(get(myUsageFailed)).toBe(true);
    });

    it("shows the request as sent once Orbit took it, and not before", async () => {
        await loadMyUsage();
        expect(await askMyUsageForMore()).toBe(true);
        expect(get(myUsageStore)?.computer).toMatchObject({ asked: true, canAskForMore: false });
    });

    it("leaves the button when Orbit refused", async () => {
        await loadMyUsage();
        api.askForMoreUsage.mockRejectedValue(new Error("409"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await askMyUsageForMore()).toBe(false);
        warn.mockRestore();
        expect(get(myUsageStore)?.computer).toMatchObject({ asked: false, canAskForMore: true });
    });
});
