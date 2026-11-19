import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

import { BotApiService } from "./BotApiService";

const ORBIT_A = "https://orbit-a.example.com";
const ORBIT_B = "https://orbit-b.example.com";
const BOTS = "https://bots.example.com";
const ROOM_A = "https://play.example.com/@/u/w/lobby";
const ROOM_B = "https://play.example.com/@/u/w/cafe";
const SESSION_OLD = `orb_sess_v2_${"a".repeat(64)}`;
const SESSION_NEW = `orb_sess_v2_${"b".repeat(64)}`;
const SESSION_OF_B = `orb_sess_v2_${"e".repeat(64)}`;
// An OIDC access token that does not say when it runs out, wrapped like the game's token
const b64u = (input: unknown) => btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const accessTokenOf = (sub: string) => `${b64u({ alg: "none" })}.${b64u({ sub })}.sig`;
const gameTokenOf = (sub: string) => `header.${btoa(JSON.stringify({ accessToken: accessTokenOf(sub) }))}.signature`;
const ANNA = gameTokenOf("anna");
const BEN = gameTokenOf("ben");

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const urlOf = (input: unknown): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
const keepSession = (session: string) => {
    sessionStorage.setItem("orbit_admin_session_v2", session);
    sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
};

describe("a request never goes to the Orbit, or with the session, of an account the game left while it was on its way", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** The session lookup of the first account ends with its session just after the game moved to another account or Orbit. */
    const movedWhileLooking = (api: BotApiService, move: () => void) =>
        vi
            .spyOn(api as unknown as { getAdminApiSessionToken: () => Promise<string> }, "getAdminApiSessionToken")
            .mockImplementation(() => {
                move();
                return Promise.resolve(SESSION_OLD);
            });

    it("sends nothing to the Orbit the game moved to while the session was being looked up (the first account's session is never taken there)", async () => {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        movedWhileLooking(api, () => api.initialize(ANNA, ORBIT_B, ROOM_B, BOTS));
        fetchMock.mockImplementation(() => Promise.resolve(json([])));
        await expect(api.listMyBricks()).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("leaves the session of the account the game is on alone when a refusal comes after the game moved, and sends nothing again", async () => {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        keepSession(SESSION_OLD);
        const seen: string[] = [];
        fetchMock.mockImplementation((input: unknown) => {
            const url = urlOf(input);
            seen.push(url);
            // Orbit refuses the session of the first account; the game has moved to another account on another Orbit by then, and
            // that one has its own session in the cache
            api.initialize(BEN, ORBIT_B, ROOM_B, BOTS);
            keepSession(SESSION_OF_B);
            return Promise.resolve(json({ error: "Invalid session" }, 401));
        });
        await expect(
            api.addMyApp({
                name: "My app",
                serverUrl: "https://tools.example.com/mcp",
                authType: "none",
                requestKey: "a".repeat(32),
            })
        ).rejects.toMatchObject({ isAuthError: true, status: 401 });
        expect(seen).toEqual([`${ORBIT_A}/api/me/apps`]);
        expect(sessionStorage.getItem("orbit_admin_session_v2")).toBe(SESSION_OF_B);
    });

    it("gives the owner's own refusal (403) of a bot-server call that was retried with a renewed session, not 'sign in again'", async () => {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        keepSession(SESSION_OLD);
        fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
            const url = urlOf(input);
            if (url === `${ORBIT_A}/api/auth/session`) {
                return Promise.resolve(json({ version: 2, sessionId: SESSION_NEW, expiresAt: Date.now() + 3600_000 }));
            }
            const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
            return Promise.resolve(
                authorization === `Bearer ${SESSION_OLD}`
                    ? json({ error: "Invalid session" }, 401)
                    : json({ error: "Only its owner may do this", code: "not_allowed" }, 403)
            );
        });
        await expect(api.declineBrickOffer("brick-1", "topic")).rejects.toMatchObject({
            status: 403,
            code: "not_allowed",
            message: "Only its owner may do this",
        });
    });

    it("sends a bot-server call to nobody when the game changed account while the session was being looked up", async () => {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        movedWhileLooking(api, () => api.initialize(BEN, ORBIT_A, ROOM_A, BOTS));
        fetchMock.mockImplementation(() => Promise.resolve(json({})));
        await expect(api.declineBrickOffer("brick-1", "topic")).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("a call that waits for the session stops at its deadline too", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("gives up on a guest's Brick reply when the session lookup never answers", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>(() => {
                        // the session of Orbit never answers, and it does not listen for an abort
                    })
            )
        );
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        let outcome: unknown = "pending";
        api.guestBrickReply({
            turnId: "t",
            roomUrl: "/@/u/w/r",
            message: "hi",
            history: [],
            saidNeedsAccount: false,
        }).then(
            () => (outcome = "answered"),
            (error: Error) => (outcome = error.message)
        );
        await vi.advanceTimersByTimeAsync(131_000);
        expect(outcome).toMatch(/did not answer in time/);
    });

    it("frees the time zone's slot when the session lookup or the request never answers, so a later ask can try again", async () => {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        const lookup = vi
            .spyOn(api as unknown as { getAdminApiSessionToken: () => Promise<string> }, "getAdminApiSessionToken")
            .mockImplementation(
                () =>
                    new Promise<string>(() => {
                        // never answers
                    })
            );
        let first = false;
        void api.keepTimeZone().then(() => (first = true));
        await vi.advanceTimersByTimeAsync(21_000);
        expect(first).toBe(true);
        let second = false;
        void api.keepTimeZone().then(() => (second = true));
        await vi.advanceTimersByTimeAsync(0);
        // The slot was free: a second try was made (and waits for the session as well)
        expect(lookup).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(21_000);
        expect(second).toBe(true);
    });
});

describe("the looking after of a Brick's visit follows who is signed in and which sync is the latest", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        fetchMock.mockImplementation(() => Promise.resolve(json({ present: true })));
        vi.stubGlobal("fetch", fetchMock);
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function signedIn(): BotApiService {
        const api = new BotApiService();
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        keepSession(SESSION_OLD);
        api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
        return api;
    }
    const held = () => {
        let late: (response: Response) => void = () => undefined;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    late = resolve;
                })
        );
        return (response: Response) => late(response);
    };

    it("does not go on speaking for the account that was signed in when another one takes its place in the same room", async () => {
        const api = signedIn();
        await api.syncVisitingBrick({ x: 1, y: 1 });
        // Another account in the same room: the checks of the first one are not the second one's
        api.initialize(BEN, ORBIT_A, ROOM_A, BOTS);
        keepSession(SESSION_NEW);
        const before = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(180_000);
        expect(fetchMock).toHaveBeenCalledTimes(before);
    });

    it("goes on for the same account in the same room when the game initialises again", async () => {
        const api = signedIn();
        await api.syncVisitingBrick({ x: 1, y: 1 });
        api.initialize(ANNA, ORBIT_A, ROOM_A, BOTS);
        const before = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });

    it("lets an older walk-in answer 'not here' change nothing once a later Bring along has put the Brick on the map", async () => {
        const api = signedIn();
        const releaseEntry = held();
        const entry = api.syncVisitingBrick({ x: 1, y: 1 }, { entry: true });
        // The person brings the Brick along before the first sync is answered
        await api.syncVisitingBrick({ x: 1, y: 1 });
        releaseEntry(json({ present: false }));
        await entry;
        const before = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });

    it("lets a late answer to the end of a visit stop nothing of the next room's visit", async () => {
        const api = signedIn();
        await api.syncVisitingBrick({ x: 1, y: 1 });
        const releaseEnd = held();
        const ending = api.syncVisitingBrick(undefined, { ending: true });
        api.initialize(ANNA, ORBIT_A, ROOM_B, BOTS);
        await api.syncVisitingBrick({ x: 2, y: 2 });
        releaseEnd(json({ present: false }));
        await ending;
        const before = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });

    it("stops the looking after of an ended visit even when the end's sync never answers", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const api = signedIn();
        await api.syncVisitingBrick({ x: 1, y: 1 });
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>(() => {
                    // the bot server never answers
                })
        );
        const ending = api.syncVisitingBrick(undefined, { ending: true });
        await vi.advanceTimersByTimeAsync(20_000);
        await ending;
        const before = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(180_000);
        expect(fetchMock).toHaveBeenCalledTimes(before);
    });
});
