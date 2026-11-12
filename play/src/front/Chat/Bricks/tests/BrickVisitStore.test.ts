import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getRoomId: vi.fn<() => string | undefined>(),
    getBrickVisit: vi.fn<(brickId: string, roomUrl: string) => Promise<unknown>>(),
    startBrickVisit: vi.fn<(brickId: string, roomUrl: string) => Promise<unknown>>(),
    endBrickVisit: vi.fn<(brickId: string) => Promise<unknown>>(),
    syncVisitingBrick: vi.fn<(position?: { x: number; y: number }) => Promise<void>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: api }));

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
        provideOwnPosition(() => ({ x: 100, y: 200 }));
        api.getRoomId.mockReturnValue(ROOM);
        api.syncVisitingBrick.mockResolvedValue(undefined);
    });

    it("reads Orbit's answer for the room the person is in", async () => {
        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await loadBrickVisit(A);
        expect(api.getBrickVisit).toHaveBeenCalledWith(A, ROOM);
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
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

    it("says why when the place does not take visits or the Brick is off", async () => {
        const conflict = Object.assign(new Error("conflict"), { status: 409 });
        api.startBrickVisit.mockRejectedValue(conflict);
        api.getBrickVisit.mockResolvedValue({ state: "blocked", place: "Universe" });
        await expect(bringBrickAlong(A)).resolves.toBe("not_taken");

        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await expect(bringBrickAlong(A)).resolves.toBe("off");
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
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
        api.getBrickVisit.mockResolvedValue({ state: "none", place: "Universe" });
        await expect(endBrickVisit(A)).resolves.toBe(true);
        expect(api.endBrickVisit).toHaveBeenCalledWith(A);
        expect(get(brickVisitStore)).toEqual({ state: "none", place: "Universe" });
        expect(api.syncVisitingBrick).toHaveBeenCalledWith();
    });

    it("says false when a visit could not be ended, and leaves the map alone", async () => {
        api.endBrickVisit.mockRejectedValue(new Error("offline"));
        await expect(endBrickVisit(A)).resolves.toBe(false);
        expect(api.syncVisitingBrick).not.toHaveBeenCalled();
    });
});
