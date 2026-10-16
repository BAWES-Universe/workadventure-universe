import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAttentionCount = vi.hoisted(() => vi.fn<() => Promise<number | null>>());

vi.mock("../external-modules/bots/services/BotApiService", () => ({ botApiService: { getAttentionCount } }));
vi.mock("./ModalStore", async () => {
    const { writable } = await import("svelte/store");
    return { modalVisibilityStore: writable(false), modalIframeStore: writable<{ title: string } | null>(null) };
});

import { modalIframeStore, modalVisibilityStore } from "./ModalStore";
import { orbitAttentionCountStore } from "./OrbitAttentionStore";

const frame = (title: string) =>
    ({
        title,
        src: "https://example.test",
        position: "right",
        allowApi: false,
        allow: null,
        allowFullScreen: false,
    } as const);

describe("orbitAttentionCountStore", () => {
    let seen: number[];
    let unsubscribe: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        getAttentionCount.mockReset();
        modalVisibilityStore.set(false);
        modalIframeStore.set(null);
        seen = [];
    });
    afterEach(() => {
        unsubscribe?.();
        vi.useRealTimers();
    });

    it("asks when the bar shows, and keeps 0 while Orbit can't answer yet, then tries again sooner", async () => {
        getAttentionCount.mockResolvedValueOnce(null).mockResolvedValueOnce(2);
        unsubscribe = orbitAttentionCountStore.subscribe((value) => seen.push(value));
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([0]);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(getAttentionCount).toHaveBeenCalledTimes(2);
        expect(seen).toEqual([0, 2]);
    });

    it("asks again every two minutes once answered", async () => {
        getAttentionCount.mockResolvedValue(1);
        unsubscribe = orbitAttentionCountStore.subscribe((value) => seen.push(value));
        await vi.advanceTimersByTimeAsync(0);
        getAttentionCount.mockResolvedValue(3);
        await vi.advanceTimersByTimeAsync(119_000);
        expect(seen.at(-1)).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(seen.at(-1)).toBe(3);
    });

    it("asks as soon as Orbit closes, so an answer given there shows at once", async () => {
        getAttentionCount.mockResolvedValue(2);
        unsubscribe = orbitAttentionCountStore.subscribe((value) => seen.push(value));
        await vi.advanceTimersByTimeAsync(0);
        modalIframeStore.set(frame("Orbit"));
        modalVisibilityStore.set(true);
        getAttentionCount.mockResolvedValue(1);
        modalVisibilityStore.set(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(seen.at(-1)).toBe(1);
    });

    it("doesn't ask when another window closes", async () => {
        getAttentionCount.mockResolvedValue(2);
        unsubscribe = orbitAttentionCountStore.subscribe((value) => seen.push(value));
        await vi.advanceTimersByTimeAsync(0);
        modalIframeStore.set(frame("Website"));
        modalVisibilityStore.set(true);
        modalVisibilityStore.set(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(getAttentionCount).toHaveBeenCalledTimes(1);
    });

    it("stops asking once nothing shows the count", async () => {
        getAttentionCount.mockResolvedValue(2);
        unsubscribe = orbitAttentionCountStore.subscribe((value) => seen.push(value));
        await vi.advanceTimersByTimeAsync(0);
        unsubscribe();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(getAttentionCount).toHaveBeenCalledTimes(1);
    });
});
