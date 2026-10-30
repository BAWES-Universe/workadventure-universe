import type { AreaData, AtLeast, GameMapAreas } from "@workadventure/map-editor";
import {
    AreaPermissions,
    canTagsLockArea,
    getActiveLockableProperty,
    getActiveMaxUsersProperty,
    isAreaPropertyActive,
    isPlayerPositionInArea,
} from "@workadventure/map-editor";
import type { Subscription } from "rxjs";
import { get } from "svelte/store";
import type { AreaBlockReason } from "../../Entity/Area";
import { Area } from "../../Entity/Area";
import { AreaStatusLabel } from "../../Components/AreaStatusLabel";
import type { GameScene } from "../GameScene";
import { mapEditorActivatedForThematics } from "../../../Stores/MenuStore";
import { lockableRoomStore } from "../../../Stores/LockableRoomStore";
import { localUserStore } from "../../../Connection/LocalUserStore";
import LL from "../../../../i18n/i18n-svelte";
import { PathTileType } from "../../../Utils/PathfindingManager";
import type { AreaLiveState } from "./AreaLiveState";
import { findNearestFreeTile } from "./NearestFreeSpot";

/** How far below a room's top edge its "Full" or "Locked" pill sits, in game pixels. */
const STATUS_LABEL_OFFSET_Y = 4;

/** How long "You locked the Lounge" stays over the player. */
const LOCKED_MESSAGE_DURATION = 3000;

/**
 * What rooms that keep people out need from the game: full rooms (#1621) and locked rooms (#1622). Without it,
 * neither is applied (a public map).
 */
export interface AreaCapacityOptions {
    liveState: AreaLiveState;
    /** The Owner and Admins walk into full rooms and unlock locked rooms from outside. */
    managesRooms: boolean;
    /** Signed in: only then can the player lock a room. */
    isLogged: boolean;
    /** Asks the server to lock or unlock a room. */
    setLocked: (areaId: string, propertyId: string, locked: boolean) => void;
    /** The areas the player cannot walk into changed: the pathfinding grid has to follow. */
    onCollidingAreasChanged: () => void;
}

/**
 * This class handles the display
 * of Phaser Areas objects
 */
export class AreasManager {
    private areas: Area[] = [];
    private areaPermissions: AreaPermissions;
    private readonly statusLabels = new Map<string, AreaStatusLabel>();
    /**
     * Full rooms the player has just walked out of. The server still counts them inside until it hears they left, so
     * the room is not closed behind them before the new count arrives.
     */
    private readonly justLeft = new Set<string>();
    /** The room this player asked to lock, to tell them once it is. */
    private lockAskedFor: string | undefined;
    private liveStateSubscription: Subscription | undefined;

    constructor(
        private scene: GameScene,
        private gameMapAreas: GameMapAreas,
        private userConnectedTags: string[],
        private userCanEdit: boolean,
        private capacity?: AreaCapacityOptions
    ) {
        this.areaPermissions = new AreaPermissions(gameMapAreas, userConnectedTags, userCanEdit);
        this.initializeAreas();
        this.liveStateSubscription = capacity?.liveState.changes.subscribe((areaId) => {
            this.justLeft.delete(areaId);
            this.refreshAreaState(areaId);
            this.tellLockedByMe(areaId);
        });
        this.refreshLockableRoom();
    }

    public addArea(areaData: AreaData): void {
        const area = new Area(
            this.scene,
            areaData,
            !this.areaPermissions.isUserHasAreaAccess(areaData.id),
            this.areaPermissions.isOverlappingArea(areaData.id)
        );
        this.areas.push(area);
        this.refreshAreaState(areaData.id);
        this.updateMapEditorOptionForSpecificAreas();
    }

    public updateArea(updatedArea: AtLeast<AreaData, "id">): void {
        const indexOfAreaToUpdate = this.areas.findIndex((area) => area.areaData.id === updatedArea.id);
        if (indexOfAreaToUpdate === -1) {
            console.error("Unable to find area to update : ", updatedArea.id);
            return;
        }
        const areaToUpdate = this.areas[indexOfAreaToUpdate];
        areaToUpdate.updateArea(
            updatedArea,
            this.areaPermissions.isUserHasAreaAccess(updatedArea.id) ? undefined : "noAccess"
        );
        this.refreshAreaState(updatedArea.id);
        this.refreshLockableRoom();
        this.updateMapEditorOptionForSpecificAreas();
    }

    public removeArea(deletedAreaId: string): void {
        const removedAreaIndex = this.areas.findIndex((area) => area.areaData.id === deletedAreaId);
        if (removedAreaIndex === -1) {
            console.error("Unable to find area to remove : ", deletedAreaId);
            return;
        }
        this.areas[removedAreaIndex].destroy();
        this.areas = this.areas.filter((area) => area.areaData.id !== deletedAreaId);
        this.statusLabels.get(deletedAreaId)?.destroy();
        this.statusLabels.delete(deletedAreaId);
        this.justLeft.delete(deletedAreaId);
        this.refreshLockableRoom();
        this.updateMapEditorOptionForSpecificAreas();
    }

    /** Stops listening to the rooms' state and removes their pills. The areas themselves go with the scene. */
    public destroy(): void {
        this.liveStateSubscription?.unsubscribe();
        this.liveStateSubscription = undefined;
        for (const label of this.statusLabels.values()) {
            label.destroy();
        }
        this.statusLabels.clear();
        lockableRoomStore.set(undefined);
    }

    /** The player walked into an area. */
    public onPlayerEnteredArea(areaId: string): void {
        this.justLeft.delete(areaId);
        this.refreshAreaState(areaId);
        this.refreshLockableRoom();
    }

    /** The player walked out of an area. */
    public onPlayerLeftArea(areaId: string): void {
        if (this.isFull(areaId)) {
            this.justLeft.add(areaId);
        }
        this.refreshAreaState(areaId);
        this.refreshLockableRoom();
    }

    /**
     * Why the player cannot walk into the area now, if they cannot. "Who can enter" first: a room the player may not
     * enter says so, locked or full or not. Then locked, which stops everyone, the Owner and Admins too (they unlock
     * it instead). Then full, which the Owner and Admins walk into. Neither ever stops someone who is already inside:
     * they can always walk out.
     */
    public getBlockReason(areaId: string): AreaBlockReason | undefined {
        if (!this.areaPermissions.isUserHasAreaAccess(areaId)) {
            return "noAccess";
        }
        const areaData = this.gameMapAreas.getArea(areaId);
        if (this.capacity === undefined || areaData === undefined) {
            return undefined;
        }
        const player = this.scene.CurrentPlayer;
        if (player !== undefined && isPlayerPositionInArea({ x: player.x, y: player.y }, areaData)) {
            return undefined;
        }
        if (this.isLocked(areaId)) {
            return "locked";
        }
        if (!this.capacity.managesRooms && !this.justLeft.has(areaId) && this.isFull(areaId)) {
            return "full";
        }
        return undefined;
    }

    /**
     * The locked or full room that a player arriving at this point would end up in, if there is one: teleports,
     * "walk to" and start points must not put them there.
     *
     * @param joining the player has just joined the map where they stand, so the server already counts them in the
     *   rooms there: they stay only if the room is not locked, and not full without them. Otherwise the player walks
     *   or is moved from where they stand, and can go anywhere in a room they are already in, even one holding more
     *   people than its limit (an Admin walked in, or the limit was lowered): a lock never shuts anyone in.
     */
    public getClosedAreaForArrivalAt(x: number, y: number, joining = false): AreaData | undefined {
        if (this.capacity === undefined) {
            return undefined;
        }
        const player = this.scene.CurrentPlayer;
        for (const areaData of this.gameMapAreas.getAreas().values()) {
            if (!isPlayerPositionInArea({ x, y }, areaData)) {
                continue;
            }
            const playerInside = player !== undefined && isPlayerPositionInArea({ x: player.x, y: player.y }, areaData);
            if (playerInside && !joining) {
                continue;
            }
            if (this.isLocked(areaData.id)) {
                return areaData;
            }
            if (!this.capacity.managesRooms && this.isFull(areaData.id, playerInside ? 1 : 0)) {
                return areaData;
            }
        }
        return undefined;
    }

    /** The room flashes and says it is locked or full, for a teleport or "walk to" it turned away. */
    public showClosedMessage(areaId: string): void {
        this.getAreaById(areaId)?.showClosedMessage(this.isLocked(areaId) ? "locked" : "full");
    }

    /** Locks or unlocks the lockable room the player stands in ("Lock room", #1622). */
    public toggleLockableRoom(): void {
        const room = get(lockableRoomStore);
        const areaData = room && this.gameMapAreas.getArea(room.areaId);
        const property = areaData && getActiveLockableProperty(areaData);
        if (room === undefined || property === undefined || !room.canToggle || this.capacity === undefined) {
            return;
        }
        this.lockAskedFor = room.locked ? undefined : room.areaId;
        this.capacity.setLocked(room.areaId, property.id, !room.locked);
    }

    /**
     * Where to put a player who would arrive at this point in a locked or full room: the closest spot they can walk to
     * outside every such room. The point itself when none is in the way, undefined if there is no such spot. See
     * getClosedAreaForArrivalAt for `joining`.
     */
    public findArrivalSpot(
        x: number,
        y: number,
        grid: number[][],
        tile: { width: number; height: number },
        joining = false
    ): { x: number; y: number } | undefined {
        if (this.getClosedAreaForArrivalAt(x, y, joining) === undefined) {
            return { x, y };
        }
        const toPosition = (tileX: number, tileY: number) => ({
            x: tileX * tile.width + tile.width / 2,
            y: tileY * tile.height + tile.height / 2,
        });
        const isInFullRoom = (tileX: number, tileY: number) => {
            const position = toPosition(tileX, tileY);
            return this.getClosedAreaForArrivalAt(position.x, position.y, joining) !== undefined;
        };
        const free = findNearestFreeTile(
            { width: grid[0]?.length ?? 0, height: grid.length },
            { x: Math.floor(x / tile.width), y: Math.floor(y / tile.height) },
            // A closed room is a wall in the grid for a player outside it: walk through it, not through real walls.
            (tileX, tileY) => grid[tileY][tileX] !== PathTileType.Collider || isInFullRoom(tileX, tileY),
            (tileX, tileY) => !isInFullRoom(tileX, tileY)
        );
        return free && toPosition(free.x, free.y);
    }

    /** Whether the room is full, not counting `except` of the people inside (the player, when they are counted in). */
    private isFull(areaId: string, except = 0): boolean {
        const areaData = this.gameMapAreas.getArea(areaId);
        if (areaData === undefined || this.capacity === undefined) {
            return false;
        }
        const property = getActiveMaxUsersProperty(areaData);
        if (property === undefined) {
            return false;
        }
        return this.capacity.liveState.getCount(areaId, property.id) - except >= property.maxUsers;
    }

    private isLocked(areaId: string): boolean {
        const areaData = this.gameMapAreas.getArea(areaId);
        const property = areaData && getActiveLockableProperty(areaData);
        return (
            property !== undefined &&
            this.capacity !== undefined &&
            this.capacity.liveState.isLocked(areaId, property.id)
        );
    }

    /** "You locked the Lounge", once the room this player asked to lock is locked. */
    private tellLockedByMe(areaId: string): void {
        if (this.lockAskedFor !== areaId || !this.isLocked(areaId)) {
            return;
        }
        this.lockAskedFor = undefined;
        const name = roomName(this.gameMapAreas.getArea(areaId));
        this.scene.CurrentPlayer?.playText(
            "area-locked-by-me",
            name !== "" ? get(LL).area.youLocked({ name }) : get(LL).area.youLockedUnnamed(),
            LOCKED_MESSAGE_DURATION
        );
    }

    /** The lockable room the player stands in, for the "Lock room" button. */
    private refreshLockableRoom(): void {
        const player = this.scene.CurrentPlayer;
        if (this.capacity === undefined || player === undefined) {
            lockableRoomStore.set(undefined);
            return;
        }
        for (const areaData of this.gameMapAreas.getAreas().values()) {
            const property = getActiveLockableProperty(areaData);
            if (property === undefined || !isPlayerPositionInArea({ x: player.x, y: player.y }, areaData)) {
                continue;
            }
            const locked = this.capacity.liveState.isLocked(areaData.id, property.id);
            // Same rule as the server (AreaOccupancy.setLocked), for someone inside.
            const canToggle =
                this.capacity.managesRooms ||
                (this.capacity.isLogged && canTagsLockArea(property, this.userConnectedTags));
            const current = get(lockableRoomStore);
            if (
                current?.areaId !== areaData.id ||
                current.locked !== locked ||
                current.canToggle !== canToggle ||
                current.name !== areaData.name
            ) {
                lockableRoomStore.set({ areaId: areaData.id, name: areaData.name, locked, canToggle });
            }
            return;
        }
        if (get(lockableRoomStore) !== undefined) {
            lockableRoomStore.set(undefined);
        }
    }

    /**
     * Brings an area's collider, its "Full" pill and the pathfinding grid in line with the room's count and where the
     * player stands.
     */
    private refreshAreaState(areaId: string): void {
        const area = this.getAreaById(areaId);
        if (area === undefined) {
            return;
        }
        const blockReason = this.getBlockReason(areaId);
        if (area.getBlockReason() !== blockReason) {
            area.setBlockReason(blockReason);
            this.capacity?.onCollidingAreasChanged();
        }
        // The Owner and Admins at the edge of a locked room can unlock it from there.
        const lockable = getActiveLockableProperty(area.areaData);
        const capacity = this.capacity;
        area.setUnlockAction(
            blockReason === "locked" && capacity?.managesRooms && lockable !== undefined
                ? () => capacity.setLocked(areaId, lockable.id, false)
                : undefined
        );
        this.refreshStatusLabel(area.areaData);
        if (areaId === get(lockableRoomStore)?.areaId) {
            this.refreshLockableRoom();
        }
    }

    /** "Locked" while the room is locked, else "Full · 3/3" while it is full: a locked room says Locked, full or not. */
    private refreshStatusLabel(areaData: AreaData): void {
        const label = this.statusLabels.get(areaData.id);
        const status = this.getStatusLabel(areaData);
        if (status === undefined) {
            label?.destroy();
            this.statusLabels.delete(areaData.id);
            return;
        }
        const x = areaData.x + areaData.width / 2;
        const y = areaData.y + STATUS_LABEL_OFFSET_Y;
        if (label === undefined) {
            this.statusLabels.set(
                areaData.id,
                new AreaStatusLabel(this.scene.usernameDomLayer, x, y, status.text, status.kind)
            );
        } else {
            label.setText(status.text, status.kind);
            label.setPosition(x, y);
        }
    }

    private getStatusLabel(areaData: AreaData): { text: string; kind: "full" | "locked" } | undefined {
        if (this.capacity === undefined) {
            return undefined;
        }
        if (this.isLocked(areaData.id)) {
            return { text: get(LL).area.lockedLabel(), kind: "locked" };
        }
        const property = getActiveMaxUsersProperty(areaData);
        const count = property !== undefined ? this.capacity.liveState.getCount(areaData.id, property.id) : 0;
        if (property === undefined || count < property.maxUsers) {
            return undefined;
        }
        return { text: get(LL).area.fullLabel({ count, max: property.maxUsers }), kind: "full" };
    }

    private initializeAreas() {
        const gameMapAreas = this.gameMapAreas.getAreas();
        gameMapAreas.forEach((areaData) => {
            this.areas.push(
                new Area(
                    this.scene,
                    areaData,
                    !this.areaPermissions.isUserHasAreaAccess(areaData.id),
                    this.areaPermissions.isOverlappingArea(areaData.id)
                )
            );
            this.refreshAreaState(areaData.id);
        });
        this.updateMapEditorOptionForSpecificAreas();
    }

    private updateMapEditorOptionForSpecificAreas() {
        const userId = localUserStore.getLocalUser()?.uuid;
        const userTags = this.scene.connection?.getAllTags() ?? [];
        const isGameMapHasSpecificAreas = this.gameMapAreas.isGameMapContainsSpecificAreas(userId, userTags);
        mapEditorActivatedForThematics.set(isGameMapHasSpecificAreas);
    }

    public getAreaById(areaId: string): Area | undefined {
        return this.areas.find((area) => area.areaData.id === areaId);
    }

    /**
     * Areas that have a setting of this type. A setting that is switched off in the editor does not count, unless
     * `includeDisabled` is set (for code that has to update the setting, not apply it).
     */
    public getAreasByPropertyType(propertyType: string, includeDisabled = false): Area[] {
        return this.areas.reduce((areas, area) => {
            const areaFound = area.areaData.properties.find(
                (property) => property.type === propertyType && (includeDisabled || isAreaPropertyActive(property))
            );
            if (areaFound) {
                areas.push(area);
            }
            return areas;
        }, [] as Area[]);
    }

    /**
     * Returns the list of all areas that the user has no access to.
     */
    public getCollidingAreas(): AreaData[] {
        // Rooms that are locked or full right now (#1621, #1622), for editors too.
        const closedAreas = this.areas
            .filter((area) => area.getBlockReason() === "full" || area.getBlockReason() === "locked")
            .map((area) => area.areaData);
        if (this.userCanEdit) {
            return closedAreas;
        }
        return [...this.gameMapAreas.getCollidingAreas(this.userConnectedTags), ...closedAreas];
    }
}

/** A room's name for "The Lounge is locked": without a leading "The", which the sentence adds. */
export function roomName(areaData: Pick<AreaData, "name"> | undefined): string {
    return (areaData?.name ?? "").trim().replace(/^the\s+/i, "");
}
