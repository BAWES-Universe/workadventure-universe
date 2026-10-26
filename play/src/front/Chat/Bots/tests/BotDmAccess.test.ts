import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { BotDmAccessCache, DM_ACCESS_TTL_MS } from "../BotDmAccess";

const settle = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
const yes = () => Promise.resolve(true);

describe("BotDmAccessCache", () => {
    it("says no until the answer comes, then shows it", async () => {
        const cache = new BotDmAccessCache(yes);
        const store = cache.store("b1");
        const seen: boolean[] = [];
        const stop = store.subscribe((value) => seen.push(value));
        await settle();
        stop();
        expect(seen).toEqual([false, true]);
    });

    it("does not start from an old yes, which the owner may have taken back since", async () => {
        let now = 0;
        const ask = vi
            .fn<(botId: string) => Promise<boolean | null>>()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const cache = new BotDmAccessCache(ask, () => now);
        await cache.get("b1");
        expect(get(cache.store("b1"))).toBe(true);
        now = DM_ACCESS_TTL_MS;
        const seen: boolean[] = [];
        const stop = cache.store("b1").subscribe((value) => seen.push(value));
        await settle();
        stop();
        expect(seen).toEqual([false]);
    });

    it("asks once for everyone looking at the same bot, and keeps the answer for 30 seconds", async () => {
        let now = 0;
        const ask = vi.fn(yes);
        const cache = new BotDmAccessCache(ask, () => now);
        await Promise.all([cache.get("b1"), cache.get("b1")]);
        expect(ask).toHaveBeenCalledTimes(1);
        now = DM_ACCESS_TTL_MS - 1;
        await cache.get("b1");
        expect(ask).toHaveBeenCalledTimes(1);
        now = DM_ACCESS_TTL_MS;
        await cache.get("b1");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("does not keep 'could not find out', so a slow moment does not hide Message for 30 seconds", async () => {
        const ask = vi
            .fn<(botId: string) => Promise<boolean | null>>()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(true);
        const cache = new BotDmAccessCache(ask, () => 0);
        await expect(cache.get("b1")).resolves.toBe(false);
        await expect(cache.get("b1")).resolves.toBe(true);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("an answer it could not get is a no, so Message never shows for a bot that could not answer", async () => {
        const cache = new BotDmAccessCache(() => Promise.reject(new Error("bot server down")));
        await expect(cache.get("b1")).resolves.toBe(false);
        expect(get(cache.store("b1"))).toBe(false);
    });

    it("a store opened after an answer starts from it", async () => {
        const cache = new BotDmAccessCache(yes);
        await cache.get("b1");
        expect(get(cache.store("b1"))).toBe(true);
    });
});
