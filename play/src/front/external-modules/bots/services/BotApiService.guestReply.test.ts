import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the generated message types hang on these; the guest reply needs none of them
vi.mock("../../admin-api/orbitAccessToken", () => ({ freshOrbitAccessToken: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../Chat/Components/Room/Details/NearbySaved", () => ({ savedNearbyPage: vi.fn() }));
vi.mock("../../../Notification/Push/PushChat", () => ({ ChatPusherSchema: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

import { BotApiService } from "./BotApiService";

const SESSION = `orb_sess_v2_${"a".repeat(64)}`;

function jwtWith(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const REQUEST = {
    turnId: "turn-1",
    roomUrl: "/@/bawes/universe/hq",
    message: "Where's the coffee here?",
    history: [],
    saidNeedsAccount: false,
};

describe("BotApiService.guestBrickReply deadline (#1997)", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        sessionStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function service(): BotApiService {
        const api = new BotApiService();
        api.initialize(
            jwtWith({ identifier: "guest-uuid" }),
            "https://orbit.example.com",
            "https://play.example.com/@/u/w/r",
            "https://bots.example.com"
        );
        sessionStorage.setItem("orbit_admin_session_v2", SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
        return api;
    }

    it("stops waiting for a call that never answers, so the room can show its note and take the next turn", async () => {
        // A fetch that only ends when it is aborted
        fetchMock.mockImplementation(
            (_url: string, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    const onAbort = () => {
                        init?.signal?.removeEventListener("abort", onAbort);
                        reject(new DOMException("aborted", "AbortError"));
                    };
                    init?.signal?.addEventListener("abort", onAbort);
                })
        );
        const asking = service().guestBrickReply(REQUEST);
        const outcome = asking.then(
            () => "answered",
            () => "stopped"
        );
        await vi.advanceTimersByTimeAsync(120_000);
        await expect(outcome).resolves.toBe("stopped");
    });

    it("gives the answer when it comes in time", async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ kind: "reply", text: "Second row.", needsAccount: false }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        await expect(service().guestBrickReply(REQUEST)).resolves.toEqual({
            kind: "reply",
            text: "Second row.",
            needsAccount: false,
        });
    });
});
