import type { Readable } from "svelte/store";
import type { Observable } from "rxjs";
import type { CapabilityKey } from "./QuestGuidance";

export interface GuidanceSources {
    /** The local player's last emote; carries a timestamp, so a replayed value is recognised. */
    emotePlayed: Readable<{ at: number } | undefined>;
    /** Say and think bubbles the local player sent. */
    saySent: Observable<unknown>;
    /** The local player's map editor commands. */
    entityPlaced: Observable<unknown>;
}

/**
 * Feeds "teach once" from the game's own signals about the local player. Nothing here reads what other players do,
 * and nothing moves the player, opens a surface or changes focus.
 */
export function armQuestGuidance(
    sources: GuidanceSources,
    recordUse: (key: CapabilityKey) => void,
    isEntityPlacement: (command: unknown) => boolean
): () => void {
    // A store hands its current value to every new subscriber: an emote played before this scene is not a new use.
    let lastEmoteAt: number | undefined;
    let primed = false;
    const stopEmote = sources.emotePlayed.subscribe((played) => {
        if (!primed) {
            primed = true;
            lastEmoteAt = played?.at;
            return;
        }
        if (!played || played.at === lastEmoteAt) return;
        lastEmoteAt = played.at;
        recordUse("express");
    });
    const say = sources.saySent.subscribe(() => recordUse("express"));
    const build = sources.entityPlaced.subscribe((command) => {
        if (isEntityPlacement(command)) recordUse("build");
    });
    return () => {
        stopEmote();
        say.unsubscribe();
        build.unsubscribe();
    };
}
