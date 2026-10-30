import type { AreaData, AtLeast, GameMapAreas } from "@workadventure/map-editor";
import {
    AreaPermissions,
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
import { localUserStore } from "../../../Connection/LocalUserStore";
import LL from "../../../../i18n/i18n-svelte";
import { PathTileType } from "../../../Utils/PathfindingManager";
import type { AreaUsersInside } from "./AreaUsersInside";
import { findNearestFreeTile } from "./NearestFreeSpot";

/** How far below a room's top edge its "Full" pill sits, in game pixels. */
const STATUS_LABEL_OFFSET_Y = 4;

/** What a full room (#1621) needs from the game. Without it, "Max people" is not applied (a public map). */
export interface AreaCapacityOptions {
    usersInside: AreaUsersInside;
    /** The Owner and Admins walk into full rooms. */
    canPassFullRooms: boolean;
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
    private usersInsideSubscription: Subscription | undefined;

    constructor(
        private scene: GameScene,
        private gameMapAreas: GameMapAreas,
        private userConnectedTags: string[],
        private userCanEdit: boolean,
        private capacity?: AreaCapacityOptions
    ) {
        this.areaPermissions = new AreaPermissions(gameMapAreas, userConnectedTags, userCanEdit);
        this.initializeAreas();
        this.usersInsideSubscription = capacity?.usersInside.changes.subscribe((areaId) => {
            this.justLeft.delete(areaId);
            this.refreshAreaState(areaId);
        });
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
        this.updateMapEditorOptionForSpecificAreas();
    }

    /** Stops listening to the counts and removes the "Full" pills. The areas themselves go with the scene. */
    public destroy(): void {
        this.usersInsideSubscription?.unsubscribe();
        this.usersInsideSubscription = undefined;
        for (const label of this.statusLabels.values()) {
            label.destroy();
        }
        this.statusLabels.clear();
    }

    /** The player walked into an area. */
    public onPlayerEnteredArea(areaId: string): void {
        this.justLeft.delete(areaId);
        this.refreshAreaState(areaId);
    }

    /** The player walked out of an area. */
    public onPlayerLeftArea(areaId: string): void {
        if (this.isFull(areaId)) {
            this.justLeft.add(areaId);
        }
        this.refreshAreaState(areaId);
    }

    /**
     * Why the player cannot walk into the area now, if they cannot. "Who can enter" first: a room the player may not
     * enter says so, full or not. A full room never stops someone who is already inside: they can always walk out.
     */
    public getBlockReason(areaId: string): AreaBlockReason | undefined {
        if (!this.areaPermissions.isUserHasAreaAccess(areaId)) {
            return "noAccess";
        }
        if (this.capacity === undefined || this.capacity.canPassFullRooms || this.justLeft.has(areaId)) {
            return undefined;
        }
        const areaData = this.gameMapAreas.getArea(areaId);
        if (areaData === undefined || !this.isFull(areaId)) {
            return undefined;
        }
        const player = this.scene.CurrentPlayer;
        if (player !== undefined && isPlayerPositionInArea({ x: player.x, y: player.y }, areaData)) {
            return undefined;
        }
        return "full";
    }

    /**
     * The full room (#1621) that a player arriving at this point would end up in, if there is one: teleports and start
     * points must not put them there.
     *
     * @param joining the player has just joined the map where they stand, so the server already counts them in the
     *   rooms there: they stay only if the room is not full without them. Otherwise the player walks or is moved from
     *   where they stand, and can go anywhere in a room they are already in, even one holding more people than its
     *   limit (an Admin walked in, or the limit was lowered).
     */
    public getFullAreaForArrivalAt(x: number, y: number, joining = false): AreaData | undefined {
        if (this.capacity === undefined || this.capacity.canPassFullRooms) {
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
            if (this.isFull(areaData.id, playerInside ? 1 : 0)) {
                return areaData;
            }
        }
        return undefined;
    }

    /**
     * Where to put a player who would arrive at this point in a full room: the closest spot they can walk to outside
     * every full room. The point itself when no full room is in the way, undefined if there is no such spot. See
     * getFullAreaForArrivalAt for `joining`.
     */
    public findArrivalSpot(
        x: number,
        y: number,
        grid: number[][],
        tile: { width: number; height: number },
        joining = false
    ): { x: number; y: number } | undefined {
        if (this.getFullAreaForArrivalAt(x, y, joining) === undefined) {
            return { x, y };
        }
        const toPosition = (tileX: number, tileY: number) => ({
            x: tileX * tile.width + tile.width / 2,
            y: tileY * tile.height + tile.height / 2,
        });
        const isInFullRoom = (tileX: number, tileY: number) => {
            const position = toPosition(tileX, tileY);
            return this.getFullAreaForArrivalAt(position.x, position.y, joining) !== undefined;
        };
        const free = findNearestFreeTile(
            { width: grid[0]?.length ?? 0, height: grid.length },
            { x: Math.floor(x / tile.width), y: Math.floor(y / tile.height) },
            // A full room is a wall in the grid for a player outside it: walk through it, not through real walls.
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
        return this.capacity.usersInside.getCount(areaId, property.id) - except >= property.maxUsers;
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
        this.refreshStatusLabel(area.areaData);
    }

    private refreshStatusLabel(areaData: AreaData): void {
        const property = this.capacity !== undefined ? getActiveMaxUsersProperty(areaData) : undefined;
        const count = property !== undefined ? this.capacity?.usersInside.getCount(areaData.id, property.id) ?? 0 : 0;
        const label = this.statusLabels.get(areaData.id);
        if (property === undefined || count < property.maxUsers) {
            label?.destroy();
            this.statusLabels.delete(areaData.id);
            return;
        }
        const text = get(LL).area.fullLabel({ count, max: property.maxUsers });
        const x = areaData.x + areaData.width / 2;
        const y = areaData.y + STATUS_LABEL_OFFSET_Y;
        if (label === undefined) {
            this.statusLabels.set(areaData.id, new AreaStatusLabel(this.scene.usernameDomLayer, x, y, text));
        } else {
            label.setText(text);
            label.setPosition(x, y);
        }
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
        // Rooms that are full right now (#1621), for editors too: only the Owner and Admins walk into them.
        const fullAreas = this.areas.filter((area) => area.getBlockReason() === "full").map((area) => area.areaData);
        if (this.userCanEdit) {
            return fullAreas;
        }
        return [...this.gameMapAreas.getCollidingAreas(this.userConnectedTags), ...fullAreas];
    }
}
