import { get } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getMyUsage: vi.fn<() => Promise<unknown>>(),
    askForMoreUsage: vi.fn<(category?: string) => Promise<unknown>>(),
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
    refreshMyUsage,
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

    it("keeps the request as sent when a read that began before it comes back after it", async () => {
        await loadMyUsage();
        let late: (value: unknown) => void = () => undefined;
        api.getMyUsage.mockReturnValue(
            new Promise((resolve) => {
                late = resolve;
            })
        );
        const reading = loadMyUsage();
        expect(await askMyUsageForMore()).toBe(true);
        // Orbit's answer was made before the request, so it still says the button is there
        late(out);
        await reading;
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

    const money = (over: Record<string, unknown> = {}) => ({
        kind: "oneoff",
        availableMicros: 0,
        totalMicros: 2_000_000,
        canAskForMore: true,
        ...over,
    });

    it("asks for more of the Instant Apps credit, and shows it asked at once", async () => {
        api.getMyUsage.mockResolvedValue({ ...out, version: 5, apps: money() });
        await loadMyUsage();
        expect(await askMyUsageForMore("apps")).toBe(true);
        expect(api.askForMoreUsage).toHaveBeenCalledWith("apps");
        expect(get(myUsageStore)?.apps).toMatchObject({ asked: true, canAskForMore: false });
        // The computer's request is its own
        expect(get(myUsageStore)?.computer).toMatchObject({ asked: false, canAskForMore: true });
    });

    it("asks for the computer's by default, as it always did, and its dollars show it asked too", async () => {
        api.getMyUsage.mockResolvedValue({
            ...out,
            computer: { ...out.computer, ...money({ availableMicros: 0 }) },
        });
        await loadMyUsage();
        expect(await askMyUsageForMore()).toBe(true);
        expect(api.askForMoreUsage).toHaveBeenCalledWith("computer");
        expect(get(myUsageStore)?.computer?.money).toMatchObject({ asked: true, canAskForMore: false });
    });

    it("asks for more voice time from a card in the chat, and leaves the page's own lines as they were", async () => {
        api.getMyUsage.mockResolvedValue({ ...out, version: 6, apps: money() });
        await loadMyUsage();
        expect(await askMyUsageForMore("speech")).toBe(true);
        expect(api.askForMoreUsage).toHaveBeenCalledWith("speech");
        expect(get(myUsageStore)?.apps).toMatchObject({ asked: false, canAskForMore: true });
        expect(get(myUsageStore)?.computer).toMatchObject({ asked: false, canAskForMore: true });
    });

    it("says nothing was sent when Orbit did not take the ask for more voice time", async () => {
        api.askForMoreUsage.mockRejectedValueOnce(new Error("409"));
        expect(await askMyUsageForMore("speech")).toBe(false);
    });

    it("never lets an older answer replace a newer one", async () => {
        api.getMyUsage.mockResolvedValueOnce({ ...out, version: 20, storage: { bytes: 20 } });
        await loadMyUsage();
        api.getMyUsage.mockResolvedValueOnce({ ...out, version: 10, storage: { bytes: 10 } });
        await loadMyUsage();
        expect(get(myUsageStore)?.storageBytes).toBe(20);
        // A newer one, and one with no stamp, do replace it
        api.getMyUsage.mockResolvedValueOnce({ ...out, version: 30, storage: { bytes: 30 } });
        await loadMyUsage();
        expect(get(myUsageStore)?.storageBytes).toBe(30);
        api.getMyUsage.mockResolvedValueOnce({ ...out, storage: { bytes: 40 } });
        await loadMyUsage();
        expect(get(myUsageStore)?.storageBytes).toBe(40);
    });

    it("reads again from a request that begins after the call, and ignores the answer already on its way", async () => {
        let answerOld: (answer: unknown) => void = () => undefined;
        api.getMyUsage
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    answerOld = resolve;
                })
            )
            .mockResolvedValueOnce({ ...out, storage: { bytes: 222 } });
        const first = loadMyUsage();
        const refreshed = refreshMyUsage();
        // One read waits for the one in flight; asking again does not add another
        expect(refreshMyUsage()).toBe(refreshed);
        expect(api.getMyUsage).toHaveBeenCalledTimes(1);
        answerOld({ ...out, storage: { bytes: 111 } });
        await first;
        await refreshed;
        expect(api.getMyUsage).toHaveBeenCalledTimes(2);
        expect(get(myUsageStore)?.storageBytes).toBe(222);
    });

    it("starts the read at once when none is out", async () => {
        await refreshMyUsage();
        expect(api.getMyUsage).toHaveBeenCalledTimes(1);
        expect(get(myUsageStore)?.computer?.canAskForMore).toBe(true);
    });
});
