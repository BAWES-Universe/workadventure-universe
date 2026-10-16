import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    isLogged: vi.fn(),
    hasCapability: vi.fn(),
}));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { currentMapRoom: { href: "http://play.test/@/u/w/r" } },
}));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { isLogged: mocks.isLogged, getAuthToken: () => "token" },
}));
vi.mock("../../../Connection/Capabilities", () => ({ hasCapability: mocks.hasCapability }));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.test/" }));

import { fetchWokaMine, wokaMineTimeoutMs } from "../WokaData";

const mine = {
    current: {
        textures: [{ id: "teal", url: "/teal.png" }],
        wearableHere: true,
    },
    recent: [{ textures: [{ id: "teal", url: "/teal.png" }], current: true }],
};

describe("fetchWokaMine", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mocks.isLogged.mockReturnValue(true);
        mocks.hasCapability.mockReturnValue(true);
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("does not ask for a guest", async () => {
        mocks.isLogged.mockReturnValue(false);
        expect(await fetchWokaMine()).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not ask when the server lacks the capability", async () => {
        mocks.hasCapability.mockReturnValue(false);
        expect(await fetchWokaMine()).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks for the room the player is in, with the token", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(mine) });
        const result = await fetchWokaMine();
        expect(result?.current?.textures[0].id).toBe("teal");
        expect(result?.recent).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "http://pusher.test/woka/mine?roomUrl=http%3A%2F%2Fplay.test%2F%40%2Fu%2Fw%2Fr",
            expect.objectContaining({ headers: { Authorization: "token" } })
        );
    });

    it("returns undefined when the server says no", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
        expect(await fetchWokaMine()).toBeUndefined();
    });

    it("returns undefined when the answer has the wrong shape", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ current: "nope" }) });
        expect(await fetchWokaMine()).toBeUndefined();
    });

    it("gives up after a few seconds instead of waiting forever", async () => {
        vi.useFakeTimers();
        try {
            fetchMock.mockImplementation(
                (_url: string, init: { signal: AbortSignal }) =>
                    new Promise((_resolve, reject) => {
                        init.signal.onabort = () => reject(new Error("aborted"));
                    })
            );
            const pending = fetchWokaMine();
            await vi.advanceTimersByTimeAsync(wokaMineTimeoutMs);
            expect(await pending).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it("returns undefined when the request fails", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        expect(await fetchWokaMine()).toBeUndefined();
    });
});
