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
