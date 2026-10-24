import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { BotStatusCache } from "../BotStatusCache";

type Answer = Record<string, string> | null;

/** A lookup the test finishes by hand, so a note can arrive while it is still on its way. */
function manualFetch() {
    const calls: { ids: string[]; answer: (value: Answer) => void }[] = [];
    const fetchStatus = vi.fn(
        (ids: string[]) =>
            new Promise<Answer>((resolve) => {
                calls.push({ ids, answer: resolve });
            })
    );
    return { fetchStatus, calls };
}

describe("BotStatusCache batching", () => {
    it("asks once for every bot looked at in the same moment", async () => {
        const fetchStatus = vi.fn((ids: string[]) =>
            Promise.resolve(Object.fromEntries(ids.map((id) => [id, id === "a" ? "resting" : "online"])))
        );
        const cache = new BotStatusCache(fetchStatus, () => 0);
        const a = cache.store("a");
        const b = cache.store("b");
        const stops = [a.subscribe(() => undefined), b.subscribe(() => undefined)];
        await vi.waitFor(() => expect(get(a)).toBe("resting"));
        expect(get(b)).toBe("online");
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        expect(fetchStatus).toHaveBeenCalledWith(["a", "b"]);
        stops.forEach((stop) => stop());
    });

    it("asks about at most 50 bots at a time and still answers all of them", async () => {
        const fetchStatus = vi.fn((ids: string[]) =>
            Promise.resolve(Object.fromEntries(ids.map((id) => [id, "online"])))
        );
        const cache = new BotStatusCache(fetchStatus, () => 0);
        const ids = Array.from({ length: 120 }, (_, i) => `bot${i}`);
        const stores = ids.map((id) => cache.store(id));
        const stops = stores.map((store) => store.subscribe(() => undefined));
        await vi.waitFor(() => expect(get(stores[119])).toBe("online"));
        expect(fetchStatus.mock.calls.map(([asked]) => asked.length)).toEqual([50, 50, 20]);
        expect(fetchStatus.mock.calls.flatMap(([asked]) => asked)).toEqual(ids);
        stops.forEach((stop) => stop());
    });

    it("does not ask again for a bot whose answer is already on its way", async () => {
        const { fetchStatus, calls } = manualFetch();
        const cache = new BotStatusCache(fetchStatus, () => 0);
        const first = cache.store("a").subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
        const second = cache.store("a").subscribe(() => undefined);
        await Promise.resolve();
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        calls[0].answer({ a: "online" });
        await vi.waitFor(() => expect(get(cache.store("a"))).toBe("online"));
        first();
        second();
    });

    it("shows nothing for an answer it does not know", async () => {
        const cache = new BotStatusCache(
            () => Promise.resolve({ a: "weird" }),
            () => 0
        );
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(a)).toBeUndefined());
        stop();
    });
});

describe("BotStatusCache trust time", () => {
    it("keeps an answer for a minute, then asks again on the next look", async () => {
        let now = 0;
        const fetchStatus = vi.fn(() => Promise.resolve({ a: "online" }));
        const cache = new BotStatusCache(fetchStatus, () => now);
        const first = cache.store("a").subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
        first();

        now = 59_999;
        const within = cache.store("a").subscribe(() => undefined);
        await Promise.resolve();
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        within();

        now = 60_000;
        const after = cache.store("a").subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
        after();
    });

    it("asks again about a bot still on screen once its answer is a minute old, and stops when nothing shows it", async () => {
        vi.useFakeTimers();
        try {
            let now = 0;
            const fetchStatus = vi.fn(() => Promise.resolve({ a: "gone" }));
            const cache = new BotStatusCache(fetchStatus, () => now);
            const values: unknown[] = [];
            const stop = cache.store("a").subscribe((value) => values.push(value));
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchStatus).toHaveBeenCalledTimes(1);
            expect(values.at(-1)).toBe("gone");

            // A wrong "gone" (Orbit restarting) does not stay: the open chat hears the real state within the minute after
            fetchStatus.mockResolvedValue({ a: "online" } as never);
            now = 30_000;
            await vi.advanceTimersByTimeAsync(30_000);
            expect(fetchStatus).toHaveBeenCalledTimes(1);
            now = 60_000;
            await vi.advanceTimersByTimeAsync(30_000);
            expect(fetchStatus).toHaveBeenCalledTimes(2);
            expect(values.at(-1)).toBe("online");

            stop();
            now = 200_000;
            await vi.advanceTimersByTimeAsync(120_000);
            expect(fetchStatus).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps showing what it knew when a lookup fails, and asks again on the next look", async () => {
        let now = 0;
        const fetchStatus = vi.fn((): Promise<Answer> => Promise.resolve({ a: "resting" }));
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stops = [a.subscribe(() => undefined)];
        await vi.waitFor(() => expect(get(a)).toBe("resting"));

        fetchStatus.mockResolvedValueOnce(null);
        now = 61_000;
        stops.push(cache.store("a").subscribe(() => undefined));
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
        expect(get(a)).toBe("resting");

        // The failed lookup did not count as an answer, so the next look asks again at once.
        stops.push(cache.store("a").subscribe(() => undefined));
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(3));
        stops.forEach((stop) => stop());
    });

    it("treats a lookup that throws like one that failed", async () => {
        const fetchStatus = vi.fn((): Promise<Answer> => {
            throw new Error("offline");
        });
        const cache = new BotStatusCache(fetchStatus, () => 0);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
        expect(get(a)).toBeUndefined();
        stop();
    });
});

describe("BotStatusCache notes and lookups", () => {
    it("shows a note's state at once, and a note from before the latest lookup changes nothing", async () => {
        let now = 100_000;
        const fetchStatus = vi.fn((): Promise<Answer> => Promise.resolve({ a: "online" }));
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(a)).toBe("online"));

        // An old resting note, from before the lookup: the bot is back on, so it stays online.
        cache.learn("a", "resting", 50_000);
        expect(get(a)).toBe("online");

        // A new note: shown at once, with no new lookup.
        now = 110_000;
        cache.learn("a", "resting", 110_000);
        expect(get(a)).toBe("resting");
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        stop();
    });

    it("keeps a note written after a lookup started when that lookup answers late", async () => {
        let now = 1000;
        const { fetchStatus, calls } = manualFetch();
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));

        // The lookup started at 1000. The bot says it is gone at 1500; the lookup still reports it online.
        now = 1600;
        cache.learn("a", "gone", 1500);
        expect(get(a)).toBe("gone");
        calls[0].answer({ a: "online" });
        await Promise.resolve();
        await Promise.resolve();
        expect(get(a)).toBe("gone");
        stop();
    });

    it("keeps a note written at the very moment a lookup started", async () => {
        const now = 1000;
        const { fetchStatus, calls } = manualFetch();
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));

        cache.learn("a", "resting", 1000);
        calls[0].answer({ a: "online" });
        await Promise.resolve();
        await Promise.resolve();
        expect(get(a)).toBe("resting");
        stop();
    });

    it("lets a lookup that started after the note replace it", async () => {
        let now = 1000;
        const { fetchStatus, calls } = manualFetch();
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));

        // A note from before the lookup started shows meanwhile; the lookup knows better.
        cache.learn("a", "resting", 900);
        expect(get(a)).toBe("resting");
        now = 1200;
        calls[0].answer({ a: "online" });
        await vi.waitFor(() => expect(get(a)).toBe("online"));
        stop();
    });

    it("does not let a note seen again later override a newer lookup", async () => {
        let now = 1000;
        const fetchStatus = vi.fn((): Promise<Answer> => Promise.resolve({ a: "online" }));
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(get(a)).toBe("online"));
        // The note was written at 900 and read before the lookup finished; the chat reads it again at 5000.
        now = 5000;
        cache.learn("a", "resting", 4000);
        expect(get(a)).toBe("resting");
        now = 70_000;
        const again = cache.store("a").subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(get(a)).toBe("online"));
        cache.learn("a", "resting", 4000);
        expect(get(a)).toBe("online");
        again();
        stop();
    });

    it("treats a note dated in the future as written now", async () => {
        const now = 1000;
        const { fetchStatus, calls } = manualFetch();
        const cache = new BotStatusCache(fetchStatus, () => now);
        const a = cache.store("a");
        const stop = a.subscribe(() => undefined);
        await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
        cache.learn("a", "gone", 9_000_000);
        calls[0].answer({ a: "online" });
        await Promise.resolve();
        await Promise.resolve();
        // Written "now" (1000) is as new as the lookup (1000), so the note holds; a far-future date gains nothing more.
        expect(get(a)).toBe("gone");
        stop();
    });
});
