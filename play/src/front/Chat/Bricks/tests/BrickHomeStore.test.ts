import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickHome: vi.fn<(brickId: string) => Promise<unknown>>(),
    takeBrickOut: vi.fn<(brickId: string) => Promise<unknown>>(),
    notifyRoomEnter: vi.fn<(roomUrl: string) => Promise<void>>(),
    getRoomId: vi.fn<() => string | undefined>(),
    getRoomBricks: vi.fn<(roomUrl: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    brickHomeStore,
    forgetBrickHome,
    loadBrickHome,
    provideBrickLocator,
    refreshBrickHome,
    showBrickOnMap,
    takeBrickOutOfHome,
} from "../BrickHomeStore";

const HOME = { roomUrl: "/@/team/universe/room", roomName: "Reception", universeName: "Universe" };

describe("where a Brick lives (#2005)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetBrickHome();
        provideBrickLocator(() => false);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.getRoomId.mockReturnValue("/@/team/universe/room");
        game.notifyRoomEnter.mockResolvedValue(undefined);
    });

    it("knows nothing until Orbit answers, then its room, or null when it lives nowhere", async () => {
        expect(get(brickHomeStore)).toBeUndefined();
        game.getBrickHome.mockResolvedValue({ home: HOME });
        await loadBrickHome("b1");
        expect(get(brickHomeStore)).toEqual(HOME);
        game.getBrickHome.mockResolvedValue({ home: null });
        await loadBrickHome("b1");
        expect(get(brickHomeStore)).toBeNull();
    });

    it("never shows one Brick's room on another Brick's page", async () => {
        game.getBrickHome.mockResolvedValue({ home: HOME });
        await loadBrickHome("b1");
        game.getBrickHome.mockRejectedValue(new Error("offline"));
        await loadBrickHome("b2");
        expect(get(brickHomeStore)).toBeUndefined();
    });

    it("keeps what it knew when a later read fails for the same Brick", async () => {
        game.getBrickHome.mockResolvedValue({ home: HOME });
        await loadBrickHome("b1");
        game.getBrickHome.mockRejectedValue(new Error("offline"));
        await loadBrickHome("b1");
        expect(get(brickHomeStore)).toEqual(HOME);
    });

    it("takes it out, lets the bot server know, and shows it living nowhere", async () => {
        game.getBrickHome.mockResolvedValue({ home: HOME });
        game.takeBrickOut.mockResolvedValue({ ok: true });
        await loadBrickHome("b1");
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        expect(game.takeBrickOut).toHaveBeenCalledWith("b1");
        expect(game.notifyRoomEnter).toHaveBeenCalledWith("/@/team/universe/room");
        expect(get(brickHomeStore)).toBeNull();
    });

    it("tells the bot server about the room it lived in, not the room the person is in (Sentry on #2055)", async () => {
        game.getBrickHome.mockResolvedValue({
            home: { ...HOME, roomUrl: "/@/team/universe/studio", roomName: "Studio" },
        });
        game.takeBrickOut.mockResolvedValue({ ok: true });
        await loadBrickHome("b1");
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        expect(game.notifyRoomEnter).toHaveBeenCalledWith("/@/team/universe/studio");
        expect(game.notifyRoomEnter).not.toHaveBeenCalledWith("/@/team/universe/room");
    });

    it("never lets a read begun before the take-out put the old home back (Sentry on #2055)", async () => {
        game.getBrickHome.mockResolvedValueOnce({ home: HOME });
        await loadBrickHome("b1");
        let answerLate: (value: unknown) => void = () => undefined;
        game.getBrickHome.mockReturnValueOnce(
            new Promise((resolve) => {
                answerLate = resolve;
            })
        );
        const reopened = loadBrickHome("b1");
        game.takeBrickOut.mockResolvedValue({ ok: true });
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        answerLate({ home: HOME });
        await reopened;
        expect(get(brickHomeStore)).toBeNull();
    });

    it("when it has not read where the Brick lives, reads it first and tells that room (Dev desk on #2055)", async () => {
        game.getBrickHome.mockResolvedValue({
            home: { ...HOME, roomUrl: "/@/team/universe/studio", roomName: "Studio" },
        });
        game.takeBrickOut.mockResolvedValue({ ok: true });
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        expect(game.notifyRoomEnter).toHaveBeenCalledWith("/@/team/universe/studio");
        expect(game.notifyRoomEnter).not.toHaveBeenCalledWith("/@/team/universe/room");
    });

    it("does not hold the button on the bot server, which may take a few seconds for a room with nobody in it", async () => {
        game.getBrickHome.mockResolvedValue({ home: HOME });
        game.takeBrickOut.mockResolvedValue({ ok: true });
        game.notifyRoomEnter.mockReturnValue(new Promise<void>(() => {}));
        await loadBrickHome("b1");
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        expect(game.notifyRoomEnter).toHaveBeenCalledWith("/@/team/universe/room");
    });

    it("says it did not work, and changes nothing, when Orbit refused", async () => {
        game.getBrickHome.mockResolvedValue({ home: HOME });
        game.takeBrickOut.mockRejectedValue(new Error("offline"));
        await loadBrickHome("b1");
        expect(await takeBrickOutOfHome("b1")).toBe(false);
        expect(get(brickHomeStore)).toEqual(HOME);
        expect(game.notifyRoomEnter).not.toHaveBeenCalled();
    });

    it("still counts as taken out when the bot server could not be told", async () => {
        game.takeBrickOut.mockResolvedValue({ ok: true });
        game.notifyRoomEnter.mockRejectedValue(new Error("down"));
        expect(await takeBrickOutOfHome("b1")).toBe(true);
    });

    it("never lets a take-out of one Brick drop a read of the Brick the page was opened on meanwhile (CodeRabbit on #2055)", async () => {
        game.getBrickHome.mockResolvedValueOnce({ home: HOME });
        await loadBrickHome("b1");
        // The page moves to b2, whose read is slow; b1's take-out (begun on the page before) finishes meanwhile
        let answerLate: (value: unknown) => void = () => undefined;
        game.getBrickHome.mockReturnValueOnce(
            new Promise((resolve) => {
                answerLate = resolve;
            })
        );
        const opened = loadBrickHome("b2");
        game.takeBrickOut.mockResolvedValue({ ok: true });
        expect(await takeBrickOutOfHome("b1")).toBe(true);
        answerLate({ home: HOME });
        await opened;
        expect(get(brickHomeStore)).toEqual(HOME);
    });

    it("refreshes the home of the Brick the page is on, and never switches the page to another (CodeRabbit on #2055)", async () => {
        game.getBrickHome.mockResolvedValueOnce({ home: null });
        await loadBrickHome("b1");
        game.getBrickHome.mockResolvedValueOnce({ home: HOME });
        await refreshBrickHome("b1");
        expect(get(brickHomeStore)).toEqual(HOME);
        // The page is on b1: a refresh for b2 (a refusal that came late) is not wanted, and asks nothing
        game.getBrickHome.mockClear();
        await refreshBrickHome("b2");
        expect(game.getBrickHome).not.toHaveBeenCalled();
        expect(get(brickHomeStore)).toEqual(HOME);
    });

    it("keeps the home of the page's Brick when a refresh for it fails", async () => {
        game.getBrickHome.mockResolvedValueOnce({ home: HOME });
        await loadBrickHome("b1");
        game.getBrickHome.mockRejectedValueOnce(new Error("offline"));
        await refreshBrickHome("b1");
        expect(get(brickHomeStore)).toEqual(HOME);
    });

    describe("Show on map", () => {
        const studio = "/@/team/universe/studio";
        const row = (spot?: unknown) => ({
            here: [
                {
                    id: "b1",
                    name: "Recipes",
                    behaviorConfig: spot ? { assignedSpace: { center: spot, radius: 0 } } : {},
                },
            ],
            mine: [],
            roomName: "Reception",
        });

        it("asks the game to find it on the map", async () => {
            const find = vi.fn<(id: string) => boolean>().mockReturnValue(true);
            await expect(showBrickOnMap("b1")).resolves.toBe(false);
            provideBrickLocator(find);
            await expect(showBrickOnMap("b1")).resolves.toBe(true);
            expect(find).toHaveBeenCalledWith("b1");
        });

        it("goes to the spot Orbit keeps when the game has not been sent a Brick that lives here and is far away (CodeRabbit on #2055)", async () => {
            const toSpot = vi.fn<(spot: { x: number; y: number }) => boolean>().mockReturnValue(true);
            provideBrickLocator(() => false, toSpot);
            game.getBrickHome.mockResolvedValue({ home: HOME });
            await loadBrickHome("b1");
            game.getRoomBricks.mockResolvedValue(row({ x: 4000, y: 2500 }));
            await expect(showBrickOnMap("b1")).resolves.toBe(true);
            expect(game.getRoomBricks).toHaveBeenCalledWith("/@/team/universe/room");
            expect(toSpot).toHaveBeenCalledWith({ x: 4000, y: 2500 });
        });

        it("says no when the Brick lives in another room, or Orbit cannot say where it stands", async () => {
            const toSpot = vi.fn<(spot: { x: number; y: number }) => boolean>().mockReturnValue(true);
            provideBrickLocator(() => false, toSpot);
            game.getBrickHome.mockResolvedValue({ home: { ...HOME, roomUrl: studio, roomName: "Studio" } });
            await loadBrickHome("b1");
            await expect(showBrickOnMap("b1")).resolves.toBe(false);
            expect(game.getRoomBricks).not.toHaveBeenCalled();

            game.getBrickHome.mockResolvedValue({ home: HOME });
            await loadBrickHome("b1");
            game.getRoomBricks.mockResolvedValue(row());
            await expect(showBrickOnMap("b1")).resolves.toBe(false);
            game.getRoomBricks.mockRejectedValue(new Error("offline"));
            await expect(showBrickOnMap("b1")).resolves.toBe(false);
            expect(toSpot).not.toHaveBeenCalled();
        });
    });
});
