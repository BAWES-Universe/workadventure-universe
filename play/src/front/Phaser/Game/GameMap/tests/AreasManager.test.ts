import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaData } from "@workadventure/map-editor";
import { Subject } from "rxjs";

const accessibleAreaIds = new Set<string>();
const labels: { text: string; destroyed: boolean }[] = [];

vi.mock("@workadventure/map-editor", () => ({
    AreaPermissions: class {
        isUserHasAreaAccess(areaId: string): boolean {
            return accessibleAreaIds.has(areaId);
        }
        isOverlappingArea(): boolean {
            return false;
        }
    },
    AREA_USERS_INSIDE_KEY: "usersInside",
    AREA_LOCK_KEY: "lock",
    getActiveLockableProperty: (area: AreaData) =>
        area.properties.find((p) => p.type === "lockableAreaPropertyData") as { id: string } | undefined,
    canTagsLockArea: (property: { allowedTags?: string[] }, tags: string[]) =>
        (property.allowedTags ?? []).length === 0 || (property.allowedTags ?? []).some((tag) => tags.includes(tag)),
    isAreaPropertyActive: () => true,
    getActiveMaxUsersProperty: (area: AreaData) => {
        const property = area.properties.find((p) => p.type === "maxUsersInAreaPropertyData") as
            | { id: string; maxUsers: number }
            | undefined;
        return property && property.maxUsers >= 1 ? property : undefined;
    },
    isPlayerPositionInArea: (position: { x: number; y: number }, area: AreaData) =>
        position.x >= area.x &&
        position.x <= area.x + area.width &&
        position.y + 16 >= area.y &&
        position.y + 16 <= area.y + area.height,
}));

vi.mock("../../../Entity/Area", () => ({
    Area: class {
        public destroy = vi.fn();
        public blockReason: string | undefined;
        constructor(public scene: unknown, public areaData: AreaData, public collide?: boolean) {
            this.blockReason = collide ? "noAccess" : undefined;
        }
        getBlockReason() {
            return this.blockReason;
        }
        setBlockReason(reason: string | undefined) {
            this.blockReason = reason;
        }
        setUnlockAction(action: (() => void) | undefined) {
            this.unlockAction = action;
        }
        public unlockAction: (() => void) | undefined;
    },
}));

vi.mock("../../../Components/AreaStatusLabel", () => ({
    AreaStatusLabel: class {
        private label: { text: string; destroyed: boolean };
        constructor(_layer: unknown, _x: number, _y: number, text: string) {
            this.label = { text, destroyed: false };
            labels.push(this.label);
        }
        setText(text: string) {
            this.label.text = text;
        }
        setPosition() {}
        destroy() {
            this.label.destroyed = true;
        }
    },
}));

vi.mock("../../../../Utils/PathfindingManager", () => ({ PathTileType: { Walkable: 0, Collider: 1 } }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            area: {
                fullLabel: ({ count, max }: { count: number; max: number }) => `Full · ${count}/${max}`,
                lockedLabel: () => "Locked",
                youLocked: ({ name }: { name: string }) => `You locked the ${name}`,
                youLockedUnnamed: () => "You locked this room",
            },
        }),
    };
});

vi.mock("../../../../Stores/MenuStore", () => ({ mapEditorActivatedForThematics: { set: vi.fn() } }));
vi.mock("../../../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => ({ uuid: "me" }) },
}));

function makeArea(id: string): AreaData {
    return { id, name: id, x: 0, y: 0, width: 32, height: 32, visible: true, properties: [] } as AreaData;
}

async function makeAreasManager(initialAreas: AreaData[] = []) {
    const { AreasManager } = await import("../AreasManager");
    const areas = new Map(initialAreas.map((area) => [area.id, area]));
    const gameMapAreas = {
        getAreas: () => areas,
        getArea: (id: string) => areas.get(id),
        isGameMapContainsSpecificAreas: () => false,
    };
    const scene = { connection: { getAllTags: () => [] } };
    return new AreasManager(scene as never, gameMapAreas as never, [], false);
}

// The Lounge: 3 tiles of 32 px wide and high, at the top left of the map, for at most 2 people, and lockable.
function lounge(lockTags: string[] = []): AreaData {
    return {
        id: "lounge",
        name: "Lounge",
        x: 0,
        y: 0,
        width: 96,
        height: 96,
        visible: true,
        properties: [
            { id: "max", type: "maxUsersInAreaPropertyData", maxUsers: 2 },
            { id: "lock", type: "lockableAreaPropertyData", allowedTags: lockTags },
        ],
    } as AreaData;
}

async function makeFullRoomManager(
    options: {
        canPassFullRooms?: boolean;
        isLogged?: boolean;
        tags?: string[];
        lockTags?: string[];
        player?: { x: number; y: number };
    } = {}
) {
    const { AreasManager } = await import("../AreasManager");
    const { AreaLiveState } = await import("../AreaLiveState");
    const { lockableRoomStore } = await import("../../../../Stores/LockableRoomStore");
    const area = lounge(options.lockTags);
    const areas = new Map([[area.id, area]]);
    const gameMapAreas = {
        getAreas: () => areas,
        getArea: (id: string) => areas.get(id),
        isGameMapContainsSpecificAreas: () => false,
        getCollidingAreas: () => [],
    };
    const player = { x: 48, y: 200, playText: vi.fn(), ...options.player };
    const scene = { connection: { getAllTags: () => [] }, CurrentPlayer: player, usernameDomLayer: {} };
    const updates = new Subject<{ areaId: string; propertyId: string; key: string; value: string }>();
    const liveState = new AreaLiveState([], updates);
    const onCollidingAreasChanged = vi.fn();
    const setLocked = vi.fn();
    const manager = new AreasManager(scene as never, gameMapAreas as never, options.tags ?? [], false, {
        liveState,
        managesRooms: options.canPassFullRooms ?? false,
        isLogged: options.isLogged ?? true,
        setLocked,
        onCollidingAreasChanged,
    });
    const setCount = (count: number) =>
        updates.next({ areaId: "lounge", propertyId: "max", key: "usersInside", value: String(count) });
    const setLock = (locked: boolean) =>
        updates.next({ areaId: "lounge", propertyId: "lock", key: "lock", value: String(locked) });
    return { manager, player, setCount, setLock, setLocked, onCollidingAreasChanged, lockableRoomStore };
}

describe("AreasManager", () => {
    beforeEach(() => {
        accessibleAreaIds.clear();
    });

    it("makes an area added at runtime collide only for users without access", async () => {
        const manager = await makeAreasManager();
        accessibleAreaIds.add("open");

        manager.addArea(makeArea("open"));
        manager.addArea(makeArea("restricted"));

        expect((manager.getAreaById("open") as unknown as { collide: boolean }).collide).toBe(false);
        expect((manager.getAreaById("restricted") as unknown as { collide: boolean }).collide).toBe(true);
    });

    it("keeps the other areas when one area is removed", async () => {
        const manager = await makeAreasManager([makeArea("a"), makeArea("b"), makeArea("c")]);
        const destroyRemoved = (manager.getAreaById("b") as unknown as { destroy: () => void }).destroy;

        manager.removeArea("b");

        expect(destroyRemoved).toHaveBeenCalled();
        expect(manager.getAreaById("b")).toBeUndefined();
        expect(manager.getAreaById("a")).toBeDefined();
        expect(manager.getAreaById("c")).toBeDefined();
    });

    describe("a room with Max people (#1621)", () => {
        beforeEach(() => {
            labels.length = 0;
            accessibleAreaIds.add("lounge");
        });

        it("stops a player outside once it is full, shows the count, and opens again when someone leaves", async () => {
            const { manager, setCount, onCollidingAreasChanged } = await makeFullRoomManager();
            expect(manager.getBlockReason("lounge")).toBeUndefined();
            expect(labels).toHaveLength(0);

            setCount(2);
            expect(manager.getBlockReason("lounge")).toBe("full");
            expect(manager.getCollidingAreas().map((area) => area.id)).toEqual(["lounge"]);
            expect(onCollidingAreasChanged).toHaveBeenCalledTimes(1);
            expect(labels).toEqual([{ text: "Full · 2/2", destroyed: false }]);

            setCount(1);
            expect(manager.getBlockReason("lounge")).toBeUndefined();
            expect(manager.getCollidingAreas()).toEqual([]);
            expect(onCollidingAreasChanged).toHaveBeenCalledTimes(2);
            expect(labels[0].destroyed).toBe(true);
        });

        it("never stops someone who is inside, and does not close the room behind them as they walk out", async () => {
            const { manager, player, setCount } = await makeFullRoomManager({ player: { x: 48, y: 40 } });
            setCount(2);
            expect(manager.getBlockReason("lounge")).toBeUndefined();

            player.y = 200;
            manager.onPlayerLeftArea("lounge");
            expect(manager.getBlockReason("lounge")).toBeUndefined();

            // The server counted them out, and the room is still full without them
            setCount(2);
            expect(manager.getBlockReason("lounge")).toBe("full");
        });

        it("lets the Owner and Admins walk in", async () => {
            const { manager, setCount } = await makeFullRoomManager({ canPassFullRooms: true });
            setCount(5);
            expect(manager.getBlockReason("lounge")).toBeUndefined();
            expect(labels).toEqual([{ text: "Full · 5/2", destroyed: false }]);
            expect(manager.getClosedAreaForArrivalAt(48, 40)).toBeUndefined();
        });

        it('lets "Who can enter" win over Full', async () => {
            accessibleAreaIds.delete("lounge");
            const { manager, setCount } = await makeFullRoomManager();
            setCount(2);
            expect(manager.getBlockReason("lounge")).toBe("noAccess");
        });

        it("puts a player arriving in the full room just outside it", async () => {
            const { manager, setCount } = await makeFullRoomManager();
            setCount(2);
            expect(manager.getClosedAreaForArrivalAt(48, 40)?.id).toBe("lounge");
            expect(manager.getClosedAreaForArrivalAt(48, 200)).toBeUndefined();

            // 5 by 5 tiles, nothing in the way but the room, which the grid marks as a wall for this player
            const grid = Array.from({ length: 5 }, (_, y) =>
                Array.from({ length: 5 }, (_, x) => (x < 3 && y < 3 ? 1 : 0))
            );
            const spot = manager.findArrivalSpot(48, 40, grid, { width: 32, height: 32 });
            expect(spot).toBeDefined();
            expect(manager.getClosedAreaForArrivalAt(spot?.x ?? 0, spot?.y ?? 0)).toBeUndefined();
            expect(manager.findArrivalSpot(48, 200, grid, { width: 32, height: 32 })).toEqual({ x: 48, y: 200 });
        });

        it("lets a player who is inside move anywhere in the room, even when it holds more than its limit", async () => {
            const { manager, setCount } = await makeFullRoomManager({ player: { x: 48, y: 40 } });
            setCount(2);
            expect(manager.getClosedAreaForArrivalAt(48, 40)).toBeUndefined();
            setCount(3);
            expect(manager.getClosedAreaForArrivalAt(48, 40)).toBeUndefined();
            expect(manager.getClosedAreaForArrivalAt(60, 50)).toBeUndefined();
        });

        it("puts a player who joins the map inside a room that is full without them just outside it", async () => {
            const { manager, setCount } = await makeFullRoomManager({ player: { x: 48, y: 40 } });
            // The server counts them in: 2 of 2 is them and one other, so they fit
            setCount(2);
            expect(manager.getClosedAreaForArrivalAt(48, 40, true)).toBeUndefined();
            setCount(3);
            expect(manager.getClosedAreaForArrivalAt(48, 40, true)?.id).toBe("lounge");
        });
    });

    describe("a lockable room (#1622)", () => {
        beforeEach(() => {
            labels.length = 0;
            accessibleAreaIds.add("lounge");
        });

        it("stops everyone outside once it is locked, the Owner and Admins too, and says Locked over Full", async () => {
            const { manager, setCount, setLock } = await makeFullRoomManager({ canPassFullRooms: true });
            setCount(2);
            expect(manager.getBlockReason("lounge")).toBeUndefined();
            expect(labels.at(-1)?.text).toBe("Full · 2/2");

            setLock(true);
            expect(manager.getBlockReason("lounge")).toBe("locked");
            expect(labels.at(-1)?.text).toBe("Locked");
            expect(manager.getClosedAreaForArrivalAt(48, 40)?.id).toBe("lounge");

            setLock(false);
            expect(manager.getBlockReason("lounge")).toBeUndefined();
        });

        it("offers the Owner and Admins at the edge to unlock it, and nobody else", async () => {
            const admin = await makeFullRoomManager({ canPassFullRooms: true });
            admin.setLock(true);
            const area = admin.manager.getAreaById("lounge") as unknown as { unlockAction?: () => void };
            expect(area.unlockAction).toBeDefined();
            area.unlockAction?.();
            expect(admin.setLocked).toHaveBeenCalledWith("lounge", "lock", false);

            const member = await makeFullRoomManager();
            member.setLock(true);
            expect(
                (member.manager.getAreaById("lounge") as unknown as { unlockAction?: () => void }).unlockAction
            ).toBe(undefined);
        });

        it("shows Lock room to someone inside who may lock it, and tells them once it is locked", async () => {
            const { manager, player, setLock, setLocked, lockableRoomStore } = await makeFullRoomManager({
                player: { x: 48, y: 40 },
                tags: ["member"],
                lockTags: ["member"],
            });
            manager.onPlayerEnteredArea("lounge");
            const { get } = await import("svelte/store");
            expect(get(lockableRoomStore)).toEqual({
                areaId: "lounge",
                name: "Lounge",
                locked: false,
                canToggle: true,
            });
            // Inside a locked room: never stopped, but joining the map there puts them outside
            setLock(true);
            expect(manager.getBlockReason("lounge")).toBeUndefined();
            expect(manager.getClosedAreaForArrivalAt(60, 50)).toBeUndefined();
            expect(manager.getClosedAreaForArrivalAt(48, 40, true)?.id).toBe("lounge");
            setLock(false);

            manager.toggleLockableRoom();
            expect(setLocked).toHaveBeenCalledWith("lounge", "lock", true);
            setLock(true);
            expect(player.playText).toHaveBeenCalledWith("area-locked-by-me", "You locked the Lounge", 3000);
            expect(get(lockableRoomStore)?.locked).toBe(true);

            player.y = 200;
            manager.onPlayerLeftArea("lounge");
            expect(get(lockableRoomStore)).toBeUndefined();
        });

        it("does not say they locked it after a lock they asked for never came and they walked out", async () => {
            const { manager, player, setLock } = await makeFullRoomManager({
                player: { x: 48, y: 40 },
                tags: ["member"],
                lockTags: ["member"],
            });
            manager.onPlayerEnteredArea("lounge");
            manager.toggleLockableRoom();
            player.y = 200;
            manager.onPlayerLeftArea("lounge");
            setLock(true);
            expect(player.playText).not.toHaveBeenCalledWith("area-locked-by-me", expect.anything(), expect.anything());
        });

        it("hides Lock room from guests and from people without one of the room's tags", async () => {
            const { get } = await import("svelte/store");
            const guest = await makeFullRoomManager({ player: { x: 48, y: 40 }, isLogged: false });
            guest.manager.onPlayerEnteredArea("lounge");
            expect(get(guest.lockableRoomStore)?.canToggle).toBe(false);

            const visitor = await makeFullRoomManager({ player: { x: 48, y: 40 }, lockTags: ["member"] });
            visitor.manager.onPlayerEnteredArea("lounge");
            expect(get(visitor.lockableRoomStore)?.canToggle).toBe(false);
        });
    });
});
