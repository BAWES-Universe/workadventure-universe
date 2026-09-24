import { MapStore } from "@workadventure/store-utils";
import type { Readable } from "svelte/store";
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
 * Forgets every area. Called when the scene closes (exit, "Go to room"): area-leave handlers do not run then,
 * and a "video" entry must not keep a destroyed space's users store alive on the next map.
 */
export function clearAreaPresence(): void {
    areaPresenceStore.clear();
}
