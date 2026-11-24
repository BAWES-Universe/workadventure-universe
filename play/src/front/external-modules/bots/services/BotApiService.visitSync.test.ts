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
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response(JSON.stringify({ present: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            )
        );
        vi.stubGlobal("fetch", fetchMock);
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const enter = (api: BotApiService, room: string) =>
        api.initialize(jwtWith({ identifier: "u" }), "https://orbit.example.com", room, "https://bots.example.com");
    const bodyOfLastCall = () =>
        JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string) as Record<string, unknown>;

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
    describe("a Brick that walks with its person here is looked after", () => {
        const walkTo = (standing: { at?: { x: number; y: number } }, x: number, y: number) => {
            standing.at = { x, y };
        };

        const answer = (present: boolean) =>
            fetchMock.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ present }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    })
                )
            );

        it("is synced again every minute with where the player stands now, so a Brick that dropped off the map is put back", async () => {
            const api = signedIn();
            const standing: { at: { x: number; y: number } } = { at: { x: 10, y: 20 } };
            api.setOwnPlaceProvider(() => standing.at);
            await api.syncVisitingBrick(standing.at);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            walkTo(standing, 30, 40);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(bodyOfLastCall()).toMatchObject({ roomId: ROOM_A, x: 30, y: 40 });
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("asks nothing when the game does not know where the player is yet, and tries again a minute on", async () => {
            const api = signedIn();
            const standing: { at?: { x: number; y: number } } = {};
            api.setOwnPlaceProvider(() => standing.at);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            walkTo(standing, 5, 6);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("looks again in a minute when walking in or bringing along could not be answered at all", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 7, y: 8 }));
            fetchMock.mockImplementationOnce(() => Promise.reject(new Error("bot server down")));
            await expect(api.syncVisitingBrick({ x: 1, y: 1 }, { entry: true })).resolves.toBeUndefined();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(bodyOfLastCall()).toMatchObject({ x: 7, y: 8 });
        });

        it("does not start the looking after for a walk in that failed after the visit ended", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 7, y: 8 }));
            let fail: (error: Error) => void = () => undefined;
            fetchMock.mockImplementationOnce(
                () =>
                    new Promise<Response>((_resolve, reject) => {
                        fail = reject;
                    })
            );
            const walkIn = api.syncVisitingBrick({ x: 1, y: 1 }, { entry: true });
            await api.syncVisitingBrick(undefined, { ending: true });
            fail(new Error("bot server down"));
            await expect(walkIn).resolves.toBeUndefined();
            fetchMock.mockClear();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("keeps looking after a Brick through a moment when the bot server could not look, and counts only answers in a row (Sentry on #2023)", async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            answer(true);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            const start = fetchMock.mock.calls.length;
            // Two "not here" answers (a failed room check), then it is back: still looked after
            answer(false);
            await vi.advanceTimersByTimeAsync(120_000);
            answer(true);
            await vi.advanceTimersByTimeAsync(60_000);
            answer(false);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(fetchMock).toHaveBeenCalledTimes(start + 5);
            answer(true);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(start + 6);
        });

        const answerWith = (body: Record<string, unknown>) =>
            fetchMock.mockImplementation(() =>
                Promise.resolve(
                    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
                )
            );

        it("looks again in a minute when walking into a room the Brick could not be put in yet, and only then (CodeRabbit on #2023)", async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            // Not in the game's list of the room yet, or Orbit could not be asked: a later check may place the Brick
            answerWith({ present: false, reason: "not_seen" });
            await api.syncVisitingBrick({ x: 1, y: 1 }, { entry: true });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            answerWith({ present: true });
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            await api.syncVisitingBrick(undefined, { ending: true });

            // Nothing to bring along (no reason), or bringing along / ending rather than walking in: no looking after
            const quiet = signedIn();
            quiet.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            fetchMock.mockClear();
            answerWith({ present: false });
            await quiet.syncVisitingBrick({ x: 1, y: 1 }, { entry: true });
            answerWith({ present: false, reason: "orbit_unavailable" });
            await quiet.syncVisitingBrick({ x: 1, y: 1 });
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("ignores the answer to a sync that was sent before the room changed or the visit ended (CodeRabbit on #2023)", async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            const reply = (body: Record<string, unknown>) =>
                new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
            let late: (response: Response) => void = () => undefined;
            const held = () =>
                fetchMock.mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            late = resolve;
                        })
                );

            // A "here" that arrives after the visit was ended does not start the looking after again
            held();
            const sync = api.syncVisitingBrick({ x: 1, y: 1 });
            await api.syncVisitingBrick(undefined, { ending: true });
            late(reply({ present: true }));
            await sync;
            const afterEnd = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(afterEnd);

            // A "not here" that arrives after the player walked into the next room does not stop that room's looking after
            answerWith({ present: true });
            enter(api, ROOM_B);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            held();
            const oldSync = api.syncVisitingBrick({ x: 1, y: 1 });
            enter(api, ROOM_A);
            answerWith({ present: true });
            await api.syncVisitingBrick({ x: 1, y: 1 });
            late(reply({ present: false }));
            await oldSync;
            const before = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(before + 1);
        });

        it("does not let a check sent before a Bring along stop the looking after that Bring along starts, when its third miss is answered first", async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            const reply = (body: Record<string, unknown>) =>
                new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
            answerWith({ present: true });
            await api.syncVisitingBrick({ x: 1, y: 1 });
            // Two misses in a row from the checks
            answerWith({ present: false });
            await vi.advanceTimersByTimeAsync(120_000);
            // The third check is on its way when the person brings the Brick along
            let thirdCheck: (response: Response) => void = () => undefined;
            let bringAlong: (response: Response) => void = () => undefined;
            fetchMock
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            thirdCheck = resolve;
                        })
                )
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            bringAlong = resolve;
                        })
                );
            await vi.advanceTimersByTimeAsync(60_000);
            const bringing = api.syncVisitingBrick({ x: 1, y: 1 });
            // The check says "not here" (its third miss) before the Bring along is answered, and the Bring along says "here"
            thirdCheck(reply({ present: false }));
            await vi.advanceTimersByTimeAsync(0);
            bringAlong(reply({ present: true }));
            await bringing;
            answerWith({ present: true });
            const before = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(60_000);
            // Still looked after: what the older check said is not about the Brick that was just brought
            expect(fetchMock).toHaveBeenCalledTimes(before + 1);
        });

        it('does not drop a Bring along\'s "here" because a check sent after it ended the looking after with its own third miss', async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            const reply = (body: Record<string, unknown>) =>
                new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
            answerWith({ present: true });
            await api.syncVisitingBrick({ x: 1, y: 1 });
            // Two misses in a row from the checks
            answerWith({ present: false });
            await vi.advanceTimersByTimeAsync(120_000);
            // The Bring along is sent just before the third check is due, and waits; the check goes out after it
            let bringAlong: (response: Response) => void = () => undefined;
            let thirdCheck: (response: Response) => void = () => undefined;
            fetchMock
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            bringAlong = resolve;
                        })
                )
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            thirdCheck = resolve;
                        })
                );
            await vi.advanceTimersByTimeAsync(59_000);
            const bringing = api.syncVisitingBrick({ x: 1, y: 1 });
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(1_000);
            // The third check says "not here" and ends the looking after; then the Bring along says "here"
            thirdCheck(reply({ present: false }));
            await vi.advanceTimersByTimeAsync(0);
            bringAlong(reply({ present: true }));
            await bringing;
            answerWith({ present: true });
            const before = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(60_000);
            // The Bring along started the looking after again: the Brick is checked on
            expect(fetchMock).toHaveBeenCalledTimes(before + 1);
        });

        it("never starts for someone with no Brick on the map, and stops when the Brick is gone, the visit ends or the room changes", async () => {
            const api = signedIn();
            api.setOwnPlaceProvider(() => ({ x: 1, y: 1 }));
            answer(false);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // Present, then not (the visit ended on another device): it stops after a few "not here" answers in a row
            answer(true);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            answer(false);
            const beforeGone = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(beforeGone + 3);
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(beforeGone + 3);

            // Present, then the visit is ended here
            answer(true);
            await api.syncVisitingBrick({ x: 1, y: 1 });
            await api.syncVisitingBrick(undefined, { ending: true });
            const afterEnd = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(afterEnd);

            // Present, then the player walks into another room: the next room starts its own
            await api.syncVisitingBrick({ x: 1, y: 1 });
            enter(api, ROOM_B);
            const afterMove = fetchMock.mock.calls.length;
            await vi.advanceTimersByTimeAsync(180_000);
            expect(fetchMock).toHaveBeenCalledTimes(afterMove);
        });
    });

    it("gives up on the visit calls that never answer, so the Brick page's controls recover (CodeRabbit on #2023)", async () => {
        const api = signedIn();
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>(() => {
                    // never answers
                })
        );
        const outcomes = [
            expect(api.getBrickVisit("brick-1", ROOM_A)).rejects.toThrow("Orbit did not answer in time"),
            expect(api.startBrickVisit("brick-1", ROOM_A)).rejects.toThrow("Orbit did not answer in time"),
            expect(api.endBrickVisit("brick-1")).rejects.toThrow("Orbit did not answer in time"),
        ];
        await vi.advanceTimersByTimeAsync(20_000);
        await Promise.all(outcomes);
    });

    it("gives up on a sync the bot server never answers, so bring along and end visit do not wait for good (CodeRabbit on #2023)", async () => {
        const api = signedIn();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>(() => {
                    // never answers
                })
        );
        const sync = api.syncVisitingBrick({ x: 1, y: 1 });
        const ending = api.syncVisitingBrick(undefined, { ending: true });
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(sync).resolves.toBeUndefined();
        await expect(ending).resolves.toBeUndefined();
    });
});
