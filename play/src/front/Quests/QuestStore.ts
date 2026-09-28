import type { Readable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { QuestAnalyticsDevice, QuestAnalyticsFrom, QuestAnalyticsId } from "../Administration/AnalyticsClient";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { FEATURE_FLAG_QUESTS_PROOF_SLICE } from "../Enum/EnvironmentVariable";
import { consumeQuestReset, questBrowserStorage, readQuestSim } from "./QuestDevSettings";
import type { QuestSim } from "./QuestDevSettings";
import type { MeetProgress } from "./MeetExchange";
import type { QuestEvent, QuestFollowUp, QuestPath, QuestState } from "./QuestModel";
import { acceptedUntrackedCount, initialQuestState, QUEST_PATHS, reduceQuest, revealPending } from "./QuestModel";
import { clearQuestStorage, restoreQuestState, saveQuestState } from "./QuestPersistence";
import type { QuestWorld } from "./QuestWorld";
import { availablePaths, EMPTY_QUEST_WORLD, simulatedWorld } from "./QuestWorld";

/** The flag. With it off nothing here subscribes, listens or renders. */
export const questsEnabled: boolean = FEATURE_FLAG_QUESTS_PROOF_SLICE === true;

const storage = questsEnabled ? questBrowserStorage() : undefined;

if (questsEnabled && consumeQuestReset(storage)) clearQuestStorage(storage);

/** The dev host scenario for this page (localStorage `questSim`). */
export const questSim: QuestSim = questsEnabled ? readQuestSim(storage) : "empty";

const state = writable<QuestState>(questsEnabled ? restoreQuestState(storage) : initialQuestState());

if (questsEnabled) {
    // Module-level, for the page's lifetime: progress is saved whatever is mounted.
    //eslint-disable-next-line svelte/no-ignored-unsubscribe
    state.subscribe((value) => saveQuestState(storage, value));
}

export const questStateStore: Readable<QuestState> = { subscribe: state.subscribe };

// Transitions return the same object when nothing changes: only a real change notifies (and saves).
function apply(next: (current: QuestState) => QuestState): void {
    const current = get(state);
    const updated = next(current);
    if (updated !== current) state.set(updated);
}

export function dispatchQuest(event: QuestEvent): void {
    if (!questsEnabled) return;
    apply((current) => reduceQuest(current, event));
}

/** Plays the next waiting completion unless `blocked` (see revealPending). */
export function revealPendingQuest(blocked: boolean): void {
    if (!questsEnabled) return;
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
            if (!questsEnabled || !message) return;
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

function giverKind(): "bot" | "area" | "none" {
    return get(questWorldStore).host.kind;
}

// Actions: one per thing a person or a detector does. Each updates the state first; analytics come after and never
// decide progress.

export function showQuestInvitation(): boolean {
    if (!questsEnabled) return false;
    const before = get(state);
    dispatchQuest({ type: "invitation-shown" });
    if (get(state) === before) return false;
    analyticsClient.questOffered({
        scope: "welcome",
        questId: "welcome",
        version: 1,
        giverKind: giverKind(),
        device: questDevice(),
    });
    return true;
}

export function declineQuestInvitation(): void {
    if (!questsEnabled) return;
    dispatchQuest({ type: "decline" });
    analyticsClient.questDeclined({
        scope: "welcome",
        questId: "welcome",
        version: 1,
        giverKind: giverKind(),
        device: questDevice(),
    });
}

/** Ignored for a while, walked away from, or Escape: not a decline. It may come back once on a later arrival. */
export function fadeQuestInvitation(): void {
    if (!questsEnabled) return;
    const before = get(state);
    dispatchQuest({ type: "invitation-faded" });
    if (get(state) !== before) analyticsClient.questSkipped({ reason: "invitation-faded" });
}

export function acceptQuest(path: QuestPath, from: QuestAnalyticsFrom, now: number = Date.now()): void {
    if (!questsEnabled) return;
    if (path === "explore") refreshWorldBeforeAccept?.();
    const target = get(questWorldStore).exploreTarget;
    const wasAccepted = get(state).quests[path].accepted;
    dispatchQuest({
        type: "accept",
        path,
        now,
        exploreArea: path === "explore" && target ? { id: target.area.id, name: target.area.name } : undefined,
    });
    const after = get(state);
    if (!after.quests[path].accepted || after.tracked !== path) return;
    if (!wasAccepted) analyticsClient.questAccepted({ questId: questAnalyticsId(path), from });
    analyticsClient.questTracked({ questId: questAnalyticsId(path), from });

    // Credit an objective that is already met: nobody is asked to leave and come back in.
    if (path === "explore" && target?.alreadyInside) completeQuest(path, "already-valid", now);
    if (path === "meet" && meetAlreadyExchanged()) completeQuest(path, "already-valid", now);
}

export function trackQuest(path: QuestPath, from: QuestAnalyticsFrom = "log"): void {
    if (!questsEnabled) return;
    const before = get(state);
    dispatchQuest({ type: "track", path });
    if (get(state) !== before && get(state).tracked === path) {
        analyticsClient.questTracked({ questId: questAnalyticsId(path), from });
    }
}

export function setAsideQuest(): void {
    if (!questsEnabled) return;
    const tracked = get(state).tracked;
    if (!tracked) return;
    dispatchQuest({ type: "set-aside" });
    analyticsClient.questStopped({ questId: questAnalyticsId(tracked), reason: "set-aside" });
}

export function removeQuest(path: QuestPath): void {
    if (!questsEnabled) return;
    const before = get(state);
    dispatchQuest({ type: "remove", path });
    if (get(state) !== before) analyticsClient.questStopped({ questId: questAnalyticsId(path), reason: "removed" });
}

export function setQuestsHidden(hidden: boolean): void {
    if (!questsEnabled) return;
    const before = get(state).hidden;
    dispatchQuest({ type: hidden ? "hide" : "show-quests" });
    if (before !== hidden) {
        analyticsClient.questTracker({ action: hidden ? "hidden" : "restored", device: questDevice() });
    }
}

/** Records a met objective (every accepted quest, tracked or not). Presentation is separate: see revealPending. */
export function completeQuest(
    path: QuestPath,
    source: "detected" | "already-valid" = "detected",
    now: number = Date.now()
): void {
    if (!questsEnabled) return;
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
        viaShowMe: entry.viaShowMe,
        source,
    });
    analyticsClient.questDone({ questId: questAnalyticsId(path), secondsSinceAccepted, viaShowMe: entry.viaShowMe });
}

export function pauseQuest(path: QuestPath): void {
    if (!questsEnabled) return;
    const before = get(state);
    dispatchQuest({ type: "pause", path, reason: "no-eligible-target" });
    if (get(state) !== before) {
        analyticsClient.questPaused({ questId: questAnalyticsId(path), reason: "no-eligible-target" });
    }
}

export function resumeQuest(path: QuestPath): void {
    dispatchQuest({ type: "resume", path });
}

export function settleQuestPayoff(followUp: QuestFollowUp | null): void {
    dispatchQuest({ type: "payoff-settled", followUp });
}

/** Closing the sign-in offer: remembered, and the continuation shows if something is left to do here. */
export function skipQuestSignInOffer(): void {
    if (!questsEnabled) return;
    dispatchQuest({ type: "sign-in-later", continuation: get(questAvailablePathsStore).length > 0 });
    analyticsClient.questSkipped({ reason: "signin-offer" });
}

export function resetQuests(): void {
    if (!questsEnabled) return;
    clearQuestStorage(storage);
    dispatchQuest({ type: "reset" });
    questMeetProgressStore.set("idle");
}

/** The paths accepted and not done, tracked first. */
export function openQuestPaths(value: QuestState): QuestPath[] {
    const open = QUEST_PATHS.filter((path) => value.quests[path].accepted && !value.quests[path].done);
    return value.tracked ? [value.tracked, ...open.filter((path) => path !== value.tracked)] : open;
}
