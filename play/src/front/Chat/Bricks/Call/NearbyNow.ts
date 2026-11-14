import { derived, type Readable } from "svelte/store";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import type { NearbyKind } from "./CallRuntime";
import type { Nearby } from "./WalkUpTracker";

export interface NearbyNow {
    kind: NearbyKind;
    people: readonly Nearby[];
}

const nobody: NearbyNow = { kind: "none", people: [] };

/** The shape of the game's nearby chat that matters here (the real room is passed in from the game scene). */
export interface NearbyRoomLike {
    readonly participants: Readable<ReadonlyArray<{ id: string; name: string; bot: boolean }>>;
    readonly spaceKind: Readable<NearbyKind>;
}

/**
 * Who is with the person in the nearby chat right now, and what kind of place it is. People only, never bots (a call is
 * not interrupted by a bot walking up), and in the order the game lists them: nothing about who is nearest or how far.
 */
export function nearbyNowOf(room: NearbyRoomLike): Readable<NearbyNow> {
    return derived([room.participants, room.spaceKind], ([participants, kind]) => ({
        kind,
        people: participants
            .filter((participant) => !participant.bot)
            .map((participant) => ({ id: participant.id, name: participant.name.trim() || participant.id })),
    }));
}

/** The same for the game's current scene: nobody when there is no scene or no nearby chat yet. */
export const nearbyNow: Readable<NearbyNow> = derived<typeof gameSceneStore, NearbyNow>(
    gameSceneStore,
    (scene, set) => {
        let room: NearbyRoomLike | undefined;
        try {
            room = scene?.proximityChatRoom;
        } catch {
            // No nearby chat yet: nobody is with the person.
        }
        if (!room) {
            set(nobody);
            return;
        }
        return nearbyNowOf(room).subscribe(set);
    },
    nobody
);
