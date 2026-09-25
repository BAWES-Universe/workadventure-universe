import { MapStore } from "@workadventure/store-utils";
import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChatRoom } from "../Connection/ChatConnection";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";

/**
 * An area the local avatar of this tab is standing in, which the chat top row can name
 * although the proximity chat is not connected to it:
 * - "video": a meeting area with its chat disabled. Its space was joined directly, and its users store says who is there.
 * - "matrix": an area with a Matrix chat room only. There is no space, so nothing is known about who is there.
 *
 * Per tab and in memory only, keyed by the area property id.
 */
export type AreaPresence =
    | {
          kind: "video";
          name: string;
          usersStore: Readable<Map<string, SpaceUserExtended>>;
      }
    | {
          kind: "matrix";
          name: string;
      };

export const areaPresenceStore = new MapStore<string, AreaPresence>();

/**
 * One Matrix area this tab's avatar is standing in.
 * - `generation` changes every time the area is entered again, so a join that resolves after the avatar left
 *   (or left and came back) can tell it is stale.
 * - `room` is set once the join has completed. Until then the row is not shown and the room cannot be selected.
 */
export interface AreaChatRoomEntry<Room = unknown> {
    readonly areaId: string;
    readonly roomId: string;
    readonly areaName: string | undefined;
    readonly generation: number;
    readonly room: Room | undefined;
}

/**
 * Collects the Matrix room id of every area of the map that has one, so the chat list can hide them at all times.
 */
export function collectAreaChatRoomIds(
    areas: Iterable<{ properties: ReadonlyArray<{ type: string; serverData?: unknown }> }>
): Set<string> {
    const roomIds = new Set<string>();
    for (const area of areas) {
        for (const property of area.properties) {
            if (property.type !== "matrixRoomPropertyData") continue;
            const serverData = property.serverData;
            if (typeof serverData !== "object" || serverData === null || !("matrixRoomId" in serverData)) continue;
            const matrixRoomId = serverData.matrixRoomId;
            if (typeof matrixRoomId === "string" && matrixRoomId !== "") {
                roomIds.add(matrixRoomId);
            }
        }
    }
    return roomIds;
}

/**
 * Removes area chat rooms from a list of rooms (main list, folders, invitations, search results).
 */
export function withoutAreaChatRooms<T extends { id: string }>(
    rooms: readonly T[],
    hiddenRoomIds: ReadonlySet<string>
): T[] {
    if (hiddenRoomIds.size === 0) return [...rooms];
    return rooms.filter((room) => !hiddenRoomIds.has(room.id));
}

/**
 * The Matrix area chat rooms of this tab, per tab and in memory only.
 *
 * - `hiddenRoomIds`: every room the main chat list must never show. It is the union of the area rooms known on the
 *   map, the areas the avatar is in (joining or joined), the rooms whose join has not settled yet, and the rooms
 *   being left, so an area room never flashes into the list while Matrix membership catches up. Rooms being left
 *   stay hidden across reset() until their leave completes.
 * - `rows`: the area rows under the top row. Only areas whose join has completed, the most recently entered first,
 *   one row per room. When the most recent area is left, the previous one still active is on top again.
 */
export class AreaChatRoomTracker<Room = unknown> {
    private mapRoomIds = new Set<string>();
    private entries: AreaChatRoomEntry<Room>[] = [];
    private settling = new Map<string, number>();
    private nextGeneration = 1;
    /** First generation handed out in the current scene. Entries below it belong to a scene that was reset. */
    private sceneStartGeneration = 1;
    /** Bumped by reset(), so settles started in an earlier scene can't touch this one. */
    private epoch = 0;
    /** Leaves in flight per room. Not scene-scoped: kept across reset() until each leave settles. */
    private leaving = new Map<string, Set<Promise<void>>>();

    private readonly hiddenStore = writable<ReadonlySet<string>>(new Set());
    private readonly rowsStore = writable<readonly AreaChatRoomEntry<Room>[]>([]);

    public readonly hiddenRoomIds: Readable<ReadonlySet<string>> = { subscribe: this.hiddenStore.subscribe };
    public readonly rows: Readable<readonly AreaChatRoomEntry<Room>[]> = { subscribe: this.rowsStore.subscribe };

    /** Replaces the set of area room ids known on the map. */
    public setMapRoomIds(roomIds: Iterable<string>): void {
        this.mapRoomIds = new Set(roomIds);
        this.publish();
    }

    /** The avatar entered an area with a Matrix room. Entering the same area again replaces its entry. */
    public enter(areaId: string, roomId: string, areaName?: string): AreaChatRoomEntry<Room> {
        const entry: AreaChatRoomEntry<Room> = {
            areaId,
            roomId,
            areaName: areaName?.trim() || undefined,
            generation: this.nextGeneration++,
            room: undefined,
        };
        this.entries = [...this.entries.filter((existing) => existing.areaId !== areaId), entry];
        this.publish();
        return entry;
    }

    /** True while this exact entry (same area, same generation) is still active. */
    public isCurrent(entry: AreaChatRoomEntry<Room>): boolean {
        return this.entries.some(
            (existing) => existing.areaId === entry.areaId && existing.generation === entry.generation
        );
    }

    /**
     * The join of this entry completed. Returns false, and changes nothing, if the entry is stale: the avatar left
     * the area (or left and entered again) before the join resolved.
     */
    public markJoined(entry: AreaChatRoomEntry<Room>, room: Room): boolean {
        if (!this.isCurrent(entry)) return false;
        this.entries = this.entries.map((existing) =>
            existing.areaId === entry.areaId && existing.generation === entry.generation
                ? { ...existing, room }
                : existing
        );
        this.publish();
        return true;
    }

    /** The avatar left an area. Removes that entry only and returns it. */
    public leave(areaId: string): AreaChatRoomEntry<Room> | undefined {
        const entry = this.entries.find((existing) => existing.areaId === areaId);
        if (!entry) return undefined;
        this.entries = this.entries.filter((existing) => existing !== entry);
        this.publish();
        return entry;
    }

    /** False for an entry created before the last reset(), i.e. in a scene that is gone. */
    public isFromCurrentScene(entry: AreaChatRoomEntry<Room>): boolean {
        return entry.generation >= this.sceneStartGeneration;
    }

    /**
     * The join of this entry failed or returned no room: forget the entry, if it is still the current one for its
     * area, so nothing lingers until the avatar walks out. The room stays hidden through the map's area room ids.
     * Returns true if the entry was removed.
     */
    public abandon(entry: AreaChatRoomEntry<Room>): boolean {
        if (!this.isCurrent(entry)) return false;
        this.leave(entry.areaId);
        return true;
    }

    /** True if an active area (joining or joined) still uses this room. */
    public hasActiveRoom(roomId: string): boolean {
        return this.entries.some((entry) => entry.roomId === roomId);
    }

    public get activeCount(): number {
        return this.entries.length;
    }

    /**
     * Keeps a room hidden from the main list while a join or a leave is in flight, even if its area is no longer on
     * the map or active. Call the returned function once it has settled; calling it more than once is harmless.
     */
    public beginSettle(roomId: string): () => void {
        this.settling.set(roomId, (this.settling.get(roomId) ?? 0) + 1);
        this.publish();
        const epoch = this.epoch;
        let done = false;
        return () => {
            if (done) return;
            done = true;
            // The scene was reset since: this settle's count is already gone.
            if (epoch !== this.epoch) return;
            const count = (this.settling.get(roomId) ?? 1) - 1;
            if (count <= 0) {
                this.settling.delete(roomId);
            } else {
                this.settling.set(roomId, count);
            }
            this.publish();
        };
    }

    /**
     * Tracks a leave of this room: the room stays hidden from the main list until it settles (even across reset()),
     * and whenLeft() waits for it, so a join started meanwhile can't be undone by the late leave.
     */
    public trackLeave(roomId: string, leave: Promise<unknown>): Promise<void> {
        const settled: Promise<void> = leave.then(
            () => undefined,
            () => undefined
        );
        let pending = this.leaving.get(roomId);
        if (!pending) {
            pending = new Set();
            this.leaving.set(roomId, pending);
        }
        pending.add(settled);
        this.publish();
        void settled.then(() => {
            const current = this.leaving.get(roomId);
            if (!current) return;
            current.delete(settled);
            if (current.size === 0) this.leaving.delete(roomId);
            this.publish();
        });
        return settled;
    }

    /** Resolves once every leave of this room tracked so far has settled. */
    public whenLeft(roomId: string): Promise<void> {
        const pending = this.leaving.get(roomId);
        if (!pending || pending.size === 0) return Promise.resolve();
        return Promise.all(Array.from(pending)).then(() => undefined);
    }

    /**
     * Forgets the scene, for a new one. Area-leave handlers do not run when the scene closes (map change, exit,
     * disconnect), so the rooms of the areas still active are left here through `leaveRoom`, once per room, and stay
     * hidden until that leave settles. A join still in flight is left by its own stale-join handling.
     */
    public reset(leaveRoom?: (entry: AreaChatRoomEntry<Room> & { room: Room }) => Promise<unknown> | undefined): void {
        const toLeave = new Map<string, AreaChatRoomEntry<Room> & { room: Room }>();
        for (const entry of this.entries) {
            if (entry.room !== undefined) toLeave.set(entry.roomId, { ...entry, room: entry.room });
        }
        this.epoch++;
        this.sceneStartGeneration = this.nextGeneration;
        this.mapRoomIds = new Set();
        this.entries = [];
        this.settling = new Map();
        for (const entry of toLeave.values()) {
            const leave = leaveRoom?.(entry);
            if (leave) void this.trackLeave(entry.roomId, leave);
        }
        this.publish();
    }

    private publish(): void {
        const hidden = new Set<string>(this.mapRoomIds);
        for (const entry of this.entries) hidden.add(entry.roomId);
        for (const roomId of this.settling.keys()) hidden.add(roomId);
        for (const roomId of this.leaving.keys()) hidden.add(roomId);
        this.hiddenStore.set(hidden);

        const rows: AreaChatRoomEntry<Room>[] = [];
        const seen = new Set<string>();
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry.room === undefined || seen.has(entry.roomId)) continue;
            seen.add(entry.roomId);
            rows.push(entry);
        }
        this.rowsStore.set(rows);
    }
}

/** This tab's area chat rooms. */
export const areaChatRooms = new AreaChatRoomTracker<ChatRoom>();

/**
 * Forgets every area. Called when the scene closes (exit, "Go to room"): area-leave handlers do not run then,
 * and a "video" entry must not keep a destroyed space's users store alive on the next map.
 */
export function clearAreaPresence(): void {
    areaPresenceStore.clear();
}
