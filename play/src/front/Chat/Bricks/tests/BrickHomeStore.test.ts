import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickHome: vi.fn<(brickId: string) => Promise<unknown>>(),
    takeBrickOut: vi.fn<(brickId: string) => Promise<unknown>>(),
    notifyRoomEnter: vi.fn<(roomUrl: string) => Promise<void>>(),
    getRoomId: vi.fn<() => string | undefined>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    brickHomeStore,
    forgetBrickHome,
    loadBrickHome,
    provideBrickLocator,
    showBrickOnMap,
    takeBrickOutOfHome,
} from "../BrickHomeStore";

const HOME = { roomUrl: "/@/team/universe/room", roomName: "Reception", universeName: "Universe" };

describe("where a Brick lives (#2005)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        forgetBrickHome();
        provideBrickLocator(() => false);
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

    it("asks the game to find it on the map for Show on map", () => {
        const find = vi.fn<(id: string) => boolean>().mockReturnValue(true);
        expect(showBrickOnMap("b1")).toBe(false);
        provideBrickLocator(find);
        expect(showBrickOnMap("b1")).toBe(true);
        expect(find).toHaveBeenCalledWith("b1");
    });
});
