import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const getBot = vi.fn();
vi.mock("./services/BotApiService", () => ({
    botApiService: {
        getBot: (...args: unknown[]) => getBot(...args),
        getBotServerUrl: () => null,
        getEmotionsHeaders: () => Promise.resolve({}),
    },
}));
vi.mock("../../Connection/LocalUserStore", () => ({ localUserStore: { getLocalUser: () => ({ uuid: "me" }) } }));

import { PENDING_ANSWER_TIMEOUT_MS } from "../../Stores/WokaMenuStore";
import { botCardInfo } from "./botCardInfo";

describe("a bot's card info", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        getBot.mockReset();
    });

    it("is loading until the description and feelings are in, then shows both", async () => {
        getBot.mockResolvedValue({ description: " Keeps our list. " });
        const store = botCardInfo("attio");
        const seen: unknown[] = [];
        const stop = store.subscribe((value) => seen.push(value));
        expect(seen[0]).toEqual({ loading: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(get(store)).toEqual({ loading: false, description: "Keeps our list.", emotions: null });
        stop();
    });

    it("stops waiting for a bot server that never answers", async () => {
        getBot.mockReturnValue(new Promise<never>(() => {}));
        const store = botCardInfo("stalled");
        const stop = store.subscribe(() => undefined);
        await vi.advanceTimersByTimeAsync(PENDING_ANSWER_TIMEOUT_MS - 1);
        expect(get(store).loading).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(get(store)).toEqual({ loading: false });
        stop();
    });
});
