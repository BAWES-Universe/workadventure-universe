import { describe, expect, it, vi } from "vitest";
import { leaveAreaSpaceIfJoined } from "../../../../src/front/Phaser/Game/MapEditor/leaveAreaSpace";
import type { SpaceInterface } from "../../../../src/front/Space/SpaceInterface";
import { SpaceDoesNotExistError } from "../../../../src/front/Space/Errors/SpaceError";

function registry(joined: Map<string, SpaceInterface>) {
    return {
        exist: vi.fn((name: string) => joined.has(name)),
        // The real registry throws when the space is not there.
        get: vi.fn((name: string): SpaceInterface => {
            const space = joined.get(name);
            if (!space) throw new SpaceDoesNotExistError(name);
            return space;
        }),
        leaveSpace: vi.fn((space: SpaceInterface): Promise<void> => {
            for (const [name, value] of joined) if (value === space) joined.delete(name);
            return Promise.resolve();
        }),
    };
}

describe("leaveAreaSpaceIfJoined (#1064)", () => {
    it("leaves the zone's space when this player is in it", async () => {
        const space = {} as SpaceInterface;
        const spaces = registry(new Map([["area__zone", space]]));
        await leaveAreaSpaceIfJoined(spaces, "area__zone");
        expect(spaces.leaveSpace).toHaveBeenCalledWith(space);
    });

    it("does nothing, and does not throw, when the space is already gone", async () => {
        const spaces = registry(new Map());
        await expect(leaveAreaSpaceIfJoined(spaces, "area__zone")).resolves.toBeUndefined();
        expect(spaces.get).not.toHaveBeenCalled();
        expect(spaces.leaveSpace).not.toHaveBeenCalled();
    });

    it("leaving twice quickly leaves once and logs no error", async () => {
        const spaces = registry(new Map([["area__zone", {} as SpaceInterface]]));
        await Promise.all([leaveAreaSpaceIfJoined(spaces, "area__zone"), leaveAreaSpaceIfJoined(spaces, "area__zone")]);
        expect(spaces.leaveSpace).toHaveBeenCalledTimes(1);
    });

    it("lets a real failure of the leave itself through", async () => {
        const spaces = registry(new Map([["area__zone", {} as SpaceInterface]]));
        spaces.leaveSpace.mockRejectedValue(new Error("destroy failed"));
        await expect(leaveAreaSpaceIfJoined(spaces, "area__zone")).rejects.toThrow("destroy failed");
    });
});
