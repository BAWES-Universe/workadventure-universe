import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getRoomId: vi.fn<() => string | null>(),
    getRoomBricks: vi.fn<(roomUrl: string) => Promise<unknown>>(),
    placeBrickHome: vi.fn<(id: string, roomUrl: string, spot: unknown) => Promise<unknown>>(),
    takeBrickOut: vi.fn<(id: string) => Promise<void>>(),
    notifyRoomEnter: vi.fn<(roomUrl: string) => Promise<unknown>>(),
}));
vi.mock("../services/BotApiService", () => ({ botApiService: api }));

import { forgetRoomBricks, loadRoomBricks, placeBrickHere, roomBricksStore, takeBrickOut } from "./RoomBricksStore";

const ROOM = "/@/team/universe/room";
const HOME = { roomUrl: "https://play.test/@/team/universe/room", roomName: "Headquarters", universeName: "Universe" };
const answer = (over: Record<string, unknown> = {}) => ({
    roomName: "Headquarters",
    here: [{ id: "b1", name: "Recipe Brick", characterTextureId: "brick-red", ownerName: "Khalid", mine: false, since: "2026-11-10T09:00:00.000Z" }],
    mine: [],
    ...over,
});

describe("the Bricks of the room being edited (#2005)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        forgetRoomBricks();
        api.getRoomId.mockReturnValue(ROOM);
        api.notifyRoomEnter.mockResolvedValue({ botsSpawned: 1 });
    });

    it("reads them for the room the person is in", async () => {
        api.getRoomBricks.mockResolvedValue(answer());
        await loadRoomBricks();
        expect(api.getRoomBricks).toHaveBeenCalledWith(ROOM);
        expect(get(roomBricksStore)?.here.map((row) => row.name)).toEqual(["Recipe Brick"]);
    });

    it("shows nothing about Bricks when Orbit refuses or can't be reached, or there is no room", async () => {
        api.getRoomBricks.mockRejectedValue(new Error("403"));
        await loadRoomBricks();
        expect(get(roomBricksStore)).toBeUndefined();
        api.getRoomId.mockReturnValue(null);
        await loadRoomBricks();
        expect(api.getRoomBricks).toHaveBeenCalledTimes(1);
    });

    it("never shows one room's Bricks in another room", async () => {
        api.getRoomBricks.mockResolvedValueOnce(answer());
        await loadRoomBricks();
        api.getRoomId.mockReturnValue("/@/team/universe/other");
        let late: (value: unknown) => void = () => undefined;
        api.getRoomBricks.mockReturnValueOnce(
            new Promise((resolve) => {
                late = resolve;
            })
        );
        const reading = loadRoomBricks();
        expect(get(roomBricksStore)).toBeUndefined();
        late(answer({ here: [] }));
        await reading;
        expect(get(roomBricksStore)?.here).toEqual([]);
    });

    it("gives a Brick a home at the picked spot, reads the room again and has the bot server put it on the map", async () => {
        api.placeBrickHome.mockResolvedValue({ home: HOME, keyNote: null });
        api.getRoomBricks.mockResolvedValue(answer());
        const spot = { behaviorType: "idle", behaviorConfig: { assignedSpace: { center: { x: 64, y: 96 }, radius: 0 } } };
        await expect(placeBrickHere({ id: "m1" }, spot)).resolves.toEqual({ ok: true, keyNotLent: false });
        expect(api.placeBrickHome).toHaveBeenCalledWith("m1", ROOM, spot);
        expect(api.getRoomBricks).toHaveBeenCalled();
        expect(api.notifyRoomEnter).toHaveBeenCalledWith(ROOM);
    });

    it("says when others cannot talk to it yet because its key is not lent", async () => {
        api.placeBrickHome.mockResolvedValue({ home: HOME, keyNote: "not_lent" });
        api.getRoomBricks.mockResolvedValue(answer());
        await expect(placeBrickHere({ id: "m1" }, {})).resolves.toEqual({ ok: true, keyNotLent: true });
    });

    it("fails plainly when it could not be placed", async () => {
        api.placeBrickHome.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
        await expect(placeBrickHere({ id: "m1" }, {})).resolves.toEqual({ ok: false });
        api.placeBrickHome.mockResolvedValue({ nonsense: true });
        await expect(placeBrickHere({ id: "m1" }, {})).resolves.toEqual({ ok: false });
        expect(api.notifyRoomEnter).not.toHaveBeenCalled();
    });

    it("takes a Brick out, reads the room again and has it taken off the map", async () => {
        api.takeBrickOut.mockResolvedValue(undefined);
        api.getRoomBricks.mockResolvedValue(answer({ here: [] }));
        await expect(takeBrickOut("b1")).resolves.toBe(true);
        expect(api.takeBrickOut).toHaveBeenCalledWith("b1");
        expect(get(roomBricksStore)?.here).toEqual([]);
        expect(api.notifyRoomEnter).toHaveBeenCalledWith(ROOM);
    });

    it("says false when it could not be taken out, and leaves the list as it is", async () => {
        api.takeBrickOut.mockRejectedValue(new Error("offline"));
        await expect(takeBrickOut("b1")).resolves.toBe(false);
        expect(api.getRoomBricks).not.toHaveBeenCalled();
    });
});
