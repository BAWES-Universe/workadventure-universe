import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../admin-api/orbitAccessToken", () => ({ freshOrbitAccessToken: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../Chat/Components/Room/Details/NearbySaved", () => ({ savedNearbyPage: vi.fn() }));
vi.mock("../../../Notification/Push/PushChat", () => ({ ChatPusherSchema: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

import { BotApiService } from "./BotApiService";

const SESSION = `orb_sess_v2_${"a".repeat(64)}`;
const ROOM_A = "https://play.example.com/@/u/w/lobby";
const ROOM_B = "https://play.example.com/@/u/w/cafe";

function jwtWith(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

describe("BotApiService.syncVisitingBrick tells the bot server when the player came into the room", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ present: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
        vi.stubGlobal("fetch", fetchMock);
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const enter = (api: BotApiService, room: string) => api.initialize(jwtWith({ identifier: "u" }), "https://orbit.example.com", room, "https://bots.example.com");
    const bodyOfLastCall = () => JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string) as Record<string, unknown>;

    function signedIn(): BotApiService {
        const api = new BotApiService();
        enter(api, ROOM_A);
        sessionStorage.setItem("orbit_admin_session_v2", SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
        return api;
    }

    it("sends the moment the player came into this room, and which page load says so, with every sync, and the moment of the next room after they walk on", async () => {
        const api = signedIn();
        const inA = Date.now();
        vi.setSystemTime(new Date(inA + 60_000));
        await api.syncVisitingBrick({ x: 10, y: 20 });
        expect(bodyOfLastCall()).toMatchObject({ roomId: ROOM_A, x: 10, y: 20, enteredAt: inA });
        const pageLoad = bodyOfLastCall().clientId as string;
        expect(pageLoad).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

        // Initialising again for the same room (a re-sign-in, a token refresh) is not coming in again
        enter(api, ROOM_A);
        await api.syncVisitingBrick({ x: 10, y: 20 });
        expect(bodyOfLastCall()).toMatchObject({ enteredAt: inA, clientId: pageLoad });

        // Walking into another room is
        vi.setSystemTime(new Date(inA + 120_000));
        enter(api, ROOM_B);
        await api.syncVisitingBrick({ x: 1, y: 2 });
        expect(bodyOfLastCall()).toMatchObject({ roomId: ROOM_B, enteredAt: inA + 120_000, clientId: pageLoad });

        // Another page load (another tab, another device) names itself differently
        const other = signedIn();
        await other.syncVisitingBrick({ x: 1, y: 2 });
        expect(bodyOfLastCall().clientId).not.toBe(pageLoad);
    });

    it("sends no time when ending a visit: it only takes the Brick off, wherever the player stands", async () => {
        const api = signedIn();
        await api.syncVisitingBrick(undefined, { ending: true });
        expect(bodyOfLastCall()).toEqual({ roomId: ROOM_A, ending: true });
    });
});
