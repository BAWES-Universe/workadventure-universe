import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_FILTER_DELAY_MS, createSearchFilter } from "../SearchFilter";

describe("createSearchFilter", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("applies the text as it is once typing pauses, for any kind of change", async () => {
        const loading: boolean[] = [];
        const filter = createSearchFilter((value) => loading.push(value));
        const apply = vi.fn(() => Promise.resolve());

        // Typed, then autocorrected: only the final text is searched, shortly after.
        filter.schedule("Sar", apply);
        vi.advanceTimersByTime(100);
        filter.schedule("Sara", apply);
        vi.advanceTimersByTime(SEARCH_FILTER_DELAY_MS - 1);
        expect(apply).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith("Sara");

        await vi.runAllTimersAsync();
        expect(loading).toEqual([true, false]);
    });

    it("is quick: well under the old two-second wait", () => {
        expect(SEARCH_FILTER_DELAY_MS).toBeLessThanOrEqual(300);
    });

    it("ends the loading state with the latest search, not an older one that finishes later", async () => {
        let loading = false;
        const filter = createSearchFilter((value) => (loading = value));
        let finishFirst: () => void = () => undefined;
        const slow = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finishFirst = resolve;
                })
        );
        const fast = vi.fn(
            () =>
                new Promise<void>(() => {
                    // Still running.
                })
        );

        filter.schedule("a", slow);
        vi.advanceTimersByTime(SEARCH_FILTER_DELAY_MS);
        filter.schedule("ab", fast);
        vi.advanceTimersByTime(SEARCH_FILTER_DELAY_MS);

        finishFirst();
        await vi.runAllTimersAsync();

        expect(loading).toBe(true);
    });

    it("keeps loading when an older search finishes while the next one is still waiting for the pause", async () => {
        let loading = false;
        const filter = createSearchFilter((value) => (loading = value));
        let finishFirst: () => void = () => undefined;
        const slow = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finishFirst = resolve;
                })
        );
        const next = vi.fn(
            () =>
                new Promise<void>(() => {
                    // Still running.
                })
        );

        filter.schedule("a", slow);
        vi.advanceTimersByTime(SEARCH_FILTER_DELAY_MS);
        filter.schedule("ab", next);
        // The first search finishes during the second one's pause.
        finishFirst();
        await Promise.resolve();
        await Promise.resolve();
        expect(loading).toBe(true);

        await vi.runAllTimersAsync();
        expect(next).toHaveBeenCalledWith("ab");
        expect(loading).toBe(true);
    });

    it("drops a pending search when cleared", async () => {
        let loading = true;
        const filter = createSearchFilter((value) => (loading = value));
        const apply = vi.fn(() => Promise.resolve());

        filter.schedule("Sara", apply);
        filter.cancel();
        await vi.runAllTimersAsync();

        expect(apply).not.toHaveBeenCalled();
        expect(loading).toBe(false);
    });

    it("keeps working when a search fails", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let loading = false;
        const filter = createSearchFilter((value) => (loading = value));

        filter.schedule("Sara", () => Promise.reject(new Error("offline")));
        await vi.runAllTimersAsync();

        expect(loading).toBe(false);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
