import { derived } from "svelte/store";
import LL from "../../i18n/i18n-svelte";
import type { TranslationFunctions } from "../../i18n/i18n-types";
import type { OrbitQuestEntry } from "../external-modules/admin-api/orbitBridge";
import { entryOrigin, questObjective, questTitle } from "./QuestCopy";
import type { QuestState } from "./QuestModel";
import { QUEST_PATHS, QUEST_STAMPS, questStatus } from "./QuestModel";
import { questAnalyticsId, questStateStore, questWorldStore } from "./QuestStore";
import type { QuestWorld } from "./QuestWorld";

/**
 * The player's quest log as Orbit's You page shows it: what is tracked, accepted and done, in the game's words.
 * Only fixed quest keys and display names; nothing that identifies a person or a room beyond its name. The giver and
 * the room are the ones frozen at acceptance, wherever the player is now.
 */
export function orbitQuestEntries(t: TranslationFunctions, state: QuestState, world: QuestWorld): OrbitQuestEntry[] {
    const entries: OrbitQuestEntry[] = [];
    for (const path of QUEST_PATHS) {
        const status = questStatus(state, path);
        if (status === "available") continue;
        const { room, giver } = entryOrigin(state, path, world);
        entries.push({
            id: questAnalyticsId(path),
            title: questTitle(t, path),
            status,
            ...(status === "done" ? { stamp: QUEST_STAMPS[path] } : {}),
            ...(giver ? { giver: giver.name } : {}),
            room,
            objective: questObjective(t, path, state, world),
        });
    }
    // Tracked first, then accepted, then done: the order of the game's log.
    const order = { tracked: 0, accepted: 1, done: 2 } as const;
    return entries.sort((a, b) => order[a.status] - order[b.status]);
}

/**
 * Calls `send` with the log now and whenever it changes (same content is not sent twice). Returns the function that
 * stops.
 */
export function watchOrbitQuestEntries(send: (entries: OrbitQuestEntry[]) => void): () => void {
    let last: string | undefined;
    return derived([LL, questStateStore, questWorldStore], ([$LL, $state, $world]) =>
        orbitQuestEntries($LL, $state, $world)
    ).subscribe((entries) => {
        const serialised = JSON.stringify(entries);
        if (serialised === last) return;
        last = serialised;
        send(entries);
    });
}
