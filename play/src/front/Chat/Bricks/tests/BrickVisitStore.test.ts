import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getRoomId: vi.fn<() => string | undefined>(),
    getBrickVisit: vi.fn<(brickId: string, roomUrl: string) => Promise<unknown>>(),
    startBrickVisit: vi.fn<(brickId: string, roomUrl: string) => Promise<unknown>>(),
    endBrickVisit: vi.fn<(brickId: string) => Promise<unknown>>(),
    getBrickHome: vi.fn<(brickId: string) => Promise<unknown>>(),
    syncVisitingBrick:
        vi.fn<(position?: { x: number; y: number }, options?: { ending?: boolean }) => Promise<boolean | undefined>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: api }));

import { brickHomeStore, forgetBrickHome, loadBrickHome } from "../BrickHomeStore";
import {
    bringBrickAlong,
    brickVisitStore,
    endBrickVisit,
    forgetBrickVisit,
    loadBrickVisit,
    provideOwnPosition,
} from "../BrickVisitStore";

const ROOM = "/@/team/universe/room";
const A = "0b7c1d2e-1111-4222-8333-944455556666";
const B = "1c8d2e3f-2222-4333-8444-a55566667777";

describe("what the Brick page knows about visiting (#2005)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        forgetBrickVisit();
        forgetBrickHome();
        provideOwnPosition(() => ({ x: 100, y: 200 }));
        api.getRoomId.mockReturnValue(ROOM);
        api.syncVisitingBrick.mockResolvedValue(true);
    });

    it("reads Orbit's answer for the room the person is in", async () => {
        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await loadBrickVisit(A);
        expect(api.getBrickVisit).toHaveBeenCalledWith(A, ROOM);
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
    });

    it("never lets a slow read put an older state back over the visit just begun (Sentry on #2023)", async () => {
        let answerLate: (value: unknown) => void = () => undefined;
        api.getBrickVisit.mockReturnValueOnce(
            new Promise((resolve) => {
                answerLate = resolve;
            })
        );
        const slow = loadBrickVisit(A);
        api.startBrickVisit.mockResolvedValue({ state: "visiting", place: "Universe" });
        expect(await bringBrickAlong(A)).toBeUndefined();
        expect(get(brickVisitStore)?.state).toBe("visiting");
        answerLate({ state: "none", place: "Universe" });
        await slow;
        expect(get(brickVisitStore)?.state).toBe("visiting");
    });

    it("keeps the newest read when two reads answer out of order", async () => {
        const answers: Array<(value: unknown) => void> = [];
        api.getBrickVisit.mockImplementation(
            () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                })
        );
        const first = loadBrickVisit(A);
        const second = loadBrickVisit(A);
        answers[1]({ state: "visiting", place: "Universe" });
        await second;
        answers[0]({ state: "none", place: "Universe" });
        await first;
        expect(get(brickVisitStore)?.state).toBe("visiting");
    });

    it("knows nothing without a room, and keeps quiet when Orbit can't be reached", async () => {
        api.getRoomId.mockReturnValue(undefined);
        await loadBrickVisit(A);
        expect(api.getBrickVisit).not.toHaveBeenCalled();
        expect(get(brickVisitStore)).toBeUndefined();

        api.getRoomId.mockReturnValue(ROOM);
        api.getBrickVisit.mockRejectedValue(new Error("offline"));
        await expect(loadBrickVisit(A)).resolves.toBeUndefined();
        expect(get(brickVisitStore)).toBeUndefined();
    });

    it("never shows one Brick's answer on another Brick's page", async () => {
        api.getBrickVisit.mockResolvedValueOnce({ state: "visiting", place: "Universe" });
        await loadBrickVisit(A);
        expect(get(brickVisitStore)?.state).toBe("visiting");

        let answer: (value: unknown) => void = () => undefined;
        api.getBrickVisit.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const reading = loadBrickVisit(B);
        // The page moved to B: A's answer is gone while B's is on its way
        expect(get(brickVisitStore)).toBeUndefined();
        answer({ state: "none", place: "Universe" });
        await reading;
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
    });

    it("drops an answer that came back after the page moved to another Brick", async () => {
        let late: (value: unknown) => void = () => undefined;
        api.getBrickVisit.mockReturnValueOnce(
            new Promise((resolve) => {
                late = resolve;
            })
        );
        const first = loadBrickVisit(A);
        api.getBrickVisit.mockResolvedValueOnce({ state: "none", place: "Universe" });
        await loadBrickVisit(B);
        late({ state: "visiting", place: "Universe" });
        await first;
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
    });

    it("brings a Brick along from where the person stands", async () => {
        api.startBrickVisit.mockResolvedValue({ state: "visiting", place: "Universe" });
        await loadBrickVisit(A);
        await expect(bringBrickAlong(A)).resolves.toBeUndefined();
        expect(api.startBrickVisit).toHaveBeenCalledWith(A, ROOM);
        expect(api.syncVisitingBrick).toHaveBeenCalledWith({ x: 100, y: 200 });
        expect(get(brickVisitStore)).toEqual({ state: "visiting", place: "Universe" });
    });

    it("says the Brick is not on the map yet when the bot server does not put it there, after asking twice (Sentry on #2023)", async () => {
        vi.useFakeTimers();
        try {
            api.startBrickVisit.mockResolvedValue({ state: "visiting", place: "Universe" });
            api.syncVisitingBrick.mockResolvedValue(false);
            api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
            await loadBrickVisit(A);
            const outcome = bringBrickAlong(A);
            await vi.advanceTimersByTimeAsync(1500);
            await expect(outcome).resolves.toBe("not_yet");
            expect(api.syncVisitingBrick).toHaveBeenCalledTimes(2);
            // The visit itself is Orbit's and stands: the Brick joins on the next room
            expect(get(brickVisitStore)).toEqual({ state: "visiting", place: "Universe" });

            api.syncVisitingBrick.mockReset();
            api.syncVisitingBrick.mockResolvedValue(undefined);
            const unsure = bringBrickAlong(A);
            await vi.advanceTimersByTimeAsync(1500);
            await expect(unsure).resolves.toBe("not_yet");
        } finally {
            vi.useRealTimers();
        }
    });

    it("is satisfied when the bot server puts the Brick on the map the second time it is asked", async () => {
        vi.useFakeTimers();
        try {
            api.startBrickVisit.mockResolvedValue({ state: "visiting", place: "Universe" });
            api.syncVisitingBrick.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            const outcome = bringBrickAlong(A);
            await vi.advanceTimersByTimeAsync(1500);
            await expect(outcome).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it("says why when the place does not take visits or the Brick is off", async () => {
        const conflict = Object.assign(new Error("conflict"), { status: 409 });
        api.startBrickVisit.mockRejectedValue(conflict);
        api.getBrickVisit.mockResolvedValue({ state: "blocked", place: "Universe" });
        await expect(bringBrickAlong(A)).resolves.toBe("not_taken");

        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await expect(bringBrickAlong(A)).resolves.toBe("off");
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it("names the room it lives in when Orbit refuses a Brick that has a home, and reads where it lives", async () => {
        api.startBrickVisit.mockRejectedValue(
            Object.assign(new Error("conflict"), { status: 409, reason: "lives_in", place: "Studio" })
        );
        const home = { roomUrl: "/@/team/universe/studio", roomName: "Studio", universeName: "Universe" };
        api.getBrickHome.mockResolvedValueOnce({ home: null });
        await loadBrickHome(A);
        api.getBrickHome.mockResolvedValue({ home });
        await expect(bringBrickAlong(A)).resolves.toEqual({ livesIn: "Studio" });
        expect(api.getBrickHome).toHaveBeenLastCalledWith(A);
        expect(get(brickHomeStore)).toEqual(home);
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it("a refusal that comes late, after the page moved to another Brick, does not switch the page to the first one (CodeRabbit on #2055)", async () => {
        const mine = { roomUrl: "/@/team/universe/studio", roomName: "Studio", universeName: "Universe" };
        // A is on the page, and its request to be brought along is on its way
        let refuse: (error: unknown) => void = () => undefined;
        api.startBrickVisit.mockReturnValue(
            new Promise((_, reject) => {
                refuse = reject;
            })
        );
        api.getBrickHome.mockResolvedValueOnce({ home: null });
        await loadBrickHome(A);
        const bringing = bringBrickAlong(A);
        // The page moves to B, with its own home, before the refusal for A comes back
        api.getBrickHome.mockResolvedValueOnce({ home: mine });
        await loadBrickHome(B);
        api.getBrickHome.mockClear();
        api.getBrickHome.mockResolvedValue({ home: { ...mine, roomName: "Library" } });
        refuse(Object.assign(new Error("conflict"), { status: 409, reason: "lives_in", place: "Library" }));
        await expect(bringing).resolves.toEqual({ livesIn: "Library" });
        expect(api.getBrickHome).not.toHaveBeenCalled();
        expect(get(brickHomeStore)).toEqual(mine);
    });

    it("fails plainly for anything else: no room, a broken answer, a server error", async () => {
        api.getRoomId.mockReturnValue(undefined);
        await expect(bringBrickAlong(A)).resolves.toBe("failed");
        api.getRoomId.mockReturnValue(ROOM);
        api.startBrickVisit.mockResolvedValue({ nonsense: true });
        await expect(bringBrickAlong(A)).resolves.toBe("failed");
        api.startBrickVisit.mockRejectedValue(new Error("boom"));
        await expect(bringBrickAlong(A)).resolves.toBe("failed");
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it("ends a visit, reads the page's answer again and has the Brick taken off the map", async () => {
        api.endBrickVisit.mockResolvedValue({ state: "none", place: null });
        api.getBrickVisit.mockResolvedValueOnce({ state: "visiting", place: "Universe" });
        await loadBrickVisit(A);
        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await expect(endBrickVisit(A)).resolves.toBe(true);
        expect(api.endBrickVisit).toHaveBeenCalledWith(A);
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
        expect(api.syncVisitingBrick).toHaveBeenCalledWith(undefined, { ending: true });
    });

    it("stops saying the Brick walks here once the visit is ended, even when reading the page's answer again fails", async () => {
        api.endBrickVisit.mockResolvedValue({ state: "none", place: null });
        api.getBrickVisit.mockResolvedValueOnce({ state: "visiting", place: "Universe" });
        await loadBrickVisit(A);
        expect(get(brickVisitStore)).toEqual({ state: "visiting", place: "Universe" });
        api.getBrickVisit.mockRejectedValue(new Error("offline"));
        await expect(endBrickVisit(A)).resolves.toBe(true);
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
        expect(api.syncVisitingBrick).toHaveBeenCalledWith(undefined, { ending: true });
    });

    it("asks once more to take the Brick off the map when the bot server did not answer the first time (Sentry on #2023)", async () => {
        api.endBrickVisit.mockResolvedValue({ state: "none", place: null });
        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        api.syncVisitingBrick.mockResolvedValueOnce(undefined).mockResolvedValueOnce(true);
        await expect(endBrickVisit(A)).resolves.toBe(true);
        expect(api.syncVisitingBrick).toHaveBeenCalledTimes(2);
        expect(api.syncVisitingBrick).toHaveBeenNthCalledWith(2, undefined, { ending: true });
    });

    it("says false when a visit could not be ended, and leaves the map alone", async () => {
        api.endBrickVisit.mockRejectedValue(new Error("offline"));
        await expect(endBrickVisit(A)).resolves.toBe(false);
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it("a visit ended for one Brick after the page moved to another changes nothing on the other's page (CodeRabbit on #2023)", async () => {
        let ended: (value: unknown) => void = () => undefined;
        api.endBrickVisit.mockReturnValueOnce(
            new Promise((resolve) => {
                ended = resolve;
            })
        );
        const ending = endBrickVisit(A);
        api.getBrickVisit.mockResolvedValueOnce({ state: "visiting", place: "Universe" });
        await loadBrickVisit(B);
        expect(get(brickVisitStore)).toEqual({ state: "visiting", place: "Universe" });
        // A's DELETE completes now; the read that follows is A's, and B's page must stay B's
        api.getBrickVisit.mockResolvedValueOnce({ state: "none", place: "Universe" });
        ended({ state: "none", place: null });
        await expect(ending).resolves.toBe(true);
        expect(get(brickVisitStore)).toEqual({ state: "visiting", place: "Universe" });
        expect(api.syncVisitingBrick).toHaveBeenCalledWith(undefined, { ending: true });
    });

    it("a read for a Brick the page left does not make another Brick's slow read count as old (CodeRabbit on #2023)", async () => {
        let slow: (value: unknown) => void = () => undefined;
        api.getBrickVisit.mockReturnValueOnce(
            new Promise((resolve) => {
                slow = resolve;
            })
        );
        const onB = loadBrickVisit(B);
        // A's ended visit reads A's answer while B's read is still on its way
        api.endBrickVisit.mockResolvedValue({ state: "none", place: null });
        api.getBrickVisit.mockResolvedValueOnce({ state: "none", place: "Universe" });
        await endBrickVisit(A);
        slow({ state: "blocked", place: "Universe" });
        await onB;
        expect(get(brickVisitStore)).toEqual({ state: "blocked", place: "Universe" });
    });

    it("the reason a bring along was refused comes from the answer read, even when the page has moved to another Brick", async () => {
        const conflict = Object.assign(new Error("conflict"), { status: 409 });
        api.startBrickVisit.mockRejectedValue(conflict);
        api.getBrickVisit.mockResolvedValueOnce({ state: "none", place: "Universe" });
        await loadBrickVisit(B);
        api.getBrickVisit.mockResolvedValueOnce({ state: "blocked", place: "Universe" });
        await expect(bringBrickAlong(A)).resolves.toBe("not_taken");
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
    });

    it("tries the page's visit read once more when it failed, so the controls do not stay hidden (CodeRabbit on #2023)", async () => {
        vi.useFakeTimers();
        try {
            api.getBrickVisit.mockRejectedValueOnce(new Error("Orbit did not answer in time"));
            api.getBrickVisit.mockResolvedValueOnce({ state: "none", place: "Universe" });
            const loading = loadBrickVisit(A);
            await vi.advanceTimersByTimeAsync(0);
            expect(get(brickVisitStore)).toBeUndefined();
            await vi.advanceTimersByTimeAsync(3000);
            await loading;
            expect(api.getBrickVisit).toHaveBeenCalledTimes(2);
            expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });

            // Only once, and not for a page that has moved on
            api.getBrickVisit.mockReset();
            api.getBrickVisit.mockRejectedValue(new Error("down"));
            const again = loadBrickVisit(A);
            await vi.advanceTimersByTimeAsync(0);
            api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
            await loadBrickVisit(B);
            await vi.advanceTimersByTimeAsync(3000);
            await again;
            expect(api.getBrickVisit.mock.calls.filter(([id]) => id === A)).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
