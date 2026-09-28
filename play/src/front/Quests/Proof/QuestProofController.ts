import { get, writable } from "svelte/store";
import { initialProofState, reduceProof, restoreProof, revealPending } from "./QuestProofModel";
import type { ProofEvent, QuestProofState } from "./QuestProofModel";
export const PROOF_STORAGE_KEY = "universe.quest-proof.codex.v1";
type ProofStorage = Pick<Storage, "getItem" | "setItem">;
export function createQuestProofController(storage?: ProofStorage) {
    let restored: QuestProofState | null = null;
    try {
        restored = restoreProof(storage?.getItem(PROOF_STORAGE_KEY) ?? null);
    } catch {
        /* Private browsing can reject storage. */
    }
    const state = writable(restored ?? initialProofState());
    const persist = (next: QuestProofState) => {
        try {
            storage?.setItem(PROOF_STORAGE_KEY, JSON.stringify(next));
        } catch {
            /* In-memory proof still works. */
        }
        state.set(next);
    };
    return {
        subscribe: state.subscribe,
        send(event: ProofEvent) {
            persist(reduceProof(get(state), event));
        },
        openLog() {
            persist(reduceProof(get(state), { type: "log" }));
        },
        reveal(suppressed: boolean) {
            const previous = get(state);
            const next = revealPending(previous, suppressed);
            if (previous !== next) persist(next);
        },
    };
}
export type QuestProofController = ReturnType<typeof createQuestProofController>;
