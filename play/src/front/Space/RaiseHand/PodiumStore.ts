import type { Readable, Unsubscriber } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { Subscription } from "rxjs";
import { userIsAdminStore } from "../../Stores/GameStore";
import { isListenerStore, isSpeakerStore } from "../../Stores/MediaStore";
import { currentLiveStreamingSpaceStore } from "../../Stores/MegaphoneStore";
import type { SpaceInterface, SpaceUserExtended } from "../SpaceInterface";
import type { RaisedHand } from "./RaiseHandStore";
import { lowerHand, myHandRaisedStore, raisedHandsStore, registerConversationSpace } from "./RaiseHandStore";

/**
 * On a podium: someone in the audience raises a hand, a speaker (or an admin) invites them to speak, and they stream
 * to the audience until they stop or a speaker moves them back.
 */

/** An invitation waiting for our answer. */
export const speakInvitationStore = writable<{ fromName: string; accept: () => void; decline: () => void } | undefined>(
    undefined
);

/** While we speak from the audience: how to stop. */
export const speakingFromAudienceStore = writable<{ stop: () => void } | undefined>(undefined);

/** The people we invited and who have not answered yet, by uuid. */
export const pendingInvitesStore = writable<ReadonlySet<string>>(new Set());

/** The people we brought on stage from the audience, by uuid: we can move them back. */
export const broughtOnStageStore = writable<ReadonlySet<string>>(new Set());

/** Who may invite to speak and move people back to the audience: the speakers on the podium, and admins. */
export const canInviteToSpeakStore = derived(
    [currentLiveStreamingSpaceStore, isSpeakerStore, speakingFromAudienceStore, userIsAdminStore],
    ([$space, $isSpeaker, $speakingFromAudience, $isAdmin]) =>
        $space !== undefined && (($isSpeaker && $speakingFromAudience === undefined) || $isAdmin)
);

/** The podium we are on, if any: its raised hands are the ones we can invite to speak. */
export const podiumSpaceStore: Readable<SpaceInterface | undefined> = currentLiveStreamingSpaceStore;

const withUuid = (uuids: ReadonlySet<string>, uuid: string) => new Set(uuids).add(uuid);
const withoutUuid = (uuids: ReadonlySet<string>, uuid: string) => {
    const remaining = new Set(uuids);
    remaining.delete(uuid);
    return remaining;
};

export function inviteToSpeak(hand: RaisedHand): void {
    hand.user.emitPrivateEvent({ $case: "inviteToSpeak", inviteToSpeak: {} });
    pendingInvitesStore.update((uuids) => withUuid(uuids, hand.uuid));
}

export function moveToAudience(user: SpaceUserExtended): void {
    user.emitPrivateEvent({ $case: "moveToAudience", moveToAudience: {} });
    broughtOnStageStore.update((uuids) => withoutUuid(uuids, user.uuid));
}

/**
 * While we are on a podium (on stage or in the audience): its raised hands, our own hand, and the invitations.
 * Returns the function that stops it.
 */
export function bindPodiumToRaiseHand(): Unsubscriber {
    let stopCurrent: (() => void) | undefined;
    let currentSpace: SpaceInterface | undefined;
    const unsubscribe = currentLiveStreamingSpaceStore.subscribe((space) => {
        if (space === currentSpace) return;
        stopCurrent?.();
        stopCurrent = undefined;
        currentSpace = space;
        if (space) stopCurrent = bindPodiumSpace(space);
    });
    return () => {
        unsubscribe();
        stopCurrent?.();
    };
}

function bindPodiumSpace(space: SpaceInterface): () => void {
    // The audience raises hands; so does someone speaking from it, to stay in line.
    const canRaise = derived(
        [isListenerStore, speakingFromAudienceStore],
        ([$isListener, $speakingFromAudience]) => $isListener || $speakingFromAudience !== undefined
    );
    const unsubscribers: Unsubscriber[] = [registerConversationSpace(space, canRaise)];
    const subscriptions: Subscription[] = [];

    unsubscribers.push(
        derived([myHandRaisedStore, canRaise], ([$raised, $canRaise]) => $raised && $canRaise).subscribe((raised) => {
            // Any positive value: the pusher replaces it with its own time.
            space.emitUpdateUser({ handRaisedAt: raised ? Date.now() : 0 });
        })
    );

    // An invitation nobody answered ends when that hand goes down.
    unsubscribers.push(
        raisedHandsStore.subscribe((hands) => {
            const raised = new Set(hands.map((hand) => hand.uuid));
            const pending = get(pendingInvitesStore);
            if (Array.from(pending).some((uuid) => !raised.has(uuid))) {
                pendingInvitesStore.set(new Set(Array.from(pending).filter((uuid) => raised.has(uuid))));
            }
        })
    );

    const stopSpeaking = () => {
        space.stopStreaming();
        speakingFromAudienceStore.set(undefined);
        isSpeakerStore.set(false);
        isListenerStore.set(true);
    };

    subscriptions.push(
        space.observePrivateEvent("inviteToSpeak").subscribe((event) => {
            if (!get(isListenerStore) || get(speakingFromAudienceStore)) return;
            const inviterId = event.sender.spaceUserId;
            speakInvitationStore.set({
                fromName: event.sender.name,
                accept: () => {
                    speakInvitationStore.set(undefined);
                    // Streaming first: the speakers see us go on stage before the hand goes down.
                    isListenerStore.set(false);
                    isSpeakerStore.set(true);
                    space.startStreaming();
                    speakingFromAudienceStore.set({ stop: stopSpeaking });
                    lowerHand();
                },
                decline: () => {
                    speakInvitationStore.set(undefined);
                    space.emitPrivateMessage({ $case: "declineToSpeak", declineToSpeak: {} }, inviterId);
                },
            });
        }),
        space.observePrivateEvent("declineToSpeak").subscribe((event) => {
            pendingInvitesStore.update((uuids) => withoutUuid(uuids, event.sender.uuid));
        }),
        space.observePrivateEvent("moveToAudience").subscribe(() => {
            get(speakingFromAudienceStore)?.stop();
        }),
        // Someone we invited goes on stage.
        space.observeUserJoined.subscribe((user) => {
            if (!get(pendingInvitesStore).has(user.uuid)) return;
            pendingInvitesStore.update((uuids) => withoutUuid(uuids, user.uuid));
            broughtOnStageStore.update((uuids) => withUuid(uuids, user.uuid));
        }),
        space.observeUserLeft.subscribe((user) => {
            broughtOnStageStore.update((uuids) => withoutUuid(uuids, user.uuid));
        })
    );

    return () => {
        subscriptions.forEach((subscription) => subscription.unsubscribe());
        unsubscribers.forEach((unsubscriber) => unsubscriber());
        // Leaving the podium ends everything that happened on it. Leaving its zone usually leaves the space too, but
        // stop streaming in case we are still in it. The listener state stays with the zone that set it.
        if (get(speakingFromAudienceStore)) {
            space.stopStreaming();
            speakingFromAudienceStore.set(undefined);
            isSpeakerStore.set(false);
        }
        speakInvitationStore.set(undefined);
        pendingInvitesStore.set(new Set());
        broughtOnStageStore.set(new Set());
    };
}
