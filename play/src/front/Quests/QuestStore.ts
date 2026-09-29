import type { Readable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { QuestAnalyticsDevice, QuestAnalyticsFrom, QuestAnalyticsId } from "../Administration/AnalyticsClient";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { consumeQuestReset, questBrowserStorage, readQuestSim } from "./QuestDevSettings";
import type { QuestSim } from "./QuestDevSettings";
import type { MeetProgress } from "./MeetExchange";
import type { QuestEvent, QuestGiver, QuestPath, QuestState } from "./QuestModel";
import { acceptedUntrackedCount, reduceQuest, revealPending } from "./QuestModel";
import { clearQuestStorage, restoreQuestState, saveQuestState } from "./QuestPersistence";
import type { QuestEngineAction, QuestEngineClient } from "./QuestEngine";
import { engineActionFor, mergeEngineProgress, questEngineStore, unsyncedActions } from "./QuestEngine";
import type { QuestWorld } from "./QuestWorld";
import { acceptanceOrigin, availablePaths, EMPTY_QUEST_WORLD, questOrigin, simulatedWorld } from "./QuestWorld";

const storage = questBrowserStorage();

if (consumeQuestReset(storage)) clearQuestStorage(storage);

/** The dev host scenario for this page (localStorage `questSim`). */
export const questSim: QuestSim = readQuestSim(storage);

const state = writable<QuestState>(restoreQuestState(storage));

// Module-level, for the page's lifetime: progress is saved whatever is mounted.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
state.subscribe((value) => saveQuestState(storage, value));

export const questStateStore: Readable<QuestState> = { subscribe: state.subscribe };

// Transitions return the same object when nothing changes: only a real change notifies (and saves).
function apply(next: (current: QuestState) => QuestState): void {
    const current = get(state);
    const updated = next(current);
    if (updated !== current) state.set(updated);
}

export function dispatchQuest(event: QuestEvent): void {
    const before = get(state);
    apply((current) => reduceQuest(current, event));
    if (get(state) === before) return;
    const action = engineActionFor(event);
    if (action) sendToEngine(action);
}

let engine: QuestEngineClient | null = null;

function sendToEngine(action: QuestEngineAction): void {
    const client = engine;
    if (!client) return;
    client.send(action).catch((error) => console.warn("Quests: the engine did not take", action.action, error));
}

/** Pulls the player's progress from the engine and reports back what only this browser knew. */
async function syncWithEngine(client: QuestEngineClient): Promise<void> {
    try {
        const remote = await client.list();
        // Signed out, or another account, while the engine answered: its list is not this player's.
        if (!remote || engine !== client) return;
        const pendingActions = unsyncedActions(get(state), remote);
        apply((current) => mergeEngineProgress(current, remote));
        for (const action of pendingActions) sendToEngine(action);
    } catch (error) {
        console.warn("Quests: could not read progress from the engine", error);
    }
}

// Module-level, for the page's lifetime: a new engine (sign-in, another account) syncs once.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
questEngineStore.subscribe((client) => {
    engine = client;
    if (client) syncWithEngine(client).catch(() => undefined);
});

/** Plays the next waiting completion unless `blocked` (see revealPending). */
export function revealPendingQuest(blocked: boolean): void {
    apply((current) => revealPending(current, blocked));
}

/** What this room offers right now, as the dev simulation sees it. Set by the detectors. */
const world = writable<QuestWorld>(EMPTY_QUEST_WORLD);
export const questWorldStore: Readable<QuestWorld> = derived(world, ($world) => simulatedWorld($world, questSim));
export function setQuestWorld(value: QuestWorld): void {
    world.set(value);
}

/** Where Meet stands in the current bubble: nothing yet, the player's hello sent, or an exchange. */
export const questMeetProgressStore = writable<MeetProgress>("idle");

export const questAvailablePathsStore: Readable<QuestPath[]> = derived([state, questWorldStore], ([$state, $world]) =>
    availablePaths($state, $world, questSim)
);

export const questAcceptedCountStore: Readable<number> = derived(state, ($state) => acceptedUntrackedCount($state));
export const questNewsStore: Readable<boolean> = derived(state, ($state) => $state.news);

/**
 * Whether the invitation may start its countdown: the map is ready, the arrival is not for someone
 * (`#moveToUser`), a `#moveTo` walk has ended, and a host had its chance to appear.
 */
export type QuestArrival = "waiting" | "ready" | "skipped";
export const questArrivalStore = writable<QuestArrival>("waiting");

/**
 * Lines for the status region, flushed by the dock when nobody is typing. Kept here so a message queued while the
 * dock is unmounted (a reconnect) is still read.
 */
function createAnnouncementQueue() {
    const { subscribe, update } = writable<string[]>([]);
    return {
        subscribe,
        push(message: string) {
            if (!message) return;
            update((queue) => (queue.includes(message) ? queue : [...queue, message]));
        },
        take(): string | undefined {
            let first: string | undefined;
            update((queue) => {
                [first] = queue;
                return queue.slice(1);
            });
            return first;
        },
    };
}
export const questAnnouncementStore = createAnnouncementQueue();

/** Set by the detectors so accepting Explore can pick its area from where the player stands now. */
let refreshWorldBeforeAccept: (() => void) | undefined;
export function setQuestWorldRefresher(refresh: (() => void) | undefined): void {
    refreshWorldBeforeAccept = refresh;
}

/** Set by the detectors: true when the current bubble already holds an exchange (Meet accepted mid-conversation). */
let meetAlreadyExchanged: () => boolean = () => false;
export function setMeetAlreadyExchanged(check: (() => boolean) | undefined): void {
    meetAlreadyExchanged = check ?? (() => false);
}

// Analytics ---------------------------------------------------------------------------------------------------------

export function questAnalyticsId(path: QuestPath): QuestAnalyticsId {
    return `welcome.${path}`;
}

export function questDevice(): QuestAnalyticsDevice {
    try {
        return window.matchMedia?.("(pointer: coarse)").matches ? "touch" : "pointer";
    } catch {
        return "pointer";
    }
}

function secondsSince(time: number | null, now: number): number | null {
    return time === null ? null : Math.max(0, Math.round((now - time) / 1000));
}

/** The kind of the frozen giver of the offer on screen (never the live world, which changes as the player walks). */
function offeredGiverKind(giver: QuestGiver | null | undefined): "bot" | "area" | "none" {
    return giver?.kind ?? "none";
}

// Actions: one per thing a person or a detector does. Each updates the state first; analytics come after and never
// decide progress.

export function showQuestInvitation(): boolean {
    const before = get(state);
    dispatchQuest({ type: "invitation-shown", origin: questOrigin(get(questWorldStore)) });
    const after = get(state);
    if (after === before) return false;
    analyticsClient.questOffered({
        scope: "welcome",
        questId: "welcome",
        version: 1,
        giverKind: offeredGiverKind(after.offeredBy?.giver),
        device: questDevice(),
    });
    return true;
}

/** "Not now": the invitation stays away for this page (a refresh offers again); the log still offers everything. */
export function declineQuestInvitation(): void {
    const offeredBy = get(state).offeredBy;
    dispatchQuest({ type: "decline" });
    analyticsClient.questDeclined({
        scope: "welcome",
        questId: "welcome",
        version: 1,
        giverKind: offeredGiverKind(offeredBy?.giver),
        device: questDevice(),
    });
}

/** Ignored for a while, walked away from, or Escape: not a decline. It may come back once on a later arrival. */
export function fadeQuestInvitation(): void {
    const before = get(state);
    dispatchQuest({ type: "invitation-faded" });
    if (get(state) !== before) analyticsClient.questTracker({ action: "faded", device: questDevice() });
}

export function acceptQuest(path: QuestPath, from: QuestAnalyticsFrom, now: number = Date.now()): void {
    if (path === "explore") refreshWorldBeforeAccept?.();
    const world = get(questWorldStore);
    const target = world.exploreTarget;
    const before = get(state);
    const wasAccepted = before.quests[path].accepted;
    dispatchQuest({
        type: "accept",
        path,
        now,
        exploreArea: path === "explore" && target ? { id: target.area.id, name: target.area.name } : undefined,
        origin: acceptanceOrigin(before.offeredBy, world),
    });
    const after = get(state);
    if (!after.quests[path].accepted || after.tracked !== path) return;
    if (!wasAccepted) analyticsClient.questAccepted({ questId: questAnalyticsId(path), from });
    analyticsClient.questTracked({ questId: questAnalyticsId(path), from });

    // Credit an objective that is already met: nobody is asked to leave and come back in.
    if (path === "explore" && target?.alreadyInside) completeQuest(path, "already-valid", now);
    if (path === "meet" && meetAlreadyExchanged()) completeQuest(path, "already-valid", now);
    // Meet can be started while nobody is here: it waits (the detectors resume it when someone comes).
    if (path === "meet" && world.present.length === 0) pauseQuest(path);
}

/** Show on map, from the log: an accepted quest becomes the one marked on the map. */
export function trackQuest(path: QuestPath, from: QuestAnalyticsFrom = "log"): void {
    const before = get(state);
    dispatchQuest({ type: "track", path });
    if (get(state) !== before && get(state).tracked === path) {
        analyticsClient.questTracked({ questId: questAnalyticsId(path), from });
    }
}

/** Abandon, from the log: the quest goes back to Available, and can be taken again. */
export function abandonQuest(path: QuestPath): void {
    const before = get(state);
    dispatchQuest({ type: "abandon", path });
    if (get(state) !== before) analyticsClient.questStopped({ questId: questAnalyticsId(path), reason: "abandoned" });
}

/** Records a met objective (every accepted quest, tracked or not). Presentation is separate: see revealPending. */
export function completeQuest(
    path: QuestPath,
    source: "detected" | "already-valid" = "detected",
    now: number = Date.now()
): void {
    const before = get(state);
    dispatchQuest({ type: "complete", path, now });
    const after = get(state);
    if (after === before) return;
    const entry = after.quests[path];
    const secondsSinceAccepted = secondsSince(entry.acceptedAt, now);
    // One objective per path in the Welcome chapter, so the objective and the quest finish together.
    analyticsClient.questObjectiveDone({
        questId: questAnalyticsId(path),
        objectiveId: `welcome.${path}.1`,
        secondsSinceAccepted,
        source,
    });
    analyticsClient.questDone({ questId: questAnalyticsId(path), secondsSinceAccepted });
}

export function pauseQuest(path: QuestPath): void {
    const before = get(state);
    dispatchQuest({ type: "pause", path, reason: "no-eligible-target" });
    if (get(state) !== before) {
        analyticsClient.questPaused({ questId: questAnalyticsId(path), reason: "no-eligible-target" });
    }
}

export function resumeQuest(path: QuestPath): void {
    dispatchQuest({ type: "resume", path });
}

/** The celebration has played (or was tapped away): the panel takes over. */
export function settleQuestCelebration(): void {
    dispatchQuest({ type: "celebration-settled" });
}

/** The Quests pill: opens the panel, or closes it when it is open. */
export function toggleQuestLog(): void {
    dispatchQuest({ type: "toggle-log" });
}

export function resetQuests(): void {
    clearQuestStorage(storage);
    dispatchQuest({ type: "reset" });
    questMeetProgressStore.set("idle");
}
