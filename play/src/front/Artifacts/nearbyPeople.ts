import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import { gameSceneStore } from "../Stores/GameSceneStore";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";

/**
 * The names of the people with you in the nearby chat `ref` right now, as the Share menu lists them under "People in
 * this chat" (game #1584). Bots are left out, and nobody once this tab is in another chat or none.
 */
export function nearbyPeopleNames(ref: string): Readable<string[]> {
    return derived<typeof gameSceneStore, string[]>(
        gameSceneStore,
        (scene, set) => {
            let room: ProximityChatRoom | undefined;
            try {
                room = scene?.proximityChatRoom;
            } catch {
                // No proximity chat yet: nobody is with you.
            }
            if (!room) {
                set([]);
                return;
            }
            const here = room;
            return here.participants.subscribe((participants) =>
                set(
                    here.currentSpaceName === ref
                        ? participants
                              .filter((participant) => !participant.bot)
                              .map((participant) => participant.name.trim())
                              .filter((name) => name !== "")
                        : []
                )
            );
        },
        []
    );
}
